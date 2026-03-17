import { useState } from 'react';
import { login, logout, getToken } from './api.js';
import MarketList from './components/MarketList.jsx';
import SettlementPanel from './components/SettlementPanel.jsx';

const s = {
  wrapper:  { maxWidth: '960px', margin: '0 auto', padding: '2rem 1rem' },
  header:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', borderBottom: '1px solid #1e293b', paddingBottom: '1rem' },
  logo:     { fontSize: '1.3rem', fontWeight: 700, color: '#38bdf8' },
  logoutBtn:{ padding: '0.4rem 0.9rem', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' },
  loginCard:{ background: '#1e293b', borderRadius: '10px', padding: '2rem', maxWidth: '380px', margin: '4rem auto' },
  loginTitle:{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '1.5rem', textAlign: 'center' },
  label:    { display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.3rem' },
  input:    { width: '100%', padding: '0.5rem 0.75rem', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '6px', fontSize: '0.9rem', marginBottom: '1rem' },
  loginBtn: { width: '100%', padding: '0.55rem', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600 },
  error:    { color: '#f87171', fontSize: '0.85rem', marginTop: '0.75rem', textAlign: 'center' },
};

function LoginForm({ onLoggedIn }) {
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await login(email, password);
      onLoggedIn();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.loginCard}>
      <div style={s.loginTitle}>Admin Login</div>
      <form onSubmit={handleSubmit}>
        <label style={s.label}>Email</label>
        <input style={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <label style={s.label}>Password</label>
        <input style={s.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button style={s.loginBtn} type="submit" disabled={loading}>{loading ? 'Logging in…' : 'Login'}</button>
      </form>
      {error && <div style={s.error}>{error}</div>}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed]           = useState(!!getToken());
  const [selectedMarket, setSelected] = useState(null);

  function handleLogout() {
    logout();
    setAuthed(false);
    setSelected(null);
  }

  if (!authed) {
    return <LoginForm onLoggedIn={() => setAuthed(true)} />;
  }

  return (
    <div style={s.wrapper}>
      <header style={s.header}>
        <span style={s.logo}>⚡ Prediction Market Admin</span>
        <button style={s.logoutBtn} onClick={handleLogout}>Logout</button>
      </header>

      {selectedMarket ? (
        <SettlementPanel
          market={selectedMarket}
          onBack={() => setSelected(null)}
          onUpdate={(updated) => setSelected(updated)}
        />
      ) : (
        <MarketList onSelectMarket={setSelected} />
      )}
    </div>
  );
}
