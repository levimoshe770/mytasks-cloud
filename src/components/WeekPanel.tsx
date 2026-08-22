import { useMemo, useState } from 'react';
import { Task } from '../api';
import { useCompleteTask, useMeta } from '../hooks/useTasks';
import {
  buildWeekPlan,
  DEFAULT_WEEK_CONFIG,
  formatHours,
  projectedFinish,
  WeekConfig,
  WeekPlan,
  WeekRow,
} from '../week';
import { cn } from '../util/cn';

interface Props {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}

const COLLAPSE_KEY = 'mytasks.week.collapsed.v1';

// The planning strip above the table: what the week actually holds, whether it
// fits, and what is already off the rails. Deliberately a *panel* and not a
// separate page — the whole point is seeing it without going to look for it.
export function WeekPanel({ tasks, onOpenTask }: Props) {
  const [offset, setOffset] = useState(0);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  );
  const meta = useMeta();
  const complete = useCompleteTask();

  const cfg: WeekConfig = useMemo(() => ({
    ownerTag: meta.data?.ownerTag || DEFAULT_WEEK_CONFIG.ownerTag,
    weeklyCapacityHours: meta.data?.weeklyCapacityHours ?? DEFAULT_WEEK_CONFIG.weeklyCapacityHours,
    sessionCapacityHours:
      meta.data?.sessionCapacityHours ?? DEFAULT_WEEK_CONFIG.sessionCapacityHours,
  }), [meta.data]);

  // Recomputed on every task change, which is what makes ticking a todo move
  // the bar immediately rather than after a refetch.
  const plan = useMemo(
    () => buildWeekPlan(tasks, cfg, offset, new Date()),
    [tasks, cfg, offset],
  );

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
  }

  const total = plan.late.length + plan.due.length + plan.start_.length + plan.sessions.length;

  return (
    <section className="bg-white rounded-lg ring-1 ring-gray-200 overflow-hidden">
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b bg-gray-50">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 hover:text-indigo-700"
          aria-expanded={!collapsed}
        >
          <svg
            viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={cn('transition-transform', collapsed && '-rotate-90')}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          {plan.isCurrent ? 'This week' : plan.offset === 1 ? 'Next week' : `Week ${plan.offset > 0 ? '+' : ''}${plan.offset}`}
        </button>

        <span className="text-xs text-gray-500">{plan.label}</span>

        <div className="inline-flex rounded ring-1 ring-gray-300 overflow-hidden text-xs bg-white">
          <button onClick={() => setOffset(o => o - 1)} className="px-2 py-0.5 hover:bg-gray-100" title="Previous week">‹</button>
          <button
            onClick={() => setOffset(0)}
            disabled={plan.isCurrent}
            className={cn('px-2 py-0.5 border-x border-gray-300', plan.isCurrent ? 'text-gray-300' : 'hover:bg-gray-100')}
          >
            today
          </button>
          <button onClick={() => setOffset(o => o + 1)} className="px-2 py-0.5 hover:bg-gray-100" title="Next week">›</button>
        </div>

        {plan.late.length > 0 && <Chip tone="red">{plan.late.length} late</Chip>}
        {plan.atRisk.length > 0 && <Chip tone="amber">{plan.atRisk.length} at risk</Chip>}
        {plan.behind.length > 0 && <Chip tone="red">{plan.behind.length} behind the rate</Chip>}
        {plan.doneThisWeek.length > 0 && <Chip tone="green">{plan.doneThisWeek.length} done</Chip>}
        {total === 0 && plan.late.length === 0 && (
          <span className="text-xs text-gray-400">nothing scheduled</span>
        )}

        <div className="flex-1" />
        <CapacityBar plan={plan} />
      </div>

      {!collapsed && (
        <div className="divide-y divide-gray-100">
          <BehindCallout plan={plan} cfg={cfg} />

          <Lane
            title="Late"
            tone="red"
            rows={plan.late}
            onOpenTask={onOpenTask}
            onComplete={id => complete.mutate(id)}
          />
          <Lane
            title="Due this week"
            tone="gray"
            rows={plan.due}
            onOpenTask={onOpenTask}
            onComplete={id => complete.mutate(id)}
          />
          <Lane
            title="Should be working on"
            tone="indigo"
            hint="Not due yet — but the hours left no longer fit in the weeks left."
            rows={plan.start_}
            onOpenTask={onOpenTask}
            onComplete={id => complete.mutate(id)}
          />
          <Lane
            title="Together"
            tone="violet"
            hint="Joint time, which cannot substitute for solo hours — budgeted separately."
            rows={plan.sessions}
            onOpenTask={onOpenTask}
            onComplete={id => complete.mutate(id)}
          />

          {total === 0 && (
            <p className="px-3 py-6 text-center text-sm text-gray-400">
              Nothing lands in this week. Tasks appear here once they have a deadline.
            </p>
          )}

          {plan.doneThisWeek.length > 0 && (
            <div className="px-3 py-2">
              <h4 className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold mb-1">
                Finished this week
              </h4>
              <ul className="space-y-0.5">
                {plan.doneThisWeek.map(t => (
                  <li key={t.id}>
                    <button
                      onClick={() => onOpenTask(t)}
                      className="text-sm text-gray-400 line-through hover:text-gray-600 text-left"
                    >
                      {t.subject}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Chip({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'gray'; children: React.ReactNode }) {
  const tones = {
    red: 'bg-rose-100 text-rose-700 ring-rose-200',
    amber: 'bg-amber-100 text-amber-800 ring-amber-200',
    green: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    gray: 'bg-gray-100 text-gray-600 ring-gray-200',
  }[tone];
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tones)}>
      {children}
    </span>
  );
}

function CapacityBar({ plan }: { plan: WeekPlan }) {
  const { solo, joint } = plan;
  const pct = solo.capacity > 0 ? Math.min(100, (solo.planned / solo.capacity) * 100) : 0;
  const over = solo.over > 0;
  return (
    <div className="flex items-center gap-2" title="Solo hours planned against your weekly capacity">
      <div className="w-24 h-2 rounded-full bg-gray-200 overflow-hidden">
        <div
          className={cn('h-full rounded-full', over ? 'bg-rose-500' : 'bg-indigo-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('text-xs tabular-nums', over ? 'text-rose-700 font-semibold' : 'text-gray-500')}>
        {formatHours(solo.planned)} / {solo.capacity}h
        {over && ` · ${formatHours(solo.over)} over`}
      </span>
      {joint.planned > 0 && (
        <span className="text-xs text-violet-600 tabular-nums" title="Joint session hours — a separate budget">
          +{formatHours(joint.planned)} together
        </span>
      )}
    </div>
  );
}

// The alert that matters most and is the easiest to miss: not a missed date, but
// a rate that cannot reach one. Says what the date becomes, not just "behind".
function BehindCallout({ plan, cfg }: { plan: WeekPlan; cfg: WeekConfig }) {
  if (plan.behind.length === 0 && plan.solo.over === 0) return null;
  const now = new Date();
  return (
    <div className="px-3 py-2.5 bg-rose-50">
      {plan.solo.over > 0 && (
        <p className="text-sm text-rose-800">
          <strong>This week is {formatHours(plan.solo.over)} over.</strong>{' '}
          {formatHours(plan.solo.planned)} of work against {plan.solo.capacity}h of capacity —
          something moves or something slips.
        </p>
      )}
      {plan.behind.map(row => {
        const cap = row.charge === 'joint' ? cfg.sessionCapacityHours : cfg.weeklyCapacityHours;
        const finish = projectedFinish(row, cap, now);
        return (
          <p key={row.task.id} className="text-sm text-rose-800 mt-1">
            <strong>{row.task.subject}</strong> needs{' '}
            {formatHours(row.requiredRate ?? 0)}/week to hit its deadline; you have {cap}h.
            {finish && (
              <> At this rate it lands{' '}
                <strong>{finish.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</strong>.
              </>
            )}
          </p>
        );
      })}
    </div>
  );
}

interface LaneProps {
  title: string;
  tone: 'red' | 'gray' | 'indigo' | 'violet';
  hint?: string;
  rows: WeekRow[];
  onOpenTask: (t: Task) => void;
  onComplete: (id: number) => void;
}

function Lane({ title, tone, hint, rows, onOpenTask, onComplete }: LaneProps) {
  if (rows.length === 0) return null;
  const heading = {
    red: 'text-rose-700',
    gray: 'text-gray-600',
    indigo: 'text-indigo-700',
    violet: 'text-violet-700',
  }[tone];
  return (
    <div className="px-3 py-2">
      <h4 className={cn('text-[11px] uppercase tracking-wide font-semibold', heading)}>
        {title} <span className="text-gray-400 font-normal">({rows.length})</span>
      </h4>
      {hint && <p className="text-[11px] text-gray-400 mb-1">{hint}</p>}
      <ul className="mt-1 space-y-0.5">
        {rows.map(row => (
          <Row key={row.task.id} row={row} onOpenTask={onOpenTask} onComplete={onComplete} />
        ))}
      </ul>
    </div>
  );
}

function Row({ row, onOpenTask, onComplete }: { row: WeekRow; onOpenTask: (t: Task) => void; onComplete: (id: number) => void }) {
  const t = row.task;
  const todos = t.todos ?? [];
  const done = todos.filter(td => td.done).length;
  return (
    <li className="flex items-start gap-2 py-0.5">
      <input
        type="checkbox"
        checked={false}
        onChange={() => onComplete(t.id)}
        title="Mark done"
        className="mt-1 shrink-0"
      />
      <button
        onClick={() => onOpenTask(t)}
        className="flex-1 min-w-0 text-left group"
      >
        <span className="text-sm text-gray-800 group-hover:text-indigo-700">{t.subject}</span>
        <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
          {row.daysLate != null && row.daysLate > 0 && (
            <b className="text-[11px] text-rose-600">{row.daysLate}d late</b>
          )}
          {row.lane === 'due' && row.dueLabel && (
            <span className="text-[11px] text-gray-500">{row.dueLabel}</span>
          )}
          {row.lane === 'start' && row.weeksLeft != null && (
            <span className="text-[11px] text-gray-400">
              {row.weeksLeft}w left
              {row.slack != null && (
                row.slack <= 0
                  ? <b className="text-rose-600"> · no slack</b>
                  : <span> · {row.slack}w slack</span>
              )}
            </span>
          )}
          {row.atRisk && <span className="text-[11px] text-amber-700 font-medium">not started</span>}
          {row.charge === 'other' && (
            <span className="text-[11px] rounded bg-gray-100 text-gray-500 px-1">not yours</span>
          )}
          {row.hours > 0 && (
            <span className="text-[11px] tabular-nums text-gray-400">{formatHours(row.hours)}</span>
          )}
          {row.remainingHours == null && row.charge !== 'other' && (
            <span className="text-[11px] text-gray-300" title="No estimate — not counted in the capacity bar">
              no estimate
            </span>
          )}
          {todos.length > 0 && (
            <span className="text-[11px] tabular-nums text-gray-400">{done}/{todos.length}</span>
          )}
        </span>
      </button>
    </li>
  );
}
