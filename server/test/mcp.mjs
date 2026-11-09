// End-to-end test of the MCP connector against a running API (npm run dev).
// Usage: BASE=http://localhost:8788 ADMIN_KEY=devkey node test/mcp.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:8788';
const ADMIN = process.env.ADMIN_KEY ?? 'devkey';
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const post = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

// an account
const invite = (await (await post('/api/admin/invites', { count: 1 }, { 'x-admin-key': ADMIN })).json()).codes[0];
const email = `mcp${Date.now()}@example.com`;
const password = 'correct horse battery';
assert.equal((await post('/api/register', { email, password, invite })).status, 201);

// unauthenticated request: 401 pointing at the metadata
let r = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
assert.equal(r.status, 401);
assert.match(r.headers.get('www-authenticate'), /resource_metadata=".*oauth-protected-resource"/);

// discovery
const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
assert.equal(prm.resource, `${BASE}/mcp`);
const meta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);

// dynamic client registration
const redirect = 'https://claude.ai/api/mcp/auth_callback';
r = await post('/oauth/register', { redirect_uris: [redirect], client_name: 'Claude' });
assert.equal(r.status, 201);
const client = await r.json();
assert.equal((await post('/oauth/register', { redirect_uris: ['http://evil.example/cb'] })).status, 400);

// authorization: page, wrong password, deny, allow
const verifier = b64(randomBytes(32));
const challenge = b64(createHash('sha256').update(verifier).digest());
const params = { client_id: client.client_id, redirect_uri: redirect, state: 's123', code_challenge: challenge, code_challenge_method: 'S256', scope: 'documents' };
r = await fetch(`${BASE}/oauth/authorize?${new URLSearchParams({ response_type: 'code', ...params })}`);
assert.equal(r.status, 200);
assert.match(await r.text(), /Claude/);
const form = (extra) => fetch(`${BASE}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, ...extra }) });
r = await form({ action: 'allow', email, password: 'wrong password' });
assert.equal(r.status, 200);
assert.match(await r.text(), /Wrong e-mail or password/);
r = await form({ action: 'deny', email, password });
assert.match(r.headers.get('location'), /error=access_denied/);
r = await form({ action: 'allow', email, password });
assert.equal(r.status, 302);
const back = new URL(r.headers.get('location'));
assert.equal(back.origin + back.pathname, redirect);
assert.equal(back.searchParams.get('state'), 's123');
const code = back.searchParams.get('code');
assert.ok(code);

// token exchange: PKCE is enforced, the code works once
const tok = (body) => fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id, ...body }) });
r = await tok({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: 'not the verifier' });
assert.equal((await r.json()).error, 'invalid_grant');
r = await form({ action: 'allow', email, password });
const code2 = new URL(r.headers.get('location')).searchParams.get('code');
r = await tok({ grant_type: 'authorization_code', code: code2, redirect_uri: redirect, code_verifier: verifier });
assert.equal(r.status, 200);
let tokens = await r.json();
assert.match(tokens.access_token, /^pat_/);
assert.equal((await tok({ grant_type: 'authorization_code', code: code2, redirect_uri: redirect, code_verifier: verifier })).status, 400, 'a code must work only once');

// MCP calls
let id = 10;
const rpc = async (method, params) => (await (await post('/mcp', { jsonrpc: '2.0', id: ++id, method, params }, { authorization: `Bearer ${tokens.access_token}` })).json());
const call = async (name, args = {}) => {
  const res = await rpc('tools/call', { name, arguments: args });
  assert.ok(res.result, JSON.stringify(res));
  return { text: res.result.content.map((c) => c.text).join('\n'), isError: !!res.result.isError };
};
let res = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
assert.equal(res.result.serverInfo.name, 'pspp-studio');
res = await rpc('tools/list');
assert.deepEqual(res.result.tools.map((t) => t.name), ['list_documents', 'describe_document', 'run_syntax', 'get_output', 'create_document', 'reference']);

const csv = 'group,score\n' + [...Array(20)].map((_, i) => `${i % 2 ? 'b' : 'a'},${(i % 2 ? 14 : 10) + (i % 5)}`).join('\n');
let out = await call('create_document', { name: 'MCP connector test', csv });
assert.ok(!out.isError, out.text);
const docId = /id ([0-9a-f-]{36})/.exec(out.text)[1];
out = await call('list_documents');
assert.ok(out.text.includes(docId));
out = await call('run_syntax', { id: docId, syntax: "T-TEST GROUPS=group('a' 'b') /VARIABLES=score." });
assert.ok(!out.isError, out.text);
assert.match(out.text, /Group Statistics/);
assert.match(out.text, /Saved into/);
out = await call('run_syntax', { id: docId, syntax: 'COMPUTE z = score * 2.\nEXECUTE.' });
assert.match(out.text, /Saved into/);
out = await call('describe_document', { id: docId });
assert.match(out.text, /20 cases, 3 variables/);
assert.match(out.text, /Output in this document \(2\)/);
out = await call('get_output', { id: docId, last: 1 });
assert.match(out.text, /COMPUTE/);
out = await call('run_syntax', { id: docId, syntax: 'FREQUENCIES VARIABLES=nope.' });
assert.ok(out.isError);
out = await call('describe_document', { id: '00000000-0000-0000-0000-000000000000' });
assert.ok(out.isError && /No document/.test(out.text));

// another user's token cannot see the document; the connector token cannot reach settings
r = await fetch(`${BASE}/api/settings`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
assert.equal(r.status, 403);

// refresh rotates the tokens and the old access token stops working
r = await tok({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
assert.equal(r.status, 200);
const old = tokens;
tokens = await r.json();
assert.notEqual(tokens.access_token, old.access_token);
r = await post('/mcp', { jsonrpc: '2.0', id: 99, method: 'ping' }, { authorization: `Bearer ${old.access_token}` });
assert.equal(r.status, 401);
res = await rpc('ping');
assert.deepEqual(res.result, {});
console.log('mcp connector test passed');
