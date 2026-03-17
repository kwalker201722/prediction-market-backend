# Oracle Bot

Standalone Node.js CLI that fetches market prices, signs settlement payloads, and submits them to the `PredictionMarket` smart contract.

## Files

| File | Purpose |
|------|---------|
| `oracleBot.js` | Plain JavaScript CLI – run with `node oracleBot.js` |
| `settlement-bot.ts` | TypeScript version with full type safety – run with `ts-node` |
| `settlement-bot.test.ts` | Jest unit tests for the TypeScript bot |
| `tsconfig.json` | TypeScript compiler config for the bot |

## Quick Start

### Using the JavaScript bot (`oracleBot.js`)

```bash
# 1. Install dependencies (from the repo root)
npm install

# 2. Copy and edit environment variables
cp .env.example .env
# Required: ORACLE_PRIVATE_KEY, ORACLE_CONTRACT_ADDRESS, ORACLE_RPC_URL
# Optional: POLYGON_API_KEY, FMP_API_KEY, MARKETS_TO_SETTLE

# 3. Dry-run (logs payloads, sends NO transactions)
DRY_RUN=true node oracle-bot/oracleBot.js

# 4. Live mode
node oracle-bot/oracleBot.js
```

### Using the TypeScript bot (`settlement-bot.ts`)

```bash
# Dry-run
DRY_RUN=true npx ts-node oracle-bot/settlement-bot.ts

# Live mode
npx ts-node oracle-bot/settlement-bot.ts

# Build to JavaScript first, then run
npx tsc -p oracle-bot/tsconfig.json
node dist/oracle-bot/settlement-bot.js
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ORACLE_RPC_URL` | live mode | JSON-RPC endpoint (Infura, Alchemy, etc.). Falls back to `ETHEREUM_RPC_URL`. |
| `ORACLE_PRIVATE_KEY` | always | Admin/oracle signing key. Falls back to `BACKEND_WALLET_PRIVATE_KEY`. |
| `ORACLE_CONTRACT_ADDRESS` | live mode | Deployed `PredictionMarket` address. Falls back to `SMART_CONTRACT_ADDRESS`. |
| `DRY_RUN` | — | Set `true` to log payloads without sending transactions. |
| `POLYGON_API_KEY` | — | [Polygon.io](https://polygon.io) API key (first price source). |
| `FMP_API_KEY` | — | [Financial Modeling Prep](https://financialmodelingprep.com) key (second price source). |
| `MARKETS_TO_SETTLE` | — | JSON array of `{marketId, ticker, expiryDate}` objects. |

### Example MARKETS_TO_SETTLE

```
MARKETS_TO_SETTLE=[{"marketId":"1","ticker":"AAPL","expiryDate":"2024-01-19"},{"marketId":"2","ticker":"BTC","expiryDate":"2024-02-01"}]
```

## How It Works

1. Reads `MARKETS_TO_SETTLE` from `.env` (or replace `loadMarketsToSettle()` with a DB query).
2. For each market, fetches the settlement price: **Polygon.io → FMP → Yahoo Finance** (first success wins).
3. Builds a deterministic settlement message:
   ```
   Settlement:marketId=<id>,outcome=<n>,price=<p>,evidenceHash=<h>
   ```
4. Signs the message with `ORACLE_PRIVATE_KEY` using EIP-191 personal sign.
5. Calls `resolveMarket(marketId, outcome, price, signature, evidenceHash)` on the contract.

## Scheduling (Production)

Run the bot as a cron job after US market close:

```cron
5 18 * * 1-5  cd /app && node oracle-bot/oracleBot.js >> /var/log/oracle-bot.log 2>&1
```

Or as a Cloud Run / Lambda scheduled job pointing to the compiled `dist/oracle-bot/settlement-bot.js`.

## Running Tests

```bash
# All tests
npm test

# Oracle bot suite only
npx jest oracle-bot
```

## Adding a New Price Provider

1. Create `fetchPriceFrom<Provider>(ticker, ...)` returning `number | null`.
2. Add it to the fallback chain in `fetchSettlementPrice()`.
3. Add the API key to `.env.example` and document it above.
