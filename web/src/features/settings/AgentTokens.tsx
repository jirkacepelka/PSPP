/*
 * Profile > AI agents: personal access tokens that let the PSPP Studio MCP server open and update
 * the documents of this account. A token is shown once; only its hash is stored on the server.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { API_URL, createToken, deleteToken, listTokens, type AgentToken } from '../../lib/cloud';

export function AgentTokens() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<AgentToken[] | null>(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listTokens()
      .then(setTokens)
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await createToken(name.trim() || t('agents.defaultName'), 90);
      setFresh({ name: res.name, token: res.token });
      setName('');
      setCopied(false);
      load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const fmt = (ms: number) => new Date(ms).toLocaleDateString();
  const snippet = fresh ? `claude mcp add pspp-studio -e PSPP_STUDIO_TOKEN=${fresh.token} -- node /path/to/PSPP/mcp/dist/index.mjs` : '';

  return (
    <>
      <p className="acc-note ag-intro">{t('agents.intro')}</p>
      {fresh && (
        <div className="ag-fresh" role="status">
          <strong>{t('agents.copyNow', { name: fresh.name })}</strong>
          <code className="ag-token">{fresh.token}</code>
          <div className="ag-actions">
            <Button
              size="sm"
              iconStart={copied ? 'check' : 'content_copy'}
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.token).then(() => setCopied(true));
              }}
            >
              {copied ? t('agents.copied') : t('agents.copy')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>
              {t('agents.done')}
            </Button>
          </div>
          <p className="acc-note">{t('agents.connect')}</p>
          <code className="ag-token">{snippet}</code>
          <p className="acc-note">{t('agents.apiNote', { api: API_URL })}</p>
        </div>
      )}
      {tokens && tokens.length > 0 && (
        <ul className="ag-list">
          {tokens.map((tk) => (
            <li key={tk.id} className="ag-item">
              <Icon name="key" size={18} />
              <span className="ag-name">
                {tk.name}
                <small>{t('agents.meta', { created: fmt(tk.created_at), expires: fmt(tk.expires_at), used: tk.last_used_at ? fmt(tk.last_used_at) : t('agents.never') })}</small>
              </span>
              <Button
                size="sm"
                variant="ghost"
                iconStart="delete"
                onClick={() => {
                  void deleteToken(tk.id).then(load);
                }}
              >
                {t('agents.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="ag-create"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('agents.namePlaceholder')} aria-label={t('agents.namePlaceholder')} maxLength={60} />
        <Button type="submit" size="sm" iconStart="add" disabled={busy}>
          {t('agents.create')}
        </Button>
      </form>
      {error && (
        <p className="acc-error" role="alert">
          <Icon name="error" size={16} /> {t('account.err.server_error')}
        </p>
      )}
    </>
  );
}
