import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import stripe from '../config/stripe';
import { Deposit, Withdrawal } from '../types';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

export const createCheckoutSession = async (
  amountUsd: number,
  walletAddress: string,
  userId: string
): Promise<{ url: string; sessionId: string }> => {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: 'ETH Deposit', description: `Deposit to wallet ${walletAddress}` },
          unit_amount: Math.round(amountUsd * 100),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${APP_URL}/deposit/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/deposit/cancel`,
    metadata: { userId, walletAddress, amountUsd: String(amountUsd) },
  });

  const depositId = uuidv4();
  await pool.query(
    `INSERT INTO deposits (id, user_id, wallet_address, amount_usd, stripe_session_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [depositId, userId, walletAddress.toLowerCase(), amountUsd, session.id]
  );

  return { url: session.url as string, sessionId: session.id };
};

export const handleWebhook = async (
  rawBody: Buffer,
  signature: string
): Promise<void> => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as { id: string };
    await pool.query(
      `UPDATE deposits
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE stripe_session_id = $1`,
      [session.id]
    );

    // Record transaction
    const depositResult = await pool.query<Deposit>(
      'SELECT * FROM deposits WHERE stripe_session_id = $1',
      [session.id]
    );
    if (depositResult.rows[0]) {
      const deposit = depositResult.rows[0];
      await pool.query(
        `INSERT INTO transactions (id, user_id, type, total_value, status)
         VALUES ($1, $2, 'deposit', $3, 'completed')`,
        [uuidv4(), deposit.user_id, deposit.amount_usd]
      );
    }
  }
};

export const getDeposit = async (id: string): Promise<Deposit | null> => {
  const result = await pool.query<Deposit>(
    'SELECT * FROM deposits WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

export const createWithdrawal = async (
  userId: string,
  walletAddress: string,
  amountEth: number
): Promise<Withdrawal> => {
  const id = uuidv4();
  const result = await pool.query<Withdrawal>(
    `INSERT INTO withdrawals (id, user_id, wallet_address, amount_eth)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, userId, walletAddress.toLowerCase(), amountEth]
  );

  // Record transaction
  await pool.query(
    `INSERT INTO transactions (id, user_id, type, total_value, status)
     VALUES ($1, $2, 'withdrawal', $3, 'pending')`,
    [uuidv4(), userId, amountEth]
  );

  return result.rows[0];
};

export const getWithdrawal = async (id: string): Promise<Withdrawal | null> => {
  const result = await pool.query<Withdrawal>(
    'SELECT * FROM withdrawals WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

export const getTransfers = async (
  userId: string,
  page = 1,
  limit = 20
): Promise<{ transfers: unknown[]; total: number }> => {
  const offset = (page - 1) * limit;
  const [txResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, type, total_value AS amount, tx_hash, status, created_at AS date
       FROM transactions
       WHERE user_id = $1 AND type IN ('deposit', 'withdrawal', 'transfer')
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) FROM transactions
       WHERE user_id = $1 AND type IN ('deposit', 'withdrawal', 'transfer')`,
      [userId]
    ),
  ]);
  return {
    transfers: txResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
};

export const getBalanceSummary = async (
  userId: string
): Promise<{
  total: number;
  locked: number;
  available: number;
  pending: number;
}> => {
  const [depositsResult, withdrawalsPendingResult, latestBalanceResult] =
    await Promise.all([
      pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_eth), 0) AS total
         FROM deposits WHERE user_id = $1 AND status = 'completed'`,
        [userId]
      ),
      pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_eth), 0) AS total
         FROM withdrawals WHERE user_id = $1 AND status = 'pending'`,
        [userId]
      ),
      pool.query(
        `SELECT balance FROM balance_history
         WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
        [userId]
      ),
    ]);

  const total = parseFloat(
    latestBalanceResult.rows[0]?.balance ||
      depositsResult.rows[0]?.total ||
      '0'
  );
  const pending = parseFloat(withdrawalsPendingResult.rows[0]?.total || '0');
  const locked = 0; // extend for trading locks
  const available = Math.max(0, total - pending - locked);

  return { total, locked, available, pending };
};
