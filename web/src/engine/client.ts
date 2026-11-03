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
        return remote.open(Comlink.transfer({ name: f.name, bytes }, [bytes.buffer as ArrayBuffer]));
      },
      save: (d, fmt) => remote.save(d, fmt),
      run: (s, d) => remote.run(s, d),
    };
    return { api, kind: 'wasm', version };
  } catch (e) {
    worker?.terminate();
    console.info('[PSPP Studio] WebAssembly engine unavailable, using demo engine:', e instanceof Error ? e.message : e);
    return loadMock();
  }
}

export function getEngineHandle(): Promise<EngineHandle> {
  if (!handle) handle = load();
  return handle;
}

export async function getEngine(): Promise<EngineApi> {
  return (await getEngineHandle()).api;
}
