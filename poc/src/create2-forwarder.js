// Compute CREATE2 "counterfactual" deposit addresses for the forwarder pattern.
//
// The idea (used by BitGo, exchanges): a single Factory contract can deploy a
// tiny Forwarder contract to a *deterministic* address derived from a salt.
// You give each customer their unique forwarder address BEFORE any contract is
// deployed on-chain — no gas spent until you actually sweep. When you want the
// money, you deploy the forwarder at that address; its constructor/flush pushes
// all funds to your treasury. One customer = one salt = one stable address.
//
// address = keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))[12:]
//
// Usage: node src/create2-forwarder.js [count]
import { getContractAddress, keccak256, toHex, encodeAbiParameters } from 'viem';

// Example factory + a minimal forwarder init code hash. In a real system the
// init code encodes the treasury address; here we show the address math only.
const FACTORY = '0x1111111111111111111111111111111111111111';
const TREASURY = '0x2222222222222222222222222222222222222222';

// Pretend init code hash of a Forwarder(treasury) — deterministic per treasury.
// (In production this comes from your compiled Forwarder bytecode + constructor args.)
const INIT_CODE_HASH = keccak256(
  encodeAbiParameters([{ type: 'address' }], [TREASURY]),
);

const count = Number(process.argv[2] || 5);

console.log(`CREATE2 counterfactual deposit addresses`);
console.log(`  factory:  ${FACTORY}`);
console.log(`  treasury: ${TREASURY}\n`);

for (let i = 0; i < count; i++) {
  // Salt is typically keccak256(customerId) or a padded index.
  const salt = keccak256(toHex(`customer-${i}`));
  const address = getContractAddress({
    opcode: 'CREATE2',
    from: FACTORY,
    salt,
    bytecodeHash: INIT_CODE_HASH,
  });
  console.log(`  customer-${String(i).padStart(4, '0')}  ${address}`);
}
console.log(
  `\nNo on-chain deployment happened. Addresses are stable and gas-free until sweep.`,
);
