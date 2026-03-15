import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth';
import {
  findUserById,
  updateUser,
  getUserWallets,
  getBalanceHistory,
  getTransactions,
} from '../services/userService';
import { getHoldings } from '../services/blockchainService';

const router = Router();

// GET /users/:id
router.get(
  '/:id',
  authenticateToken,
  param('id').isUUID(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      // Users can only access their own profile
      if (req.params.id !== req.user!.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const user = await findUserById(req.params.id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const wallets = await getUserWallets(req.params.id);
      res.json({ ...user, wallets });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /users/:id
router.put(
  '/:id',
  authenticateToken,
  param('id').isUUID(),
  [body('email').optional().isEmail().normalizeEmail(), body('preferred_language').optional().isLength({ min: 2, max: 10 })],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      if (req.params.id !== req.user!.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const { email, preferred_language } = req.body as {
        email?: string;
        preferred_language?: string;
      };
      const updated = await updateUser(req.params.id, { email, preferred_language });
      if (!updated) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// GET /users/:id/balances
router.get(
  '/:id/balances',
  authenticateToken,
  param('id').isUUID(),
  query('limit').optional().isInt({ min: 1, max: 365 }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      if (req.params.id !== req.user!.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
      const history = await getBalanceHistory(req.params.id, limit);
      res.json(history);
    } catch (err) {
      next(err);
    }
  }
);

// GET /users/:id/holdings
router.get(
  '/:id/holdings',
  authenticateToken,
  param('id').isUUID(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      if (req.params.id !== req.user!.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const wallets = await getUserWallets(req.params.id);
      const primaryWallet = wallets.find((w) => w.is_primary) || wallets[0];

      if (!primaryWallet) {
        res.json([]);
        return;
      }

      const holdings = await getHoldings(primaryWallet.wallet_address);
      res.json(holdings);
    } catch (err) {
      next(err);
    }
  }
);

// GET /users/:id/transactions
router.get(
  '/:id/transactions',
  authenticateToken,
  param('id').isUUID(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      if (req.params.id !== req.user!.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const result = await getTransactions(req.params.id, page, limit);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
