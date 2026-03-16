/**
 * Settlement Admin API
 *
 * Provides HTTP endpoints for the Admin UI (Step 3) to:
 *   - List markets pending settlement
 *   - Queue / manually trigger settlement for a specific market
 *   - Query the current settlement status of any market
 *   - Open a dispute window on an already-settled market (Step 4)
 *
 * The oracle-bot (oracle-bot/settlement-bot.ts) is the execution engine that
 * reads markets queued here, fetches prices, signs and submits to the contract.
 * In production, replace the in-memory `settlementStore` with a DB-backed table.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth';
import { MarketConfig, MarketSettlement, MarketStatus } from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// In-memory settlement store
// In production, replace with DB queries (PostgreSQL settlements table).
// Exported so tests can inspect / reset state.
// ---------------------------------------------------------------------------

export const settlementStore = new Map<string, MarketSettlement>();

/** Reset the store – intended for use in tests only. */
export function clearSettlementStore(): void {
  settlementStore.clear();
}

// ---------------------------------------------------------------------------
// GET /settlement/pending
// Returns all known markets whose status is 'pending' or 'queued'.
// ---------------------------------------------------------------------------

router.get(
  '/pending',
  authenticateToken,
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Seed from MARKETS_TO_SETTLE env var if the store is empty
      if (settlementStore.size === 0) {
        const raw = process.env.MARKETS_TO_SETTLE;
        if (raw) {
          try {
            const markets = JSON.parse(raw) as MarketConfig[];
            for (const m of markets) {
              if (!settlementStore.has(m.marketId)) {
                settlementStore.set(m.marketId, { ...m, status: 'pending' });
              }
            }
          } catch {
            // ignore malformed env var
          }
        }
      }

      const pending: MarketSettlement[] = [];
      for (const entry of settlementStore.values()) {
        if (entry.status === 'pending' || entry.status === 'queued') {
          pending.push(entry);
        }
      }
      res.json({ markets: pending });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /settlement/status/:marketId
// Returns the full settlement record for a single market.
// ---------------------------------------------------------------------------

router.get(
  '/status/:marketId',
  authenticateToken,
  param('marketId').isString().notEmpty(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const record = settlementStore.get(req.params.marketId);
      if (!record) {
        res.status(404).json({ error: `Market ${req.params.marketId} not found` });
        return;
      }
      res.json(record);
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /settlement/resolve
// Admin queues a market for settlement. The oracle-bot will pick it up on its
// next run. If the market is already settled or disputed the request is rejected.
// ---------------------------------------------------------------------------

router.post(
  '/resolve',
  authenticateToken,
  [
    body('marketId').isString().notEmpty(),
    body('ticker').isString().notEmpty(),
    body('expiryDate')
      .isString()
      .notEmpty()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('expiryDate must be YYYY-MM-DD'),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { marketId, ticker, expiryDate } = req.body as {
        marketId: string;
        ticker: string;
        expiryDate: string;
      };

      const existing = settlementStore.get(marketId);
      if (existing) {
        const terminal: MarketStatus[] = ['settled', 'disputed'];
        if (terminal.includes(existing.status)) {
          res.status(409).json({
            error: `Market ${marketId} is already in terminal state: ${existing.status}`,
          });
          return;
        }
      }

      const record: MarketSettlement = {
        marketId,
        ticker,
        expiryDate,
        status: 'queued',
        queuedAt: new Date().toISOString(),
      };
      settlementStore.set(marketId, record);

      res.status(202).json({ success: true, market: record });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /settlement/settle/:marketId
// Mark a queued market as settled (called by the oracle-bot after on-chain TX).
// ---------------------------------------------------------------------------

router.post(
  '/settle/:marketId',
  authenticateToken,
  param('marketId').isString().notEmpty(),
  [body('txHash').optional().isString()],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const record = settlementStore.get(req.params.marketId);
      if (!record) {
        res.status(404).json({
          error: `Market ${req.params.marketId} not found`,
        });
        return;
      }

      if (record.status !== 'queued') {
        res.status(409).json({
          error: `Market ${req.params.marketId} is not in queued state (current: ${record.status})`,
        });
        return;
      }

      const { txHash } = req.body as { txHash?: string };
      const updated: MarketSettlement = {
        ...record,
        status: 'settled',
        settledAt: new Date().toISOString(),
        ...(txHash ? { txHash } : {}),
      };
      settlementStore.set(req.params.marketId, updated);
      res.json({ success: true, market: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /settlement/dispute
// Opens a dispute window on a settled market (Step 4).
// ---------------------------------------------------------------------------

router.post(
  '/dispute',
  authenticateToken,
  [
    body('marketId').isString().notEmpty(),
    body('reason').isString().notEmpty().withMessage('Dispute reason is required'),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { marketId, reason } = req.body as {
        marketId: string;
        reason: string;
      };

      const record = settlementStore.get(marketId);
      if (!record) {
        res.status(404).json({ error: `Market ${marketId} not found` });
        return;
      }

      if (record.status !== 'settled') {
        res.status(409).json({
          error: `Market ${marketId} must be in 'settled' state to dispute (current: ${record.status})`,
        });
        return;
      }

      const updated: MarketSettlement = {
        ...record,
        status: 'disputed',
        disputedAt: new Date().toISOString(),
        disputeReason: reason,
      };
      settlementStore.set(marketId, updated);
      res.json({ success: true, market: updated });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
