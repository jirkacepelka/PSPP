/*
 * Durable Object that hosts the PSPP engine (WebAssembly) for MCP tool calls. A normal Worker request
 * on the free plan has a 10 ms CPU limit, too little to start the engine; a Durable Object has far more.
 * Tools are stateless: every call names the document it works on.
 */
import { DurableObject } from 'cloudflare:workers';
import wasmModule from '../../../web/public/engine/pspp.wasm';
// @ts-expect-error generated Emscripten glue without types
import createPspp from '../../../web/public/engine/pspp.js';
import { createEngine } from '../../../engine/js/engine.mjs';
import { delimitedToDataset } from '../../../web/src/lib/csv';
import type { Dataset, OutputItem } from '../../../web/src/engine/types';
import { createDoc, listDocs, loadDoc, newDocState, saveDoc, ToolError, type DocMeta, type DocState } from './docs';
import { describeDataset, htmlTableToMarkdown, itemsToMarkdown } from './render';
import { REFERENCE } from './reference';

const MAX_OUTPUT = 60_000;
type Engine = Awaited<ReturnType<typeof createEngine>>;

const text = (t: string, isError = false) => ({
  content: [{ type: 'text', text: t.length > MAX_OUTPUT ? `${t.slice(0, MAX_OUTPUT)}\n\n…(output truncated at ${MAX_OUTPUT} characters)` : t }],
  ...(isError ? { isError: true } : {}),
});

export class EngineDO extends DurableObject<Env> {
  private engine: Promise<Engine> | null = null;

  private getEngine(): Promise<Engine> {
    this.engine ??= (async () => {
      // let the Emscripten glue take its "worker" branch; the wasm is already compiled by the platform
      (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope ??= class {};
      const e = await createEngine(createPspp, {
        instantiateWasm(imports: WebAssembly.Imports, receive: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) {
          void WebAssembly.instantiate(wasmModule as WebAssembly.Module, imports).then((instance) => receive(instance, wasmModule as WebAssembly.Module));
          return {};
        },
      });
      await e.init();
      return e;
    })();
    return this.engine;
  }

  async fetch(request: Request): Promise<Response> {
    const { userId, name, args } = (await request.json()) as { userId: string; name: string; args: Record<string, unknown> };
    try {
      return Response.json(await this.call(userId, name, args ?? {}));
    } catch (e) {
      return Response.json(text(e instanceof ToolError ? e.message : `Error: ${e instanceof Error ? e.message : String(e)}`, true));
    }
  }

  private async call(userId: string, name: string, a: Record<string, unknown>) {
    const env = this.env;
    switch (name) {
      case 'list_documents': {
        const docs = await listDocs(env, userId);
        if (!docs.length) return text('No documents yet. Use create_document to add a dataset from CSV text.');
        const rows = docs.map((d) => `| ${d.id} | ${d.name.replace(/\|/g, '\\|')} | ${(d.size / 1024).toFixed(1)} KB | ${new Date(d.updated_at).toISOString()} |`);
        return text(`| id | name | size | changed |\n| --- | --- | --- | --- |\n${rows.join('\n')}`);
      }
      case 'describe_document': {
        const { meta, state } = await loadDoc(env, userId, String(a.id));
        if (!state?.dataset) return text(`"${meta.name}" has no dataset (syntax only).`);
        const outs = state.output.map((o, i) => `${i + 1}. ${o.title}${o.syntax ? `: ${o.syntax.split('\n')[0].slice(0, 70)}` : ''}`);
        return text(`${describeDataset(state.dataset, Math.min(50, Number(a.rows ?? 5)))}\n\nOutput in this document (${outs.length}):\n${outs.join('\n') || '(none)'}`);
      }
      case 'get_output': {
        const { state } = await loadDoc(env, userId, String(a.id));
        const last = state?.output.slice(-Math.max(1, Math.min(20, Number(a.last ?? 3)))) ?? [];
        if (!last.length) return text('This document has no output yet.');
        return text(last.map((o) => `### ${o.title}${o.syntax ? `\n\`\`\`\n${o.syntax.trim()}\n\`\`\`` : ''}\n\n${itemsToMarkdown(o.items) || '(no output)'}`).join('\n\n---\n\n'));
      }
      case 'run_syntax': {
        const { meta, rev, state } = await loadDoc(env, userId, String(a.id));
        if (!state) throw new ToolError('This document is empty.');
        const engine = await this.getEngine();
        const syntax = String(a.syntax ?? '');
        if (!syntax.trim()) throw new ToolError('Provide PSPP syntax in "syntax".');
        const res = await engine.run(syntax, state.dataset);
        const items = res.items as OutputItem[];
        const out = itemsToMarkdown(items) || '(no output)';
        if (res.dataset) state.dataset = res.dataset as Dataset;
        state.output.push({ id: `agent${Date.now()}`, title: 'AI agent', syntax, time: Date.now(), items, status: res.ok ? 'ok' : 'error' });
        state.output = state.output.slice(-100);
        state.time = Date.now();
        const saved = await saveDoc(env, userId, meta, rev, state);
        const note =
          saved === null
            ? `\n\n_"${meta.name}" was changed meanwhile, so this result was NOT saved. Call describe_document, then run again._`
            : `\n\n_Saved into "${meta.name}" (visible in PSPP Studio within about 30 seconds)._`;
        return text((res.ok ? out : `${out}\n\nThe run reported errors.`) + note, !res.ok);
      }
      case 'create_document': {
        const csv = String(a.csv ?? '');
        const title = String(a.name ?? '').trim().slice(0, 120);
        if (!title || !csv.trim()) throw new ToolError('Provide "name" and "csv" (CSV text with a header row).');
        const ds = delimitedToDataset(csv, title, {});
        const meta: DocMeta = await createDoc(env, userId, title, newDocState(title, ds));
        return text(`Created "${title}" (id ${meta.id}).\n\n${describeDataset(ds, 5)}`);
      }
      case 'reference':
        return text(REFERENCE);
      default:
        throw new ToolError(`Unknown tool ${name}.`);
    }
  }
}

export { htmlTableToMarkdown };
export type { DocState };
