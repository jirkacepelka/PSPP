/*
 * Living style guide for the "Klidná pracovní plocha" (Calm Workspace) design system.
 * Open the app with ?styleguide (optionally &theme=dark&accent=teal&density=compact).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  Counter,
  Dialog,
  Divider,
  EmptyState,
  FilterChip,
  Icon,
  IconButton,
  Kbd,
  MeasureChip,
  MeasureIcon,
  MenuButton,
  NumberField,
  Panel,
  Popover,
  RadioGroup,
  Segmented,
  Select,
  StatusChip,
  Switch,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
  Toast,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  ToolbarSpacer,
  Tooltip,
  ValueLabelChip,
  type MenuEntry,
} from '../components';
import { ACCENT_PRESETS, applyAccent, checkAccent, normalizeAccent } from '../lib/color';
import './styleguide.css';

type Theme = 'light' | 'dark';
type Density = 'comfortable' | 'compact';

const params = new URLSearchParams(window.location.search);
const initialTheme: Theme = params.get('theme') === 'dark' || (params.get('theme') !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
const initialAccent = ACCENT_PRESETS.find((p) => p.id === params.get('accent'))?.light ?? ACCENT_PRESETS[0].light;
const initialDensity: Density = params.get('density') === 'compact' ? 'compact' : 'comfortable';

const SECTIONS = [
  ['principles', 'Principles'],
  ['color', 'Color'],
  ['type', 'Typography'],
  ['shape', 'Space & shape'],
  ['buttons', 'Buttons'],
  ['chips', 'Chips & badges'],
  ['forms', 'Form controls'],
  ['nav', 'Tabs, toolbar, menus'],
  ['overlays', 'Dialogs & toasts'],
  ['layout', 'Panels & empty states'],
  ['example', 'In context'],
] as const;

/* ------------------------------------------------------------------ helpers */

function toHex(css: string): string {
  // getComputedStyle returns rgb()/rgba() for plain colours and color(srgb r g b / a) for color-mix()
  const srgb = css.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/);
  const m = srgb ? srgb.slice(1).filter((x) => x !== undefined).map(Number).map((x, i) => (i < 3 ? x * 255 : x)) : css.match(/[\d.]+/g)?.map(Number);
  if (!m || m.length < 3) return css;
  const [r, g, b, a] = m;
  const hex = `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
  return a !== undefined && a < 1 ? `${hex} · ${Math.round(a * 100)}%` : hex;
}

function useTokenValues(tokens: string[], deps: unknown[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  const probe = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const el = probe.current ?? document.createElement('span');
    probe.current = el;
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    const out: Record<string, string> = {};
    for (const t of tokens) {
      el.style.backgroundColor = `var(${t})`;
      out[t] = toHex(getComputedStyle(el).backgroundColor);
    }
    el.remove();
    setValues(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return values;
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section className="sg-section" id={id} aria-labelledby={`${id}-h`}>
      <header className="sg-section-head">
        <h2 id={`${id}-h`} className="t-title">
          {title}
        </h2>
        {lead && <p className="sg-lead">{lead}</p>}
      </header>
      {children}
    </section>
  );
}

function Specimen({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`sg-specimen ${wide ? 'wide' : ''}`}>
      <div className="sg-specimen-label">{label}</div>
      <div className="sg-specimen-body">{children}</div>
    </div>
  );
}

function Swatches({ title, tokens, values }: { title: string; tokens: [string, string][]; values: Record<string, string> }) {
  return (
    <div className="sg-swatch-group">
      <h3 className="t-subheading">{title}</h3>
      <div className="sg-swatches">
        {tokens.map(([token, name]) => (
          <div key={token} className="sg-swatch">
            <span className="sg-chip-color" style={{ background: `var(${token})` }} />
            <span className="sg-swatch-name">{name}</span>
            <code className="sg-swatch-token">{token}</code>
            <code className="sg-swatch-hex">{values[token] ?? ''}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

const SURFACE_TOKENS: [string, string][] = [
  ['--canvas', 'Canvas'],
  ['--surface', 'Surface'],
  ['--surface-sunken', 'Sunken'],
  ['--surface-raised', 'Raised'],
  ['--surface-hover', 'Hover'],
  ['--surface-selected', 'Selected'],
  ['--surface-inverse', 'Inverse'],
];
const INK_TOKENS: [string, string][] = [
  ['--ink', 'Ink'],
  ['--ink-2', 'Ink 2'],
  ['--ink-3', 'Ink 3 · muted'],
  ['--ink-disabled', 'Disabled'],
  ['--line', 'Hairline'],
  ['--line-strong', 'Line strong'],
  ['--line-control', 'Control border'],
];
const ACCENT_TOKENS: [string, string][] = [
  ['--accent', 'Accent'],
  ['--accent-hover', 'Hover'],
  ['--accent-ink', 'On accent'],
  ['--accent-text', 'Accent text'],
  ['--accent-tint-strong', 'Selected wash'],
  ['--accent-tint', 'Faint wash'],
  ['--focus-ring', 'Focus ring'],
];
const SEMANTIC_TOKENS: [string, string][] = [
  ['--success', 'Success'],
  ['--success-tint', 'Success tint'],
  ['--warning', 'Warning'],
  ['--warning-tint', 'Warning tint'],
  ['--danger', 'Danger'],
  ['--danger-tint', 'Danger tint'],
  ['--info', 'Info'],
  ['--info-tint', 'Info tint'],
];
const MEASURE_TOKENS: [string, string][] = [
  ['--measure-nominal', 'Nominal'],
  ['--measure-ordinal', 'Ordinal'],
  ['--measure-scale', 'Scale'],
  ['--measure-string', 'String'],
];
const CHART_TOKENS: [string, string][] = Array.from({ length: 8 }, (_, i) => [`--chart-series-${i + 1}`, `Series ${i + 1}`] as [string, string]);
const ALL_TOKENS = [...SURFACE_TOKENS, ...INK_TOKENS, ...ACCENT_TOKENS, ...SEMANTIC_TOKENS, ...MEASURE_TOKENS, ...CHART_TOKENS].map(([t]) => t);

const TYPE_SCALE: [string, string, string, string][] = [
  ['t-display', '28 / 600', '--fs-3xl', 'Průzkum mezi studenty'],
  ['t-title', '22 / 600', '--fs-2xl', 'Frequencies: satisfaction with studies'],
  ['t-heading', '18 / 600', '--fs-xl', 'Descriptive statistics'],
  ['t-subheading', '16 / 600', '--fs-lg', 'Statistics · Charts · Format'],
  ['t-body', '14 / 400', '--fs-md', 'Moves the selected variables into the analysis list. Value labels are shown where defined.'],
  ['t-label', '12 / 500', '--fs-sm', 'Variables'],
  ['t-caption', '11 / 400', '--fs-xs', '120 cases · 12 variables · weighted by none'],
];

const FREQ_ROWS: [string, string, number, number, number][] = [
  ['1', 'Dissatisfied', 34, 28.3, 28.3],
  ['2', 'Neutral', 41, 34.2, 62.5],
  ['3', 'Satisfied', 38, 31.7, 94.2],
  ['9', 'No answer', 7, 5.8, 100.0],
];

/* ------------------------------------------------------------------ page */

export function StyleGuide() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [accent, setAccent] = useState(initialAccent);
  const [density, setDensity] = useState<Density>(initialDensity);
  const [tab, setTab] = useState('data');
  const [seg, setSeg] = useState<'left' | 'center' | 'right'>('right');
  const [measure, setMeasure] = useState<'nominal' | 'ordinal' | 'scale'>('ordinal');
  const [alpha, setAlpha] = useState<number | null>(0.05);
  const [ties, setTies] = useState<'mean' | 'low' | 'high'>('mean');
  const [chipOn, setChipOn] = useState({ weighted: true, split: false, filter: false });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const popAnchor = useRef<HTMLButtonElement>(null);

  // layout effect so the theme is stamped before useTokenValues reads computed colours
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    applyAccent(accent, theme === 'dark');
    document.title = 'Calm Workspace · PSPP Studio';
    window.dispatchEvent(new Event('pspp-theme-changed'));
  }, [theme, accent, density]);

  const values = useTokenValues(ALL_TOKENS, [theme, accent]);
  const aa = checkAccent(accent, theme === 'dark');

  const menuItems: MenuEntry[] = [
    { type: 'item', id: 'open', label: 'Open data…', icon: 'folder_open', shortcut: 'Ctrl+O', onSelect: () => {} },
    { type: 'item', id: 'save', label: 'Save', icon: 'save', shortcut: 'Ctrl+S', onSelect: () => {} },
    { type: 'item', id: 'csv', label: 'Export as CSV', icon: 'download', onSelect: () => {} },
    { type: 'sep' },
    { type: 'header', label: 'Recent' },
    { type: 'item', id: 'r1', label: 'studenti_2025.sav', icon: 'description', onSelect: () => {} },
    { type: 'item', id: 'vl', label: 'Show value labels', checked: true, onSelect: () => {} },
    { type: 'sep' },
    { type: 'item', id: 'del', label: 'Delete dataset', icon: 'delete', danger: true, onSelect: () => {} },
  ];

  return (
    <div className="sg">
      <header className="sg-topbar">
        <div className="sg-brand">
          <span className="sg-mark" aria-hidden="true">
            <Icon name="bar_chart" />
          </span>
          <div>
            <div className="sg-brand-name">Klidná pracovní plocha</div>
            <div className="t-caption">Calm Workspace · PSPP Studio design system</div>
          </div>
        </div>
        <div className="sg-controls">
          <Segmented<Theme>
            aria-label="Theme"
            size="sm"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: 'Paper', icon: 'light_mode' },
              { value: 'dark', label: 'Graphite', icon: 'dark_mode' },
            ]}
          />
          <Segmented<Density>
            aria-label="Density"
            size="sm"
            value={density}
            onChange={setDensity}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
          <div className="sg-accents" role="radiogroup" aria-label="Accent">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={normalizeAccent(accent) === p.light}
                aria-label={p.name.en}
                data-tip={p.name.en}
                className="sg-accent"
                style={{ background: theme === 'dark' ? p.dark : p.light }}
                onClick={() => setAccent(p.light)}
              />
            ))}
            <label className="sg-accent custom" data-tip="Custom accent">
              <span className="sr-only">Custom accent</span>
              <input type="color" value={normalizeAccent(accent)} onChange={(e) => setAccent(e.target.value)} />
            </label>
          </div>
        </div>
      </header>

      <div className="sg-layout">
        <nav className="sg-nav" aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>

        <main className="sg-main">
          {/* ------------------------------------------------ principles */}
          <section className="sg-hero" id="principles">
            <p className="t-label">Design system · v1</p>
            <h1 className="t-display">A quiet desk for careful numbers.</h1>
            <p className="sg-hero-text">
              Warm paper and graphite surfaces, hairlines instead of shadows, sharp 4–6–8 px geometry and a single accent used only where a decision happens. The data is the loudest thing on screen.
            </p>
            <div className="sg-principles">
              {[
                ['Hairlines, not elevation', 'Separate regions with 1px warm lines. Shadows belong only to things that float: menus, popovers, dialogs, toasts.'],
                ['Accent marks decisions', 'Primary action, focus ring, selection, active tab, links. Everything else is ink on paper.'],
                ['Neutral states', 'Hover and selection are soft neutral tints plus a thin accent indicator, never large coloured fills.'],
                ['Numbers line up', 'Tabular figures everywhere digits stack: grid, output tables, counters, status bar.'],
              ].map(([t, d]) => (
                <div key={t} className="sg-principle">
                  <h3 className="t-subheading">{t}</h3>
                  <p>{d}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ------------------------------------------------ color */}
          <Section id="color" title="Color" lead="Values update live with theme and accent. Every text pair meets WCAG AA; control borders meet 3:1.">
            <Swatches title="Surfaces" tokens={SURFACE_TOKENS} values={values} />
            <Swatches title="Ink & lines" tokens={INK_TOKENS} values={values} />
            <div className="sg-swatch-group">
              <h3 className="t-subheading">
                Accent{' '}
                <StatusChip tone={aa.passesAA ? 'success' : 'danger'}>
                  {aa.passesAA ? 'AA' : 'Fails AA'} · {aa.accentOnCanvas.toFixed(1)}:1 on canvas · {aa.textOnAccent.toFixed(1)}:1 text on accent
                </StatusChip>
              </h3>
              <div className="sg-swatches">
                {ACCENT_TOKENS.map(([token, name]) => (
                  <div key={token} className="sg-swatch">
                    <span className="sg-chip-color" style={{ background: `var(${token})` }} />
                    <span className="sg-swatch-name">{name}</span>
                    <code className="sg-swatch-token">{token}</code>
                    <code className="sg-swatch-hex">{values[token] ?? ''}</code>
                  </div>
                ))}
              </div>
            </div>
            <Swatches title="Semantic" tokens={SEMANTIC_TOKENS} values={values} />
            <Swatches title="Measurement levels" tokens={MEASURE_TOKENS} values={values} />
            <div className="sg-swatch-group">
              <h3 className="t-subheading">Chart series</h3>
              <div className="sg-series">
                {CHART_TOKENS.map(([token, name], i) => (
                  <div key={token} className="sg-series-item">
                    <span className="sg-bar" style={{ background: `var(${token})`, height: `${36 + ((i * 37) % 52)}px` }} />
                    <code>{name}</code>
                    <code className="sg-swatch-hex">{values[token] ?? ''}</code>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* ------------------------------------------------ type */}
          <Section id="type" title="Typography" lead="Inter with the tailed l (cv05) so l, I and 1 never blur in variable names. Sentence case everywhere; no all-caps labels.">
            <div className="sg-type">
              {TYPE_SCALE.map(([cls, spec, token, sample]) => (
                <div key={cls} className="sg-type-row">
                  <div className="sg-type-meta">
                    <code>.{cls}</code>
                    <span className="t-caption">
                      {spec} · {token}
                    </span>
                  </div>
                  <div className={cls}>{sample}</div>
                </div>
              ))}
              <div className="sg-type-row">
                <div className="sg-type-meta">
                  <code>.t-mono</code>
                  <span className="t-caption">12 / Roboto Mono</span>
                </div>
                <div className="t-mono">FREQUENCIES VARIABLES=satisf /STATISTICS=MEAN STDDEV.</div>
              </div>
            </div>
            <Specimen label="Tabular figures in an output table" wide>
              <table className="sg-table">
                <caption>satisf · Satisfaction with studies</caption>
                <thead>
                  <tr>
                    <th scope="col">Value</th>
                    <th scope="col">Label</th>
                    <th scope="col" className="num">
                      Frequency
                    </th>
                    <th scope="col" className="num">
                      Percent
                    </th>
                    <th scope="col" className="num">
                      Cumulative %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {FREQ_ROWS.map(([v, l, n, p, c]) => (
                    <tr key={v} className={v === '9' ? 'missing' : undefined}>
                      <td>
                        <ValueLabelChip value={v} missing={v === '9'} />
                      </td>
                      <td>{l}</td>
                      <td className="num">{n}</td>
                      <td className="num">{p.toFixed(1)}</td>
                      <td className="num">{c.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>
                      Total
                    </th>
                    <td className="num">120</td>
                    <td className="num">100.0</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ shape */}
          <Section id="shape" title="Space & shape" lead="4px rhythm. Radius follows the size of the thing: 4 for tags, 6 for controls, 8 for panels and dialogs.">
            <div className="sg-grid-3">
              <Specimen label="Spacing scale --s-1 … --s-8">
                <div className="sg-spaces">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <div key={n} className="sg-space">
                      <span style={{ width: `var(--s-${n})` }} />
                      <code>--s-{n}</code>
                    </div>
                  ))}
                </div>
              </Specimen>
              <Specimen label="Radii">
                <div className="sg-radii">
                  <div style={{ borderRadius: 'var(--radius-chip)' }}>
                    4<small>chip</small>
                  </div>
                  <div style={{ borderRadius: 'var(--radius-control)' }}>
                    6<small>control</small>
                  </div>
                  <div style={{ borderRadius: 'var(--radius-panel)' }}>
                    8<small>panel</small>
                  </div>
                </div>
              </Specimen>
              <Specimen label="Edges">
                <div className="sg-edges">
                  <div className="sg-edge hair">Hairline · panels</div>
                  <div className="sg-edge float">Float · menus</div>
                  <div className="sg-edge dialog">Dialog</div>
                </div>
              </Specimen>
            </div>
          </Section>

          {/* ------------------------------------------------ buttons */}
          <Section id="buttons" title="Buttons" lead="One primary per view. Secondary is the default; ghost for low-emphasis and toolbars; danger only for destructive confirmation.">
            <div className="sg-matrix">
              {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
                <div key={v} className="sg-matrix-row">
                  <code className="sg-matrix-label">{v}</code>
                  <Button variant={v} size="sm">
                    Small
                  </Button>
                  <Button variant={v} iconStart={v === 'danger' ? 'delete' : 'play_arrow'}>
                    {v === 'danger' ? 'Delete' : 'Run'}
                  </Button>
                  <Button variant={v} size="lg" iconEnd="expand_more">
                    Large
                  </Button>
                  <Button variant={v} disabled>
                    Disabled
                  </Button>
                  <Button variant={v} loading>
                    Running
                  </Button>
                </div>
              ))}
            </div>
            <div className="sg-grid-2">
              <Specimen label="IconButton · ghost / secondary / primary / pressed / disabled">
                <div className="u-row u-wrap">
                  <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" />
                  <IconButton icon="filter_list" label="Filter" variant="secondary" />
                  <IconButton icon="add" label="Add" variant="primary" />
                  <IconButton icon="label" label="Value labels" pressed />
                  <IconButton icon="redo" label="Redo" disabled />
                  <IconButton icon="close" label="Close" small />
                </div>
              </Specimen>
              <Specimen label="Tooltip (hover or focus) · Kbd">
                <div className="u-row u-wrap u-gap-3">
                  <Tooltip content="Run the selected commands" shortcut="Ctrl+Enter">
                    <Button variant="primary" iconStart="play_arrow" loading={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1200); }}>
                      Run selection
                    </Button>
                  </Tooltip>
                  <span className="t-caption u-row u-gap-1">
                    Search menus <Kbd keys="Ctrl+K" />
                  </span>
                  <span className="tooltip sg-static-tip">Value labels (Ctrl+L)</span>
                </div>
              </Specimen>
            </div>
          </Section>

          {/* ------------------------------------------------ chips */}
          <Section id="chips" title="Chips & badges" lead="Chips are 4px tags for data facts: value labels, states, filters and measurement levels.">
            <div className="sg-grid-2">
              <Specimen label="Value-label chip">
                <div className="chip-group">
                  <ValueLabelChip value="1" label="Male" />
                  <ValueLabelChip value="2" label="Female" />
                  <ValueLabelChip value="3" label="Prefer not to say" />
                  <ValueLabelChip value="9" label="No answer" missing />
                </div>
              </Specimen>
              <Specimen label="Status chip">
                <div className="chip-group">
                  <StatusChip tone="success">Engine ready</StatusChip>
                  <StatusChip tone="warning">Unsaved changes</StatusChip>
                  <StatusChip tone="danger">2 syntax errors</StatusChip>
                  <StatusChip tone="info">Demo engine</StatusChip>
                  <StatusChip tone="accent">Weighted</StatusChip>
                  <StatusChip>Idle</StatusChip>
                </div>
              </Specimen>
              <Specimen label="Filter chip · removable chip">
                <div className="chip-group">
                  <FilterChip selected={chipOn.weighted} onToggle={(v) => setChipOn({ ...chipOn, weighted: v })} icon="balance">
                    Weight: hours
                  </FilterChip>
                  <FilterChip selected={chipOn.split} onToggle={(v) => setChipOn({ ...chipOn, split: v })} icon="call_split">
                    Split by faculty
                  </FilterChip>
                  <FilterChip selected={chipOn.filter} onToggle={(v) => setChipOn({ ...chipOn, filter: v })} icon="filter_alt">
                    All cases
                  </FilterChip>
                  <Chip icon="filter_alt" onRemove={() => {}} removeLabel="Remove filter age ≥ 20">
                    age ≥ 20
                  </Chip>
                </div>
              </Specimen>
              <Specimen label="Measure chip · measure icon">
                <div className="chip-group">
                  <MeasureChip measure="nominal" label="Nominal" />
                  <MeasureChip measure="ordinal" label="Ordinal" />
                  <MeasureChip measure="scale" label="Scale" />
                  <MeasureChip measure="string" label="String" />
                  <MeasureChip measure="scale" label="Scale" iconOnly />
                  <span className="u-row u-gap-1 t-label">
                    <MeasureIcon measure="nominal" size={16} /> gender
                  </span>
                </div>
              </Specimen>
              <Specimen label="Badge · counter">
                <div className="chip-group">
                  <Badge>v2.0</Badge>
                  <Badge tone="info" icon="science">
                    Demo
                  </Badge>
                  <Badge tone="warning">Beta</Badge>
                  <Counter count={12} />
                  <Counter count={3} tone="accent" label="New outputs" />
                  <Counter count={128} tone="danger" label="Errors" />
                </div>
              </Specimen>
            </div>
          </Section>

          {/* ------------------------------------------------ forms */}
          <Section id="forms" title="Form controls" lead="Labels above fields, help below. Errors replace help, say what is wrong and how to fix it.">
            <div className="sg-grid-3">
              <div className="u-stack u-gap-4">
                <TextField label="Variable name" defaultValue="satisf" help="Letters, digits and _ · max 64 characters" mono />
                <TextField label="Label" defaultValue="Satisfaction with studies" iconStart="sell" />
                <TextField label="Name" defaultValue="2nd_wave" error="Names must start with a letter" />
                <TextField label="Format" defaultValue="F8.2" disabled />
              </div>
              <div className="u-stack u-gap-4">
                <NumberField label="Significance level" value={alpha} onValueChange={setAlpha} min={0} max={1} step={0.01} help="Between 0 and 1" />
                <Select
                  label="Measure"
                  value={measure}
                  onChange={(e) => setMeasure(e.target.value as typeof measure)}
                  options={[
                    { value: 'nominal', label: 'Nominal' },
                    { value: 'ordinal', label: 'Ordinal' },
                    { value: 'scale', label: 'Scale' },
                  ]}
                />
                <TextField label="Search variables" placeholder="Filter by name or label" iconStart="search" />
                <TextArea label="Note" defaultValue="Recoded 9 → system missing." rows={2} />
              </div>
              <div className="u-stack u-gap-3">
                <div>
                  <Checkbox label="Display frequency tables" defaultChecked />
                  <Checkbox label="Include missing values" description="Cases with user-missing values are counted separately" />
                  <Checkbox label="All statistics" indeterminate readOnly />
                  <Checkbox label="Exact tests (not available)" disabled />
                </div>
                <Divider />
                <Switch label="Autosave" description="Keep a copy in this browser" defaultChecked />
                <Switch label="Show formula bar" inline />
                <Divider />
                <RadioGroup
                  legend="Ties"
                  value={ties}
                  onChange={setTies}
                  orientation="horizontal"
                  options={[
                    { value: 'mean', label: 'Mean' },
                    { value: 'low', label: 'Low' },
                    { value: 'high', label: 'High' },
                  ]}
                />
                <div className="field">
                  <span className="field-label" id="align-l">
                    Alignment
                  </span>
                  <Segmented
                    aria-label="Alignment"
                    value={seg}
                    onChange={setSeg}
                    options={[
                      { value: 'left', label: 'Left', icon: 'format_align_left' },
                      { value: 'center', label: 'Center', icon: 'format_align_center' },
                      { value: 'right', label: 'Right', icon: 'format_align_right' },
                    ]}
                  />
                </div>
              </div>
            </div>
          </Section>

          {/* ------------------------------------------------ nav */}
          <Section id="nav" title="Tabs, toolbar, menus" lead="Tabs use a 2px accent underline. Toolbars group related actions with hairline separators. Menus float with a hairline and a soft shadow.">
            <Specimen label="Tabs" wide>
              <Tabs
                aria-label="Views"
                id="sg-tabs"
                value={tab}
                onChange={setTab}
                items={[
                  { id: 'data', label: 'Data', icon: 'table' },
                  { id: 'vars', label: 'Variables', icon: 'view_list' },
                  { id: 'out', label: 'Output', icon: 'article', count: 2 },
                  { id: 'syn', label: 'Syntax 1', icon: 'code' },
                ]}
              />
              <TabPanel tabsId="sg-tabs" value={tab} active className="sg-tabpanel">
                <span className="t-caption">Panel for “{tab}”. Arrow keys move between tabs.</span>
              </TabPanel>
            </Specimen>
            <Specimen label="Toolbar (arrow keys move between controls)" wide>
              <Toolbar aria-label="Data tools" bordered>
                <ToolbarGroup>
                  <IconButton icon="folder_open" label="Open" />
                  <IconButton icon="save" label="Save" />
                </ToolbarGroup>
                <ToolbarSeparator />
                <ToolbarGroup>
                  <IconButton icon="undo" label="Undo" />
                  <IconButton icon="redo" label="Redo" disabled />
                </ToolbarGroup>
                <ToolbarSeparator />
                <ToolbarGroup attached label="Insert">
                  <IconButton icon="table_rows" label="Insert case" />
                  <IconButton icon="view_column" label="Insert variable" />
                </ToolbarGroup>
                <ToolbarSeparator />
                <IconButton icon="label" label="Value labels" pressed />
                <ToolbarSpacer />
                <FilterChip selected={false} icon="filter_alt">
                  All cases
                </FilterChip>
                <MenuButton label="Analyze" icon="functions" items={menuItems} size="sm" />
              </Toolbar>
            </Specimen>
            <div className="sg-grid-2">
              <Specimen label="Menu (static preview)">
                <div className="menu sg-static" role="menu" aria-label="File (preview)">
                  {menuItems.map((it, i) =>
                    it.type === 'sep' ? (
                      <div key={i} className="menu-sep" role="separator" />
                    ) : it.type === 'header' ? (
                      <div key={i} className="menu-header">
                        {it.label}
                      </div>
                    ) : it.type === 'item' ? (
                      <button key={it.id} type="button" role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.checked} className={`menu-item ${it.danger ? 'danger' : ''}`} data-active={i === 1 || undefined} tabIndex={-1}>
                        <Icon name={it.checked !== undefined ? 'check' : it.icon ?? ''} />
                        <span className="menu-label">{it.label}</span>
                        {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
                      </button>
                    ) : null,
                  )}
                </div>
              </Specimen>
              <Specimen label="MenuButton · Popover (live)">
                <div className="u-row u-wrap">
                  <MenuButton label="File" items={menuItems} />
                  <MenuButton label="More actions" iconOnly items={menuItems} />
                  <Button ref={popAnchor} iconStart="tune" aria-expanded={popOpen} aria-haspopup="dialog" onClick={() => setPopOpen((v) => !v)}>
                    Display options
                  </Button>
                  <Popover open={popOpen} onClose={() => setPopOpen(false)} anchorRef={popAnchor} label="Display options">
                    <div className="u-stack u-gap-3" style={{ width: 240 }}>
                      <span className="t-subheading">Display options</span>
                      <Switch label="Value labels" inline defaultChecked />
                      <Switch label="Grid lines" inline defaultChecked />
                      <NumberField label="Decimals" value={2} onValueChange={() => {}} min={0} max={16} size="sm" />
                    </div>
                  </Popover>
                </div>
              </Specimen>
            </div>
          </Section>

          {/* ------------------------------------------------ overlays */}
          <Section id="overlays" title="Dialogs & toasts" lead="Dialogs: hairline header, quiet sunken footer, primary action last on the right. Full-screen on phones.">
            <div className="sg-dialog-stage">
              <div className="dialog sg-static" role="dialog" aria-label="Recode (preview)">
                <div className="dialog-header">
                  <Icon name="swap_horiz" className="dialog-icon" />
                  <div className="dialog-heading">
                    <h2>Recode into same variables</h2>
                    <p className="dialog-description">Old values are replaced in place. Undo is available.</p>
                  </div>
                  <IconButton icon="close" label="Close" tip={false} />
                </div>
                <div className="dialog-body u-stack u-gap-4">
                  <div className="sg-recode">
                    <TextField label="Old value" defaultValue="9" size="sm" />
                    <Icon name="arrow_forward" className="t-muted" />
                    <TextField label="New value" defaultValue="SYSMIS" size="sm" mono />
                  </div>
                  <Checkbox label="Apply to all selected variables (3)" defaultChecked />
                </div>
                <div className="dialog-footer">
                  <Button variant="ghost" iconStart="help">
                    Help
                  </Button>
                  <span className="spacer" />
                  <Button variant="ghost">Cancel</Button>
                  <Button iconStart="content_paste">Paste syntax</Button>
                  <Button variant="primary">OK</Button>
                </div>
              </div>
            </div>
            <div className="sg-grid-2">
              <Specimen label="Toasts">
                <div className="u-stack">
                  <Toast static message="Saved to this browser" kind="success" closeLabel="Close" onClose={() => {}} />
                  <Toast static message="3 variables deleted" action={{ label: 'Undo', run: () => {} }} closeLabel="Close" onClose={() => {}} />
                  <Toast static message="The engine stopped. Restart to continue." kind="error" closeLabel="Close" onClose={() => {}} />
                </div>
              </Specimen>
              <Specimen label="Modal (live, with focus trap)">
                <Button variant="primary" iconStart="open_in_new" onClick={() => setDialogOpen(true)}>
                  Open dialog
                </Button>
              </Specimen>
            </div>
            {dialogOpen && (
              <Dialog
                title="Delete variable “stress”?"
                description="120 values will be removed. You can undo this."
                icon="delete"
                size="small"
                onClose={() => setDialogOpen(false)}
                footer={
                  <>
                    <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="danger" onClick={() => setDialogOpen(false)} data-autofocus>
                      Delete
                    </Button>
                  </>
                }
              >
                <Checkbox label="Also delete from saved syntax" />
              </Dialog>
            )}
          </Section>

          {/* ------------------------------------------------ layout */}
          <Section id="layout" title="Panels & empty states" lead="Panels are framed by a hairline only. Collapsible panels use a disclosure chevron.">
            <div className="sg-grid-3">
              <Panel
                title="Statistics"
                subtitle="Central tendency"
                collapsible
                actions={<IconButton icon="more_horiz" label="Panel options" small />}
              >
                <div className="u-stack u-gap-1">
                  <Checkbox label="Mean" defaultChecked />
                  <Checkbox label="Median" defaultChecked />
                  <Checkbox label="Mode" />
                </div>
              </Panel>
              <Panel title="Output outline" variant="sunken" divided>
                <ul className="sg-outline">
                  <li>Frequencies</li>
                  <li className="on">Statistics</li>
                  <li>satisf</li>
                  <li>Bar chart</li>
                </ul>
              </Panel>
              <Panel title="Output" divided>
                <EmptyState compact icon="article" title="No output yet" description="Run an analysis from the Analyze menu or the syntax editor." actions={<Button size="sm" iconStart="functions">Analyze</Button>} />
              </Panel>
            </div>
            <Divider label="or" />
            <EmptyState icon="dataset" title="Open a dataset to begin" description="Drop a .sav, .csv or .xlsx file here, or start from a sample." actions={<><Button variant="primary" iconStart="folder_open">Open file</Button><Button>Use a sample</Button></>} />
          </Section>

          {/* ------------------------------------------------ example */}
          <Section id="example" title="In context" lead="A variable picker as the analysis dialogs will compose it.">
            <div className="sg-example">
              <div className="sg-picker">
                <div className="u-row">
                  <span className="t-label">Variables</span>
                  <Counter count={10} />
                </div>
                <TextField aria-label="Filter variables" placeholder="Filter variables" iconStart="search" size="sm" />
                <ul className="sg-varlist" role="listbox" aria-label="Variables">
                  {(
                    [
                      ['gender', 'Gender', 'nominal'],
                      ['age', 'Age in years', 'scale'],
                      ['faculty', 'Faculty', 'nominal'],
                      ['year', 'Year of study', 'ordinal'],
                      ['hours', 'Study hours per week', 'scale'],
                      ['stress', 'Perceived stress (0–40)', 'scale'],
                      ['commute', 'Main way of commuting', 'string'],
                    ] as const
                  ).map(([n, l, m], i) => (
                    <li key={n} role="option" aria-selected={i === 3} className={i === 3 ? 'on' : undefined}>
                      <MeasureIcon measure={m} size={16} />
                      <span className="sg-var-name">{n}</span>
                      <span className="sg-var-label">{l}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="sg-move">
                <IconButton icon="arrow_forward" label="Move to analysis" variant="secondary" />
              </div>
              <div className="sg-picker">
                <div className="u-row">
                  <span className="t-label">Analyze</span>
                  <Badge tone="accent">2</Badge>
                </div>
                <ul className="sg-varlist target" aria-label="Selected variables">
                  <li>
                    <MeasureIcon measure="nominal" size={16} />
                    <span className="sg-var-name">faculty</span>
                    <span className="sg-var-label">Faculty</span>
                  </li>
                  <li>
                    <MeasureIcon measure="ordinal" size={16} />
                    <span className="sg-var-name">satisf</span>
                    <span className="sg-var-label">Satisfaction with studies</span>
                  </li>
                </ul>
                <Checkbox label="Display frequency tables" defaultChecked />
                <div className="u-row u-wrap">
                  <Button size="sm" iconStart="functions">
                    Statistics…
                  </Button>
                  <Button size="sm" iconStart="bar_chart">
                    Charts…
                  </Button>
                  <Button size="sm" iconStart="tune">
                    Format…
                  </Button>
                </div>
              </div>
            </div>
          </Section>

          <footer className="sg-footer t-caption">PSPP Studio · GPL-3.0-or-later · tokens in src/styles/tokens.css · rules in docs/design-system.md</footer>
        </main>
      </div>
    </div>
  );
}
