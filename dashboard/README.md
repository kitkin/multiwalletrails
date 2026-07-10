# Панель кошельков (dashboard)

Локальная панель управления сгенерированными адресами приёма. SHKeeper's own UI
is aggregate-wallet-centric and has **no per-deposit-address screen** — this fills
that gap. Read-only: it never moves funds.

Показывает:
- **Список всех сгенерированных адресов** (order_id → адрес) с балансами ETH/USDT.
- **Спидометр газа** сети Ethereum (mainnet, как на Etherscan) + оценку стоимости
  выгрузки 1000 адресов при текущем и «быстром» газе.
- **Газовый кошелёк** (fee-deposit) — куда класть ETH для оплаты комиссий сметания.
- Автообновление каждые 15 сек, ссылки на explorer, копирование адреса.

## Запуск
```bash
cd dashboard
npm install
npm start            # http://localhost:5060
```
Требует запущенный SHKeeper eval-стек (см. ../deploy). Данные берутся из:
- SHKeeper SQLite (`docker exec mwr-shkeeper`) — список адресов и заказов;
- RPC сети депозитов (Sepolia по умолчанию) — балансы;
- mainnet RPC — спидометр газа.

## Настройка (env)
| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `5060` | порт панели |
| `SHKEEPER_URL` | `http://localhost:5050` | адрес SHKeeper API |
| `SHKEEPER_CONTAINER` | `mwr-shkeeper` | имя контейнера для чтения SQLite |
| `DEPOSIT_RPC` | Sepolia public | сеть, где живут адреса (балансы) |
| `GAS_RPC` | mainnet public | сеть для спидометра газа |
| `USDT_ADDRESS` | mainnet USDT | контракт токена для балансов |
| `NETWORK_LABEL` / `EXPLORER` | Sepolia | подписи и ссылки |

## Как увидеть «кто что получил»
Балансы обновляются с сети. Чтобы проверить приход вживую на тестнете: возьмите
Sepolia ETH из крана (ссылка в панели) и отправьте на любой адрес из таблицы —
через ~15 сек его строка подсветится зелёным. USDT-балансы появятся только когда
на сети депозитов есть реальный токен по адресу `USDT_ADDRESS` (на Sepolia
mainnet-USDT отсутствует — нужен тестовый токен).
