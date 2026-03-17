/**
 * SettlementPanel – allows admins to:
 *   - View full status of a selected market
 *   - Mark a queued market as settled (with optional TX hash)
 *   - Open a dispute on a settled market
 */

import { useState } from 'react';
import { fetchMarketStatus, markSettled, disputeMarket } from '../api.js';

const s = {
  container: {
    background: '#1e293b',
    borderRadius: '10px',
    padding: '1.5rem',
  },
  title: { fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' },
  row: { marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' },
  label: { color: '#94a3b8', minWidth: '110px', fontSize: '0.85rem', paddingTop: '0.1rem' },
  value: { fontSize: '0.9rem' },
  input: {
    padding: '0.45rem 0.75rem',
    background: '#0f172a',
    color: '#e2e8f0',
    border: '1px solid #334155',
    borderRadius: '6px',
    fontSize: '0.9rem',
    flex: 1,
    minWidth: '200px',
  },
  btn: (color) => ({
    padding: '0.45rem 1rem',
    background: color,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
  }),
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
  success: { color: '#86efac', fontSize: '0.85rem', marginTop: '0.5rem' },
  error:   { color: '#f87171', fontSize: '0.85rem', marginTop: '0.5rem' },
  divider: { borderColor: '#334155', margin: '1rem 0' },
  sectionTitle: { color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' },
};

function Field({ label, children }) {
  return (
    <div style={s.row}>
      <span style={s.label}>{label}</span>
      <span style={s.value}>{children}</span>
    </div>
  );
}

export default function SettlementPanel({ market, onBack, onUpdate }) {
  const [m, setM]             = useState(market);
  const [txHash, setTxHash]   = useState('');
  const [reason, setReason]   = useState('');
  const [message, setMessage] = useState('');
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState(false);

  async function refresh() {
    try {
      const updated = await fetchMarketStatus(m.marketId);
      setM(updated);
      if (onUpdate) onUpdate(updated);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function handleSettle() {
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await markSettled(m.marketId, txHash || undefined);
      setM(result.market);
      setMessage('Market marked as settled.');
      if (onUpdate) onUpdate(result.market);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to mark settled');
    } finally {
      setBusy(false);
    }
  }

  async function handleDispute() {
    if (!reason.trim()) { setError('Dispute reason is required'); return; }
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await disputeMarket(m.marketId, reason);
      setM(result.market);
      setMessage('Dispute opened.');
      if (onUpdate) onUpdate(result.market);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to open dispute');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={s.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <span style={s.title}>Market {m.marketId} — {m.ticker}</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button style={s.btn('#334155')} onClick={refresh}>↻ Refresh</button>
          <button style={s.btn('#475569')} onClick={onBack}>← Back</button>
        </div>
      </div>

      {/* Status overview */}
      <div style={s.sectionTitle}>Status</div>
      <Field label="Market ID">{m.marketId}</Field>
      <Field label="Ticker"><strong>{m.ticker}</strong></Field>
      <Field label="Expiry">{m.expiryDate}</Field>
      <Field label="Status"><span style={s.badge(m.status)}>{m.status}</span></Field>
      {m.txHash    && <Field label="TX Hash"><code style={{ fontSize: '0.8rem' }}>{m.txHash}</code></Field>}
      {m.settledAt && <Field label="Settled At">{new Date(m.settledAt).toLocaleString()}</Field>}
      {m.queuedAt  && <Field label="Queued At">{new Date(m.queuedAt).toLocaleString()}</Field>}

      {m.disputed && (
        <>
          <hr style={s.divider} />
          <div style={s.sectionTitle}>Dispute</div>
          <Field label="Disputer"><code style={{ fontSize: '0.8rem' }}>{m.disputer}</code></Field>
          <Field label="Reason">{m.disputeReason}</Field>
          <Field label="Disputed At">{m.disputedAt ? new Date(m.disputedAt).toLocaleString() : '—'}</Field>
        </>
      )}

      <hr style={s.divider} />

      {/* Actions */}
      {m.status === 'queued' && (
        <>
          <div style={s.sectionTitle}>Approve Settlement</div>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
            After the oracle bot submits the on-chain transaction, paste the TX hash and click Settle.
          </p>
          <div style={s.row}>
            <input
              style={s.input}
              placeholder="TX hash (optional)"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
            />
            <button style={s.btn('#16a34a')} onClick={handleSettle} disabled={busy}>
              {busy ? 'Settling…' : 'Mark Settled'}
            </button>
          </div>
        </>
      )}

      {m.status === 'settled' && (
        <>
          <div style={s.sectionTitle}>Open Dispute</div>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
            Disputes must be raised within 48 hours of settlement.
          </p>
          <div style={s.row}>
            <input
              style={s.input}
              placeholder="Reason for dispute"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button style={s.btn('#dc2626')} onClick={handleDispute} disabled={busy}>
              {busy ? 'Submitting…' : 'Open Dispute'}
            </button>
          </div>
        </>
      )}

      {message && <div style={s.success}>{message}</div>}
      {error   && <div style={s.error}>{error}</div>}
    </div>
  );
}
