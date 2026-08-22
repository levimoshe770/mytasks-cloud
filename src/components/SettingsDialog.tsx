import { useState } from 'react';
import { useMeta, useSetCurrentMilestone, useSetPlanning } from '../hooks/useTasks';
import { DEFAULT_WEEK_CONFIG } from '../week';
import { getSettings } from '../settings';

interface Props {
  onClose: () => void;
  onChangeConnection: () => void;
  onSignOut: () => void;
}

export function SettingsDialog({ onClose, onChangeConnection, onSignOut }: Props) {
  const settings = getSettings();
  const meta = useMeta();
  const setMilestone = useSetCurrentMilestone();
  const setPlanning = useSetPlanning();
  const [value, setValue] = useState(meta.data?.currentMilestone ?? '');
  const [ownerTag, setOwnerTag] = useState(
    meta.data?.ownerTag ?? DEFAULT_WEEK_CONFIG.ownerTag);
  const [weekly, setWeekly] = useState(
    String(meta.data?.weeklyCapacityHours ?? DEFAULT_WEEK_CONFIG.weeklyCapacityHours));
  const [session, setSession] = useState(
    String(meta.data?.sessionCapacityHours ?? DEFAULT_WEEK_CONFIG.sessionCapacityHours));

  // An unparseable or negative number would silently make the capacity bar lie,
  // so it is rejected rather than coerced to zero.
  function num(v: string): number | null {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const weeklyNum = num(weekly);
  const sessionNum = num(session);

  async function savePlanning(e: React.FormEvent) {
    e.preventDefault();
    if (weeklyNum == null || sessionNum == null) return;
    await setPlanning.mutateAsync({
      ownerTag: ownerTag.trim() || null,
      weeklyCapacityHours: weeklyNum,
      sessionCapacityHours: sessionNum,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await setMilestone.mutateAsync(value.trim() || null);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-5">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-1">×</button>
        </div>

        <section className="space-y-1">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide">Connected to</h3>
          <div className="text-sm font-mono">
            {settings ? `${settings.owner}/${settings.repo}` : '—'}
          </div>
          <div className="text-xs text-gray-500">
            {settings ? `${settings.path} on ${settings.branch}` : ''}
            {settings?.issueRepo && ` · issues default to ${settings.issueRepo}`}
          </div>
        </section>

        <form onSubmit={savePlanning} className="space-y-3">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide">Weekly planning</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500 block mb-1">Solo hours / week</span>
              <input
                value={weekly}
                onChange={e => setWeekly(e.target.value)}
                inputMode="decimal"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 block mb-1">Session hours / week</span>
              <input
                value={session}
                onChange={e => setSession(e.target.value)}
                inputMode="decimal"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-gray-500 block mb-1">My owner tag</span>
            <input
              value={ownerTag}
              onChange={e => setOwnerTag(e.target.value)}
              placeholder="e.g. moshe"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-gray-500">
            Tasks tagged with your owner tag count against solo hours; tasks tagged{' '}
            <code>both</code> count against session hours. The two are budgeted separately
            because they are not interchangeable. Anyone else's tasks are shown but never
            charged to you.
          </p>
          {(weeklyNum == null || sessionNum == null) && (
            <p className="text-xs text-rose-600">Hours must be a number of zero or more.</p>
          )}
          <button
            type="submit"
            disabled={setPlanning.isPending || weeklyNum == null || sessionNum == null}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded px-3 py-1.5 text-sm"
          >
            {setPlanning.isPending ? 'Saving…' : 'Save planning'}
          </button>
          {setPlanning.isError && (
            <p className="text-xs text-rose-600">{(setPlanning.error as Error).message}</p>
          )}
        </form>

        <form onSubmit={save} className="space-y-2">
          <label className="block">
            <span className="text-xs text-gray-500 uppercase tracking-wide block mb-1">
              Current milestone
            </span>
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="e.g. 3.0.0 — leave blank for none"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-gray-500">
            Tasks scheduled for this milestone are highlighted as "must be resolved now".
            Stored in tasks.json, so every device sees the same value.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={setMilestone.isPending || value.trim() === (meta.data?.currentMilestone ?? '')}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded px-3 py-1.5 text-sm"
            >
              {setMilestone.isPending ? 'Saving…' : 'Save'}
            </button>
            {setMilestone.isError && (
              <span className="text-xs text-red-600">{(setMilestone.error as Error).message}</span>
            )}
          </div>
        </form>

        <section className="border-t pt-4 flex flex-wrap gap-2">
          <button
            onClick={onChangeConnection}
            className="text-sm rounded px-3 py-1.5 ring-1 ring-gray-300 hover:bg-gray-50"
          >
            Change repo / token
          </button>
          <button
            onClick={onSignOut}
            className="text-sm rounded px-3 py-1.5 text-red-700 ring-1 ring-red-200 hover:bg-red-50"
          >
            Sign out of this device
          </button>
        </section>
      </div>
    </div>
  );
}
