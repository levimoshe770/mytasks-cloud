import { Task } from './types';

// Pure planning logic for the week panel. No React, no network, no module
// state — everything is a function of (tasks, config, offset, now), so the
// whole thing is unit-testable and the UI stays a renderer.
//
// The model this encodes, and the reason it isn't just "tasks due this week":
// almost nothing is ever *due* in the current week, yet the week is still full.
// What fills it is work owed now against a deadline weeks away. So a task earns
// a place in the week when its remaining hours no longer fit in the weeks left
// at the available rate — which is also exactly when it is worth warning about.

export type Lane = 'late' | 'due' | 'start' | 'session';

/** Who a task's hours come out of. Derived from the owner tag. */
export type Charge = 'solo' | 'joint' | 'other';

export interface WeekConfig {
  /** Tag identifying the viewer's own tasks, e.g. "moshe". */
  ownerTag: string;
  /** Solo hours available per week. The scarce one. */
  weeklyCapacityHours: number;
  /** Hours per week spent in joint sessions. Not interchangeable with solo. */
  sessionCapacityHours: number;
}

export const DEFAULT_WEEK_CONFIG: WeekConfig = {
  ownerTag: 'moshe',
  weeklyCapacityHours: 6,
  sessionCapacityHours: 7,
};

export interface WeekRow {
  task: Task;
  lane: Lane;
  charge: Charge;
  /** Hours attributed to *this* week: all of it if due, pro-rata if ongoing. */
  hours: number;
  /** Estimate left after subtracting completed todos. */
  remainingHours: number | null;
  /** Whole weeks between now and the deadline; null when there is no deadline. */
  weeksLeft: number | null;
  /** Hours per week needed from here to hit the deadline. */
  requiredRate: number | null;
  /** Weeks that could be skipped and still land on time. Negative = already too late. */
  slack: number | null;
  daysLate: number | null;
  /** "Wed 26" for a dated row. */
  dueLabel: string | null;
  /** Due inside the window and still untouched. */
  atRisk: boolean;
  /** Required rate exceeds capacity — cannot land on time at this rate. */
  behind: boolean;
}

export interface CapacityLine {
  planned: number;
  capacity: number;
  /** Hours short. 0 when it fits. */
  over: number;
}

export interface WeekPlan {
  start: Date;
  end: Date;
  offset: number;
  label: string;
  isCurrent: boolean;
  late: WeekRow[];
  due: WeekRow[];
  start_: WeekRow[];
  sessions: WeekRow[];
  solo: CapacityLine;
  joint: CapacityLine;
  /** Rows whose deadline is unreachable at the current rate, worst first. */
  behind: WeekRow[];
  atRisk: WeekRow[];
  doneThisWeek: Task[];
}

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Sunday 00:00 local of the week containing `now`, shifted by `offset` weeks. */
export function weekStart(now: Date, offset = 0): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  return d;
}

export function weekEnd(start: Date): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + 7);
  return d; // exclusive
}

export function weekLabel(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const a = start.toLocaleDateString(undefined, opts);
  const b = end.toLocaleDateString(undefined, opts);
  return `${a} – ${b}`;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

export function isLive(t: Task): boolean {
  return t.status !== 'completed' && t.status !== 'deleted';
}

export function chargeOf(t: Task, cfg: WeekConfig): Charge {
  const tags = t.tags ?? [];
  if (tags.includes(cfg.ownerTag)) return 'solo';
  if (tags.includes('both')) return 'joint';
  return 'other';
}

/**
 * Estimate left, discounted by checked-off todos. This is what makes ticking a
 * todo move the capacity bar — progress is visible without a second "hours
 * spent" field to keep up to date.
 */
export function remainingHours(t: Task): number | null {
  const est = t.estimateHours;
  if (est == null || !(est > 0)) return null;
  const todos = t.todos ?? [];
  if (todos.length === 0) return est;
  const done = todos.filter(td => td.done).length;
  return est * (1 - done / todos.length);
}

function deadlineOf(t: Task): Date | null {
  if (!t.deadline) return null;
  const d = new Date(t.deadline);
  return isNaN(d.getTime()) ? null : d;
}

/** Whole weeks from `from` to the deadline, floored at 1 so we never divide by zero. */
function weeksUntil(deadline: Date, from: Date): number {
  return Math.max(1, Math.ceil((deadline.getTime() - from.getTime()) / MS_PER_WEEK));
}

export function buildWeekPlan(
  tasks: Task[],
  cfg: WeekConfig,
  offset: number,
  now: Date,
): WeekPlan {
  const start = weekStart(now, offset);
  const end = weekEnd(start);
  const isCurrent = offset === 0;
  // For the current week, "now" is the honest reference for lateness; for a
  // future week, the week's own start is.
  const from = isCurrent ? now : start;

  const late: WeekRow[] = [];
  const due: WeekRow[] = [];
  const start_: WeekRow[] = [];
  const sessions: WeekRow[] = [];
  const doneThisWeek: Task[] = [];

  for (const task of tasks) {
    if (task.status === 'deleted') continue;

    if (task.status === 'completed') {
      const at = task.completedAt ? new Date(task.completedAt) : null;
      if (at && at >= start && at < end) doneThisWeek.push(task);
      continue;
    }

    const charge = chargeOf(task, cfg);
    const dl = deadlineOf(task);
    const rem = remainingHours(task);

    const weeksLeft = dl ? weeksUntil(dl, from) : null;
    const requiredRate = dl && rem != null ? rem / weeksUntil(dl, from) : null;

    // A task with no deadline never enters the week — it has nothing pulling it
    // in. It stays in the full table where it belongs.
    if (!dl) continue;

    const capacity = charge === 'joint' ? cfg.sessionCapacityHours : cfg.weeklyCapacityHours;
    // Someone else's task is shown but never measured against *your* capacity —
    // telling Moshe that Daniela's recording day needs more hours than he has is
    // noise, and it drowns the warnings that are actually his.
    const behind =
      charge !== 'other' && requiredRate != null && capacity > 0 && requiredRate > capacity;

    let lane: Lane | null = null;
    let hours = 0;
    let daysLate: number | null = null;
    let slack: number | null = null;

    if (dl < start && isCurrent) {
      lane = 'late';
      daysLate = Math.max(0, Math.floor((now.getTime() - dl.getTime()) / MS_PER_DAY));
      hours = rem ?? 0;
    } else if (dl >= start && dl < end) {
      lane = 'due';
      hours = rem ?? 0;
    } else if (dl >= end) {
      // Owed now? Only if the remaining work no longer fits in the weeks left
      // with a week to spare. `slack` is how many weeks could be skipped and
      // still land on time.
      if (rem != null && capacity > 0) {
        const weeksNeeded = Math.ceil(rem / capacity);
        slack = (weeksLeft ?? 0) - weeksNeeded;
        // One spare week or less. Waiting for slack to hit zero would only
        // surface the work once it was already critical, which is precisely the
        // warning that arrives too late to act on.
        if (slack <= 1) {
          lane = 'start';
          hours = rem / (weeksLeft ?? 1);
        }
      } else if (task.status === 'pending' && dl.getTime() - from.getTime() <= 14 * MS_PER_DAY) {
        // No estimate to reason with: fall back to "due within a fortnight and
        // not started yet". Contributes no hours, so it can't skew the bar.
        lane = 'start';
        hours = 0;
      }
    }

    if (!lane) continue;

    const row: WeekRow = {
      task,
      lane,
      charge,
      hours,
      remainingHours: rem,
      weeksLeft,
      requiredRate,
      slack,
      daysLate,
      dueLabel: dayLabel(dl),
      atRisk: charge !== 'other' && lane === 'due' && task.status === 'pending',
      behind,
    };

    // Joint work is shown in its own lane rather than mixed in, because it comes
    // out of a different pocket of time and cannot substitute for solo hours.
    if (charge === 'joint' && lane !== 'late') sessions.push(row);
    else if (lane === 'late') late.push(row);
    else if (lane === 'due') due.push(row);
    else start_.push(row);
  }

  const byUrgency = (a: WeekRow, b: WeekRow) => {
    const ad = a.task.deadline ? new Date(a.task.deadline).getTime() : Infinity;
    const bd = b.task.deadline ? new Date(b.task.deadline).getTime() : Infinity;
    return ad - bd;
  };
  late.sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0));
  due.sort(byUrgency);
  start_.sort(byUrgency);
  sessions.sort(byUrgency);

  const all = [...late, ...due, ...start_, ...sessions];
  const sum = (rows: WeekRow[]) => rows.reduce((n, r) => n + r.hours, 0);
  const soloPlanned = sum(all.filter(r => r.charge === 'solo'));
  const jointPlanned = sum(all.filter(r => r.charge === 'joint'));

  return {
    start,
    end,
    offset,
    label: weekLabel(start),
    isCurrent,
    late,
    due,
    start_,
    sessions,
    solo: line(soloPlanned, cfg.weeklyCapacityHours),
    joint: line(jointPlanned, cfg.sessionCapacityHours),
    behind: all.filter(r => r.behind).sort((a, b) => (b.requiredRate ?? 0) - (a.requiredRate ?? 0)),
    atRisk: all.filter(r => r.atRisk),
    doneThisWeek,
  };
}

function line(planned: number, capacity: number): CapacityLine {
  const p = Math.round(planned * 10) / 10;
  return { planned: p, capacity, over: Math.max(0, Math.round((p - capacity) * 10) / 10) };
}

/**
 * When a task will actually finish if nothing changes — used to turn "you are
 * behind" into something actionable ("finishes 1 Oct, filming is 11 Oct").
 */
export function projectedFinish(row: WeekRow, capacity: number, from: Date): Date | null {
  if (row.remainingHours == null || capacity <= 0) return null;
  const weeks = Math.ceil(row.remainingHours / capacity);
  return new Date(from.getTime() + weeks * MS_PER_WEEK);
}

export function formatHours(h: number): string {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? `${r}h` : `${r.toFixed(1)}h`;
}
