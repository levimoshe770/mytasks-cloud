import { Status } from '../api';
import { cn } from '../util/cn';

// Human-facing labels. Note `pending` reads as "Open" — that's how Moshe refers
// to a bug that's scheduled and must be worked, versus "To be reviewed".
export const STATUS_LABEL: Record<Status, string> = {
  to_review: 'To be reviewed',
  pending: 'Open',
  in_progress: 'In progress',
  suspended: 'Suspended',
  completed: 'Completed',
  deleted: 'Deleted',
};

// Feather-style line icons drawn at the current text color. Each status gets its
// own glyph + color so the column reads at a glance without text.
const ICON: Record<Status, { color: string; paths: JSX.Element }> = {
  to_review: {
    // Magnifying glass — investigate first, no fix yet.
    color: 'text-amber-500',
    paths: (
      <>
        <circle cx="10.5" cy="10.5" r="6" />
        <line x1="20" y1="20" x2="15" y2="15" />
      </>
    ),
  },
  pending: {
    // Hollow ring — open / to do.
    color: 'text-sky-500',
    paths: <circle cx="12" cy="12" r="8.5" />,
  },
  in_progress: {
    // Play in a ring — actively being worked.
    color: 'text-indigo-500',
    paths: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <polygon points="10,8.5 16,12 10,15.5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  suspended: {
    // Pause — parked, waiting on something/someone.
    color: 'text-slate-400',
    paths: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <line x1="10" y1="9" x2="10" y2="15" />
        <line x1="14" y1="9" x2="14" y2="15" />
      </>
    ),
  },
  completed: {
    // Check in a ring — done.
    color: 'text-green-600',
    paths: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <polyline points="8,12.5 11,15.5 16,9" />
      </>
    ),
  },
  deleted: {
    // X in a ring — removed.
    color: 'text-gray-400',
    paths: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <line x1="9" y1="9" x2="15" y2="15" />
        <line x1="15" y1="9" x2="9" y2="15" />
      </>
    ),
  },
};

export function StatusIcon({ status, size = 18, className }: { status: Status; size?: number; className?: string }) {
  const meta = ICON[status] ?? ICON.pending;
  const label = STATUS_LABEL[status] ?? status;
  return (
    <span title={label} aria-label={label} role="img" className={cn('inline-flex', meta.color, className)}>
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {meta.paths}
      </svg>
    </span>
  );
}
