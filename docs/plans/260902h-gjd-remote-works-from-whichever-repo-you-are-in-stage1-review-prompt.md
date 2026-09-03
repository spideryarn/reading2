# Code review: Stage 1 of "gjd-remote works from whichever repo you are in"

Read-only review of CODE that has been built, not prose. Weight this higher than your plan review:
find the handler that writes one field and then rejects the request.

## Read

1. The plan and your own plan review, for what Stage 1 was meant to be:
   `docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md` (sections "GPT Sol's
   plan review, and what changed", "The target contract", "Stage 1") and
   `docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in-review-sol.md`.
2. The scoped diff of everything since the plan was committed, at
   `/private/tmp/claude-501/-Users-greg-dev-spideryarn-reading2/eaf11bc0-8303-409a-abea-7789226536e6/scratchpad/stage1.diff`
   (production code, docs, config, package.json — the tests are NOT in that diff; read them from
   the tree).
3. The files themselves, in this worktree: `scripts/gjd-remote-repo.ts` (identity, inventory
   script, fail-closed parse, resolution), `scripts/gjd-remote-config.ts`,
   `scripts/gjd-remote-prompt.ts`, `scripts/gjd-remote-tmux.ts` (the metadata record),
   `scripts/gjd-remote-log.ts`, and in `scripts/gjd-remote.ts`: `identify()`, `inventory()`,
   `entryAt()`, `remoteCheckout()`, `assertSameRepo()`, `resolveTarget()`, `namedDir()`,
   `onNotFound()`, `cmdResolve()`, `sessionDir()`, `metaFlags()`/`targetRepo()`, `cmdNewClaude`,
   `cmdNewShell`, `cmdLs`, `cmdPushEnv` (the policy map), `cmdDoctor`'s MCP block, `cmdClone`,
   `main()`.
4. The tests: `tests/gjd-remote-repo.test.ts`, `tests/gjd-remote-config.test.ts`,
   `tests/gjd-remote-prompt.test.ts`, `tests/gjd-remote-tmux.test.ts`,
   `tests/gjd-remote-log.test.ts`. Every one was reportedly watched red under a named mutation;
   the agents' mutation tables are in the plan's Log and in the commit messages
   (`git log --format=%B 6dbfc9f..HEAD`).

## Evidence gathered live (2026-09-02)

- `gjd-remote resolve` from this worktree: `repo: spideryarn/reading2 → box: /home/greg/code/spideryarn2 (found by origin, https)`, exit 0. From `/tmp`: not-git refusal, exit 1. From a scratch repo with origin `example/nonesuch`: `absent, proposed /home/greg/code/nonesuch`, exit 1. With `--dir /home/greg/code/spideryarn2` from the nonesuch repo: refused.
- `ls` with twelve legacy sessions: all `(unknown)`, listing not refused. A session made by `new-claude --wait 10m --no-attach` listed as `spideryarn/reading2`. A hand-made `tmux new-session -e GJD_METADATA_VERSION=1 -e GJD_KIND=shell` with no repo: `✗ could not read the box's tmux sessions: session 's1-meta-bad' has GJD_REPO='', which is neither an owner/name slug nor 'unknown'`, exit 1.
- `inventoryScript` was run for real under bash against a temp base on the laptop (a checkout, a symlink to it, a plain dir, a `.git` with no HEAD) and `parseInventory` of its output asserted; emitting six fields instead of seven reddened only that test.

## Questions

1. **Fail-closed, really?** Find any path where an ssh failure, a truncated inventory, an
   undecodable row, or an empty `~/code` reads as `absent` (and would have Stage 3 clone). Check
   `inventory()` in gjd-remote.ts specifically: what does it do with a non-zero ssh exit, stderr,
   and `parseInventory`'s `ok: false`?
2. **The contract as built vs as written.** Does `--dir` for `push-env` verify origin? Does
   `GJD_REMOTE_REPO` refuse on disagreement, and does it refuse when the cwd is NOT a repo (should
   it)? Does `push-env` read `.env.local` from the local target's toplevel via `lstat` and refuse a
   symlink? Does `doctor` read `.mcp.json` from the remote target and skip (not fail) when absent?
   Does `clone` with no argument use the cwd's identity?
3. **`targetRepo()` reports `unknown` for a `GJD_REMOTE_REPO` target even after `assertSameRepo`
   verified its origin.** Wrong, or acceptable?
4. **The metadata record.** Is there a way for a version-1 session to be created with a bad value
   (e.g. a slug with upper case, a relative dir) — and would `ls` then refuse the whole box's
   listing, which is a denial of `ls` caused by one bad `new-claude`? Is that the right trade?
5. **`remoteSlug` de-duplication and symlinks.** Read the inventory script: does `find`/glob follow
   a symlinked directory? Is realpath de-dup correct when the symlink target is OUTSIDE `~/code`?
6. **The config module**: `parseRepoConfig` strictness — any input that passes but should not
   (e.g. a `setup` with a trailing newline, a `check` of `""`, a TOML array)? `readRepoConfig`:
   non-ENOENT errors surface?
7. **The prompt wrapper**: `promptIo()` — can `confirmOrRefuse` ever run with `input` lacking
   `isTTY` and proceed? Ctrl-C ⇒ `Cancelled`: is raw mode restored on every path?
8. **Tests that cannot go red.** Name any assertion in the five test files that no plausible
   mutation reddens.
9. Anything you would refuse to merge.

Numbered findings with severity (blocker / should-fix / nit), file:function, what is wrong, the
concrete change. Then the three you would fix first. No files or remote state may be changed.
