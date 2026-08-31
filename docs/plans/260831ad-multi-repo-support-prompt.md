# Design review: making one remote box (and `gjd-remote`) serve several repos

You are reviewing a **design question, before any code is written**. I want your best thinking on
the shape of the change, the traps, and what I have not thought of. Be concrete and opinionated.
Where you think my proposal is wrong, say so and say what to do instead.

## What exists today

A single Hetzner CX53 (16 shared vCPU, 32GB RAM, 320GB root disk, plus a 50GB Hetzner volume
bind-mounted over `/home`). The server is disposable; the volume is not. One Linux user, `greg`,
with passwordless sudo. Many autonomous Claude Code agents run as that one user, each in its own
tmux session. "On the box" therefore means "reachable by every agent on the box".

`gjd-remote` is a laptop-side CLI: one ~1800-line TypeScript file, `scripts/gjd-remote.ts`, no
argument-parsing dependency (node:util `parseArgs`). Subcommands: `ls`, `new`, `shell`, `resume`,
`kill`, `doctor`, `clone`, `push-env`, `ssh`, `tunnel`, `forget-key`.

It is launched from `~/bin/gjd-remote`, a bash shim that hardcodes absolute paths:

```bash
exec /Users/greg/.../spideryarn2/node_modules/.bin/tsx \
     /Users/greg/.../spideryarn2/scripts/gjd-remote.ts "$@"
```

So the tool is already global on the laptop, but it *lives inside* one repo, `spideryarn2`, and
almost everything about it assumes that repo:

- `const REPO = <spideryarn2 checkout>` (resolved from `import.meta.url`).
- `host()` runs `tofu -chdir=$REPO/infra/hetzner output -json` to read the box's IP from Terraform
  state. Overridable with `GJD_REMOTE_HOST`. The Terraform + cloud-init + `provision.sh` for the box
  all live in `spideryarn2/infra/hetzner/`.
- `REMOTE_REPO_DEFAULT = /home/greg/code/spideryarn2`. Overridable with `GJD_REMOTE_REPO`.
  `sessionDir()` resolves, in order: explicit `--dir`, then `GJD_REMOTE_REPO`, then that default —
  and then proves it by running `cd <dir>` on the box over ssh before creating any session.
  (`test -d` was rejected: a directory with no execute bit passes `test -d` and refuses `cd`.)
- `new` writes a job script on the box, `tmux new-session -d`, and the job script begins with a
  `cd <dir> || {write a note; exit 1}` guard — because `tmux new-session -c DIR` silently falls back
  to `$HOME` and exits 0 when it cannot enter the directory.
- `push-env` builds `.env.local` on the box **from an allowlist of key names** hardcoded in
  `scripts/gjd-remote-env.ts` (local Supabase demo creds, model-provider API keys, one owner UUID),
  writes it atomically, then reads the bytes back and compares. It always writes to
  `${REMOTE_REPO()}/.env.local`. `HETZNER_CLOUD_API_TOKEN` (can delete the box) and
  `SUPABASE_ACCESS_TOKEN` (can delete the production Supabase project) are deliberately off the
  allowlist. It refuses to push any file not literally named `.env.local`.
- `clone` clones over HTTPS only. The box has **no GitHub ssh key**; it authenticates through a git
  credential helper that reads the owner out of the request path and looks up a per-owner
  fine-grained PAT in `/etc/github-tokens/<owner>.token`. `clone` checks the token file exists
  before running git, refuses if the destination exists and is not a checkout of the repo asked for,
  and detects "same repo already checked out under a different directory name" by comparing origin
  URLs of every sibling directory. It deliberately runs no install step. It does **not** currently
  pass `--recurse-submodules`.
- Sessions are tmux sessions with a flat name (slug, max 41 chars, `^[a-z0-9][a-z0-9-]{0,40}$`),
  defaulting to `s-260831-192843`. `ls` prints NAME / AGE / ATTACHED / TITLE, where TITLE is read
  out of Claude's own transcript (found via a pinned `--session-id`) and adopted as the tmux session
  name once Claude has titled the work. There is no repo column.
- The box's provisioning (`provision.sh`, ~600 lines, fail-fast, every tool *exercised* not merely
  located) installs: node, Docker CE, the Supabase CLI pinned to an exact version, Chrome, gh, jq,
  tmux, mosh, and an Xvfb `:99` + x11vnc + websockify-on-6080 noVNC stack for headless browser work.
  **There is no Python toolchain at all.**
- `.mcp.json` is at project scope in `spideryarn2`, so the MCP servers arrive with the clone.

## The two repos in play

**`spideryarn2`** (currently the only one). TypeScript/ESM, Vite, npm. Local Supabase stack via
Docker, `supabase/config.toml` with `project_id = "spideryarn2"` and every port in a **5436x** block
(54360-54369). `.env.local` holds only local-stack demo credentials plus model API keys. GitHub
remote is `spideryarn/reading2` — note the directory is `spideryarn2` and the repo is `reading2`,
so the local directory name already does not match the repo name.

**`hellozenno`** (the one I want to add). GitHub remote `spideryarn/hellozenno`, cloned locally over
**ssh** (`git@github.com:spideryarn/hellozenno.git`). Python 3.12 backend (`pyproject.toml`, ruff,
black, pytest, `backend/pytest.ini` with `pythonpath = .`) plus a SvelteKit/Vite frontend in
`frontend/` with its own `package.json` (Playwright, Storybook on 6006, vitest). A **git submodule**
`gjdutils` whose URL is `git@github.com:gregdetre/gjdutils.git` — an ssh URL, which the box can
never fetch. Its `supabase/config.toml` has `project_id = "hellozenno"` and ports in the **5432x**
block (54320-54324, 54329) — i.e. the CLI defaults, which do not collide with spideryarn2's, but
only because spideryarn2 was deliberately moved out of the default block for an unrelated reason.
Next to `.env.local` it has `.env.prod`, `.env.prod.backup_260525_1227`, `.env.security`,
`.env.testing` — and I do not currently know whether its `.env.local` points at a local Supabase or
at a hosted one.

## What I want, and my starting proposal

Greg's ask, verbatim:

> I would like to be able to use gjd-remote (and ideally the same box) for other repos, e.g.
> /Users/greg/Dropbox/dev/experim/hellozenno
>
> I'm thinking that `gjd-remote new` should take into account the repo you're in, and use that to
> decide where on the box to cd into, and perhaps even automatically clone that repo if it doesn't
> exist.
>
> What else will we need to address in order to be able to have multiple repos (ideally running
> sessions at the same time) on the same box?

My starting proposal, for you to attack:

1. **Separate "the tool's home" from "the repo you are in".** `REPO` stays pointing at spideryarn2
   for Terraform state (spideryarn2 becomes "the infra repo" by declaration), but a new
   `localRepo()` reads the caller's `cwd` — `git rev-parse --show-toplevel` — and that decides the
   remote directory.
2. **A mapping from local checkout to remote checkout**, resolved most-specific-first: `--dir`, then
   `GJD_REMOTE_REPO`, then a per-repo config file, then a default of
   `/home/greg/code/<basename of local toplevel>`.
3. **A tiny per-repo config file** committed in each repo, something like `.gjd-remote.json`:
   `{ "remoteDir": "~/code/hellozenno", "envAllowlist": [...], "setup": "..." }`.
4. **`new` refuses, with the exact `clone` command, when the remote checkout is missing** — rather
   than auto-cloning. A `--clone` flag opts in.
5. **`ls` grows a REPO column**, from a `GJD_REPO` env var set on the tmux session at creation.

## What I want from you

Please answer all of these, in this order, and be concrete.

### A. The local→remote mapping

Is inferring the remote directory from the local cwd the right call at all? What is the right
resolution order and the right *default*? Consider: `spideryarn2` vs `reading2` (dir name ≠ repo
name, already true today); running from a subdirectory; running from a git worktree or a submodule
(`git rev-parse --show-toplevel` inside `hellozenno/gjdutils` answers `gjdutils`, not `hellozenno`);
running from outside any repo; two local checkouts of the same repo; a repo whose local basename
collides with a different repo's. Which failures must be loud, and what exactly should the error
say? Is a *committed* per-repo config file right, or should the mapping live centrally on the laptop
(e.g. `~/.config/gjd-remote/repos.json`), and why?

### B. `push-env` and the allowlist — the part I am most worried about

Today one hardcoded allowlist serves one repo, and the secrets it carries are near-worthless (local
Supabase demo creds). hellozenno may well have real credentials in its `.env.local`. Options I see:

- (i) per-repo allowlist committed **in the target repo** — travels with the repo, but then the repo
  declares what secrets it may receive, which feels like the wrong direction for a security control;
- (ii) per-repo allowlist held **centrally on the laptop**, outside any repo;
- (iii) keep it hardcoded in `gjd-remote-env.ts` as a map keyed by repo.

Which, and why? What should happen when a repo has no entry — refuse, or push nothing? Given that
every agent on the box can read every other repo's `.env.local`, and hellozenno sits next to a
`.env.prod`, what additional guards are worth having (e.g. refusing to push a value that also
appears in a `.env.prod` in the same directory; refusing any `DATABASE_URL` that is not localhost;
a per-repo "this repo may not push env at all" default)? Is the "only ever the file named
`.env.local`" rule still sufficient when there are four `.env.*` files sitting beside it?

### C. Collisions between repos running at the same time on one box

Enumerate what actually collides and what does not. My list: local Supabase stacks (ports and
Docker `project_id` — these two happen not to clash today; is that enough, and should `gjd-remote`
*check*?); Vite dev-server ports (both default to 5173); Playwright/Chrome; the **single** Xvfb `:99`
/ x11vnc / websockify-on-6080 noVNC stack, which is global and has one display; Docker's data root
being on the ephemeral root disk while Supabase's data is bind-mounted onto the persistent volume;
the 50GB `/home` volume once several repos each carry `node_modules` and a Python venv; the single
`~/.claude` / `~/.claude.json` config and its MCP server registrations; git identity; two agents in
the same checkout on the same branch. What have I missed, and which of these should be *detected* by
`gjd-remote doctor` rather than discovered at 2am?

### D. Toolchain provisioning without the box becoming a pet

The box has no Python. `provision.sh` is one fail-fast script that exercises every tool it installs,
and the box is meant to be re-creatable from Terraform + cloud-init. Options: (a) grow `provision.sh`
into the union of every repo's needs; (b) a per-repo bootstrap script *in the repo*
(`.gjd-remote/setup.sh`) that `gjd-remote` can run on demand; (c) a version manager (mise/asdf) so
per-repo toolchains are declared by the repo. Which, and what does that do to the "the server is
cattle, rebuild it freely" property? How should a rebuilt box get back to a state where N repos work
— and how would I *know* it had, without a human checking N things by hand?

### E. Sessions, naming and `ls`

With several repos, how should a session be identified? Options: a repo prefix baked into the tmux
session name (which eats into the 41-char slug budget and fights with the "adopt Claude's own title"
mechanism); a separate REPO column read from a `GJD_REPO` tmux session env var; tmux *groups*. Note
`#{pane_current_path}` is the wrong source because the agent's cwd drifts. What should `kill`,
`resume` and `ls` do — should `ls` default to the current repo's sessions and need a `--all`, or
always show everything? Which is less dangerous when `kill` is involved?

### F. Auto-clone

Should `new` clone a missing checkout automatically? Consider: it needs a per-owner token that may
not exist; hellozenno has an **ssh-URL submodule** the box cannot fetch (what is the right fix —
`insteadOf` config on the box, changing the submodule URL, or refusing?); a clone is slow enough to
look like a hang; and a `new` that clones is a `new` that can leave a half-built checkout behind.

### G. Where should `gjd-remote` itself live?

It is a general-purpose tool sitting inside one product's repo, and its Terraform state is inside
that repo too. Should it move (to `gregdetre/gjdutils`, or its own repo), stay, or split — and if it
moves, what breaks and what is the migration? Note the constraint that this working tree is shared
by several agents at once and a rename is never one edit.

### H. What have I missed?

Rank everything above, plus anything you add, into: **must do before hellozenno can run on the box
at all**, **should do soon**, and **only if it bites**. Name the simplest thing that could possibly
work for the first bucket — I would rather ship a small correct v1 and grow it than design the
general case up front.

## House rules that constrain the answer

- Prefer boring, and prefer *simple* (few parts touching each other) over *easy*.
- Simplest version first: a v1 that works end to end, complexity added only when something shows it
  is needed.
- No new dependencies without a reason worth writing down.
- Make wrong states unrepresentable in the type system where you can.
- This codebase has been bitten repeatedly by **silent success** — a check that reports success
  while doing nothing, with the obvious verification sharing an assumption with the code. Every
  guard you propose should come with "and here is how you would make it go red".
