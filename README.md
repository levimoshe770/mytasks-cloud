# mytasks-cloud

A personal task list you can open on your phone and your work computer, backed by
a private GitHub repo.

Derived from [`mytasks-app`](https://github.com/levimoshe770/mytasks-app), with two
changes:

- **No server.** The old version was an Express process bound to `127.0.0.1:4870`
  on one machine, which is why a phone could never reach it. This is a static PWA
  that talks to the GitHub REST API directly, so "the cloud" is GitHub and there
  is nothing to keep running or pay for.
- **GitHub Issues instead of Bugzilla.** `src/bugzilla.ts` shelled out to a Python
  helper that only worked on the corporate network. Linking an issue is now one
  authenticated GET, so it works from anywhere.

The task model is unchanged: status, priority, deadline, milestone, tags, notes,
per-task todo checklists, and subtasks via `parentId`. An existing `tasks.json`
from the old app can be dropped straight in.

## How it stores data

`tasks.json`, in a private repo, is the whole database. Every write is a commit,
so the task list has full history and is restorable to any point.

The old backend serialized writes with an in-process mutex and `git pull
--rebase`. Neither exists in a browser, so concurrency is handled by the Contents
API's blob SHA:

1. Read `tasks.json`, keeping its SHA.
2. Apply the change to a copy.
3. `PUT` it back **with that SHA**. GitHub rejects the write with a 409 if anyone
   has committed since.
4. On rejection, re-read and re-apply — never overwrite.

So if you edit task #4 on your phone while your laptop edits #7, both survive.
After five failed attempts it gives up with an explicit error rather than
guessing. `src/github/store.test.ts` drives this against a fake Contents API,
including the case where another device commits between the read and the write.

Polling uses `If-None-Match`; GitHub answers `304` when nothing changed and does
not bill it against the 5,000/hour rate limit.

## Setup

### 1. Create the data repo

```powershell
gh repo create mytasks-data-2 --private --description "mytasks data"
```

Nothing else is needed — `tasks.json` is created on your first task. To bring
across an existing list, commit the old `tasks.json` to the root of this repo.

### 2. Create a fine-grained token

<https://github.com/settings/personal-access-tokens/new>

| Setting | Value |
|---|---|
| Repository access | Only select repositories → the data repo (plus any repo whose issues you want to link) |
| Contents | **Read and write** — on the data repo |
| Issues | **Read-only** — on the repos you link issues from |
| Expiration | 90 days is a reasonable default |

No other permissions. When it expires the app says so and sends you to the setup
screen; paste a new one.

### 3. Run it

```powershell
npm install
npm run dev      # http://localhost:5173
```

Paste the repo (`owner/repo`) and the token. Both are stored in that browser's
`localStorage` and nowhere else.

## Deploying

The built output is static files. The app repo itself holds **no secrets** — the
token is per-device — so it can be public and use free GitHub Pages hosting.

**GitHub Pages.** `.github/workflows/deploy.yml` is included. Push, then set
Settings → Pages → Source to *GitHub Actions*. The workflow sets `BASE_PATH` so
the app works from `/mytasks-cloud/`.

**Cloudflare Pages.** Use this instead if you want the app repo private too.
Connect the repo, build command `npm run build`, output directory `dist`.

Either way: open the URL on your phone and use *Add to Home Screen*. It installs
as a PWA and opens like an app.

## Using it

Same as before, plus:

- **Link GitHub issue** (in the task drawer) replaces *Attach bug*. Accepts
  `owner/repo#123`, a pasted issue or PR URL, or a bare number when you have set a
  default issue repo in Settings. It renames the task to the issue title and
  copies the issue's milestone across.
- **Merge** now works on any task, not just bug-sourced ones. The source is
  soft-deleted and its notes are merged into the target chronologically.
- **Settings** holds the current milestone. It lives in `tasks.json`, so every
  device agrees on which release is "must resolve now".
- **Send prompt to Claude** writes a file to `inbox/` in the data repo, the same
  convention the scheduled routine already reads.

Offline, the app opens read-only from the last copy saved on that device and the
sync badge reads *Offline*. Writes are refused rather than queued — a queued write
would have to be replayed against a blob that has since moved.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm test` | Vitest — storage conflict handling, base64, issue parsing, cycle detection |
| `npm run typecheck` | `tsc --noEmit` |

## What was dropped

- `src/bugzilla.ts` and the Python helper.
- The `outbox/` reader. It existed in the old backend's API but nothing in the UI
  ever called it.
- The Express server, `simple-git`, `zod`, and the PowerShell install scripts.
  Validation moved into TypeScript types plus the parsers in `src/github/`.

## Security notes

The token sits in `localStorage` on each device, which is the real trade-off for
having no server. It is worth knowing:

- Scope the token to the data repo only, so a leak cannot reach anything else.
- Anyone with access to an unlocked browser profile can read it. On a work
  machine, prefer a short expiry.
- *Sign out of this device* in Settings clears the token and the offline copy.
- If work task data is involved, check that keeping it in a personal GitHub repo
  is acceptable under your employer's policy before putting it there.
