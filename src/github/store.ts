import { EMPTY_STORE, TasksStore } from '../types';
import { dataRepoSlug, requireSettings } from '../settings';
import { decodeBase64, encodeBase64, gh, ghFetch, GitHubError } from './client';
import { Mutex } from '../util/lock';

// tasks.json in a private repo *is* the database. There is no server, so the
// concurrency control the old backend got from a process-wide mutex plus
// `git pull --rebase` is replaced by the Contents API's blob SHA: every write
// sends the SHA it read, and GitHub rejects it if anyone (another device, a
// scheduled Action) has written since. On rejection we re-read and re-apply the
// mutation rather than clobbering, so two devices editing different tasks both
// survive.

interface Snapshot {
  store: TasksStore;
  // null when tasks.json does not exist yet — the first write creates it.
  sha: string | null;
  etag: string | null;
  fetchedAt: number;
}

interface ContentsFile {
  content: string;
  encoding: string;
  sha: string;
  size: number;
}

const OFFLINE_KEY = 'mytasks.cache.v1';
const MAX_WRITE_ATTEMPTS = 5;
// A GET this soon after our own successful write is skipped: the Contents API is
// read through a CDN and can briefly serve the pre-write blob, which would only
// cause a needless conflict-and-retry on the next mutation.
const WRITE_SETTLE_MS = 3_000;

const mutex = new Mutex();

let snapshot: Snapshot | null = null;
let lastWriteAt = 0;
let lastSyncAt: number | null = null;
let stale = false;

export interface SyncState {
  lastSyncAt: number | null;
  // True when the last load came from the offline copy rather than GitHub.
  stale: boolean;
}

export function getSyncState(): SyncState {
  return { lastSyncAt, stale };
}

function contentsPath(): string {
  const s = requireSettings();
  return `/repos/${s.owner}/${s.repo}/contents/${encodeURI(s.path)}`;
}

function clone(store: TasksStore): TasksStore {
  return JSON.parse(JSON.stringify(store)) as TasksStore;
}

// --- offline copy ------------------------------------------------------------
// Keyed by repo slug + path so switching repos can't surface the wrong list.

function offlineKey(): string {
  const s = requireSettings();
  return `${dataRepoSlug(s)}:${s.path}`;
}

function saveOffline(store: TasksStore): void {
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify({ key: offlineKey(), store }));
  } catch {
    // Quota exceeded — the offline copy is a nicety, never block the write.
  }
}

function loadOffline(): TasksStore | null {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { key?: string; store?: TasksStore };
    if (parsed.key !== offlineKey() || !parsed.store) return null;
    return parsed.store;
  } catch {
    return null;
  }
}

// --- reading -----------------------------------------------------------------

function parseStore(json: string): TasksStore {
  const parsed = JSON.parse(json) as Partial<TasksStore>;
  return {
    version: parsed.version ?? 1,
    nextId: parsed.nextId ?? 1,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    config: parsed.config ?? { currentMilestone: null },
  };
}

async function fetchSnapshot(prev: Snapshot | null): Promise<Snapshot> {
  const s = requireSettings();
  const url = `${contentsPath()}?ref=${encodeURIComponent(s.branch)}`;
  const headers: Record<string, string> = {};
  if (prev?.etag) headers['If-None-Match'] = prev.etag;

  let res: Response;
  try {
    res = await ghFetch(url, { headers });
  } catch (e) {
    // A missing file is a normal first-run state, not an error.
    if (e instanceof GitHubError && e.status === 404) {
      lastSyncAt = Date.now();
      stale = false;
      return { store: clone(EMPTY_STORE), sha: null, etag: null, fetchedAt: Date.now() };
    }
    throw e;
  }

  // 304: nothing changed, and it did not count against the rate limit.
  if (res.status === 304 && prev) {
    lastSyncAt = Date.now();
    stale = false;
    return { ...prev, fetchedAt: Date.now() };
  }

  const file = (await res.json()) as ContentsFile;
  let json: string;
  if (file.encoding === 'base64' && file.content) {
    json = decodeBase64(file.content);
  } else {
    // Over ~1MB the Contents API returns an empty body and defers to the blob
    // API, which serves the same base64 up to 100MB.
    const blob = await gh<ContentsFile>(`/repos/${s.owner}/${s.repo}/git/blobs/${file.sha}`);
    json = decodeBase64(blob.content);
  }

  const store = parseStore(json);
  saveOffline(store);
  lastSyncAt = Date.now();
  stale = false;
  return { store, sha: file.sha, etag: res.headers.get('etag'), fetchedAt: Date.now() };
}

async function loadSnapshot(force: boolean): Promise<Snapshot> {
  if (snapshot && !force && Date.now() - lastWriteAt < WRITE_SETTLE_MS) return snapshot;
  try {
    snapshot = await fetchSnapshot(snapshot);
    return snapshot;
  } catch (e) {
    // Offline or blocked network: fall back to the last known good copy so the
    // app still opens and shows something on a phone with no signal.
    if (e instanceof GitHubError && e.offline) {
      if (snapshot) {
        stale = true;
        return snapshot;
      }
      const cached = loadOffline();
      if (cached) {
        stale = true;
        // No sha, so any write from this state must re-read first — and will,
        // because putStore without a sha 422s and the retry loop re-reads.
        snapshot = { store: cached, sha: null, etag: null, fetchedAt: 0 };
        return snapshot;
      }
    }
    throw e;
  }
}

// The current store. Callers that only render get a read-only view; never
// mutate the returned object — go through mutateStore.
export async function readStore(): Promise<TasksStore> {
  const snap = await loadSnapshot(false);
  return snap.store;
}

// --- writing -----------------------------------------------------------------

interface PutResponse {
  content: { sha: string };
}

async function putStore(store: TasksStore, sha: string | null, message: string): Promise<string> {
  const s = requireSettings();
  const json = JSON.stringify(store, null, 2) + '\n';
  const body: Record<string, unknown> = {
    message,
    content: encodeBase64(json),
    branch: s.branch,
  };
  // Omitting sha means "create". GitHub 422s if the file already exists, which
  // the retry loop treats as a conflict and resolves by re-reading.
  if (sha) body.sha = sha;

  const res = await gh<PutResponse>(contentsPath(), {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return res.content.sha;
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// Read, apply, write — retrying from a fresh read whenever GitHub reports the
// blob moved under us. `mutate` must be pure with respect to anything outside
// the draft it is handed: it can run more than once.
export async function mutateStore<T>(
  message: string,
  mutate: (draft: TasksStore) => T,
): Promise<T> {
  return mutex.lock(async () => {
    let lastConflict: GitHubError | null = null;

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const base = await loadSnapshot(attempt > 0);
      const draft = clone(base.store);
      const result = mutate(draft);

      try {
        const newSha = await putStore(draft, base.sha, message);
        snapshot = { store: draft, sha: newSha, etag: null, fetchedAt: Date.now() };
        lastWriteAt = Date.now();
        lastSyncAt = lastWriteAt;
        stale = false;
        saveOffline(draft);
        return result;
      } catch (e) {
        // 409 = sha mismatch, 422 = sha missing / file already exists. Both mean
        // another writer got there first: drop the snapshot and re-read.
        if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
          lastConflict = e;
          snapshot = null;
          lastWriteAt = 0;
          continue;
        }
        throw e;
      }
    }

    throw new ConflictError(
      `Could not save after ${MAX_WRITE_ATTEMPTS} attempts — tasks.json is being written from somewhere else. ` +
        `Last error: ${lastConflict?.message ?? 'conflict'}`,
    );
  });
}

// Drop every cached revision. Used on sign-out and when repo settings change.
export function resetStore(): void {
  snapshot = null;
  lastWriteAt = 0;
  lastSyncAt = null;
  stale = false;
}
