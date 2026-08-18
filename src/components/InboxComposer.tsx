import { useState } from 'react';
import { useSendInbox } from '../hooks/useTasks';

interface Props {
  taskId?: number | null;
  placeholder?: string;
}

export function InboxComposer({ taskId, placeholder }: Props) {
  const [text, setText] = useState('');
  const [lastSent, setLastSent] = useState<string | null>(null);
  const send = useSendInbox();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const result = await send.mutateAsync({ prompt: text.trim(), taskId });
      setLastSent(result.filename);
      setText('');
    } catch { /* error shown below via send.error */ }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">Send prompt to Claude</label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={placeholder ?? 'e.g. "Note on this task that I escalated to Einat today."'}
        rows={3}
        className="w-full border rounded px-3 py-2 text-sm"
      />
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">
          {taskId ? `Will reference task #${taskId}` : 'No task context'}
        </span>
        <button
          type="submit"
          disabled={send.isPending || !text.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded px-3 py-1.5 text-sm"
        >
          {send.isPending ? 'Sending...' : 'Send'}
        </button>
      </div>
      {send.error && <div className="text-xs text-red-600">{(send.error as Error).message}</div>}
      {lastSent && !send.isPending && (
        <div className="text-xs text-green-600">Queued: {lastSent}</div>
      )}
    </form>
  );
}
