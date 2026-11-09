/*
 * PSPP Studio MCP server: lets AI agents load data and run PSPP analyses on the local machine.
 * The engine is PSPP 2.1.3 compiled to WebAssembly, run directly in Node (no browser, no network).
 * Transport: stdio. One active dataset per server process, like a PSPP session.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createEngine } from '../../engine/js/engine.mjs';
import { delimitedToDataset } from '../../web/src/lib/csv';
import { readDataFile, importKind, writeDataFile, type ClientFormat } from '../../web/src/lib/io';
import type { Dataset } from '../../web/src/engine/types';
import { describeDataset, itemsToMarkdown } from './render';
import { REFERENCE } from './reference';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_JS = process.env.PSPP_ENGINE_PATH ?? path.resolve(here, '../../web/public/engine/pspp.js');
const MAX_OUTPUT = 60_000;

type Engine = Awaited<ReturnType<typeof createEngine>>;
let enginePromise: Promise<Engine> | null = null;
let dataset: Dataset | null = null;

function engine(): Promise<Engine> {
  enginePromise ??= (async () => {
    const mod = (await import(pathToFileURL(ENGINE_JS).href)) as { default: Parameters<typeof createEngine>[0] };
    const e = await createEngine(mod.default);
    await e.init();
    return e;
  })();
  return enginePromise;
}

/** Spreadsheets need a DOM parser; jsdom is an optional dependency. */
async function ensureDom() {
  if ((globalThis as { DOMParser?: unknown }).DOMParser) return;
  try {
    const { JSDOM } = await import('jsdom');
    (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM('').window.DOMParser;
  } catch {
    throw new Error('Excel and OpenDocument files need the optional "jsdom" package (npm install in the mcp folder).');
  }
}

/** English headings for the variable sheet of exported spreadsheets. */
const DICT_LABELS = {
  sheetData: 'Data',
  sheetVars: 'Variables',
  cols: ['Name', 'Label', 'Type', 'Format', 'Measure', 'Value labels', 'Missing values'],
  type: { numeric: 'Numeric', string: 'String' },
  measure: { nominal: 'Nominal', ordinal: 'Ordinal', scale: 'Scale', unknown: 'Unknown' },
};

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t.length > MAX_OUTPUT ? `${t.slice(0, MAX_OUTPUT)}\n\n…(output truncated at ${MAX_OUTPUT} characters)` : t }], ...(isError ? { isError: true } : {}) });
const requireData = () => {
  if (!dataset) throw new Error('No dataset loaded. Call pspp_load first (or create data with DATA LIST … BEGIN DATA in pspp_run).');
  return dataset;
};
const fail = (e: unknown) => text(`Error: ${e instanceof Error ? e.message : String(e)}`, true);

const server = new McpServer({ name: 'pspp-studio', version: '0.1.0' });

server.registerTool(
  'pspp_load',
  {
    title: 'Load data',
    description:
      'Load a dataset as the active dataset. Give either "path" (a file on this machine: .sav .zsav .por .csv .tsv .txt .xlsx .ods .json) or "csv" (inline CSV text). Replaces the current dataset. Returns the variables and a preview.',
    inputSchema: {
      path: z.string().optional().describe('Absolute path to a data file'),
      csv: z.string().optional().describe('Inline CSV/TSV text with a header row'),
      name: z.string().optional().describe('Dataset name when using inline csv'),
      header: z.boolean().optional().describe('First row holds variable names (guessed when omitted)'),
      sheet: z.number().int().min(0).optional().describe('Spreadsheet sheet index (0-based)'),
    },
  },
  async ({ path: file, csv, name, header, sheet }) => {
    try {
      if (!file && !csv) throw new Error('Provide "path" or "csv".');
      let loaded: Dataset;
      if (csv) {
        loaded = delimitedToDataset(csv, name ?? 'inline', { header });
      } else {
        const bytes = new Uint8Array(await readFile(file!));
        const base = path.basename(file!);
        if (importKind(base)) {
          if (/\.(xlsx|xlsm|ods)$/i.test(base)) await ensureDom();
          loaded = readDataFile(base, bytes, { header, sheet }).dataset;
        } else {
          const res = await (await engine()).open({ name: base, bytes });
          if (!res.dataset) throw new Error(`${base} did not contain data (syntax files: use pspp_run with the file's text).`);
          loaded = res.dataset as Dataset;
        }
      }
      dataset = loaded;
      return text(describeDataset(loaded, 5));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'pspp_describe',
  {
    title: 'Describe the active dataset',
    description: 'Variables (type, measurement level, labels, value labels, missing values), the case count and a preview of the first rows.',
    inputSchema: { rows: z.number().int().min(0).max(50).optional().describe('Preview rows, default 5') },
  },
  async ({ rows }) => {
    try {
      return text(describeDataset(requireData(), rows ?? 5));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'pspp_run',
  {
    title: 'Run PSPP syntax',
    description:
      'Run PSPP syntax on the active dataset and return the output (tables as Markdown, messages, notes). Data-changing commands (COMPUTE, RECODE, SELECT IF, …) update the active dataset. Inline data (DATA LIST … BEGIN DATA … END DATA.) also works without loading a file. Call pspp_reference for common commands.',
    inputSchema: { syntax: z.string().min(1).describe('PSPP syntax; every command ends with a period') },
  },
  async ({ syntax }) => {
    try {
      const res = await (await engine()).run(syntax, dataset);
      if (res.dataset) dataset = res.dataset as Dataset;
      const out = itemsToMarkdown(res.items as never) || '(no output)';
      return text(res.ok ? out : `${out}\n\nThe run reported errors.`, !res.ok);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'pspp_save',
  {
    title: 'Save the active dataset',
    description: 'Write the active dataset to a file. Formats: sav, zsav, por (SPSS), csv, tsv, xlsx, ods, json.',
    inputSchema: {
      path: z.string().describe('Absolute output path'),
      format: z.enum(['sav', 'zsav', 'por', 'csv', 'tsv', 'xlsx', 'ods', 'json']).optional().describe('Defaults to the file extension'),
    },
  },
  async ({ path: file, format }) => {
    try {
      const ds = requireData();
      const fmt = (format ?? path.extname(file).slice(1).toLowerCase()) as string;
      let bytes: Uint8Array;
      if (['sav', 'zsav', 'por'].includes(fmt)) bytes = await (await engine()).save(ds, fmt as 'sav');
      else if (['csv', 'tsv', 'xlsx', 'ods', 'json'].includes(fmt)) {
        if (fmt === 'xlsx' || fmt === 'ods') await ensureDom();
        bytes = writeDataFile(ds, fmt as ClientFormat, DICT_LABELS);
      } else throw new Error(`Unsupported format "${fmt}".`);
      await writeFile(file, bytes);
      return text(`Saved ${ds.variables.length} variables to ${file} (${bytes.length} bytes).`);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'pspp_reference',
  { title: 'PSPP syntax cheat sheet', description: 'Common PSPP commands with examples: describe, compare means, models, transformations, inline data.', inputSchema: {} },
  async () => text(REFERENCE),
);

await server.connect(new StdioServerTransport());
