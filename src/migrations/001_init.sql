-- Migration: 001_init.sql
-- Prediction Market Database Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  preferred_language VARCHAR(10) DEFAULT 'en',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Wallets table (link multiple wallets per user)
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) UNIQUE NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Deposits table
CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) NOT NULL,
  amount_usd DECIMAL(18, 2) NOT NULL,
  amount_eth DECIMAL(18, 8),
  status VARCHAR(50) DEFAULT 'pending',
  stripe_session_id VARCHAR(255),
  tx_hash VARCHAR(66),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Withdrawals table
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) NOT NULL,
  amount_eth DECIMAL(18, 8) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  tx_hash VARCHAR(66),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Transactions table (all activity)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  ticker VARCHAR(20),
  shares DECIMAL(18, 8),
  price DECIMAL(18, 8),
  total_value DECIMAL(18, 8),
  tx_hash VARCHAR(66),
  status VARCHAR(50) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Balance history (for chart)
CREATE TABLE IF NOT EXISTS balance_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  balance DECIMAL(18, 8) NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_user_id ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_stripe_session ON deposits(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_balance_history_user_id ON balance_history(user_id);
