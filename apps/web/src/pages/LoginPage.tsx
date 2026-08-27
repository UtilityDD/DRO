import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

const ICON = '/icons/icon-512.png';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [pin, setPin] = useState('1234');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-backdrop" aria-hidden />
        <div className="login-shell login-shell-boot">
          <div className="login-art-wrap" aria-hidden>
            <img className="login-art" src={ICON} alt="" />
            <div className="login-art-fade" />
          </div>
          <div className="login-card">
            <div className="loading-spinner" aria-label="Loading" />
            <p className="login-lead">Starting DRO…</p>
          </div>
        </div>
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
      <div className="login-backdrop" aria-hidden />
      <div className="login-shell">
        <div className="login-art-wrap" aria-hidden>
          <img className="login-art" src={ICON} alt="" />
          <div className="login-art-fade" />
        </div>
        <form className="login-card" onSubmit={onSubmit}>
          <header className="login-copy">
            <p className="login-brand">DRO Insights</p>
            <h1>Sign in</h1>
          </header>
          <label className="login-field">
            <input
              id="username"
              placeholder=" "
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              inputMode="text"
              enterKeyHint="next"
            />
            <span>Username</span>
          </label>
          <label className="login-field">
            <input
              id="pin"
              placeholder=" "
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="current-password"
              enterKeyHint="go"
            />
            <span>PIN</span>
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Continue'}
          </button>
          <div className="hint">Demo: admin/1234 · region/3410 · stown/3412 · hakim/2502</div>
        </form>
      </div>
    </div>
  );
}
