import request from 'supertest';
import app from './index';

// Mock database pool so tests don't need a real DB
jest.mock('./config/database', () => ({
  default: {
    query: jest.fn(),
    on: jest.fn(),
  },
}));

jest.mock('./config/blockchain', () => ({
  provider: { getBalance: jest.fn().mockResolvedValue(BigInt('1000000000000000000')) },
  getContract: jest.fn().mockReturnValue({ getHoldings: jest.fn().mockResolvedValue([]) }),
  getSignerContract: jest.fn(),
  CONTRACT_ADDRESS: '0xE88582edFEc4CFb3B1A3ABa5A79c55B8C1d770fc',
}));

jest.mock('./config/stripe', () => ({
  default: {
    checkout: {
      sessions: { create: jest.fn() },
    },
    webhooks: { constructEvent: jest.fn() },
  },
}));

describe('Health Check', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('404 Handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/unknown-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});

describe('Auth Routes', () => {
  describe('POST /auth/signup', () => {
    it('returns 400 for invalid email', async () => {
      const res = await request(app).post('/auth/signup').send({
        email: 'not-an-email',
        password: 'password123',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for short password', async () => {
      const res = await request(app).post('/auth/signup').send({
        email: 'test@example.com',
        password: 'short',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('returns 400 for missing fields', async () => {
      const res = await request(app).post('/auth/login').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /auth/profile', () => {
    it('returns 401 without token', async () => {
      const res = await request(app).get('/auth/profile');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('returns 401 without token', async () => {
      const res = await request(app).post('/auth/logout');
      expect(res.status).toBe(401);
    });
  });
});

describe('Profile Routes', () => {
  it('GET /profile/support returns FAQ data', async () => {
    const res = await request(app).get('/profile/support');
    expect(res.status).toBe(200);
    expect(res.body.faqs).toBeDefined();
    expect(Array.isArray(res.body.faqs)).toBe(true);
    expect(res.body.contact).toBeDefined();
  });

  it('GET /profile/balances returns 401 without token', async () => {
    const res = await request(app).get('/profile/balances');
    expect(res.status).toBe(401);
  });

  it('GET /profile/transfers returns 401 without token', async () => {
    const res = await request(app).get('/profile/transfers');
    expect(res.status).toBe(401);
  });
});

describe('Blockchain Routes', () => {
  it('GET /blockchain/holdings/:address returns 401 without token', async () => {
    const res = await request(app).get(
      '/blockchain/holdings/0xE88582edFEc4CFb3B1A3ABa5A79c55B8C1d770fc'
    );
    expect(res.status).toBe(401);
  });

  it('GET /blockchain/balance/:address returns 401 without token', async () => {
    const res = await request(app).get(
      '/blockchain/balance/0xE88582edFEc4CFb3B1A3ABa5A79c55B8C1d770fc'
    );
    expect(res.status).toBe(401);
  });
});

describe('Payment Routes', () => {
  it('POST /payments/create-checkout-session returns 401 without token', async () => {
    const res = await request(app)
      .post('/payments/create-checkout-session')
      .send({ amount: 100, wallet_address: '0xE88582edFEc4CFb3B1A3ABa5A79c55B8C1d770fc' });
    expect(res.status).toBe(401);
  });

  it('POST /payments/withdrawals returns 401 without token', async () => {
    const res = await request(app)
      .post('/payments/withdrawals')
      .send({ amount: 0.01, wallet_address: '0xE88582edFEc4CFb3B1A3ABa5A79c55B8C1d770fc' });
    expect(res.status).toBe(401);
  });
});
