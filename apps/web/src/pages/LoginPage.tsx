import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [pin, setPin] = useState('1234');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="login-page">
        <div className="loading-spinner" aria-label="Loading" />
        <p className="muted" style={{ marginTop: 16 }}>Starting DRO…</p>
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="app-bar-brand" style={{ display: 'grid', marginBottom: '0.75rem' }}>
          DRO
        </div>
        <h1>Sign in</h1>
        <p>Darjeeling Region operations</p>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          inputMode="text"
          enterKeyHint="next"
        />
        <label htmlFor="pin">PIN</label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoComplete="current-password"
          enterKeyHint="go"
        />
        {error && <p className="error">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Continue'}
        </button>
        <div className="hint">
          Demo: admin/1234 · region/3410 · stown/3412 · hakim/2502
        </div>
      </form>
    </div>
  );
}
