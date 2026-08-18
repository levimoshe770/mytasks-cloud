import { useState } from 'react';
import { Task, Todo } from '../api';
import { useAddTodo, useDeleteTodo, usePatchTodo } from '../hooks/useTasks';
import { cn } from '../util/cn';
import { formatDeadline, fromLocalInputValue, toLocalInputValue } from '../util/format';

// Checklist section for a single task, shown in the drawer. Every toggle is an
// immediate mutation — deliberately outside the drawer's debounced auto-save,
// which only tracks the task's own scalar fields.
export function TodoList({ task }: { task: Task }) {
  const todos = task.todos ?? [];
  const doneCount = todos.filter(t => t.done).length;

  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  const add = useAddTodo();
  const patch = usePatchTodo();
  const remove = useDeleteTodo();
  const error = (add.error ?? patch.error ?? remove.error) as Error | undefined;

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const text = newText.trim();
    if (!text) return;
    await add.mutateAsync({ id: task.id, text });
    setNewText('');
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
          TODO {todos.length > 0 && (
            <span className="text-gray-400 normal-case font-normal">
              ({doneCount}/{todos.length} done)
            </span>
          )}
        </h2>
        <span className="text-xs h-4 text-gray-500">
          {(add.isPending || patch.isPending || remove.isPending) && 'Saving…'}
        </span>
      </div>

      {todos.length === 0 ? (
        <div className="text-sm text-gray-400 italic">
          No todos. Add the next concrete action for this task.
        </div>
      ) : (
        <ul className="space-y-1">
          {todos.map(todo => (
            <li key={todo.id}>
              {editingId === todo.id ? (
                <TodoEditor
                  todo={todo}
                  onCancel={() => setEditingId(null)}
                  onSave={async data => {
                    await patch.mutateAsync({ id: task.id, todoId: todo.id, data });
                    setEditingId(null);
                  }}
                />
              ) : (
                <TodoRow
                  todo={todo}
                  onToggle={() => patch.mutate({ id: task.id, todoId: todo.id, data: { done: !todo.done } })}
                  onEdit={() => setEditingId(todo.id)}
                  onRemove={() => remove.mutate({ id: task.id, todoId: todo.id })}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submitNew} className="flex gap-2">
        <input
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="+ Add a todo (e.g. complete the SUS and send it for review)"
          className="flex-1 min-w-0 border rounded px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={add.isPending || !newText.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded px-3 py-1.5 text-sm"
        >
          Add
        </button>
      </form>

      {error && <div className="text-xs text-red-600">{error.message}</div>}
    </section>
  );
}

interface RowProps {
  todo: Todo;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function TodoRow({ todo, onToggle, onEdit, onRemove }: RowProps) {
  return (
    <div className="group flex items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
      <input
        type="checkbox"
        checked={todo.done}
        onChange={onToggle}
        className="mt-0.5 h-4 w-4 accent-indigo-600 cursor-pointer"
      />
      <button
        type="button"
        onClick={onEdit}
        title="Edit"
        className={cn(
          'flex-1 min-w-0 text-left text-sm',
          todo.done ? 'text-gray-400 line-through' : 'text-gray-800',
        )}
      >
        {todo.text}
      </button>
      {todo.due && <TodoDue due={todo.due} done={todo.done} />}
      <button
        type="button"
        onClick={onRemove}
        title="Remove todo"
        className="text-gray-300 group-hover:text-gray-500 hover:!text-red-600 text-sm leading-none px-1"
      >
        ×
      </button>
    </div>
  );
}

// A todo's own due date. Purely informational — the deadline sweep and the
// Pushover/toast reminders act on task deadlines only.
export function TodoDue({ due, done }: { due: string; done: boolean }) {
  const overdue = !done && new Date(due).getTime() < Date.now();
  return (
    <span
      title={done ? 'Due date (done)' : 'Todo due date — informational, no reminder is sent'}
      className={cn(
        'text-[11px] whitespace-nowrap rounded px-1.5 py-0.5 ring-1 ring-inset',
        overdue
          ? 'bg-red-50 text-red-700 ring-red-200'
          : 'bg-gray-100 text-gray-600 ring-gray-200',
      )}
    >
      {formatDeadline(due)}
    </span>
  );
}

interface EditorProps {
  todo: Todo;
  onSave: (data: { text: string; due: string | null }) => void | Promise<void>;
  onCancel: () => void;
}

function TodoEditor({ todo, onSave, onCancel }: EditorProps) {
  const [text, setText] = useState(todo.text);
  const [dueLocal, setDueLocal] = useState(toLocalInputValue(todo.due));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onSave({ text: text.trim(), due: fromLocalInputValue(dueLocal) });
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded border border-indigo-200 bg-indigo-50/40 px-2 py-2">
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        autoFocus
        className="w-full border rounded px-2 py-1 text-sm"
      />
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Due (optional)</label>
        <input
          type="datetime-local"
          value={dueLocal}
          onChange={e => setDueLocal(e.target.value)}
          className="border rounded px-2 py-1 text-xs"
        />
        {dueLocal && (
          <button
            type="button"
            onClick={() => setDueLocal('')}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            clear
          </button>
        )}
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 px-2">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!text.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded px-2.5 py-1 text-xs"
        >
          Save
        </button>
      </div>
    </form>
  );
}
