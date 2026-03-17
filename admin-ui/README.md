# Admin UI

Minimal production-ready React admin dashboard for managing prediction market settlements.

Built with **Vite + React**. Connects to the Express backend API and displays pending/queued markets, lets admins approve settlements, and opens disputes.

## Features

- **Login** – authenticates via the backend JWT `/auth/login` endpoint.
- **Market List** – shows all `pending` and `queued` markets from `/settlement/pending`.
- **Settlement Panel** – per-market view with actions:
  - **Queue** – sends `POST /settlement/resolve` to flag a market for bot settlement.
  - **Mark Settled** – sends `POST /settlement/settle/:id` with optional TX hash.
  - **Open Dispute** – sends `POST /settlement/dispute` within the 48-hour window.

## Prerequisites

- Node.js ≥ 18
- Backend API running on port 3000 (or set `VITE_API_URL`)

## Install & Run

```bash
cd admin-ui
npm install

# Development server (with API proxy to localhost:3000)
npm run dev
# Opens http://localhost:3001

# Production build
npm run build
npm run preview
```

## Environment Variables

Copy `.env.example` to `.env` and set as needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:3000` | Backend API base URL |

In development, Vite proxies `/settlement` and `/auth` calls to `VITE_API_URL` automatically.

## Project Structure

```
admin-ui/
├── index.html              # HTML entry point
├── vite.config.js          # Vite config (dev proxy, port)
├── package.json
├── .env.example
└── src/
    ├── main.jsx            # React root mount
    ├── App.jsx             # Root component + login gate
    ├── api.js              # Axios API helpers
    └── components/
        ├── MarketList.jsx      # Pending/queued market table
        └── SettlementPanel.jsx # Per-market settle/dispute panel
```

## Connecting to the Smart Contract

For direct on-chain calls from the browser (optional), install ethers in `admin-ui` and use the `PredictionMarket` ABI from `src/PredictionMarket.sol`. The recommended production flow is to use the backend API + oracle bot for on-chain transactions.

## Extending

- Add a `ContractPanel.jsx` component that calls `resolveMarket()` directly via MetaMask (`ethers.BrowserProvider`).
- Add WebSocket or polling to auto-refresh the market list.
- Integrate with your monitoring stack (Datadog, Sentry) for error tracking.
