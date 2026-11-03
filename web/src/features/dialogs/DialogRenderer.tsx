/*
 * Generic renderer for declarative analysis dialogs.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import type { Variable } from '../../engine/types';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { pasteSyntax, runSyntax } from '../../app/engine';
import { manualUrl } from '../../app/help';
import { defaultValues, validateGeneric, walkFields, type DialogSpec, type Field, type RowsField, type Values, type VarFilter, type VarListField } from './types';
import { variableIcon } from '../../app/varIcons';

const lastValues = new Map<string, Values>();

function matchesFilter(v: Variable, f?: VarFilter) {
  if (!f || f === 'any') return true;
  return v.type === f;
}

/** Translates a label key; plain words (without a dot) are shown as-is. */
function useLabel() {
  const { t } = useTranslation();
  return (key: string | undefined) => (key ? (key.includes('.') ? t(key) : key) : '');
}

const EXPR_TOKENS = ['+', '-', '*', '/', '**', '(', ')', '=', '<>', '<', '>', '<=', '>=', 'AND', 'OR', 'NOT', 'MEAN()', 'SUM()', 'SQRT()', 'ABS()', 'RND()', 'LN()', 'EXP()', 'MISSING()'];

export function AnalysisDialog({
  spec,
}: {
  spec: DialogSpec;
  /** Field id → initial value (e.g. variables selected in the grid). TODO(WP3): apply. */
  preset?: Record<string, unknown>;
  /** Output entry that the run replaces (Edit / Re-run). TODO(WP3): pass to runSyntax. */
  replaceEntryId?: string;
}) {
  const { t } = useTranslation();
  const L = useLabel();
  const dataset = useData((s) => s.dataset);
  const closeModal = useUi((s) => s.closeModal);
  const variables = useMemo(() => dataset?.variables ?? [], [dataset]);
  const ctx = useMemo(() => ({ variables }), [variables]);
  const [values, setValues] = useState<Values>(() => {
    const prev = lastValues.get(spec.id);
    const base = defaultValues(spec);
    if (!prev) return base;
    // drop variables that no longer exist
    const names = new Set(variables.map((v) => v.name));
    const merged: Values = { ...base, ...prev };
    walkFields(spec.fields, (f) => {
      if (f.kind === 'varlist') merged[f.id] = ((merged[f.id] as string[]) ?? []).filter((n) => names.has(n));
    });
    return merged;
  });
  const [selectedSource, setSelectedSource] = useState<string[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<{ list: string; names: string[] } | null>(null);
  const [filter, setFilter] = useState('');
  const [sub, setSub] = useState<{ field: Field & { kind: 'subdialog' }; snapshot: Values } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const lastExpr = useRef<{ id: string; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const anchor = useRef<number>(-1);

  const set = (patch: Values) => {
    setError(null);
    setValues((v) => ({ ...v, ...patch }));
  };

  const varLists: VarListField[] = [];
  walkFields(spec.fields, (f) => {
    if (f.kind === 'varlist' && (!f.when || f.when(values))) varLists.push(f);
  });
  const used = new Set(varLists.flatMap((f) => (values[f.id] as string[]) ?? []));
  const hasVarlists = varLists.length > 0;
  const needsSource = hasVarlists || spec.fields.some(function has(f: Field): boolean {
    return (f.kind === 'text' && !!f.expression) || ((f.kind === 'group' || f.kind === 'subdialog') && f.fields.some(has));
  });
  const source = variables.filter(
    (v) =>
      matchesFilter(v, spec.source) &&
      !used.has(v.name) &&
      (!filter || v.name.toLowerCase().includes(filter.toLowerCase()) || v.label.toLowerCase().includes(filter.toLowerCase())),
  );

  const canAccept = (f: VarListField, names: string[]) => names.filter((n) => {
    const v = variables.find((x) => x.name === n);
    return v && matchesFilter(v, f.filter) && (!f.measures || f.measures.includes(v.measure));
  });

  const moveTo = (f: VarListField, names: string[]) => {
    const ok = canAccept(f, names);
    if (!ok.length) return;
    const cur = (values[f.id] as string[]) ?? [];
    const removedElsewhere: Values = {};
    for (const other of varLists) {
      if (other.id === f.id) continue;
      const list = (values[other.id] as string[]) ?? [];
      if (list.some((n) => ok.includes(n))) removedElsewhere[other.id] = list.filter((n) => !ok.includes(n));
    }
    let next = f.max === 1 ? [ok[0]] : [...cur, ...ok.filter((n) => !cur.includes(n))];
    if (f.max && f.max > 1) next = next.slice(0, f.max);
    set({ ...removedElsewhere, [f.id]: next });
    setSelectedSource([]);
  };

  const removeFrom = (f: VarListField, names: string[]) => {
    set({ [f.id]: ((values[f.id] as string[]) ?? []).filter((n) => !names.includes(n)) });
    setSelectedTarget(null);
  };

  const firstAccepting = (names: string[]) =>
    varLists.find((f) => {
      const cur = (values[f.id] as string[]) ?? [];
      return canAccept(f, names).length > 0 && (f.max !== 1 || cur.length === 0) && (!f.max || cur.length < f.max);
    }) ?? varLists.find((f) => canAccept(f, names).length > 0);

  const insertIntoExpression = (text: string) => {
    const target = lastExpr.current;
    if (!target) return false;
    const el = target.el;
    const cur = String(values[target.id] ?? '');
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    const needsSpace = start > 0 && !/\s|\($/.test(cur.slice(0, start)) ? ' ' : '';
    const ins = text.endsWith('()') ? text : `${needsSpace}${text} `;
    const next = cur.slice(0, start) + ins + cur.slice(end);
    set({ [target.id]: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + (text.endsWith('()') ? ins.length - 1 : ins.length);
      el.setSelectionRange(pos, pos);
    });
    return true;
  };

  const onSourceActivate = (names: string[]) => {
    if (!hasVarlists) {
      insertIntoExpression(names[0]);
      return;
    }
    if (lastExpr.current && document.activeElement === lastExpr.current.el) {
      insertIntoExpression(names[0]);
      return;
    }
    const f = firstAccepting(names);
    if (f) moveTo(f, names);
  };

  const validate = (): string | null => validateGeneric(spec, values) ?? spec.validate?.(values, ctx) ?? null;

  const syntax = (() => {
    try {
      return validate() ? '' : spec.toSyntax(values, ctx);
    } catch {
      return '';
    }
  })();

  const finish = (mode: 'run' | 'paste') => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    lastValues.set(spec.id, values);
    const s = spec.toSyntax(values, ctx);
    closeModal();
    if (mode === 'paste') pasteSyntax(s);
    else void runSyntax(s);
  };

  // ------------------------------------------------------------ field rendering
  const renderVarList = (f: VarListField) => {
    const list = (values[f.id] as string[]) ?? [];
    const single = f.max === 1;
    const sel = selectedTarget?.list === f.id ? selectedTarget.names : [];
    const canMoveIn = selectedSource.length > 0 && canAccept(f, selectedSource).length > 0;
    const moveOut = sel.length > 0;
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const names = JSON.parse(e.dataTransfer.getData('application/x-pspp-vars') || '[]') as string[];
      moveTo(f, names);
    };
    return (
      <div className={`dlg-target ${single ? 'single' : ''}`} key={f.id}>
        <button
          type="button"
          className="dlg-move"
          aria-label={moveOut ? t('dialogs.removeFrom', { list: L(f.label) }) : t('dialogs.moveTo', { list: L(f.label) })}
          data-tip={moveOut ? t('dialogs.remove') : t('dialogs.add')}
          disabled={!canMoveIn && !moveOut}
          onClick={() => (moveOut ? removeFrom(f, sel) : moveTo(f, selectedSource))}
        >
          <Icon name={moveOut ? 'arrow_back' : 'arrow_forward'} />
        </button>
        <div className="dlg-target-box">
          <div className="field-label" id={`lbl-${f.id}`}>
            {L(f.label)}
            {(f.min ?? 0) > 0 && <span className="req" aria-hidden="true"> *</span>}
          </div>
          <ul
            className={`var-list ${single ? 'single' : ''}`}
            role="listbox"
            aria-labelledby={`lbl-${f.id}`}
            aria-multiselectable={!single}
            tabIndex={0}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('drop');
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
            onDrop={(e) => {
              e.currentTarget.classList.remove('drop');
              onDrop(e);
            }}
            onKeyDown={(e) => {
              if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) removeFrom(f, sel);
            }}
          >
            {list.length === 0 && <li className="var-empty">{single ? t('dialogs.dropOne') : t('dialogs.dropHere')}</li>}
            {list.map((n) => {
              const v = variables.find((x) => x.name === n);
              const on = sel.includes(n);
              return (
                <li
                  key={n}
                  role="option"
                  aria-selected={on}
                  className={on ? 'on' : ''}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/x-pspp-vars', JSON.stringify([n]))}
                  onClick={(e) => {
                    const names = e.ctrlKey || e.metaKey ? (on ? sel.filter((x) => x !== n) : [...sel, n]) : [n];
                    setSelectedTarget({ list: f.id, names });
                    setSelectedSource([]);
                  }}
                  onDoubleClick={() => removeFrom(f, [n])}
                >
                  {v && <Icon name={variableIcon(v)} />}
                  <span className="var-name">{n}</span>
                  {v?.label && <span className="var-label">{v.label}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  };

  const renderRows = (f: RowsField) => {
    const list = ((values[f.id] as Record<string, string>[]) ?? []).length ? (values[f.id] as Record<string, string>[]) : [Object.fromEntries(f.columns.map((c) => [c.id, c.type === 'select' ? c.options?.[0]?.value ?? '' : '']))];
    const update = (i: number, col: string, val: string) => {
      const next = list.map((r, k) => (k === i ? { ...r, [col]: val } : r));
      set({ [f.id]: next });
    };
    const blank = () => Object.fromEntries(f.columns.map((c) => [c.id, c.type === 'select' ? c.options?.[0]?.value ?? '' : '']));
    return (
      <div className="field dlg-rows" key={f.id}>
        <span className="field-label">{L(f.label)}</span>
        <div className="rows-table" role="table" aria-label={L(f.label)}>
          <div className="rows-head" role="row" style={{ gridTemplateColumns: `${f.columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ')} 40px` }}>
            {f.columns.map((c) => (
              <span key={c.id} role="columnheader">{L(c.label)}</span>
            ))}
            <span />
          </div>
          {list.map((r, i) => (
            <div className="rows-row" role="row" key={i} style={{ gridTemplateColumns: `${f.columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ')} 40px` }}>
              {f.columns.map((c) => {
                const aria = `${L(c.label)} ${i + 1}`;
                if (c.type === 'variable')
                  return (
                    <select key={c.id} className="select" aria-label={aria} value={r[c.id] ?? ''} onChange={(e) => update(i, c.id, e.target.value)}>
                      <option value="">{t('dialogs.chooseVariable')}</option>
                      {variables.filter((v) => matchesFilter(v, c.filter)).map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.label ? `${v.name} – ${v.label}` : v.name}
                        </option>
                      ))}
                    </select>
                  );
                if (c.type === 'select')
                  return (
                    <select key={c.id} className="select" aria-label={aria} value={r[c.id] ?? ''} onChange={(e) => update(i, c.id, e.target.value)}>
                      {c.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.raw ? o.label : L(o.label)}
                        </option>
                      ))}
                    </select>
                  );
                return (
                  <input
                    key={c.id}
                    className="input"
                    aria-label={aria}
                    type={c.type === 'number' ? 'number' : 'text'}
                    placeholder={c.placeholder}
                    value={r[c.id] ?? ''}
                    onChange={(e) => update(i, c.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && i === list.length - 1) {
                        e.preventDefault();
                        set({ [f.id]: [...list, blank()] });
                      }
                    }}
                  />
                );
              })}
              <IconButton icon="delete" small label={t('dialogs.removeRow')} onClick={() => set({ [f.id]: list.filter((_, k) => k !== i) })} disabled={list.length <= 1 && (f.minRows ?? 0) > 0} />
            </div>
          ))}
        </div>
        <div>
          <button type="button" className="btn btn-text btn-sm" onClick={() => set({ [f.id]: [...list, blank()] })}>
            <Icon name="add" />
            {t('dialogs.addRow')}
          </button>
        </div>
        {f.hint && <span className="field-hint">{L(f.hint)}</span>}
      </div>
    );
  };

  const renderField = (f: Field, key: string | number): ReactNode => {
    if (f.when && !f.when(values)) return null;
    switch (f.kind) {
      case 'varlist':
        return null; // rendered in the variable area
      case 'checkbox':
        return (
          <label className="check" key={f.id}>
            <input type="checkbox" checked={Boolean(values[f.id])} onChange={(e) => set({ [f.id]: e.target.checked })} />
            {L(f.label)}
          </label>
        );
      case 'radio':
        return (
          <fieldset className={`dlg-fieldset ${f.inline ? 'inline' : ''}`} key={f.id}>
            <legend className="field-label">{L(f.label)}</legend>
            <div className="dlg-radios">
              {f.options.map((o) => (
                <label className="radio" key={o.value}>
                  <input type="radio" name={`${spec.id}-${f.id}`} value={o.value} checked={values[f.id] === o.value} onChange={() => set({ [f.id]: o.value })} />
                  {L(o.label)}
                </label>
              ))}
            </div>
          </fieldset>
        );
      case 'select':
        return (
          <div className="field" key={f.id}>
            <label htmlFor={`${spec.id}-${f.id}`}>{L(f.label)}</label>
            <select id={`${spec.id}-${f.id}`} className="select" value={String(values[f.id] ?? '')} onChange={(e) => set({ [f.id]: e.target.value })}>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.raw ? o.label : L(o.label)}
                </option>
              ))}
            </select>
          </div>
        );
      case 'number':
        return (
          <div className="field num-field" key={f.id}>
            <label htmlFor={`${spec.id}-${f.id}`}>{L(f.label)}</label>
            <input
              id={`${spec.id}-${f.id}`}
              className="input"
              type="number"
              inputMode="decimal"
              min={f.min}
              max={f.max}
              step={f.step ?? 'any'}
              value={values[f.id] === null || values[f.id] === undefined ? '' : String(values[f.id])}
              onChange={(e) => set({ [f.id]: e.target.value === '' ? null : Number(e.target.value) })}
            />
            {f.hint && <span className="field-hint">{L(f.hint)}</span>}
          </div>
        );
      case 'text': {
        const common = {
          id: `${spec.id}-${f.id}`,
          className: `${f.multiline ? 'textarea' : 'input'} ${f.mono ? 'mono' : ''}`,
          placeholder: f.placeholder,
          value: String(values[f.id] ?? ''),
          spellCheck: false,
          onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            if (f.expression) lastExpr.current = { id: f.id, el: e.currentTarget };
          },
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ [f.id]: e.target.value }),
        };
        return (
          <div className="field" key={f.id}>
            <label htmlFor={common.id}>{L(f.label)}</label>
            {f.multiline ? <textarea {...common} rows={3} /> : <input {...common} />}
            {f.expression && (
              <div className="expr-tokens" aria-label={t('dialogs.insertToken')}>
                {EXPR_TOKENS.map((tok) => (
                  <button
                    key={tok}
                    type="button"
                    className="chip"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const el = document.getElementById(common.id) as HTMLInputElement | null;
                      if (el) lastExpr.current = { id: f.id, el };
                      insertIntoExpression(tok);
                    }}
                  >
                    {tok}
                  </button>
                ))}
              </div>
            )}
            {f.hint && <span className="field-hint">{L(f.hint)}</span>}
          </div>
        );
      }
      case 'rows':
        return renderRows(f);
      case 'group': {
        const children = f.fields.map((c, i) => renderField(c, i)).filter(Boolean);
        if (!children.length) return null;
        return (
          <fieldset className={`dlg-group cols-${f.columns ?? 1}`} key={`g${key}`}>
            {f.label && <legend className="field-label">{L(f.label)}</legend>}
            <div className="dlg-group-body">{children}</div>
          </fieldset>
        );
      }
      case 'subdialog':
        return null;
      case 'info':
        return (
          <p className="dlg-info" key={`i${key}`}>
            <Icon name="info" />
            {L(f.label)}
          </p>
        );
    }
  };

  const subdialogs = spec.fields.filter((f): f is Field & { kind: 'subdialog' } => f.kind === 'subdialog' && (!f.when || f.when(values)));
  const otherFields = spec.fields.filter((f) => f.kind !== 'varlist' && f.kind !== 'subdialog');

  const onSourceKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'Enter' && selectedSource.length) {
      e.preventDefault();
      onSourceActivate(selectedSource);
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = source.findIndex((v) => v.name === selectedSource[selectedSource.length - 1]);
      const next = Math.max(0, Math.min(source.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      if (source[next]) {
        setSelectedSource(e.shiftKey ? [...new Set([...selectedSource, source[next].name])] : [source[next].name]);
        setSelectedTarget(null);
        anchor.current = next;
        (e.currentTarget.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  const errorText = error ? (error.includes('.') ? t(error) : error) : null;

  return (
    <>
      <Dialog
        title={t(spec.title)}
        icon={spec.icon}
        size={spec.size ?? (needsSource ? 'wide' : 'normal')}
        onClose={closeModal}
        className="analysis-dialog"
        initialFocus={needsSource ? '.var-list.source' : undefined}
        footer={
          <>
            <button type="button" className="btn btn-text" onClick={() => window.open(manualUrl(spec.command), '_blank', 'noopener')}>
              <Icon name="help" />
              {t('dialogs.help')}
            </button>
            <button
              type="button"
              className="btn btn-text"
              onClick={() => {
                setValues(defaultValues(spec));
                setError(null);
                lastValues.delete(spec.id);
              }}
            >
              {t('dialogs.reset')}
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-text" onClick={closeModal}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-outlined" onClick={() => finish('paste')} data-tip={t('dialogs.pasteHint')}>
              <Icon name="content_paste_go" />
              {t('dialogs.paste')}
            </button>
            <button type="button" className="btn btn-filled" onClick={() => finish('run')} disabled={!dataset && hasVarlists}>
              <Icon name="play_arrow" />
              {t('dialogs.ok')}
            </button>
          </>
        }
      >
        <div className={`dlg-layout ${needsSource ? 'with-source' : ''}`}>
          {needsSource && (
            <div className="dlg-source">
              <div className="field-label" id={`src-${spec.id}`}>
                {t('dialogs.variables')} <span className="badge">{source.length}</span>
              </div>
              <div className="dlg-search">
                <Icon name="search" />
                <input className="input" placeholder={t('dialogs.filterVariables')} aria-label={t('dialogs.filterVariables')} value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <ul className="var-list source" role="listbox" aria-labelledby={`src-${spec.id}`} aria-multiselectable="true" tabIndex={0} onKeyDown={onSourceKey} aria-activedescendant={selectedSource.length ? `src-${spec.id}-${selectedSource[selectedSource.length - 1]}` : undefined}>
                {variables.length === 0 && <li className="var-empty">{t('dialogs.noData')}</li>}
                {source.map((v, i) => {
                  const on = selectedSource.includes(v.name);
                  return (
                    <li
                      key={v.name}
                      id={`src-${spec.id}-${v.name}`}
                      role="option"
                      aria-selected={on}
                      className={on ? 'on' : ''}
                      title={v.label ? `${v.name}: ${v.label}` : v.name}
                      draggable
                      onDragStart={(e) => {
                        const names = on ? selectedSource : [v.name];
                        e.dataTransfer.setData('application/x-pspp-vars', JSON.stringify(names));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onMouseDown={(e) => {
                        if (lastExpr.current && document.activeElement === lastExpr.current.el) e.preventDefault();
                      }}
                      onClick={(e) => {
                        setSelectedTarget(null);
                        if (e.shiftKey && anchor.current >= 0) {
                          const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
                          setSelectedSource(source.slice(a, b + 1).map((x) => x.name));
                        } else if (e.ctrlKey || e.metaKey) {
                          setSelectedSource(on ? selectedSource.filter((x) => x !== v.name) : [...selectedSource, v.name]);
                          anchor.current = i;
                        } else {
                          setSelectedSource([v.name]);
                          anchor.current = i;
                        }
                      }}
                      onDoubleClick={() => onSourceActivate([v.name])}
                    >
                      <Icon name={variableIcon(v)} />
                      <span className="var-name">{v.name}</span>
                      {v.label && <span className="var-label">{v.label}</span>}
                    </li>
                  );
                })}
              </ul>
              {!hasVarlists && <span className="field-hint">{t('dialogs.doubleClickInsert')}</span>}
            </div>
          )}
          <div className="dlg-main">
            {hasVarlists && <div className="dlg-targets">{varLists.map((f) => renderVarList(f))}</div>}
            <div className="dlg-fields">{otherFields.map((f, i) => renderField(f, i))}</div>
            {subdialogs.length > 0 && (
              <div className="dlg-subbuttons">
                {subdialogs.map((f) => (
                  <button key={f.id} type="button" className="btn btn-tonal btn-sm" onClick={() => setSub({ field: f, snapshot: values })}>
                    {f.icon && <Icon name={f.icon} />}
                    {L(f.label)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {errorText && (
          <div className="dlg-error" role="alert">
            <Icon name="error" />
            {errorText}
          </div>
        )}
        <div className="dlg-preview">
          <button type="button" className="btn btn-text btn-sm" aria-expanded={showPreview} onClick={() => setShowPreview(!showPreview)}>
            <Icon name={showPreview ? 'expand_less' : 'code'} />
            {t('dialogs.preview')}
          </button>
          {showPreview && <pre className="syntax-preview">{syntax || t('dialogs.previewIncomplete')}</pre>}
        </div>
      </Dialog>
      {sub && (
        <Dialog
          title={`${t(spec.title)} · ${L(sub.field.label).replace(/…$/, '')}`}
          icon={sub.field.icon}
          size="normal"
          onClose={() => {
            setValues(sub.snapshot);
            setSub(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-text"
                onClick={() => {
                  setValues(sub.snapshot);
                  setSub(null);
                }}
              >
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-filled" onClick={() => setSub(null)}>
                {t('dialogs.continue')}
              </button>
            </>
          }
        >
          <div className="dlg-fields">{sub.field.fields.map((f, i) => renderField(f, i))}</div>
        </Dialog>
      )}
    </>
  );
}
