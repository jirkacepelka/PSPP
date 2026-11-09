/*
 * Access to the user's PSPP Studio account. The MCP server only works for registered users:
 * it needs a personal access token created in the web app (Profile, AI agents).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Dataset, OutputItem } from '../../web/src/engine/types';

export const API_URL = (process.env.PSPP_STUDIO_API ?? 'https://pspp-studio-api.pspp-studio-server.workers.dev').replace(/\/+$/, '');
const TOKEN = process.env.PSPP_STUDIO_TOKEN ?? '';

export interface SyntaxTab {
  id: string;
  title: string;
  text: string;
  diagnostics: unknown[];
  version: number;
}
export interface OutputEntry {
  id: string;
  title: string;
  syntax: string;
  time: number;
  items: OutputItem[];
  status?: 'ok' | 'error';
}
/** The document format the web app saves (see AutosaveState in web/src/app/files.ts). */
export interface DocState {
  time: number;
  title: string;
  fileName: string | null;
  dataset: Dataset | null;
  tabs: SyntaxTab[];
  activeTab: string;
  output: OutputEntry[];
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

export class AccountError extends Error {}

const NOT_CONNECTED =
  'Not connected to a PSPP Studio account. This MCP server works for registered users only: sign in to PSPP Studio, open Settings > Profile > AI agents, create an access token and pass it as the PSPP_STUDIO_TOKEN environment variable of this server.';

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  if (!TOKEN) throw new AccountError(NOT_CONNECTED);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${TOKEN}` } });
  } catch {
    throw new AccountError(`Cannot reach ${API_URL}. Check the internet connection.`);
  }
  if (res.status === 401) throw new AccountError('The access token is invalid, expired or revoked. Create a new one in PSPP Studio (Settings > Profile > AI agents).');
  return res;
}

let verifiedAt = 0;
let who = '';
/** Verifies the token (cached for a minute) and returns the account e-mail. */
export async function requireAccount(): Promise<string> {
  if (who && Date.now() - verifiedAt < 60_000) return who;
  const res = await api('/api/me');
  if (!res.ok) throw new AccountError(`Account check failed (${res.status}).`);
  const me = (await res.json()) as { user: { email: string } };
  verifiedAt = Date.now();
  who = me.user.email;
  return who;
}

export async function listDocuments(): Promise<DocMeta[]> {
  const res = await api('/api/projects');
  if (!res.ok) throw new AccountError(`Could not list documents (${res.status}).`);
  return ((await res.json()) as { projects: DocMeta[] }).projects;
}

export async function createDocument(name: string): Promise<{ id: string; rev: number }> {
  const res = await api('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!res.ok) throw new AccountError(`Could not create the document (${res.status}).`);
  return (await res.json()) as { id: string; rev: number };
}

export async function downloadDocument(id: string): Promise<{ rev: number; state: DocState | null; name: string }> {
  const meta = await api(`/api/projects/${id}`);
  if (meta.status === 404) throw new AccountError('No document with this id in your account. Call account_documents for the list.');
  const name = ((await meta.json()) as { name: string }).name;
  const res = await api(`/api/projects/${id}/doc`);
  if (!res.ok) throw new AccountError(`Could not download the document (${res.status}).`);
  const rev = Number(res.headers.get('x-rev') ?? '0');
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { rev, name, state: bytes.length ? (JSON.parse(gunzipSync(bytes).toString('utf8')) as DocState) : null };
}

/** Uploads a document; returns the new revision, or null when it changed in the meantime (conflict). */
export async function uploadDocument(id: string, rev: number, state: DocState): Promise<number | null> {
  const res = await api(`/api/projects/${id}/doc`, {
    method: 'PUT',
    headers: { 'if-match': String(rev), 'content-type': 'application/octet-stream' },
    body: gzipSync(Buffer.from(JSON.stringify(state))),
  });
  if (res.status === 409) return null;
  if (res.status === 413) throw new AccountError('The document is too large for your storage quota.');
  if (!res.ok) throw new AccountError(`Could not save the document (${res.status}).`);
  return ((await res.json()) as { rev: number }).rev;
}

export function newDocument(title: string, dataset: Dataset | null): DocState {
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
