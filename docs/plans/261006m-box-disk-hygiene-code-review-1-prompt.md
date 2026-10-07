# Code review, stage 1: the box's hourly disk tidy, and /home in the health verdict

You are reviewing commit `e9cdab571` (`git show e9cdab571`) in this worktree. The plan is
`docs/plans/261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md`; your own plan review is
`docs/plans/261006m-box-disk-hygiene-plan-review-sol.md`, and the plan's table "Sol's plan review"
says what was done about each finding.

**You may fix what you find, inside this stage's files**: `infra/hetzner/box-tidy.mjs`,
`infra/hetzner/systemd/box-tidy.*`, `tests/box-tidy.test.ts`, the box-tidy parts of
`infra/hetzner/provision.sh` and `tests/systemd-units.test.ts`, `tools/fleet/health.ts`,
`tools/fleet/web/src/health-view.ts`, `tests/fleet-health-home-disk.test.ts`, and
`scripts/overseer-tools/`. Each fix narrow, with a test that fails before it. If you change
`box-tidy.mjs` or a unit file, the heredoc in `provision.sh` must be made to match byte for byte
(the tests check). Report, and do not fix, anything wider. Do not run `provision.sh`, do not
install or start any systemd unit, do not delete anything outside a temporary directory you made,
and do not run the tidy script without `--dry-run` against the real home or `/tmp`. Do not commit.
Do not write any sentence attributed to Greg.

This script deletes files hourly with nobody watching, on a box running about twenty agent
sessions as one user. The bar is: it must not delete live work. Look hardest at:

1. **The `/tmp` step, which was added after your plan review and so has had no review.** It removes
   directories directly under `/tmp` whose name ends in six mkdtemp-looking characters
   (`looksLikeMkdtemp`), owned by the user, with mtime and ctime both older than 3 days, not under
   `claude-*`/`tmux-*`/`systemd-*`/`snap*`/`ssh-*`/dot names, and with no live process standing in
   or holding a descriptor under them. Background: test runs leave about 50,000 such directories a
   day, `/tmp` is 150 GB, systemd already ages `/tmp` out at 30 days and empties it at boot. A dry
   run on the box found 556,756 candidates. Name a concrete, plausible state of this box in which
   this removes something somebody needed. Is the top-level mtime+ctime test enough given that a
   directory's mtime does not change when a file deep inside it is rewritten? Is `rmSync(recursive)`
   safe against a symlink inside the tree, and against a mount point inside the tree?
2. **`pathsInUse`**: `/proc/<pid>/cwd` and `/proc/<pid>/fd/*` for every process. What does it miss
   (memory-mapped files, a process in another mount namespace such as a Docker container whose
   paths read differently, `(deleted)` suffixes, a process that opens, writes and closes)? Does the
   fail-closed rule hold for every error path? The unit grants `CAP_SYS_PTRACE` and
   `CAP_DAC_READ_SEARCH`; is there a cheaper or safer way to get the same reading?
3. **Races** between the check and the unlink, in each step.
4. **The tests**: `tests/box-tidy.test.ts` uses a fake `/proc` and a clock override
   (`BOX_TIDY_NOW_MS`). Do the overrides open a way for the real unit to delete more than intended?
   Which guard has no test that would fail if it were removed?
5. **`health.ts`**: `parseHomeDisk`, the optional `homeDisk`/`dfHome` fields, both collectors, and
   `computeVerdict`. Is "optional so old fixtures still type" acceptable here or does it hide a
   caller that silently never measures `/home`? Is a `df -k /home` that fails (no such directory)
   handled the way you asked for in finding 8?
6. **`provision.sh`**: the `gh and pngquant` section and the box-tidy install block and verify
   checks. Anything that fails on a re-provision of the existing box, or on a fresh one?
7. **`scripts/overseer-tools/`**: these were copied out of a scratchpad with the hard-coded path
   replaced by `OVERSEER_SCRATCH`. Any script that now misbehaves, or still assumes its old home?

Answer in `docs/plans/261006m-box-disk-hygiene-code-review-1-sol.md` style: numbered findings, each
P0/P1/P2 with file and line, saying for each whether you fixed it (and the test) or are reporting
it. End with a one-line verdict.
