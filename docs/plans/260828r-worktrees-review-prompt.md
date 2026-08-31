# Review: the worktrees plan for spideryarn2

You reviewed the design questions behind this earlier; this is the plan that came out of it.
Greg has since answered the four open questions, and two of his answers changed the dependency
recommendation away from what you picked. Review the plan as written.

The plan is at `docs/plans/260828r-worktrees.md` in this repo. Read it in full.

## What changed since your last review, and why

You recommended plain `npm ci --prefer-offline` over the CoW cache, on the basis that
`scripts/deploy.ts:553` records 24 seconds for `npm ci`. That number is a comment, not a
measurement that re-runs. I measured it fresh:

- `npm ci --prefer-offline --no-audit --no-fund` into an empty dir, warm cache: **625 MB real disk**
- `npm ci --offline` (strict, no registry contact at all): **exit 0**, 32 `.bin` shims, 30,512 files
- `cp -c -R node_modules`: **29 MB real disk** (free-space delta, with a `cp -R` control at 658 MB)
- The live `node_modules` and a fresh `npm ci --offline` differ **only** by `node_modules/.vite`,
  `.vite-temp` and `.cache`. 30,759 vs 30,512 files.
- `~/.npm/_cacache` is 20 GB, so network was never the real cost.

Times were taken at load average 433 and are stated in the plan as unreliable.

Greg's answers:
1. Dropbox — he intends to move the whole repo out, but agents are working, so it is **deferred**.
   `.git` stays in Dropbox for now.
2. The primary checkout — **he keeps working in it**, agents get worktrees, and he explicitly does
   **not** want a dirty-primary hard refusal: "it won't be a big deal if new worktrees start out
   slightly behind".
3. Postgres — one shared stack plus a migration lock.
4. Scale — **ten or more worktrees alive at once** (there are 13 live sessions in the tree today).

(2) and (4) together are why the plan ports Rebel's fingerprint-keyed cache rather than the simpler
clone-from-the-primary I first proposed: the primary is a mutable source, and 10 worktrees cloning
from a tree someone is editing is the case Rebel reverted.

## Also verified since your review

- Your reading of `deploy.ts` was right and I confirmed the mechanism: `git worktree remove --force`
  on a locked worktree exits 128 with "use 'remove -f -f' to override"; `run()` ignores it; `rmSync`
  deletes the directory anyway. 15 of 22 registrations are ghosts.
- `vitest.config.ts` sets no `cacheDir`, so the Vite/Vitest cache really does live in
  `node_modules/.vite`. Your objection to the shared symlink holds.
- The repo has **no** `preinstall`, `postinstall` or `prepare` script.
- npm 11 blocks install scripts for esbuild (x3), `@sentry/cli` and `fsevents` under `allowScripts`.
  The esbuild platform binary is present anyway (it ships as an optional dependency), and the
  primary and a fresh install agree. I have **not** checked whether `@sentry/cli`'s missing binary
  matters to `npm run build` — flag it if you think it does.
- `/Users`, `~/.cache` and `/private/tmp` are all APFS device 16777234.
- local `main` is 83 commits ahead of `origin/main`.

## What I want from you

1. **Attack the dependency decision.** Given (2) and (4), is the fingerprint cache right, or is plain
   `npm ci --offline` per worktree still better at 625 MB × 10 = 6 GB? Do not defer to my numbers —
   tell me if 29 MB vs 625 MB is being weighted wrongly against ~150 lines of cache machinery with
   locks, staging renames and TTL pruning. What is the smallest correct version?
2. **The fingerprint inputs.** The plan uses lockfile + package.json + node major + npm major.minor
   + platform-arch. With no lifecycle scripts in this repo, is that complete? What is missing that
   would let a wrong tree be served as a hit? Consider `.npmrc` (there is none in-repo), npm's
   `allowScripts` state, and optional/platform-constrained dependencies (215 lock entries are
   platform-constrained).
3. **Deleting `.vite`, `.vite-temp`, `.cache` before publishing.** Is that sufficient, or are there
   other mutable-state directories inside `node_modules` that a published cache entry should not
   carry?
4. **The deferred Dropbox move.** The plan keeps `.git` in Dropbox and says `git worktree repair`
   fixes the paths later. Is that the whole story for a move with 10 live worktrees, or does
   something else break? Should the plan instead insist worktrees be removed before the move?
5. **Anything that will report success while doing nothing.** This repo's worst bugs are all that
   shape. The plan has a failure-mode table — tell me what is missing from it, and whether any row's
   stated detection would actually fire.
6. **Scope.** Is the six-step order of work right, and is anything in it not worth doing?

Be concrete and disagree where you disagree. If a recommendation in the plan is wrong, say so
plainly rather than hedging.
