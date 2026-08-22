import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { encodeBase64 } from './github/client';
import { saveSettings } from './settings';
import { Task, TasksStore } from './types';
import './index.css';

// Dev-only: the whole app, running against an in-memory tasks.json instead of
// GitHub. Existed because checking a layout change otherwise needed a real
// personal access token, which made looking at the mobile view expensive enough
// that nobody did it. Not a build input — see app-preview.html.

let seq = 0;
function t(over: Partial<Task>): Task {
  seq += 1;
  return {
    id: seq,
    subject: `task ${seq}`,
    description: '',
    status: 'pending',
    priority: 'medium',
    starred: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    deadline: null,
    source: 'workplan',
    sourceRef: `ref-${seq}`,
    milestone: 'Phase 1.5',
    parentId: null,
    tags: ['phase-1.5', 'moshe'],
    remindedAt: null,
    notes: [],
    ...over,
  };
}

function iso(y: number, m: number, d: number) {
  return new Date(y, m - 1, d, 18, 0, 0).toISOString();
}

const TASKS: Task[] = [
  t({
    subject: 'Approve the 8-module outline',
    description: 'Blocks the recordings, which are due the next day.',
    tags: ['phase-0', 'daniela'], priority: 'critical', milestone: 'Phase 0',
    deadline: iso(2026, 8, 19),
  }),
  t({
    subject: 'Daniela records all 8 modules, speaking freely in her own voice',
    description:
      'Method changed 2026-08-18: she no longer rewrites AI drafts, she talks and the recording becomes the source text.',
    tags: ['phase-1', 'daniela'], priority: 'critical', milestone: 'Phase 1',
    deadline: iso(2026, 8, 26), estimateHours: 7, starred: true,
  }),
  t({
    subject: 'Session 1 — why not Israel · testimonial date · trustee paperwork',
    tags: ['phase-1.5', 'both'], priority: 'critical',
    deadline: iso(2026, 8, 25), estimateHours: 3.5,
  }),
  t({
    subject: 'Session 2 — the outline against what she actually said',
    tags: ['phase-1', 'both'], milestone: 'Phase 1',
    deadline: iso(2026, 8, 27), estimateHours: 3.5,
  }),
  t({
    subject: "Transcribe Daniela's recordings and build the 8 scripts",
    description:
      'THE BUDGET: 16-20 of the ~30 solo hours available between now and the camera.',
    priority: 'critical', milestone: 'Phase 1', status: 'in_progress',
    deadline: iso(2026, 9, 17), estimateHours: 12, starred: true,
    todos: [
      { id: 1, text: 'Set up the transcription pipeline', done: true, due: null, createdAt: '', doneAt: '' },
      { id: 2, text: 'Modules 1–2', done: false, due: null, createdAt: '', doneAt: null },
      { id: 3, text: 'Modules 3–4', done: false, due: null, createdAt: '', doneAt: null },
      { id: 4, text: 'Modules 5–6', done: false, due: null, createdAt: '', doneAt: null },
    ],
  }),
  t({
    subject: 'Gate A — course platform, checkout, and one real test purchase',
    priority: 'critical', deadline: iso(2026, 9, 24), estimateHours: 6,
  }),
  t({
    subject: 'File the Israeli trademark — Class 41, ₪1,858',
    priority: 'critical', deadline: iso(2026, 9, 17), estimateHours: 2,
  }),
  t({
    subject: 'Collect testimonials from existing patients',
    tags: ['phase-1.5', 'daniela'], priority: 'critical',
    deadline: iso(2026, 9, 24), estimateHours: 5,
  }),
  t({
    subject: 'Edit in sales order — the 3 promos first, then module 1',
    priority: 'critical', milestone: 'Phase 1',
    deadline: iso(2026, 10, 24), estimateHours: 25,
  }),
  t({
    subject: 'Build the launch market mandatory legal pages',
    deadline: iso(2026, 9, 24), estimateHours: 3, priority: 'high',
  }),
  t({
    subject: 'Import the real Base44 landing page source',
    status: 'completed', completedAt: iso(2026, 8, 24), milestone: 'Phase 3',
    tags: ['phase-3', 'moshe'],
  }),
  t({
    subject: 'Decide the post-launch support answer',
    tags: ['phase-1.5', 'both'], priority: 'high',
    deadline: iso(2026, 10, 8), estimateHours: 1,
  }),
];

const STORE: TasksStore = {
  version: 1,
  nextId: seq + 1,
  tasks: TASKS,
  config: {
    currentMilestone: 'Phase 1.5',
    ownerTag: 'moshe',
    weeklyCapacityHours: 6,
    sessionCapacityHours: 7,
  },
};

// Minimal stand-in for the Contents API: enough for read, write and the ETag
// path. Writes mutate the in-memory store so the UI round-trips for real.
const realFetch = window.fetch.bind(window);
let sha = 'sha-0';
let n = 0;
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (!url.startsWith('https://api.github.com')) return realFetch(input as RequestInfo, init);

  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'PUT') {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const decoded = decodeURIComponent(escape(atob(body.content)));
    Object.assign(STORE, JSON.parse(decoded));
    sha = `sha-${++n}`;
    return new Response(JSON.stringify({ content: { sha } }), { status: 200 });
  }
  return new Response(
    JSON.stringify({ encoding: 'base64', content: encodeBase64(JSON.stringify(STORE)), sha }),
    { status: 200, headers: { etag: `"${sha}"`, 'content-type': 'application/json' } },
  );
}) as typeof window.fetch;

saveSettings({
  token: 'preview-not-a-real-token',
  owner: 'preview',
  repo: 'mytasks-data-preview',
  branch: 'main',
  path: 'tasks.json',
  issueRepo: '',
});

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
