// Derive N deterministic ETH deposit addresses from a single BIP-39 mnemonic
// using the BIP-44 path m/44'/60'/0'/0/i. This is the "Electrum-style" model:
// one seed -> unlimited receiving addresses. Each derived address is a normal
// EOA; funds landing on it must later be swept (see architecture.md for why ETH
// cannot combine many addresses into one tx like Bitcoin UTXOs can).
//
// Usage: node src/derive-hd.js [count]
import { mnemonicToAccount } from 'viem/accounts';

// DEMO mnemonic — well-known test vector. NEVER use in production.
const MNEMONIC =
  process.env.MNEMONIC ||
  'test test test test test test test test test test test junk';

const count = Number(process.argv[2] || 5);

console.log(`Deriving ${count} deposit addresses (path m/44'/60'/0'/0/i)\n`);
for (let i = 0; i < count; i++) {
  const account = mnemonicToAccount(MNEMONIC, { addressIndex: i });
  console.log(`  #${String(i).padStart(4, '0')}  ${account.address}`);
}
console.log(
  `\nAt scale you store only (mnemonic, index) — addresses are recomputed on demand.`,
);
