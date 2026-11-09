import { b64url, fromB64url, hashPassword, randomToken, sha256, timingSafeEqual } from './crypto';
import { ProjectDO } from './project';

export { ProjectDO };

const DAY = 86_400_000;
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const FAILURE_WINDOW = 15 * 60_000;

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...extra } });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  if (!allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization,content-type,if-match',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-expose-headers': 'x-rev',
    vary: 'origin',
  };
}

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

async function auth(request: Request, env: Env): Promise<{ userId: string; tokenHash: string }> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'unauthorized');
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, 'unauthorized');
  return { userId: row.user_id, tokenHash };
}

function requireAdmin(request: Request, env: Env): void {
  const key = request.headers.get('x-admin-key') ?? '';
  if (!env.ADMIN_KEY || !timingSafeEqual(key, env.ADMIN_KEY)) throw new HttpError(403, 'forbidden');
}

function validEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function newSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, Date.now() + SESSION_DAYS * DAY)
    .run();
  return token;
}

async function register(request: Request, env: Env): Promise<Response> {
  const { email, password, invite } = await body<{ email?: string; password?: string; invite?: string }>(request);
  if (!validEmail(email)) throw new HttpError(400, 'bad_email');
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw new HttpError(400, 'weak_password');
  if (typeof invite !== 'string') throw new HttpError(400, 'bad_invite');

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if ((count?.n ?? 0) >= Number(env.MAX_USERS)) throw new HttpError(403, 'beta_full');

  const normalized = email.trim().toLowerCase();
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(normalized).first();
  if (taken) throw new HttpError(409, 'email_taken');

  const userId = crypto.randomUUID();
  // Claim the invite first, atomically: only one request can flip used_by from NULL.
  const claimed = await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL AND expires_at > ?')
    .bind(userId, Date.now(), invite.trim(), Date.now())
    .run();
  if (!claimed.meta.changes) throw new HttpError(403, 'invalid_invite');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  try {
    await env.DB.prepare('INSERT INTO users (id, email, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, normalized, b64url(salt), hash, Date.now())
      .run();
  } catch (e) {
    await env.DB.prepare('UPDATE invites SET used_by = NULL, used_at = NULL WHERE code = ?').bind(invite.trim()).run();
    throw e;
  }
  return json({ token: await newSession(env, userId), user: { id: userId, email: normalized } }, 201);
}

async function login(request: Request, env: Env): Promise<Response> {
  const { email, password } = await body<{ email?: string; password?: string }>(request);
  if (!validEmail(email) || typeof password !== 'string') throw new HttpError(400, 'bad_credentials');
  const normalized = email.trim().toLowerCase();

  const now = Date.now();
  const attempts = await env.DB.prepare('SELECT failures, window_start FROM login_attempts WHERE key = ?')
    .bind(normalized)
    .first<{ failures: number; window_start: number }>();
  const inWindow = attempts && now - attempts.window_start < FAILURE_WINDOW;
  if (inWindow && attempts.failures >= MAX_FAILURES) throw new HttpError(429, 'too_many_attempts');

  const user = await env.DB.prepare('SELECT id, pw_salt, pw_hash FROM users WHERE email = ?')
    .bind(normalized)
    .first<{ id: string; pw_salt: string; pw_hash: string }>();
  // Hash even for unknown e-mails so the response time does not reveal which accounts exist.
  const hash = await hashPassword(password, user ? fromB64url(user.pw_salt) : new Uint8Array(16));
  if (!user || !timingSafeEqual(hash, user.pw_hash)) {
    await env.DB.prepare(
      `INSERT INTO login_attempts (key, failures, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET failures = CASE WHEN ? - window_start >= ? THEN 1 ELSE failures + 1 END,
                                      window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END`,
    )
      .bind(normalized, now, now, FAILURE_WINDOW, now, FAILURE_WINDOW, now)
      .run();
    throw new HttpError(401, 'bad_credentials');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(normalized).run();
  return json({ token: await newSession(env, user.id), user: { id: user.id, email: normalized } });
}

async function usage(env: Env, userId: string): Promise<{ used: number; quota: number }> {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM projects WHERE user_id = ?')
    .bind(userId)
    .first<{ used: number }>();
  return { used: row?.used ?? 0, quota: Number(env.USER_QUOTA_BYTES) };
}

async function ownedProject(env: Env, userId: string, id: string) {
  const row = await env.DB.prepare('SELECT id, name, size, rev, created_at, updated_at FROM projects WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ id: string; name: string; size: number; rev: number; created_at: number; updated_at: number }>();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;

  if (path === '/api/health') return json({ ok: true });
  if (path === '/api/register' && m === 'POST') return register(request, env);
  if (path === '/api/login' && m === 'POST') return login(request, env);

  if (path === '/api/admin/invites' && m === 'POST') {
    requireAdmin(request, env);
    const { count = 1, days = 14 } = await body<{ count?: number; days?: number }>(request);
    const n = Math.min(Math.max(1, Math.floor(count)), 50);
    const codes: string[] = [];
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const code = randomToken(9);
      codes.push(code);
      await env.DB.prepare('INSERT INTO invites (code, created_at, expires_at) VALUES (?, ?, ?)')
        .bind(code, now, now + Math.max(1, days) * DAY)
        .run();
    }
    return json({ codes });
  }

  const { userId, tokenHash } = await auth(request, env);

  if (path === '/api/me' && m === 'GET') {
    const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId).first();
    return json({ user, ...(await usage(env, userId)) });
  }
  if (path === '/api/logout' && m === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return json({ ok: true });
  }

  if (path === '/api/projects' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, name, size, rev, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(userId)
      .all();
    return json({ projects: results, ...(await usage(env, userId)) });
  }
  if (path === '/api/projects' && m === 'POST') {
    const { name } = await body<{ name?: string }>(request);
    const clean = String(name ?? '').trim().slice(0, 120) || 'Untitled';
    const now = Date.now();
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO projects (id, user_id, name, size, rev, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)')
      .bind(id, userId, clean, now, now)
      .run();
    return json({ id, name: clean, rev: 0 }, 201);
  }

  const doc = path.match(/^\/api\/projects\/([\w-]+)\/doc$/);
  if (doc) {
    const project = await ownedProject(env, userId, doc[1]);
    const stub = env.PROJECT.get(env.PROJECT.idFromName(project.id));
    if (m === 'GET') {
      const res = await stub.fetch('https://do/doc');
      return new Response(res.body, { headers: { 'content-type': 'application/octet-stream', 'x-rev': res.headers.get('x-rev') ?? '0' } });
    }
    if (m === 'PUT') {
      const size = Number(request.headers.get('content-length') ?? '0');
      const { used, quota } = await usage(env, userId);
      if (used - project.size + size > quota) throw new HttpError(413, 'quota_exceeded');
      const res = await stub.fetch('https://do/doc', { method: 'PUT', headers: { 'if-match': request.headers.get('if-match') ?? '-1' }, body: request.body });
      if (!res.ok) return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } });
      const saved = (await res.json()) as { rev: number; size: number };
      await env.DB.prepare('UPDATE projects SET size = ?, rev = ?, updated_at = ? WHERE id = ?').bind(saved.size, saved.rev, Date.now(), project.id).run();
      return json(saved);
    }
  }

  const one = path.match(/^\/api\/projects\/([\w-]+)$/);
  if (one) {
    const project = await ownedProject(env, userId, one[1]);
    if (m === 'GET') return json(project);
    if (m === 'PATCH') {
      const { name } = await body<{ name?: string }>(request);
      const clean = String(name ?? '').trim().slice(0, 120);
      if (!clean) throw new HttpError(400, 'bad_name');
      await env.DB.prepare('UPDATE projects SET name = ? WHERE id = ?').bind(clean, project.id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await env.PROJECT.get(env.PROJECT.idFromName(project.id)).fetch('https://do/doc', { method: 'DELETE' });
      await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id).run();
      return new Response(null, { status: 204 });
    }
  }
  throw new HttpError(404, 'not_found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(request, env);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code }, e.status, cors);
      console.error(e);
      return json({ error: 'server_error' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
