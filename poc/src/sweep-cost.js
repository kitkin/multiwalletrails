// Estimate the REAL cost of sweeping N USDT (ERC-20) deposit addresses on
// Ethereum L1, using live gas price + ETH/USD from public RPCs.
//
// Why this matters: on the account model each deposit address needs its OWN
// transactions to move funds, and USDT can't pay its own gas. The SHKeeper flow
// (confirmed in ethereum-shkeeper/app/token.py) is, per address:
//   1) fund gas: send ETH from the fee-deposit account -> deposit address (~21k gas)
//   2) sweep:    ERC-20 transfer from deposit address -> treasury (~65k gas for USDT)
// So ~86k gas per address. This script prices that for 500 and 1000 addresses.
//
// Usage: node src/sweep-cost.js
import { createPublicClient, http, formatEther } from 'viem';
import { mainnet } from 'viem/chains';

const GAS_FUND = 21000n;      // plain ETH transfer to fund the deposit address
const GAS_USDT_XFER = 65000n; // USDT.transfer() is famously ~63-65k gas
const PER_ADDR = GAS_FUND + GAS_USDT_XFER;

const RPCS = [
  process.env.ETH_RPC,
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://rpc.ankr.com/eth',
  'https://cloudflare-eth.com',
].filter(Boolean);

async function firstWorking() {
  for (const url of RPCS) {
    try {
      const c = createPublicClient({ chain: mainnet, transport: http(url) });
      await c.getGasPrice();
      return { c, url };
    } catch {
      /* try next */
    }
  }
  throw new Error('No public RPC reachable; set ETH_RPC=<url>');
}
const { c: client, url: rpcUrl } = await firstWorking();
console.log(`RPC: ${rpcUrl}`);

// Rough ETH/USD via a public price endpoint would need fetch; keep it explicit:
const ETH_USD = Number(process.env.ETH_USD || 3000); // override: ETH_USD=3500 node ...

const gasPrice = await client.getGasPrice(); // wei per gas
const block = await client.getBlockNumber();

console.log(`Ethereum L1 — block ${block}`);
console.log(`Live gas price: ${Number(gasPrice) / 1e9} gwei   (ETH/USD assumed $${ETH_USD})\n`);
console.log(`Per-address sweep = ${PER_ADDR} gas (fund ${GAS_FUND} + transfer ${GAS_USDT_XFER})\n`);

for (const n of [1, 500, 1000]) {
  const totalGas = PER_ADDR * BigInt(n);
  const costEth = Number(formatEther(totalGas * gasPrice));
  const costUsd = costEth * ETH_USD;
  console.log(
    `  ${String(n).padStart(4)} addresses:  ${costEth.toFixed(4)} ETH  ≈ $${costUsd.toFixed(2)}`,
  );
}
console.log(`\nGas is volatile — same 1000-address sweep at different gas prices:`);
for (const gwei of [0.1, 1, 5, 15, 30, 60]) {
  const costEth = (Number(PER_ADDR) * 1000 * gwei) / 1e9;
  console.log(
    `  @ ${String(gwei).padStart(4)} gwei:  ${costEth.toFixed(4)} ETH  ≈ $${(costEth * ETH_USD).toFixed(2)}`,
  );
}
console.log(`\nThis is pure gas. On an L2 the same op is typically <1% of this.`);
