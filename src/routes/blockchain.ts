import { Router, Request, Response, NextFunction } from 'express';
import { param, body, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth';
import {
  getHoldings,
  getEthBalance,
  executeTrade,
} from '../services/blockchainService';

const router = Router();

// GET /blockchain/holdings/:wallet_address
router.get(
  '/holdings/:wallet_address',
  authenticateToken,
  param('wallet_address').isEthereumAddress(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const holdings = await getHoldings(req.params.wallet_address);
      res.json(holdings);
    } catch (err) {
      next(err);
    }
  }
);

// GET /blockchain/balance/:wallet_address
router.get(
  '/balance/:wallet_address',
  authenticateToken,
  param('wallet_address').isEthereumAddress(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const balance = await getEthBalance(req.params.wallet_address);
      res.json(balance);
    } catch (err) {
      next(err);
    }
  }
);

// POST /blockchain/execute-trade
router.post(
  '/execute-trade',
  authenticateToken,
  [
    body('ticker').isString().notEmpty(),
    body('shares').isFloat({ min: 0 }),
    body('price').isFloat({ min: 0 }),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { ticker, shares, price } = req.body as {
        ticker: string;
        shares: number;
        price: number;
      };

      const result = await executeTrade(ticker, shares, price);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
