/*
 * Workspace: the main tab panel with the active view, an optional split view (Syntax ∥ Výstup
 * or Data ∥ Výstup, desktop ≥ 1280 px, resizable) and the right panel slot (variable
 * inspector from the data work package, or the journal).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '../../components/Button';
import { useSettings } from '../../store/settings';
import { useSyntax } from '../../store/syntax';
import { useUi, type View } from '../../store/ui';
import { StartScreen } from '../start/StartScreen';
import { activeTabKey, tabDomId } from './BottomBar';
import { JournalPanel } from './JournalPanel';
import { SPLIT_MIN_WIDTH, useLayout } from './layout';

const DataView = lazy(() => import('../data/DataView').then((m) => ({ default: m.DataView })));
const VariableView = lazy(() => import('../variables/VariableView').then((m) => ({ default: m.VariableView })));
const SyntaxView = lazy(() => import('../syntax/SyntaxView').then((m) => ({ default: m.SyntaxView })));
const OutputView = lazy(() => import('../output/OutputView').then((m) => ({ default: m.OutputView })));

type InspectorModule = { InspectorPanel: ComponentType<object>; isPlaceholder?: boolean };
const loadInspector = () => import('../inspector/InspectorPanel') as unknown as Promise<InspectorModule>;
const Inspector = lazy(() => loadInspector().then((m) => ({ default: m.InspectorPanel })));

export function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

function Loading() {
  const { t } = useTranslation();
  return (
    <div className="view-loading" role="status">
      <Spinner />
      {t('common.loading')}
    </div>
  );
}

function ViewFor({ v }: { v: View }) {
  return (
    <Suspense fallback={<Loading />}>
      {v === 'data' && <DataView />}
      {v === 'variables' && <VariableView />}
      {v === 'output' && <OutputView />}
      {v === 'syntax' && <SyntaxView />}
    </Suspense>
  );
}

function Pane({ v, active, style, children }: { v: View; active: boolean; style?: CSSProperties; children: ReactNode }) {
  const setView = useUi((s) => s.setView);
  const { t } = useTranslation();
  return (
    <section
      className={`sh-pane view-${v} ${active ? 'is-active' : ''}`}
      style={style}
      aria-label={t(`views.${v}`)}
      onPointerDownCapture={() => !active && setView(v)}
      onFocusCapture={() => !active && setView(v)}
    >
      {children}
    </section>
  );
}

function Divider() {
  const { t } = useTranslation();
  const ratio = useLayout((s) => s.splitRatio);
  const setRatio = useLayout((s) => s.setSplitRatio);
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: ReactPointerEvent) => {
    const host = ref.current?.parentElement;
    if (!host) return;
    e.preventDefault();
    const r = host.getBoundingClientRect();
    const move = (ev: PointerEvent) => setRatio((ev.clientX - r.left) / r.width);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('sh-resizing');
    };
    document.body.classList.add('sh-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      ref={ref}
      className="sh-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('shell.split.resize')}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={drag}
      onDoubleClick={() => setRatio(0.5)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'ArrowLeft') setRatio(ratio - step);
        else if (e.key === 'ArrowRight') setRatio(ratio + step);
        else if (e.key === 'Home') setRatio(0.2);
        else if (e.key === 'End') setRatio(0.8);
        else return;
        e.preventDefault();
      }}
    />
  );
}

/** Which pair is shown side by side for the current view, or null for a single view. */
export function splitPair(mode: string, view: View, width: number): [View, View] | null {
  if (width < SPLIT_MIN_WIDTH || mode === 'off') return null;
  const left: View = mode === 'syntax-output' ? 'syntax' : 'data';
  return view === left || view === 'output' ? [left, 'output'] : null;
}

function SidePanel({ view }: { view: View }) {
  const inspectorOpen = useSettings((s) => s.inspectorOpen);
  const journalOpen = useLayout((s) => s.journalOpen);
  const [inspectorReady, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadInspector()
      .then((m) => alive && setReady(!m.isPlaceholder))
      .catch(() => setReady(false));
    return () => {
      alive = false;
    };
  }, []);
  if (journalOpen) return <JournalPanel />;
  if (inspectorOpen && inspectorReady && (view === 'data' || view === 'variables'))
    return (
      <div className="sh-side-slot">
        <Suspense fallback={null}>
          <Inspector />
        </Suspense>
      </div>
    );
  return null;
}

export function Workspace() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const showStart = useUi((s) => s.showStart);
  const split = useSettings((s) => s.splitView);
  const ratio = useLayout((s) => s.splitRatio);
  const activeId = useSyntax((s) => s.activeId);
  const width = useWindowWidth();
  if (showStart)
    return (
      <main id="main" className="sh-main view-start" tabIndex={-1}>
        <StartScreen />
      </main>
    );
  const pair = splitPair(split, view, width);
  return (
    <main id="main" className={`sh-main view-${view} ${pair ? 'is-split' : ''}`} tabIndex={-1} aria-label={t(`views.${view}`)}>
      <div id="sh-panel" className="sh-panel" role="tabpanel" aria-labelledby={tabDomId(activeTabKey(view, activeId))}>
        {pair ? (
          <div className="sh-split">
            <Pane v={pair[0]} active={view === pair[0]} style={{ flexBasis: `${ratio * 100}%` }}>
              <ViewFor v={pair[0]} />
            </Pane>
            <Divider />
            <Pane v={pair[1]} active={view === pair[1]} style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
              <ViewFor v={pair[1]} />
            </Pane>
          </div>
        ) : (
          <div className={`sh-single view-${view}`}>
            <ViewFor v={view} />
          </div>
        )}
      </div>
      <SidePanel view={view} />
    </main>
  );
}
