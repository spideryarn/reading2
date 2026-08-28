Verdict: revise before building. The CoW cache is justified at the stated scale, but the current cache key, locking, removal guard, and failure table are not yet safe.

I reviewed the current file at SHA-256 `3766e764…d7f5bd7`.

## 1. Dependency decision

Keep the fingerprint cache, but make it smaller.

At ten worktrees:

- Plain installs: about 6.25 GB.
- One 625 MB cache plus ten 29 MB clones: about 0.92 GB.
- Saving: about 5.3 GB.

That matters on a 91%-full disk and across repeated worktree creation. The plan’s “8.1 GB becomes 0.9 GB” arithmetic is unexplained and should be corrected.

The smallest correct cache is:

1. Compute a versioned fingerprint.
2. Take one blocking, atomic lock for that fingerprint.
3. Recheck for a completed entry.
4. Run `npm ci` directly in a cache staging directory.
5. Run exact smoke checks.
6. Atomically rename staging into place.
7. Clone it into the worktree.

Drop the non-blocking lock and 21-day TTL pruning from v1. A non-blocking lock either causes ten simultaneous installs or requires another underspecified path. Add an explicit cache-prune command later.

## 2. Fingerprint inputs

The proposed fingerprint at [worktrees.md:216](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/worktrees.md:216) is incomplete.

Include:

- `package-lock.json`
- `package.json`
- project `.npmrc`, if present
- full Node version and module ABI, not only the major
- full npm version, not major/minor
- platform, architecture, and libc
- a cache-format version
- the normalized install-shaping configuration: `omit/include`, optional dependencies, install strategy, `legacy-peer-deps`, `install-links`, `bin-links`, CPU/OS/libc overrides, and every script-policy setting

npm explicitly warns that `npm ci` must use the same tree-shaping flags used to create the lockfile. [npm ci documentation](https://docs.npmjs.com/cli/commands/npm-ci/)

More importantly, the plan’s root-lifecycle reasoning is wrong. The lockfile contains five dependencies with install scripts, including esbuild, Sentry CLI, and fsevents. Root scripts are irrelevant to those. npm 11’s `allowScripts`, `strict-allow-scripts`, `ignore-scripts`, and `dangerously-allow-all-scripts` can produce different installed trees while `npm ci` still exits successfully.

Commit the intended script policy into `package.json`/`.npmrc`, make unreviewed scripts fail closed, and run installs with a sanitized, explicit configuration. That is better than attempting to hash arbitrary user configuration. [npm script-policy documentation](https://docs.npmjs.com/using-npm/config/)

The current Sentry installation is usable: `node_modules/.bin/sentry-cli --version` returned `2.58.6` because the platform package supplies its binary. Add that exact command to the cache smoke test anyway. “One `.bin` shim resolves” proves almost nothing.

## 3. Mutable directories

Deleting `.vite`, `.vite-temp`, and `.cache` is sufficient for the difference actually measured, but a denylist is the wrong invariant.

Publish only a pristine staging tree immediately after `npm ci`, before Vite, tests, or application commands can touch it. Then no cleanup list is required.

Do not recursively delete directories named `cache`; this tree contains legitimate package source such as `drizzle-orm/cache` and `undici/lib/cache`.

## 4. Moving out of Dropbox

`git worktree repair` is the correct Git mechanism. Git explicitly supports moving the main worktree while retaining linked worktrees. [Git worktree documentation](https://git-scm.com/docs/git-worktree)

Do not require removing ten useful worktrees. Instead require a quiesced move:

1. Stop agents, Git commands, servers, and editors using the old absolute path.
2. Record `git worktree list --porcelain`.
3. Move the primary atomically.
4. Run `git worktree repair` using the recorded paths, not a shell glob.
5. From every worktree, verify `status`, branch, common Git directory, and registered path.
6. Restart sessions against the new workspace path.

The bigger interim risk is that `.git` remains Dropbox-synced while ten worktrees write refs and administrative state. `git fsck` cannot detect Dropbox replacing a ref with an older but valid value. Since local `main` was already 97 commits ahead of `origin/main` during this review, add a verified bundle or other backup outside Dropbox before rollout.

## 5. False-success holes

Several failure-table rows do not currently fire:

- Row 1: printing a SHA does not detect the wrong base. Resolve expected `main`, create the branch, then assert its actual `HEAD` equals that captured SHA. The hardcoded “83 commits” was already 97 during this review.
- Row 2: the existing deployment lock is not atomic: [deploy.ts:281](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:281) checks existence and then opens with `"w"`. Two processes can both acquire it. The new lease must use atomic `mkdir` or `open(..., "wx")`, and DB tests must hold it for the whole suite.
- Row 4: same-device proves only that cloning is possible. It does not prove `cp -c` did not fall back for another reason.
- Row 5: `strictPort` makes the second server fail, but a browser can still connect to the first worktree’s live server. Use an atomic port lease and expose a worktree identity that browser checks can verify.
- Row 5b: the new allow-list section is right, but work order step 2 omits updating `config.toml`, restarting Supabase, and checking the live container. The repo already documents that the file is not re-read automatically at [setup-dev.md:59](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/setup-dev.md:59).
- Row 7: the smoke test is too weak. Check Vite, tsx, Vitest, esbuild, Sentry CLI, and the exact embedded lockfile/fingerprint.
- Row 8: “rebase before generating” does not stop two branches generating the same migration number concurrently. `drizzle-kit check` in each branch sees only its own valid history. Schema work needs branch-level exclusivity or collision detection after rebasing.
- Row 10: “treat it as exclusive” is policy, not detection. Copying mutable `data/` can also capture a torn snapshot while another process writes it.
- Row 11: `fsck` cannot detect a valid ref rollback.
- Row 12 is wrong: `data/` is ignored and untracked, as is `.env.local`. A clean status plus ancestor check can report safe and then delete valuable generated work. Save a baseline manifest at creation and refuse removal when ignored state has changed, unless an explicit discard flag is supplied.

Also pass `--no-track` explicitly and verify the agent branch has no upstream.

## 6. Scope and order

Use this order:

1. Fix deploy cleanup; classify each ghost before removing it.
2. Define the deterministic npm install contract and minimal cache.
3. Implement ports as one unit: atomic lease, Vite strict port, Supabase allow-list, live-container verification, browser identity.
4. Implement the DB lease and fail-closed DB tests.
5. Implement `new`, `doctor`, and `rm`, including ignored-file protection.
6. Update docs alongside each change, not as a final batch.
7. Later: quiesced Dropbox move and repair verification.

Keep the cache, READY marker, strict ports, DB lease, and doctor. Cut TTL pruning and non-blocking cache publication from v1. Do not release worktree creation before the shared-DB and removal safeguards exist.

No files were changed.

