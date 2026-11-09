/*
 * Transient UI state: active view, open dialogs, toasts, engine status.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { MigrationPlan } from '../app/cloud';
import { create } from 'zustand';
import { flushSync } from 'react-dom';

type VTDocument = Document & { startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<void> } };

/**
 * Moving between Home and the workspace is a change of place, so it gets a view transition:
 * entering a document zooms in, going home settles back. Without support it is instant.
 */
function placeTransition(toHome: boolean, apply: () => void) {
  const doc = document as VTDocument;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduce) return apply();
  const root = document.documentElement;
  root.dataset.vt = toHome ? 'home' : 'enter';
  const vt = doc.startViewTransition(() => flushSync(apply));
  void vt.finished.finally(() => delete root.dataset.vt);
}

export type View = 'data' | 'variables' | 'output' | 'syntax';
export type EngineStatus = 'loading' | 'ready' | 'running' | 'error';

export type Modal =
  /** PRESET pre-fills dialog fields (field id → value), e.g. variables selected in the grid. */
  | { kind: 'analysis'; specId: string; preset?: Record<string, unknown>; replaceEntryId?: string }
  | { kind: 'assistant' }
  | { kind: 'settings'; section?: string }
  | { kind: 'about' }
  | { kind: 'account' }
  | { kind: 'migrate'; plan: MigrationPlan }
  | { kind: 'shortcuts' }
  | { kind: 'varType'; index: number }
  | { kind: 'valueLabels'; index: number }
  | { kind: 'missing'; index: number }
  | { kind: 'goto' }
  | { kind: 'find' }
  | { kind: 'saveAs' }
  | { kind: 'import'; name: string; bytes: Uint8Array }
  | { kind: 'exportOutput'; format?: 'html' | 'pdf' | 'docx' }
  | { kind: 'confirm'; titleKey: string; messageKey: string; messageArgs?: Record<string, string>; confirmKey?: string; danger?: boolean; onConfirm: () => void };

export interface Toast {
  id: number;
  message: string;
  kind?: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface UiState {
  view: View;
  showStart: boolean;
  modal: Modal | null;
  paletteOpen: boolean;
  valueLabels: boolean;
  zoom: number;
  selected: { row: number; col: number } | null;
  engineStatus: EngineStatus;
  engineKind: 'wasm' | 'mock' | null;
  engineVersion: string;
  toasts: Toast[];
  mobileMenuOpen: boolean;
  setView: (v: View) => void;
  setShowStart: (b: boolean) => void;
  openModal: (m: Modal) => void;
  closeModal: () => void;
  setPalette: (b: boolean) => void;
  toggleValueLabels: () => void;
  setZoom: (z: number) => void;
  select: (s: { row: number; col: number } | null) => void;
  setEngine: (p: Partial<Pick<UiState, 'engineStatus' | 'engineKind' | 'engineVersion'>>) => void;
  toast: (message: string, opts?: Omit<Toast, 'id' | 'message'>) => void;
  dismissToast: (id: number) => void;
  /** Toast ids kept on screen while hovered or focused (WCAG 2.2.1). */
  heldToasts: number[];
  holdToast: (id: number, held: boolean) => void;
  setMobileMenu: (b: boolean) => void;
}

let toastId = 1;

export const useUi = create<UiState>((set, get) => ({
  view: 'data',
  showStart: true,
  modal: null,
  paletteOpen: false,
  valueLabels: true,
  zoom: 1,
  selected: null,
  engineStatus: 'loading',
  engineKind: null,
  engineVersion: '',
  toasts: [],
  mobileMenuOpen: false,
  setView: (view) => (get().showStart ? placeTransition(false, () => set({ view, showStart: false })) : set({ view })),
  setShowStart: (showStart) => (showStart !== get().showStart ? placeTransition(showStart, () => set({ showStart })) : undefined),
  openModal: (modal) => set({ modal, paletteOpen: false, mobileMenuOpen: false }),
  closeModal: () => set({ modal: null }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  toggleValueLabels: () => set({ valueLabels: !get().valueLabels }),
  setZoom: (zoom) => set({ zoom: Math.min(2, Math.max(0.5, Math.round(zoom * 100) / 100)) }),
  select: (selected) => set({ selected }),
  setEngine: (p) => set(p),
  toast: (message, opts = {}) => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-2), { id, message, ...opts }] });
    // action toasts stay longer; any toast stays while hovered/focused
    const expire = () => (get().heldToasts.includes(id) ? setTimeout(expire, 1500) : get().dismissToast(id));
    setTimeout(expire, opts.action ? 12000 : opts.kind === 'error' ? 8000 : 5000);
  },
  heldToasts: [],
  holdToast: (id, held) => set({ heldToasts: held ? [...get().heldToasts.filter((x) => x !== id), id] : get().heldToasts.filter((x) => x !== id) }),
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setMobileMenu: (mobileMenuOpen) => set({ mobileMenuOpen }),
}));
