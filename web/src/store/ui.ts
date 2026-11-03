/*
 * Transient UI state: active view, open dialogs, toasts, engine status.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';

export type View = 'data' | 'variables' | 'output' | 'syntax';
export type EngineStatus = 'loading' | 'ready' | 'running' | 'error';

export type Modal =
  | { kind: 'analysis'; specId: string }
  | { kind: 'settings'; section?: string }
  | { kind: 'about' }
  | { kind: 'shortcuts' }
  | { kind: 'varType'; index: number }
  | { kind: 'valueLabels'; index: number }
  | { kind: 'missing'; index: number }
  | { kind: 'goto' }
  | { kind: 'find' }
  | { kind: 'saveAs' }
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
  setMobileMenu: (b: boolean) => void;
}

let toastId = 1;

export const useUi = create<UiState>((set, get) => ({
  view: 'data',
  showStart: true,
  modal: null,
  paletteOpen: false,
  valueLabels: false,
  zoom: 1,
  selected: null,
  engineStatus: 'loading',
  engineKind: null,
  engineVersion: '',
  toasts: [],
  mobileMenuOpen: false,
  setView: (view) => set({ view, showStart: false }),
  setShowStart: (showStart) => set({ showStart }),
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
    setTimeout(() => get().dismissToast(id), opts.action ? 8000 : 4500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setMobileMenu: (mobileMenuOpen) => set({ mobileMenuOpen }),
}));
