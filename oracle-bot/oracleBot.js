#!/usr/bin/env node
/**
 * Oracle Bot – oracle-bot/oracleBot.js
 *
 * Standalone Node.js CLI that:
 *   1. Reads market config from MARKETS_TO_SETTLE env var (or the DB stub below).
 *   2. Fetches the settlement price from Polygon.io → FMP → Yahoo Finance.
 *   3. Signs the settlement payload with ORACLE_PRIVATE_KEY (EIP-191).
 *   4. Calls resolveMarket() on the deployed smart contract via ethers.js.
 *
 * Requirements:
 *   npm install ethers dotenv node-fetch
 *
 * Usage:
 *   node oracle-bot/oracleBot.js
 *   DRY_RUN=true node oracle-bot/oracleBot.js
 *
 * Environment variables (see .env.example):
 *   ORACLE_RPC_URL           JSON-RPC endpoint (falls back to ETHEREUM_RPC_URL)
 *   ORACLE_PRIVATE_KEY       Admin signing key  (falls back to BACKEND_WALLET_PRIVATE_KEY)
 *   ORACLE_CONTRACT_ADDRESS  Deployed contract  (falls back to SMART_CONTRACT_ADDRESS)
 *   POLYGON_API_KEY          Polygon.io API key (optional)
 *   FMP_API_KEY              Financial Modeling Prep key (optional)
 *   DRY_RUN                  Set "true" to log payloads without sending transactions
 *   MARKETS_TO_SETTLE        JSON array of {marketId, ticker, expiryDate} objects
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

// ---------------------------------------------------------------------------
// ABI – only the resolveMarket selector is required
// ---------------------------------------------------------------------------

const RESOLVE_MARKET_ABI = [
  'function resolveMarket(uint256 marketId, uint256 outcome, uint256 price, bytes signature, bytes32 evidenceHash) external',
];

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

function loadConfig() {
  return {
    rpcUrl:          process.env.ORACLE_RPC_URL          || process.env.ETHEREUM_RPC_URL          || '',
    privateKey:      process.env.ORACLE_PRIVATE_KEY      || process.env.BACKEND_WALLET_PRIVATE_KEY || '',
    contractAddress: process.env.ORACLE_CONTRACT_ADDRESS || process.env.SMART_CONTRACT_ADDRESS    || '',
    polygonApiKey:   process.env.POLYGON_API_KEY || '',
    fmpApiKey:       process.env.FMP_API_KEY     || '',
    dryRun:          process.env.DRY_RUN === 'true',
  };
}

// ---------------------------------------------------------------------------
// Price providers – Polygon → FMP → Yahoo (first success wins)
// ---------------------------------------------------------------------------

async function fetchPriceFromPolygon(ticker, date, apiKey) {
  if (!apiKey) return null;
  try {
    const url = `https://api.polygon.io/v1/open-close/${encodeURIComponent(ticker)}/${date}?adjusted=true&apiKey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.close ?? null;
  } catch (err) {
    console.debug(`[Polygon] fetch failed for ${ticker}:`, err.message);
    return null;
  }
}

async function fetchPriceFromFMP(ticker, apiKey) {
  if (!apiKey) return null;
  try {
    const url = `https://financialmodelingprep.com/api/v3/quote-short/${encodeURIComponent(ticker)}?apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data[0]?.price ?? null;
  } catch (err) {
    console.debug(`[FMP] fetch failed for ${ticker}:`, err.message);
    return null;
  }
}

async function fetchPriceFromYahoo(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch (err) {
    console.debug(`[Yahoo] fetch failed for ${ticker}:`, err.message);
    return null;
  }
}

/**
 * Fetch settlement price – tries all providers in order.
 * Throws if all providers fail.
 */
async function fetchSettlementPrice(ticker, date, cfg) {
  const polygon = await fetchPriceFromPolygon(ticker, date, cfg.polygonApiKey);
  if (polygon !== null) { console.log(`[${ticker}] Price from Polygon: ${polygon}`); return polygon; }

  const fmp = await fetchPriceFromFMP(ticker, cfg.fmpApiKey);
  if (fmp !== null) { console.log(`[${ticker}] Price from FMP: ${fmp}`); return fmp; }

  const yahoo = await fetchPriceFromYahoo(ticker);
  if (yahoo !== null) { console.log(`[${ticker}] Price from Yahoo: ${yahoo}`); return yahoo; }

  throw new Error(`Failed to fetch price for "${ticker}" from all providers (Polygon, FMP, Yahoo)`);
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Build the deterministic settlement message.
 * Must match PredictionMarket.sol `_buildSettlementHash()`.
 *
 * @param {string|bigint} marketId
 * @param {number|bigint} outcome
 * @param {string|bigint} price     – raw uint256 (8 decimal places, e.g. "15000000000")
 * @param {string}        evidenceHash32 – bytes32 hex string (0x…), e.g. ethers.ZeroHash
 */
function buildSettlementMessage(marketId, outcome, price, evidenceHash32) {
  return (
    `Settlement:marketId=${marketId},` +
    `outcome=${outcome},` +
    `price=${price},` +
    `evidenceHash=${evidenceHash32}`
  );
}

async function signSettlementPayload(payload, privateKey) {
  const wallet = new ethers.Wallet(privateKey);

  // Compute bytes32 evidenceHash so the contract can verify the signature.
  // The contract's _buildSettlementHash converts the bytes32 to hex, so we
  // must include the same hex string in our signing message.
  const evidenceHash32 = payload.evidenceHashRaw
    ? ethers.keccak256(ethers.toUtf8Bytes(payload.evidenceHashRaw))
    : ethers.ZeroHash;

  const message = buildSettlementMessage(
    payload.marketId,
    payload.outcome,
    payload.price,
    evidenceHash32,
  );
  const signature = await wallet.signMessage(message);
  return { ...payload, evidenceHash32, signature, signerAddress: wallet.address };
}

// ---------------------------------------------------------------------------
// Contract submission
// ---------------------------------------------------------------------------

async function submitSettlement(signedPayload, cfg) {
  if (cfg.dryRun) {
    console.log('[DRY-RUN] Would submit payload:', JSON.stringify(signedPayload, null, 2));
    return null;
  }

  if (!cfg.rpcUrl)          throw new Error('ORACLE_RPC_URL is required in live mode');
  if (!cfg.privateKey)      throw new Error('ORACLE_PRIVATE_KEY is required in live mode');
  if (!cfg.contractAddress) throw new Error('ORACLE_CONTRACT_ADDRESS is required in live mode');

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const wallet   = new ethers.Wallet(cfg.privateKey, provider);
  const contract = new ethers.Contract(cfg.contractAddress, RESOLVE_MARKET_ABI, wallet);

  const evidenceHash32 = signedPayload.evidenceHash32 || ethers.ZeroHash;

  // Price is stored on-chain with 8 decimal places
  const priceBN = ethers.parseUnits(String(signedPayload.price), 8);

  const tx = await contract.resolveMarket(
    signedPayload.marketId,
    signedPayload.outcome,
    priceBN,
    signedPayload.signature,
    evidenceHash32,
  );

  console.log(`[${signedPayload.marketId}] Transaction submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`[${signedPayload.marketId}] Confirmed in block ${receipt.blockNumber}`);
  return tx.hash;
}

// ---------------------------------------------------------------------------
// Per-market settlement orchestration
// ---------------------------------------------------------------------------

async function settleMarket(market, cfg) {
  console.log(`\nSettling market ${market.marketId} (${market.ticker})`);

  let price;
  try {
    price = await fetchSettlementPrice(market.ticker, market.expiryDate, cfg);
  } catch (err) {
    console.error(`[${market.marketId}] Error fetching price:`, err.message);
    return;
  }

  const payload = {
    marketId:        market.marketId,
    outcome:         1,                 // 1 = resolved with valid price
    price:           price.toFixed(8),
    // Raw evidence string – hashed inside signSettlementPayload
    evidenceHashRaw: `${market.ticker}:${market.expiryDate}:${price}`,
  };

  let signedPayload;
  try {
    if (!cfg.privateKey) throw new Error('ORACLE_PRIVATE_KEY is required');
    signedPayload = await signSettlementPayload(payload, cfg.privateKey);
    console.log(`[${market.marketId}] Signed by ${signedPayload.signerAddress}`);
  } catch (err) {
    console.error(`[${market.marketId}] Error signing payload:`, err.message);
    return;
  }

  try {
    const txHash = await submitSettlement(signedPayload, cfg);
    if (txHash) console.log(`[${market.marketId}] Settlement TX: ${txHash}`);
  } catch (err) {
    console.error(`[${market.marketId}] Error submitting settlement:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Markets loader
// ---------------------------------------------------------------------------

/**
 * Load markets from MARKETS_TO_SETTLE env var.
 * In production, replace with a DB query for all markets with
 *   expiry_date <= NOW() AND status = 'closed'.
 */
function loadMarketsToSettle() {
  const raw = process.env.MARKETS_TO_SETTLE;
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('Failed to parse MARKETS_TO_SETTLE – expected JSON array of {marketId, ticker, expiryDate}');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Oracle Bot ===');
  const cfg = loadConfig();
  console.log(`Mode: ${cfg.dryRun ? 'DRY-RUN (no transactions sent)' : 'LIVE'}`);

  if (!cfg.privateKey)
    throw new Error('ORACLE_PRIVATE_KEY (or BACKEND_WALLET_PRIVATE_KEY) is required');

  if (!cfg.dryRun) {
    if (!cfg.rpcUrl)
      throw new Error('ORACLE_RPC_URL (or ETHEREUM_RPC_URL) is required in live mode');
    if (!cfg.contractAddress)
      throw new Error('ORACLE_CONTRACT_ADDRESS (or SMART_CONTRACT_ADDRESS) is required in live mode');
  }

  const markets = loadMarketsToSettle();
  if (markets.length === 0) {
    console.log('No markets to settle.  Set MARKETS_TO_SETTLE to provide a list.');
    return;
  }

  console.log(`Found ${markets.length} market(s) to settle.`);
  for (const market of markets) {
    await settleMarket(market, cfg);
  }

  console.log('\n=== Settlement run complete ===');
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
