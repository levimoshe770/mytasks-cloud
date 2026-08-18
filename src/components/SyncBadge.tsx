import { getSyncState } from '../github/store';
import { cn } from '../util/cn';

interface Props {
  isFetching: boolean;
  isError: boolean;
}

function ago(ts: number | null): string {
  if (!ts) return 'never';
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// With no server there is nothing to "be up"; what matters is whether this
// device has reached GitHub recently, so say that plainly instead of a spinner.
export function SyncBadge({ isFetching, isError }: Props) {
  const { lastSyncAt, stale } = getSyncState();
  const label = isFetching ? 'Syncing…' : stale ? 'Offline' : `Synced ${ago(lastSyncAt)}`;
  return (
    <span
      title={
        stale
          ? 'Showing the last copy saved on this device. Changes cannot be saved until GitHub is reachable.'
          : `Last successful read from GitHub: ${lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString() : 'never'}`
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ring-1 ring-inset',
        isError || stale
          ? 'bg-amber-50 text-amber-800 ring-amber-200'
          : 'bg-gray-50 text-gray-500 ring-gray-200',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          isFetching ? 'bg-indigo-400 animate-pulse' : stale || isError ? 'bg-amber-500' : 'bg-green-500',
        )}
      />
      {label}
    </span>
  );
}
