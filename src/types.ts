export type Priority = 'low' | 'medium' | 'high' | 'critical';

// `to_review` = an item pulled in from a GitHub issue that has no milestone yet:
// investigate only, no fix committed to. It flips to `pending` (Open) once a
// milestone is set.
export type Status = 'to_review' | 'pending' | 'in_progress' | 'suspended' | 'completed' | 'deleted';

export interface Note {
  ts: string;
  text: string;
}

// A checklist item on a task — text + done, nothing else. Deliberately NOT a
// Task: no id in the global sequence, no status / priority / milestone, no row
// of its own in the table. Use a subtask when the item deserves its own
// lifecycle; use a todo for "the next thing to do here".
export interface Todo {
  id: number;
  text: string;
  done: boolean;
  // Optional own due date, independent of the parent task's deadline. Displayed
  // and sorted on, but never notified.
  due: string | null;
  createdAt: string;
  doneAt: string | null;
}

export interface Task {
  id: number;
  subject: string;
  description: string;
  status: Status;
  priority: Priority;
  starred: boolean;
  createdAt: string;
  completedAt: string | null;
  deadline: string | null | '';
  // 'manual' | 'github' | anything a script writes.
  source: string;
  // For source === 'github': "owner/repo#123". Everything else is free-form.
  sourceRef: string | null;
  // Milestone this task is scheduled for (e.g. "3.0.0"). null when unset —
  // meaning "to be reviewed", not yet committed to a release.
  milestone: string | null;
  // Subtask link: id of the parent task, or null/absent for a top-level task.
  // Cycles are rejected before the write.
  parentId?: number | null;
  tags: string[];
  remindedAt: string | null;
  notes: Note[];
  // Optional so an existing tasks.json needs no migration — every reader must
  // use `task.todos ?? []`.
  todos?: Todo[];
  // Per-task monotonic counter for todo ids. Never reuses an id after a delete,
  // so a stale client can't toggle the wrong item. Absent on legacy tasks;
  // `addTodo` seeds it from the highest existing id.
  nextTodoId?: number;
}

// A row of the cross-task TODO view — a todo plus the bits of its task needed
// to show it standalone.
export interface TodoView {
  taskId: number;
  taskSubject: string;
  taskStatus: Status;
  priority: Priority;
  taskDeadline: string | null;
  milestone: string | null;
  todo: Todo;
}

export interface StoreConfig {
  // The release currently being worked. Tasks whose milestone matches are
  // highlighted as "must be resolved now".
  currentMilestone: string | null;
}

// The whole contents of tasks.json.
export interface TasksStore {
  version: number;
  nextId: number;
  tasks: Task[];
  config?: StoreConfig;
}

export const EMPTY_STORE: TasksStore = {
  version: 1,
  nextId: 1,
  tasks: [],
  config: { currentMilestone: null },
};

export interface Meta {
  currentMilestone: string | null;
}
