/*
 * Overlay editors for the Data View: a plain text editor and a value-label picker
 * (combobox: type-ahead over codes and labels, still accepts any typed code) — DV-2, A-18.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ProvideEditorComponent } from '@glideapps/glide-data-grid';
import i18n from '../../i18n';
import type { DataCell } from './dataCell';
import { filterOptions, fold } from './pick';
import { Icon } from '../../components/Icon';

type EditorProps = Parameters<ProvideEditorComponent<DataCell>>[0];

function ariaName(cell: DataCell): string {
  const d = cell.data;
  return i18n.t('dataView.editorAria', { name: d.name ?? i18n.t('dataView.newVariable'), row: d.row + 1 });
}

const with_ = (cell: DataCell, raw: string): DataCell => ({ ...cell, data: { ...cell.data, raw }, copyData: raw });

export function TextEditor({ value, initialValue, onChange }: EditorProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialValue ?? value.data.raw);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (initialValue === undefined) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [initialValue]);
  return (
    <input
      ref={ref}
      className="data-editor-input"
      aria-label={ariaName(value)}
      value={text}
      style={{ textAlign: value.data.align === 'right' ? 'right' : 'left' }}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => {
        setText(e.target.value);
        onChange(with_(value, e.target.value));
      }}
    />
  );
}

export function LabelPickerEditor({ value, initialValue, onChange, onFinishedEditing, target }: EditorProps) {
  const d = value.data;
  const options = d.options ?? [];
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState(initialValue ?? '');
  const filtered = useMemo(() => filterOptions(options, query), [options, query]);
  const exact = query.trim() !== '' && options.some((o) => fold(o.code) === fold(query.trim()) || fold(o.label) === fold(query.trim()));
  const showOther = query.trim() !== '' && !exact;
  // rows: filtered options, then "use typed value", then "clear"
  const rows = filtered.length + (showOther ? 1 : 0) + 1;
  const currentIndex = options.findIndex((o) => o.code === d.raw);
  const [active, setActive] = useState(() => (initialValue ? 0 : Math.max(0, currentIndex)));

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const valueAt = (i: number): string | null => {
    if (i < filtered.length) return filtered[i].code;
    if (showOther && i === filtered.length) return query.trim();
    if (i === rows - 1) return '';
    return null;
  };
  const commit = (raw: string, movement: readonly [-1 | 0 | 1, -1 | 0 | 1]) => onFinishedEditing(with_(value, raw), movement);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const move = (to: number) => {
      e.preventDefault();
      e.stopPropagation();
      setActive(Math.max(0, Math.min(rows - 1, to)));
    };
    if (e.key === 'ArrowDown') move(active + 1);
    else if (e.key === 'ArrowUp') move(active - 1);
    else if (e.key === 'PageDown') move(active + 8);
    else if (e.key === 'PageUp') move(active - 8);
    else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const v = valueAt(active);
      const raw = v ?? query.trim();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.key === 'Tab' ? [e.shiftKey ? -1 : 1, 0] : [0, e.shiftKey ? -1 : 1];
      commit(raw, movement);
    }
  };

  const width = Math.max(target.width, 260);
  return (
    <div className="data-picker" style={{ width }}>
      <input
        ref={inputRef}
        className="data-picker-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={`${listId}-${active}`}
        aria-label={ariaName(value)}
        placeholder={i18n.t('dataView.pickerPlaceholder')}
        value={query}
        spellCheck={false}
        autoComplete="off"
        style={{ height: target.height }}
        onChange={(e) => {
          const q = e.target.value;
          setQuery(q);
          setActive(0);
          const f = filterOptions(options, q);
          // a click outside commits the best guess
          onChange(with_(value, q.trim() === '' ? d.raw : f[0]?.code ?? q.trim()));
        }}
        onKeyDown={onKeyDown}
      />
      <ul ref={listRef} id={listId} role="listbox" className="data-picker-list" aria-label={i18n.t('dataView.pickerList')}>
        {filtered.map((o, i) => (
          <li
            key={o.code}
            id={`${listId}-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === active}
            className={`data-picker-option ${i === active ? 'active' : ''} ${o.code === d.raw ? 'current' : ''}`}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => commit(o.code, [0, 1])}
            onPointerEnter={() => setActive(i)}
          >
            <span className="data-picker-code">{o.code}</span>
            <span className={`data-picker-label ${o.missing ? 'missing' : ''}`}>{o.label}</span>
            {o.missing && <span className="data-picker-tag">{i18n.t('dataView.missingTag')}</span>}
            {o.code === d.raw && <Icon name="check" className="data-picker-check" />}
          </li>
        ))}
        {showOther && (
          <li
            id={`${listId}-${filtered.length}`}
            data-index={filtered.length}
            role="option"
            aria-selected={active === filtered.length}
            className={`data-picker-option other ${active === filtered.length ? 'active' : ''}`}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => commit(query.trim(), [0, 1])}
            onPointerEnter={() => setActive(filtered.length)}
          >
            {i18n.t('dataView.useTyped', { value: query.trim() })}
          </li>
        )}
        <li
          id={`${listId}-${rows - 1}`}
          data-index={rows - 1}
          role="option"
          aria-selected={active === rows - 1}
          className={`data-picker-option clear ${active === rows - 1 ? 'active' : ''}`}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => commit('', [0, 1])}
          onPointerEnter={() => setActive(rows - 1)}
        >
          {i18n.t('dataView.clearValue')}
        </li>
      </ul>
      <div className="data-picker-hint" aria-hidden="true">
        {i18n.t('dataView.pickerHint')}
      </div>
    </div>
  );
}
