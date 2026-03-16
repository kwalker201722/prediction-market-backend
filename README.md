# Prediction Market Backend

Production-ready Node.js + Express backend API for a prediction market platform with PostgreSQL database, email/MetaMask authentication, Stripe payments, and Ethereum smart contract integration.

## Architecture

| Layer | Technology |
|-------|-----------|
| Framework | Node.js + Express |
| Language | TypeScript |
| Database | PostgreSQL (Railway) |
| Auth | JWT (email) + MetaMask wallet verification |
| Payments | Stripe API (fiat → ETH) |
| Blockchain | ethers.js → Sepolia testnet |
| Deployment | Railway.app |

## Smart Contract

- **Address:** `0xE88582edFEc4CFb3B1A3ABa5A79c55B8C1d770fc`
- **Network:** Sepolia testnet

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and fill in values
cp .env.example .env

# 3. Run database migrations
psql $DATABASE_URL < src/migrations/001_init.sql

# 4. Start development server
npm run dev

# 5. Build for production
npm run build
npm start
```

## API Endpoints

### Authentication `/auth`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | — | Email + password signup |
| POST | `/auth/login` | — | Email + password login |
| POST | `/auth/metamask/verify` | — | MetaMask wallet login |
| POST | `/auth/logout` | JWT | Logout |
| GET | `/auth/profile` | JWT | Current user profile |

### Users `/users`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/:id` | JWT | Get user profile |
| PUT | `/users/:id` | JWT | Update user profile |
| GET | `/users/:id/balances` | JWT | Balance history (chart data) |
| GET | `/users/:id/holdings` | JWT | Holdings from smart contract |
| GET | `/users/:id/transactions` | JWT | Transaction history (paginated) |

### Payments `/payments`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/payments/create-checkout-session` | JWT | Create Stripe checkout session |
| POST | `/payments/webhook` | Stripe sig | Stripe webhook handler |
| GET | `/payments/deposits/:id` | JWT | Get deposit status |
| POST | `/payments/withdrawals` | JWT | Request ETH withdrawal |
| GET | `/payments/withdrawals/:id` | JWT | Get withdrawal status |

### Blockchain `/blockchain`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/blockchain/holdings/:wallet` | JWT | Query holdings from contract |
| GET | `/blockchain/balance/:wallet` | JWT | Get ETH balance |
| POST | `/blockchain/execute-trade` | JWT | Execute trade via contract |

### Profile `/profile`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/profile/support` | — | FAQs and contact info |
| GET | `/profile/balances` | JWT | Balance breakdown |
| GET | `/profile/transfers` | JWT | Transfer history |
| GET | `/profile/rewards` | JWT | Earned rewards |
| GET | `/profile/history` | JWT | Full activity log (paginated) |
| GET | `/profile/statements` | JWT | Account statement |
| GET | `/profile/tax` | JWT | Tax-relevant data |
| GET | `/profile/security` | JWT | Security settings |
| GET | `/profile/privacy` | JWT | Privacy settings |

## Environment Variables

See `.env.example` for all required variables.

## Scripts

```bash
npm run dev      # Start development server with hot reload
npm run build    # Compile TypeScript to dist/
npm start        # Run compiled production build
npm test         # Run Jest tests
npm run lint     # Run ESLint
```

## Database

Run the migration file to create the schema:

```bash
psql $DATABASE_URL < src/migrations/001_init.sql
```

## Security

- JWT tokens (15 min expiry)
- bcrypt password hashing (12 rounds)
- CORS restricted to configured origin
- Rate limiting on auth and global endpoints
- Stripe webhook signature verification
- Input validation on all endpoints
- Environment variables for all secrets

---

## Oracle Settlement Bot

`oracle-bot/settlement-bot.ts` is a standalone TypeScript script that automatically
fetches close prices for expired prediction markets, signs the settlement payload
with an admin private key (EIP-191), and calls the smart contract's `resolveMarket`
function via ethers.js.

### How it works

1. Reads `MARKETS_TO_SETTLE` (JSON array) from `.env` – or replace
   `loadMarketsToSettle()` with a live DB query.
2. For each market, fetches the settlement price from **Polygon.io → FMP → Yahoo Finance**
   (first successful provider wins).
3. Builds a deterministic settlement message and signs it with `ORACLE_PRIVATE_KEY`
   using EIP-191 personal sign.
4. Calls `resolveMarket(marketId, outcome, price, signature, evidenceHash)` on the
   deployed contract and logs the transaction hash.

### Running the bot

```bash
# 1. Copy and fill in oracle-bot variables
cp .env.example .env
#    Set ORACLE_RPC_URL, ORACLE_PRIVATE_KEY, ORACLE_CONTRACT_ADDRESS,
#    POLYGON_API_KEY / FMP_API_KEY, and MARKETS_TO_SETTLE

# 2. Run in dry-run mode (logs payloads, sends NO transactions)
DRY_RUN=true npx ts-node oracle-bot/settlement-bot.ts

# 3. Run in live mode
npx ts-node oracle-bot/settlement-bot.ts

# 4. Build to JavaScript (uses oracle-bot/tsconfig.json)
npx tsc -p oracle-bot/tsconfig.json
node dist/oracle-bot/settlement-bot.js
```

### Running the tests

```bash
npm test
# or just the oracle-bot suite:
npx jest oracle-bot
```

### Deploying / scheduling

The bot is a short-lived process suitable for a **cron job** or a **Cloud Run job**.
Example crontab (run every day at 18:05 UTC after US market close):

```cron
5 18 * * 1-5  cd /app && npx ts-node oracle-bot/settlement-bot.ts >> /var/log/oracle-bot.log 2>&1
```

### Adding a new data source

1. Create a new `fetchPriceFrom<Provider>(ticker, ...)` function in
   `oracle-bot/settlement-bot.ts` that returns `number | null`.
2. Add it to the fallback chain inside `fetchSettlementPrice`.
3. Add the provider's API key to `.env.example` and document it in this section.

### Environment variables (oracle bot)

| Variable | Required | Description |
|---|---|---|
| `ORACLE_RPC_URL` | live mode | JSON-RPC endpoint (falls back to `ETHEREUM_RPC_URL`) |
| `ORACLE_PRIVATE_KEY` | live mode | Admin signing key (falls back to `BACKEND_WALLET_PRIVATE_KEY`) |
| `ORACLE_CONTRACT_ADDRESS` | live mode | Deployed contract (falls back to `SMART_CONTRACT_ADDRESS`) |
| `DRY_RUN` | — | Set `true` to skip sending transactions |
| `POLYGON_API_KEY` | — | Polygon.io API key |
| `FMP_API_KEY` | — | Financial Modeling Prep API key |
| `MARKETS_TO_SETTLE` | — | JSON array of `{marketId, ticker, expiryDate}` objects |
