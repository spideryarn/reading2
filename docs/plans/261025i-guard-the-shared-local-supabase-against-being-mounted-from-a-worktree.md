# Guard the shared local Supabase against being mounted from a worktree

Asked for by Greg on 2026-10-25, passed on by session reading2-c6. Up:
[plans.md](../project/plans.md).

## The problem

`supabase start` bind-mounts files from the directory it is run in into its containers. On the box,
measured 2026-10-25 with `docker inspect`:

| container | bind mount source |
|---|---|
| `supabase_studio_spideryarn2` | `<workdir>/supabase/snippets` |
| `supabase_edge_runtime_spideryarn2` | `<workdir>/supabase/.temp/start-secrets/…/index.ts` |
| `supabase_kong_spideryarn2` | `<workdir>/supabase/templates/*.html` — **once `config.toml` has `content_path` email templates** (added 2026-09-30, after the box's stack was started, so the box's Kong has no binds yet) |

and every container carries the label `com.supabase.cli.workdir=<workdir>`.

If `<workdir>` is a worktree and the worktree is later removed, the running containers carry on —
until one restarts. Docker will not start a container whose bind source has gone, so Kong (the
gateway in front of auth, port 54361) stays down. Local auth was down for 13 days this way: the
261024a run found Kong unable to restart because its email-template mount named a deleted
`mcp-remote-on` worktree ([261024a validation](261024a-eight-limbed-reading-spider-validation.json)).
Nothing said why; it looked like flaky auth tests.

**How the box's stack is mounted today (2026-10-25):** every `spideryarn2` container has
`com.supabase.cli.workdir=/home/greg/code/spideryarn2` — the primary — created 2026-09-01, running,
`/auth/v1/health` answers 200. So the box is not in the trap now and **no restart is needed**. The
incident was on another machine, presumably the Mac; nothing here can inspect it.

## What we'll do — both guards (revised after GPT Sol's plan review)

1. **`npm run db:start` refuses in a linked worktree.** A new `scripts/db-start.ts`:
   - in a linked worktree (`inLinkedWorktree`, `scripts/worktree-port.ts`) exits 1 naming the
     primary and the command to run there;
   - refuses a forwarded `--workdir PATH` or `--workdir=PATH` (P-2: from the primary,
     `npm run db:start -- --workdir <tree>` would otherwise pass the guard and mount the tree);
   - before starting, reads the existing `com.supabase.cli.project=spideryarn2` containers and, if
     any has a `com.supabase.cli.workdir` that is not this primary, **refuses** (P-4) with the
     foreign workdir and the repair (`npm run db:stop && npm run db:start`, from the primary, at a
     quiet moment). A container with **no** workdir label is a warning, not a refusal — an older CLI
     might not write one, and a refusal nobody can clear is noise. Docker unreachable here is not
     a refusal: `supabase start` says so itself;
   - otherwise runs `supabase start` with the remaining args, passing its exit code through.
2. **`worktree:check` blocks on any Docker container mounted from the tree** — running **or
   stopped**, of any project (Sol agrees on both). A new fact in `CheckFacts`, `mounts: MountScan`,
   from `docker ps -aq --no-trunc` + one `docker inspect` of all ids, finite timeouts and a bounded
   buffer. A container matches if any `Mounts[].Source` or its `com.supabase.cli.workdir` label is
   the tree or under it.
   - **Path containment is one tested helper** (P-3): realpath the root and any candidate that
     still exists, lexical fallback for one that does not; on macOS strip a leading `/host_mnt`;
     compare on a component boundary, so `tree-old` is not under `tree`. Covers `/var` →
     `/private/var`, trailing slashes, symlinked spellings.
   - **Unknowns** (P-1): `docker` not installed → a note (no Docker, no containers). Daemon
     unreachable, permission denied, timeout, unparseable output → **a blocker**: "start
     Docker/OrbStack and rerun". This differs from `listenersUnder` on purpose — Docker runs on both
     machines and the unknown is clearable, and a stopped daemon is exactly when containers sit
     waiting to restart from a mount you are about to delete.
   - **The blocker's text** (P-6) lists each container's name, state, project label and what
     matched. For `com.supabase.cli.project=spideryarn2` it gives the repair: from the primary,
     `npm run db:stop && npm run db:start` at a quiet moment — plain stop preserves local data; never
     add `--no-backup`. For any other container: stop or recreate it with whatever owns it.
   - **The sweep scans once** (P-5): `gather` takes an optional pre-fetched inventory, as it already
     takes a pre-fetched trunk sha; `worktree-sweep.ts` scans Docker once and passes it to every
     tree. `removeWorktree`'s own re-check stays a fresh scan.

   `worktree:remove`, `worktree:sweep` and — since the 2026-10-05 `WorktreeRemove` hook —
   `ExitWorktree`'s removal all judge through `blockers(gather())`, so they inherit it (P-7).

Why both: (1) stops the usual way in, but not a raw `supabase start`, nor one run before this
landed; (2) catches any way in, at removal. Still uncovered: a bare `git worktree remove` or
`rm -rf`, after a raw `supabase start` in that tree.

## Considered and not done

- **db:start from a worktree silently uses `--workdir <primary>`** instead of refusing. Friendlier,
  but an agent who edited `supabase/config.toml` in their worktree would get the primary's config
  without being told. A refusal that names the command is clearer.
- **A PreToolUse hook refusing `supabase start` outside the primary.** Would close the raw-command
  gap, but a third mechanism for a rare path; the removal blocker already catches the consequence.
- **Restarting the box's stack** so its Kong picks up the email templates. Not needed for this task
  and it interrupts every session; noted in the debrief instead.

## Stages

One stage: both guards, their tests (red first), and the docs —
[supabase-local.md](../project/supabase-local.md) gets the trap and the guard;
[worktrees.md § Traps](../project/worktrees.md#traps) and § Before you remove one get a line each.

Done: the touched suites green, `npm run typecheck` green, the real `worktree:check` run in this tree
prints the mount check as verified (nothing mounted), and tests with fake `docker inspect` payloads
show the blocker and each unknown.

## Review

- Plan review (GPT Sol, 2026-10-25): "revise before implementation — the two-guard architecture is
  right". Seven findings (P-1…P-7), all accepted and folded in above; P-4's "a missing workdir label
  is unknown" softened to a warning, since an older CLI would make it a permanent refusal.
- Code review (GPT Sol, 2026-10-25, write-capable, on 0735047b8): two P1s, both fixed by the
  reviewer and read by me. **C-1**: the removal and sweep fixture tests asked the live Docker daemon,
  so a `docker ps` timeout under the box's load became a fail-closed blocker — the flake the
  implementer saw once. `RemoveOptions.docker` and `classifyAll(cwd, readDocker)` now let tests pass
  a fixed inventory; production still scans fresh at the removal. **C-2**: a failed `docker inspect`
  with empty stderr passed the "only vanished containers" test vacuously; now `cannot-tell`. No
  wider findings. One round was enough: the fixes are small, and both are covered by new tests.

## What landed

- `scripts/db-start.ts`; `npm run db:start` now runs it. Run live in this worktree: it refuses,
  exit 1, naming `cd /home/greg/code/spideryarn2 && npm run db:start`.
- `worktree:check` mount blocker. Run live: in this tree it printed `ok   no Docker container,
  running or stopped, is mounted from inside this directory (24 inspected)`. With `--root` on the
  primary, which the box's stack is mounted from, it printed `FAIL 12 Docker containers are mounted
  from this directory`. That is the positive control.
- Gates: worktree-check, worktree-remove, worktree-sweep, db-start and doc-links suites 214 passed,
  1 skipped; typecheck clean; biome clean on the touched files.
- Docs: [supabase-local.md § The ways this goes wrong quietly](../project/supabase-local.md#the-ways-this-goes-wrong-quietly),
  [worktrees.md § Before you remove one](../project/worktrees.md#before-you-remove-one) and § Traps.
