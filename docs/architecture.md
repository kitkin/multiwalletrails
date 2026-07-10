# Architecture & Research

## 1. Task decomposition

From the request ("accept on 500–1000 addresses, withdraw all at once, like
Electrum"), the system decomposes into five subsystems:

1. **Address issuance** — generate a unique, stable deposit address per
   customer/invoice, cheaply, at 500–1000+ scale, without pre-spending gas.
2. **Deposit detection** — watch those addresses for incoming ETH / ERC-20 and
   record confirmed credits (block reorg safe).
3. **Sweep / consolidation** — move funds from the deposit addresses into one
   treasury (hot) wallet, cheaply and reliably.
4. **Key management** — one seed / signer controlling all of it, secured; ideally
   deposit keys never need to be "hot" for long.
5. **Orchestration & ops** — an API/dashboard, gas funding, nonce management,
   retries, monitoring, accounting.

The hard part — and the reason "one wallet" is painful — is **#3 on the account
model**. Everything below is about doing #1 + #3 correctly.

## 2. Why Ethereum ≠ Electrum (the crux)

| | Bitcoin / Electrum (UTXO) | Ethereum (account) |
|---|---|---|
| Combine many addresses in one tx | ✅ 500 inputs → 1 output, one fee | ❌ impossible |
| Move funds from address A | Spend its UTXOs | Tx **from A**, needs gas **on A** |
| Sweep 500 addresses | 1 transaction | ~500 transactions (+ gas funding) |
| ERC-20 tokens | n/a | Token can't pay its own gas; needs ETH on A |

So on ETH there is no true "sweep all at once." The engineering choices are about
making N transactions **cheap, batched, and reliable**, or avoiding the sweep step
entirely with auto-forwarding contracts.

## 3. Sweep strategies compared

### A. Plain HD wallet + gas-funded sweep (naïve)
Derive addresses via BIP-44 (`m/44'/60'/0'/0/i`). To sweep each: send it ETH for
gas, then send its balance out. **2 txs per address.**
- ✅ Simplest; deposit addresses are normal EOAs.
- ❌ Most expensive; gas-funding dust left behind; heavy nonce/ordering work.
- Use when: low volume, or you only sweep occasionally.

### B. CREATE2 counterfactual forwarders (exchange/BitGo standard) — recommended base
A `Factory` contract can deploy a tiny `Forwarder` to a **deterministic address**
derived from a salt (`keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))`).
Give the customer that address **before** any contract exists — no gas until you
sweep. To sweep: deploy the forwarder at that address; its constructor flushes
funds to treasury in the **same** tx. Demonstrated in
[poc/src/create2-forwarder.js](../poc/src/create2-forwarder.js).
- ✅ Zero gas until money is actually there; stable per-customer addresses; the
  deposit key is the factory owner, not 1000 separate hot keys.
- ✅ For **native ETH** a forwarder can **auto-forward on receipt** → effectively
  "no sweep step," money lands in treasury directly.
- ⚠️ For **ERC-20** a plain `transfer` to the address runs no code, so you still
  need one `flush()` tx per address (deploy-if-needed + `token.transfer`).
- ❌ Slightly more complex; per-sweep you still pay deploy+forward gas per address.

### C. Batched sweep (layer on top of A or B)
Reduce the "N transactions" pain by batching the orchestration:
- **Multicall / Disperse-style** contract to fire many forwarder-flushes from one
  outer tx (still N internal calls, one outer signature/nonce).
- **EIP-7702** (live since the Pectra upgrade, 2025): an EOA can *temporarily act
  as a smart contract* for one tx and execute a **batch** of transfers atomically
  — all succeed or all fail. Great for consolidating many token balances the
  signer controls, and for **gas-sponsored** sweeps. This is the modern "get as
  close to Electrum's one-click as the account model allows" primitive.
- **ERC-4337** bundlers: batch UserOperations; heavier infra, usually overkill here.

### D. Chain choice is the biggest cost lever
The same design costs wildly different amounts:
- **Ethereum L1**: sweeping 1000 addresses = 1000+ txs at L1 gas → can be
  hundreds of dollars per full sweep. Avoid for high address counts.
- **L2 (Base / Arbitrum / Optimism)**: cents per tx; same EVM code, CREATE2,
  EIP-7702 all work. Strong default if you must stay EVM.
- **Tron (TRC-20 USDT)**: dominant rail for USDT mass-reception; very cheap; but
  different tooling (not EVM CREATE2 — uses energy/bandwidth model).

## 4. Open-source landscape (verified July 2026)

| Project | Stars | Lang | Last push | ETH sweep? | Verdict |
|---|---|---|---|---|---|
| [SHKeeper](https://github.com/vsys-host/shkeeper.io) | 586 | Python | 2026-07-08 (active) | ETH/ERC-20 + TRC-20 USDT, per-customer static addresses, auto-payout | **Best turnkey OSS** — closest to the requirement out of the box |
| [Bitcart](https://github.com/bitcartcc/bitcart) | 962 | Python | 2026-06 (active) | BTC/ETH/TRX/USDT, non-custodial | Great if you want BTCPay-style breadth + plugins |
| [hub20](https://github.com/mushroomlabs/hub20) | 101 | — | 2023 (dead) | ETH/ERC-20 | ❌ Abandoned, no license — reference only |
| [BitGo forwarders](https://github.com/BitGo) | — | Solidity/TS | active | CREATE2 forwarder contracts | Reference implementation of strategy **B** |
| [QuickNode Token-Sweeper](https://www.quicknode.com/sample-app-library/token-sweeper-eip-7702) | — | TS | active | EIP-7702 batch sweep | Reference implementation of strategy **C** |

Commercial products worth borrowing ideas from (not self-hosted): **PayRam**
(SmartSweep → cold wallet, thousands of deposit addresses), **Fystack**
(HD "hyper wallets" + threshold-triggered sweep), **Cobo** (custodial sweep).
Take from them: per-customer permanent addresses, threshold-based auto-sweep,
stablecoin auto-conversion. Avoid: custodial lock-in, opaque key handling.

## 5. Recommendation

**Take the best:**
- **Start from SHKeeper** if you want a working gateway this week — it already
  does per-customer static ETH/USDT addresses + payout, is actively maintained,
  and self-hosted. Evaluate it before writing anything custom.
- **If building custom**, use **CREATE2 counterfactual forwarders (B)** as the
  base + **EIP-7702 / Multicall batching (C)** for the sweep, on an **L2 or Tron**
  (D) rather than L1. That's the modern equivalent of Electrum's one-click sweep.
- Keep deposit-key exposure minimal: the factory owner signs sweeps; deposit
  addresses hold no keys that need to be online.

**Avoid the worst:**
- Don't run 1000 hot EOAs each holding private keys online (strategy A at scale).
- Don't do this on Ethereum L1 with high address counts unless you like paying
  hundreds per sweep.
- Don't hand-roll nonce management naïvely — parallel sweeps need a nonce manager
  and per-tx retry/backoff.

## 5b. Local evaluation results (validated)

Stood the SHKeeper stack up locally via [deploy/](../deploy/) (SHKeeper 2.5.29 +
evm-shkeeper 1.1.1 + MariaDB + Redis) against a **public Sepolia RPC** — no node
sync. Confirmed hands-on:

- ✅ Gateway boots and **registers ETH-USDT / ETH-USDC wallets** by talking to
  the `ethereum-shkeeper` backend.
- ✅ **Mass deposit-address generation works**: minted 58 unique ETH-USDT
  addresses via `payment_request`, **~39 addresses/sec** single-threaded
  (≈25s for 1000). Each is bound to a unique `external_id` — the Electrum-style
  "many receiving addresses" model.
- ✅ Deposit **private keys are encrypted at rest** (per-wallet account password,
  entered at `/unlock`; the backend fetches it via `/api/v1/ETH/decrypt`).
- ✅ Source-confirmed that `multipayout` **sends one tx per address** — no atomic
  batch sweep on the ETH account model (matches §2–§3).
- ⏭ Not yet run: a **funded** end-to-end sweep. That needs Sepolia ETH in the fee
  account + a test ERC-20 in the deposit addresses (faucet-gated), then
  `multipayout` to measure real gas. This is the natural next step.

Takeaway: **buy-vs-build leans "buy/adopt SHKeeper"** — it already does issuance,
encrypted custody, deposit scanning, gas-funded ERC-20 sweeps, and payout
callbacks. The main open question is cost/scale on L1 (see §3D and the calculator),
not capability.

## 6. Suggested build order

1. Decide **token + chain** (native ETH vs USDT; L1 vs L2 vs Tron). ← blocking
2. Stand up SHKeeper locally in Docker and pressure-test 500 deposit addresses +
   a full sweep on a testnet — decide buy-vs-build from real numbers.
3. If building: Factory + Forwarder contracts (Foundry), CREATE2 address service,
   deposit watcher, sweep orchestrator with nonce manager + EIP-7702 batching.
4. API + dashboard + monitoring + accounting.

## Sources

- https://github.com/vsys-host/shkeeper.io
- https://github.com/bitcartcc/bitcart
- https://github.com/mushroomlabs/hub20
- https://www.payram.com/blog/understanding-self-hosted-cryptocurrency-payment-processors
- https://fystack.io/blog/how-to-build-a-stablecoin-payment-gateway-with-fystack-programmable-wallet-infrastructure-part-1
- https://www.getfoundry.sh/guides/deterministic-deployments-using-create2
- https://www.quicknode.com/guides/ethereum-development/dapps/erc-20-batch-swap-dapp-using-eip-7702
- https://viem.sh/docs/eip7702
- https://www.cobo.com/post/what-is-token-sweeping
