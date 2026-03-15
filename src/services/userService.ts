import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { User, Wallet, JwtPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_production';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable must be set in production');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const SALT_ROUNDS = 12;

export const generateToken = (payload: JwtPayload): string =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });

export const createUser = async (
  email: string,
  password: string
): Promise<User> => {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const id = uuidv4();
  const result = await pool.query<User>(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email, preferred_language, created_at, updated_at`,
    [id, email.toLowerCase(), passwordHash]
  );
  return result.rows[0];
};

export const findUserByEmail = async (email: string): Promise<User | null> => {
  const result = await pool.query<User>(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  return result.rows[0] || null;
};

export const findUserById = async (id: string): Promise<User | null> => {
  const result = await pool.query<User>(
    'SELECT id, email, preferred_language, created_at, updated_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

export const verifyPassword = async (
  password: string,
  hash: string
): Promise<boolean> => bcrypt.compare(password, hash);

export const updateUser = async (
  id: string,
  fields: Partial<Pick<User, 'email' | 'preferred_language'>>
): Promise<User | null> => {
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.email !== undefined) {
    updates.push(`email = $${idx++}`);
    values.push(fields.email.toLowerCase());
  }
  if (fields.preferred_language !== undefined) {
    updates.push(`preferred_language = $${idx++}`);
    values.push(fields.preferred_language);
  }

  if (updates.length === 0) return findUserById(id);

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await pool.query<User>(
    `UPDATE users SET ${updates.join(', ')}
     WHERE id = $${idx}
     RETURNING id, email, preferred_language, created_at, updated_at`,
    values
  );
  return result.rows[0] || null;
};

export const getUserWallets = async (userId: string): Promise<Wallet[]> => {
  const result = await pool.query<Wallet>(
    'SELECT * FROM wallets WHERE user_id = $1 ORDER BY is_primary DESC, created_at ASC',
    [userId]
  );
  return result.rows;
};

export const linkWallet = async (
  userId: string,
  walletAddress: string,
  isPrimary = false,
  verified = false
): Promise<Wallet> => {
  const id = uuidv4();
  const result = await pool.query<Wallet>(
    `INSERT INTO wallets (id, user_id, wallet_address, is_primary, verified)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wallet_address) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           is_primary = EXCLUDED.is_primary,
           verified = EXCLUDED.verified
     RETURNING *`,
    [id, userId, walletAddress.toLowerCase(), isPrimary, verified]
  );
  return result.rows[0];
};

export const getBalanceHistory = async (
  userId: string,
  limit = 30
): Promise<Array<{ date: string; balance: number }>> => {
  const result = await pool.query(
    `SELECT recorded_at AS date, balance
     FROM balance_history
     WHERE user_id = $1
     ORDER BY recorded_at ASC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
};

export const getTransactions = async (
  userId: string,
  page = 1,
  limit = 20
): Promise<{ transactions: unknown[]; total: number }> => {
  const offset = (page - 1) * limit;
  const [txResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, type, ticker, shares, price, total_value, tx_hash, status, created_at
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query('SELECT COUNT(*) FROM transactions WHERE user_id = $1', [
      userId,
    ]),
  ]);
  return {
    transactions: txResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
};
