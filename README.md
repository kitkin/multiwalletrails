# Multi-Wallet Rails

Infrastructure for **mass reception of ETH / ERC-20 across hundreds–thousands of
deposit addresses**, and consolidating ("sweeping") the funds into one treasury.

The goal, in the words of the original request: *"work like Electrum — generate
500 addresses, receive on them, then sweep everything out at once."*

> ⚠️ **Read this first — the Electrum mental model does not port 1:1 to Ethereum.**
> Bitcoin/Electrum is a **UTXO** chain: 500 addresses can be spent as 500 inputs
> in **one** transaction, paying one fee, sweeping everything atomically.
> Ethereum is an **account** chain with **no UTXOs**: funds on address A can only
> be moved by a transaction *from* A, and that transaction needs ETH for gas *on
> A*. So "sweep 500 addresses in a single tx" is **not possible natively**. This
> repo is about implementing the *closest, cheapest, most reliable* equivalent.
> See [docs/architecture.md](docs/architecture.md) for the full analysis.

## What's here now

| Path | Purpose | Status |
|------|---------|--------|
| [docs/architecture.md](docs/architecture.md) | Task decomposition, OSS landscape, sweep-strategy comparison, recommendation | ✅ |
| [poc/src/derive-hd.js](poc/src/derive-hd.js) | Derive N deposit addresses from one mnemonic (BIP-44) | ✅ tested |
| [poc/src/create2-forwarder.js](poc/src/create2-forwarder.js) | Compute CREATE2 counterfactual forwarder addresses | ✅ tested |
| [dashboard/](dashboard/) | Русскоязычная панель: список адресов + балансы + спидометр газа | ✅ running :8000 |
| [demo/](demo/) | Локальный девнет: приём USDT → сметание с кнопками, реальный газ, без кранов | ✅ running :8001 |

## Quickstart (proof-of-concept)

```bash
cd poc
npm install
npm run derive     # 5 HD deposit addresses from a test seed
npm run create2    # 5 counterfactual CREATE2 forwarder addresses
```

The HD script outputs the well-known Anvil/Hardhat test addresses
(`0xf39F…2266`, …) — a self-check that the BIP-44 derivation is correct.

## The core decision before building further

The whole architecture and cost profile pivots on two questions:

1. **Native ETH, or ERC-20 (USDT/USDC)?** They sweep differently — ETH can
   auto-forward; ERC-20 cannot (a plain token transfer to a contract runs no
   code) and always needs a per-address gas-funded `flush` tx.
2. **Which chain?** On Ethereum L1, sweeping 500–1000 addresses costs real money
   per sweep. On an L2 (Base/Arbitrum) or Tron it costs cents. For the
   "USDT mass-reception" use case that's implied here, **Tron (TRC-20)** or a
   cheap L2 is almost always the right answer.

See the recommendation section in [docs/architecture.md](docs/architecture.md).

## Not in scope / guardrails

This is legitimate payment-gateway / treasury infrastructure (the same pattern
every exchange and merchant processor uses). It deliberately does **not** include
anything for obfuscating fund origin, evading transaction monitoring, or
sanctions/AML circumvention. Run it against your own keys and treasury only.
