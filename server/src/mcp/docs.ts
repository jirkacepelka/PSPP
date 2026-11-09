/*
 * The single place where MCP tools read and write a user's documents. Today a document lives in a
 * Durable Object (free plan, small quota). Paid plans with large quotas should move this to R2,
 * which is far cheaper per GB: only loadDoc and saveDoc need to change.
 */
import type { Dataset, OutputItem } from '../../../web/src/engine/types';
import { usage } from '../shared';

export interface DocState {
  time: number;
  title: string;
  fileName: string | null;
  dataset: Dataset | null;
  tabs: { id: string; title: string; text: string; diagnostics: unknown[]; version: number }[];
  activeTab: string;
  output: { id: string; title: string; syntax: string; time: number; items: OutputItem[]; status?: 'ok' | 'error' }[];
  journal?: unknown[];
  dialogs?: unknown;
}
export interface DocMeta {
  id: string;
  name: string;
  size: number;
  rev: number;
  created_at: number;
  updated_at: number;
}
export class ToolError extends Error {}

const gz = (bytes: Uint8Array<ArrayBuffer>) => new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
const gunzip = (bytes: Uint8Array<ArrayBuffer>) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();

export async function listDocs(env: Env, userId: string): Promise<DocMeta[]> {
  const { results } = await env.DB.prepare('SELECT id, name, size, rev, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all<DocMeta>();
  return results;
}

export async function loadDoc(env: Env, userId: string, id: string): Promise<{ meta: DocMeta; rev: number; state: DocState | null }> {
  const meta = await env.DB.prepare('SELECT id, name, size, rev, created_at, updated_at FROM projects WHERE id = ? AND user_id = ?').bind(id, userId).first<DocMeta>();
  if (!meta) throw new ToolError('No document with this id in the account. Call list_documents for the ids.');
  const res = await env.PROJECT.get(env.PROJECT.idFromName(id)).fetch('https://do/doc');
  const bytes = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  return { meta, rev: Number(res.headers.get('x-rev') ?? '0'), state: bytes.length ? (JSON.parse(await gunzip(bytes)) as DocState) : null };
}

/** Returns the new revision, or null when the document changed in the meantime. */
export async function saveDoc(env: Env, userId: string, meta: DocMeta, rev: number, state: DocState): Promise<number | null> {
  const body = new Uint8Array(await gz(new TextEncoder().encode(JSON.stringify(state))));
  const { used, quota } = await usage(env, userId);
  if (used - meta.size + body.length > quota) throw new ToolError('The document is too large for the storage quota of this account.');
  const res = await env.PROJECT.get(env.PROJECT.idFromName(meta.id)).fetch('https://do/doc', { method: 'PUT', headers: { 'if-match': String(rev) }, body });
  if (res.status === 409) return null;
  if (!res.ok) throw new ToolError(`Saving failed (${res.status}).`);
  const saved = (await res.json()) as { rev: number; size: number };
  await env.DB.prepare('UPDATE projects SET size = ?, rev = ?, updated_at = ? WHERE id = ?').bind(saved.size, saved.rev, Date.now(), meta.id).run();
  return saved.rev;
}

export async function createDoc(env: Env, userId: string, name: string, state: DocState): Promise<DocMeta> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO projects (id, user_id, name, size, rev, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)').bind(id, userId, name, now, now).run();
  const meta: DocMeta = { id, name, size: 0, rev: 0, created_at: now, updated_at: now };
  if ((await saveDoc(env, userId, meta, 0, state)) === null) throw new ToolError('Could not create the document. Try again.');
  return meta;
}

export function newDocState(title: string, dataset: Dataset | null): DocState {
  return {
    time: Date.now(),
    title,
    fileName: null,
    dataset,
    tabs: [{ id: 'tab1', title: 'Syntax 1', text: '', diagnostics: [], version: 0 }],
    activeTab: 'tab1',
    output: [],
    journal: [],
    dialogs: { lastValues: {}, recent: [] },
  };
}
