# Multiple repos on one box: one adapter, not eleven special cases

**Status:** proposal, nothing built, nothing changed.

Two GPT Sol reviews sit behind this, and the second one changed the shape of the answer:
[`260831ad-multi-repo-support-sol.md`](260831ad-multi-repo-support-sol.md) (the collisions) and
[`260831ad-per-repo-extension-sol.md`](260831ad-per-repo-extension-sol.md) (the general seam), with
their prompts alongside.

> Ok, this all sounds pretty complex and fiddly and not worth fixing right now. Eventually I'll try
> to clean up the way Hello Zenno works. But there will always be per-repo customisation, so I
> wonder if there's a general way of solving this, e.g. having per-repo config/scripts/hooks/
> overrides?
>
> — Greg, 2026-08-31

He is right, and the first version of this plan was eleven special cases wearing a list.

## The answer, in one line

**Split by authority, not by file.** One repo-owned executable that the box runs when asked; a
tool-owned control plane on the laptop that decides identity, destination and credentials. No config
file, no hooks, no overrides.

```
.gjd-remote/run setup      # explicit, idempotent, non-destructive
.gjd-remote/run check      # read-only, and the tool runs it itself afterwards
```

One file per repo, dispatching however that repo likes — `npm run setup` for spideryarn2, a venv +
submodule + `npm ci --prefix frontend` + database for hellozenno. Unknown actions fail. The tool
appends its own nonce marker after the script exits, so a truncated ssh stream cannot read as
success.

## Why not the other three things Greg listed

**Config** (`.gjd-remote.toml`). Every new kind of variation needs a schema change in the tool, which
is the complexity being complained about, relocated. And ports — the most tempting thing to
declare — are *already declared* in `supabase/config.toml`, `vite.config.ts`,
`playwright.config.ts`. Restating them is a second copy that nothing keeps in step, which this repo
has a written rule against.

**Hooks** (`post-clone`, `pre-session`). Sol found the argument I had missed, and it kills them.
My framing was "anything that merely runs on the box is cheap, because every agent there already has
passwordless sudo". That is *mostly* right, but **automatic execution converts "code an agent may
choose to run" into "code a checkout causes us to run"**. A freshly cloned repo whose hook fires
before anyone has looked at it is a different thing from an agent deciding to run `npm install`. So:
explicit commands only, never lifecycle hooks.

**Overrides.** Most powerful, most surprising, and nothing needs one.

## What stays tool-owned, whatever the repo says

A box-side script may report facts. It may never decide:

- the canonical identity of the repo, or the remote checkout `push-env` lands in;
- which laptop file is read, or which keys and values leave the laptop;
- the ssh host or user;
- which local program runs — **never run a committed repo hook on the laptop.**

Ports are deliberately not on that list. Under one passwordless-sudo user, no declaration can stop a
repo binding or killing a port, so the honest target is *accidental*-conflict detection, not
enforcement.

## Re-sorting the earlier eleven

This is the part that answers "not worth fixing right now" directly.

| | |
|---|---|
| **hellozenno's own bugs**, nothing to do with `gjd-remote` | the ssh submodule URL · `lsof … \| kill -9` on 5173 and `$FLASK_PORT` · Playwright's missing browser · `inspector_port` |
| **The adapter absorbs** | setup, submodule init, dependencies, repo health, and later perhaps derived port claims |
| **The box** | one line of `provision.sh` for `python3-venv` |
| **Genuinely core `gjd-remote`** | resolve the repo by canonical origin · default-deny env policy · `GJD_REPO` on the session · refuse a missing checkout |

Four of eleven are hellozenno's to fix whenever Greg gets to it. Four more vanish into the adapter.
The tool-side remainder is four items, and smaller than it looks: `cloneFacts()` and `remoteSlug()`
in [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) **already scan `~/code` for a checkout
matching an origin** — that is how `clone` spots a twin — so "find the repo I am standing in" reuses
code that exists rather than adding any.

## The v0 that needs almost nothing from `gjd-remote`

hellozenno can go on the box now, badly but safely, with the rough edges left in and labelled:

1. `gjd-remote clone spideryarn/hellozenno`, then `new-shell -d ~/code/hellozenno`.
2. A hellozenno-owned adapter script, run by hand.
3. **Do not use `push-env`.** Build a box-local env there with a fresh Flask secret and only the
   provider keys deliberately chosen.
4. Initialise the submodule explicitly, with a one-command HTTPS rewrite until `.gitmodules` is
   cleaned up.
5. **Run one repo's app services at a time.** Concurrent Claude sessions are fine; concurrent app
   stacks are deferred.
6. Skip hellozenno's Playwright on the box.
7. Verify venv, submodule commit, frontend deps and schema independently — see the note on
   `migrate.sh` below.

The only optional tool change is dispatching `setup`/`check`, and even that can wait until running
the adapter by hand gets annoying.

## The hellozenno half of this

The four items above that are hellozenno's own bugs are written up **in that repo**, where its agents
will find them, at `hellozenno/docs/plans/260831a_remote_box_gjd_remote_setup.md`. It signposts back
here. Nothing in this repo depends on that work landing first.

## Findings, each verified here rather than taken on trust

**The 8083 collision is latent, not live.** Both Supabase configs set `edge_runtime.enabled = true`
and `inspector_port = 8083`. But **neither repo has a `supabase/functions` directory, and 8083 is
not bound on the box** — so it only bites when someone adds an edge function. One line, whenever,
and it can be changed in *our* config without touching hellozenno.

**hellozenno's `migrate.sh` exits 0 when you cancel the migration** (`Migration cancelled.` →
`exit 0`, line ~73). Its adapter must verify the resulting schema, not trust the exit code. Textbook
silent success, found by Sol.

**I was wrong about hellozenno's `.env.local`.** Its `DATABASE_URL`, `SUPABASE_URL`,
`PUBLIC_SUPABASE_URL` and `SUPABASE_HOST` are all `127.0.0.1`; the `*.supabase.co` hosts are in
`.env.prod`. What is true: ten values are byte-identical across the two files, one being
`FLASK_SECRET_KEY` — a production session-signing secret. The provider API keys are shared too, which
is ordinary and must not be blanket-rejected. Hence value rules, not name rules — and hence "do not
push it at all" for v0.

**Agent forwarding is a hardening item, not a live hole.** Sol notes `SSH_OPTS` does not force
`ForwardAgent=no`. Checked: `~/.ssh/config` sets it nowhere, and OpenSSH's default is off, so nothing
is forwarded today. Worth adding explicitly, since the box is shared by autonomous agents and a
future `Host *` line would silently change this.

**Not a finding, checked and dropped.** The box's Supabase ports bind `0.0.0.0`, but the Hetzner
firewall admits only 22/tcp, mosh's UDP range and ICMP, so they are unreachable. The defence is the
cloud firewall, and the config comments already say so.

**A rebuild still loses both GitHub tokens** — `/etc/github-tokens` is on `/`, the disposable disk,
while `/home` is the volume that survives. Unchanged by any of this; worth a doctor check.

## Measured

| | |
|---|---|
| `/home` (persistent volume) | 49G, 2.5G used — not the constraint |
| RAM | 30G total, **19G used, 11G available**, 13 sessions, one repo |
| `~/code` | one checkout |
| `/etc/github-tokens/` | both `gregdetre` and `spideryarn` present |
| python3 | 3.12.3, **no pip, no venv, no uv** |

RAM is nearer the ceiling than disk, with one repo. Nothing exists above CX53 in the CX line; the
next rung with more RAM is CCX43 at roughly 9×.

## Existing conventions considered instead of `.gjd-remote/run`

| | |
|---|---|
| `.claude/settings.json` + hooks | Wrong layer — Claude-specific, may run on the laptop, unavailable before Claude starts. |
| `package.json` scripts | Fine as an implementation detail; hellozenno's root has no npm project, so not the interface. |
| Makefile | A genuine alternative. Rejected only because neither repo has one and this would import a whole build convention for two remote targets. |
| devcontainer | Changes the execution model and complicates Docker/Supabase. |
| mise / asdf | Only earns its place if incompatible runtime versions become real; solves none of setup, health or env. |
| `.mcp.json` | Already owns MCP declarations. Leave alone. |

The adapter runs in a non-interactive shell that sources no profile, so it must use explicit paths
(`.venv/bin/python`) and fail clearly when a machine capability is missing.

## Ports, without a second copy

Two levels, and level one is all that is proposed now.

1. **Now:** box `doctor` reports *actual* listeners, their commands and cwd. Detects today's
   conflicts honestly; cannot predict tomorrow's.
2. **Later, only if it earns it:** a third adapter action, `describe`, deriving port claims from the
   repo's own native files and emitting strict JSON. The repo owns the technology-specific
   extraction; the tool owns the cross-repo comparison. No port value is ever copied into a second
   config.

## What is deliberately not being built

Declarative config · lifecycle hooks · behaviour overrides · a service supervisor · runtime
inference from `pyproject.toml` or `package.json` · dynamic port allocation · a plugin API ·
auto-clone · mise · per-session worktrees · separate Unix users.

## The simpler option passed over

Nothing at all: `gjd-remote new-shell -d ~/code/hellozenno`, and type the rest. That is genuinely close
to the v0 above, and the difference is only that the adapter gives a rebuilt box a way to answer
"do the N repos still work" without a human checking N things by hand.

## How each guard is made to go red

| Guard | Make it fail |
|---|---|
| Adapter honesty | `setup` returns immediately with dependencies absent; the separate `check` must fail by name. |
| Venv | Remove `.venv/bin/python`; check must fail. |
| Submodule | Move `gjdutils` off its recorded commit; check must fail. |
| Truncated ssh reply | Cut the stream before the tool's nonce marker; the command must fail. |
| Repo cannot grant itself authority | Have the adapter print a different destination, or ask for `HETZNER_CLOUD_API_TOKEN`; neither may change tool behaviour. |
| Zero-config repo | A repo with no adapter: every existing session command still works, and only `setup` fails clearly. |
| Env default-deny | A new `owner/repo`: `push-env` must fail before reading a file or opening ssh. |
| Listener attribution | Bind a repo's port from an unrelated process; doctor must name the owning PID. |
| Canonical identity | Two temp repos, same basename, different origins — must resolve differently. |
| Port claims (if `describe` is ever built) | Change one native port to 8083; comparison must fail without editing a second list. |
