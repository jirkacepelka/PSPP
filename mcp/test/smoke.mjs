// Without an account token every tool except the reference must refuse and explain how to connect.
// Usage: npm run build && npm test   (the account flow is tested by test/account.mjs)
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const env = { ...process.env };
delete env.PSPP_STUDIO_TOKEN;
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../dist/index.mjs', import.meta.url).pathname], env }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
};

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, ['account_create', 'account_documents', 'account_open', 'pspp_describe', 'pspp_load', 'pspp_reference', 'pspp_run', 'pspp_save']);

for (const [name, args] of [
  ['account_documents', {}],
  ['pspp_load', { csv: 'a,b\n1,2' }],
  ['pspp_run', { syntax: 'DESCRIPTIVES a.' }],
]) {
  const r = await call(name, args);
  assert.ok(r.isError && /registered users only/.test(r.text), `${name} must require an account: ${r.text}`);
}
assert.match((await call('pspp_reference')).text, /T-TEST/);
await client.close();
console.log('mcp smoke test passed');
