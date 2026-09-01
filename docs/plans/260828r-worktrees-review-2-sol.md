## Verdict: revise before building

The simplification is mostly right, but two deleted pieces were load-bearing:

1. A lifecycle mechanism that protects valuable ignored worktree data.
2. An atomic port allocator plus server-identity check.

The weakest claim is **Claim 2**. Claude’s isolation appears genuine, but its lifecycle rules do not protect this repo’s ignored outputs.

I reviewed the plan at commit `16f2605`; it changed during this review.

## Findings, ordered by cost × silence

1. **Critical — disabling previews only for `dev` does not close the secrets risk.**

`git.deploymentEnabled: {"dev": false}` leaves every unspecified branch enabled. Pushing `worktree-*`, `agent/*`, or another branch can therefore build a Preview deployment with `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY`. Vercel environment variables are available during the build as well as function execution, so deployment password protection does not prevent build-time code from reading them. [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration), [environment variables](https://vercel.com/docs/environment-variables).

The new audit shows Preview lacks `DATABASE_URL` and the service-role key, which substantially reduces the production-database risk. It does not eliminate:

- Provider-key leakage or spend.
- Anonymous access allowed by the production Supabase project’s RLS.
- A reader signing into unreviewed Preview code and giving it their session.

Before enabling worktree pushes, make Git deployments default-deny except `main`—for example, a verified rule equivalent to `{"**": false, "main": true}`—and remove provider keys from Preview if possible. Remember that manual `vercel deploy` is a separate path.

2. **High — Claude cleanup can silently delete paid outputs in ignored `data/`.**

The plan copies `data/` into each worktree and relies on the custom sweep to protect it, but native Claude cleanup may run first. `data/` and `.env.local` are ignored, so a worktree containing only newly generated pipeline output can look clean to Git and qualify for native removal.

`WorktreeRemove` hooks cannot reliably veto that removal; hook failure is informational. [Claude worktrees](https://code.claude.com/docs/en/worktrees), [Claude hooks](https://code.claude.com/docs/en/hooks).

This requires one of:

- Custom creation/removal with your guarded sweep owning deletion.
- Moving valuable outputs outside Claude-managed worktrees.
- Explicitly forbidding paid pipeline work there.

This is the main machinery I think the revision deleted too aggressively.

3. **High — changing GitHub’s default branch does not update existing clones’ `origin/HEAD`.**

This checkout still had `origin/HEAD -> origin/main`. Claude bases new worktrees on `origin/HEAD`, so the first worktree after the branch change can quietly start from `main`.

After changing the default branch, run and verify the equivalent of:

```sh
git fetch origin dev
git remote set-head origin -a
git symbolic-ref refs/remotes/origin/HEAD
```

Do it on every existing clone, including the Ubuntu box. Creation should also assert that the new worktree’s starting SHA equals freshly fetched `origin/dev`. [git remote documentation](https://git-scm.com/docs/git-remote.html).

4. **High — nesting worktrees under `.claude/worktrees/` leaks them into repository tooling.**

Dropbox exclusion and `.gitignore` do not stop local scanners:

- [vite.config.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/vite.config.ts:208) does not exclude `.claude/worktrees`, so peer changes may trigger reloads.
- [scripts/typecheck.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/typecheck.ts:47) recursively discovers nested source trees and `tsconfig.json` files.

With ten worktrees, the main checkout can typecheck peers’ code or fail because of it. Add explicit exclusions and audit other recursive walkers.

5. **High — ten hashed ports for roughly ten worktrees is effectively guaranteed to collide.**

With ten active worktrees and ten slots, the probability of at least one collision is about **99.96%**. With five worktrees it is already about **69.8%**.

`strictPort` makes the second server fail loudly, but it does not prevent a browser aimed at the occupied port from reaching the first worktree. The plan also contradicts itself: the implementation recommends hashing, while the failure table still requires an atomic lease and identity check.

Keep:

- Atomic allocation/lease.
- `strictPort: true`.
- A worktree identity endpoint/assertion used by browser automation.

6. **Medium — “age of last commit” is not worktree age or activity.**

A worktree created today from a month-old commit immediately passes that age test. Use a recorded creation timestamp or READY marker, preferably supplemented by reflog/activity evidence.

A Claude-held `git worktree lock` should be an unconditional deletion blocker, but not proof of current activity: `SIGKILL` can leave persistent lock metadata. Fail closed rather than automatically unlocking it. An explicit `worktree:done` marker is a better positive signal; age should remain only a grace period. [git worktree documentation](https://git-scm.com/docs/git-worktree.html).

7. **Medium — deleting the dependency cache is justified, but the install contract needs tightening.**

Claim 1 is sound: four-to-five-second installs do not justify an 11-part copy-on-write cache.

Specific evidence limits:

- `df -k` measures whole-volume allocation and is noisy when other processes run. The repeated 564/571 MB values establish the order of magnitude, not an exact per-tree cost. Pair it with `du -sk` if precision matters.
- Identical file counts show repeatability, not completeness.
- `npm ci` success verifies lockfile installation; `npm ls --all`, build, typecheck, tests and relevant native paths provide better usability evidence.
- `--prefer-offline` does not weaken lockfile resolution; it prefers cached artifacts and fetches misses. Platform-specific optional packages can still make macOS and Linux trees legitimately differ. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

The current machine’s install-script report found Sentry CLI and three `esbuild` versions, not the plan’s stated “two esbuild plus fsevents.” Blocked scripts remain a future-dependency hazard: a package can install successfully and fail only when its generated or downloaded artifact is first used. Commit the npm/Node version and install-script policy rather than treating this as moot. [npm install scripts](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/).

8. **Medium — Claim 4 is correct about `deploy.ts`, but not the whole branch transition.**

The deployment code does largely mean “what is live”:

- Change the working-branch gate at [scripts/deploy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:323).
- Keep pushing the gated SHA explicitly to `main`.
- Keep comparing against `origin/main`.
- Keep polling Vercel’s production target.

GitHub’s default branch and Vercel’s production branch are independent settings. Changing GitHub’s default affects new clones, PR defaults and default-branch automation; it does not inherently move Vercel production away from `main`. [Vercel Git deployments](https://vercel.com/docs/git), [GitHub branches](https://docs.github.com/en/pull-requests/reference/branches).

The missing consequence is chiefly stale `origin/HEAD`, covered above.

9. **Medium — migration policy is sufficient only if an automated ledger guard is mandatory.**

A migration lease prevents simultaneous execution; it does not stop two branches independently producing `0037_*`. `drizzle-kit check` on each branch cannot detect that cross-branch collision.

For v1, you do not need a central allocator, but landing/rebase must automatically reject:

- Duplicate migration numbers.
- A database ledger that is not an exact prefix of the checkout’s migrations.

The migration wrapper must perform that ledger check before applying anything and hold the lease through verification. Without that, policy alone is too quiet to trust.

10. **Low/medium — the Dropbox xattrs are reasonable, but not the whole containment story.**

Using both current File Provider and legacy Dropbox ignore attributes is sensible. Git writing into a locally ignored directory is not inherently unsafe. Verify the attributes after creation and after any parent-directory recreation.

The more immediate danger is not Dropbox—it is Vite, typecheck and other repo scanners entering the nested trees.

## Claims summary

- **Claim 1:** Accept. Delete the cache design.
- **Claim 2:** Revise. Native isolation is useful, but native cleanup is incompatible with valuable ignored outputs.
- **Claim 3:** Accept. One `npm ci --prefer-offline` mechanism works on both systems; pin tooling and test platform-specific paths.
- **Claim 4:** Mostly accept. The deployment-code change is small, but default-branch migration and Preview controls are not.

For isolation verification, make a disposable-repository canary part of Claude upgrades: attempt absolute-path edits, `git -C`, `GIT_DIR`, `--git-dir`, shell `cd` and symlink escapes; assert that the main-checkout canary remains unchanged and that the active worktree is locked. That turns the documented guarantee into a check you have actually seen reject unsafe operations.

No files changed.