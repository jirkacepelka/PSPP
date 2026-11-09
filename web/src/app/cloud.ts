/*
 * Cloud documents. While signed in, every document you edit is saved to your account a moment
 * after it is saved in the browser (no button), changes from your other devices arrive by
 * themselves (also in the document you have open), and settings can follow you too.
 * Conflicts never lose data: the version from the other device is kept as a separate copy.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { t } from 'i18next';
import * as api from '../lib/cloud';
import { kvGet, kvSet } from '../lib/storage';
import { useAccount } from '../store/account';
import { getSettings, useSettings, type Settings } from '../store/settings';
import { useUi } from '../store/ui';
import { deleteDocumentLocal, docHooks, flushAutosave, getCurrentDocId, makeDocId, readDocIndex, readDocument, reloadCurrentDocument, storeDocument, type AutosaveState, type DocMeta } from './files';

interface Link {
  cloudId: string;
  rev: number;
  /** AutosaveState.time of the version that was last in sync with the cloud. */
  time: number;
  name: string;
}
const LINKS_KEY = 'cloud.links.v1';
const LOCAL_ONLY_KEY = 'cloud.localonly.v1';
let links: Record<string, Link> | null = null;
let localOnly: Set<string> | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Local autosave already waits ~1 s, so the cloud follows quickly: about 2 s from keystroke to server. */
const PUSH_DELAY = 800;
const POLL_MS = 30_000;

const toast = (m: string, o?: Parameters<ReturnType<typeof useUi.getState>['toast']>[1]) => useUi.getState().toast(m, o);

async function readLinks() {
  if (!links) links = (await kvGet<Record<string, Link>>(LINKS_KEY)) ?? {};
  return links;
}
async function writeLinks() {
  if (links) await kvSet(LINKS_KEY, links);
}
async function readLocalOnly() {
  if (!localOnly) localOnly = new Set((await kvGet<string[]>(LOCAL_ONLY_KEY)) ?? []);
  return localOnly;
}
async function writeLocalOnly() {
  if (localOnly) await kvSet(LOCAL_ONLY_KEY, [...localOnly]);
}

const setSync = (sync: ReturnType<typeof useAccount.getState>['sync']) => useAccount.getState().set({ sync });
const signedIn = () => !!useAccount.getState().user;

function docName(state: AutosaveState) {
  return state.title || state.tabs.find((x) => x.text.trim())?.title || t('files.untitled');
}

let tooLargeShown = false;

async function push(localId: string): Promise<void> {
  if (!signedIn()) return;
  if ((await readLocalOnly()).has(localId)) return;
  const state = await readDocument(localId);
  if (!state) return;
  const all = await readLinks();
  try {
    setSync('saving');
    let link = all[localId];
    if (!link) {
      const name = docName(state);
      const created = await api.createProject(name);
      link = all[localId] = { cloudId: created.id, rev: created.rev, time: 0, name };
      await writeLinks();
    }
    try {
      const saved = await api.putDoc(link.cloudId, link.rev, state);
      link.rev = saved.rev;
    } catch (e) {
      if (!(e instanceof api.ApiError) || e.status !== 409) throw e;
      // another device saved in between: keep its version as a copy here, then continue with ours
      const remote = await api.getDoc<AutosaveState>(link.cloudId);
      if (remote.value) {
        await storeDocument(makeDocId(), { ...remote.value, title: t('cloud.otherDevice', { name: docName(remote.value) }) }, remote.value.time);
        toast(t('cloud.conflict'), { kind: 'info' });
      }
      const saved = await api.putDoc(link.cloudId, remote.rev, state);
      link.rev = saved.rev;
    }
    link.time = state.time;
    const name = docName(state);
    if (name !== link.name) {
      await api.renameProject(link.cloudId, name).catch(() => undefined);
      link.name = name;
    }
    await writeLinks();
    tooLargeShown = false;
    setSync('saved');
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 413) {
      setSync(e.code === 'quota_exceeded' ? 'quota' : 'tooLarge');
      if (!tooLargeShown) {
        tooLargeShown = true;
        toast(t(e.code === 'quota_exceeded' ? 'cloud.quotaFull' : 'cloud.tooLarge'), { kind: 'error' });
      }
    } else if (e instanceof api.ApiError && e.status === 401) {
      await signOut(false);
      toast(t('cloud.sessionEnded'), { kind: 'info' });
    } else {
      setSync('offline');
      schedule(localId, 30_000);
    }
  }
}

function schedule(localId: string, delay = PUSH_DELAY) {
  const old = timers.get(localId);
  if (old) clearTimeout(old);
  if (delay <= PUSH_DELAY) setSync('saving'); // shown at once, not after the delay
  timers.set(
    localId,
    setTimeout(() => {
      timers.delete(localId);
      void push(localId);
    }, delay),
  );
}

/** Runs `fn` over `items` with a few requests in flight at once. */
async function inParallel<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/** Re-reads the storage used (shown in the profile). */
export async function refreshUsage() {
  if (!signedIn()) return;
  try {
    const { projects: _p, ...usage } = await api.listProjects();
    void _p;
    useAccount.getState().set({ usage });
  } catch {
    /* shown next time */
  }
}

let pulling: Promise<void> | null = null;

/** Brings in documents that are new or newer in the cloud; the open document is updated in place. */
export function pullFromCloud(): Promise<void> {
  if (!signedIn()) return Promise.resolve();
  if (pulling) return pulling;
  pulling = doPull().finally(() => (pulling = null));
  return pulling;
}

async function doPull(): Promise<void> {
  try {
    const { projects, ...usage } = await api.listProjects();
    useAccount.getState().set({ usage });
    const all = await readLinks();
    const only = await readLocalOnly();
    const byCloud = new Map(Object.entries(all).map(([local, l]) => [l.cloudId, local]));
    const wanted = projects.filter((p) => {
      const local = byCloud.get(p.id);
      return !local || all[local].rev < p.rev;
    });
    await inParallel(wanted, 4, async (p) => {
      const local = byCloud.get(p.id);
      const remote = await api.getDoc<AutosaveState>(p.id);
      if (!remote.value) return;
      if (!local) {
        const id = makeDocId();
        all[id] = { cloudId: p.id, rev: remote.rev, time: remote.value.time, name: p.name };
        await storeDocument(id, remote.value, p.created_at);
        return;
      }
      if (local === getCurrentDocId()) await flushAutosave(); // our own pending edit must be on disk before we compare
      const mine = await readDocument(local);
      const editedHere = !!mine && (mine.time > all[local].time || timers.has(local));
      if (editedHere) {
        // edited here and elsewhere since the last sync: keep both
        await storeDocument(makeDocId(), { ...remote.value, title: t('cloud.otherDevice', { name: docName(remote.value) }) }, remote.value.time);
        all[local].rev = remote.rev;
        toast(t('cloud.conflict'), { kind: 'info' });
        schedule(local, 300);
        return;
      }
      all[local] = { cloudId: p.id, rev: remote.rev, time: remote.value.time, name: p.name };
      only.delete(local);
      await storeDocument(local, remote.value, p.created_at);
      if (local === getCurrentDocId()) await reloadCurrentDocument(remote.value);
    });
    // deleted on another device
    const alive = new Set(projects.map((p) => p.id));
    for (const [local, l] of Object.entries(all)) {
      if (!alive.has(l.cloudId) && local !== getCurrentDocId()) {
        delete all[local];
        await deleteDocumentLocal(local);
      }
    }
    await writeLinks();
    await writeLocalOnly();
    if (useAccount.getState().sync !== 'saving') setSync('saved');
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) await signOut(false);
    else setSync('offline');
  }
}

// ------------------------------------------------------------------ settings in the account

const settingsFlagKey = (uid: string) => `pspp-studio.settingsSync.${uid}`;
/** Server time of the settings version this browser last pushed or applied. */
const settingsRevKey = (uid: string) => `pspp-studio.settingsRev.${uid}`;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
let unsubSettings: (() => void) | null = null;
let applyingRemote = false;
/** When the settings last changed in this browser: a pull that started earlier must not overwrite them. */
let localChangeAt = 0;

function settingsSyncOn(): boolean {
  const u = useAccount.getState().user;
  try {
    return !!u && localStorage.getItem(settingsFlagKey(u.id)) === '1';
  } catch {
    return false;
  }
}
function setSettingsSync(on: boolean) {
  const u = useAccount.getState().user;
  if (!u) return;
  try {
    if (on) localStorage.setItem(settingsFlagKey(u.id), '1');
    else localStorage.removeItem(settingsFlagKey(u.id));
  } catch {
    /* ignore */
  }
}
function knownSettingsRev(): number {
  const u = useAccount.getState().user;
  try {
    return u ? Number(localStorage.getItem(settingsRevKey(u.id)) ?? '0') : 0;
  } catch {
    return 0;
  }
}
function rememberSettingsRev(rev: number | null | undefined) {
  const u = useAccount.getState().user;
  if (!u || !rev) return;
  try {
    localStorage.setItem(settingsRevKey(u.id), String(rev));
  } catch {
    /* ignore */
  }
}

/** The part of the settings that follows you: appearance and preferences, not this browser's onboarding state. */
function portableSettings(): Partial<Settings> {
  const { onboarded: _o, ...rest } = getSettings();
  void _o;
  const out: Partial<Settings> = rest;
  if (out.profile?.avatar && out.profile.avatar.length > 100_000) out.profile = { ...out.profile, avatar: undefined };
  return out;
}

async function pushSettings() {
  try {
    rememberSettingsRev((await api.putSettings(portableSettings())).updated);
  } catch {
    /* retried on the next change */
  }
}

function startSettingsSync() {
  unsubSettings?.();
  unsubSettings = useSettings.subscribe(() => {
    if (applyingRemote || !signedIn() || !settingsSyncOn()) return;
    localChangeAt = Date.now();
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      settingsTimer = null;
      void pushSettings();
    }, 1500);
  });
}

/** Applies the account's settings only when they are newer than what this browser has and nothing local is pending. */
async function pullSettings() {
  if (!signedIn() || !settingsSyncOn() || settingsTimer) return;
  const started = Date.now();
  try {
    const { settings, updated } = await api.getSettings<Partial<Settings>>();
    if (!settings || !updated || updated <= knownSettingsRev()) return;
    if (settingsTimer || localChangeAt >= started) return; // edited here while we were asking
    applyingRemote = true;
    useSettings.getState().set(settings);
    rememberSettingsRev(updated);
  } catch {
    /* try again later */
  } finally {
    applyingRemote = false;
  }
}

export const settingsSyncEnabled = settingsSyncOn;
export async function setSettingsSyncEnabled(on: boolean) {
  setSettingsSync(on);
  if (on) await pushSettings();
}

// ------------------------------------------------------------------ migration after signing in

export interface MigrationPlan {
  docs: DocMeta[];
  cloudHasSettings: boolean;
  /** Settings were customised in this browser (set up, or a named profile). */
  localSettings: boolean;
}

const migratedKey = (uid: string) => `pspp-studio.migrated.${uid}`;

export async function planMigration(): Promise<MigrationPlan | null> {
  const user = useAccount.getState().user;
  if (!user) return null;
  try {
    if (localStorage.getItem(migratedKey(user.id)) === '1') return null;
  } catch {
    /* ignore */
  }
  const all = await readLinks();
  const docs = (await readDocIndex()).filter((m) => !all[m.id]);
  let cloudHasSettings = false;
  try {
    cloudHasSettings = !!(await api.getSettings()).settings;
  } catch {
    /* treat as none */
  }
  const localSettings = useSettings.getState().onboarded;
  if (!docs.length && !cloudHasSettings && !localSettings) return null;
  return { docs, cloudHasSettings, localSettings };
}

export type SettingsChoice = 'upload' | 'download' | 'none';

export async function runMigration(docIds: string[], settings: SettingsChoice, onProgress?: (done: number, total: number) => void) {
  const user = useAccount.getState().user;
  if (!user) return;
  const chosen = new Set(docIds);
  const only = await readLocalOnly();
  const all = await readLinks();
  const rest = (await readDocIndex()).filter((m) => !all[m.id] && !chosen.has(m.id));
  for (const m of rest) only.add(m.id);
  await writeLocalOnly();

  let done = 0;
  for (const id of docIds) {
    only.delete(id);
    await push(id);
    onProgress?.(++done, docIds.length);
  }
  await writeLocalOnly();

  if (settings === 'upload') {
    setSettingsSync(true);
    await pushSettings();
  } else if (settings === 'download') {
    setSettingsSync(true);
    await pullSettings(); // the account's settings are newer than anything this browser has seen
  }
  try {
    localStorage.setItem(migratedKey(user.id), '1');
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ session

let pollTimer: ReturnType<typeof setInterval> | null = null;
const refresh = () => {
  if (document.visibilityState === 'visible' && signedIn()) {
    void pullFromCloud();
    void pullSettings();
  }
};

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refresh, POLL_MS);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  startSettingsSync();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener('visibilitychange', refresh);
  window.removeEventListener('focus', refresh);
  window.removeEventListener('online', refresh);
  unsubSettings?.();
  unsubSettings = null;
}

/** Signs in; resolves to the migration plan when there is something to decide, else null. */
export async function signIn(mode: 'login' | 'register', email: string, password: string, invite = ''): Promise<MigrationPlan | null> {
  const res = mode === 'register' ? await api.register(email, password, invite) : await api.login(email, password);
  api.setToken(res.token);
  useAccount.getState().set({ user: res.user, sync: 'idle' });
  startPolling();
  await pullFromCloud();
  return planMigration();
}

export async function signOut(remote = true): Promise<void> {
  if (remote) await api.logout();
  api.setToken(null);
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  stopPolling();
  useAccount.getState().set({ user: null, usage: null, sync: 'idle' });
}

/** Called once at startup: restores the session and hooks into document saving. */
export async function initCloud(): Promise<void> {
  docHooks.onSaved = (id) => {
    if (!signedIn()) return;
    void readLocalOnly().then((only) => {
      if (!only.has(id)) schedule(id);
    });
  };
  docHooks.onDeleted = (id) => {
    void (async () => {
      const all = await readLinks();
      const link = all[id];
      (await readLocalOnly()).delete(id);
      await writeLocalOnly();
      if (!link) return;
      delete all[id];
      await writeLinks();
      if (signedIn()) await api.deleteProject(link.cloudId).catch(() => undefined);
    })();
  };
  if (!api.getToken()) return;
  try {
    const info = await api.me();
    useAccount.getState().set({ user: info.user, usage: { used: info.used, quota: info.quota } });
    await readLinks();
    startPolling();
    await pullFromCloud();
    await pullSettings();
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) api.setToken(null);
    // offline: stay signed out in the UI until the next start; local work is unaffected
  }
}
