import { Router, Request, Response, NextFunction } from 'express';
import { query, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth';
import { getBalanceSummary, getTransfers } from '../services/paymentService';
import pool from '../config/database';

const router = Router();

// GET /profile/support
router.get('/support', (_req: Request, res: Response): void => {
  res.json({
    faqs: [
      { q: 'How do I deposit funds?', a: 'Go to Deposit section and follow the Stripe checkout flow.' },
      { q: 'How do I connect my MetaMask wallet?', a: 'Click Connect Wallet and sign the message in MetaMask.' },
      { q: 'How long do withdrawals take?', a: 'Withdrawals typically process within 5-10 minutes on Sepolia testnet.' },
    ],
    contact: {
      email: 'support@predictionmarket.app',
      discord: 'https://discord.gg/predictionmarket',
    },
  });
});

// GET /profile/balances
router.get(
  '/balances',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const summary = await getBalanceSummary(req.user!.userId);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  }
);

// GET /profile/transfers
router.get(
  '/transfers',
  authenticateToken,
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const result = await getTransfers(req.user!.userId, page, limit);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /profile/rewards
router.get(
  '/rewards',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await pool.query(
        `SELECT id, type, total_value AS amount, created_at AS date
         FROM transactions
         WHERE user_id = $1 AND type = 'reward'
         ORDER BY created_at DESC`,
        [req.user!.userId]
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  }
);

// GET /profile/history
router.get(
  '/history',
  authenticateToken,
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('sort').optional().isIn(['created_at', 'type', 'total_value']),
  query('order').optional().isIn(['ASC', 'DESC']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const offset = (page - 1) * limit;

      // Use whitelist map to prevent SQL injection via column/direction interpolation
      const sortMap: Record<string, string> = {
        created_at: 'created_at',
        type: 'type',
        total_value: 'total_value',
      };
      const orderMap: Record<string, string> = { ASC: 'ASC', DESC: 'DESC' };
      const sort = sortMap[(req.query.sort as string) || ''] || 'created_at';
      const order = orderMap[(req.query.order as string) || ''] || 'DESC';

      const [txResult, countResult] = await Promise.all([
        pool.query(
          `SELECT * FROM transactions
           WHERE user_id = $1
           ORDER BY ${sort} ${order}
           LIMIT $2 OFFSET $3`,
          [req.user!.userId, limit, offset]
        ),
        pool.query(
          'SELECT COUNT(*) FROM transactions WHERE user_id = $1',
          [req.user!.userId]
        ),
      ]);

      res.json({
        history: txResult.rows,
        total: parseInt(countResult.rows[0].count, 10),
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /profile/statements
router.get(
  '/statements',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const [depositsResult, withdrawalsResult, tradesResult] = await Promise.all([
        pool.query(
          `SELECT id, amount_usd, amount_eth, status, created_at, completed_at
           FROM deposits WHERE user_id = $1 ORDER BY created_at DESC`,
          [userId]
        ),
        pool.query(
          `SELECT id, amount_eth, status, tx_hash, created_at, completed_at
           FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC`,
          [userId]
        ),
        pool.query(
          `SELECT id, ticker, shares, price, total_value, tx_hash, created_at
           FROM transactions WHERE user_id = $1 AND type = 'trade' ORDER BY created_at DESC`,
          [userId]
        ),
      ]);

      res.json({
        generated_at: new Date().toISOString(),
        deposits: depositsResult.rows,
        withdrawals: withdrawalsResult.rows,
        trades: tradesResult.rows,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /profile/tax
router.get(
  '/tax',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await pool.query(
        `SELECT id, type, ticker, shares, price, total_value, tx_hash, created_at
         FROM transactions
         WHERE user_id = $1 AND type IN ('trade', 'deposit', 'withdrawal')
         ORDER BY created_at ASC`,
        [req.user!.userId]
      );
      res.json({
        tax_year: new Date().getFullYear(),
        transactions: result.rows,
        disclaimer: 'This data is provided for informational purposes only. Consult a tax professional.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /profile/security
router.get(
  '/security',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const walletsResult = await pool.query(
        `SELECT wallet_address, verified, created_at FROM wallets WHERE user_id = $1`,
        [req.user!.userId]
      );
      res.json({
        two_factor_enabled: false,
        linked_wallets: walletsResult.rows,
        login_history: [],
        options: {
          enable_2fa: '/profile/security/2fa/enable',
          change_password: '/auth/change-password',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /profile/privacy
router.get(
  '/privacy',
  authenticateToken,
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({
        data_retention_days: 365,
        share_analytics: false,
        marketing_emails: false,
        options: {
          delete_account: 'Contact support@predictionmarket.app',
          export_data: '/profile/statements',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
