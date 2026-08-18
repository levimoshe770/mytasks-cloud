import { useMemo, useState } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Priority, Status, Task } from '../api';
import { cn } from '../util/cn';
import { formatDeadline } from '../util/format';
import { useMeta } from '../hooks/useTasks';
import { issueUrl, parseSourceRef } from '../github/issues';
import { StatusIcon, STATUS_LABEL } from './StatusIcon';

// A milestone counts as "set" (scheduled → must resolve) when it's a real value.
// Linking an issue copies GitHub's milestone title across and leaves it null
// when the issue has none, so a truthy value is enough; the "---" and
// "unspecified" guards are there for rows imported from the old tracker.
export function isMilestoneSet(m: string | null | undefined): m is string {
  return !!m && m.trim() !== '' && m.trim() !== '---' && !/^unspecified$/i.test(m.trim());
}

function TruncatedText({ text, max = 80 }: { text: string; max?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  if (text.length <= max) return <span className="whitespace-pre-wrap">{text}</span>;
  return (
    <span className="whitespace-pre-wrap">
      {expanded ? text : text.slice(0, max).trimEnd() + '…'}
      <button
        onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
        className="ml-1 align-middle inline-flex items-center justify-center w-5 h-4 rounded text-[10px] leading-none text-gray-400 hover:text-gray-700 hover:bg-gray-200"
        title={expanded ? 'Collapse' : 'Show all'}
      >
        {expanded ? '×' : '⋯'}
      </button>
    </span>
  );
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const PRIORITY_CLASS: Record<Priority, string> = {
  critical: 'bg-red-100 text-red-800 ring-red-200',
  high: 'bg-orange-100 text-orange-800 ring-orange-200',
  medium: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
  low: 'bg-slate-100 text-slate-700 ring-slate-200',
};

// Status tier for sorting: actionable tasks first, then to-be-reviewed (bug
// awaiting a milestone — investigate only, no fix yet), then suspended (parked,
// waiting on something), then completed, then deleted.
function statusTier(s: Status): number {
  switch (s) {
    case 'to_review': return 1;
    case 'suspended': return 2;
    case 'completed': return 3;
    case 'deleted': return 4;
    default: return 0; // pending, in_progress
  }
}

// Small target badge marking a scheduled (milestone-set) issue task that must be
// resolved. Rose when it targets the current release; amber for a future one.
function MilestoneBadge({ milestone, current }: { milestone: string; current: string | null }) {
  const isCurrent = !!current && milestone === current;
  return (
    <span
      title={isCurrent
        ? `Scheduled for the current milestone (${milestone}) — must be resolved`
        : `Scheduled for milestone ${milestone}`}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap align-middle',
        isCurrent
          ? 'bg-rose-100 text-rose-700 ring-rose-200'
          : 'bg-amber-100 text-amber-800 ring-amber-200',
      )}
    >
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      {milestone}
    </span>
  );
}

// Composite sort:
//  1. Status tier: actionable → suspended → completed → deleted
//  2. Starred first (within a tier)
//  3. Among open tasks: those with a deadline before those without
//  4. With deadline: deadline asc, priority asc (critical first) as tiebreak
//  5. Without deadline: priority asc (critical first)
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aTier = statusTier(a.status);
    const bTier = statusTier(b.status);
    if (aTier !== bTier) return aTier - bTier;

    const aStar = a.starred ? 0 : 1;
    const bStar = b.starred ? 0 : 1;
    if (aStar !== bStar) return aStar - bStar;

    const aHasDl = a.deadline ? 0 : 1;
    const bHasDl = b.deadline ? 0 : 1;
    if (aHasDl !== bHasDl) return aHasDl - bHasDl;

    if (a.deadline && b.deadline) {
      const at = new Date(a.deadline).getTime();
      const bt = new Date(b.deadline).getTime();
      if (at !== bt) return at - bt;
    }
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}

// A task matches the search if every whitespace-separated term matches (AND).
// A term matches against the id (bare number or "#123"), any tag, the subject,
// description, any note's text, or any todo's text — so the one box covers
// words, tags, and id.
function matchesSearch(task: Task, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [
    task.subject,
    task.description,
    ...task.tags,
    ...task.notes.map(n => n.text),
    ...(task.todos ?? []).map(t => t.text),
  ].join(' ').toLowerCase();
  return terms.every(term => {
    const idTerm = term.replace(/^#/, '');
    if (/^\d+$/.test(idTerm) && String(task.id) === idTerm) return true;
    return haystack.includes(term);
  });
}

interface Props {
  tasks: Task[];
  onRowClick: (task: Task) => void;
  onToggleStar: (task: Task) => void;
  showCompleted: boolean;
  showDeleted: boolean;
  search: string;
}

export function TaskTable({ tasks, onRowClick, onToggleStar, showCompleted, showDeleted, search }: Props) {
  const meta = useMeta();
  const currentMilestone = meta.data?.currentMilestone ?? null;

  const data = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = tasks.filter(t => {
      if (t.status === 'deleted') return showDeleted;
      if (t.status === 'completed') return showCompleted;
      return true;
    }).filter(t => matchesSearch(t, terms));
    return sortTasks(filtered);
  }, [tasks, showCompleted, showDeleted, search]);

  // Subtask relationships across the full (unfiltered) list so the badges are
  // accurate even when a parent or child is filtered out of the visible rows.
  const { childCountById, subjectById } = useMemo(() => {
    const childCountById = new Map<number, number>();
    const subjectById = new Map<number, string>();
    for (const t of tasks) {
      subjectById.set(t.id, t.subject);
      if (t.parentId != null && t.status !== 'deleted') {
        childCountById.set(t.parentId, (childCountById.get(t.parentId) ?? 0) + 1);
      }
    }
    return { childCountById, subjectById };
  }, [tasks]);

  const columns = useMemo<ColumnDef<Task>[]>(() => [
    {
      id: 'star',
      header: '',
      cell: info => {
        const t = info.row.original;
        return (
          <button
            onClick={e => { e.stopPropagation(); onToggleStar(t); }}
            className={cn(
              'text-lg leading-none transition-colors',
              t.starred ? 'text-amber-400 hover:text-amber-500' : 'text-gray-300 hover:text-gray-500',
            )}
            title={t.starred ? 'Unstar' : 'Star'}
          >
            {t.starred ? '★' : '☆'}
          </button>
        );
      },
      size: 36,
    },
    {
      accessorKey: 'id',
      header: '#',
      cell: info => <span className="font-mono text-xs text-gray-500">#{info.getValue<number>()}</span>,
      size: 56,
    },
    {
      accessorKey: 'priority',
      header: 'Priority',
      cell: info => {
        const v = info.getValue<Priority>();
        return (
          <span className={cn(
            'inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
            PRIORITY_CLASS[v] ?? PRIORITY_CLASS.medium,
          )}>{v}</span>
        );
      },
      size: 100,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: info => (
        <div className="flex justify-center">
          <StatusIcon status={info.getValue<Status>()} />
        </div>
      ),
      size: 64,
    },
    {
      accessorKey: 'subject',
      header: 'Subject',
      cell: info => {
        const row = info.row.original;
        const showMilestone = row.source === 'github' && isMilestoneSet(row.milestone);
        const issueRef = parseSourceRef(row.sourceRef);
        const childCount = childCountById.get(row.id) ?? 0;
        const parentSubject = row.parentId != null ? subjectById.get(row.parentId) : undefined;
        return (
          <div className="max-w-xl">
            {row.parentId != null && (
              <div
                className="text-[11px] text-indigo-600 mb-0.5 truncate"
                title={parentSubject ? `Subtask of #${row.parentId}: ${parentSubject}` : `Subtask of #${row.parentId}`}
              >
                ↳ subtask of #{row.parentId}{parentSubject ? ` · ${parentSubject}` : ''}
              </div>
            )}
            <div className="font-medium flex items-center gap-2 flex-wrap">
              <span>{row.subject}</span>
              {issueRef && (
                // Straight through to the issue. stopPropagation so the click
                // doesn't also open the drawer behind the new tab.
                <a
                  href={issueUrl(issueRef)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  title={`Open ${row.sourceRef} on GitHub`}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset bg-slate-100 text-slate-700 ring-slate-300 hover:bg-slate-200 whitespace-nowrap align-middle"
                >
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                  #{issueRef.number}
                </a>
              )}
              {showMilestone && <MilestoneBadge milestone={row.milestone!} current={currentMilestone} />}
              {(() => {
                const todos = row.todos ?? [];
                if (todos.length === 0) return null;
                const done = todos.filter(t => t.done).length;
                const allDone = done === todos.length;
                return (
                  <span
                    title={`${done} of ${todos.length} todo${todos.length === 1 ? '' : 's'} done`}
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap align-middle',
                      allDone
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : 'bg-gray-100 text-gray-600 ring-gray-300',
                    )}
                  >
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 6h16M4 12h16M4 18h9" />
                    </svg>
                    {done}/{todos.length}
                  </span>
                );
              })()}
              {childCount > 0 && (
                <span
                  title={`${childCount} subtask${childCount === 1 ? '' : 's'}`}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset bg-indigo-50 text-indigo-700 ring-indigo-200 whitespace-nowrap align-middle"
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 5h10M4 5v9a3 3 0 0 0 3 3h9M9 19h11M20 19l-3-3M20 19l-3 3" />
                  </svg>
                  {childCount}
                </span>
              )}
            </div>
            {row.description && (
              <div className="text-xs text-gray-500 mt-0.5">
                <TruncatedText text={row.description} max={100} />
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'deadline',
      header: 'Due',
      cell: info => {
        const v = info.getValue<string | null>();
        if (!v) return '';
        const overdue = new Date(v).getTime() < Date.now();
        return (
          <span className={cn('text-xs', overdue ? 'text-red-600 font-medium' : 'text-gray-600')}>
            {formatDeadline(v)}
          </span>
        );
      },
      size: 200,
    },
    {
      accessorKey: 'tags',
      header: 'Tags',
      cell: info => (
        <div className="flex flex-wrap gap-1">
          {info.getValue<string[]>().map(tag => (
            <span key={tag} className="text-xs bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">
              {tag}
            </span>
          ))}
        </div>
      ),
    },
    {
      id: 'latestNote',
      header: 'Latest note',
      accessorFn: row => row.notes?.[row.notes.length - 1]?.text ?? '',
      cell: info => (
        <div className="text-xs text-gray-500 max-w-md">
          <TruncatedText text={info.getValue<string>()} max={80} />
        </div>
      ),
    },
  ], [onToggleStar, currentMilestone, childCountById, subjectById]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase tracking-wide">
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id}>
              {hg.headers.map(h => (
                <th
                  key={h.id}
                  className="px-3 py-2 font-medium"
                  style={{ width: h.column.getSize() }}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-gray-100">
          {table.getRowModel().rows.map(row => {
            const t = row.original;
            const open = t.status === 'pending' || t.status === 'in_progress';
            const mustResolve = t.source === 'github' && open && isMilestoneSet(t.milestone);
            const mustResolveNow = mustResolve && !!currentMilestone && t.milestone === currentMilestone;
            return (
            <tr
              key={row.id}
              onClick={() => onRowClick(t)}
              className={cn(
                'cursor-pointer hover:bg-indigo-50',
                t.starred && 'bg-amber-50/40',
                // Highlight scheduled bug tasks that must be resolved (left accent).
                mustResolveNow && 'bg-rose-50/50 border-l-4 border-rose-400',
                mustResolve && !mustResolveNow && 'bg-amber-50/40 border-l-4 border-amber-300',
                t.status === 'to_review' && 'bg-sky-50/40',
                t.status === 'suspended' && 'text-gray-500 bg-slate-50/60',
                t.status === 'completed' && 'text-gray-400 hover:bg-gray-50',
                t.status === 'deleted' && 'text-gray-300 italic',
              )}
            >
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="px-3 py-2 align-top">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
            );
          })}
          {table.getRowModel().rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-gray-400">
                {search.trim() ? `No tasks match "${search.trim()}".` : 'No tasks.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
