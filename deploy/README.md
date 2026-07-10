# Local SHKeeper evaluation (ETH-USDT / ETH-USDC)

Goal: stand SHKeeper up locally, generate deposit addresses, and run a real
sweep on **Sepolia testnet** — so you can decide buy-vs-build from real numbers
before writing custom code. Uses an **external RPC**, so no geth sync.

## Prerequisites
- Docker (tested with Docker 29).
- A Sepolia RPC URL. The free public one in `.env.example`
  (`https://ethereum-sepolia-rpc.publicnode.com`) works for a first run; for
  load-testing 500+ addresses get a free Alchemy/Infura key.
- For the funded end-to-end sweep test: some **Sepolia ETH** (from a faucet) for
  the fee-deposit account, and a test ERC-20 to stand in for USDT.

## 1. Start the stack
```bash
cp deploy/.env.example deploy/.env      # edit FULLNODE_URL if you have a key
docker compose -f deploy/docker-compose.eval.yml --env-file deploy/.env up -d
docker compose -f deploy/docker-compose.eval.yml logs -f shkeeper   # watch boot
```
Open http://localhost:5000 and set an admin password on first load.

## 2. Confirm the ETH backend is connected
In the SHKeeper UI the `ETH-USDT` / `ETH-USDC` wallets should appear. Behind the
scenes the main service talks to the `ethereum-shkeeper` container on :6000.
```bash
docker compose -f deploy/docker-compose.eval.yml logs ethereum-shkeeper | tail
```

## 3. Generate deposit addresses (the "500 addresses" step)
Via the API (key is `key` from the compose file):
```bash
# create/get a deposit address for an invoice
curl -s -X POST http://localhost:5000/api/v1/ETH-USDT/generate-address \
  -H 'X-Shkeeper-Backend-Key: key' | jq
```
Script this in a loop to mint 500–1000 addresses and measure issuance latency.
(Exact endpoint paths: see the API section of the root SHKeeper README.)

## 4. Fund the fee-deposit (gas) account
ERC-20 sweeps need ETH for gas. Find the fee-deposit address and send it Sepolia
ETH from a faucet:
```bash
curl -s http://localhost:5000/api/v1/ETH-USDT/fee-deposit-address \
  -H 'X-Shkeeper-Backend-Key: key' | jq
```

## 5. Run a sweep / multipayout and measure
`multipayout` consolidates/pays out. Watch the task and count transactions +
gas — this is the number that decides L1 viability at your scale. Compare it
against [`poc/src/sweep-cost.js`](../poc/src/sweep-cost.js) estimates.

## Teardown
```bash
docker compose -f deploy/docker-compose.eval.yml down          # keep data
docker compose -f deploy/docker-compose.eval.yml down -v       # wipe volumes
```

## Notes / caveats
- This compose is reverse-engineered from the Helm chart for **local eval**, not
  production. Production should use the official Helm chart (k3s) with real
  secrets, a dedicated RPC, and proper key custody.
- The main service stores its data in a SQLite volume (`shkeeper-instance`); the
  ETH backend uses the `ethereum-shkeeper` MariaDB database.
- `ETH_USERNAME/PASSWORD=test` are placeholders for RPC basic-auth; public RPCs
  ignore them. Set real values if your RPC requires auth.
