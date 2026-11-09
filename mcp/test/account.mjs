// End-to-end test of the account flow against a running API.
// Usage: PSPP_STUDIO_API=http://localhost:8788 PSPP_STUDIO_TOKEN=pat_... node test/account.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

if (!process.env.PSPP_STUDIO_TOKEN) {
  console.log('skipped: set PSPP_STUDIO_TOKEN (and PSPP_STUDIO_API) to run the account test');
  process.exit(0);
}
const start = async () => {
  const client = new Client({ name: 'account-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../dist/index.mjs', import.meta.url).pathname], env: { ...process.env } }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
  };
  return { client, call };
};

let { client, call } = await start();
let r = await call('account_documents');
assert.ok(!r.isError, r.text);
assert.match(r.text, /Signed in as/);

const csv = 'group,score\n' + [...Array(20)].map((_, i) => `${i % 2 ? 'b' : 'a'},${(i % 2 ? 14 : 10) + (i % 5)}`).join('\n');
r = await call('pspp_run', { syntax: 'DESCRIPTIVES x.' });
assert.ok(r.isError && /No dataset|errors/i.test(r.text));
r = await call('pspp_load', { csv, name: 'demo' });
assert.ok(!r.isError, r.text);
const name = `MCP test ${Date.now()}`;
r = await call('account_create', { name });
assert.ok(!r.isError, r.text);
const id = /id ([0-9a-f-]{36})/.exec(r.text)?.[1];
assert.ok(id, r.text);

r = await call('pspp_run', { syntax: "T-TEST GROUPS=group('a' 'b') /VARIABLES=score." });
assert.ok(!r.isError, r.text);
assert.match(r.text, /Saved to/);
r = await call('pspp_run', { syntax: 'COMPUTE z = score * 2.\nEXECUTE.' });
assert.match(r.text, /Saved to/);
await client.close();

// a fresh process (a later conversation) sees the document with the agent's results
({ client, call } = await start());
r = await call('account_documents');
assert.ok(r.text.includes(id) && r.text.includes(name), r.text);
r = await call('account_open', { id });
assert.ok(!r.isError, r.text);
assert.match(r.text, /20 cases, 3 variables/);
assert.match(r.text, /Existing output \(2\)/);
assert.match(r.text, /T-TEST/);

// loading a local file detaches from the document, so nothing is overwritten by accident
const dir = await mkdtemp(path.join(os.tmpdir(), 'pspp-mcp-'));
r = await call('pspp_save', { path: path.join(dir, 'out.sav') });
assert.ok(!r.isError, r.text);
assert.ok((await readFile(path.join(dir, 'out.sav'))).length > 20);
r = await call('pspp_load', { path: path.join(dir, 'out.sav') });
assert.match(r.text, /Detached from the open document/);

r = await call('account_open', { id: '00000000-0000-0000-0000-000000000000' });
assert.ok(r.isError && /No document/.test(r.text));
await client.close();
console.log('mcp account test passed');
