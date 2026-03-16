/**
 * Oracle Settlement Bot
 *
 * Automatically fetches settlement data for closed prediction markets,
 * signs the data with an admin private key (EIP-191), and calls the
 * smart contract's `resolveMarket` function via ethers.js.
 *
 * Usage:
 *   ts-node oracle-bot/settlement-bot.ts
 *   DRY_RUN=true ts-node oracle-bot/settlement-bot.ts
 */

import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketConfig {
  /** On-chain market identifier */
  marketId: string;
  /** Ticker symbol (e.g. "AAPL", "BTC", "SPY") */
  ticker: string;
  /** ISO date of market expiry/close (YYYY-MM-DD) */
  expiryDate: string;
}

export interface SettlementPayload {
  marketId: string;
  /** Resolved outcome index (0 = no/below, 1 = yes/above, etc.) */
  outcome: number;
  /** Settlement price as a fixed-precision decimal string (8 decimals) */
  price: string;
  /** Optional human-readable evidence string that gets hashed on-chain */
  evidenceHash?: string;
}

export interface SignedPayload extends SettlementPayload {
  signature: string;
  signerAddress: string;
}

export interface BotConfig {
  rpcUrl: string;
  privateKey: string;
  contractAddress: string;
  polygonApiKey?: string;
  fmpApiKey?: string;
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function loadConfig(): BotConfig {
  return {
    rpcUrl: process.env.ORACLE_RPC_URL || process.env.ETHEREUM_RPC_URL || '',
    privateKey:
      process.env.ORACLE_PRIVATE_KEY ||
      process.env.BACKEND_WALLET_PRIVATE_KEY ||
      '',
    contractAddress:
      process.env.ORACLE_CONTRACT_ADDRESS ||
      process.env.SMART_CONTRACT_ADDRESS ||
      '',
    polygonApiKey: process.env.POLYGON_API_KEY || '',
    fmpApiKey: process.env.FMP_API_KEY || '',
    dryRun: process.env.DRY_RUN === 'true',
  };
}

// ---------------------------------------------------------------------------
// Contract ABI (only the resolveMarket selector is needed)
// ---------------------------------------------------------------------------

const RESOLVE_MARKET_ABI = [
  'function resolveMarket(uint256 marketId, uint256 outcome, uint256 price, bytes signature, bytes32 evidenceHash) external',
];

// ---------------------------------------------------------------------------
// Price fetching – multiple providers with fallback
// ---------------------------------------------------------------------------

/**
 * Fetch the closing price for `ticker` on `date` from Polygon.io.
 * Returns null when the API key is missing or the request fails.
 */
export async function fetchPriceFromPolygon(
  ticker: string,
  date: string,
  apiKey: string
): Promise<number | null> {
  if (!apiKey) return null;
  try {
    const url = `https://api.polygon.io/v1/open-close/${encodeURIComponent(ticker)}/${date}?adjusted=true&apiKey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { close?: number };
    return data.close ?? null;
  } catch (err) {
    console.debug(`[Polygon] fetch failed for ${ticker}:`, err);
    return null;
  }
}

/**
 * Fetch the latest quote for `ticker` from Financial Modeling Prep (FMP).
 * Returns null when the API key is missing or the request fails.
 */
export async function fetchPriceFromFMP(
  ticker: string,
  apiKey: string
): Promise<number | null> {
  if (!apiKey) return null;
  try {
    const url = `https://financialmodelingprep.com/api/v3/quote-short/${encodeURIComponent(ticker)}?apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = (await resp.json()) as Array<{ price?: number }>;
    return data[0]?.price ?? null;
  } catch (err) {
    console.debug(`[FMP] fetch failed for ${ticker}:`, err);
    return null;
  }
}

/**
 * Fetch the latest regular-market price for `ticker` from Yahoo Finance.
 * Returns null when the request fails.
 */
export async function fetchPriceFromYahoo(
  ticker: string
): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      chart?: {
        result?: Array<{ meta?: { regularMarketPrice?: number } }>;
      };
    };
    return data.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch (err) {
    console.debug(`[Yahoo] fetch failed for ${ticker}:`, err);
    return null;
  }
}

/**
 * Fetch the settlement price for `ticker` on `date`.
 * Tries Polygon → FMP → Yahoo in order and returns the first successful result.
 * Throws if all providers fail.
 */
export async function fetchSettlementPrice(
  ticker: string,
  date: string,
  cfg: Pick<BotConfig, 'polygonApiKey' | 'fmpApiKey'>
): Promise<number> {
  const polygonPrice = await fetchPriceFromPolygon(
    ticker,
    date,
    cfg.polygonApiKey ?? ''
  );
  if (polygonPrice !== null) {
    console.log(`[${ticker}] Price from Polygon: ${polygonPrice}`);
    return polygonPrice;
  }

  const fmpPrice = await fetchPriceFromFMP(ticker, cfg.fmpApiKey ?? '');
  if (fmpPrice !== null) {
    console.log(`[${ticker}] Price from FMP: ${fmpPrice}`);
    return fmpPrice;
  }

  const yahooPrice = await fetchPriceFromYahoo(ticker);
  if (yahooPrice !== null) {
    console.log(`[${ticker}] Price from Yahoo: ${yahooPrice}`);
    return yahooPrice;
  }

  throw new Error(
    `Failed to fetch price for "${ticker}" from all providers (Polygon, FMP, Yahoo)`
  );
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Build the deterministic EIP-191 message string from a settlement payload.
 */
export function buildSettlementMessage(payload: SettlementPayload): string {
  return (
    `Settlement:marketId=${payload.marketId},` +
    `outcome=${payload.outcome},` +
    `price=${payload.price},` +
    `evidenceHash=${payload.evidenceHash ?? ''}`
  );
}

/**
 * Sign a settlement payload with the given private key (EIP-191 personal sign).
 * Returns the full signed payload including the hex signature and signer address.
 */
export async function signSettlementPayload(
  payload: SettlementPayload,
  privateKey: string
): Promise<SignedPayload> {
  const wallet = new ethers.Wallet(privateKey);
  const message = buildSettlementMessage(payload);
  const signature = await wallet.signMessage(message);
  return { ...payload, signature, signerAddress: wallet.address };
}

// ---------------------------------------------------------------------------
// Contract submission
// ---------------------------------------------------------------------------

/**
 * Submit a signed settlement payload to the smart contract.
 * In dry-run mode the payload is logged but no transaction is sent.
 * Returns the transaction hash, or null in dry-run mode.
 */
export async function submitSettlement(
  signedPayload: SignedPayload,
  cfg: BotConfig
): Promise<string | null> {
  if (cfg.dryRun) {
    console.log(
      '[DRY-RUN] Would submit payload:',
      JSON.stringify(signedPayload, null, 2)
    );
    return null;
  }

  if (!cfg.rpcUrl) throw new Error('rpcUrl is required to submit a settlement');
  if (!cfg.privateKey)
    throw new Error('privateKey is required to submit a settlement');
  if (!cfg.contractAddress)
    throw new Error('contractAddress is required to submit a settlement');

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const wallet = new ethers.Wallet(cfg.privateKey, provider);
  const contract = new ethers.Contract(
    cfg.contractAddress,
    RESOLVE_MARKET_ABI,
    wallet
  );

  const evidenceHash32 = signedPayload.evidenceHash
    ? ethers.keccak256(ethers.toUtf8Bytes(signedPayload.evidenceHash))
    : ethers.ZeroHash;

  // Price is stored on-chain with 8 decimal places as a uint256
  const priceBN = ethers.parseUnits(signedPayload.price, 8);

  const tx = (await contract.resolveMarket(
    signedPayload.marketId,
    signedPayload.outcome,
    priceBN,
    signedPayload.signature,
    evidenceHash32
  )) as { hash: string; wait: () => Promise<{ blockNumber: number }> };

  console.log(`[${signedPayload.marketId}] Transaction submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(
    `[${signedPayload.marketId}] Confirmed in block ${receipt.blockNumber}`
  );
  return tx.hash;
}

// ---------------------------------------------------------------------------
// Per-market settlement orchestration
// ---------------------------------------------------------------------------

/**
 * Settle a single market: fetch price → sign → submit.
 * Errors are caught and logged per-market so one failure does not abort others.
 */
export async function settleMarket(
  market: MarketConfig,
  cfg: BotConfig
): Promise<void> {
  console.log(`\nSettling market ${market.marketId} (${market.ticker})`);

  let price: number;
  try {
    price = await fetchSettlementPrice(market.ticker, market.expiryDate, cfg);
  } catch (err) {
    console.error(`[${market.marketId}] Error fetching price:`, err);
    return;
  }

  // outcome = 1 means "resolved with a valid price" (binary yes/above/resolved)
  const payload: SettlementPayload = {
    marketId: market.marketId,
    outcome: 1,
    price: price.toFixed(8),
    evidenceHash: `${market.ticker}:${market.expiryDate}:${price}`,
  };

  let signedPayload: SignedPayload;
  try {
    if (!cfg.privateKey) {
      throw new Error(
        'privateKey is required (set ORACLE_PRIVATE_KEY or BACKEND_WALLET_PRIVATE_KEY)'
      );
    }
    signedPayload = await signSettlementPayload(payload, cfg.privateKey);
    console.log(`[${market.marketId}] Signed by ${signedPayload.signerAddress}`);
  } catch (err) {
    console.error(`[${market.marketId}] Error signing payload:`, err);
    return;
  }

  try {
    const txHash = await submitSettlement(signedPayload, cfg);
    if (txHash) {
      console.log(`[${market.marketId}] Settlement TX: ${txHash}`);
    }
  } catch (err) {
    console.error(`[${market.marketId}] Error submitting settlement:`, err);
  }
}

// ---------------------------------------------------------------------------
// Markets loader
// ---------------------------------------------------------------------------

/**
 * Load the list of markets needing settlement.
 *
 * In production this should query your PostgreSQL database (or a REST endpoint)
 * for all markets whose `expiry_date <= now()` and status = 'closed'.
 *
 * For convenience the list can also be supplied via the MARKETS_TO_SETTLE env
 * var as a JSON array:
 *   MARKETS_TO_SETTLE='[{"marketId":"1","ticker":"AAPL","expiryDate":"2024-01-19"}]'
 */
export function loadMarketsToSettle(): MarketConfig[] {
  const raw = process.env.MARKETS_TO_SETTLE;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as MarketConfig[];
  } catch {
    console.warn(
      'Failed to parse MARKETS_TO_SETTLE – expected a JSON array of MarketConfig objects'
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Oracle Settlement Bot ===');
  const cfg = loadConfig();
  console.log(`Mode: ${cfg.dryRun ? 'DRY-RUN (no transactions sent)' : 'LIVE'}`);

  if (!cfg.privateKey)
    throw new Error(
      'ORACLE_PRIVATE_KEY (or BACKEND_WALLET_PRIVATE_KEY) env var is required'
    );
  if (!cfg.dryRun) {
    if (!cfg.rpcUrl)
      throw new Error(
        'ORACLE_RPC_URL (or ETHEREUM_RPC_URL) env var is required in live mode'
      );
    if (!cfg.contractAddress)
      throw new Error(
        'ORACLE_CONTRACT_ADDRESS (or SMART_CONTRACT_ADDRESS) env var is required in live mode'
      );
  }

  const markets = loadMarketsToSettle();

  if (markets.length === 0) {
    console.log('No markets to settle. Set MARKETS_TO_SETTLE to provide a list.');
    return;
  }

  console.log(`Found ${markets.length} market(s) to settle.`);
  for (const market of markets) {
    await settleMarket(market, cfg);
  }

  console.log('\n=== Settlement run complete ===');
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
