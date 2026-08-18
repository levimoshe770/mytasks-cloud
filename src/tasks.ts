import { Note, Task, TasksStore, Todo } from './types';
import { isoNow } from './util/format';

// Pure domain logic over a TasksStore draft. Everything here runs inside
// mutateStore's retry loop, so it must be deterministic and must not touch the
// network or any module state.

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function findTask(store: TasksStore, id: number): Task {
  const t = store.tasks.find(x => x.id === id);
  if (!t) throw new NotFoundError(`Task #${id} not found`);
  return t;
}

export function appendNote(task: Task, text: string): Note {
  const note: Note = { ts: isoNow(), text };
  task.notes = [...(task.notes ?? []), note];
  return note;
}

export function addTodo(task: Task, text: string, due: string | null = null): Todo {
  const existing = task.todos ?? [];
  const highest = existing.reduce((max, t) => Math.max(max, t.id), 0);
  const id = Math.max(task.nextTodoId ?? 1, highest + 1);
  const todo: Todo = { id, text, done: false, due, createdAt: isoNow(), doneAt: null };
  task.todos = [...existing, todo];
  task.nextTodoId = id + 1;
  return todo;
}

export function findTodo(task: Task, todoId: number): Todo {
  const todo = (task.todos ?? []).find(t => t.id === todoId);
  if (!todo) throw new NotFoundError(`Todo #${todoId} not found on task #${task.id}`);
  return todo;
}

// Direct children of a task (tasks whose parentId points at it).
export function childrenOf(store: TasksStore, parentId: number): Task[] {
  return store.tasks.filter(t => t.parentId === parentId);
}

// Would setting `task.parentId = candidateParentId` create a cycle? Walk up from
// the candidate parent following parentId; if we reach `taskId`, it's a cycle.
export function wouldCreateCycle(store: TasksStore, taskId: number, candidateParentId: number): boolean {
  if (taskId === candidateParentId) return true;
  const byId = new Map(store.tasks.map(t => [t.id, t]));
  let cursor: number | null | undefined = candidateParentId;
  const seen = new Set<number>();
  while (cursor != null) {
    if (cursor === taskId) return true;
    if (seen.has(cursor)) break; // pre-existing cycle in data — stop, don't hang
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}
