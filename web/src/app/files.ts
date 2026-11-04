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
  // with autosave the current work is kept as a document on the start screen: nothing to lose
  if (useSettings.getState().autosave) {
    void beginNewDocument().then(onOk);
    return;
  }
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
    if (useUi.getState().showStart) {
      await beginNewDocument();
      const id = useSyntax.getState().tabs[0].id;
      useSyntax.getState().load([{ id, title: name, text, diagnostics: [], version: 0 }]);
      useData.getState().setTitle(name.replace(/\.[^.]+$/, ''));
    } else useSyntax.getState().add(text, name);
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

export async function newSyntax() {
  if (useUi.getState().showStart) await beginNewDocument();
  else useSyntax.getState().add();
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

// ------------------------------------------------------------------ documents (autosave)
//
// Every piece of work is a "document" kept in this browser: data, syntax tabs, output, journal
// and dialog memory. The current document autosaves while you work; the start screen lists all
// of them, like a file manager that needs no saving.

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

export interface DocMeta {
  id: string;
  title: string;
  created: number;
  time: number;
  kind: 'data' | 'syntax';
  cases: number;
  vars: number;
  outputs: number;
  /** Tiny preview for the start screen card: column names and a few rows, or syntax lines. */
  preview: { cols: string[]; rows: string[][] } | { lines: string[] };
  fileName: string | null;
}

const DOCS_KEY = 'docs.index.v1';
const docKey = (id: string) => `doc:${id}`;
let currentDocId: string | null = null;
let currentCreated = 0;

export function getCurrentDocId() {
  return currentDocId;
}

function docsChanged() {
  window.dispatchEvent(new Event('pspp-docs-changed'));
}

async function readIndex(): Promise<DocMeta[]> {
  const list = await kvGet<DocMeta[]>(DOCS_KEY);
  return Array.isArray(list) ? list : [];
}

let migrated = false;
/** Imports the single-slot autosave of earlier versions as a document. */
async function migrateLegacy() {
  if (migrated) return;
  migrated = true;
  const a = await kvGet<AutosaveState>(AUTOSAVE_KEY);
  if (!a || typeof a !== 'object' || !('time' in a)) return;
  const id = newDocId();
  await kvSet(docKey(id), a);
  await kvSet(DOCS_KEY, [metaOf(id, a, a.time), ...(await readIndex())]);
  await kvDel(AUTOSAVE_KEY);
}

export async function listDocuments(): Promise<DocMeta[]> {
  await migrateLegacy();
  return (await readIndex()).sort((a, b) => b.time - a.time);
}

const newDocId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function cellText(v: unknown, labels?: { value: unknown; label: string }[]) {
  if (v == null || v === '') return '';
  const l = labels?.find((x) => x.value === v);
  if (l) return l.label;
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
}

function metaOf(id: string, a: AutosaveState, created: number): DocMeta {
  const ds = a.dataset;
  const hasData = !!ds && ds.variables.length > 0;
  const cases = ds ? Math.max(0, ...ds.columns.map((c) => c?.length ?? 0)) : 0;
  const syntaxText = a.tabs.map((x) => x.text).join('\n');
  const preview: DocMeta['preview'] = hasData
    ? {
        cols: ds!.variables.slice(0, 5).map((v) => v.name),
        rows: Array.from({ length: Math.min(6, cases) }, (_, r) => ds!.variables.slice(0, 5).map((v, c) => cellText(ds!.columns[c]?.[r], v.valueLabels))),
      }
    : { lines: syntaxText.split('\n').filter((l) => l.trim()).slice(0, 7) };
  return {
    id,
    title: a.title || a.tabs.find((x) => x.text.trim())?.title || t('files.untitled'),
    created,
    time: a.time,
    kind: hasData ? 'data' : 'syntax',
    cases,
    vars: ds?.variables.length ?? 0,
    outputs: a.output?.length ?? 0,
    preview,
    fileName: a.fileName,
  };
}

/** Resets the workspace to an empty document; the next change autosaves as a new one. */
export async function beginNewDocument() {
  await flushAutosave();
  currentDocId = null;
  currentHandle = null;
  useData.getState().load(null, { title: '', fileName: null });
  useSyntax.getState().load([{ id: `syntax${Date.now().toString(36)}`, title: 'Syntax 1', text: '', diagnostics: [], version: 0 }]);
  useOutput.getState().load([]);
  useJournal.getState().load([]);
  useDialogMemory.getState().load({ lastValues: {}, recent: [] });
}

/** Opens a document from the start screen. */
export async function openDocument(id: string) {
  if (id === currentDocId && (useData.getState().dataset || useSyntax.getState().tabs.some((x) => x.text.trim()))) {
    useUi.getState().setShowStart(false);
    return;
  }
  const a = await kvGet<AutosaveState>(docKey(id));
  if (!a) {
    toast(t('docs.missing'), { kind: 'error' });
    return;
  }
  await beginNewDocument();
  const meta = (await readIndex()).find((m) => m.id === id);
  currentDocId = id;
  currentCreated = meta?.created ?? a.time;
  restoreAutosave(a);
  useData.getState().markSaved();
  // merely opening a document is not an edit: drop the autosave the restore just scheduled
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

export async function deleteDocument(id: string) {
  await kvDel(docKey(id));
  await kvSet(DOCS_KEY, (await readIndex()).filter((m) => m.id !== id));
  if (id === currentDocId) currentDocId = null;
  docsChanged();
}

export async function duplicateDocument(id: string) {
  const a = await kvGet<AutosaveState>(docKey(id));
  if (!a) return;
  const nid = newDocId();
  const copy = { ...a, time: Date.now(), title: t('docs.copyOf', { name: a.title || t('files.untitled') }) };
  await kvSet(docKey(nid), copy);
  await kvSet(DOCS_KEY, [metaOf(nid, copy, copy.time), ...(await readIndex())]);
  docsChanged();
}

export async function renameDocument(id: string, title: string) {
  if (id === currentDocId) {
    useData.getState().setTitle(title);
    return;
  }
  const a = await kvGet<AutosaveState>(docKey(id));
  if (!a) return;
  const next = { ...a, title };
  await kvSet(docKey(id), next);
  await kvSet(DOCS_KEY, (await readIndex()).map((m) => (m.id === id ? { ...m, title } : m)));
  docsChanged();
}

/** Kept for compatibility: the most recent document as an autosave snapshot. */
export async function getAutosave(): Promise<AutosaveState | undefined> {
  const [m] = await listDocuments();
  return m ? kvGet<AutosaveState>(docKey(m.id)) : undefined;
}

export function restoreAutosave(a: AutosaveState) {
  if (a.dataset) useData.getState().load(a.dataset, { title: a.title, fileName: a.fileName, dirty: true });
  else useData.getState().setTitle(a.title);
  if (a.tabs?.length) useSyntax.getState().load(a.tabs, a.activeTab);
  if (a.output?.length) useOutput.getState().load(a.output);
  if (a.journal?.length) useJournal.getState().load(a.journal);
  if (a.dialogs) useDialogMemory.getState().load(a.dialogs);
  useUi.getState().setView(a.dataset ? 'data' : 'syntax');
}

/** Deletes every document kept in this browser. */
export async function clearAutosave() {
  for (const m of await readIndex()) await kvDel(docKey(m.id));
  await kvSet(DOCS_KEY, []);
  await kvDel(AUTOSAVE_KEY);
  currentDocId = null;
  docsChanged();
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved = 0;
let saving: Promise<void> | null = null;

function snapshot(): AutosaveState | null {
  const d = useData.getState();
  const s = useSyntax.getState();
  const o = useOutput.getState();
  if (!d.dataset && s.tabs.every((x) => !x.text.trim()) && !o.entries.length) return null;
  return {
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
}

async function writeNow() {
  const state = snapshot();
  if (!state) return;
  if (!currentDocId) {
    currentDocId = newDocId();
    currentCreated = state.time;
  }
  const id = currentDocId;
  const ok = await kvSet(docKey(id), state);
  if (!ok) return;
  const meta = metaOf(id, state, currentCreated);
  const list = await readIndex();
  await kvSet(DOCS_KEY, [meta, ...list.filter((m) => m.id !== id)]);
  lastSaved = Date.now();
  window.dispatchEvent(new CustomEvent('pspp-autosaved', { detail: lastSaved }));
  docsChanged();
}

/** Writes pending changes of the current document right away. */
export async function flushAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (useSettings.getState().autosave) await writeNow();
  }
  if (saving) await saving;
}

export function scheduleAutosave() {
  if (!useSettings.getState().autosave) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    saving = writeNow().finally(() => (saving = null));
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
  const onHide = () => void flushAutosave();
  window.addEventListener('pagehide', onHide);
  const onVis = () => document.visibilityState === 'hidden' && void flushAutosave();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    unsubs.forEach((u) => u());
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVis);
  };
}
