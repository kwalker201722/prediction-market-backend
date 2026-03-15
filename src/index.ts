import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import paymentRoutes from './routes/payments';
import blockchainRoutes from './routes/blockchain';
import profileRoutes from './routes/profile';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:3001'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// ── Raw body for Stripe webhook ─────────────────────────────────────────────
app.use(
  '/payments/webhook',
  express.raw({ type: 'application/json' })
);

// ── JSON body parser ────────────────────────────────────────────────────────
app.use(express.json());

// ── Global rate limiting ─────────────────────────────────────────────────────
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/payments', paymentRoutes);
app.use('/blockchain', blockchainRoutes);
app.use('/profile', profileRoutes);

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Prediction Market API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

export default app;
