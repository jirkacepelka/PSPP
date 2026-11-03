/*
 * Syntax editor tabs.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { create } from 'zustand';

export interface SyntaxDiagnostic {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface SyntaxTab {
  id: string;
  title: string;
  text: string;
  diagnostics: SyntaxDiagnostic[];
  /** bumps when text is replaced externally so the editor reloads */
  version: number;
}

interface SyntaxState {
  tabs: SyntaxTab[];
  activeId: string;
  counter: number;
  add: (text?: string, title?: string) => string;
  close: (id: string) => void;
  setActive: (id: string) => void;
  setText: (id: string, text: string) => void;
  rename: (id: string, title: string) => void;
  /** Appends text to the active tab (Paste from dialogs). */
  append: (text: string) => string;
  setDiagnostics: (id: string, d: SyntaxDiagnostic[]) => void;
  load: (tabs: SyntaxTab[], activeId?: string) => void;
}

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const first: SyntaxTab = { id: 'syntax1', title: 'Syntax 1', text: '', diagnostics: [], version: 0 };

export const useSyntax = create<SyntaxState>((set, get) => ({
  tabs: [first],
  activeId: first.id,
  counter: 1,
  add: (text = '', title) => {
    const counter = get().counter + 1;
    const id = newId();
    set({ tabs: [...get().tabs, { id, title: title ?? `Syntax ${counter}`, text, diagnostics: [], version: 0 }], activeId: id, counter });
    return id;
  },
  close: (id) => {
    let tabs = get().tabs.filter((t) => t.id !== id);
    if (!tabs.length) tabs = [{ ...first, id: newId(), title: 'Syntax 1' }];
    const activeId = get().activeId === id ? tabs[Math.max(0, get().tabs.findIndex((t) => t.id === id) - 1)]?.id ?? tabs[0].id : get().activeId;
    set({ tabs, activeId });
  },
  setActive: (activeId) => set({ activeId }),
  setText: (id, text) => set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, text } : t)) }),
  rename: (id, title) => set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, title } : t)) }),
  append: (text) => {
    const { activeId, tabs } = get();
    const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
    const sep = tab.text && !tab.text.endsWith('\n') ? '\n' : '';
    const joined = tab.text.trim() === '' ? text : `${tab.text}${sep}${tab.text.trim() ? '\n' : ''}${text}`;
    set({ tabs: tabs.map((t) => (t.id === tab.id ? { ...t, text: joined.endsWith('\n') ? joined : `${joined}\n`, version: t.version + 1 } : t)), activeId: tab.id });
    return tab.id;
  },
  setDiagnostics: (id, diagnostics) => set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, diagnostics } : t)) }),
  load: (tabs, activeId) => {
    if (!tabs.length) return;
    set({ tabs: tabs.map((t) => ({ ...t, version: (t.version ?? 0) + 1, diagnostics: [] })), activeId: activeId && tabs.some((t) => t.id === activeId) ? activeId : tabs[0].id, counter: tabs.length });
  },
}));
