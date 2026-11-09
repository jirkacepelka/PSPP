/*
 * MCP endpoint (Streamable HTTP, stateless JSON-RPC) for Claude Desktop/web connectors and other clients.
 * Auth is the personal/OAuth access token; tools run inside EngineDO.
 */
import { sha256 } from '../crypto';
import { HttpError } from '../shared';
import { oauthCors, origin } from '../oauth';

const TOOLS = [
  {
    name: 'list_documents',
    description: "List the documents (datasets with their analyses) in the user's PSPP Studio account: id, name, size, last change.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'describe_document',
    description: 'Describe a document: variables (type, measurement level, labels, value labels, missing values), case count, a preview of rows and the titles of existing output.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Document id from list_documents' }, rows: { type: 'integer', minimum: 0, maximum: 50, description: 'Preview rows, default 5' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'run_syntax',
    description:
      "Run PSPP syntax on a document's dataset and return the output as Markdown tables. The result is saved into the document, so the user sees it in PSPP Studio. Data-changing commands (COMPUTE, RECODE, SELECT IF…) update the dataset. Each command ends with a period and starts on its own line. Call reference for common commands.",
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Document id' }, syntax: { type: 'string', description: 'PSPP syntax' } }, required: ['id', 'syntax'], additionalProperties: false },
  },
  {
    name: 'get_output',
    description: 'Read the most recent output entries stored in a document (tables as Markdown), including results the user produced in the app.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, last: { type: 'integer', minimum: 1, maximum: 20, description: 'How many entries, default 3' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'create_document',
    description: 'Create a new document in the account from CSV text with a header row (delimiter and decimal comma are detected).',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Document name' }, csv: { type: 'string', description: 'CSV text' } }, required: ['name', 'csv'], additionalProperties: false },
  },
  {
    name: 'reference',
    description: 'A cheat sheet of common PSPP commands with examples: describe, compare means, models, transformations, inline data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const INSTRUCTIONS =
  'PSPP Studio is a statistics workspace on the PSPP engine. Documents are datasets with their analyses. Start with list_documents, inspect with describe_document, analyse with run_syntax (call reference first if unsure about syntax), and explain results in plain language, including what a test cannot show.';

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function userFromToken(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token.startsWith('pat_')) return null;
  const row = await env.DB.prepare('SELECT id, user_id, expires_at FROM api_tokens WHERE token_hash = ?').bind(await sha256(token)).first<{ id: string; user_id: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  await env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
  return row.user_id;
}

async function handle(msg: { id?: unknown; method?: string; params?: Record<string, unknown> }, userId: string, env: Env): Promise<unknown | null> {
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification
  switch (method) {
    case 'initialize':
      return rpc(id, { protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'pspp-studio', version: '0.1.0' }, instructions: INSTRUCTIONS });
    case 'ping':
      return rpc(id, {});
    case 'tools/list':
      return rpc(id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(params?.name ?? '');
      if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const stub = env.ENGINE.get(env.ENGINE.idFromName(userId));
      const res = await stub.fetch('https://do/call', { method: 'POST', body: JSON.stringify({ userId, name, args: params?.arguments ?? {} }) });
      return rpc(id, await res.json());
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function mcp(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return oauthCors(new Response(null, { status: 204 }));
  const userId = await userFromToken(request, env);
  if (!userId) {
    const res = new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${origin(request)}/.well-known/oauth-protected-resource"` },
    });
    return oauthCors(res);
  }
  if (request.method !== 'POST') return oauthCors(new Response('Use POST.', { status: 405, headers: { allow: 'POST' } }));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'bad_json');
  }
  const batch = Array.isArray(body);
  const out: unknown[] = [];
  for (const msg of (batch ? body : [body]) as unknown[]) {
    const r = await handle(msg as never, userId, env);
    if (r !== null) out.push(r);
  }
  if (!out.length) return oauthCors(new Response(null, { status: 202 }));
  return oauthCors(Response.json(batch ? out : out[0]));
}
