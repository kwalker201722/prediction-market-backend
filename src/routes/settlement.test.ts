/**
 * Tests for src/routes/settlement.ts
 *
 * Validates Step 3 (Admin UI / Manual Settlement) and Step 4 (Dispute/Challenge)
 * of the DIY Oracle & Settlement System.
 *
 * All tests use a real in-memory settlementStore (no DB or external services
 * needed) and a JWT generated with the development fallback secret.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../index';
import { settlementStore, clearSettlementStore } from './settlement';

// ---------------------------------------------------------------------------
// Mocks (same pattern as src/index.test.ts)
// ---------------------------------------------------------------------------

jest.mock('../config/database', () => ({
  default: { query: jest.fn(), on: jest.fn() },
}));

jest.mock('../config/blockchain', () => ({
  provider: {
    getBalance: jest.fn().mockResolvedValue(BigInt('1000000000000000000')),
  },
  getContract: jest.fn().mockReturnValue({
    getHoldings: jest.fn().mockResolvedValue([]),
  }),
  getSignerContract: jest.fn(),
  CONTRACT_ADDRESS: '0xE88582edFEc4CFb3B1A3ABa5A79c55B8C1d770fc',
}));

jest.mock('../config/stripe', () => ({
  default: {
    checkout: { sessions: { create: jest.fn() } },
    webhooks: { constructEvent: jest.fn() },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** JWT generated with the middleware's fallback secret – valid in all tests. */
const JWT_SECRET = 'fallback_secret_change_in_production';
const AUTH_TOKEN = jwt.sign(
  { userId: 'admin-user-id', email: 'admin@example.com' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const authHeader = () => ({ Authorization: `Bearer ${AUTH_TOKEN}` });

// Reset store between tests so state doesn't bleed across suites
beforeEach(() => clearSettlementStore());

// ---------------------------------------------------------------------------
// Auth guard: all routes require a valid JWT
// ---------------------------------------------------------------------------

describe('Settlement Routes – auth guard', () => {
  it('GET /settlement/pending returns 401 without token', async () => {
    const res = await request(app).get('/settlement/pending');
    expect(res.status).toBe(401);
  });

  it('GET /settlement/status/1 returns 401 without token', async () => {
    const res = await request(app).get('/settlement/status/1');
    expect(res.status).toBe(401);
  });

  it('POST /settlement/resolve returns 401 without token', async () => {
    const res = await request(app).post('/settlement/resolve').send({
      marketId: '1',
      ticker: 'AAPL',
      expiryDate: '2024-01-19',
    });
    expect(res.status).toBe(401);
  });

  it('POST /settlement/dispute returns 401 without token', async () => {
    const res = await request(app).post('/settlement/dispute').send({
      marketId: '1',
      reason: 'Price was wrong',
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /settlement/pending
// ---------------------------------------------------------------------------

describe('GET /settlement/pending', () => {
  it('returns an empty list when no markets exist', async () => {
    const res = await request(app)
      .get('/settlement/pending')
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.markets).toEqual([]);
  });

  it('seeds from MARKETS_TO_SETTLE env var on first request', async () => {
    process.env.MARKETS_TO_SETTLE = JSON.stringify([
      { marketId: '10', ticker: 'AAPL', expiryDate: '2024-01-19' },
      { marketId: '11', ticker: 'BTC', expiryDate: '2024-02-01' },
    ]);

    const res = await request(app)
      .get('/settlement/pending')
      .set(authHeader());

    delete process.env.MARKETS_TO_SETTLE;

    expect(res.status).toBe(200);
    expect(res.body.markets).toHaveLength(2);
    expect(res.body.markets[0].ticker).toBe('AAPL');
    expect(res.body.markets[1].ticker).toBe('BTC');
  });

  it('returns only pending and queued markets', async () => {
    settlementStore.set('1', {
      marketId: '1',
      ticker: 'AAPL',
      expiryDate: '2024-01-19',
      status: 'pending',
    });
    settlementStore.set('2', {
      marketId: '2',
      ticker: 'BTC',
      expiryDate: '2024-02-01',
      status: 'queued',
    });
    settlementStore.set('3', {
      marketId: '3',
      ticker: 'ETH',
      expiryDate: '2024-03-01',
      status: 'settled',
    });
    settlementStore.set('4', {
      marketId: '4',
      ticker: 'SPY',
      expiryDate: '2024-04-01',
      status: 'disputed',
    });

    const res = await request(app)
      .get('/settlement/pending')
      .set(authHeader());
    expect(res.status).toBe(200);
    const ids = res.body.markets.map((m: { marketId: string }) => m.marketId);
    expect(ids).toContain('1');
    expect(ids).toContain('2');
    expect(ids).not.toContain('3');
    expect(ids).not.toContain('4');
  });
});

// ---------------------------------------------------------------------------
// GET /settlement/status/:marketId
// ---------------------------------------------------------------------------

describe('GET /settlement/status/:marketId', () => {
  it('returns 404 for unknown market', async () => {
    const res = await request(app)
      .get('/settlement/status/999')
      .set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/999/);
  });

  it('returns the full settlement record', async () => {
    settlementStore.set('5', {
      marketId: '5',
      ticker: 'TSLA',
      expiryDate: '2024-06-01',
      status: 'queued',
      queuedAt: '2024-05-31T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/settlement/status/5')
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.marketId).toBe('5');
    expect(res.body.ticker).toBe('TSLA');
    expect(res.body.status).toBe('queued');
    expect(res.body.queuedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /settlement/resolve
// ---------------------------------------------------------------------------

describe('POST /settlement/resolve', () => {
  it('returns 400 for missing marketId', async () => {
    const res = await request(app)
      .post('/settlement/resolve')
      .set(authHeader())
      .send({ ticker: 'AAPL', expiryDate: '2024-01-19' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing ticker', async () => {
    const res = await request(app)
      .post('/settlement/resolve')
      .set(authHeader())
      .send({ marketId: '1', expiryDate: '2024-01-19' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid expiryDate format', async () => {
    const res = await request(app)
      .post('/settlement/resolve')
      .set(authHeader())
      .send({ marketId: '1', ticker: 'AAPL', expiryDate: 'January 19 2024' });
    expect(res.status).toBe(400);
  });

  it('queues a new market and returns 202', async () => {
    const res = await request(app)
      .post('/settlement/resolve')
      .set(authHeader())
      .send({ marketId: '20', ticker: 'MSFT', expiryDate: '2024-07-15' });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.market.marketId).toBe('20');
    expect(res.body.market.status).toBe('queued');
    expect(res.body.market.queuedAt).toBeDefined();

    // Verify store was updated
    expect(settlementStore.get('20')?.status).toBe('queued');
  });

  it('returns 409 when market is already settled', async () => {
    settlementStore.set('21', {
      marketId: '21',
      ticker: 'AAPL',
      expiryDate: '2024-01-19',
      status: 'settled',
    });

    const res = await request(app)
      .post('/settlement/resolve')
      .set(authHeader())
      .send({ marketId: '21', ticker: 'AAPL', expiryDate: '2024-01-19' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/settled/);
  });

  it('returns 409 when market is already disputed', async () => {
    settlementStore.set('22', {
      marketId: '22',
      ticker: 'BTC',
      expiryDate: '2024-02-01',
      status: 'disputed',
    });

    const res = await request(app)
      .post('/settlement/resolve')
      .set(authHeader())
      .send({ marketId: '22', ticker: 'BTC', expiryDate: '2024-02-01' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/disputed/);
  });

  it('allows re-queueing a failed market', async () => {
    settlementStore.set('23', {
      marketId: '23',
      ticker: 'ETH',
      expiryDate: '2024-03-01',
      status: 'failed',
      failureReason: 'All providers failed',
    });

    const res = await request(app)
      .post('/settlement/resolve')
      .set(authHeader())
      .send({ marketId: '23', ticker: 'ETH', expiryDate: '2024-03-01' });
    expect(res.status).toBe(202);
    expect(res.body.market.status).toBe('queued');
  });
});

// ---------------------------------------------------------------------------
// POST /settlement/settle/:marketId (oracle-bot callback)
// ---------------------------------------------------------------------------

describe('POST /settlement/settle/:marketId', () => {
  it('returns 404 for unknown market', async () => {
    const res = await request(app)
      .post('/settlement/settle/999')
      .set(authHeader())
      .send({});
    expect(res.status).toBe(404);
  });

  it('returns 409 when market is not in queued state', async () => {
    settlementStore.set('30', {
      marketId: '30',
      ticker: 'AAPL',
      expiryDate: '2024-01-19',
      status: 'pending',
    });

    const res = await request(app)
      .post('/settlement/settle/30')
      .set(authHeader())
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/queued/);
  });

  it('transitions queued → settled and stores txHash', async () => {
    settlementStore.set('31', {
      marketId: '31',
      ticker: 'AAPL',
      expiryDate: '2024-01-19',
      status: 'queued',
    });

    const res = await request(app)
      .post('/settlement/settle/31')
      .set(authHeader())
      .send({ txHash: '0xdeadbeef' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.market.status).toBe('settled');
    expect(res.body.market.txHash).toBe('0xdeadbeef');
    expect(res.body.market.settledAt).toBeDefined();

    expect(settlementStore.get('31')?.status).toBe('settled');
    expect(settlementStore.get('31')?.txHash).toBe('0xdeadbeef');
  });

  it('transitions queued → settled without txHash', async () => {
    settlementStore.set('32', {
      marketId: '32',
      ticker: 'SPY',
      expiryDate: '2024-05-01',
      status: 'queued',
    });

    const res = await request(app)
      .post('/settlement/settle/32')
      .set(authHeader())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.market.status).toBe('settled');
    expect(res.body.market.txHash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /settlement/dispute  (Step 4 – Challenge/Dispute Window)
// ---------------------------------------------------------------------------

describe('POST /settlement/dispute', () => {
  it('returns 400 for missing marketId', async () => {
    const res = await request(app)
      .post('/settlement/dispute')
      .set(authHeader())
      .send({ reason: 'Price mismatch' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing reason', async () => {
    const res = await request(app)
      .post('/settlement/dispute')
      .set(authHeader())
      .send({ marketId: '40' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when market does not exist', async () => {
    const res = await request(app)
      .post('/settlement/dispute')
      .set(authHeader())
      .send({ marketId: '999', reason: 'Bad price' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/999/);
  });

  it('returns 409 when market is not settled', async () => {
    settlementStore.set('41', {
      marketId: '41',
      ticker: 'AAPL',
      expiryDate: '2024-01-19',
      status: 'queued',
    });

    const res = await request(app)
      .post('/settlement/dispute')
      .set(authHeader())
      .send({ marketId: '41', reason: 'Attempted dispute on queued market' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/settled/);
  });

  it('transitions settled → disputed and stores the reason', async () => {
    settlementStore.set('42', {
      marketId: '42',
      ticker: 'BTC',
      expiryDate: '2024-06-01',
      status: 'settled',
      settledAt: '2024-06-01T12:00:00.000Z',
      txHash: '0xabc123',
    });

    const res = await request(app)
      .post('/settlement/dispute')
      .set(authHeader())
      .send({ marketId: '42', reason: 'Polygon price was stale – should be $65000' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.market.status).toBe('disputed');
    expect(res.body.market.disputeReason).toBe(
      'Polygon price was stale – should be $65000'
    );
    expect(res.body.market.disputedAt).toBeDefined();

    // Original fields preserved
    expect(res.body.market.txHash).toBe('0xabc123');
    expect(res.body.market.settledAt).toBe('2024-06-01T12:00:00.000Z');

    // Store reflects new state
    expect(settlementStore.get('42')?.status).toBe('disputed');
  });

  it('prevents double-dispute on an already disputed market', async () => {
    settlementStore.set('43', {
      marketId: '43',
      ticker: 'ETH',
      expiryDate: '2024-07-01',
      status: 'disputed',
      disputeReason: 'First dispute',
    });

    const res = await request(app)
      .post('/settlement/dispute')
      .set(authHeader())
      .send({ marketId: '43', reason: 'Second dispute attempt' });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Full workflow: pending → queued → settled → disputed
// ---------------------------------------------------------------------------

describe('Full settlement workflow (Steps 1-4 integration)', () => {
  const MARKET = { marketId: '100', ticker: 'NVDA', expiryDate: '2024-12-31' };

  it('complete state machine: pending → queued → settled → disputed', async () => {
    // Step 1: seed a pending market
    settlementStore.set(MARKET.marketId, { ...MARKET, status: 'pending' });

    // Step 2 (Admin UI): admin queues it for settlement
    let res = await request(app)
      .post('/settlement/resolve')
      .set(authHeader())
      .send(MARKET);
    expect(res.status).toBe(202);
    expect(res.body.market.status).toBe('queued');

    // Verify pending list shows it
    res = await request(app).get('/settlement/pending').set(authHeader());
    const ids = res.body.markets.map((m: { marketId: string }) => m.marketId);
    expect(ids).toContain(MARKET.marketId);

    // Step 3 (Oracle bot callback): mark as settled
    res = await request(app)
      .post(`/settlement/settle/${MARKET.marketId}`)
      .set(authHeader())
      .send({ txHash: '0xfeedcafe' });
    expect(res.status).toBe(200);
    expect(res.body.market.status).toBe('settled');

    // Market no longer in pending list
    res = await request(app).get('/settlement/pending').set(authHeader());
    const pendingIds = res.body.markets.map((m: { marketId: string }) => m.marketId);
    expect(pendingIds).not.toContain(MARKET.marketId);

    // Step 4 (Dispute): open challenge window
    res = await request(app)
      .post('/settlement/dispute')
      .set(authHeader())
      .send({ marketId: MARKET.marketId, reason: 'Price was $490 not $510' });
    expect(res.status).toBe(200);
    expect(res.body.market.status).toBe('disputed');

    // Final status check
    res = await request(app)
      .get(`/settlement/status/${MARKET.marketId}`)
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disputed');
    expect(res.body.txHash).toBe('0xfeedcafe');
    expect(res.body.disputeReason).toBe('Price was $490 not $510');
  });
});
