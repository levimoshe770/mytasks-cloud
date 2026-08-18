// Everything the app needs to reach GitHub, kept in this browser's localStorage.
// There is no server, so the token lives here and nowhere else — clearing it
// (the "Sign out" button) fully disconnects this device.

export interface Settings {
  // Fine-grained PAT. Needs Contents: read+write on the data repo, and
  // Issues: read on any repo you want to link issues from.
  token: string;
  // Repo holding tasks.json.
  owner: string;
  repo: string;
  branch: string;
  path: string;
  // Default "owner/repo" used when you type a bare issue number. Empty means
  // a bare number is rejected and you must type owner/repo#123.
  issueRepo: string;
}

const KEY = 'mytasks.settings.v1';

export const DEFAULT_SETTINGS: Omit<Settings, 'token' | 'owner' | 'repo'> = {
  branch: 'main',
  path: 'tasks.json',
  issueRepo: '',
};

let cached: Settings | null | undefined;

export function getSettings(): Settings | null {
  if (cached !== undefined) return cached;
  cached = readSettings();
  return cached;
}

function readSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (!parsed.token || !parsed.owner || !parsed.repo) return null;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      token: parsed.token,
      owner: parsed.owner,
      repo: parsed.repo,
    };
  } catch {
    return null;
  }
}

export function saveSettings(s: Settings): void {
  cached = s;
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSettings(): void {
  cached = null;
  localStorage.removeItem(KEY);
}

// Throws rather than returning null so callers deep in the data layer don't all
// have to null-check; the UI never renders those paths without settings.
export function requireSettings(): Settings {
  const s = getSettings();
  if (!s) throw new Error('Not connected to GitHub yet.');
  return s;
}

export function dataRepoSlug(s: Settings): string {
  return `${s.owner}/${s.repo}`;
}
