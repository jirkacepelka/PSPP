import { fromB64url, hashPassword, timingSafeEqual } from './crypto';

export const DAY = 86_400_000;
const MAX_FAILURES = 8;
const FAILURE_WINDOW = 15 * 60_000;

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...extra } });
}

export function validEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Bytes used by documents plus the account settings; the quota covers both. */
export async function usage(env: Env, userId: string): Promise<{ used: number; quota: number }> {
  const row = await env.DB.prepare(
    `SELECT COALESCE((SELECT SUM(size) FROM projects WHERE user_id = ?1), 0)
          + COALESCE((SELECT LENGTH(CAST(settings AS BLOB)) FROM users WHERE id = ?1), 0) AS used`,
  )
    .bind(userId)
    .first<{ used: number }>();
  return { used: row?.used ?? 0, quota: Number(env.USER_QUOTA_BYTES) };
}

/** Checks e-mail and password with the same throttling for every sign-in form. Returns the user id. */
export async function authenticate(env: Env, email: string, password: string): Promise<{ id: string; email: string }> {
  if (!validEmail(email) || typeof password !== 'string') throw new HttpError(400, 'bad_credentials');
  const normalized = email.trim().toLowerCase();
  const now = Date.now();
  const attempts = await env.DB.prepare('SELECT failures, window_start FROM login_attempts WHERE key = ?')
    .bind(normalized)
    .first<{ failures: number; window_start: number }>();
  if (attempts && now - attempts.window_start < FAILURE_WINDOW && attempts.failures >= MAX_FAILURES) throw new HttpError(429, 'too_many_attempts');

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
  return { id: user.id, email: normalized };
}
