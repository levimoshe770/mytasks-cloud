import { describe, expect, it } from 'vitest';
import { wouldCreateCycle, addTodo, findTodo, NotFoundError } from './tasks';
import { formatIssueRef, parseIssueInput, parseSourceRef } from './github/issues';
import { Task, TasksStore } from './types';

function task(id: number, parentId: number | null = null): Task {
  return {
    id,
    subject: `t${id}`,
    description: '',
    status: 'pending',
    priority: 'medium',
    starred: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    deadline: null,
    source: 'manual',
    sourceRef: null,
    milestone: null,
    parentId,
    tags: [],
    remindedAt: null,
    notes: [],
  };
}

function store(tasks: Task[]): TasksStore {
  return { version: 1, nextId: tasks.length + 1, tasks };
}

describe('wouldCreateCycle', () => {
  it('rejects making a task its own parent', () => {
    expect(wouldCreateCycle(store([task(1)]), 1, 1)).toBe(true);
  });

  it('rejects re-parenting under a descendant', () => {
    // 1 -> 2 -> 3; making 1 a child of 3 closes the loop.
    const s = store([task(1), task(2, 1), task(3, 2)]);
    expect(wouldCreateCycle(s, 1, 3)).toBe(true);
  });

  it('allows an unrelated parent', () => {
    const s = store([task(1), task(2, 1), task(3)]);
    expect(wouldCreateCycle(s, 3, 2)).toBe(false);
  });

  it('terminates on data that already contains a cycle', () => {
    const s = store([task(1, 2), task(2, 1), task(3)]);
    expect(wouldCreateCycle(s, 3, 1)).toBe(false);
  });
});

describe('addTodo', () => {
  it('never reuses an id after a delete, so a stale click cannot hit the wrong item', () => {
    const t = task(1);
    addTodo(t, 'a');
    addTodo(t, 'b');
    t.todos = t.todos!.filter(x => x.id !== 2); // delete the second
    const third = addTodo(t, 'c');
    expect(third.id).toBe(3);
  });

  it('seeds nextTodoId from existing ids on a legacy task that lacks the counter', () => {
    const t = task(1);
    t.todos = [{ id: 7, text: 'old', done: false, due: null, createdAt: '', doneAt: null }];
    expect(addTodo(t, 'new').id).toBe(8);
  });

  it('throws NotFoundError for a missing todo', () => {
    expect(() => findTodo(task(1), 99)).toThrow(NotFoundError);
  });
});

describe('issue references', () => {
  it('parses the forms you would actually paste', () => {
    const expected = { owner: 'levimoshe770', repo: 'mytasks-app', number: 42 };
    expect(parseIssueInput('levimoshe770/mytasks-app#42', '')).toEqual(expected);
    expect(parseIssueInput('https://github.com/levimoshe770/mytasks-app/issues/42', '')).toEqual(expected);
    expect(parseIssueInput('https://github.com/levimoshe770/mytasks-app/pull/42', '')).toEqual(expected);
    expect(parseIssueInput('42', 'levimoshe770/mytasks-app')).toEqual(expected);
    expect(parseIssueInput('#42', 'levimoshe770/mytasks-app')).toEqual(expected);
  });

  it('explains itself when a bare number has no default repo', () => {
    expect(() => parseIssueInput('42', '')).toThrow(/set a default issue repo/);
  });

  it('rejects nonsense rather than guessing', () => {
    expect(() => parseIssueInput('not an issue', 'o/r')).toThrow(/Could not read/);
  });

  it('round-trips through the stored sourceRef', () => {
    const ref = parseIssueInput('o/r#7', '');
    expect(parseSourceRef(formatIssueRef(ref))).toEqual(ref);
    expect(parseSourceRef(null)).toBeNull();
    expect(parseSourceRef('bug#123')).toBeNull(); // legacy Bugzilla ref, not a GitHub one
  });
});
