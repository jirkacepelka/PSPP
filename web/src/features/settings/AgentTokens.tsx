/*
 * Profile > AI assistants: how to add PSPP Studio as a connector in Claude (or another MCP client),
 * and the apps that are connected to this account, each revocable.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { API_URL, deleteToken, listTokens, type AgentToken } from '../../lib/cloud';

export function AgentTokens() {
  const { t } = useTranslation();
  const [apps, setApps] = useState<AgentToken[] | null>(null);
  const [copied, setCopied] = useState(false);
  const url = `${API_URL}/mcp`;

  const load = useCallback(() => {
    listTokens()
      .then(setApps)
      .catch(() => setApps([]));
  }, []);
  useEffect(load, [load]);

  const fmt = (ms: number) => new Date(ms).toLocaleDateString();

  return (
    <>
      <p className="acc-note ag-intro">{t('agents.intro')}</p>
      <ol className="ag-steps">
        <li>{t('agents.step1')}</li>
        <li>{t('agents.step2')}</li>
        <li>{t('agents.step3')}</li>
      </ol>
      <div className="ag-url">
        <code className="ag-token">{url}</code>
        <Button
          size="sm"
          iconStart={copied ? 'check' : 'content_copy'}
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
        >
          {copied ? t('agents.copied') : t('agents.copy')}
        </Button>
      </div>
      <p className="acc-note ag-intro">{t('agents.plan')}</p>
      {apps && apps.length > 0 && (
        <>
          <h5 className="ag-sub">{t('agents.connected')}</h5>
          <ul className="ag-list">
            {apps.map((app) => (
              <li key={app.id} className="ag-item">
                <Icon name="link" size={18} />
                <span className="ag-name">
                  {app.name}
                  <small>{t('agents.meta', { created: fmt(app.created_at), used: app.last_used_at ? fmt(app.last_used_at) : t('agents.never') })}</small>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  iconStart="link_off"
                  onClick={() => {
                    void deleteToken(app.id).then(load);
                  }}
                >
                  {t('agents.disconnect')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
