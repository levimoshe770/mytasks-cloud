import { gh, GitHubError } from './client';

// Replaces the old Bugzilla helper. Where that shelled out to a Python script on
// the corporate network, this is one authenticated GET against api.github.com —
// so it works from a phone, and the "VPN required" caveat is gone.

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

export interface GitHubIssue extends IssueRef {
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  milestone: string | null;
  labels: string[];
  // True for a pull request — GitHub serves PRs from the issues endpoint too.
  isPullRequest: boolean;
}

// "owner/repo#123" — the canonical form stored in Task.sourceRef.
export function formatIssueRef(ref: IssueRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

export function issueUrl(ref: IssueRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`;
}

// Turns a stored sourceRef back into a ref, or null if it isn't one.
export function parseSourceRef(sourceRef: string | null | undefined): IssueRef | null {
  if (!sourceRef) return null;
  const m = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(sourceRef.trim());
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, number: parseInt(m[3]!, 10) };
}

// Accepts everything you might reasonably paste:
//   https://github.com/owner/repo/issues/123   (also /pull/123)
//   owner/repo#123   owner/repo/123
//   #123   123        (needs a default repo configured)
export function parseIssueInput(input: string, defaultRepo: string): IssueRef {
  const raw = input.trim();
  if (!raw) throw new Error('Enter an issue reference.');

  const url = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/i.exec(raw);
  if (url) return { owner: url[1]!, repo: url[2]!, number: parseInt(url[3]!, 10) };

  const qualified = /^([\w.-]+)\/([\w.-]+)(?:#|\/)(\d+)$/.exec(raw);
  if (qualified) {
    return { owner: qualified[1]!, repo: qualified[2]!, number: parseInt(qualified[3]!, 10) };
  }

  const bare = /^#?(\d+)$/.exec(raw);
  if (bare) {
    const slug = defaultRepo.trim();
    const parts = /^([\w.-]+)\/([\w.-]+)$/.exec(slug);
    if (!parts) {
      throw new Error(
        `"${raw}" needs a repo. Either type owner/repo#${bare[1]} or set a default issue repo in Settings.`,
      );
    }
    return { owner: parts[1]!, repo: parts[2]!, number: parseInt(bare[1]!, 10) };
  }

  throw new Error(`Could not read "${raw}" as an issue. Try owner/repo#123 or paste the issue URL.`);
}

interface IssueResponse {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  milestone: { title: string } | null;
  labels: Array<string | { name?: string }>;
  pull_request?: unknown;
}

export async function fetchIssue(ref: IssueRef): Promise<GitHubIssue> {
  let raw: IssueResponse;
  try {
    raw = await gh<IssueResponse>(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`);
  } catch (e) {
    // 404 here is ambiguous on purpose in GitHub's API: it also means "the token
    // cannot see this private repo". Say both so the fix is obvious.
    if (e instanceof GitHubError && e.status === 404) {
      throw new GitHubError(
        404,
        `${formatIssueRef(ref)} not found. It may not exist, or the token may lack Issues: read on ${ref.owner}/${ref.repo}.`,
      );
    }
    throw e;
  }

  return {
    ...ref,
    number: raw.number,
    title: raw.title,
    state: raw.state,
    htmlUrl: raw.html_url,
    milestone: raw.milestone?.title ?? null,
    labels: raw.labels.map(l => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean),
    isPullRequest: !!raw.pull_request,
  };
}
