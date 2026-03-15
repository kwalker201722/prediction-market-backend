import { Router, Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth';
import {
  createCheckoutSession,
  handleWebhook,
  getDeposit,
  createWithdrawal,
  getWithdrawal,
} from '../services/paymentService';

const router = Router();

// POST /payments/create-checkout-session
router.post(
  '/create-checkout-session',
  authenticateToken,
  [
    body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least 1 USD'),
    body('wallet_address').isEthereumAddress(),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { amount, wallet_address } = req.body as {
        amount: number;
        wallet_address: string;
      };

      const session = await createCheckoutSession(
        amount,
        wallet_address,
        req.user!.userId
      );
      res.json(session);
    } catch (err) {
      next(err);
    }
  }
);

// POST /payments/webhook  (raw body required for signature verification)
router.post(
  '/webhook',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }

      await handleWebhook(req.body as Buffer, signature);
      res.json({ received: true });
    } catch (err) {
      next(err);
    }
  }
);

// GET /payments/deposits/:id
router.get(
  '/deposits/:id',
  authenticateToken,
  param('id').isUUID(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const deposit = await getDeposit(req.params.id);
      if (!deposit) {
        res.status(404).json({ error: 'Deposit not found' });
        return;
      }

      if (deposit.user_id !== req.user!.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.json({
        id: deposit.id,
        status: deposit.status,
        tx_hash: deposit.tx_hash,
        amount_usd: deposit.amount_usd,
        amount_eth: deposit.amount_eth,
        created_at: deposit.created_at,
        completed_at: deposit.completed_at,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /payments/withdrawals
router.post(
  '/withdrawals',
  authenticateToken,
  [
    body('amount').isFloat({ min: 0.0001 }).withMessage('Minimum withdrawal is 0.0001 ETH'),
    body('wallet_address').isEthereumAddress(),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { amount, wallet_address } = req.body as {
        amount: number;
        wallet_address: string;
      };

      const withdrawal = await createWithdrawal(
        req.user!.userId,
        wallet_address,
        amount
      );
      res.status(201).json(withdrawal);
    } catch (err) {
      next(err);
    }
  }
);

// GET /payments/withdrawals/:id
router.get(
  '/withdrawals/:id',
  authenticateToken,
  param('id').isUUID(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const withdrawal = await getWithdrawal(req.params.id);
      if (!withdrawal) {
        res.status(404).json({ error: 'Withdrawal not found' });
        return;
      }

      if (withdrawal.user_id !== req.user!.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.json({
        id: withdrawal.id,
        status: withdrawal.status,
        tx_hash: withdrawal.tx_hash,
        amount_eth: withdrawal.amount_eth,
        wallet_address: withdrawal.wallet_address,
        created_at: withdrawal.created_at,
        completed_at: withdrawal.completed_at,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
