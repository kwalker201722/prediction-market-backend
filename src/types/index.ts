export interface User {
  id: string;
  email: string;
  password_hash?: string;
  preferred_language: string;
  created_at: Date;
  updated_at: Date;
}

export interface Wallet {
  id: string;
  user_id: string;
  wallet_address: string;
  is_primary: boolean;
  verified: boolean;
  created_at: Date;
}

export interface Deposit {
  id: string;
  user_id: string;
  wallet_address: string;
  amount_usd: number;
  amount_eth?: number;
  status: 'pending' | 'completed' | 'failed';
  stripe_session_id?: string;
  tx_hash?: string;
  created_at: Date;
  completed_at?: Date;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  wallet_address: string;
  amount_eth: number;
  status: 'pending' | 'completed' | 'failed';
  tx_hash?: string;
  created_at: Date;
  completed_at?: Date;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal' | 'trade' | 'transfer';
  ticker?: string;
  shares?: number;
  price?: number;
  total_value?: number;
  tx_hash?: string;
  status: string;
  created_at: Date;
}

export interface BalanceHistory {
  id: string;
  user_id: string;
  balance: number;
  recorded_at: Date;
}

export interface Holding {
  ticker: string;
  shares: number;
  value: number;
  lastPrice: number;
}

// ---------------------------------------------------------------------------
// Oracle / Settlement
// ---------------------------------------------------------------------------

export interface MarketConfig {
  /** On-chain market identifier */
  marketId: string;
  /** Ticker symbol (e.g. "AAPL", "BTC", "SPY") */
  ticker: string;
  /** ISO date of market expiry/close (YYYY-MM-DD) */
  expiryDate: string;
}

export type MarketStatus = 'pending' | 'queued' | 'settled' | 'disputed' | 'failed';

export interface MarketSettlement extends MarketConfig {
  status: MarketStatus;
  queuedAt?: string;
  settledAt?: string;
  disputedAt?: string;
  txHash?: string;
  failureReason?: string;
  disputeReason?: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Express.Request {
  user?: JwtPayload;
}

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
