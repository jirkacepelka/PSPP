import { DurableObject } from 'cloudflare:workers';

const CHUNK = 1_000_000; // a SQLite row in a Durable Object may hold up to 2 MB

/**
 * One Durable Object per project. It keeps the project document as an opaque blob
 * (the browser decides the format) split into chunks, plus a revision number used to
 * detect two devices overwriting each other.
 */
export class ProjectDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    const sql = this.ctx.storage.sql;
    const rev = (await this.ctx.storage.get<number>('rev')) ?? 0;

    if (request.method === 'GET') {
      const parts: Uint8Array[] = [];
      let total = 0;
      for (const row of sql.exec('SELECT data FROM chunks ORDER BY idx')) {
        const d = new Uint8Array(row.data as ArrayBuffer);
        parts.push(d);
        total += d.length;
      }
      const body = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        body.set(p, off);
        off += p.length;
      }
      return new Response(body, { headers: { 'x-rev': String(rev), 'content-type': 'application/octet-stream' } });
    }

    if (request.method === 'PUT') {
      const expected = Number(request.headers.get('if-match') ?? '-1');
      if (expected !== rev) {
        return new Response(JSON.stringify({ error: 'conflict', rev }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      const max = Number(this.env.PROJECT_MAX_BYTES);
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.length > max) return new Response(JSON.stringify({ error: 'too_large', max }), { status: 413 });
      this.ctx.storage.transactionSync(() => {
        sql.exec('DELETE FROM chunks');
        for (let i = 0, idx = 0; i < body.length || idx === 0; i += CHUNK, idx++) {
          sql.exec('INSERT INTO chunks (idx, data) VALUES (?, ?)', idx, body.slice(i, i + CHUNK));
        }
        this.ctx.storage.kv.put('rev', rev + 1);
      });
      return new Response(JSON.stringify({ rev: rev + 1, size: body.length }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (request.method === 'DELETE') {
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    return new Response('method not allowed', { status: 405 });
  }
}
