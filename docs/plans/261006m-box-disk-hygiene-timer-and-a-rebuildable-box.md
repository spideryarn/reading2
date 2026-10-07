# Box disk hygiene as a timer, and a box we could rebuild

Up: [plans.md](../project/plans.md) · the box is
[hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md)

Greg, 2026-10-06:

> Yes, old screenshots (>1w) can be deleted - you have permission going forwards. Perhaps add this
> and other measures to keep the hard disk fullness down to some routine daemon/service
>
> And in general make sure we have this and everything else documented/scripted as appropriate so
> that we could easily rebuild this box pretty much the same way.

Two jobs on the Hetzner box. The first turns the disk tidying the Overseer does by hand, from a
script in `/tmp`, into a service. The second finds what is on the box and not in the files that
build the next one.

The first version of this plan was reviewed by GPT Sol before anything was built
([prompt](261006m-box-disk-hygiene-plan-review-prompt.md),
[answer](261006m-box-disk-hygiene-plan-review-sol.md)). It found three P0s and ten P1s, and the
plan below is the revised one. What changed is under [Sol's plan review](#sols-plan-review).

## What was found (measured on the box, 2026-10-06 and 07)

**Disk.** `/home` is the 49 GB volume (53% used, 100% on 2026-10-05); `/` is 301 GB (83%).

| What | Size | What the tidy frees today |
| --- | --- | --- |
| `/tmp` | **150 GB, 806,000 entries** | nothing: 557,203 idle directories are counted, not removed |
| `~/.codex/sessions` | 4.1 GB | 0.46 GB (138 files older than 7 days) |
| `logs/tmux-jobs` in the primary checkout | 98 MB | 0.08 GB (142 files older than 14 days) |
| `~/.npm/_cacache` | 360 MB | 360 MB, only when `/home` is tight |
| Docker images | 11.1 GB, 13 of 14 in use | nothing: reported, not pruned |
| Docker volumes | 17.6 GB | never touched: the local database is in them |
| tracked images under `docs/` | 871 files, 145 MB a checkout, about 20 checkouts | stage 2 |
| `~/.codex/thread_history_1.sqlite` | 2.2 GB | no permission covers it; left alone |
| `~/.claude` | 5.9 GB | Greg excluded Claude's transcripts; left alone |

**`/tmp` is what fills `/`.** Test runs make directories with `mkdtemp` and do not remove them:
about fifty thousand a day (`fake-codex-*`, `launch-fixture-*`, `run-codex-*`, `fleet-transcript-*`
and a hundred other prefixes). systemd ages `/tmp` out after 30 days and empties it at boot, so 150
GB is roughly the steady state of a month of leaks. Nobody had looked, because `df` on `/` said 83%.
Fixing the tests is a separate job, proposed to the Overseer. The tidy was first built to shorten
the wait from 30 days to 3, and the code review turned that into a count.

**The Overseer daemon died of the full disk and nothing noticed.** It stopped at 2026-10-05T00:18Z
with `ENOSPC` and was down 46 hours. It runs in tmux from a launch script in `/tmp`.
`overseer-watchdog.timer`, which checks its heartbeat every five minutes, is in `provision.sh` and
was never installed on this box, because **`provision.sh` last ran here on 2026-09-03**. Its verdict
would only have reached the journal anyway.

**The fleet dashboard already measures disk, but only `/`.** `tools/fleet/health.ts` ran `df -k /`
and raises *strained* at 90% and *critical* at 97%. The Overseer's tick and the launch gate read
that verdict. `/home`, the disk that fills, was not in it.

**The local database is on the disposable disk.** `provision.sh` said Supabase bind-mounts its data
under `~/.local/state/supabase` on the persistent volume. It does not: the database and storage are
Docker named volumes under `/var/lib/docker`, and that directory in `~` does not exist. A rebuild
loses every locally ingested article. Found by Sol's review, confirmed with `docker volume ls`.

**Rebuild gaps** (a read-only audit by a subagent): `gh` and `pngquant` installed by hand; the
Overseer's working scripts and three tmux loops live only in a `/tmp` scratchpad; `/etc/github-tokens`
is on the disposable disk and the rebuild steps do not say to restore it; `.env.prod`, the Vercel
CLI login and the Stripe CLI have no written restore step; `fleet-dashboard.service` is enabled on
the box and left disabled by `provision.sh`; `overseer.service` the reverse.

## Stage 1: the tidy service, and `/home` in the health verdict

**`infra/hetzner/box-tidy.mjs`**, run hourly by `box-tidy.timer`. One file, Node built-ins only,
installed by `provision.sh` to `/usr/local/lib/spideryarn/` and run by `/usr/bin/node`, so it works
when the checkout is mid-merge or has no `node_modules`. It prints to stdout, so the log is the
journal (`journalctl -u box-tidy`), on `/`, writable when `/home` is full. `--dry-run` deletes
nothing.

What it deletes, and whose words permit each
([overseer.md § Keeping `/home` from filling](../project/overseer.md#keeping-home-from-filling)):

1. **Codex transcripts** older than 7 days: `rollout-*.jsonl` under `~/.codex/sessions`, then the
   directories left empty.
2. **Captured stdout of finished tmux jobs** older than 14 days: `logs/tmux-jobs/*.log` in the
   primary checkout, and nothing else under `logs/`. The rest holds loop ledgers and hand-written
   judgements that exist nowhere else, which `scripts/worktree-check.ts` already protects.
3. ~~Directories directly under `/tmp` that `mkdtemp` made and that have been idle for 3 days.~~
   **Counted and reported, not removed**, since the code review
   ([below](#sols-code-review-of-stage-1)).
4. **The npm download cache**, only when `/home` is at or above 80%: `npm cache clean --force`.

Three guards on every delete. Only what the user owns, never through a symlink. Never a path a live
process has open or is standing in, read from `/proc`; if any process cannot be read, nothing is
deleted and the journal says so. The age is checked again just before the unlink.

Not done by the timer, and printed as a hint when a disk is at 80% or more: worktrees
(`worktree:sweep` then `worktree:remove`, by a session), Docker (`docker system df`), screenshots
(stage 2). Scratchpads are never deleted.

The unit is a system unit with `User=@USER@` and two read-only capabilities,
`CAP_SYS_PTRACE` and `CAP_DAC_READ_SEARCH`. Both turned out to be necessary on the box: without the
first, `systemd --user` cannot be read; without the second, pid 1's descriptors cannot be listed;
and either way the script correctly deleted nothing. The readable copies are under
`infra/hetzner/`, and `tests/box-tidy.test.ts` and `tests/systemd-units.test.ts` hold them equal to
the heredocs in `provision.sh`. The tests run the real script against a temporary home, a temporary
`/tmp` and a fake `/proc`, and five of its guards were each removed in turn to see a test go red.

**The alert uses the channel that exists.** `health.ts` runs a second command, `df -k /home`, into
a new `homeDisk` reading beside `disk`. The verdict uses the same thresholds and names the mount
(`/home is 91% full`), so it reaches the Box health strip, the Overseer's tick and the launch gate
with no new mechanism. A machine where `/home` is not its own filesystem reads `none` and gets no
row. The 24-hour history chart still draws `/` only. *Passed over:* a status file written by the
tidy timer, which would be a second reading of the same number, an hour stale.

**The daemon that stopped.**

- `scripts/overseer-tools/daemon-launch.sh`: the `/tmp` launch script, in the repo.
- `overseer-watchdog.timer` installed and started on this box.
- `scripts/overseer-tools/tick.sh` prints both timers' state and each service's last result, so a
  stopped daemon is seen at the next half-hourly tick. **That is what would have alerted within the
  hour, and it depends on the Overseer session running its tick.** Nothing alerts if that session
  is gone too.
- **For Greg, not built:** the daemon under `overseer.service` with the key in a root-readable
  `EnvironmentFile`. Sol's correction: `Restart=always` alone would not have saved it. The unit
  gives up after ten failed starts in five minutes, so a disk full for an hour leaves it `failed`
  after the space comes back, and something still has to run `systemctl reset-failed` and start it.

## Stage 2: old screenshots, as a script the Overseer runs

**`scripts/prune-old-screenshots.ts`**. Lists tracked image files (`png jpg jpeg webp gif`) under
the five dated folders (`docs/plans`, `investigations`, `postmortems`, `research`, `user-feedback`)
that no commit has touched in the last 7 days. Not `docs/project`, `docs/tutorials` or
`docs/reusable`, whose images are part of a living page.

**"Touched" is defined conservatively**: by committer date, across the whole history, with merges
counted (`git log -m`, renames off). So an old branch merged yesterday, a rename, and a
merge-resolution edit each make the file recent. Each is a test against a temporary repository.

With no flag it prints the list and the bytes. With `--apply` it runs `check:staged-revert`,
refuses during a merge or if any candidate differs from `HEAD`, deletes the files and makes one
commit of exactly those paths (`--pathspec-from-file`, NUL-separated, literal). An empty list is a
no-op, never a commit. It does not push. A daemon must not commit in the shared checkout, so this
is the Overseer's to run, weekly or when a disk is tight.

**For Greg, not built: keep new screenshots out of git at all.** In the debrief.

## Stage 3: the rebuild gaps

- **`provision.sh`**: `gh` from GitHub's apt repository and `pngquant`, each with a line in the
  verify block; the tidy script and units; the false comment about where the database lives,
  corrected.
- **The Overseer's tooling in `scripts/overseer-tools/`**, with a README: `tick.sh`,
  `queue-status.sh`, `release.sh`, `mkq.cjs`, `mkfb.sh`, `daemon-launch.sh`, and the scripts behind
  the two loops running now. The hard-coded scratchpad path becomes `OVERSEER_SCRATCH`.
  `queue-status.sh` loses its own Codex delete, which is the timer's now.
- **One rebuild sequence** in `infra/hetzner/README.md`, signposted from the box doc: before the
  rebuild (dump the local database, copy the tokens), then every step that needs a secret, a
  browser or Greg, in order, with where each secret lives by name and never by value, then the
  services and loops to start, then how to check each. It says plainly that "rebuild" means a new
  server on the same `/home` volume, and lists separately what a new volume would also lose.
- **Written down, not changed:** this box has not been provisioned since 2026-09-03 and what a
  re-run would change; the stale token backup and two stale credential copies in `~`, which are
  Greg's to delete.

**Decided 2026-10-07, Greg ("yes to all"):** `/tmp` ages out after 7 days rather than 30; the daemon moves under `overseer.service` with its key in a root-readable `EnvironmentFile` at `/etc/overseer-secrets.env` (a new place for a secret, approved); screenshots are compressed; the local database is accepted as lost on a rebuild. He also said *"yes delete"* to the three stale copies, and the Overseer deleted them that morning (`/etc/github-tokens/spideryarn.token~`, `~/env-local-backup-cost-all-modes-260903`, `~/code/spideryarn2/.env.local~`; the live originals untouched).

## What done looks like

`npm test` and `npm run typecheck` green; `systemctl list-timers` shows `box-tidy.timer` and
`overseer-watchdog.timer` on this box and each has run once with a result read from the journal; a
Sol code review per stage; pushed to `dev`; nothing deployed and neither the dashboard nor the
daemon restarted by this job. **The `/home` reading reaches the dashboard only at its next restart,
which is the Overseer's**; until then the alert is not live.

## Sol's plan review

All three P0s accepted, and all the P1s bar the part of 6 noted below.

| # | Finding | What changed |
| --- | --- | --- |
| 1 (P0) | Deleting "dead sessions' scratchpads" can delete a live one: a tmux loop running a script from it has no session id in any command line | Scratchpads are never deleted |
| 2 (P0) | Old files under `logs/` include hand-written judgements and loop ledgers | Only `logs/tmux-jobs/*.log` |
| 3 (P0) | The rebuild assumed Docker held nothing persistent | Confirmed false; comment corrected; a dump is step one of the rebuild sequence; whether to move the data is a question for Greg |
| 4 | An old Codex rollout can still be open | The `/proc` guard, and the second age check |
| 5 | Pruning dangling images can race an agent's `docker build` | No Docker pruning; it freed 26 kB |
| 6 | The cleaner depended on the checkout | Standalone file outside it. Not taken: per-step command timeouts beyond npm's, since the other steps run no commands; the unit's `TimeoutStartSec` is the backstop |
| 7 | `enable` without `--now` leaves a timer inactive until reboot | `enable --now` for the tidy; both timers started by hand here and a run of each verified |
| 8, 9 | Two paths in one `df`, and no mount identity | A second command and an additive `homeDisk` reading |
| 10, 11 | "Last commit" undefined across merges; the commit needs the house guards | Stage 2 as written above |
| 12 | Stage 3 listed drift without a sequence | One sequence |
| 13 | `Restart=always` does not restart "as soon as there was room" | The proposal to Greg says so |
| 14 | `npm cache clean` frees `_cacache` (360 MB), not all of `~/.npm` (1.3 GB) | Number corrected |
| 15 | A smaller first version | Taken: worktree sweep stays operator-run |

Added after the review, so not reviewed at plan stage: the `/tmp` step. It went to the code review
with that said, and did not survive it.

## Sol's code review of stage 1

[Prompt](261006m-box-disk-hygiene-code-review-1-prompt.md),
[answer](261006m-box-disk-hygiene-code-review-1-sol.md). Write-capable; it fixed nine findings in
place, each with a test seen red, and reported the rest. Its verdict was *revise before unattended
deletion*. What was done about that:

- **The `/tmp` step is report-only (its P0s 1 and 2), and that is accepted.** An old top-level
  directory says nothing about a file rewritten deep inside it, a stopped investigation may be
  resumed, and `rmSync` can cross a mount point. So the timer counts the candidates (557,203 on
  2026-10-07) and removes none. **The 150 GB in `/tmp` is therefore still there**, ageing out at
  systemd's 30 days. What to do about it is a question for Greg, in the debrief; the real fix is
  tests that remove what they make.
- **Its fixes, all kept:** symlinked roots and ancestors refused; the second check compares device
  and inode, not only age; empty-directory pruning respects a live cwd; a process whose links are
  missing is no longer assumed to have exited; an unmeasured `/home` makes the verdict `unknown`
  rather than `ok`; the unit unsets every `BOX_TIDY_*` test override; `dashboard-refresh.sh` no
  longer runs `git merge --abort` over somebody else's merge.
- **Its stricter process scan stopped the tidy from ever running here, found by the dry run on the
  box.** The box had 254 zombie processes, and each read as "cannot read process". A zombie has
  exited and holds nothing, so state `Z` in `/proc/<pid>/stat` is now skipped, with a test. The
  provisioning check was the one Sol asked for in finding 13 and would have caught this: it runs
  the dry run under the unit's capabilities and fails on `NOTHING DELETED`.
- **Reported and not fixed, and why that is acceptable for what is still deleted** (findings 3
  and 4): the scan does not see memory-mapped files or a path seen under another name inside a
  container, and one snapshot of `/proc` cannot rule out a file opened a moment later. What the
  timer still deletes is a Codex transcript untouched for a week, a job's captured output
  untouched for a fortnight, and a download cache. Greg permitted the first *"any time"*, with no
  guard at all, and the Overseer had been doing it with a bare `find -delete`. The guards make a
  loss unlikely; they do not make it impossible, and this says so rather than claiming otherwise.
- **Not taken:** a separate privileged helper for reading `/proc` (finding 15). The user already
  has passwordless sudo on this box.

## Sol's code review of stages 2 and 3

[Prompt](261006m-box-disk-hygiene-code-review-2-prompt.md),
[answer](261006m-box-disk-hygiene-code-review-2-sol.md). Verdict: *changes required*, for two
things it reported and could not fix. Both are now dealt with.

- **Its fixes to the prune script, all kept** (2 to 6): recovery after a failed commit recreates
  only the missing files from saved bytes instead of `git restore`; the candidates' bytes and index
  entries are compared, so an edit hidden by `skip-worktree` or `assume-unchanged` is seen; the
  history is parsed NUL-delimited, so a file name cannot forge a timestamp; a shallow clone is
  refused.
- **Finding 1, the window between the last check and the commit, cannot be closed by a check.**
  So `--apply` now refuses in the primary checkout and runs only in a worktree of the caller's
  own, where nobody else is editing. `overseer.md` says so.
- **Finding 7, zombies again.** Sol showed a zombie leader can have live threads holding files, and
  required `Threads: 1`. On the box that stopped the tidy within minutes: some multi-threaded
  process is always part way through exiting. Its live threads are readable under `task/`, so the
  script now reads them, and takes up to three looks at `/proc` before giving up. Three dry runs
  in a row on the box got through.
- **Finding 8: `db:export` is not a backup.** It leaves out the image bytes in local Storage and
  nothing imports it. The rebuild sequence now says the local database is lost on a rebuild and
  that no tool brings it back, instead of naming a command that looks like one.
- **Findings 9, 11, 12**: `OVERSEER_SCRATCH` goes inside the tmux job's command; the box doc no
  longer says the tidy "never" deletes an open file; the keyless daemon warns once in the journal
  rather than saying nothing.
- **Finding 10, not changed:** counting merges (`-m`) can make an untouched file look new. Sol
  measured its alternative and both select the same 113 files today.

## Log

- 2026-10-06: surveyed, measured, plan written, reviewed by Sol.
- 2026-10-07: plan revised. Stage 1 built: `box-tidy.mjs`, its units, `homeDisk` in the health
  verdict and the dashboard tile. Dry run on the box with the unit's capabilities: 138 transcripts,
  142 job logs (one kept because a loop still has it open), 556,756 temp directories.
- 2026-10-07: both code reviews done and answered. `box-tidy.timer` and `overseer-watchdog.timer`
  installed and started on the box with the commands `provision.sh` runs. First real tidy run:
  138 transcripts and 142 job logs deleted, 0.54 GB, one open log kept, exit 0. First watchdog run:
  `overseer healthy`. Stages 2 and 3 built.
- 2026-10-07: the prune run for real in this worktree: 113 screenshots, 18.7 MB. The full suite
  then went red in one place, `tests/doc-links.test.ts`, and that found two things. Links from a
  plan to its own pruned screenshot are the cost Greg accepted, so the test now exempts exactly
  those. But three of the 113 were shown by `docs/project/skim.md`, a living page, and should
  never have gone: the script now keeps any image whose name is written outside the dated
  folders, and the three were put back before anything was pushed. So 110 deleted.
- 2026-10-07: the same full run showed the tidy's process hides its cwd while it runs, which made
  a worktree removal refuse. It now names itself `box-tidy`, which the liveness scan knows.
- Full suite on the merged tree: 1762 of 1763 files passed, the one failure being the doc-links
  case above, fixed since and re-run on its own. The commits after that run were re-tested by
  file, not by a second eighty-minute full run.
