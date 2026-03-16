/**
 * Unit tests for oracle-bot/settlement-bot.ts
 *
 * Covers:
 *  - buildSettlementMessage (pure function)
 *  - signSettlementPayload  (EIP-191 signing via ethers.js)
 *  - submitSettlement       (dry-run path – no network required)
 *  - loadMarketsToSettle    (env-var parsing)
 */

import { ethers } from 'ethers';
import {
  buildSettlementMessage,
  signSettlementPayload,
  submitSettlement,
  loadMarketsToSettle,
  SettlementPayload,
  SignedPayload,
  BotConfig,
} from './settlement-bot';

// Hardhat / Foundry default account #0 – safe to use in tests
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// ---------------------------------------------------------------------------
// buildSettlementMessage
// ---------------------------------------------------------------------------

describe('buildSettlementMessage', () => {
  it('builds a deterministic message string without evidenceHash', () => {
    const payload: SettlementPayload = {
      marketId: '1',
      outcome: 1,
      price: '150.00000000',
    };
    const msg = buildSettlementMessage(payload);
    expect(msg).toBe(
      'Settlement:marketId=1,outcome=1,price=150.00000000,evidenceHash='
    );
  });

  it('includes evidenceHash when provided', () => {
    const payload: SettlementPayload = {
      marketId: '42',
      outcome: 0,
      price: '99.12345678',
      evidenceHash: 'AAPL:2024-01-01:99.12345678',
    };
    const msg = buildSettlementMessage(payload);
    expect(msg).toBe(
      'Settlement:marketId=42,outcome=0,price=99.12345678,evidenceHash=AAPL:2024-01-01:99.12345678'
    );
  });

  it('produces the same message for identical payloads (deterministic)', () => {
    const payload: SettlementPayload = {
      marketId: '7',
      outcome: 1,
      price: '0.00100000',
    };
    expect(buildSettlementMessage(payload)).toBe(
      buildSettlementMessage({ ...payload })
    );
  });
});

// ---------------------------------------------------------------------------
// signSettlementPayload
// ---------------------------------------------------------------------------

describe('signSettlementPayload', () => {
  it('returns a 65-byte hex signature (0x + 130 hex chars)', async () => {
    const payload: SettlementPayload = {
      marketId: '1',
      outcome: 1,
      price: '150.00000000',
    };
    const signed = await signSettlementPayload(payload, TEST_PRIVATE_KEY);
    expect(signed.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
  });

  it('returns the correct signer address', async () => {
    const payload: SettlementPayload = {
      marketId: '2',
      outcome: 0,
      price: '50.00000000',
    };
    const signed = await signSettlementPayload(payload, TEST_PRIVATE_KEY);
    expect(signed.signerAddress.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });

  it('signature can be verified with ethers.verifyMessage', async () => {
    const payload: SettlementPayload = {
      marketId: '99',
      outcome: 1,
      price: '200.00000000',
      evidenceHash: 'BTC:2024-06-01:200.0',
    };
    const signed = await signSettlementPayload(payload, TEST_PRIVATE_KEY);
    const message = buildSettlementMessage(payload);
    const recovered = ethers.verifyMessage(message, signed.signature);
    expect(recovered.toLowerCase()).toBe(signed.signerAddress.toLowerCase());
  });

  it('passes all payload fields through to the signed result', async () => {
    const payload: SettlementPayload = {
      marketId: '5',
      outcome: 0,
      price: '10.50000000',
      evidenceHash: 'SPY:2024-03-15:10.5',
    };
    const signed = await signSettlementPayload(payload, TEST_PRIVATE_KEY);
    expect(signed.marketId).toBe(payload.marketId);
    expect(signed.outcome).toBe(payload.outcome);
    expect(signed.price).toBe(payload.price);
    expect(signed.evidenceHash).toBe(payload.evidenceHash);
  });
});

// ---------------------------------------------------------------------------
// submitSettlement – dry-run path (no network required)
// ---------------------------------------------------------------------------

describe('submitSettlement (dry-run)', () => {
  const dryRunCfg: BotConfig = {
    rpcUrl: '',
    privateKey: '',
    contractAddress: '',
    dryRun: true,
  };

  it('returns null without sending a transaction', async () => {
    const signed: SignedPayload = {
      marketId: '1',
      outcome: 1,
      price: '100.00000000',
      signature: '0x' + 'ab'.repeat(65),
      signerAddress: TEST_ADDRESS,
    };
    const consoleSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const result = await submitSettlement(signed, dryRunCfg);
    consoleSpy.mockRestore();
    expect(result).toBeNull();
  });

  it('logs the payload in dry-run mode', async () => {
    const signed: SignedPayload = {
      marketId: '2',
      outcome: 0,
      price: '75.00000000',
      evidenceHash: 'ETH:2024-01-01:75.0',
      signature: '0x' + 'cd'.repeat(65),
      signerAddress: TEST_ADDRESS,
    };
    const logs: string[] = [];
    const consoleSpy = jest
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        logs.push(args.join(' '));
      });
    await submitSettlement(signed, dryRunCfg);
    consoleSpy.mockRestore();
    expect(logs.some((l) => l.includes('[DRY-RUN]'))).toBe(true);
    expect(logs.some((l) => l.includes('"marketId": "2"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// submitSettlement – live path validation (no network)
// ---------------------------------------------------------------------------

describe('submitSettlement (live – missing config)', () => {
  it('throws when rpcUrl is missing', async () => {
    const signed: SignedPayload = {
      marketId: '1',
      outcome: 1,
      price: '100.00000000',
      signature: '0x' + 'aa'.repeat(65),
      signerAddress: TEST_ADDRESS,
    };
    const cfg: BotConfig = {
      rpcUrl: '',
      privateKey: TEST_PRIVATE_KEY,
      contractAddress: '0x1234567890123456789012345678901234567890',
      dryRun: false,
    };
    await expect(submitSettlement(signed, cfg)).rejects.toThrow('rpcUrl');
  });

  it('throws when privateKey is missing', async () => {
    const signed: SignedPayload = {
      marketId: '1',
      outcome: 1,
      price: '100.00000000',
      signature: '0x' + 'aa'.repeat(65),
      signerAddress: TEST_ADDRESS,
    };
    const cfg: BotConfig = {
      rpcUrl: 'https://example.com/rpc',
      privateKey: '',
      contractAddress: '0x1234567890123456789012345678901234567890',
      dryRun: false,
    };
    await expect(submitSettlement(signed, cfg)).rejects.toThrow('privateKey');
  });

  it('throws when contractAddress is missing', async () => {
    const signed: SignedPayload = {
      marketId: '1',
      outcome: 1,
      price: '100.00000000',
      signature: '0x' + 'aa'.repeat(65),
      signerAddress: TEST_ADDRESS,
    };
    const cfg: BotConfig = {
      rpcUrl: 'https://example.com/rpc',
      privateKey: TEST_PRIVATE_KEY,
      contractAddress: '',
      dryRun: false,
    };
    await expect(submitSettlement(signed, cfg)).rejects.toThrow(
      'contractAddress'
    );
  });
});

// ---------------------------------------------------------------------------
// loadMarketsToSettle
// ---------------------------------------------------------------------------

describe('loadMarketsToSettle', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns an empty array when MARKETS_TO_SETTLE is not set', () => {
    delete process.env.MARKETS_TO_SETTLE;
    expect(loadMarketsToSettle()).toEqual([]);
  });

  it('parses a valid JSON array from env', () => {
    process.env.MARKETS_TO_SETTLE = JSON.stringify([
      { marketId: '1', ticker: 'AAPL', expiryDate: '2024-01-19' },
      { marketId: '2', ticker: 'BTC', expiryDate: '2024-02-01' },
    ]);
    const markets = loadMarketsToSettle();
    expect(markets).toHaveLength(2);
    expect(markets[0].ticker).toBe('AAPL');
    expect(markets[1].marketId).toBe('2');
  });

  it('returns an empty array and warns for invalid JSON', () => {
    process.env.MARKETS_TO_SETTLE = 'not-valid-json';
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const result = loadMarketsToSettle();
    warnSpy.mockRestore();
    expect(result).toEqual([]);
  });
});
