// End-to-end deposit -> sweep demo on a local devnet (Ganache, in-process).
// Everything is REAL EVM execution with REAL gas — just on a free local chain,
// so no faucet is needed. Keys are derived in-process and never exported.
//
// Flow: deploy MockUSDT -> generate N deposit addresses -> distribute USDT to
// some of them (simulated customer payments) -> sweep them all into one treasury,
// measuring gas per address.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ganache from 'ganache';
import solc from 'solc';
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatUnits, formatEther } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC_PORT = Number(process.env.DEVNET_PORT || 8545);
const RPC = `http://localhost:${RPC_PORT}`;
const CHAIN_ID = 11155111; // mimic Sepolia
const MNEMONIC = 'test test test test test test test test test test test junk';
const N_DEPOSITS = 12;          // deposit addresses to create
const DEPOSIT_START = 100;      // HD index where deposit addresses begin
const chain = {
  id: CHAIN_ID, name: 'devnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const state = {
  ready: false, token: null, treasury: null, feeAddr: null,
  deposits: [], // {index, addr, order}
  lastSweep: null, lastTopup: null, log: [],
};

let pub, deployer;
function wallet(index) {
  return createWalletClient({ account: mnemonicToAccount(MNEMONIC, { addressIndex: index }), chain, transport: http(RPC) });
}
function log(m) { state.log.unshift({ t: Date.now(), m }); state.log = state.log.slice(0, 40); }

function compileToken() {
  const src = readFileSync(join(__dirname, 'contracts', 'MockUSDT.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'MockUSDT.sol': { content: src } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const c = out.contracts['MockUSDT.sol'].MockUSDT;
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}

export async function init() {
  const server = Ganache.server({
    chain: { chainId: CHAIN_ID }, logging: { quiet: true },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 20, defaultBalance: 1000 },
    miner: { blockGasLimit: 30_000_000 },
  });
  await server.listen(RPC_PORT);
  pub = createPublicClient({ chain, transport: http(RPC) });
  deployer = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
  state.treasury = mnemonicToAccount(MNEMONIC, { addressIndex: 1 }).address;
  state.feeAddr = mnemonicToAccount(MNEMONIC, { addressIndex: 2 }).address;

  const { abi, bytecode } = compileToken();
  state.abi = abi;
  const hash = await wallet(0).deployContract({ abi, bytecode });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  state.token = rcpt.contractAddress;
  log(`MockUSDT deployed at ${state.token}`);

  // create N deposit addresses
  for (let i = 0; i < N_DEPOSITS; i++) {
    const acct = mnemonicToAccount(MNEMONIC, { addressIndex: DEPOSIT_START + i });
    state.deposits.push({ index: DEPOSIT_START + i, addr: acct.address, order: `order-${i + 1}` });
  }
  // simulate customer payments: fund ~2/3 of them with USDT (varying amounts)
  const amounts = [150, 500, 42.5, 1000, 75, 320, 12, 640];
  for (let i = 0; i < amounts.length; i++) {
    const to = state.deposits[i].addr;
    const h = await wallet(0).writeContract({ address: state.token, abi, functionName: 'mint', args: [to, parseUnits(String(amounts[i]), 6)] });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  log(`Seeded ${amounts.length} deposit addresses with test USDT`);
  state.ready = true;
}

export async function getState() {
  if (!state.ready) return { ready: false };
  const rows = await Promise.all(state.deposits.map(async (d) => {
    const [eth, usdt] = await Promise.all([
      pub.getBalance({ address: d.addr }),
      pub.readContract({ address: state.token, abi: state.abi, functionName: 'balanceOf', args: [d.addr] }),
    ]);
    return { order: d.order, addr: d.addr, eth: formatEther(eth), usdt: formatUnits(usdt, 6) };
  }));
  const treasuryUsdt = await pub.readContract({ address: state.token, abi: state.abi, functionName: 'balanceOf', args: [state.treasury] });
  const gasPrice = await pub.getGasPrice();
  return {
    ready: true, token: state.token, treasury: state.treasury, chainId: CHAIN_ID,
    rows,
    totalUsdt: rows.reduce((s, r) => s + Number(r.usdt), 0),
    fundedCount: rows.filter((r) => Number(r.usdt) > 0).length,
    treasuryUsdt: formatUnits(treasuryUsdt, 6),
    gasPriceGwei: Number(gasPrice) / 1e9,
    lastSweep: state.lastSweep, lastTopup: state.lastTopup, log: state.log,
    ts: Date.now(),
  };
}

// Send a little ETH to every deposit address that holds USDT (so it can pay gas).
export async function topUpGas() {
  const results = [];
  let totalGas = 0n;
  for (const d of state.deposits) {
    const bal = await pub.readContract({ address: state.token, abi: state.abi, functionName: 'balanceOf', args: [d.addr] });
    if (bal === 0n) continue;
    const eth = await pub.getBalance({ address: d.addr });
    if (eth >= parseEther('0.005')) continue;
    const h = await wallet(0).sendTransaction({ to: d.addr, value: parseEther('0.01') });
    const r = await pub.waitForTransactionReceipt({ hash: h });
    totalGas += r.gasUsed;
    results.push({ addr: d.addr, funded: '0.01' });
  }
  state.lastTopup = { count: results.length, ts: Date.now() };
  log(`Топливо газа: пополнено ${results.length} адрес(ов)`);
  return state.lastTopup;
}

// Sweep: every deposit address with USDT sends its full balance to the treasury.
// One transaction per address (the account-model reality). Measures total gas.
export async function sweep() {
  const results = [];
  let totalGas = 0n;
  for (const d of state.deposits) {
    const bal = await pub.readContract({ address: state.token, abi: state.abi, functionName: 'balanceOf', args: [d.addr] });
    if (bal === 0n) continue;
    // auto-fund gas if needed
    const eth = await pub.getBalance({ address: d.addr });
    if (eth < parseEther('0.003')) {
      const hf = await wallet(0).sendTransaction({ to: d.addr, value: parseEther('0.01') });
      await pub.waitForTransactionReceipt({ hash: hf });
    }
    const h = await wallet(d.index).writeContract({ address: state.token, abi: state.abi, functionName: 'transfer', args: [state.treasury, bal] });
    const r = await pub.waitForTransactionReceipt({ hash: h });
    totalGas += r.gasUsed;
    results.push({ addr: d.addr, usdt: formatUnits(bal, 6), gas: Number(r.gasUsed), tx: h });
  }
  const avgGas = results.length ? Number(totalGas) / results.length : 0;
  state.lastSweep = {
    swept: results.length,
    totalUsdt: results.reduce((s, r) => s + Number(r.usdt), 0),
    totalGas: Number(totalGas),
    avgGasPerAddr: Math.round(avgGas),
    results, ts: Date.now(),
  };
  log(`Сметание: ${results.length} адрес(ов), газ всего ${Number(totalGas).toLocaleString()}`);
  return state.lastSweep;
}

// Re-seed USDT so the demo can be run again.
export async function reseed() {
  const amounts = [150, 500, 42.5, 1000, 75, 320, 12, 640];
  for (let i = 0; i < amounts.length; i++) {
    const h = await wallet(0).writeContract({ address: state.token, abi: state.abi, functionName: 'mint', args: [state.deposits[i].addr, parseUnits(String(amounts[i]), 6)] });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  state.lastSweep = null;
  log('Пере-засев тестовых USDT выполнен');
  return { ok: true };
}
