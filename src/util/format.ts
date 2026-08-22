export function formatDeadline(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const ms = d.getTime() - Date.now();
  const hours = ms / 3_600_000;
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (Math.abs(hours) < 48) {
    const rel = hours < 0 ? `${Math.ceil(-hours)}h overdue` : `${Math.floor(hours)}h left`;
    return `${dateStr} ${timeStr} (${rel})`;
  }
  return `${dateStr} ${timeStr}`;
}

// Compact form for the phone card. Every deadline in this tracker is stored at
// the same time of day, so the clock is noise; what matters on a small screen is
// the date, and whether it has already gone.
export function formatDeadlineShort(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (days < 0) return `${date} · ${-days}d late`;
  if (days === 0) return `${date} · today`;
  if (days === 1) return `${date} · tomorrow`;
  if (days <= 7) return `${date} · ${days}d`;
  return date;
}

export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function fromLocalInputValue(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function formatNoteTs(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function isoNow(): string {
  return new Date().toISOString();
}
