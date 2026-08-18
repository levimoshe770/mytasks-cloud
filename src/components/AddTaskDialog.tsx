import { useMemo, useState } from 'react';
import { Priority } from '../api';
import { useCreateTask, useTasks } from '../hooks/useTasks';
import { fromLocalInputValue } from '../util/format';

interface Props {
  onClose: () => void;
  // When set, the new task is created as a subtask of this task id (the parent
  // selector is preset to it). Used by the "+ Add subtask" action in the drawer.
  defaultParentId?: number | null;
}

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];

export function AddTaskDialog({ onClose, defaultParentId = null }: Props) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [tagsStr, setTagsStr] = useState('');
  const [parentId, setParentId] = useState<number | null>(defaultParentId);
  const create = useCreateTask();
  const tasksQuery = useTasks();

  const parentCandidates = useMemo(
    () => (tasksQuery.data ?? []).filter(t => t.status !== 'deleted'),
    [tasksQuery.data],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) return;
    await create.mutateAsync({
      subject: subject.trim(),
      description: description.trim(),
      priority,
      deadline: fromLocalInputValue(deadlineLocal),
      tags: tagsStr.split(',').map(s => s.trim()).filter(Boolean),
      parentId,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3"
      >
        <h2 className="text-lg font-semibold">
          {parentId != null ? `New subtask of #${parentId}` : 'New task'}
        </h2>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Subject"
          autoFocus
          className="w-full border rounded px-3 py-2 text-sm"
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={3}
          className="w-full border rounded px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <select
            value={priority}
            onChange={e => setPriority(e.target.value as Priority)}
            className="border rounded px-2 py-2 text-sm"
          >
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            type="datetime-local"
            value={deadlineLocal}
            onChange={e => setDeadlineLocal(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>
        <input
          value={tagsStr}
          onChange={e => setTagsStr(e.target.value)}
          placeholder="Tags (comma-separated)"
          className="w-full border rounded px-3 py-2 text-sm"
        />
        <label className="block">
          <span className="text-xs text-gray-500 block mb-1">Subtask of (optional)</span>
          <select
            value={parentId ?? ''}
            onChange={e => setParentId(e.target.value ? Number(e.target.value) : null)}
            className="w-full border rounded px-2 py-2 text-sm"
          >
            <option value="">— none (top-level task)</option>
            {parentCandidates.map(t => (
              <option key={t.id} value={t.id}>#{t.id} — {t.subject}</option>
            ))}
          </select>
        </label>
        {create.error && <div className="text-sm text-red-600">{(create.error as Error).message}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm rounded hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending || !subject.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded px-4 py-1.5 text-sm"
          >
            {create.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
