/*
 * Optional online account (closed beta, invitation only): sign in, create an account, see the
 * storage used, sign out. The app works fully without it.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { Segmented } from '../../components/Segmented';
import { ApiError } from '../../lib/cloud';
import { signIn, signOut } from '../../app/cloud';
import { useAccount } from '../../store/account';
import { useUi } from '../../store/ui';
import './misc.css';

const mb = (bytes: number) => (bytes / 1_048_576).toLocaleString(undefined, { maximumFractionDigits: 1 });

export function AccountDialog() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  const user = useAccount((s) => s.user);
  const usage = useAccount((s) => s.usage);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(mode, email.trim(), password, invite.trim());
      close();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'server_error';
      const known = ['bad_credentials', 'bad_email', 'weak_password', 'invalid_invite', 'bad_invite', 'email_taken', 'beta_full', 'too_many_attempts', 'network'];
      setError(t(`account.err.${known.includes(code) ? code : 'server_error'}`));
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    const pct = usage ? Math.min(100, Math.round((usage.used / Math.max(1, usage.quota)) * 100)) : 0;
    return (
      <Dialog
        title={t('account.title')}
        description={user.email}
        icon="cloud_done"
        size="small"
        onClose={close}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={close}>{t('common.close')}</button>
            <button type="button" className="btn" onClick={() => void signOut().then(close)}>{t('account.signOut')}</button>
          </>
        }
      >
        <p className="acc-note">{t('account.signedInNote')}</p>
        {usage && (
          <div className="acc-usage">
            <div className="acc-usage-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('account.storage')}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="acc-usage-text">{t('account.used', { used: mb(usage.used), quota: mb(usage.quota) })}</span>
          </div>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      title={t('account.title')}
      description={t('account.optional')}
      icon="cloud"
      size="small"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close}>{t('common.cancel')}</button>
          <button type="submit" form="acc-form" className="btn btn-primary" disabled={busy}>
            {mode === 'login' ? t('account.signIn') : t('account.create')}
          </button>
        </>
      }
    >
      <form
        id="acc-form"
        className="dlg-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Segmented
          aria-label={t('account.title')}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setError(null);
          }}
          options={[
            { value: 'login', label: t('account.signIn') },
            { value: 'register', label: t('account.create') },
          ]}
        />
        <div className="field">
          <label htmlFor="acc-email">{t('account.email')}</label>
          <input id="acc-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-autofocus />
        </div>
        <div className="field">
          <label htmlFor="acc-pw">{t('account.password')}</label>
          <input id="acc-pw" className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required />
          {mode === 'register' && <span className="acc-note">{t('account.passwordHelp')}</span>}
        </div>
        {mode === 'register' && (
          <div className="field">
            <label htmlFor="acc-invite">{t('account.invite')}</label>
            <input id="acc-invite" className="input" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" required />
            <span className="acc-note">{t('account.inviteHelp')}</span>
          </div>
        )}
        {error && (
          <p className="acc-error" role="alert">
            <Icon name="error" size={16} /> {error}
          </p>
        )}
        <p className="acc-note">{t('account.privacy')}</p>
      </form>
    </Dialog>
  );
}
