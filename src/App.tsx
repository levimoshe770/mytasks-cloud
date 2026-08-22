import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isAuthError, Task } from './api';
import { clearSettings, getSettings } from './settings';
import { resetStore } from './github/store';
import { useMeta, usePatchTask, useTasks } from './hooks/useTasks';
import { SetupScreen } from './components/SetupScreen';
import { SettingsDialog } from './components/SettingsDialog';
import { SyncBadge } from './components/SyncBadge';
import { TaskTable } from './components/TaskTable';
import { TaskDrawer } from './components/TaskDrawer';
import { AddTaskDialog } from './components/AddTaskDialog';
import { InboxComposer } from './components/InboxComposer';
import { TodoBoard } from './components/TodoBoard';
import { WeekPanel } from './components/WeekPanel';
import { cn } from './util/cn';

// 'tasks' = the task table; 'todos' = the flat cross-task checklist view.
type View = 'tasks' | 'todos';

export default function App() {
  const [connected, setConnected] = useState(() => !!getSettings());
  const qc = useQueryClient();

  function handleConnected() {
    qc.clear();
    setConnected(true);
  }

  if (!connected) return <SetupScreen onConnected={handleConnected} />;
  return <Main key="main" onDisconnected={() => setConnected(false)} onReconnected={handleConnected} />;
}

interface MainProps {
  onDisconnected: () => void;
  onReconnected: () => void;
}

function Main({ onDisconnected, onReconnected }: MainProps) {
  const [selected, setSelected] = useState<Task | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  // On a phone the counts and the two filter toggles cost a whole header row
  // each, and the header was already eating a fifth of the screen. They hide
  // behind this on small viewports and are always visible from sm up.
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('tasks');

  const qc = useQueryClient();
  const tasksQuery = useTasks();
  const patchTask = usePatchTask();
  const meta = useMeta();
  const currentMilestone = meta.data?.currentMilestone ?? null;

  function signOut() {
    clearSettings();
    resetStore();
    qc.clear();
    onDisconnected();
  }

  // A rejected or expired token can't be recovered from by retrying — send the
  // user straight back to the setup form with the error visible.
  const authFailed = isAuthError(tasksQuery.error);

  useEffect(() => {
    if (authFailed) setShowReconnect(true);
  }, [authFailed]);

  useEffect(() => {
    if (selected && tasksQuery.data) {
      const fresh = tasksQuery.data.find(t => t.id === selected.id);
      if (!fresh) setSelected(null);
      else if (fresh !== selected) setSelected(fresh);
    }
  }, [tasksQuery.data, selected]);

  const tasks = tasksQuery.data ?? [];
  const openCount = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
  const reviewCount = tasks.filter(t => t.status === 'to_review').length;
  const suspendedCount = tasks.filter(t => t.status === 'suspended').length;
  // Open todos on live tasks — the same rule the todo view applies, derived here
  // so the tab badge doesn't need a second pass.
  const openTodoCount = tasks
    .filter(t => t.status !== 'completed' && t.status !== 'deleted')
    .reduce((n, t) => n + (t.todos ?? []).filter(td => !td.done).length, 0);

  if (showReconnect) {
    return (
      <SetupScreen
        onConnected={() => { setShowReconnect(false); onReconnected(); }}
        onCancel={authFailed ? undefined : () => setShowReconnect(false)}
      />
    );
  }

  return (
    <div className="min-h-full">
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 flex-wrap">
          <h1 className="text-lg font-bold">mytasks</h1>
          {currentMilestone && (
            <span
              title="Current milestone — tasks targeted at this release must be resolved"
              className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 px-2.5 py-0.5 text-xs font-semibold"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {currentMilestone}
            </span>
          )}
          <span className="hidden sm:inline text-sm text-gray-500">
            {openCount} open
            {reviewCount > 0 && <span className="text-amber-600"> · {reviewCount} to review</span>}
            {suspendedCount > 0 && <span className="text-gray-400"> · {suspendedCount} suspended</span>}
          </span>
          <div className="inline-flex rounded-md ring-1 ring-gray-300 overflow-hidden text-xs">
            <button
              onClick={() => setView('tasks')}
              className={cn('px-2.5 py-1', view === 'tasks' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
            >
              Tasks
            </button>
            <button
              onClick={() => setView('todos')}
              title="Flat list of every open todo across all tasks"
              className={cn('px-2.5 py-1 border-l border-gray-300', view === 'todos' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
            >
              TODOs{openTodoCount > 0 && ` (${openTodoCount})`}
            </button>
          </div>
          <div className="flex-1" />
          <div className="relative order-last w-full sm:order-none sm:w-56">
            <svg
              viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search words, #id, tag…"
              className="w-full rounded border border-gray-300 pl-7 pr-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          {view === 'tasks' && (
            <>
              <button
                onClick={() => setShowFilters(v => !v)}
                aria-expanded={showFilters}
                className={cn(
                  'sm:hidden text-xs rounded ring-1 ring-gray-300 px-2 py-1',
                  (showCompleted || showDeleted) ? 'bg-indigo-50 text-indigo-700 ring-indigo-300' : 'text-gray-600',
                )}
              >
                Filters{(showCompleted || showDeleted) && ' •'}
              </button>
              <div
                className={cn(
                  'items-center gap-3',
                  showFilters ? 'flex w-full sm:w-auto' : 'hidden sm:flex',
                )}
              >
                <label className="text-xs text-gray-600 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={showCompleted}
                    onChange={e => setShowCompleted(e.target.checked)}
                  />
                  completed
                </label>
                <label className="text-xs text-gray-600 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={showDeleted}
                    onChange={e => setShowDeleted(e.target.checked)}
                  />
                  deleted
                </label>
                <span className="sm:hidden text-xs text-gray-500">
                  {openCount} open
                  {reviewCount > 0 && <span className="text-amber-600"> · {reviewCount} to review</span>}
                </span>
              </div>
            </>
          )}
          <SyncBadge isFetching={tasksQuery.isFetching} isError={!!tasksQuery.error} />
          <button
            onClick={() => setShowAdd(true)}
            aria-label="New task"
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-1.5 text-sm"
          >
            +<span className="hidden sm:inline"> New task</span>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            className="text-gray-400 hover:text-gray-700 p-1"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.64.73.82.3.16.63.24.96.24H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-3 sm:p-4 space-y-4">
        {tasksQuery.isLoading && <div className="text-gray-500">Loading…</div>}
        {tasksQuery.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
            {(tasksQuery.error as Error).message}
          </div>
        )}
        {tasksQuery.data && <WeekPanel tasks={tasks} onOpenTask={setSelected} />}

        {view === 'todos' ? (
          <TodoBoard tasks={tasks} onOpenTask={setSelected} search={search} />
        ) : tasksQuery.data ? (
          <TaskTable
            tasks={tasks}
            onRowClick={setSelected}
            onToggleStar={t => patchTask.mutate({ id: t.id, data: { starred: !t.starred } })}
            showCompleted={showCompleted}
            showDeleted={showDeleted}
            search={search}
          />
        ) : null}

        <section className="bg-white rounded-lg ring-1 ring-gray-200 p-4 max-w-2xl">
          <InboxComposer placeholder='e.g. "Add a high-priority task to follow up on the conformance statement."' />
        </section>
      </main>

      {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} onOpenTask={setSelected} />}
      {showAdd && <AddTaskDialog onClose={() => setShowAdd(false)} />}
      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          onChangeConnection={() => { setShowSettings(false); setShowReconnect(true); }}
          onSignOut={() => { setShowSettings(false); signOut(); }}
        />
      )}
    </div>
  );
}
