import { Meta, Note, Priority, Task, TodoView } from './types';
import { encodeBase64, gh } from './github/client';
import { mutateStore, readStore } from './github/store';
import {
  fetchIssue,
  formatIssueRef,
  parseIssueInput,
  type GitHubIssue,
} from './github/issues';
import {
  addTodo as addTodoTo,
  appendNote,
  childrenOf,
  findTask,
  findTodo,
  NotFoundError,
  ValidationError,
  wouldCreateCycle,
} from './tasks';
import { requireSettings } from './settings';
import { isoNow } from './util/format';

// Same shape the Express-backed client exposed, so the components above it did
// not have to change: each call now reads or mutates tasks.json through the
// GitHub Contents API instead of hitting /api on localhost.

export { GitHubError, isAuthError } from './github/client';
export type { Meta, Note, Priority, Status, Task, TasksStore, Todo, TodoView } from './types';

export interface CreateTaskInput {
  subject: string;
  description?: string;
  priority?: Priority;
  starred?: boolean;
  deadline?: string | null;
  tags?: string[];
  parentId?: number | null;
  initialNote?: string;
}

export interface PatchTaskInput {
  subject?: string;
  description?: string;
  status?: Task['status'];
  priority?: Priority;
  starred?: boolean;
  deadline?: string | null;
  completedAt?: string | null;
  milestone?: string | null;
  parentId?: number | null;
  tags?: string[];
}

// --- todos view --------------------------------------------------------------

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// A todo's effective due date: its own if set, else its task's deadline, else
// none (sorted last).
function dueTime(row: TodoView): number {
  const d = row.todo.due || row.taskDeadline;
  if (!d) return Number.POSITIVE_INFINITY;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

interface ListTodosOptions {
  includeDone?: boolean;
  includeClosedTasks?: boolean;
}

// Was GET /api/todos. The ordering used to be the server's job; it is the same
// rule, moved here so every device sorts identically.
function buildTodoViews(tasks: Task[], opts: ListTodosOptions = {}): TodoView[] {
  const rows: TodoView[] = [];
  for (const task of tasks) {
    if (!opts.includeClosedTasks && (task.status === 'completed' || task.status === 'deleted')) continue;
    for (const todo of task.todos ?? []) {
      if (todo.done && !opts.includeDone) continue;
      rows.push({
        taskId: task.id,
        taskSubject: task.subject,
        taskStatus: task.status,
        priority: task.priority,
        taskDeadline: task.deadline || null,
        milestone: task.milestone ?? null,
        todo,
      });
    }
  }

  // Open before done, then soonest due, then task priority, then task/todo id.
  rows.sort((a, b) => {
    if (a.todo.done !== b.todo.done) return a.todo.done ? 1 : -1;
    const ad = dueTime(a), bd = dueTime(b);
    if (ad !== bd) return ad - bd;
    const ap = PRIORITY_RANK[a.priority], bp = PRIORITY_RANK[b.priority];
    if (ap !== bp) return ap - bp;
    if (a.taskId !== b.taskId) return a.taskId - b.taskId;
    return a.todo.id - b.todo.id;
  });
  return rows;
}

// --- connection --------------------------------------------------------------

export interface ConnectionCheck {
  login: string;
  repoFullName: string;
  storeExists: boolean;
  taskCount: number;
}

// Used by the setup screen: proves the token works, the repo is reachable, and
// reports whether tasks.json is already there.
export async function verifyConnection(): Promise<ConnectionCheck> {
  const s = requireSettings();
  const user = await gh<{ login: string }>('/user');
  const repo = await gh<{ full_name: string }>(`/repos/${s.owner}/${s.repo}`);
  const store = await readStore();
  return {
    login: user.login,
    repoFullName: repo.full_name,
    storeExists: store.tasks.length > 0 || store.nextId > 1,
    taskCount: store.tasks.length,
  };
}

// --- the API -----------------------------------------------------------------

export const api = {
  listTasks: async (): Promise<Task[]> => {
    const store = await readStore();
    return store.tasks;
  },

  listTodos: async (opts: ListTodosOptions = {}): Promise<TodoView[]> => {
    const store = await readStore();
    return buildTodoViews(store.tasks, opts);
  },

  meta: async (): Promise<Meta> => {
    const store = await readStore();
    return { currentMilestone: store.config?.currentMilestone ?? null };
  },

  setCurrentMilestone: (value: string | null): Promise<Meta> =>
    mutateStore('mytasks: set current milestone', draft => {
      draft.config = { ...(draft.config ?? { currentMilestone: null }), currentMilestone: value };
      return { currentMilestone: value };
    }),

  createTask: (data: CreateTaskInput): Promise<Task> =>
    mutateStore('mytasks: create task', draft => {
      if (data.parentId != null) findTask(draft, data.parentId);
      const id = draft.nextId;
      draft.nextId = id + 1;
      const created: Task = {
        id,
        subject: data.subject,
        description: data.description ?? '',
        status: 'pending',
        priority: data.priority ?? 'medium',
        starred: data.starred ?? false,
        createdAt: isoNow(),
        completedAt: null,
        deadline: data.deadline ?? null,
        source: 'manual',
        sourceRef: null,
        milestone: null,
        parentId: data.parentId ?? null,
        tags: data.tags ?? [],
        remindedAt: null,
        notes: data.initialNote ? [{ ts: isoNow(), text: data.initialNote }] : [],
      };
      draft.tasks.push(created);
      return created;
    }),

  patchTask: (id: number, data: PatchTaskInput): Promise<Task> =>
    mutateStore(`mytasks: update task #${id}`, draft => {
      const t = findTask(draft, id);
      if (data.parentId != null) {
        findTask(draft, data.parentId); // parent must exist
        if (wouldCreateCycle(draft, id, data.parentId)) {
          throw new ValidationError(
            `Cannot make task #${id} a subtask of #${data.parentId}: that would create a cycle`,
          );
        }
      }
      Object.assign(t, data);
      // Invariant: completedAt is set iff status === 'completed'. An explicit
      // completedAt in the patch wins; otherwise auto-fill / auto-clear.
      if (data.status === 'completed' && !t.completedAt) {
        t.completedAt = isoNow();
      } else if (data.status && data.status !== 'completed' && data.completedAt === undefined) {
        t.completedAt = null;
      }
      return t;
    }),

  completeTask: (id: number): Promise<Task> =>
    mutateStore(`mytasks: complete #${id}`, draft => {
      const t = findTask(draft, id);
      t.status = 'completed';
      t.completedAt = isoNow();
      return t;
    }),

  deleteTask: (id: number): Promise<void> =>
    mutateStore(`mytasks: purge task #${id}`, draft => {
      const idx = draft.tasks.findIndex(t => t.id === id);
      if (idx === -1) throw new NotFoundError(`Task #${id} not found`);
      // Detach any subtasks so they don't dangle on a purged parent.
      for (const child of childrenOf(draft, id)) child.parentId = null;
      draft.tasks.splice(idx, 1);
    }),

  addNote: (id: number, text: string): Promise<Note> =>
    mutateStore(`mytasks: note on #${id}`, draft => appendNote(findTask(draft, id), text)),

  // The three todo mutations return the updated Task so the cached list can be
  // patched in place, exactly as the REST versions did.
  addTodo: (id: number, text: string, due?: string | null): Promise<Task> =>
    mutateStore(`mytasks: add todo to #${id}`, draft => {
      const t = findTask(draft, id);
      addTodoTo(t, text, due ?? null);
      return t;
    }),

  patchTodo: (
    id: number,
    todoId: number,
    data: { text?: string; done?: boolean; due?: string | null },
  ): Promise<Task> =>
    mutateStore(`mytasks: update todo ${todoId} on #${id}`, draft => {
      const t = findTask(draft, id);
      const todo = findTodo(t, todoId);
      if (data.text !== undefined) todo.text = data.text;
      if (data.due !== undefined) todo.due = data.due;
      // Invariant: doneAt is set iff done === true.
      if (data.done !== undefined && data.done !== todo.done) {
        todo.done = data.done;
        todo.doneAt = data.done ? isoNow() : null;
      }
      return t;
    }),

  deleteTodo: (id: number, todoId: number): Promise<Task> =>
    mutateStore(`mytasks: remove todo ${todoId} from #${id}`, draft => {
      const t = findTask(draft, id);
      findTodo(t, todoId); // 404 if it isn't there
      t.todos = (t.todos ?? []).filter(x => x.id !== todoId);
      return t;
    }),

  // Replaces attach-bug. The issue is fetched *before* the mutation because
  // mutateStore may replay its callback on a conflict and must not re-request.
  attachIssue: async (id: number, input: string): Promise<Task> => {
    const { issueRepo } = requireSettings();
    const ref = parseIssueInput(input, issueRepo);
    const issue: GitHubIssue = await fetchIssue(ref);
    const slug = formatIssueRef(ref);

    return mutateStore(`mytasks: link ${slug} -> task #${id}`, draft => {
      const target = findTask(draft, id);
      const oldSubject = target.subject;
      target.subject = `${slug}: ${issue.title}`;
      target.source = 'github';
      target.sourceRef = slug;
      // A GitHub milestone means the same thing the Bugzilla target milestone
      // did: scheduled for a release, so it must actually be resolved.
      if (issue.milestone) target.milestone = issue.milestone;
      appendNote(
        target,
        `Linked to ${slug} (${issue.state}${issue.isPullRequest ? ', pull request' : ''}). ` +
          `Previous subject: "${oldSubject}".`,
      );
      return target;
    });
  },

  // Absorb another task into this one: the source is soft-deleted, its notes are
  // merged in chronologically and its tags unioned, so no history is stranded.
  mergeTask: (targetId: number, sourceId: number): Promise<Task> =>
    mutateStore(`mytasks: merge #${sourceId} -> #${targetId}`, draft => {
      if (targetId === sourceId) throw new ValidationError('Cannot merge a task into itself');
      const target = findTask(draft, targetId);
      const source = findTask(draft, sourceId);

      target.tags = Array.from(new Set([...target.tags, ...source.tags]));
      const carried = (source.notes ?? []).map(n => ({
        ts: n.ts,
        text: `(from #${sourceId}) ${n.text}`,
      }));
      target.notes = [...(target.notes ?? []), ...carried].sort((a, b) => a.ts.localeCompare(b.ts));
      appendNote(
        target,
        `Merged in task #${sourceId} ("${source.subject}"): its notes were copied here and it was soft-deleted.`,
      );
      source.status = 'deleted';
      appendNote(source, `Merged into task #${targetId}; notes copied there.`);
      return target;
    }),

  // Drops a prompt into inbox/ in the data repo for a scheduled Claude routine
  // to pick up. A separate file per prompt, so it never contends with the
  // tasks.json blob and needs no SHA.
  sendInbox: async (prompt: string, taskId?: number | null): Promise<{ filename: string; ts: string }> => {
    const s = requireSettings();
    const ts = isoNow();
    const filename = `${ts.replace(/:/g, '-')}.md`;
    const body = `---\nts: ${ts}\ntaskId: ${taskId ?? ''}\n---\n\n${prompt}\n`;
    await gh(`/repos/${s.owner}/${s.repo}/contents/inbox/${filename}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `mytasks: inbox ${filename}`,
        content: encodeBase64(body),
        branch: s.branch,
      }),
    });
    return { filename, ts };
  },
};
