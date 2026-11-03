/*
 * PSPP engine Web Worker.
 *
 * Loads the Emscripten build of GNU PSPP from /engine/pspp.js (web/public/engine/) and exposes
 * the EngineApi via Comlink, using the shared wrapper in engine/js/engine.mjs.  If PSPP aborts
 * (a WebAssembly trap leaves the module unusable), a fresh instance is created and the dataset
 * is sent again with the next call.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as Comlink from 'comlink';
import { createEngine, type PsppEngine } from '../../../engine/js/engine.mjs';
import type { Dataset, EngineApi, OutputItem, RunResult } from './types';

type Factory = (opts: object) => Promise<unknown>;

let factory: Promise<Factory> | null = null;
let engine: Promise<PsppEngine> | null = null;
let language = 'en';
const catalogs = new Map<string, Uint8Array | null>();

const engineUrl = (p: string) => new URL(`/engine/${p}`, self.location.origin).href;

function loadFactory(): Promise<Factory> {
  if (!factory) {
    factory = (async () => {
      const url = engineUrl('pspp.js');
      const head = await fetch(url, { method: 'HEAD' });
      const type = head.headers.get('content-type') ?? '';
      if (!head.ok || type.includes('text/html')) throw new Error('PSPP WebAssembly engine is not available at /engine/pspp.js');
      const mod = (await import(/* @vite-ignore */ url)) as { default?: Factory };
      if (typeof mod.default !== 'function') throw new Error('Invalid PSPP engine module');
      return mod.default;
    })();
  }
  return factory;
}

async function catalog(lang: string): Promise<Uint8Array | null> {
  if (lang === 'en') return null;
  if (!catalogs.has(lang)) {
    try {
      const r = await fetch(engineUrl(`locale/${lang}/pspp.mo`));
      catalogs.set(lang, r.ok ? new Uint8Array(await r.arrayBuffer()) : null);
    } catch {
      catalogs.set(lang, null);
    }
  }
  return catalogs.get(lang) ?? null;
}

function getEngine(): Promise<PsppEngine> {
  if (!engine) {
    engine = (async () => {
      const create = await loadFactory();
      const e = await createEngine(create, { locateFile: (p: string) => engineUrl(p) });
      await e.setLanguage(language, await catalog(language));
      return e;
    })();
    engine.catch(() => {
      engine = null;
    });
  }
  return engine;
}

/** Emscripten aborts surface as RuntimeError ("unreachable", "Aborted(...)"). */
function isFatal(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /RuntimeError|Aborted|unreachable|memory access out of bounds/i.test(msg);
}

async function guarded<T>(fn: (e: PsppEngine) => Promise<T>): Promise<T> {
  const e = await getEngine();
  try {
    return await fn(e);
  } catch (err) {
    if (isFatal(err)) engine = null; // next call starts a fresh PSPP instance
    throw err;
  }
}

const crashItem = (err: unknown): OutputItem => ({
  id: `crash-${Date.now()}`,
  kind: 'message',
  severity: 'error',
  text: `PSPP engine crashed and was restarted (${err instanceof Error ? err.message : String(err)}). The data in the editor is unchanged.`,
});

const api: EngineApi = {
  async init() {
    return (await getEngine()).init();
  },
  async open(file) {
    const r = await guarded((e) => e.open(file));
    return r as Awaited<ReturnType<EngineApi['open']>>;
  },
  async save(dataset, format) {
    const bytes = await guarded((e) => e.save(dataset, format));
    return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
  },
  async run(syntax, dataset): Promise<RunResult> {
    try {
      const r = await guarded((e) => e.run(syntax, dataset));
      return { items: r.items as OutputItem[], ok: r.ok, dataset: r.dataset as Dataset };
    } catch (err) {
      if (!isFatal(err)) throw err;
      return { items: [crashItem(err)], ok: false, dataset: null };
    }
  },
  async setLanguage(lang) {
    language = lang;
    if (!engine) return true; // applied when the engine starts
    return guarded(async (e) => e.setLanguage(lang, await catalog(lang)));
  },
};

Comlink.expose(api);
