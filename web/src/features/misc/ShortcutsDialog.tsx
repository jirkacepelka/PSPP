/* SPDX-License-Identifier: GPL-3.0-or-later */
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { ACTIONS, formatShortcut } from '../../app/actions';
import { useUi } from '../../store/ui';

const EXTRA: [string, string][] = [
  ['Shift+Mod+Enter', 'actions.runAll'],
  ['Mod+Space', 'shortcuts.autocomplete'],
  ['Enter', 'shortcuts.editCell'],
  ['Escape', 'shortcuts.cancelEdit'],
  ['Shift+Arrow', 'shortcuts.extendSelection'],
];

export function ShortcutsList() {
  const { t } = useTranslation();
  const list = ACTIONS.filter((a) => a.shortcut);
  return (
    <table className="shortcuts">
      <tbody>
        {list.map((a) => (
          <tr key={a.id}>
            <td>{t(a.label)}</td>
            <td>
              <kbd className="kbd">{formatShortcut(a.shortcut)}</kbd>
            </td>
          </tr>
        ))}
        {EXTRA.map(([k, l]) => (
          <tr key={k}>
            <td>{t(l)}</td>
            <td>
              <kbd className="kbd">{formatShortcut(k)}</kbd>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ShortcutsDialog() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeModal);
  return (
    <Dialog title={t('actions.shortcuts')} icon="keyboard" onClose={close}>
      <ShortcutsList />
    </Dialog>
  );
}
