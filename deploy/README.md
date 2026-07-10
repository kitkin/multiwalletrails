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

## 2. First-run setup (validated flow)
The UI enforces three one-time steps before addresses can be minted. Do them in
the browser (http://localhost:5050) or by API:
1. **Set admin password** at `/set-password` (fields `pw1`, `pw2`).
2. **Log in** at `/login` (user `admin`).
3. **Enable + unlock wallet encryption** at `/unlock`. This sets the account
   password used to **encrypt every deposit private key at rest**. NOTE: with
   encryption *enabled*, you must re-enter this password at `/unlock` after every
   restart before address generation works again (the ETH backend polls the main
   service's `/api/v1/ETH/decrypt` for it).

## 3. Get the wallet API key
Each wallet has its own `X-Shkeeper-Api-Key` (generate/view in the UI, or read
from the SQLite DB for scripting):
```bash
docker exec mwr-shkeeper python3 -c "import sqlite3; \
print(sqlite3.connect('/shkeeper.io/instance/shkeeper.sqlite').execute(\
\"SELECT apikey FROM wallet WHERE crypto='ETH-USDT'\").fetchone()[0])"
```

## 4. Generate deposit addresses (the "500 addresses" step) — VALIDATED
Each **invoice** (unique `external_id`) yields one unique deposit address. Loop
to mint as many as you need:
```bash
K=<apikey-from-step-3>
for i in $(seq 1 500); do
  curl -s -X POST http://localhost:5050/api/v1/ETH-USDT/payment_request \
    -H "X-Shkeeper-Api-Key: $K" -H 'Content-Type: application/json' \
    -d "{\"external_id\":\"order-$i\",\"fiat\":\"USD\",\"amount\":100,\"callback_url\":\"http://example.com/cb\"}"
done
curl -s http://localhost:5050/api/v1/ETH-USDT/addresses -H "X-Shkeeper-Api-Key: $K"
```
Measured on this machine: ~39 addresses/sec single-threaded (≈25s for 1000).

## 5. Fund the fee-deposit (gas) account
ERC-20 sweeps need ETH for gas. Get the fee-deposit address and send it Sepolia
ETH from a faucet:
```bash
curl -s http://localhost:5050/api/v1/ETH-USDT/fee-deposit-address \
  -H "X-Shkeeper-Api-Key: $K"
```

## 6. Run a sweep / multipayout and measure
`/api/v1/ETH-USDT/multipayout` consolidates/pays out. It sends **one transaction
per address** (confirmed in the backend source) — watch the task, count the
transactions and gas, and compare against [`poc/src/sweep-cost.js`](../poc/src/sweep-cost.js).
This is the number that decides L1 viability at your scale. Requires the deposit
addresses to actually hold a test ERC-20 + the fee account to hold Sepolia ETH.

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
