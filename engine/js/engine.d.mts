// Type declarations for engine.mjs.
// SPDX-License-Identifier: GPL-3.0-or-later

export function psppString(s: string): string;

export interface PsppEngine {
  init(): Promise<{ version: string }>;
  run(syntax: string, dataset: unknown | null): Promise<{ items: unknown[]; ok: boolean; dataset: unknown }>;
  open(file: { name: string; bytes: Uint8Array }): Promise<{ dataset?: unknown; syntax?: string; items?: unknown[] }>;
  save(dataset: unknown | null, format: 'sav' | 'zsav' | 'por' | 'csv'): Promise<Uint8Array>;
  setLanguage(lang: string, mo?: Uint8Array | null): Promise<boolean>;
  runRaw(syntax: string): { ok: boolean; errors: number; items: unknown[] };
}

export function createEngine(
  createModule: (opts: object) => Promise<unknown>,
  moduleOpts?: object,
): Promise<PsppEngine>;
