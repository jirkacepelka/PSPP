/*
 * Cloud documents. While signed in, every document you edit is saved to your account a moment
 * after it is saved in the browser (no button), and documents from your other devices appear on
 * the start screen. Work done before signing in stays in the browser until you edit it again.
 * Conflicts never lose data: the version from the other device is kept as a separate copy.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { t } from 'i18next';
import * as api from '../lib/cloud';
import { kvGet, kvSet } from '../lib/storage';
import { useAccount } from '../store/account';
import { useUi } from '../store/ui';
import { docHooks, getCurrentDocId, makeDocId, readDocument, storeDocument, type AutosaveState } from './files';

interface Link {
  cloudId: string;
  rev: number;
  /** AutosaveState.time of the version that was last in sync with the cloud. */
  time: number;
  name: string;
}
const LINKS_KEY = 'cloud.links.v1';
let links: Record<string, Link> | null = null;
const toast = (m: string, o?: Parameters<ReturnType<typeof useUi.getState>['toast']>[1]) => useUi.getState().toast(m, o);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const PUSH_DELAY = 2500;

async function readLinks() {
  if (!links) links = (await kvGet<Record<string, Link>>(LINKS_KEY)) ?? {};
  return links;
}
async function writeLinks() {
  if (links) await kvSet(LINKS_KEY, links);
}

const setSync = (sync: ReturnType<typeof useAccount.getState>['sync']) => useAccount.getState().set({ sync });
const signedIn = () => !!useAccount.getState().user;

function docName(state: AutosaveState) {
  return state.title || state.tabs.find((x) => x.text.trim())?.title || t('files.untitled');
}

let tooLargeShown = false;

async function push(localId: string): Promise<void> {
  if (!signedIn()) return;
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
  timers.set(
    localId,
    setTimeout(() => {
      timers.delete(localId);
      void push(localId);
    }, delay),
  );
}

async function refreshUsage() {
  try {
    const { projects: _p, ...usage } = await api.listProjects();
    useAccount.getState().set({ usage });
  } catch {
    /* shown next time */
  }
}

/** Downloads documents that are new or newer in the cloud. Skips the document that is open. */
export async function pullFromCloud(): Promise<void> {
  if (!signedIn()) return;
  try {
    const { projects, ...usage } = await api.listProjects();
    useAccount.getState().set({ usage });
    const all = await readLinks();
    const byCloud = new Map(Object.entries(all).map(([local, l]) => [l.cloudId, local]));
    for (const p of projects) {
      const local = byCloud.get(p.id);
      if (local && all[local].rev >= p.rev) continue;
      if (local && local === getCurrentDocId()) continue;
      const remote = await api.getDoc<AutosaveState>(p.id);
      if (!remote.value) continue;
      if (local) {
        const mine = await readDocument(local);
        if (mine && mine.time > all[local].time) {
          // edited here and elsewhere since the last sync: keep both
          await storeDocument(makeDocId(), { ...remote.value, title: t('cloud.otherDevice', { name: docName(remote.value) }) }, remote.value.time);
          all[local].rev = remote.rev;
          schedule(local, 500);
          continue;
        }
        await storeDocument(local, remote.value, remote.value.time);
        all[local] = { cloudId: p.id, rev: remote.rev, time: remote.value.time, name: p.name };
      } else {
        const id = makeDocId();
        await storeDocument(id, remote.value, p.created_at);
        all[id] = { cloudId: p.id, rev: remote.rev, time: remote.value.time, name: p.name };
      }
    }
    // deleted on another device
    const alive = new Set(projects.map((p) => p.id));
    for (const [local, l] of Object.entries(all)) {
      if (!alive.has(l.cloudId) && local !== getCurrentDocId()) {
        delete all[local];
        const { deleteDocumentLocal } = await import('./files');
        await deleteDocumentLocal(local);
      }
    }
    await writeLinks();
    setSync('saved');
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) await signOut(false);
    else setSync('offline');
  }
}

export async function signIn(mode: 'login' | 'register', email: string, password: string, invite = ''): Promise<void> {
  const res = mode === 'register' ? await api.register(email, password, invite) : await api.login(email, password);
  api.setToken(res.token);
  useAccount.getState().set({ user: res.user, sync: 'idle' });
  await pullFromCloud();
}

export async function signOut(remote = true): Promise<void> {
  if (remote) await api.logout();
  api.setToken(null);
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  useAccount.getState().set({ user: null, usage: null, sync: 'idle' });
}

/** Called once at startup: restores the session and hooks into document saving. */
export async function initCloud(): Promise<void> {
  docHooks.onSaved = (id) => {
    if (signedIn()) schedule(id);
  };
  docHooks.onDeleted = (id) => {
    void (async () => {
      const all = await readLinks();
      const link = all[id];
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
    await pullFromCloud();
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) api.setToken(null);
    // offline: stay signed out in the UI until the next start; local work is unaffected
  }
}

export { refreshUsage };
