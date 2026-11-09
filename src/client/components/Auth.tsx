import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { Field } from './ui';

type Mode = 'login' | 'setup' | 'invite';

export function AuthScreen() {
  const { auth, refreshAuth } = useStore();
  const [mode, setMode] = useState<Mode>(auth?.needsSetup ? 'setup' : 'login');
  const [f, setF] = useState({ username: '', displayName: '', password: '', confirm: '', code: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const submit = async () => {
    setError(null);
    if (mode !== 'login' && f.password !== f.confirm) return setError('Les deux mots de passe ne correspondent pas.');
    setBusy(true);
    try {
      if (mode === 'login') await api('/auth/login', { body: { username: f.username, password: f.password } });
      if (mode === 'setup') await api('/auth/setup', { body: { username: f.username, displayName: f.displayName || 'Ange', password: f.password } });
      if (mode === 'invite') await api('/auth/accept-invite', { body: { code: f.code, username: f.username, displayName: f.displayName || 'Kelly', password: f.password } });
      await refreshAuth();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div>
          <div className="auth-brand"><div className="brand-mark">M</div>ANGE'S MNY</div>
          <p className="muted small">Your money. Your control. Your future.</p>
        </div>
        <div>
          <h2 style={{ fontSize: 20 }}>{mode === 'login' ? 'Connexion' : mode === 'setup' ? 'Créer ton accès' : 'Rejoindre avec une invitation'}</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            {mode === 'setup' && 'Premier lancement : crée ton accès personnel. Tu pourras ensuite inviter Kelly, qui aura son propre accès.'}
            {mode === 'invite' && 'Saisis le code reçu. Ton accès sera personnel : tu choisiras toi-même ce que tu partages.'}
            {mode === 'login' && 'Accès personnel et sécurisé.'}
          </p>
        </div>
        {mode === 'invite' && <Field label="Code d'invitation"><input value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="XXXX-XXXX-XXXX" autoComplete="one-time-code" required /></Field>}
        {mode !== 'login' && <Field label="Prénom affiché"><input value={f.displayName} onChange={(e) => set({ displayName: e.target.value })} placeholder={mode === 'setup' ? 'Ange' : 'Kelly'} /></Field>}
        <Field label="Identifiant"><input value={f.username} onChange={(e) => set({ username: e.target.value })} autoComplete="username" autoCapitalize="none" required /></Field>
        <Field label="Mot de passe" hint={mode !== 'login' ? '10 caractères minimum, avec au moins une lettre et un chiffre.' : undefined}>
          <input type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
        </Field>
        {mode !== 'login' && <Field label="Confirmer le mot de passe"><input type="password" value={f.confirm} onChange={(e) => set({ confirm: e.target.value })} autoComplete="new-password" required /></Field>}
        {error && <div className="banner danger small" role="alert">⚠️ {error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center', padding: '12px' }}>
          {busy ? '…' : mode === 'login' ? 'Se connecter' : 'Créer mon accès'}
        </button>
        {!auth?.needsSetup && (
          <button type="button" className="btn btn-ghost small" onClick={() => { setError(null); setMode(mode === 'invite' ? 'login' : 'invite'); }}>
            {mode === 'invite' ? '← J\'ai déjà un accès' : 'J\'ai reçu un code d\'invitation'}
          </button>
        )}
        <p className="small muted center">🔒 Aucun identifiant bancaire n'est jamais demandé dans Ange's MNY.</p>
      </form>
    </div>
  );
}
