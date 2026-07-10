// Local control panel for Multi-Wallet Rails.
// Joins SHKeeper's invoice data (deposit address per order) with LIVE on-chain
// balances (deposit network) and a LIVE mainnet gas gauge, and serves a simple
// Russian dashboard. Read-only — it never moves funds.
import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from 'viem';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- config (env-overridable) --------------------------------------------
const PORT = Number(process.env.PORT || 5060);
const SHKEEPER_URL = process.env.SHKEEPER_URL || 'http://localhost:5050';
const SHKEEPER_CONTAINER = process.env.SHKEEPER_CONTAINER || 'mwr-shkeeper';
const CRYPTO = process.env.CRYPTO || 'ETH-USDT';
// Deposit network RPC (where the generated addresses live). Default: Sepolia.
const DEPOSIT_RPC = process.env.DEPOSIT_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
// Mainnet RPC — used only for the "real" Ethereum gas gauge (Etherscan-style).
const GAS_RPC = process.env.GAS_RPC || 'https://ethereum-rpc.publicnode.com';
// USDT contract on the deposit network. On Sepolia this mainnet address has no
// code, so USDT balances read as 0 until you configure a real test token.
const USDT_ADDRESS = process.env.USDT_ADDRESS || '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const NETWORK_LABEL = process.env.NETWORK_LABEL || 'Sepolia (testnet)';
const EXPLORER = process.env.EXPLORER || 'https://sepolia.etherscan.io';

const depositClient = createPublicClient({ transport: http(DEPOSIT_RPC, { batch: true }) });
const gasClient = createPublicClient({ transport: http(GAS_RPC, { batch: true }) });

// ---- data sources ---------------------------------------------------------

// Read the deposit addresses + order ids straight from SHKeeper's SQLite.
async function readInvoices() {
  const py = `
import sqlite3, json
c = sqlite3.connect('/shkeeper.io/instance/shkeeper.sqlite')
rows = list(c.execute("SELECT external_id, addr, amount_crypto, status, created_at FROM invoice WHERE crypto=? ORDER BY id", ("${CRYPTO}",)))
print(json.dumps([{"order": r[0], "addr": r[1], "expected": float(r[2] or 0), "status": r[3], "created": str(r[4])} for r in rows]))
`;
  const { stdout } = await execFileP('docker', ['exec', SHKEEPER_CONTAINER, 'python3', '-c', py]);
  return JSON.parse(stdout);
}

async function feeDepositAddress(apikey) {
  const r = await fetch(`${SHKEEPER_URL}/api/v1/${CRYPTO}/fee-deposit-address`, {
    headers: { 'X-Shkeeper-Api-Key': apikey },
  });
  const j = await r.json();
  return j.fee_deposit_address;
}

async function readApiKey() {
  const py = `import sqlite3;print(sqlite3.connect('/shkeeper.io/instance/shkeeper.sqlite').execute("SELECT apikey FROM wallet WHERE crypto=?",("${CRYPTO}",)).fetchone()[0])`;
  const { stdout } = await execFileP('docker', ['exec', SHKEEPER_CONTAINER, 'python3', '-c', py]);
  return stdout.trim();
}

// Native ETH balance for every address (batched JSON-RPC).
async function nativeBalances(addresses) {
  const out = {};
  await Promise.all(
    addresses.map(async (a) => {
      try { out[a] = await depositClient.getBalance({ address: a }); }
      catch { out[a] = null; }
    }),
  );
  return out;
}

// USDT balances via multicall (allowFailure — returns 0 where the token has no code).
async function usdtBalances(addresses) {
  const out = {};
  try {
    const res = await depositClient.multicall({
      allowFailure: true,
      contracts: addresses.map((a) => ({
        address: USDT_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [a],
      })),
    });
    addresses.forEach((a, i) => { out[a] = res[i].status === 'success' ? res[i].result : null; });
  } catch {
    addresses.forEach((a) => { out[a] = null; });
  }
  return out;
}

// Live mainnet gas — base fee + Low/Average/High priority from fee history.
async function gasGauge() {
  const [block, hist] = await Promise.all([
    gasClient.getBlock(),
    gasClient.getFeeHistory({ blockCount: 20, rewardPercentiles: [15, 50, 90] }),
  ]);
  const base = Number(block.baseFeePerGas ?? 0n) / 1e9;
  const cols = [[], [], []];
  for (const r of hist.reward ?? []) r.forEach((v, i) => cols[i].push(Number(v) / 1e9));
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const low = base + avg(cols[0]);
  const average = base + avg(cols[1]);
  const high = base + avg(cols[2]);
  return { base, low, average, high };
}

// ---- api ------------------------------------------------------------------
const app = express();
app.use(express.static(join(__dirname, 'public')));

app.get('/api/state', async (_req, res) => {
  try {
    const [invoices, gas] = await Promise.all([readInvoices(), gasGauge().catch(() => null)]);
    const addresses = invoices.map((i) => i.addr);
    let feeAddr = null, feeBal = null;
    try {
      const apikey = await readApiKey();
      feeAddr = await feeDepositAddress(apikey);
    } catch { /* ignore */ }

    const allAddrs = feeAddr ? [...addresses, feeAddr] : addresses;
    const [native, usdt] = await Promise.all([nativeBalances(allAddrs), usdtBalances(addresses)]);
    if (feeAddr) feeBal = native[feeAddr];

    const rows = invoices.map((inv, i) => ({
      n: i + 1,
      order: inv.order,
      addr: inv.addr,
      expected: inv.expected,
      status: inv.status,
      created: inv.created,
      eth: native[inv.addr] != null ? formatEther(native[inv.addr]) : null,
      usdt: usdt[inv.addr] != null ? formatUnits(usdt[inv.addr], 6) : null,
    }));

    res.json({
      network: NETWORK_LABEL,
      explorer: EXPLORER,
      crypto: CRYPTO,
      count: rows.length,
      totalEth: rows.reduce((s, r) => s + (r.eth ? Number(r.eth) : 0), 0),
      totalUsdt: rows.reduce((s, r) => s + (r.usdt ? Number(r.usdt) : 0), 0),
      fee: feeAddr ? { addr: feeAddr, eth: feeBal != null ? formatEther(feeBal) : null } : null,
      gas,
      rows,
      ts: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log(`Dashboard on http://localhost:${PORT}`));
