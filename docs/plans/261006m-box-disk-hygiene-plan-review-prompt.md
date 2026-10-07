# Plan review: box disk hygiene timer, and a rebuildable box

You are reviewing a plan before anything is built. Findings only; do not edit files.

Read `docs/plans/261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md` (the plan), then the
things it leans on: `docs/project/overseer.md` § "Keeping `/home` from filling" (the exact
permissions Greg gave, in his words), `docs/project/hetzner-remote-server-box.md` (§ "A change to
the box is a change to a file", § "The box's own services", § Traps), `infra/hetzner/provision.sh`
(§ box services, from line 1365, and the verify block), `infra/hetzner/systemd/`,
`tests/systemd-units.test.ts`, `tools/fleet/health.ts` (disk reading and `computeVerdict`),
`tools/fleet/resource-policy.ts`, `scripts/overseer-watchdog.ts`, `scripts/worktree-sweep.ts`.

Context you cannot see from the repo: this box runs about twenty agent sessions as one user with
passwordless sudo, one shared local Supabase in Docker (its database is in Docker volumes and under
`~/.local/state/supabase`), a fleet dashboard under systemd and an Overseer daemon in tmux. Infra
here is held to a higher standard than app code: the job must not take down the dashboard, the
daemon or running sessions. Agents' scratchpads are `/tmp/claude-<uid>/<project>/<session-id>/`.
Worktrees live under `/var/tmp/spideryarn-worktrees/` and `.claude/worktrees/`.

Please look hardest at:

1. **Can any tidy step delete something it must not?** Each of steps 1 to 5: name a concrete state
   of this box in which it removes something live or something Greg did not permit. In particular
   step 3 (scratchpads of dead sessions: is "session id in no process command line and newest file
   older than 7 days" sound? a resumed session? a tmux job started from a scratchpad script?), step
   2 (`logs/` in the primary checkout: loops append to files there; anything read later, such as
   deploy or changelog history that a script plans from?), and step 5 (docker).
2. **A system unit with `User=greg` running hourly out of the primary checkout** with the
   checkout's own `tsx`: what goes wrong when the checkout is mid-merge, red, or `node_modules` is
   missing? Does it need `docker` group membership, `HOME`, a PATH with `npm` and `git`?
3. **The alert**: is extending `health.ts` to `df -k / /home` the right channel, and what does it
   break (wire type, the web client, the launch gate, a laptop with no separate `/home`, `df`
   printing one line for two paths on the same filesystem)?
4. **Stage 2**, the screenshot prune: "last commit more than 7 days ago" computed how, cheaply and
   correctly (renames, a file touched by a merge)? Is committing with `--pathspec-from-file` after
   deleting the files right under this repo's commit rules (AGENTS.md § Commit only your own files)?
5. **What is missing** for "could we rebuild this box the same way", given the gaps listed.
6. Anything simpler that would do the same job.

Answer with numbered findings, each marked P0 (would cause loss or an outage), P1 (wrong, fix before
building), P2 (worth doing) with the file and line you are relying on. End with a one-line verdict.
