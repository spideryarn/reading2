# Code review, stages 2 and 3: the screenshot prune, and the rebuild docs

You are reviewing the uncommitted and committed work in this worktree that is NOT stage 1 (stage 1
is `e9cdab571` plus your own review fixes, already read). The plan is
`docs/plans/261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md`.

**Stage 2**: `scripts/prune-old-screenshots.ts` and `tests/prune-old-screenshots.test.ts`.
**Stage 3**: the "whole sequence" subsection under `## Rebuilding` in `infra/hetzner/README.md`;
`## Keeping the disks from filling` in `docs/project/hetzner-remote-server-box.md`; the additions
under `### Keeping /home from filling` in `docs/project/overseer.md`; and one change of mine to
your stage 1 work: `infra/hetzner/box-tidy.mjs` now skips a process whose `/proc/<pid>/stat` state
is `Z` (the box has 254 zombies and your stricter scan otherwise never deletes anything), with two
tests, and the provisioning check for the dry run now runs under the unit's capabilities.

**You may fix what you find in `scripts/prune-old-screenshots.ts`, its test, and the zombie
handling in `box-tidy.mjs` (keep the `provision.sh` heredoc byte-identical; the tests check).**
Each fix narrow, with a test that fails first. For the three docs, report and do not edit: two of
them are runbooks whose wording other agents act on. Do not run the prune script with `--apply` in
this worktree or anywhere but a temporary repository you made. Do not commit. Do not write any
sentence attributed to Greg.

Look hardest at:

1. **Can `--apply` commit anything other than the deletion of the listed screenshots, or lose a
   peer's work?** It runs in a checkout other agents share: a peer may have files staged, unstaged
   edits, an in-progress merge, or may commit between this script's steps. Check the empty-list
   path, the dirty check (`git status --porcelain -z` on the folders, intersected in JS), the
   re-computation, the unlink loop, the commit, and the `git restore` on commit failure. Is that
   restore safe under this repo's rule against git commands that throw work away (AGENTS.md)?
2. **Is "untouched for 7 days" computed correctly?** `git log -m --no-renames --name-only -z
   --format=%x01%ct%x01`, parsed by splitting on `\x01`. A file name containing `\x01` or a
   newline; a commit touching no listed path; an empty repository; a shallow clone; the 512 MB
   buffer. A dry run on the real repository lists 113 files, 18.7 MB, of 871 tracked images, which
   surprised me: say whether `-m` is making recently merged-through files look new in a way that
   defeats the purpose, and whether there is a definition that is both safe and useful.
3. **The zombie skip**: is state `Z` in `/proc/<pid>/stat` sufficient to conclude the process
   holds no files? Any process state for which that is wrong?
4. **The rebuild sequence** in the README: read it as somebody doing the rebuild. Which step is
   wrong, missing, in the wrong order, or cannot be checked as written? Check every command and
   link it names against the repo.
5. **The two runbook additions**: any claim that the code does not bear out.

Numbered findings, each P0/P1/P2 with file and line, saying whether you fixed it (and the test) or
are reporting it. One-line verdict at the end.
