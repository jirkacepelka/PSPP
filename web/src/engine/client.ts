/*
 * Engine client: loads the PSPP WebAssembly worker, falling back to the JavaScript mock engine.
 * Append `?engine=mock` to the URL to force the mock engine.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as Comlink from 'comlink';
import type { EngineApi } from './types';
import { createMockEngine } from './mock';

export type EngineKind = 'wasm' | 'mock';

export interface EngineHandle {
  api: EngineApi;
  kind: EngineKind;
  version: string;
}

let handle: Promise<EngineHandle> | null = null;
/** The dataset object the worker currently holds (see run()). */
let lastSynced: unknown;

function wantMock(): boolean {
  try {
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    return p.get('engine') === 'mock';
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Engine init timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function loadMock(): Promise<EngineHandle> {
  const api = createMockEngine();
  const { version } = await api.init();
  return { api, kind: 'mock', version };
}

async function load(): Promise<EngineHandle> {
  if (wantMock() || typeof Worker === 'undefined') return loadMock();
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'pspp-engine' });
    const remote = Comlink.wrap<EngineApi>(worker);
    const { version } = await withTimeout(remote.init(), 60000);
    const api: EngineApi = {
      init: () => remote.init(),
      open: (f) => {
        const bytes = f.bytes.slice();
        return remote.open(Comlink.transfer({ name: f.name, bytes }, [bytes.buffer as ArrayBuffer])).then((r) => {
          lastSynced = undefined; // caller stores the result, then calls markSynced()
          return r;
        });
      },
      save: (d, fmt) => remote.save(d, fmt),
      run: async (s, d) => {
        // The worker keeps the dataset from the previous call.  Only send it again when the
        // editor's dataset is a different object (i.e. it was edited) — structured cloning a
        // large dataset on every run would be wasteful.
        const send = d && d === lastSynced ? null : d;
        const r = await remote.run(s, send);
        const crashed = r.items.some((i) => i.id.startsWith('crash-'));
        lastSynced = crashed ? undefined : r.dataset ? undefined : d ?? undefined;
        return r;
      },
      setLanguage: (lang) => (remote as unknown as { setLanguage(l: string): Promise<boolean> }).setLanguage(lang),
    };
    return { api, kind: 'wasm', version };
  } catch (e) {
    worker?.terminate();
    console.info('[PSPP Studio] WebAssembly engine unavailable, using demo engine:', e instanceof Error ? e.message : e);
    return loadMock();
  }
}

/**
 * Tells the client that DATASET (the editor's current dataset object) is identical to what the
 * engine holds, e.g. right after storing a dataset returned by run() or open(), so the next
 * run() need not send it again.
 */
export function markSynced(dataset: unknown) {
  lastSynced = dataset;
}

export function getEngineHandle(): Promise<EngineHandle> {
  if (!handle) handle = load();
  return handle;
}

export async function getEngine(): Promise<EngineApi> {
  return (await getEngineHandle()).api;
}
