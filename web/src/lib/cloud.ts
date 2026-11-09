/*
 * Client for the optional accounts server (see /server). Everything here is opt-in: without an
 * account the app never talks to it. The token lives in localStorage of this browser only.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { gunzip, gzip, strFromU8, strToU8 } from 'fflate';

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://pspp-studio-api.pspp-studio-server.workers.dev';
const TOKEN_KEY = 'pspp-studio.token';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: unknown,
  ) {
    super(code);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private window: the session then lasts until the tab is closed only */
  }
}

async function call(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (auth && token) headers.set('authorization', `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!res.ok) {
    let detail: unknown;
    let code = 'server_error';
    try {
      detail = await res.json();
      code = (detail as { error?: string }).error ?? code;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, code, detail);
  }
  return res;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface CloudUser {
  id: string;
  email: string;
}
export interface CloudProject {
  id: string;
  name: string;
  size: number;
  rev: number;
  created_at: number;
  updated_at: number;
}
export interface Usage {
  used: number;
  quota: number;
}

export async function register(email: string, password: string, invite: string) {
  const res = await call('/api/register', jsonInit('POST', { email, password, invite }), false);
  return (await res.json()) as { token: string; user: CloudUser };
}
export async function login(email: string, password: string) {
  const res = await call('/api/login', jsonInit('POST', { email, password }), false);
  return (await res.json()) as { token: string; user: CloudUser };
}
export async function logout() {
  await call('/api/logout', { method: 'POST' }).catch(() => undefined);
}
export async function me() {
  return (await (await call('/api/me')).json()) as { user: CloudUser } & Usage;
}
export async function listProjects() {
  return (await (await call('/api/projects')).json()) as { projects: CloudProject[] } & Usage;
}
export async function createProject(name: string) {
  return (await (await call('/api/projects', jsonInit('POST', { name }))).json()) as { id: string; rev: number };
}
export async function renameProject(id: string, name: string) {
  await call(`/api/projects/${id}`, jsonInit('PATCH', { name }));
}
export async function deleteProject(id: string) {
  await call(`/api/projects/${id}`, { method: 'DELETE' });
}

const pack = (value: unknown) =>
  new Promise<Uint8Array>((resolve, reject) => gzip(strToU8(JSON.stringify(value)), { level: 6 }, (e, d) => (e ? reject(e) : resolve(d))));
const unpack = <T>(bytes: Uint8Array) =>
  new Promise<T>((resolve, reject) =>
    gunzip(bytes, (e, d) => {
      if (e) return reject(e);
      try {
        resolve(JSON.parse(strFromU8(d)) as T);
      } catch (x) {
        reject(x);
      }
    }),
  );

export async function putDoc(id: string, rev: number, value: unknown) {
  const body = await pack(value);
  const res = await call(`/api/projects/${id}/doc`, { method: 'PUT', headers: { 'if-match': String(rev), 'content-type': 'application/octet-stream' }, body });
  return (await res.json()) as { rev: number; size: number };
}

export async function getDoc<T>(id: string): Promise<{ rev: number; value: T | null }> {
  const res = await call(`/api/projects/${id}/doc`);
  const rev = Number(res.headers.get('x-rev') ?? '0');
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { rev, value: bytes.length ? await unpack<T>(bytes) : null };
}

export async function getSettings<T>() {
  return (await (await call('/api/settings')).json()) as { settings: T | null; updated: number | null };
}
export async function putSettings(settings: unknown) {
  return (await (await call('/api/settings', jsonInit('PUT', settings))).json()) as { ok: true; updated: number };
}
