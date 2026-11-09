// End-to-end test: starts the built server over stdio and talks to it like an AI client does.
// Usage: npm run build && npm test
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../dist/index.mjs', import.meta.url).pathname] });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
};

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, ['pspp_describe', 'pspp_load', 'pspp_reference', 'pspp_run', 'pspp_save']);

let r = await call('pspp_describe');
assert.ok(r.isError && /No dataset loaded/.test(r.text), 'describe before load must explain what to do');

const csv = 'group,score\n' + [...Array(20)].map((_, i) => `${i % 2 ? 'b' : 'a'},${(i % 2 ? 14 : 10) + (i % 5)}`).join('\n');
r = await call('pspp_load', { csv, name: 'demo' });
assert.ok(!r.isError, r.text);
assert.match(r.text, /20 cases, 2 variables/);

r = await call('pspp_run', { syntax: "T-TEST GROUPS=group('a' 'b') /VARIABLES=score." });
assert.ok(!r.isError, r.text);
assert.match(r.text, /\| Group Statistics|Group Statistics/);
assert.match(r.text, /\|/);

r = await call('pspp_run', { syntax: 'COMPUTE z = score * 2.\nEXECUTE.' });
assert.ok(!r.isError, r.text);
r = await call('pspp_describe', { rows: 2 });
assert.match(r.text, /3 variables/);

r = await call('pspp_run', { syntax: 'FREQUENCIES VARIABLES=nope.' });
assert.ok(r.isError, 'an unknown variable must be reported as an error');

const dir = await mkdtemp(path.join(os.tmpdir(), 'pspp-mcp-'));
for (const ext of ['sav', 'csv']) {
  r = await call('pspp_save', { path: path.join(dir, `out.${ext}`) });
  assert.ok(!r.isError, r.text);
  assert.ok((await readFile(path.join(dir, `out.${ext}`))).length > 20);
}
r = await call('pspp_load', { path: path.join(dir, 'out.sav') });
assert.ok(!r.isError, r.text);
assert.match(r.text, /20 cases, 3 variables/);

r = await call('pspp_reference');
assert.match(r.text, /T-TEST/);
await client.close();
console.log('mcp smoke test passed');
