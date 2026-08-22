import { describe, expect, it } from 'vitest';
import {
  buildWeekPlan,
  chargeOf,
  DEFAULT_WEEK_CONFIG,
  projectedFinish,
  remainingHours,
  weekLabel,
  weekStart,
  WeekConfig,
} from './week';
import { Task, Todo } from './types';

// Wednesday 26 August 2026, midday local. The week containing it runs
// Sun 23 Aug → Sat 29 Aug.
const NOW = new Date(2026, 7, 26, 12, 0, 0);

const CFG: WeekConfig = { ownerTag: 'moshe', weeklyCapacityHours: 6, sessionCapacityHours: 7 };

let seq = 0;
function task(over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: seq,
    subject: `t${seq}`,
    description: '',
    status: 'pending',
    priority: 'medium',
    starred: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    deadline: null,
    source: 'workplan',
    sourceRef: null,
    milestone: null,
    parentId: null,
    tags: ['moshe'],
    remindedAt: null,
    notes: [],
    ...over,
  };
}

function todos(done: number, total: number): Todo[] {
  return Array.from({ length: total }, (_, i) => ({
    id: i + 1,
    text: `todo ${i + 1}`,
    done: i < done,
    due: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    doneAt: i < done ? '2026-01-02T00:00:00.000Z' : null,
  }));
}

/** Local-midday ISO, so a date lands on the intended day in any timezone. */
function on(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

describe('weekStart', () => {
  it('snaps to the Sunday of the containing week', () => {
    const s = weekStart(NOW);
    expect(s.getDay()).toBe(0);
    expect(s.getDate()).toBe(23);
    expect(s.getHours()).toBe(0);
  });

  it('shifts whole weeks and stays on Sunday', () => {
    expect(weekStart(NOW, 1).getDate()).toBe(30);
    expect(weekStart(NOW, -1).getDate()).toBe(16);
    expect(weekStart(NOW, 3).getDay()).toBe(0);
  });

  it('labels the week inclusively', () => {
    expect(weekLabel(weekStart(NOW))).toMatch(/23.*29/);
  });
});

describe('remainingHours', () => {
  it('is the estimate when there are no todos', () => {
    expect(remainingHours(task({ estimateHours: 4 }))).toBe(4);
  });

  it('discounts by the fraction of todos checked off', () => {
    expect(remainingHours(task({ estimateHours: 8, todos: todos(2, 4) }))).toBe(4);
  });

  it('is null without a usable estimate', () => {
    expect(remainingHours(task())).toBeNull();
    expect(remainingHours(task({ estimateHours: 0 }))).toBeNull();
  });
});

describe('chargeOf', () => {
  it('separates the viewer, joint work and everyone else', () => {
    expect(chargeOf(task({ tags: ['phase-1', 'moshe'] }), CFG)).toBe('solo');
    expect(chargeOf(task({ tags: ['phase-1', 'both'] }), CFG)).toBe('joint');
    expect(chargeOf(task({ tags: ['phase-1', 'daniela'] }), CFG)).toBe('other');
  });
});

describe('buildWeekPlan — lanes', () => {
  it('puts a passed deadline in the late lane with a day count', () => {
    const plan = buildWeekPlan([task({ deadline: on(2026, 8, 19) })], CFG, 0, NOW);
    expect(plan.late).toHaveLength(1);
    expect(plan.late[0].daysLate).toBe(7);
  });

  it('puts a deadline inside the window in the due lane', () => {
    const plan = buildWeekPlan([task({ deadline: on(2026, 8, 27) })], CFG, 0, NOW);
    expect(plan.due).toHaveLength(1);
    expect(plan.due[0].dueLabel).toMatch(/27/);
  });

  it('ignores a task with no deadline — nothing pulls it into a week', () => {
    const plan = buildWeekPlan([task({ estimateHours: 20 })], CFG, 0, NOW);
    expect(plan.due).toHaveLength(0);
    expect(plan.start_).toHaveLength(0);
    expect(plan.solo.planned).toBe(0);
  });

  it('excludes deleted tasks entirely', () => {
    const plan = buildWeekPlan(
      [task({ status: 'deleted', deadline: on(2026, 8, 27) })], CFG, 0, NOW);
    expect(plan.due).toHaveLength(0);
  });

  it('collects work finished inside the window', () => {
    const plan = buildWeekPlan([
      task({ status: 'completed', completedAt: on(2026, 8, 24) }),
      task({ status: 'completed', completedAt: on(2026, 8, 10) }),
    ], CFG, 0, NOW);
    expect(plan.doneThisWeek).toHaveLength(1);
  });

  it('drops the late lane when looking at a future week', () => {
    const overdue = task({ deadline: on(2026, 8, 19) });
    expect(buildWeekPlan([overdue], CFG, 0, NOW).late).toHaveLength(1);
    expect(buildWeekPlan([overdue], CFG, 2, NOW).late).toHaveLength(0);
  });
});

describe('buildWeekPlan — "should start"', () => {
  // 18h at 6h/week needs 3 weeks. A deadline ~3 weeks out has no slack left,
  // so the work is owed now even though nothing is due.
  it('pulls in a far deadline once the remaining work fills the weeks left', () => {
    const plan = buildWeekPlan(
      [task({ estimateHours: 18, deadline: on(2026, 9, 16) })], CFG, 0, NOW);
    expect(plan.start_).toHaveLength(1);
    // Pro-rated across the weeks left, not charged in full.
    expect(plan.start_[0].hours).toBeGreaterThan(0);
    expect(plan.start_[0].hours).toBeLessThan(18);
  });

  it('leaves a far deadline alone while there is still slack', () => {
    const plan = buildWeekPlan(
      [task({ estimateHours: 4, deadline: on(2026, 12, 1) })], CFG, 0, NOW);
    expect(plan.start_).toHaveLength(0);
  });

  it('surfaces work while one spare week remains, not once it is already critical', () => {
    // 12h at 6h/week needs 2 weeks; a deadline 3 weeks out leaves 1 week of slack.
    // An early-warning panel that waits for slack to hit zero warns too late.
    const plan = buildWeekPlan(
      [task({ estimateHours: 12, deadline: on(2026, 9, 16) })], CFG, 0, NOW);
    expect(plan.start_).toHaveLength(1);
    expect(plan.start_[0].slack).toBe(1);
  });

  it('falls back to "due within a fortnight and untouched" with no estimate', () => {
    const plan = buildWeekPlan(
      [task({ deadline: on(2026, 9, 4), status: 'pending' })], CFG, 0, NOW);
    expect(plan.start_).toHaveLength(1);
    // No estimate means no hours — it must not skew the capacity bar.
    expect(plan.start_[0].hours).toBe(0);
    expect(plan.solo.planned).toBe(0);
  });

  it('does not nag about an unestimated task already in progress', () => {
    const plan = buildWeekPlan(
      [task({ deadline: on(2026, 9, 4), status: 'in_progress' })], CFG, 0, NOW);
    expect(plan.start_).toHaveLength(0);
  });
});

describe('buildWeekPlan — capacity', () => {
  it('charges due work in full and ongoing work pro-rata', () => {
    const plan = buildWeekPlan([
      task({ estimateHours: 2, deadline: on(2026, 8, 28) }),          // due: all 2h
      task({ estimateHours: 18, deadline: on(2026, 9, 16) }),         // start: 18/3
    ], CFG, 0, NOW);
    expect(plan.solo.planned).toBeCloseTo(8, 1);
    expect(plan.solo.capacity).toBe(6);
    expect(plan.solo.over).toBeCloseTo(2, 1);
  });

  it('keeps joint hours in a separate budget — they are not interchangeable', () => {
    const plan = buildWeekPlan([
      task({ tags: ['both'], estimateHours: 4, deadline: on(2026, 8, 27) }),
      task({ tags: ['moshe'], estimateHours: 3, deadline: on(2026, 8, 27) }),
    ], CFG, 0, NOW);
    expect(plan.solo.planned).toBe(3);
    expect(plan.joint.planned).toBe(4);
    expect(plan.sessions).toHaveLength(1);
    expect(plan.due).toHaveLength(1);
  });

  it("does not charge someone else's task against the viewer", () => {
    const plan = buildWeekPlan(
      [task({ tags: ['daniela'], estimateHours: 8, deadline: on(2026, 8, 27) })], CFG, 0, NOW);
    expect(plan.due).toHaveLength(1);       // still visible
    expect(plan.solo.planned).toBe(0);      // but not his hours
    expect(plan.joint.planned).toBe(0);
  });

  it('reports no overload when the week fits', () => {
    const plan = buildWeekPlan(
      [task({ estimateHours: 3, deadline: on(2026, 8, 28) })], CFG, 0, NOW);
    expect(plan.solo.over).toBe(0);
  });

  it('shrinks planned hours as todos get checked off', () => {
    const before = buildWeekPlan(
      [task({ estimateHours: 8, deadline: on(2026, 8, 28), todos: todos(0, 4) })], CFG, 0, NOW);
    const after = buildWeekPlan(
      [task({ estimateHours: 8, deadline: on(2026, 8, 28), todos: todos(3, 4) })], CFG, 0, NOW);
    expect(before.solo.planned).toBe(8);
    expect(after.solo.planned).toBe(2);
  });
});

describe('buildWeekPlan — alerts', () => {
  it('flags due-this-week work that has not been started', () => {
    const plan = buildWeekPlan([
      task({ deadline: on(2026, 8, 28), status: 'pending', estimateHours: 2 }),
      task({ deadline: on(2026, 8, 28), status: 'in_progress', estimateHours: 2 }),
    ], CFG, 0, NOW);
    expect(plan.atRisk).toHaveLength(1);
    expect(plan.atRisk[0].task.status).toBe('pending');
  });

  it('flags a deadline that cannot be reached at the current rate', () => {
    // 20h left, one week to go, 6h/week available.
    const plan = buildWeekPlan(
      [task({ estimateHours: 20, deadline: on(2026, 9, 1) })], CFG, 0, NOW);
    expect(plan.behind).toHaveLength(1);
    expect(plan.behind[0].requiredRate).toBeGreaterThan(CFG.weeklyCapacityHours);
  });

  it('does not flag a deadline that is reachable', () => {
    const plan = buildWeekPlan(
      [task({ estimateHours: 12, deadline: on(2026, 9, 23) })], CFG, 0, NOW);
    expect(plan.behind).toHaveLength(0);
  });

  it('judges joint work against the session budget, not the solo one', () => {
    // 7h in one week is over the 6h solo capacity but exactly the 7h session one.
    const plan = buildWeekPlan(
      [task({ tags: ['both'], estimateHours: 7, deadline: on(2026, 9, 1) })], CFG, 0, NOW);
    expect(plan.behind).toHaveLength(0);
  });

  it("never measures someone else's task against your capacity", () => {
    // Daniela's 7h recording day in one week would be "behind" if judged against
    // Moshe's 6h — but they are not his hours, and the noise buries his own.
    const plan = buildWeekPlan(
      [task({ tags: ['daniela'], estimateHours: 7, deadline: on(2026, 8, 28) })], CFG, 0, NOW);
    expect(plan.due).toHaveLength(1);
    expect(plan.behind).toHaveLength(0);
    expect(plan.atRisk).toHaveLength(0);
  });

  it('orders behind-rate rows worst first', () => {
    const plan = buildWeekPlan([
      task({ subject: 'bad', estimateHours: 12, deadline: on(2026, 9, 1) }),
      task({ subject: 'worse', estimateHours: 40, deadline: on(2026, 9, 1) }),
    ], CFG, 0, NOW);
    expect(plan.behind.map(r => r.task.subject)).toEqual(['worse', 'bad']);
  });
});

describe('projectedFinish', () => {
  it('turns a rate into a date you can compare against a filming week', () => {
    const plan = buildWeekPlan(
      [task({ estimateHours: 18, deadline: on(2026, 9, 1) })], CFG, 0, NOW);
    const finish = projectedFinish(plan.behind[0], CFG.weeklyCapacityHours, NOW);
    // 18h at 6h/week is three more weeks, i.e. mid-September, not 1 Sep.
    expect(finish!.getTime()).toBeGreaterThan(new Date(on(2026, 9, 1)).getTime());
  });

  it('is null when there is nothing to project from', () => {
    const plan = buildWeekPlan([task({ deadline: on(2026, 8, 27) })], CFG, 0, NOW);
    expect(projectedFinish(plan.due[0], 6, NOW)).toBeNull();
  });
});

describe('defaults', () => {
  it('ships the real capacity as the default, not a round guess', () => {
    expect(DEFAULT_WEEK_CONFIG.weeklyCapacityHours).toBe(6);
  });
});
