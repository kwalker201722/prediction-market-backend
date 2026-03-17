import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '';

// Store the auth token in memory (set it via login or setToken)
let _token = localStorage.getItem('admin_token') || '';

export function setToken(token) {
  _token = token;
  if (token) {
    localStorage.setItem('admin_token', token);
  } else {
    localStorage.removeItem('admin_token');
  }
}

export function getToken() {
  return _token;
}

function authHeaders() {
  return _token ? { Authorization: `Bearer ${_token}` } : {};
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Login with email + password.
 * @returns {Promise<string>} JWT token
 */
export async function login(email, password) {
  const { data } = await axios.post(`${BASE_URL}/auth/login`, { email, password });
  const token = data.token;
  setToken(token);
  return token;
}

export function logout() {
  setToken('');
}

// ---------------------------------------------------------------------------
// Settlement API
// ---------------------------------------------------------------------------

/**
 * Fetch all markets with status pending or queued.
 * @returns {Promise<Array>}
 */
export async function fetchPendingMarkets() {
  const { data } = await axios.get(`${BASE_URL}/settlement/pending`, {
    headers: authHeaders(),
  });
  return data.markets ?? [];
}

/**
 * Fetch the current settlement status of a single market.
 * @param {string} marketId
 * @returns {Promise<Object>}
 */
export async function fetchMarketStatus(marketId) {
  const { data } = await axios.get(`${BASE_URL}/settlement/status/${encodeURIComponent(marketId)}`, {
    headers: authHeaders(),
  });
  return data;
}

/**
 * Queue a market for settlement by the oracle bot.
 * @param {string} marketId
 * @param {string} ticker
 * @param {string} expiryDate  YYYY-MM-DD
 * @returns {Promise<Object>}
 */
export async function resolveMarket(marketId, ticker, expiryDate) {
  const { data } = await axios.post(
    `${BASE_URL}/settlement/resolve`,
    { marketId, ticker, expiryDate },
    { headers: authHeaders() },
  );
  return data;
}

/**
 * Mark a queued market as settled (called after on-chain TX).
 * @param {string} marketId
 * @param {string} [txHash]
 * @returns {Promise<Object>}
 */
export async function markSettled(marketId, txHash) {
  const { data } = await axios.post(
    `${BASE_URL}/settlement/settle/${encodeURIComponent(marketId)}`,
    txHash ? { txHash } : {},
    { headers: authHeaders() },
  );
  return data;
}

/**
 * Open a dispute on a settled market.
 * @param {string} marketId
 * @param {string} reason
 * @returns {Promise<Object>}
 */
export async function disputeMarket(marketId, reason) {
  const { data } = await axios.post(
    `${BASE_URL}/settlement/dispute`,
    { marketId, reason },
    { headers: authHeaders() },
  );
  return data;
}
