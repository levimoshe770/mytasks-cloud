import { useState } from 'react';
import { verifyConnection } from '../api';
import { clearSettings, DEFAULT_SETTINGS, getSettings, saveSettings, Settings } from '../settings';
import { resetStore } from '../github/store';

interface Props {
  onConnected: () => void;
  // Rendered as a dialog over the app when changing an existing connection.
  onCancel?: () => void;
}

// Accepts "owner/repo", a full repo URL, or a git remote.
function parseRepoSlug(input: string): { owner: string; repo: string } | null {
  const raw = input.trim().replace(/\.git$/, '');
  const url = /github\.com[/:]([\w.-]+)\/([\w.-]+)/i.exec(raw);
  if (url) return { owner: url[1]!, repo: url[2]! };
  const slug = /^([\w.-]+)\/([\w.-]+)$/.exec(raw);
  if (slug) return { owner: slug[1]!, repo: slug[2]! };
  return null;
}

export function SetupScreen({ onConnected, onCancel }: Props) {
  const existing = getSettings();
  const [token, setTokenValue] = useState(existing?.token ?? '');
  const [repoInput, setRepoInput] = useState(existing ? `${existing.owner}/${existing.repo}` : '');
  const [branch, setBranch] = useState(existing?.branch ?? DEFAULT_SETTINGS.branch);
  const [path, setPath] = useState(existing?.path ?? DEFAULT_SETTINGS.path);
  const [issueRepo, setIssueRepo] = useState(existing?.issueRepo ?? DEFAULT_SETTINGS.issueRepo);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const slug = parseRepoSlug(repoInput);
    if (!slug) {
      setError('Enter the data repo as owner/repo, e.g. levimoshe770/mytasks-data-2.');
      return;
    }
    if (!token.trim()) {
      setError('Paste a GitHub personal access token.');
      return;
    }

    const next: Settings = {
      token: token.trim(),
      owner: slug.owner,
      repo: slug.repo,
      branch: branch.trim() || 'main',
      path: path.trim() || 'tasks.json',
      issueRepo: issueRepo.trim(),
    };

    setBusy(true);
    setError(null);
    // Save first: every data call reads the token out of settings. On failure
    // the previous connection is restored so a bad edit can't lock you out.
    saveSettings(next);
    resetStore();
    try {
      await verifyConnection();
      onConnected();
    } catch (err) {
      if (existing) saveSettings(existing);
      else clearSettings();
      resetStore();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 sm:p-6">
      <form onSubmit={submit} className="w-full max-w-lg bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold">mytasks</h1>
          <p className="text-sm text-gray-600 mt-1">
            Your tasks live in a private GitHub repo. This device talks to the GitHub
            API directly — there is no server, and the token below is stored only in
            this browser.
          </p>
        </div>

        <label className="block">
          <span className="text-xs text-gray-500 block mb-1">Data repo</span>
          <input
            value={repoInput}
            onChange={e => setRepoInput(e.target.value)}
            autoFocus
            placeholder="owner/repo"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full border rounded px-3 py-2 text-sm font-mono"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-500 block mb-1">
            Fine-grained personal access token
          </span>
          <input
            type="password"
            value={token}
            onChange={e => setTokenValue(e.target.value)}
            placeholder="github_pat_..."
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full border rounded px-3 py-2 text-sm font-mono"
          />
          <span className="text-xs text-gray-500 mt-1 block">
            Needs <strong>Contents: read and write</strong> on the data repo, and{' '}
            <strong>Issues: read</strong> on any repo whose issues you want to link.
          </span>
        </label>

        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="text-xs text-indigo-600 hover:text-indigo-800"
        >
          {showAdvanced ? '− Hide advanced' : '+ Advanced (branch, file path, default issue repo)'}
        </button>

        {showAdvanced && (
          <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-3">
            <label className="block">
              <span className="text-xs text-gray-500 block mb-1">Branch</span>
              <input
                value={branch}
                onChange={e => setBranch(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 block mb-1">File path</span>
              <input
                value={path}
                onChange={e => setPath(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 block mb-1">
                Default issue repo (lets you type a bare issue number)
              </span>
              <input
                value={issueRepo}
                onChange={e => setIssueRepo(e.target.value)}
                placeholder="owner/repo"
                className="w-full border rounded px-3 py-1.5 text-sm font-mono"
              />
            </label>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded hover:bg-gray-100"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={busy}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded px-4 py-2 text-sm"
          >
            {busy ? 'Checking…' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  );
}
