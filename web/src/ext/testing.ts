/*
 * Test helpers for extension analyses: run syntax through the same path as the app (real PSPP
 * engine for PSPP commands when its build is present, extension commands in-process) and read
 * tables back as numbers.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import i18n from '../i18n';
import type { Dataset, EngineApi, OutputItem } from '../engine/types';
import { parsePivot, type PivotTable } from '../lib/pivot';
import { runExtCommand, runWithExtensions } from './runner';
import { commandName } from '../lib/commands';
import type { ExtContext } from './types';

const ENGINE = path.resolve(__dirname, '../../public/engine/pspp.js');
const WRAPPER = path.resolve(__dirname, '../../../engine/js/engine.mjs');
export const haveEngine = fs.existsSync(ENGINE) && fs.existsSync(WRAPPER);

let engine: Promise<EngineApi> | null = null;
export function realEngine(): Promise<EngineApi> {
  engine ??= (async () => {
    const { createEngine } = await import(/* @vite-ignore */ pathToFileURL(WRAPPER).href);
    const { default: createPspp } = await import(/* @vite-ignore */ pathToFileURL(ENGINE).href);
    const e = await createEngine(createPspp);
    await e.init();
    return e as EngineApi;
  })();
  return engine;
}

export function ctxFor(dataset: Dataset, lang: 'cs' | 'en' = 'en', decimal: '.' | ',' = '.'): ExtContext {
  void i18n.changeLanguage(lang);
  return { dataset, line: 1, lang, decimal, t: (k, a) => i18n.getFixedT(lang)(k, a) as string };
}

/** Runs a single extension command in-process (no engine needed). */
export function runExt(syntax: string, dataset: Dataset, lang: 'cs' | 'en' = 'en', decimal: '.' | ',' = '.'): OutputItem[] {
  const name = commandName(syntax);
  if (!name) throw new Error(`not a command: ${syntax}`);
  return runExtCommand(name, syntax, ctxFor(dataset, lang, decimal));
}

/** Runs mixed syntax (e.g. COMPUTE … then KM …) through the real engine + extensions. */
export async function runMixed(syntax: string, dataset: Dataset, lang: 'cs' | 'en' = 'en') {
  const e = await realEngine();
  const c = ctxFor(dataset, lang);
  return runWithExtensions(e, syntax, structuredClone(dataset), { lang, decimal: '.', t: c.t });
}

export const flatItems = (items: OutputItem[]): OutputItem[] => items.flatMap((i) => (i.kind === 'group' ? flatItems(i.children) : [i]));

/** All tables of the output, parsed. */
export function tables(items: OutputItem[]): PivotTable[] {
  return flatItems(items).flatMap((i) => (i.kind === 'table' ? [parsePivot(i.html)] : []));
}
export function errorsOf(items: OutputItem[]): string[] {
  return flatItems(items).flatMap((i) => (i.kind === 'message' && i.severity === 'error' ? [i.text] : []));
}
