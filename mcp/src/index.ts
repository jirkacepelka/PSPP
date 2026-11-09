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
import { AccountError, createDocument, downloadDocument, listDocuments, newDocument, requireAccount, uploadDocument, type DocState, type OutputEntry } from './account';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_JS = process.env.PSPP_ENGINE_PATH ?? path.resolve(here, '../../web/public/engine/pspp.js');
const MAX_OUTPUT = 60_000;

type Engine = Awaited<ReturnType<typeof createEngine>>;
let enginePromise: Promise<Engine> | null = null;
let dataset: Dataset | null = null;
/** The cloud document the session works on; results are written back to it. */
let open: { id: string; name: string; rev: number; state: DocState } | null = null;

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
/** Every tool except the reference needs a registered account. */
const gate = () => requireAccount();
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
      await gate();
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
      const detached = open ? `Detached from the open document "${open.name}" (nothing was changed there). ` : '';
      open = null;
      return text(`${detached}${describeDataset(loaded, 5)}\n\nThis dataset is not in your account yet: call account_create to save it there.`);
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
      await gate();
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
      await gate();
      const res = await (await engine()).run(syntax, dataset);
      if (res.dataset) dataset = res.dataset as Dataset;
      const items = res.items as never as OutputEntry['items'];
      const out = itemsToMarkdown(items) || '(no output)';
      let note = '';
      if (open) {
        // write the result into the document so it shows up in the web app
        open.state.output.push({ id: `agent${Date.now()}`, title: 'AI agent', syntax, time: Date.now(), items, status: res.ok ? 'ok' : 'error' });
        open.state.output = open.state.output.slice(-100);
        open.state.dataset = dataset;
        open.state.time = Date.now();
        const rev = await uploadDocument(open.id, open.rev, open.state);
        if (rev === null) {
          note = `\n\n_The document "${open.name}" was changed in the web app meanwhile, so this result was NOT saved there. Call account_open again, then re-run._`;
        } else {
          open.rev = rev;
          note = `\n\n_Saved to "${open.name}" in your account (visible in PSPP Studio within about 30 seconds)._`;
        }
      }
      return text((res.ok ? out : `${out}\n\nThe run reported errors.`) + note, !res.ok);
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
      await gate();
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
  'account_documents',
  {
    title: 'List documents in your account',
    description: 'Lists the documents (datasets with their analyses) saved in the user\'s PSPP Studio account: id, name, size and last change.',
    inputSchema: {},
  },
  async () => {
    try {
      const email = await gate();
      const docs = await listDocuments();
      if (!docs.length) return text(`Signed in as ${email}. No documents in the account yet. Use account_create to save the active dataset.`);
      const rows = docs.map((d) => `| ${d.id} | ${d.name.replace(/\|/g, '\\|')} | ${(d.size / 1024).toFixed(1)} KB | ${new Date(d.updated_at).toISOString()} |`);
      return text(`Signed in as ${email}.\n\n| id | name | size | changed |\n| --- | --- | --- | --- |\n${rows.join('\n')}`);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'account_open',
  {
    title: 'Open a document from your account',
    description:
      'Opens a document of the user\'s account: its dataset becomes the active dataset, and results of pspp_run are appended to the document\'s output so the user sees them in PSPP Studio. Returns the dataset description and the existing output titles.',
    inputSchema: { id: z.string().describe('Document id from account_documents') },
  },
  async ({ id }) => {
    try {
      await gate();
      const { rev, state, name } = await downloadDocument(id);
      if (!state) throw new AccountError('This document is empty (no dataset yet). Load data with pspp_load and call account_create.');
      open = { id, name, rev, state };
      dataset = state.dataset;
      const outs = state.output.map((o, i) => `${i + 1}. ${o.title}${o.syntax ? `: ${o.syntax.split('\n')[0].slice(0, 70)}` : ''}`);
      return text(
        `Opened "${name}" (revision ${rev}).\n\n${dataset ? describeDataset(dataset, 5) : 'No dataset in this document (syntax only).'}\n\nExisting output (${outs.length}):\n${outs.join('\n') || '(none)'}`,
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'account_create',
  {
    title: 'Save the active dataset as a new document in your account',
    description: 'Creates a new document in the user\'s account from the active dataset (loaded with pspp_load) and opens it, so later pspp_run results are saved into it.',
    inputSchema: { name: z.string().min(1).max(120).describe('Document name') },
  },
  async ({ name }) => {
    try {
      await gate();
      const ds = requireData();
      const created = await createDocument(name);
      const state = newDocument(name, ds);
      const rev = await uploadDocument(created.id, created.rev, state);
      if (rev === null) throw new AccountError('The new document changed unexpectedly. Try again.');
      open = { id: created.id, name, rev, state };
      return text(`Created "${name}" (id ${created.id}) in your account and opened it. Results of pspp_run are saved there.`);
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
