/**
 * Unit tests for oracle-bot/settlement-bot.ts
 *
 * Covers:
 *  - loadConfig             (env-var reading + fallbacks)
 *  - buildSettlementMessage (pure function)
 *  - signSettlementPayload  (EIP-191 signing via ethers.js)
 *  - submitSettlement       (dry-run path AND mocked live path)
 *  - fetchPriceFromPolygon  (mocked fetch, all edge cases)
 *  - fetchPriceFromFMP      (mocked fetch, all edge cases)
 *  - fetchPriceFromYahoo    (mocked fetch, all edge cases)
 *  - fetchSettlementPrice   (fallback chain + all-fail error)
 *  - settleMarket           (end-to-end: price error, signing error, dry-run success)
 *  - loadMarketsToSettle    (env-var parsing)
 *
 * No real network requests or blockchain transactions are made.
 */

import { ethers } from 'ethers';
import {
  loadConfig,
  buildSettlementMessage,
  signSettlementPayload,
  submitSettlement,
  fetchPriceFromPolygon,
  fetchPriceFromFMP,
  fetchPriceFromYahoo,
  fetchSettlementPrice,
  settleMarket,
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
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal dry-run BotConfig. */
const dryRunCfg = (): BotConfig => ({
  rpcUrl: '',
  privateKey: TEST_PRIVATE_KEY,
  contractAddress: '',
  dryRun: true,
});

/** Build a minimal live BotConfig with all required fields. */
const liveCfg = (): BotConfig => ({
  rpcUrl: 'https://example.com/rpc',
  privateKey: TEST_PRIVATE_KEY,
  contractAddress: '0x1234567890123456789012345678901234567890',
  dryRun: false,
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reads ORACLE_RPC_URL as rpcUrl', () => {
    process.env.ORACLE_RPC_URL = 'https://oracle.rpc.example.com';
    delete process.env.ETHEREUM_RPC_URL;
    expect(loadConfig().rpcUrl).toBe('https://oracle.rpc.example.com');
  });

  it('falls back to ETHEREUM_RPC_URL when ORACLE_RPC_URL is absent', () => {
    delete process.env.ORACLE_RPC_URL;
    process.env.ETHEREUM_RPC_URL = 'https://eth.rpc.example.com';
    expect(loadConfig().rpcUrl).toBe('https://eth.rpc.example.com');
  });

  it('reads ORACLE_PRIVATE_KEY as privateKey', () => {
    process.env.ORACLE_PRIVATE_KEY = '0xdeadbeef';
    delete process.env.BACKEND_WALLET_PRIVATE_KEY;
    expect(loadConfig().privateKey).toBe('0xdeadbeef');
  });

  it('falls back to BACKEND_WALLET_PRIVATE_KEY', () => {
    delete process.env.ORACLE_PRIVATE_KEY;
    process.env.BACKEND_WALLET_PRIVATE_KEY = '0xcafe';
    expect(loadConfig().privateKey).toBe('0xcafe');
  });

  it('reads ORACLE_CONTRACT_ADDRESS', () => {
    process.env.ORACLE_CONTRACT_ADDRESS = '0xabcd';
    delete process.env.SMART_CONTRACT_ADDRESS;
    expect(loadConfig().contractAddress).toBe('0xabcd');
  });

  it('falls back to SMART_CONTRACT_ADDRESS', () => {
    delete process.env.ORACLE_CONTRACT_ADDRESS;
    process.env.SMART_CONTRACT_ADDRESS = '0xef01';
    expect(loadConfig().contractAddress).toBe('0xef01');
  });

  it('reads POLYGON_API_KEY and FMP_API_KEY', () => {
    process.env.POLYGON_API_KEY = 'poly-key';
    process.env.FMP_API_KEY = 'fmp-key';
    const cfg = loadConfig();
    expect(cfg.polygonApiKey).toBe('poly-key');
    expect(cfg.fmpApiKey).toBe('fmp-key');
  });

  it('sets dryRun=true when DRY_RUN=true', () => {
    process.env.DRY_RUN = 'true';
    expect(loadConfig().dryRun).toBe(true);
  });

  it('sets dryRun=false when DRY_RUN is not "true"', () => {
    process.env.DRY_RUN = 'false';
    expect(loadConfig().dryRun).toBe(false);
  });

  it('sets dryRun=false when DRY_RUN is absent', () => {
    delete process.env.DRY_RUN;
    expect(loadConfig().dryRun).toBe(false);
  });
});

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

  it('produces a different signature for different outcomes', async () => {
    const base: SettlementPayload = { marketId: '6', outcome: 0, price: '100.00000000' };
    const alt: SettlementPayload = { ...base, outcome: 1 };
    const s1 = await signSettlementPayload(base, TEST_PRIVATE_KEY);
    const s2 = await signSettlementPayload(alt, TEST_PRIVATE_KEY);
    expect(s1.signature).not.toBe(s2.signature);
  });
});

// ---------------------------------------------------------------------------
// submitSettlement – dry-run path (no network required)
// ---------------------------------------------------------------------------

describe('submitSettlement (dry-run)', () => {
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
    const result = await submitSettlement(signed, dryRunCfg());
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
    await submitSettlement(signed, dryRunCfg());
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
// submitSettlement – live path with mocked ethers (Step 1: Smart Contract)
// ---------------------------------------------------------------------------

describe('submitSettlement (live – mocked contract)', () => {
  const mockWait = jest.fn().mockResolvedValue({ blockNumber: 12345 });
  const mockTx = { hash: '0xdeadbeef1234', wait: mockWait };
  const mockResolveMarket = jest.fn().mockResolvedValue(mockTx);

  beforeEach(() => {
    mockResolveMarket.mockClear();
    mockWait.mockClear();

    jest.spyOn(ethers, 'JsonRpcProvider').mockImplementation(
      () => ({}) as unknown as ethers.JsonRpcProvider
    );
    jest.spyOn(ethers, 'Wallet').mockImplementation(
      () => ({}) as unknown as ethers.Wallet
    );
    jest.spyOn(ethers, 'Contract').mockImplementation(
      () => ({ resolveMarket: mockResolveMarket }) as unknown as ethers.Contract
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls resolveMarket on the contract with the correct arguments', async () => {
    const signed: SignedPayload = {
      marketId: '10',
      outcome: 1,
      price: '185.50000000',
      evidenceHash: 'AAPL:2024-01-19:185.5',
      signature: '0x' + 'ab'.repeat(65),
      signerAddress: TEST_ADDRESS,
    };

    const txHash = await submitSettlement(signed, liveCfg());

    expect(txHash).toBe('0xdeadbeef1234');
    expect(mockResolveMarket).toHaveBeenCalledTimes(1);

    const [callMarketId, callOutcome, callPrice, callSig, callEvidenceHash] =
      mockResolveMarket.mock.calls[0] as [
        string,
        number,
        bigint,
        string,
        string,
      ];
    expect(callMarketId).toBe('10');
    expect(callOutcome).toBe(1);
    expect(callPrice).toBe(ethers.parseUnits('185.50000000', 8));
    expect(callSig).toBe(signed.signature);
    // evidenceHash should be keccak256 of the evidence string
    expect(callEvidenceHash).toBe(
      ethers.keccak256(ethers.toUtf8Bytes('AAPL:2024-01-19:185.5'))
    );
  });

  it('uses ZeroHash when evidenceHash is absent', async () => {
    const signed: SignedPayload = {
      marketId: '11',
      outcome: 0,
      price: '50.00000000',
      signature: '0x' + 'ab'.repeat(65),
      signerAddress: TEST_ADDRESS,
    };

    await submitSettlement(signed, liveCfg());

    const [, , , , callEvidenceHash] =
      mockResolveMarket.mock.calls[0] as [string, number, bigint, string, string];
    expect(callEvidenceHash).toBe(ethers.ZeroHash);
  });

  it('waits for transaction confirmation and returns the hash', async () => {
    const signed: SignedPayload = {
      marketId: '12',
      outcome: 1,
      price: '100.00000000',
      signature: '0x' + 'ab'.repeat(65),
      signerAddress: TEST_ADDRESS,
    };

    const result = await submitSettlement(signed, liveCfg());
    expect(result).toBe('0xdeadbeef1234');
    expect(mockWait).toHaveBeenCalledTimes(1);
  });

  it('uses 8 decimal places for the on-chain price uint256', async () => {
    const signed: SignedPayload = {
      marketId: '13',
      outcome: 1,
      price: '0.00100000',
      signature: '0x' + 'ab'.repeat(65),
      signerAddress: TEST_ADDRESS,
    };

    await submitSettlement(signed, liveCfg());

    const [, , callPrice] =
      mockResolveMarket.mock.calls[0] as [string, number, bigint, string, string];
    expect(callPrice).toBe(BigInt(100000)); // 0.001 × 10^8
  });
});

// ---------------------------------------------------------------------------
// fetchPriceFromPolygon  (Step 2: Oracle Bot – price fetching)
// ---------------------------------------------------------------------------

describe('fetchPriceFromPolygon', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null immediately when apiKey is empty – no fetch call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const result = await fetchPriceFromPolygon('AAPL', '2024-01-19', '');
    expect(spy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns the close price on a successful response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ close: 185.5 }),
    } as Response);

    const result = await fetchPriceFromPolygon('AAPL', '2024-01-19', 'apikey123');
    expect(result).toBe(185.5);
  });

  it('returns null when the HTTP response is not ok', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as Response);

    const result = await fetchPriceFromPolygon('AAPL', '2024-01-19', 'apikey123');
    expect(result).toBeNull();
  });

  it('returns null when the close field is missing from the response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ open: 180, high: 190, low: 175 }),
    } as Response);

    const result = await fetchPriceFromPolygon('AAPL', '2024-01-19', 'apikey123');
    expect(result).toBeNull();
  });

  it('returns null on a network error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchPriceFromPolygon('AAPL', '2024-01-19', 'apikey123');
    expect(result).toBeNull();
  });

  it('URL-encodes the ticker symbol', async () => {
    let capturedUrl = '';
    jest.spyOn(global, 'fetch').mockImplementationOnce((url) => {
      capturedUrl = url as string;
      return Promise.resolve({ ok: true, json: async () => ({ close: 1.5 }) } as Response);
    });

    await fetchPriceFromPolygon('BRK/B', '2024-01-19', 'k');
    expect(capturedUrl).toContain(encodeURIComponent('BRK/B'));
  });
});

// ---------------------------------------------------------------------------
// fetchPriceFromFMP
// ---------------------------------------------------------------------------

describe('fetchPriceFromFMP', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null immediately when apiKey is empty – no fetch call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const result = await fetchPriceFromFMP('AAPL', '');
    expect(spy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns the price on a successful response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{ price: 192.3 }],
    } as Response);

    const result = await fetchPriceFromFMP('AAPL', 'fmp-key');
    expect(result).toBe(192.3);
  });

  it('returns null when the HTTP response is not ok', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => [],
    } as Response);

    const result = await fetchPriceFromFMP('AAPL', 'fmp-key');
    expect(result).toBeNull();
  });

  it('returns null when the response array is empty', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const result = await fetchPriceFromFMP('AAPL', 'fmp-key');
    expect(result).toBeNull();
  });

  it('returns null when the price field is missing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{ symbol: 'AAPL' }],
    } as Response);

    const result = await fetchPriceFromFMP('AAPL', 'fmp-key');
    expect(result).toBeNull();
  });

  it('returns null on a network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Timeout'));

    const result = await fetchPriceFromFMP('BTC', 'fmp-key');
    expect(result).toBeNull();
  });

  it('URL-encodes the ticker symbol', async () => {
    let capturedUrl = '';
    jest.spyOn(global, 'fetch').mockImplementationOnce((url) => {
      capturedUrl = url as string;
      return Promise.resolve({
        ok: true,
        json: async () => [{ price: 2.0 }],
      } as Response);
    });

    await fetchPriceFromFMP('BRK/B', 'k');
    expect(capturedUrl).toContain(encodeURIComponent('BRK/B'));
  });
});

// ---------------------------------------------------------------------------
// fetchPriceFromYahoo
// ---------------------------------------------------------------------------

describe('fetchPriceFromYahoo', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns regularMarketPrice on a successful response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: { result: [{ meta: { regularMarketPrice: 173.5 } }] },
      }),
    } as Response);

    const result = await fetchPriceFromYahoo('AAPL');
    expect(result).toBe(173.5);
  });

  it('returns null when the HTTP response is not ok', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as Response);

    const result = await fetchPriceFromYahoo('AAPL');
    expect(result).toBeNull();
  });

  it('returns null when chart.result is empty', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chart: { result: [] } }),
    } as Response);

    const result = await fetchPriceFromYahoo('AAPL');
    expect(result).toBeNull();
  });

  it('returns null when meta.regularMarketPrice is missing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chart: { result: [{ meta: { currency: 'USD' } }] },
      }),
    } as Response);

    const result = await fetchPriceFromYahoo('AAPL');
    expect(result).toBeNull();
  });

  it('returns null when the response shape is entirely unexpected', async () => {
    // Yahoo Finance returns a top-level error object (e.g. for unknown tickers)
    // instead of the usual chart.result structure. The function should handle
    // this gracefully via optional chaining and return null rather than throw.
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: { code: 'Not Found', description: 'No fundamentals data found' } }),
    } as Response);

    const result = await fetchPriceFromYahoo('UNKNOWN');
    expect(result).toBeNull();
  });

  it('returns null on a network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await fetchPriceFromYahoo('TSLA');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchSettlementPrice – fallback chain (Step 2: multi-provider oracle)
// ---------------------------------------------------------------------------

describe('fetchSettlementPrice', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns Polygon price when Polygon succeeds', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ close: 150.0 }),
    } as Response);

    const price = await fetchSettlementPrice('AAPL', '2024-01-19', {
      polygonApiKey: 'poly-key',
      fmpApiKey: 'fmp-key',
    });
    expect(price).toBe(150.0);
  });

  it('falls back to FMP when Polygon fails', async () => {
    // Polygon call: ok=false → null
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
      // FMP call: ok=true → price 200
      .mockResolvedValueOnce({ ok: true, json: async () => [{ price: 200.0 }] } as Response);

    const price = await fetchSettlementPrice('BTC', '2024-01-19', {
      polygonApiKey: 'poly-key',
      fmpApiKey: 'fmp-key',
    });
    expect(price).toBe(200.0);
  });

  it('falls back to Yahoo when Polygon and FMP both fail', async () => {
    jest.spyOn(global, 'fetch')
      // Polygon: not ok
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
      // FMP: not ok
      .mockResolvedValueOnce({ ok: false, json: async () => [] } as Response)
      // Yahoo: success
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          chart: { result: [{ meta: { regularMarketPrice: 63500 } }] },
        }),
      } as Response);

    const price = await fetchSettlementPrice('BTC', '2024-01-19', {
      polygonApiKey: 'poly-key',
      fmpApiKey: 'fmp-key',
    });
    expect(price).toBe(63500);
  });

  it('skips Polygon entirely when polygonApiKey is empty', async () => {
    jest.spyOn(global, 'fetch')
      // Only FMP and Yahoo calls expected
      .mockResolvedValueOnce({ ok: true, json: async () => [{ price: 50.5 }] } as Response);

    const price = await fetchSettlementPrice('ETH', '2024-01-19', {
      polygonApiKey: '',
      fmpApiKey: 'fmp-key',
    });
    expect(price).toBe(50.5);
  });

  it('throws when all providers fail', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: false, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response);

    await expect(
      fetchSettlementPrice('UNKNOWN', '2024-01-19', {
        polygonApiKey: 'poly-key',
        fmpApiKey: 'fmp-key',
      })
    ).rejects.toThrow('Failed to fetch price for "UNKNOWN"');
  });

  it('throws when all providers throw network errors', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    await expect(
      fetchSettlementPrice('FAIL', '2024-01-19', {
        polygonApiKey: 'poly-key',
        fmpApiKey: 'fmp-key',
      })
    ).rejects.toThrow('Failed to fetch price');
  });
});

// ---------------------------------------------------------------------------
// settleMarket – end-to-end orchestration (Step 2 + Step 5)
// ---------------------------------------------------------------------------

describe('settleMarket', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs an error and returns (does not throw) when price fetch fails', async () => {
    // All fetch calls return not-ok so every provider fails
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await settleMarket(
      { marketId: '1', ticker: 'FAIL', expiryDate: '2024-01-19' },
      { ...dryRunCfg(), polygonApiKey: 'poly-key', fmpApiKey: 'fmp-key' }
    );

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[1]'),
      expect.any(Error)
    );
  });

  it('logs an error and returns when privateKey is missing', async () => {
    // Price fetch succeeds
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ close: 100.0 }) } as Response);

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await settleMarket(
      { marketId: '2', ticker: 'AAPL', expiryDate: '2024-01-19' },
      {
        rpcUrl: '',
        privateKey: '',          // missing
        contractAddress: '',
        polygonApiKey: 'poly-key',
        dryRun: true,
      }
    );

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[2]'),
      expect.any(Error)
    );
  });

  it('completes successfully in dry-run mode', async () => {
    // Polygon returns a price
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ close: 185.5 }) } as Response);

    const logs: string[] = [];
    jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });

    await settleMarket(
      { marketId: '3', ticker: 'AAPL', expiryDate: '2024-01-19' },
      { ...dryRunCfg(), polygonApiKey: 'poly-key' }
    );

    // Should have logged "Signed by" and "[DRY-RUN]"
    expect(logs.some((m) => m.includes('Signed by'))).toBe(true);
    expect(logs.some((m) => m.includes('[DRY-RUN]'))).toBe(true);
  });

  it('logs an error and returns when submitSettlement throws', async () => {
    // Price fetch succeeds
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ close: 50.0 }) } as Response);

    // Mock ethers to make submitSettlement throw
    jest.spyOn(ethers, 'JsonRpcProvider').mockImplementation(
      () => ({}) as unknown as ethers.JsonRpcProvider
    );
    jest.spyOn(ethers, 'Wallet').mockImplementation(
      () => ({}) as unknown as ethers.Wallet
    );
    jest.spyOn(ethers, 'Contract').mockImplementation(() => ({
      resolveMarket: jest.fn().mockRejectedValueOnce(new Error('TX reverted')),
    }) as unknown as ethers.Contract);

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await settleMarket(
      { marketId: '4', ticker: 'ETH', expiryDate: '2024-01-19' },
      { ...liveCfg(), polygonApiKey: 'poly-key' }
    );

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[4]'),
      expect.any(Error)
    );
  });

  it('settles multiple markets independently (Step 5: bulk automation)', async () => {
    // Two successful price fetches
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ close: 185.5 }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ close: 63000.0 }) } as Response);

    const logs: string[] = [];
    const logSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });

    await settleMarket(
      { marketId: '5', ticker: 'AAPL', expiryDate: '2024-01-19' },
      { ...dryRunCfg(), polygonApiKey: 'poly-key' }
    );
    await settleMarket(
      { marketId: '6', ticker: 'BTC', expiryDate: '2024-01-19' },
      { ...dryRunCfg(), polygonApiKey: 'poly-key' }
    );

    logSpy.mockRestore();

    expect(logs.some((l) => l.includes('5'))).toBe(true);
    expect(logs.some((l) => l.includes('6'))).toBe(true);
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

  it('handles an empty JSON array', () => {
    process.env.MARKETS_TO_SETTLE = '[]';
    expect(loadMarketsToSettle()).toEqual([]);
  });

  it('handles single-item array', () => {
    process.env.MARKETS_TO_SETTLE = JSON.stringify([
      { marketId: '99', ticker: 'SPY', expiryDate: '2024-12-31' },
    ]);
    const markets = loadMarketsToSettle();
    expect(markets).toHaveLength(1);
    expect(markets[0].ticker).toBe('SPY');
  });
});

