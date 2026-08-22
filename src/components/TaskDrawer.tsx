import { useEffect, useMemo, useRef, useState } from 'react';
import { Priority, Status, Task } from '../api';
import {
  useAddNote,
  useAttachIssue,
  useCompleteTask,
  useDeleteTask,
  useMergeTask,
  useMeta,
  usePatchTask,
  useTasks,
} from '../hooks/useTasks';
import { cn } from '../util/cn';
import { formatNoteTs, fromLocalInputValue, toLocalInputValue } from '../util/format';
import { issueUrl, parseSourceRef } from '../github/issues';
import { AddTaskDialog } from './AddTaskDialog';
import { InboxComposer } from './InboxComposer';
import { StatusIcon, STATUS_LABEL } from './StatusIcon';
import { isMilestoneSet } from './TaskTable';
import { TodoList } from './TodoList';

interface Props {
  task: Task;
  onClose: () => void;
  // Navigate the drawer to another task (parent / subtask links).
  onOpenTask?: (t: Task) => void;
}

// Ids of `rootId` and all its descendants — the invalid parent choices for
// `rootId` (a task can't be a subtask of itself or of one of its own subtasks).
function selfAndDescendantIds(all: Task[], rootId: number): Set<number> {
  const childrenByParent = new Map<number, Task[]>();
  for (const t of all) {
    if (t.parentId != null) {
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t);
      childrenByParent.set(t.parentId, arr);
    }
  }
  const out = new Set<number>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of childrenByParent.get(id) ?? []) {
      if (!out.has(child.id)) { out.add(child.id); stack.push(child.id); }
    }
  }
  return out;
}

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];
const STATUSES: Status[] = ['to_review', 'pending', 'in_progress', 'suspended', 'completed', 'deleted'];

// Hours as typed. Rejects negatives and junk by returning undefined, which the
// caller reads as "don't save this yet" rather than "clear it".
function parseEstimate(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function TaskDrawer({ task, onClose, onOpenTask }: Props) {
  const [subject, setSubject] = useState(task.subject);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [status, setStatus] = useState<Status>(task.status);
  const [deadlineLocal, setDeadlineLocal] = useState(toLocalInputValue(task.deadline || null));
  const [milestone, setMilestone] = useState(task.milestone ?? '');
  const [parentId, setParentId] = useState<number | null>(task.parentId ?? null);
  const [tagsStr, setTagsStr] = useState(task.tags.join(', '));
  const [estimateStr, setEstimateStr] = useState(
    task.estimateHours == null ? '' : String(task.estimateHours));
  const [noteText, setNoteText] = useState('');
  const [showAddSub, setShowAddSub] = useState(false);

  const meta = useMeta();
  const patch = usePatchTask();
  const addNote = useAddNote();
  const complete = useCompleteTask();
  const purge = useDeleteTask();
  const tasksQuery = useTasks();
  const allTasks = tasksQuery.data ?? [];

  const linkedIssue = parseSourceRef(task.sourceRef);
  const parent = parentId != null ? allTasks.find(t => t.id === parentId) ?? null : null;
  const children = useMemo(
    () => allTasks.filter(t => t.parentId === task.id),
    [allTasks, task.id],
  );
  const parentCandidates = useMemo(() => {
    const blocked = selfAndDescendantIds(allTasks, task.id);
    return allTasks.filter(t => t.status !== 'deleted' && !blocked.has(t.id));
  }, [allTasks, task.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Sync local form state to the task whenever the task changes (id-change OR an
  // external mutation like "Link issue" or a write from your other device).
  // For each field: only overwrite local if the user hasn't locally edited it
  // since the last sync. Detection: compare `curr` (via functional setState) to
  // the previously-synced value. If they match, the user didn't edit -> safe to
  // take the new value. If they differ, keep their unsaved typing. An id change
  // always force-syncs (the drawer is reused).
  const lastSyncedRef = useRef<Task>(task);
  useEffect(() => {
    const prev = lastSyncedRef.current;
    const idChanged = prev.id !== task.id;

    function syncField<T>(prevVal: T, newVal: T, set: React.Dispatch<React.SetStateAction<T>>) {
      set(curr => (idChanged || curr === prevVal) ? newVal : curr);
    }

    syncField(prev.subject, task.subject, setSubject);
    syncField(prev.description, task.description, setDescription);
    syncField(prev.priority, task.priority, setPriority);
    syncField(prev.status, task.status, setStatus);
    const prevDl = toLocalInputValue(prev.deadline || null);
    const newDl = toLocalInputValue(task.deadline || null);
    syncField(prevDl, newDl, setDeadlineLocal);
    syncField(prev.milestone ?? '', task.milestone ?? '', setMilestone);
    syncField(prev.parentId ?? null, task.parentId ?? null, setParentId);
    const prevTags = prev.tags.join(', ');
    const newTags = task.tags.join(', ');
    syncField(prevTags, newTags, setTagsStr);
    const prevEst = prev.estimateHours == null ? '' : String(prev.estimateHours);
    const newEst = task.estimateHours == null ? '' : String(task.estimateHours);
    syncField(prevEst, newEst, setEstimateStr);

    lastSyncedRef.current = task;
  }, [task]);

  // Debounced auto-save: 700ms after the last keystroke / select change. Only
  // fires when local state actually differs from the stored task. The delay also
  // keeps a burst of typing from turning into a burst of commits.
  useEffect(() => {
    const taskTags = task.tags.join(', ');
    const taskDeadlineLocal = toLocalInputValue(task.deadline || null);
    const taskEstimate = task.estimateHours == null ? '' : String(task.estimateHours);
    // Blank clears the estimate; anything unparseable is treated as "not yet
    // typed" and simply never saved, so a half-entered "1." can't wipe a value.
    const estimateValue = parseEstimate(estimateStr);
    const estimateOk = estimateStr.trim() === '' || estimateValue != null;
    const dirty =
      subject !== task.subject ||
      description !== task.description ||
      priority !== task.priority ||
      status !== task.status ||
      taskDeadlineLocal !== deadlineLocal ||
      milestone !== (task.milestone ?? '') ||
      parentId !== (task.parentId ?? null) ||
      taskTags !== tagsStr ||
      (estimateOk && taskEstimate !== estimateStr.trim());
    if (!dirty) return;
    const handle = setTimeout(() => {
      patch.mutate({
        id: task.id,
        data: {
          subject,
          description,
          priority,
          status,
          deadline: fromLocalInputValue(deadlineLocal),
          milestone: milestone.trim() || null,
          parentId,
          tags: tagsStr.split(',').map(s => s.trim()).filter(Boolean),
          ...(estimateOk ? { estimateHours: estimateValue } : {}),
        },
      });
    }, 700);
    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, description, priority, status, deadlineLocal, milestone, parentId, tagsStr, estimateStr, task]);

  async function appendNote() {
    if (!noteText.trim()) return;
    await addNote.mutateAsync({ id: task.id, text: noteText.trim() });
    setNoteText('');
  }

  return (
    <div className="fixed inset-0 z-30">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b flex items-center justify-between px-5 py-3 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => patch.mutate({ id: task.id, data: { starred: !task.starred } })}
              disabled={patch.isPending}
              title={task.starred ? 'Unstar' : 'Star'}
              className={cn(
                'text-2xl leading-none px-1 transition-colors',
                task.starred ? 'text-amber-400 hover:text-amber-500' : 'text-gray-300 hover:text-gray-500',
              )}
            >
              {task.starred ? '★' : '☆'}
            </button>
            <div className="min-w-0">
              <div className="text-xs text-gray-500 font-mono flex items-center gap-2">
                <span>#{task.id}</span>
                {linkedIssue && (
                  <a
                    href={issueUrl(linkedIssue)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 hover:text-indigo-800 hover:underline"
                  >
                    {task.sourceRef} ↗
                  </a>
                )}
              </div>
              <div className="text-lg font-semibold line-clamp-1">{task.subject}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task.status !== 'completed' && task.status !== 'deleted' && (
              <button
                onClick={() => complete.mutate(task.id)}
                disabled={complete.isPending}
                className="text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded px-3 py-1.5"
              >
                {complete.isPending ? '...' : 'Complete'}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-2">×</button>
          </div>
        </div>
        {complete.error && (
          <div className="bg-red-50 border-b border-red-200 text-red-700 px-5 py-2 text-sm">
            Complete failed: {(complete.error as Error).message}
          </div>
        )}

        <div className="p-5 space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Edit</h2>
              <span className="text-xs h-4">
                {patch.isPending && <span className="text-gray-500">Saving…</span>}
                {!patch.isPending && patch.isError && (
                  <span className="text-red-600">Save failed: {(patch.error as Error).message}</span>
                )}
              </span>
            </div>

            <Field label="Subject">
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm"
              />
            </Field>

            <Field label="Description">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
                className="w-full border rounded px-3 py-1.5 text-sm font-mono"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority">
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value as Priority)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <div className="flex items-center gap-2">
                  <StatusIcon status={status} />
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as Status)}
                    className="w-full border rounded px-2 py-1.5 text-sm"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
              </Field>
            </div>

            <Field label="Deadline">
              <input
                type="datetime-local"
                value={deadlineLocal}
                onChange={e => setDeadlineLocal(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm"
              />
            </Field>

            <Field label="Estimate (hours)">
              <input
                value={estimateStr}
                onChange={e => setEstimateStr(e.target.value)}
                inputMode="decimal"
                placeholder="blank = not counted in the week's capacity"
                className="w-full border rounded px-3 py-1.5 text-sm"
              />
            </Field>

            <Field label="Milestone">
              <input
                value={milestone}
                onChange={e => setMilestone(e.target.value)}
                placeholder="unset (— investigate only)"
                className="w-full border rounded px-3 py-1.5 text-sm"
              />
              {isMilestoneSet(milestone) ? (
                <span
                  className={cn(
                    'mt-1 inline-block text-xs',
                    meta.data?.currentMilestone && milestone.trim() === meta.data.currentMilestone
                      ? 'text-rose-600 font-medium'
                      : 'text-amber-700',
                  )}
                >
                  {meta.data?.currentMilestone && milestone.trim() === meta.data.currentMilestone
                    ? 'Scheduled for the current milestone — must be resolved.'
                    : 'Scheduled — must be resolved (future milestone).'}
                </span>
              ) : (
                <span className="mt-1 inline-block text-xs text-gray-400">
                  No milestone — to be reviewed / investigated only.
                </span>
              )}
            </Field>

            <Field label="Subtask of (parent task)">
              <select
                value={parentId ?? ''}
                onChange={e => setParentId(e.target.value ? Number(e.target.value) : null)}
                className="w-full border rounded px-2 py-1.5 text-sm"
              >
                <option value="">— none (top-level task)</option>
                {parentId != null && !parentCandidates.some(t => t.id === parentId) && parent && (
                  // Keep the current parent selectable even if it's filtered out
                  // of candidates (e.g. it became completed/deleted).
                  <option value={parentId}>#{parent.id} — {parent.subject}</option>
                )}
                {parentCandidates.map(t => (
                  <option key={t.id} value={t.id}>#{t.id} — {t.subject}</option>
                ))}
              </select>
              {parent && onOpenTask && (
                <button
                  type="button"
                  onClick={() => onOpenTask(parent)}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                >
                  ↳ open parent #{parent.id}: {parent.subject}
                </button>
              )}
            </Field>

            <Field label="Tags (comma-separated)">
              <input
                value={tagsStr}
                onChange={e => setTagsStr(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm"
              />
            </Field>
          </section>

          <TodoList task={task} />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                Subtasks {children.length > 0 && (
                  <span className="text-gray-400 normal-case font-normal">
                    ({children.filter(c => c.status === 'completed').length}/{children.length} done)
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => setShowAddSub(true)}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded px-2.5 py-1"
              >
                + Add subtask
              </button>
            </div>
            {children.length === 0 ? (
              <div className="text-sm text-gray-400 italic">No subtasks.</div>
            ) : (
              <ul className="space-y-1">
                {children.map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask?.(c)}
                      disabled={!onOpenTask}
                      className={cn(
                        'w-full flex items-center gap-2 text-left rounded px-2 py-1.5 text-sm hover:bg-indigo-50',
                        c.status === 'completed' && 'text-gray-400',
                        c.status === 'deleted' && 'text-gray-300 italic',
                      )}
                    >
                      <StatusIcon status={c.status} />
                      <span className="font-mono text-xs text-gray-400">#{c.id}</span>
                      <span className={cn('flex-1 min-w-0 truncate', c.status === 'completed' && 'line-through')}>
                        {c.subject}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
              Notes ({task.notes?.length ?? 0})
            </h2>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {(task.notes ?? []).map((n, i) => (
                <div key={i} className="border-l-2 border-indigo-200 pl-3 py-1">
                  <div className="text-xs text-gray-500">{formatNoteTs(n.ts)}</div>
                  <div className="text-sm whitespace-pre-wrap">{n.text}</div>
                </div>
              ))}
              {(task.notes ?? []).length === 0 && (
                <div className="text-sm text-gray-400 italic">No notes yet.</div>
              )}
            </div>
            <div className="space-y-2">
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Append a note..."
                rows={2}
                className="w-full border rounded px-3 py-1.5 text-sm"
              />
              <button
                onClick={appendNote}
                disabled={addNote.isPending || !noteText.trim()}
                className="bg-gray-700 hover:bg-gray-800 disabled:bg-gray-400 text-white rounded px-3 py-1 text-sm"
              >
                {addNote.isPending ? '...' : 'Append note'}
              </button>
            </div>
          </section>

          <section className="border-t pt-5">
            <LinkIssuePanel task={task} />
          </section>

          <section className="border-t pt-5">
            <InboxComposer taskId={task.id} />
          </section>

          <section className="border-t pt-5">
            <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide mb-3">Danger zone</h2>
            {task.status !== 'deleted' ? (
              <button
                onClick={async () => {
                  await patch.mutateAsync({ id: task.id, data: { status: 'deleted' } });
                  onClose();
                }}
                disabled={patch.isPending}
                className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded px-4 py-1.5 text-sm"
              >
                {patch.isPending ? 'Deleting...' : 'Delete (recoverable)'}
              </button>
            ) : (
              <button
                onClick={async () => {
                  if (!window.confirm(`Permanently remove task #${task.id} and all its notes? This cannot be undone.`)) return;
                  await purge.mutateAsync(task.id);
                  onClose();
                }}
                disabled={purge.isPending}
                className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded px-4 py-1.5 text-sm"
              >
                {purge.isPending ? 'Removing...' : 'Permanently remove'}
              </button>
            )}
            {purge.error && (
              <div className="text-xs text-red-600 mt-2">{(purge.error as Error).message}</div>
            )}
          </section>
        </div>
      </div>
      {showAddSub && (
        <AddTaskDialog defaultParentId={task.id} onClose={() => setShowAddSub(false)} />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 block mb-1">{label}</span>
      {children}
    </label>
  );
}

// Replaces the old "Attach bug" panel. Linking pulls the issue title (and its
// milestone, if any) over the task; merging is unchanged and works on any task.
function LinkIssuePanel({ task }: { task: Task }) {
  const [issueInput, setIssueInput] = useState('');
  const [mergeSource, setMergeSource] = useState('');
  const attach = useAttachIssue();
  const merge = useMergeTask();
  const tasksQuery = useTasks();

  const mergeCandidates = useMemo(() => {
    const all = tasksQuery.data ?? [];
    return all.filter(t => t.status !== 'deleted' && t.id !== task.id);
  }, [tasksQuery.data, task.id]);

  async function linkIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!issueInput.trim()) return;
    try {
      await attach.mutateAsync({ id: task.id, input: issueInput.trim() });
      setIssueInput('');
    } catch { /* error rendered below */ }
  }

  async function mergeTask(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(mergeSource, 10);
    if (Number.isNaN(n) || n <= 0) return;
    try {
      await merge.mutateAsync({ targetId: task.id, sourceId: n });
      setMergeSource('');
    } catch { /* error rendered below */ }
  }

  const error = (attach.error ?? merge.error) as Error | undefined;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Link GitHub issue</h2>

      <form onSubmit={linkIssue} className="space-y-1">
        <div className="flex gap-2 items-center">
          <input
            value={issueInput}
            onChange={e => setIssueInput(e.target.value)}
            placeholder="owner/repo#123, an issue URL, or just 123"
            className="border rounded px-3 py-1.5 text-sm flex-1 min-w-0"
          />
          <button
            type="submit"
            disabled={attach.isPending || !issueInput.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded px-3 py-1.5 text-sm whitespace-nowrap"
          >
            {attach.isPending ? 'Linking…' : 'Link issue'}
          </button>
        </div>
        <span className="text-xs text-gray-500">
          Renames the task to the issue title and copies its milestone across.
          A bare number uses the default issue repo from Settings.
        </span>
      </form>

      <form onSubmit={mergeTask} className="flex gap-2 items-center">
        <select
          value={mergeSource}
          onChange={e => setMergeSource(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm flex-1 min-w-0"
        >
          <option value="">Merge another task into this one...</option>
          {mergeCandidates.map(t => (
            <option key={t.id} value={t.id}>#{t.id} — {t.subject}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={merge.isPending || !mergeSource}
          className="bg-gray-700 hover:bg-gray-800 disabled:bg-gray-400 text-white rounded px-3 py-1.5 text-sm whitespace-nowrap"
        >
          Merge
        </button>
      </form>

      {mergeCandidates.length === 0 && (
        <div className="text-xs text-gray-400">No other tasks to merge.</div>
      )}

      {error && <div className="text-xs text-red-600">{error.message}</div>}
    </div>
  );
}
