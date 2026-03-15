import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ethers } from 'ethers';
import rateLimit from 'express-rate-limit';
import {
  createUser,
  findUserById,
  findUserByEmail,
  verifyPassword,
  generateToken,
  linkWallet,
  getUserWallets,
} from '../services/userService';
import { authenticateToken } from '../middleware/auth';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later' },
});

// POST /auth/signup
router.post(
  '/signup',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { email, password } = req.body as { email: string; password: string };
      const existing = await findUserByEmail(email);
      if (existing) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }

      const user = await createUser(email, password);
      const token = generateToken({ userId: user.id, email: user.email });
      res.status(201).json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /auth/login
router.post(
  '/login',
  authLimiter,
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { email, password } = req.body as { email: string; password: string };
      const user = await findUserByEmail(email);
      if (!user || !user.password_hash) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const token = generateToken({ userId: user.id, email: user.email });
      res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /auth/metamask/verify
router.post(
  '/metamask/verify',
  authLimiter,
  [
    body('walletAddress').isEthereumAddress(),
    body('signature').notEmpty(),
    body('message').notEmpty(),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { walletAddress, signature, message } = req.body as {
        walletAddress: string;
        signature: string;
        message: string;
      };

      // Verify the signature
      const recoveredAddress = ethers.verifyMessage(message, signature);
      if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      // Find or create user linked to this wallet
      let user = await findUserByEmail(`${walletAddress.toLowerCase()}@metamask.local`);
      if (!user) {
        user = await createUser(
          `${walletAddress.toLowerCase()}@metamask.local`,
          // Random password for wallet-only users
          ethers.hexlify(ethers.randomBytes(32))
        );
      }

      await linkWallet(user.id, walletAddress, true, true);

      const token = generateToken({ userId: user.id, email: user.email });
      res.json({ token, user: { id: user.id, walletAddress } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /auth/logout  (client-side token discard; server can blacklist if needed)
router.post('/logout', authenticateToken, (_req: Request, res: Response): void => {
  res.json({ message: 'Logged out successfully' });
});

// GET /auth/profile
router.get(
  '/profile',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await findUserById(req.user!.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const wallets = await getUserWallets(user.id);
      res.json({ ...user, wallets });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
