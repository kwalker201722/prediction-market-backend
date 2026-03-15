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
