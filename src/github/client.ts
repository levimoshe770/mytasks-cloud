import { requireSettings } from '../settings';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
    // True when the request failed before reaching GitHub (offline, DNS, a
    // corporate proxy blocking api.github.com). The UI treats this as "stale
    // data is fine" rather than "your token is wrong".
    public offline = false,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export function isAuthError(e: unknown): boolean {
  return e instanceof GitHubError && (e.status === 401 || e.status === 403);
}

export interface GhInit extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
}

// One raw request. Returns the Response so callers can read ETag / handle 304;
// only non-2xx-and-not-304 responses throw.
export async function ghFetch(path: string, init: GhInit = {}): Promise<Response> {
  const { token } = requireSettings();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
    ...init.headers,
  };
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers, cache: 'no-store' });
  } catch (e) {
    throw new GitHubError(0, `Cannot reach api.github.com: ${(e as Error).message}`, true);
  }

  if (res.ok || res.status === 304) return res;
  throw await toError(res, path);
}

async function toError(res: Response, path: string): Promise<GitHubError> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.message ?? '';
    // Contents-API validation failures put the useful part in `errors`.
    if (Array.isArray(body?.errors) && body.errors.length) {
      const extra = body.errors.map((x: { message?: string; code?: string }) => x.message ?? x.code).filter(Boolean);
      if (extra.length) detail += ` (${extra.join('; ')})`;
    }
  } catch {
    detail = res.statusText;
  }

  switch (res.status) {
    case 401:
      return new GitHubError(401, 'GitHub rejected the token. It may be expired or mistyped.');
    case 403: {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000;
        const when = reset ? new Date(reset).toLocaleTimeString() : 'shortly';
        return new GitHubError(403, `GitHub API rate limit reached. Resets at ${when}.`);
      }
      return new GitHubError(403, detail || 'Forbidden — the token lacks permission for this repo.');
    }
    case 404:
      return new GitHubError(404, detail || `Not found: ${path}`);
    case 409:
      return new GitHubError(409, detail || 'Conflict — the file changed since it was read.');
    case 422:
      return new GitHubError(422, detail || 'GitHub rejected the write as invalid.');
    default:
      return new GitHubError(res.status, detail || `GitHub returned ${res.status}`);
  }
}

// Parsed-JSON convenience wrapper for endpoints where 304 is not in play.
export async function gh<T>(path: string, init: GhInit = {}): Promise<T> {
  const res = await ghFetch(path, init);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- base64 <-> UTF-8 --------------------------------------------------------
// The Contents API speaks base64 of the raw bytes. atob/btoa are latin1-only, so
// both directions go through TextEncoder/TextDecoder — otherwise any non-ASCII
// character (Hebrew, an em dash, an emoji in a note) corrupts the file.

export function decodeBase64(b64: string): string {
  const clean = b64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  // Chunked: String.fromCharCode(...bytes) blows the argument limit somewhere
  // around 100k bytes, which a few hundred tasks with notes will exceed.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
