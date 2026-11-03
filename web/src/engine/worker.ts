/*
 * PSPP engine Web Worker.
 *
 * Loads the Emscripten build of GNU PSPP from `/engine/pspp.js` (served from `public/engine/`)
 * and exposes the EngineApi via Comlink. The WASM glue is completed by the engine build;
 * until `/engine/pspp.js` exists, `init()` rejects and the client falls back to the mock engine.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as Comlink from 'comlink';
import type { Dataset, EngineApi, OutputItem, RunResult } from './types';

/** Shape expected from the Emscripten module factory exported by /engine/pspp.js. */
interface PsppModule {
  /** Optional high-level bridge implemented on the C/JS side of the engine build. */
  psppStudio?: {
    version(): string;
    open(name: string, bytes: Uint8Array): { dataset?: Dataset; syntax?: string; items?: OutputItem[] };
    save(dataset: Dataset, format: string): Uint8Array;
    run(syntax: string, dataset: Dataset | null): RunResult;
  };
}

let modulePromise: Promise<PsppModule> | null = null;

async function loadModule(): Promise<PsppModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const url = new URL('/engine/pspp.js', self.location.origin).href;
      const head = await fetch(url, { method: 'HEAD' });
      const type = head.headers.get('content-type') ?? '';
      if (!head.ok || type.includes('text/html')) throw new Error('PSPP WebAssembly engine is not available at /engine/pspp.js');
      const mod = (await import(/* @vite-ignore */ url)) as { default?: (opts?: object) => Promise<PsppModule> };
      if (typeof mod.default !== 'function') throw new Error('Invalid PSPP engine module');
      return mod.default({ locateFile: (p: string) => new URL(`/engine/${p}`, self.location.origin).href });
    })();
  }
  return modulePromise;
}

async function bridge() {
  const m = await loadModule();
  if (!m.psppStudio) throw new Error('PSPP engine bridge (psppStudio) is not implemented yet');
  return m.psppStudio;
}

const api: EngineApi = {
  async init() {
    const b = await bridge();
    return { version: b.version() };
  },
  async open(file) {
    return (await bridge()).open(file.name, file.bytes);
  },
  async save(dataset, format) {
    const bytes = (await bridge()).save(dataset, format);
    return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
  },
  async run(syntax, dataset) {
    return (await bridge()).run(syntax, dataset);
  },
};

Comlink.expose(api);
