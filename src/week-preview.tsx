import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WeekPanel } from './components/WeekPanel';
import { Task } from './types';
import './index.css';

// Dev-only preview of the week panel with fixture data, so a layout change can
// be looked at without a GitHub token. Not a build input — see week-preview.html.

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
    sourceRef: null,
    milestone: 'Phase 1',
    parentId: null,
    tags: ['phase-1', 'moshe'],
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
    tags: ['phase-0', 'daniela'], priority: 'critical',
    deadline: iso(2026, 8, 19),
  }),
  t({
    subject: 'Daniela records all 8 modules, speaking freely in her own voice',
    tags: ['phase-1', 'daniela'], priority: 'critical',
    deadline: iso(2026, 8, 26), estimateHours: 7,
  }),
  t({
    subject: 'Daniela gathers all existing raw material',
    tags: ['phase-1', 'daniela'], deadline: iso(2026, 8, 26),
  }),
  t({
    subject: 'Session 1 — why not Israel · testimonial date · trustee paperwork',
    tags: ['phase-1.5', 'both'], priority: 'critical',
    deadline: iso(2026, 8, 25), estimateHours: 3.5,
  }),
  t({
    subject: 'Session 2 — the outline against what she actually said',
    tags: ['phase-1', 'both'], deadline: iso(2026, 8, 27), estimateHours: 3.5,
  }),
  t({
    subject: "Transcribe Daniela's recordings and build the 8 scripts",
    priority: 'critical', deadline: iso(2026, 9, 17), estimateHours: 18,
    status: 'in_progress',
    todos: [
      { id: 1, text: 'Set up the transcription pipeline', done: true, due: null, createdAt: '', doneAt: '' },
      { id: 2, text: 'Modules 1–2', done: false, due: null, createdAt: '', doneAt: null },
      { id: 3, text: 'Modules 3–4', done: false, due: null, createdAt: '', doneAt: null },
      { id: 4, text: 'Modules 5–6', done: false, due: null, createdAt: '', doneAt: null },
      { id: 5, text: 'Modules 7–8', done: false, due: null, createdAt: '', doneAt: null },
      { id: 6, text: 'Double scrub', done: false, due: null, createdAt: '', doneAt: null },
    ],
  }),
  t({
    subject: 'Gate A — course platform, checkout, and one real test purchase',
    tags: ['phase-1.5', 'moshe'], priority: 'critical',
    deadline: iso(2026, 9, 24), estimateHours: 6,
  }),
  t({
    subject: 'File the Israeli trademark — Class 41',
    tags: ['phase-1.5', 'moshe'], priority: 'critical',
    deadline: iso(2026, 9, 17), estimateHours: 4,
  }),
  t({
    subject: 'Collect testimonials from existing patients',
    tags: ['phase-1.5', 'daniela'], priority: 'critical',
    deadline: iso(2026, 9, 24), estimateHours: 5,
  }),
  t({
    subject: 'Edit in sales order — the 3 promos first',
    priority: 'critical', deadline: iso(2026, 10, 24), estimateHours: 25,
  }),
  t({
    subject: 'Import the real Base44 landing page source',
    status: 'completed', completedAt: iso(2026, 8, 24),
  }),
];

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Preview() {
  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-5xl mx-auto space-y-4">
        <p className="text-xs text-gray-500">
          Dev preview · fixture data · reference date 26 Aug 2026
        </p>
        <WeekPanel tasks={TASKS} onOpenTask={task => console.log('open', task.id)} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <Preview />
    </QueryClientProvider>
  </React.StrictMode>,
);
