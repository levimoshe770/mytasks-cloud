import { useState } from 'react';
import { useMeta, useSetCurrentMilestone } from '../hooks/useTasks';
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
  const [value, setValue] = useState(meta.data?.currentMilestone ?? '');

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
