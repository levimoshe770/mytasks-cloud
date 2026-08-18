import { useMemo } from 'react';
import { Task, TodoView } from '../api';
import { usePatchTodo, useTodos } from '../hooks/useTasks';
import { cn } from '../util/cn';
import { StatusIcon } from './StatusIcon';
import { TodoDue } from './TodoList';

interface Props {
  // Full task list, used to resolve a row back to its task when opening it.
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  search: string;
}

// Flat "what do I actually do next" view: every open todo across all tasks,
// grouped under its parent task, in the order the server returns (soonest due,
// then task priority).
export function TodoBoard({ tasks, onOpenTask, search }: Props) {
  const todosQuery = useTodos();
  const patch = usePatchTodo();

  const groups = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = (todosQuery.data ?? []).filter(r => matchesSearch(r, terms));
    // Keep the server's row order; group by task on first appearance.
    const byTask = new Map<number, { row: TodoView; items: TodoView[] }>();
    for (const r of rows) {
      const g = byTask.get(r.taskId);
      if (g) g.items.push(r);
      else byTask.set(r.taskId, { row: r, items: [r] });
    }
    return [...byTask.values()];
  }, [todosQuery.data, search]);

  if (todosQuery.isLoading) return <div className="text-gray-500">Loading…</div>;
  if (todosQuery.error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
        {(todosQuery.error as Error).message}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg ring-1 ring-gray-200 bg-white px-3 py-6 text-center text-gray-400">
        {search.trim() ? `No todos match "${search.trim()}".` : 'No open todos. Add one from any task.'}
      </div>
    );
  }

  return (
    <div className="rounded-lg ring-1 ring-gray-200 bg-white divide-y divide-gray-100">
      {groups.map(({ row, items }) => {
        const task = tasks.find(t => t.id === row.taskId);
        return (
          <div key={row.taskId} className="px-3 py-2.5">
            <button
              type="button"
              onClick={() => task && onOpenTask(task)}
              disabled={!task}
              className="flex items-center gap-2 text-left w-full hover:text-indigo-700"
            >
              <StatusIcon status={row.taskStatus} />
              <span className="font-mono text-xs text-gray-400">#{row.taskId}</span>
              <span className="text-sm font-medium truncate">{row.taskSubject}</span>
              {row.milestone && (
                <span className="text-[11px] rounded bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 px-1.5 py-0.5 whitespace-nowrap">
                  {row.milestone}
                </span>
              )}
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {items.length} todo{items.length === 1 ? '' : 's'}
              </span>
            </button>
            <ul className="mt-1 ml-6 space-y-0.5">
              {items.map(r => (
                <li key={r.todo.id} className="flex items-start gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={r.todo.done}
                    onChange={() => patch.mutate({
                      id: r.taskId,
                      todoId: r.todo.id,
                      data: { done: !r.todo.done },
                    })}
                    className="mt-0.5 h-4 w-4 accent-indigo-600 cursor-pointer"
                  />
                  <span className={cn('flex-1 min-w-0 text-sm', r.todo.done && 'text-gray-400 line-through')}>
                    {r.todo.text}
                  </span>
                  {r.todo.due && <TodoDue due={r.todo.due} done={r.todo.done} />}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Same AND-of-terms rule as the task table: a term matches the todo text, the
// task subject, or the task id (bare or "#123").
function matchesSearch(row: TodoView, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${row.todo.text} ${row.taskSubject}`.toLowerCase();
  return terms.every(term => {
    const idTerm = term.replace(/^#/, '');
    if (/^\d+$/.test(idTerm) && String(row.taskId) === idTerm) return true;
    return haystack.includes(term);
  });
}
