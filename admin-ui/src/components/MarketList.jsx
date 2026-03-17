/**
 * MarketList – displays pending/queued markets and lets admins queue them
 * for settlement or view their current status.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchPendingMarkets, resolveMarket } from '../api.js';

const styles = {
  container: { padding: '0 1rem' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1rem',
  },
  title: { fontSize: '1.25rem', fontWeight: 600 },
  refreshBtn: {
    padding: '0.4rem 0.9rem',
    background: '#334155',
    color: '#e2e8f0',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  th: {
    textAlign: 'left',
    padding: '0.6rem 0.8rem',
    background: '#1e293b',
    color: '#94a3b8',
    fontWeight: 500,
    borderBottom: '1px solid #334155',
  },
  td: {
    padding: '0.65rem 0.8rem',
    borderBottom: '1px solid #1e293b',
    verticalAlign: 'middle',
  },
  badge: (status) => ({
    display: 'inline-block',
    padding: '0.2rem 0.55rem',
    borderRadius: '12px',
    fontSize: '0.78rem',
    fontWeight: 600,
    background:
      status === 'settled'  ? '#166534' :
      status === 'disputed' ? '#7c2d12' :
      status === 'queued'   ? '#1e3a5f' : '#374151',
    color:
      status === 'settled'  ? '#86efac' :
      status === 'disputed' ? '#fca5a5' :
      status === 'queued'   ? '#93c5fd' : '#9ca3af',
  }),
  actionBtn: {
    padding: '0.35rem 0.75rem',
    background: '#0ea5e9',
    color: '#fff',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '0.8rem',
    marginRight: '0.4rem',
  },
  empty: { textAlign: 'center', padding: '2rem', color: '#64748b' },
  error: { color: '#f87171', padding: '0.5rem 0', fontSize: '0.85rem' },
};

export default function MarketList({ onSelectMarket }) {
  const [markets, setMarkets]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchPendingMarkets();
      setMarkets(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load markets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleQueue(market) {
    try {
      await resolveMarket(market.marketId, market.ticker, market.expiryDate);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to queue market');
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Pending Markets</span>
        <button style={styles.refreshBtn} onClick={load} disabled={loading}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {markets.length === 0 && !loading ? (
        <div style={styles.empty}>No pending markets found.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              {['ID', 'Ticker', 'Expiry', 'Status', 'Queued At', 'Actions'].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => (
              <tr key={m.marketId}>
                <td style={styles.td}>{m.marketId}</td>
                <td style={styles.td}><strong>{m.ticker}</strong></td>
                <td style={styles.td}>{m.expiryDate}</td>
                <td style={styles.td}>
                  <span style={styles.badge(m.status)}>{m.status}</span>
                </td>
                <td style={styles.td}>{m.queuedAt ? new Date(m.queuedAt).toLocaleString() : '—'}</td>
                <td style={styles.td}>
                  {m.status === 'pending' && (
                    <button style={styles.actionBtn} onClick={() => handleQueue(m)}>
                      Queue
                    </button>
                  )}
                  <button style={{ ...styles.actionBtn, background: '#475569' }} onClick={() => onSelectMarket(m)}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
