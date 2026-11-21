'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import shattanaLogo from '../../shattana-logo.png';

export function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      setError('Use HTTPS to access moderation.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/moderation/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error);
      }
      window.location.replace('/moderation');
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  return <main className="shell workspace admin-sign-in">
    <div className="panel">
      <form className="card" onSubmit={signIn}>
        <div className="card-head">
          <Image className="admin-logo" src={shattanaLogo} width={56} height={56} alt="Shattana!" />
          <h1>Admin sign in</h1>
        </div>
        <div className="fields">
          <label>Username
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required
              maxLength={128} value={username} onChange={event => setUsername(event.target.value)} />
          </label>
          <label>Password
            <input name="password" type="password" autoComplete="current-password" required
              maxLength={256} value={password} onChange={event => setPassword(event.target.value)} />
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={18} /></button>
        <a className="admin-back" href="/">Back to Shattana</a>
      </form>
    </div>
  </main>;
}
