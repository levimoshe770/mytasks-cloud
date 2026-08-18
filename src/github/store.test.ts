import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64, decodeBase64, GitHubError } from './client';
import { mutateStore, readStore, resetStore } from './store';
import { saveSettings } from '../settings';
import { TasksStore } from '../types';

// The write path is optimistic-locked against a blob SHA, and losing a write to
// a botched conflict retry is the one failure mode that silently destroys data.
// These drive the real store against a fake Contents API.

interface FakeRepo {
  store: TasksStore;
  sha: string;
  puts: number;
}

let repo: FakeRepo;
let shaCounter: number;

function makeStore(tasks: TasksStore['tasks'] = []): TasksStore {
  return { version: 1, nextId: tasks.length + 1, tasks, config: { currentMilestone: null } };
}

function task(id: number, subject: string) {
  return {
    id,
    subject,
    description: '',
    status: 'pending' as const,
    priority: 'medium' as const,
    starred: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    deadline: null,
    source: 'manual',
    sourceRef: null,
    milestone: null,
    parentId: null,
    tags: [],
    remindedAt: null,
    notes: [],
  };
}

// A minimal stand-in for the two Contents API calls the store makes. `onPut`
// lets a test simulate another device committing between our read and write.
function installFetch(onPut?: (attempt: number) => void) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      repo.puts += 1;
      onPut?.(repo.puts);
      const body = JSON.parse(String(init.body)) as { content: string; sha?: string };
      if (body.sha !== repo.sha) {
        return new Response(JSON.stringify({ message: 'does not match' }), { status: 409 });
      }
      repo.store = JSON.parse(decodeBase64(body.content));
      repo.sha = `sha${++shaCounter}`;
      return new Response(JSON.stringify({ content: { sha: repo.sha } }), { status: 200 });
    }
    void url;
    return new Response(
      JSON.stringify({
        content: encodeBase64(JSON.stringify(repo.store)),
        encoding: 'base64',
        sha: repo.sha,
        size: 100,
      }),
      { status: 200, headers: { etag: `"${repo.sha}"` } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  shaCounter = 0;
  repo = { store: makeStore([task(1, 'first')]), sha: 'sha0', puts: 0 };
  saveSettings({
    token: 't', owner: 'o', repo: 'r', branch: 'main', path: 'tasks.json', issueRepo: '',
  });
  resetStore();
});

describe('base64 round trip', () => {
  it('survives non-ASCII, which latin1 btoa would corrupt', () => {
    const text = 'שלום — café 🎯 "quotes"';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('handles a payload past the fromCharCode argument limit', () => {
    const text = 'x'.repeat(300_000);
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });
});

describe('mutateStore', () => {
  it('writes and reflects the change', async () => {
    installFetch();
    await mutateStore('add', draft => { draft.tasks.push(task(2, 'second')); });
    expect(repo.store.tasks.map(t => t.subject)).toEqual(['first', 'second']);
  });

  it('re-applies onto the winner instead of clobbering it', async () => {
    // On our first PUT attempt, another device lands a commit first. Our retry
    // must rebase onto their task, not overwrite it.
    installFetch(attempt => {
      if (attempt === 1) {
        repo.store = makeStore([task(1, 'first'), task(9, 'from other device')]);
        repo.sha = `sha${++shaCounter}`;
      }
    });

    await mutateStore('add', draft => { draft.tasks.push(task(2, 'mine')); });

    const subjects = repo.store.tasks.map(t => t.subject);
    expect(subjects).toContain('from other device');
    expect(subjects).toContain('mine');
    expect(repo.puts).toBe(2);
  });

  it('gives up with a clear error rather than looping forever', async () => {
    // Every PUT loses the race — the store must stop and say so.
    installFetch(() => { repo.sha = `sha${++shaCounter}`; });
    await expect(mutateStore('add', draft => { draft.tasks.push(task(2, 'x')); }))
      .rejects.toThrow(/being written from somewhere else/);
  });

  it('does not half-apply a mutation that throws', async () => {
    installFetch();
    await expect(mutateStore('bad', () => { throw new Error('nope'); })).rejects.toThrow('nope');
    expect(repo.puts).toBe(0);
    expect(repo.store.tasks).toHaveLength(1);
  });
});

describe('readStore', () => {
  it('treats a missing tasks.json as an empty store, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })));
    const store = await readStore();
    expect(store.tasks).toEqual([]);
    expect(store.nextId).toBe(1);
  });

  it('serves the last known copy when the network is unreachable', async () => {
    installFetch();
    await readStore(); // populates the offline copy
    resetStore();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const store = await readStore();
    expect(store.tasks.map(t => t.subject)).toEqual(['first']);
  });

  it('surfaces a rejected token instead of hiding it behind the cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })));
    await expect(readStore()).rejects.toBeInstanceOf(GitHubError);
  });
});
