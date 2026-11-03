/*
 * Kbd — keyboard shortcut hint. <Kbd keys="Ctrl+K" /> or <Kbd keys={['Ctrl', 'Shift', 'P']} />.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function Kbd({ keys, className = '' }: { keys: string | string[]; className?: string }) {
  const list = Array.isArray(keys) ? keys : keys.split('+').map((k) => k.trim()).filter(Boolean);
  return (
    <span className={`kbd-group ${className}`} aria-label={list.join('+')}>
      {list.map((k, i) => (
        <kbd key={`${k}${i}`} className="kbd" aria-hidden="true">
          {k}
        </kbd>
      ))}
    </span>
  );
}
