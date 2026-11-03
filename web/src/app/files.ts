/*
 * File operations: open, save, recent files, samples and autosave.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import i18n from '../i18n';
import { getEngineHandle, markSynced } from '../engine/client';
import { useJournal, type JournalEntry } from '../store/journal';
import { useDialogMemory, type DialogValues } from '../store/dialogs';
import type { Dataset } from '../engine/types';
import { kvDel, kvGet, kvSet } from '../lib/storage';
import { emptyDataset } from '../lib/variables';
import { useData } from '../store/data';
import { useOutput, type OutputEntry } from '../store/output';
import { useSettings } from '../store/settings';
import { useSyntax, type SyntaxTab } from '../store/syntax';
import { useUi } from '../store/ui';
import { outputToHtml } from '../features/output/exportHtml';
import { localizeSample } from '../samples/localize';

export const OPEN_ACCEPT = '.sav,.zsav,.por,.sps,.csv,.txt,.tsv,.ods,.json';
export type SaveFormat = 'sav' | 'zsav' | 'por' | 'csv';

export interface RecentFile {
  id: string;
  name: string;
  size: number;
  time: number;
  kind: 'data' | 'syntax';
  stored: boolean;
}

const RECENT_KEY = 'recent.v1';
const AUTOSAVE_KEY = 'autosave.v1';
const MAX_RECENT = 10;
const MAX_STORED_BYTES = 15 * 1024 * 1024;

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;
const toast = (m: string, o?: Parameters<ReturnType<typeof useUi.getState>['toast']>[1]) => useUi.getState().toast(m, o);

// ------------------------------------------------------------------ open

interface FsFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable?: () => Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }>;
}
type PickerWindow = Window & {
  showOpenFilePicker?: (o: object) => Promise<FsFileHandle[]>;
  showSaveFilePicker?: (o: object) => Promise<FsFileHandle>;
};

let currentHandle: FsFileHandle | null = null;

function pickWithInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = OPEN_ACCEPT;
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function openFileDialog() {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: t('files.pickerDescription'),
            accept: {
              'application/x-spss-sav': ['.sav', '.zsav'],
              'application/x-spss-por': ['.por'],
              'text/plain': ['.sps', '.csv', '.txt', '.tsv'],
              'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
              'application/json': ['.json'],
            },
          },
        ],
      });
      const h = handles[0];
      if (!h) return;
      const file = await h.getFile();
      await openFiles([file], h);
      return;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      // fall back to the input element
    }
  }
  const files = await pickWithInput();
  if (files.length) await openFiles(files);
}

export async function openFiles(files: File[], handle?: FsFileHandle) {
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    await openBytes(f.name, bytes, { handle });
  }
}

function confirmDiscard(onOk: () => void) {
  const d = useData.getState();
  if (d.dataset && d.dirty && (d.dataset.variables.length > 0)) {
    useUi.getState().openModal({ kind: 'confirm', titleKey: 'files.discardTitle', messageKey: 'files.discardMessage', messageArgs: { name: d.title }, confirmKey: 'files.discardConfirm', danger: true, onConfirm: onOk });
  } else onOk();
}

export async function openBytes(name: string, bytes: Uint8Array, opts: { handle?: FsFileHandle; addRecent?: boolean } = {}) {
  const lower = name.toLowerCase();
  const isSyntax = lower.endsWith('.sps') || lower.endsWith('.pspp');
  if (opts.addRecent !== false) void addRecent(name, bytes, isSyntax ? 'syntax' : 'data');
  if (isSyntax) {
    const text = new TextDecoder().decode(bytes);
    useSyntax.getState().add(text, name);
    useUi.getState().setView('syntax');
    return;
  }
  const ui = useUi.getState();
  ui.setEngine({ engineStatus: 'running' });
  try {
    const { api, kind } = await getEngineHandle();
    let result;
    try {
      result = await api.open({ name, bytes });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('MOCK_UNSUPPORTED') || kind === 'mock') {
        toast(t('files.needsEngine', { name }), { kind: 'error' });
        return;
      }
      throw e;
    }
    if (result.dataset) {
      const ds = result.dataset;
      const title = name.replace(/\.[^.]+$/, '');
      const apply = () => {
        useData.getState().load({ ...ds, name: title }, { title, fileName: name });
        markSynced(useData.getState().dataset);
        currentHandle = opts.handle ?? null;
        useUi.getState().setView('data');
        toast(t('files.opened', { name }));
      };
      confirmDiscard(apply);
    }
    if (result.syntax) {
      useSyntax.getState().add(result.syntax, name);
      useUi.getState().setView('syntax');
    }
    if (result.items?.length) useOutput.getState().add({ id: `open${Date.now()}`, title: name, syntax: '', time: Date.now(), items: result.items });
  } catch (e) {
    console.error(e);
    toast(t('files.openFailed', { name, message: e instanceof Error ? e.message : String(e) }), { kind: 'error' });
  } finally {
    useUi.getState().setEngine({ engineStatus: 'ready' });
  }
}

export function newDataset() {
  confirmDiscard(() => {
    const title = t('files.untitled');
    useData.getState().load(emptyDataset(title), { title, fileName: null });
    currentHandle = null;
    useUi.getState().setView('data');
  });
}

export function newSyntax() {
  useSyntax.getState().add();
  useUi.getState().setView('syntax');
}

export type SampleId = 'students' | 'employees' | 'trial';

export async function loadSampleDataset(id: SampleId): Promise<Dataset> {
  const mod =
    id === 'students' ? await import('../samples/students.json') : id === 'employees' ? await import('../samples/employees.json') : await import('../samples/trial.json');
  return localizeSample(id, structuredClone(mod.default as unknown as Dataset), i18n.language);
}

/** Opens a sample dataset; THEN runs after it is loaded (e.g. a guided task opening a dialog). */
export async function openSample(id: SampleId, then?: () => void) {
  const ds = await loadSampleDataset(id);
  confirmDiscard(() => {
    const title = t(`samples.${id}.title`);
    useData.getState().load({ ...ds, name: title }, { title, fileName: null });
    currentHandle = null;
    useUi.getState().setView('data');
    if (then) setTimeout(then, 60);
  });
}

/** Removes one entry from the recent-files list. */
export async function removeRecent(id: string) {
  const list = await getRecent();
  await kvDel(`recent-file:${id}`);
  await kvSet(RECENT_KEY, list.filter((r) => r.id !== id));
  window.dispatchEvent(new Event('pspp-recent-changed'));
}

// ------------------------------------------------------------------ save

const MIME: Record<SaveFormat, string> = {
  sav: 'application/x-spss-sav',
  zsav: 'application/x-spss-sav',
  por: 'application/x-spss-por',
  csv: 'text/csv',
};

export function downloadBlob(name: string, data: BlobPart, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatOf(name: string | null): SaveFormat | null {
  const ext = name?.toLowerCase().match(/\.(sav|zsav|por|csv)$/)?.[1];
  return (ext as SaveFormat) ?? null;
}

export async function saveDataset(opts: { format?: SaveFormat; name?: string; saveAs?: boolean } = {}) {
  const data = useData.getState();
  if (!data.dataset) return;
  const existing = formatOf(data.fileName);
  if (!opts.format && (!existing || opts.saveAs)) {
    useUi.getState().openModal({ kind: 'saveAs' });
    return;
  }
  const format = opts.format ?? existing ?? 'sav';
  const base = (opts.name ?? data.title ?? 'data').replace(/\.[^.]+$/, '') || 'data';
  const fileName = `${base}.${format}`;
  useUi.getState().setEngine({ engineStatus: 'running' });
  try {
    const { api } = await getEngineHandle();
    let bytes: Uint8Array;
    try {
      bytes = await api.save(data.dataset, format);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('MOCK_UNSUPPORTED')) {
        toast(t('files.saveNeedsEngine', { format: format.toUpperCase() }), {
          kind: 'error',
          action: { label: t('files.saveAsCsv'), run: () => void saveDataset({ format: 'csv', name: base }) },
        });
        return;
      }
      throw e;
    }
    const w = window as PickerWindow;
    let written = false;
    const sameHandle = currentHandle && currentHandle.name === fileName && !opts.saveAs && currentHandle.createWritable;
    if (sameHandle) {
      try {
        const wr = await currentHandle!.createWritable!();
        await wr.write(bytes as BlobPart);
        await wr.close();
        written = true;
      } catch {
        written = false;
      }
    }
    if (!written && w.showSaveFilePicker && opts.saveAs !== false) {
      try {
        const h = await w.showSaveFilePicker({ suggestedName: fileName, types: [{ description: format.toUpperCase(), accept: { [MIME[format]]: [`.${format}`] } }] });
        const wr = await h.createWritable!();
        await wr.write(bytes as BlobPart);
        await wr.close();
        currentHandle = h;
        written = true;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    if (!written) downloadBlob(fileName, bytes as BlobPart, MIME[format]);
    useData.getState().markSaved(format === 'csv' ? data.fileName : fileName);
    if (format !== 'csv') useData.getState().setTitle(base);
    useData.getState().markSaved();
    toast(t('files.saved', { name: fileName }), { kind: 'success' });
  } catch (e) {
    console.error(e);
    toast(t('files.saveFailed', { message: e instanceof Error ? e.message : String(e) }), { kind: 'error' });
  } finally {
    useUi.getState().setEngine({ engineStatus: 'ready' });
  }
}

export function saveSyntaxFile() {
  const s = useSyntax.getState();
  const tab = s.tabs.find((x) => x.id === s.activeId);
  if (!tab) return;
  const name = /\.sps$/i.test(tab.title) ? tab.title : `${tab.title.replace(/\s+/g, '_')}.sps`;
  downloadBlob(name, tab.text, 'text/plain');
}

export function exportOutputHtml() {
  const entries = useOutput.getState().entries;
  if (!entries.length) {
    toast(t('output.empty'));
    return;
  }
  const html = outputToHtml(entries, useData.getState().title || 'PSPP Studio', useSettings.getState().tableStyle);
  downloadBlob(`${(useData.getState().title || 'output').replace(/[^\p{L}\p{N}_-]+/gu, '_')}-output.html`, html, 'text/html');
}

export function printOutput() {
  useUi.getState().setView('output');
  setTimeout(() => window.print(), 150);
}

// ------------------------------------------------------------------ recent

export async function getRecent(): Promise<RecentFile[]> {
  const r = await kvGet<RecentFile[]>(RECENT_KEY);
  return Array.isArray(r) ? r : [];
}

async function addRecent(name: string, bytes: Uint8Array, kind: RecentFile['kind']) {
  const list = await getRecent();
  const existing = list.find((r) => r.name === name);
  const id = existing?.id ?? `f${Date.now().toString(36)}`;
  const stored = bytes.byteLength <= MAX_STORED_BYTES && (await kvSet(`recent-file:${id}`, bytes));
  const next = [{ id, name, size: bytes.byteLength, time: Date.now(), kind, stored }, ...list.filter((r) => r.id !== id)];
  for (const old of next.slice(MAX_RECENT)) void kvDel(`recent-file:${old.id}`);
  await kvSet(RECENT_KEY, next.slice(0, MAX_RECENT));
  window.dispatchEvent(new Event('pspp-recent-changed'));
}

export async function openRecent(r: RecentFile) {
  const bytes = await kvGet<Uint8Array>(`recent-file:${r.id}`);
  if (!bytes) {
    toast(t('files.recentMissing', { name: r.name }), { kind: 'error' });
    return;
  }
  await openBytes(r.name, bytes);
}

export async function clearRecent() {
  const list = await getRecent();
  for (const r of list) await kvDel(`recent-file:${r.id}`);
  await kvSet(RECENT_KEY, []);
  window.dispatchEvent(new Event('pspp-recent-changed'));
}

// ------------------------------------------------------------------ autosave

export interface AutosaveState {
  time: number;
  title: string;
  fileName: string | null;
  dataset: Dataset | null;
  tabs: SyntaxTab[];
  activeTab: string;
  output: OutputEntry[];
  journal?: JournalEntry[];
  dialogs?: { lastValues: Record<string, Record<string, DialogValues>>; recent: string[] };
}

export async function getAutosave(): Promise<AutosaveState | undefined> {
  const a = await kvGet<AutosaveState>(AUTOSAVE_KEY);
  return a && typeof a === 'object' && 'time' in a ? a : undefined;
}

export function restoreAutosave(a: AutosaveState) {
  if (a.dataset) useData.getState().load(a.dataset, { title: a.title, fileName: a.fileName, dirty: true });
  if (a.tabs?.length) useSyntax.getState().load(a.tabs, a.activeTab);
  if (a.output?.length) useOutput.getState().load(a.output);
  if (a.journal?.length) useJournal.getState().load(a.journal);
  if (a.dialogs) useDialogMemory.getState().load(a.dialogs);
  useUi.getState().setView(a.dataset ? 'data' : 'syntax');
}

export async function clearAutosave() {
  await kvDel(AUTOSAVE_KEY);
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved = 0;

export function scheduleAutosave() {
  if (!useSettings.getState().autosave) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    const d = useData.getState();
    const s = useSyntax.getState();
    const o = useOutput.getState();
    if (!d.dataset && s.tabs.every((x) => !x.text.trim()) && !o.entries.length) return;
    const state: AutosaveState = {
      time: Date.now(),
      title: d.title,
      fileName: d.fileName,
      dataset: d.dataset,
      tabs: s.tabs.map((x) => ({ ...x, diagnostics: [] })),
      activeTab: s.activeId,
      output: o.entries.slice(-100),
      journal: useJournal.getState().entries.slice(-500),
      dialogs: { lastValues: useDialogMemory.getState().lastValues, recent: useDialogMemory.getState().recent },
    };
    const ok = await kvSet(AUTOSAVE_KEY, state);
    if (ok) {
      lastSaved = Date.now();
      window.dispatchEvent(new CustomEvent('pspp-autosaved', { detail: lastSaved }));
    }
  }, 1200);
}

export function startAutosave(): () => void {
  const unsubs = [
    useData.subscribe(scheduleAutosave),
    useSyntax.subscribe(scheduleAutosave),
    useOutput.subscribe(scheduleAutosave),
    useJournal.subscribe(scheduleAutosave),
    useDialogMemory.subscribe(scheduleAutosave),
  ];
  return () => unsubs.forEach((u) => u());
}
