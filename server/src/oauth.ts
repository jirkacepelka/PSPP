/*
 * OAuth 2.1 authorization server for MCP connectors (Claude Desktop and web, and others):
 * discovery metadata, dynamic client registration, a sign-in and consent page, PKCE token exchange.
 * Access tokens are the same personal tokens (pat_…) the API already understands, listed and
 * revocable in Settings > Profile.
 */
import { b64url, randomToken, sha256 } from './crypto';
import { DAY, HttpError, authenticate, json } from './shared';

const ACCESS_DAYS = 7;
const REFRESH_DAYS = 90;
const CODE_MS = 5 * 60_000;
const MAX_CLIENTS = 500;

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,mcp-protocol-version', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const withCors = (res: Response) => {
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
};

export const origin = (request: Request) => new URL(request.url).origin;

export function protectedResourceMetadata(request: Request): Response {
  const o = origin(request);
  return withCors(json({ resource: `${o}/mcp`, authorization_servers: [o], bearer_methods_supported: ['header'], resource_name: 'PSPP Studio' }));
}

export function authorizationServerMetadata(request: Request): Response {
  const o = origin(request);
  return withCors(
    json({
      issuer: o,
      authorization_endpoint: `${o}/oauth/authorize`,
      token_endpoint: `${o}/oauth/token`,
      registration_endpoint: `${o}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['documents'],
    }),
  );
}

const okRedirect = (u: string) => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
};

export async function registerClient(request: Request, env: Env): Promise<Response> {
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return withCors(json({ error: 'invalid_client_metadata' }, 400));
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (!uris.length || uris.length > 5 || !uris.every(okRedirect)) return withCors(json({ error: 'invalid_redirect_uri' }, 400));
  const name = (typeof body.client_name === 'string' && body.client_name.trim().slice(0, 60)) || 'AI assistant';
  const id = randomToken(16);
  await env.DB.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)').bind(id, name, JSON.stringify(uris), Date.now()).run();
  // keep the table bounded: registration is open by design (dynamic client registration)
  await env.DB.prepare('DELETE FROM oauth_clients WHERE id NOT IN (SELECT id FROM oauth_clients ORDER BY created_at DESC LIMIT ?)').bind(MAX_CLIENTS).run();
  return withCors(
    json({ client_id: id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201),
  );
}

interface Client {
  id: string;
  name: string;
  redirect_uris: string[];
}
async function getClient(env: Env, id: string | null): Promise<Client | null> {
  if (!id) return null;
  const row = await env.DB.prepare('SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?').bind(id).first<{ id: string; name: string; redirect_uris: string }>();
  return row ? { id: row.id, name: row.name, redirect_uris: JSON.parse(row.redirect_uris) as string[] } : null;
}

// ------------------------------------------------------------------ sign-in and consent page

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const TEXT = {
  en: { title: 'Connect to PSPP Studio', lead: '{app} wants to read and analyse the documents in your PSPP Studio account.', returns: 'After you allow, you return to {host}.', email: 'E-mail', password: 'Password', allow: 'Sign in and allow', deny: 'Cancel', note: 'It can open your documents, run analyses and save results into them. It cannot change your settings or password. You can disconnect it any time in Settings, Profile.', bad: 'Wrong e-mail or password.', many: 'Too many attempts. Try again in a few minutes.' },
  cs: { title: 'Připojit k PSPP Studiu', lead: 'Aplikace {app} chce číst a analyzovat dokumenty ve tvém účtu PSPP Studio.', returns: 'Po povolení se vrátíš do {host}.', email: 'E-mail', password: 'Heslo', allow: 'Přihlásit a povolit', deny: 'Zrušit', note: 'Může otevírat tvé dokumenty, spouštět analýzy a ukládat do nich výsledky. Nemůže měnit nastavení ani heslo. Přístup můžeš kdykoli zrušit v Nastavení, Profil.', bad: 'Nesprávný e-mail nebo heslo.', many: 'Příliš mnoho pokusů. Zkus to za pár minut.' },
};

function page(request: Request, client: Client, params: URLSearchParams, error?: 'bad' | 'many'): Response {
  const lang = (request.headers.get('accept-language') ?? '').toLowerCase().startsWith('cs') ? 'cs' : 'en';
  const T = TEXT[lang];
  const redirect = params.get('redirect_uri') ?? '';
  const host = new URL(redirect).host;
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope']
    .map((k) => `<input type="hidden" name="${k}" value="${esc(params.get(k) ?? '')}">`)
    .join('');
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${T.title}</title>
<style>
:root{--bg:#faf9f6;--card:#fff;--ink:#1d1c1a;--ink3:#6b6862;--line:#d9d5cc;--accent:#0f7b5f;--on:#fff;--err:#b3412e}
@media(prefers-color-scheme:dark){:root{--bg:#1a1917;--card:#23221f;--ink:#f1efe9;--ink3:#a19c93;--line:#3a3833;--accent:#3bb88f;--on:#0b1a14;--err:#ff8b75}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{margin:0 0 8px;font-size:22px}p{margin:0 0 12px}.small{color:var(--ink3);font-size:14px}
label{display:block;margin:14px 0 4px;font-weight:600;font-size:14px}
input[type=email],input[type=password]{width:100%;height:42px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
.row{display:flex;gap:10px;margin-top:20px}button{height:42px;padding:0 18px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);font:inherit;font-weight:600;cursor:pointer}
button.primary{flex:1;background:var(--accent);border-color:var(--accent);color:var(--on)}.err{color:var(--err);font-weight:600;margin-top:12px}
</style></head><body><main>
<h1>${T.title}</h1>
<p>${T.lead.replace('{app}', `<strong>${esc(client.name)}</strong>`)}</p>
<p class="small">${T.returns.replace('{host}', esc(host))}</p>
<form method="post" action="/oauth/authorize">${hidden}
<label for="e">${T.email}</label><input id="e" name="email" type="email" autocomplete="email" required autofocus>
<label for="p">${T.password}</label><input id="p" name="password" type="password" autocomplete="current-password" required>
${error ? `<p class="err" role="alert">${T[error]}</p>` : ''}
<div class="row"><button class="primary" type="submit" name="action" value="allow">${T.allow}</button><button type="submit" name="action" value="deny" formnovalidate>${T.deny}</button></div>
</form>
<p class="small" style="margin-top:18px">${T.note}</p>
</main></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'" } });
}

function redirectTo(base: string, extra: Record<string, string>): Response {
  const url = new URL(base);
  for (const [k, v] of Object.entries(extra)) if (v) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

/** Both the page (GET) and the form (POST) validate the same parameters first. */
async function checkAuthorizeParams(env: Env, params: URLSearchParams): Promise<{ client: Client } | Response> {
  const client = await getClient(env, params.get('client_id'));
  const redirect = params.get('redirect_uri');
  if (!client || !redirect || !client.redirect_uris.includes(redirect)) return new Response('Unknown application or redirect address.', { status: 400 });
  if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) return redirectTo(redirect, { error: 'invalid_request', error_description: 'PKCE with S256 is required', state: params.get('state') ?? '' });
  return { client };
}

export async function authorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const checked = await checkAuthorizeParams(env, url.searchParams);
    return 'client' in checked ? page(request, checked.client, url.searchParams) : checked;
  }
  const form = new URLSearchParams(await request.text());
  const checked = await checkAuthorizeParams(env, form);
  if (!('client' in checked)) return checked;
  const redirect = form.get('redirect_uri')!;
  const state = form.get('state') ?? '';
  if (form.get('action') === 'deny') return redirectTo(redirect, { error: 'access_denied', state });
  let user: { id: string };
  try {
    user = await authenticate(env, form.get('email') ?? '', form.get('password') ?? '');
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 400 || e.status === 429)) return page(request, checked.client, form, e.status === 429 ? 'many' : 'bad');
    throw e;
  }
  const code = randomToken(24);
  await env.DB.prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(code), checked.client.id, user.id, redirect, form.get('code_challenge')!, Date.now() + CODE_MS)
    .run();
  await env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(Date.now()).run();
  return redirectTo(redirect, { code, state });
}

// ------------------------------------------------------------------ token endpoint

async function issue(env: Env, client: Client, userId: string) {
  const access = `pat_${randomToken(32)}`;
  const refresh = `prt_${randomToken(32)}`;
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO api_tokens (id, user_id, name, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, userId, client.name, await sha256(access), now, now + ACCESS_DAYS * DAY)
    .run();
  await env.DB.prepare('INSERT INTO oauth_refresh (token_hash, client_id, user_id, access_id, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(refresh), client.id, userId, id, now + REFRESH_DAYS * DAY)
    .run();
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_DAYS * 86_400, refresh_token: refresh, scope: 'documents' }, 200, { 'cache-control': 'no-store' });
}

const oauthError = (error: string, status = 400) => withCors(json({ error }, status, { 'cache-control': 'no-store' }));

export async function token(request: Request, env: Env): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  const client = await getClient(env, form.get('client_id'));
  if (!client) return oauthError('invalid_client', 401);
  const grant = form.get('grant_type');

  if (grant === 'authorization_code') {
    const code = form.get('code') ?? '';
    const row = await env.DB.prepare('SELECT client_id, user_id, redirect_uri, challenge, expires_at FROM oauth_codes WHERE code_hash = ?')
      .bind(await sha256(code))
      .first<{ client_id: string; user_id: string; redirect_uri: string; challenge: string; expires_at: number }>();
    await env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').bind(await sha256(code)).run(); // single use
    if (!row || row.expires_at < Date.now() || row.client_id !== client.id || row.redirect_uri !== form.get('redirect_uri')) return oauthError('invalid_grant');
    const verifier = form.get('code_verifier') ?? '';
    const expected = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    if (!verifier || expected !== row.challenge) return oauthError('invalid_grant');
    return withCors(await issue(env, client, row.user_id));
  }

  if (grant === 'refresh_token') {
    const hash = await sha256(form.get('refresh_token') ?? '');
    const row = await env.DB.prepare('SELECT client_id, user_id, access_id, expires_at FROM oauth_refresh WHERE token_hash = ?')
      .bind(hash)
      .first<{ client_id: string; user_id: string; access_id: string; expires_at: number }>();
    if (!row || row.client_id !== client.id || row.expires_at < Date.now()) return oauthError('invalid_grant');
    // rotate: the old access token and refresh token go away together
    await env.DB.prepare('DELETE FROM api_tokens WHERE id = ?').bind(row.access_id).run();
    return withCors(await issue(env, client, row.user_id));
  }
  return oauthError('unsupported_grant_type');
}

export const oauthCors = withCors;
