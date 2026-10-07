# Box follow-ups: `/tmp` at 7 days, the Overseer under systemd, compressed screenshots

Up: [plans.md](../project/plans.md) · follows
[261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md](261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md),
whose "Decided 2026-10-07" paragraph is the approval: Greg, *"yes to all"*, to `/tmp` ageing out
after 7 days rather than 30, the daemon under `overseer.service` with its key in a root-readable
`EnvironmentFile` at `/etc/overseer-secrets.env`, and screenshots compressed.

Three jobs on the Hetzner box. Each change to the box is also a change to
`infra/hetzner/provision.sh` and `infra/hetzner/README.md`, so the next box gets it. Reviewed by GPT
Sol before building ([prompt](261007j-box-followups-plan-review-prompt.md),
[answer](261007j-box-followups-plan-review-sol.md)); what changed is under
[Sol's plan review](#sols-plan-review).

## 1. `/tmp` ages out after 7 days

**What is there** (measured 2026-10-07): 824,000 top-level entries, nearly all `mkdtemp`
directories that tests leave behind. systemd's own rule is `D /tmp 1777 root root 30d` in
`/usr/lib/tmpfiles.d/tmp.conf`; `/tmp` is on `/` (`relatime`), and is emptied at every boot.

**The change** is one file,
[`infra/hetzner/tmpfiles.d/tmp.conf`](../../infra/hetzner/tmpfiles.d/tmp.conf), installed as
`/etc/tmpfiles.d/tmp.conf`, which replaces the packaged file of the same name (tmpfiles.d(5)), so
the 30-day line is no longer read. `systemd-tmpfiles-clean.timer` already runs it daily. No deleter
of our own: box-tidy's `/tmp` step stays report-only, for the reasons in Sol's review of the
previous plan. tmpfiles does not cross mount points or follow a descendant's symlink (Sol checked
v255's source), and it ages every entry, not only the top directory, so a directory holding one
fresh file keeps that file and the directories above it. What it does not do is keep an old
**sibling** of a fresh file, which is why the table below matters.

**What must survive a week untouched, from a scan of every live process's open files, working
directory and `--user-data-dir` under `/tmp`, run as root:**

| Path | What it is | Done |
| --- | --- | --- |
| `/tmp/claude-*` (8.4 GB) | Claude Code's per-session scratchpads. Three live tmux loops run scripts from the Overseer's | **30 days**, as before, by a line of its own. Not excluded altogether, which would leave 8 GB for the next reboot. The loops should move to the repo copies in `scripts/overseer-tools/`: in the debrief, the Overseer's switch |
| `/tmp/playwright_chromiumdev_profile-*`, `com.google.Chrome.*`, `.org.chromium.Chromium.*` | Browser profiles and singleton directories the MCP browsers make. Chrome writes its `SingletonLock` once, at start | **30 days**, as before. None was live on the day; 969 leaked ones came to 102 MB |
| `/tmp/tmux-*` | tmux's socket, created 2026-08-31 and never touched since. Delete it and every running session is unreachable | **Never aged** (`x`) |
| `/tmp/codex-bwrap-synthetic-mount-targets-*`, `codex-daemon-*` | Codex's sandbox mount points and daemon directory | **Never aged** (`x`): small, not a leak |
| `/tmp/tsx-1000` (75,000 pipes) | tsx's IPC sockets. A child connects once at start and ignores a missing one (read in `node_modules/tsx/dist/client-*.cjs`) | 7 days |
| `/tmp/fbsweep*` | Scratch written by feedback-sweep sessions, each run under three hours | 7 days |
| Worktrees | Under `/var/tmp/spideryarn-worktrees/`; `/var/tmp` has no ageing rule | Nothing |
| `/tmp/systemd-private-*`, X11 sockets, snap | Already excluded by the packaged rules | Nothing |

Both the `e` line's own age (in either direction) and the `x` on a socket were checked against
`systemd-tmpfiles --clean`; `tests/systemd-units.test.ts` now does it with the real file's lines
moved under a scratch root and its ages shrunk, and goes red with the scratchpad and tmux lines
removed.

**Switching it on**: one manual `systemd-tmpfiles --clean --prefix=/tmp` under `nice` and
`ionice -c3`, with both disks and the dashboard's and the daemon's health read before and after.
**The real fix is still tests that clean up after themselves** (queue item `qi-4b5598e2`), not done
here.

## 2. The Overseer daemon under `overseer.service`

`overseer.service` exists in `provision.sh` already, is installed here, and is disabled. The daemon
runs in tmux window `overseer-daemon-2319`, from a launch script that reads `OPENROUTER_API_KEY`
out of `.env.local`.

**The key.** A second `EnvironmentFile=/etc/overseer-secrets.env`, root-owned, mode 0600, holding
one `OPENROUTER_API_KEY=` line. systemd reads it as root before it drops to `User=greg`. No agent
can read the file without `sudo`, which they have; every agent can read the running daemon's
`/proc/<pid>/environ`, as under tmux, so this is no regression and no great gain either. **No
leading `-`**: a missing file stops the unit, the refusal `daemon-launch.sh` already made. The
arming file `/etc/overseer.env` stays separate and 0644: one is a decision, the other a secret.
Copied from `.env.local` by a root script with `umask 077`; what was printed was the line count,
whether the value is plain `[A-Za-z0-9_-]` (so systemd's unquoting cannot change it), whether it
matches the source, the owner and mode, and then the key's **length** as a transient unit running as
`greg` with that `EnvironmentFile=` saw it: 73, the same as the source. `provision.sh` never
creates it; the rebuild sequence has the step, and the verify block checks its owner and mode if
it is there.

**The start limit.** It was `StartLimitIntervalSec=300`, `StartLimitBurst=10`, `RestartSec=5`:
ten failed starts in fifty seconds and the unit is `failed` for good, which is what a disk full for
an hour does. Now `StartLimitIntervalSec=0` and a fixed `RestartSec=30s`: it retries twice a minute
for as long as the cause lasts. *Passed over*: a growing delay (`RestartSteps=`), because systemd
255 keeps its counter across healthy runs, so after a few crashes spread over weeks every crash
would wait the longest delay; and the watchdog running `reset-failed`, which needs root for a state
the unit can no longer reach.

**The test**, [`infra/hetzner/test-overseer-restart.sh`](../../infra/hetzner/test-overseer-restart.sh):
a transient unit (`systemd-run`, nothing under `/etc`), run as `greg`, with the restart settings
read out of the unit file. Recovery means active, the write done, and the same PID ten seconds
later. Three runs on 2026-10-07:

- **disk full** (a 64 kB tmpfs, filled; the command's write fails with `ENOSPC`) for five minutes:
  10 restarts, never `failed`, stably up once the filler was removed;
- **key file missing** (a required `EnvironmentFile=` that does not exist, which fails before the
  command runs, a different path): the same, once the file was created;
- **the old settings** with the disk full, which must be red: `failed` after 10 starts, systemd's
  "Start request repeated too quickly" in the journal, and still down after the space came back.
  (systemd 255 leaves `Result=exit-code` here, not `start-limit-hit`, so the journal line is what
  the script checks.)

**The watchdog and `tick.sh`.** The watchdog prints a second line, the unit's state, sub-state,
`NRestarts` and enablement from `systemctl show` (no root needed), so "heartbeat stale" comes with
"activating (auto-restart), 14 automatic restarts". Its exit code stays the heartbeat's: a fresh
heartbeat with the unit inactive is the daemon running some other way. `tick.sh` prints the same
four properties.

**`overseer-activate.ts`**, the existing one-command activation, gains three things. A blocker if
the unit does not read the key file, or the file is missing, not root 0600, or has no non-empty
plain key line (the dry run as `greg` cannot read it and says so). A failure if the unit's journal
since the restart has the daemon's own `attention: off`, or cannot be read. And **the store path
read out of the unit**: it used `$HOME`, which under `sudo` is root's, so the documented command
would have looked for the tmux daemon's lock in `/root/.overseer`, found none, and restarted
systemd into a lock fight (Sol's finding 2, confirmed by a dry run under `sudo` that now prints the
unit's store and the tmux daemon's pid).

**I do not stop the running daemon.** The Overseer gets the cut-over steps:

1. In the primary, after merging `dev`: `sudo npx tsx scripts/overseer-activate.ts --disarm`, the
   dry run. Read the plan: it should list writing `/etc/overseer.env` disarmed (this box has none,
   and the tmux daemon has no `OVERSEER_JOBS_ENABLED`, so disarmed is today's state), installing the
   unit, and `kill -TERM` of the tmux daemon's pid; and no ✗.
2. `sudo npx tsx scripts/overseer-activate.ts --disarm --apply`. It stops the tmux daemon by its
   lock, waits for the lock, enables and restarts the unit, and verifies.
3. Check: it ends `overseer-activate: OK`; `systemctl is-active overseer` is `active`;
   `npx tsx scripts/overseer.ts diagnose` names one live daemon; `journalctl -u overseer -n 30` has
   no `attention: off`; `npx tsx scripts/overseer-watchdog.ts` is healthy and its unit line says
   `active (running)`. Then close tmux window `overseer-daemon-2319`.
4. If it fails: `sudo systemctl disable --now overseer`, then the command in `daemon-launch.sh`'s
   header, which is unchanged.

## 3. Compressed screenshots

787 tracked PNGs under `docs/`, 136 MB a checkout. `pngquant --quality=85-98 --skip-if-larger
--strip --speed 1` over all of them, into a scratch directory: 775 shrink, 12 would not, **136 MB →
54 MB**. (`70-95` gave 53 MB; not worth the lower floor.) Checked by eye at 1:1 and on 3× crops of
small light text and of grey text on near-black: indistinguishable, mean per-channel difference
under 0.2 of 255.

**[`scripts/compress-screenshots.ts`](../../scripts/compress-screenshots.ts)**: with paths, those
files; with none, every **tracked** PNG under `docs/` that is not yet done, never an untracked one,
because the primary holds other agents' screenshots. In place and atomic. "Done" is a property of
the bytes, so there is no list to go stale when the prune script deletes files: a palette image
(what pngquant writes), or one carrying a `tEXt` chunk saying pngquant was tried and could not
shrink it, **with a hash of the image data**, so an edited image is tried again. Only pngquant's
two expected skips, 98 (larger) and 99 (quality floor), earn the mark; any other exit is an error.
`npm run screenshots:compress -- <file>`.

**New ones**: `tests/screenshots-compressed.test.ts` fails on a tracked PNG under `docs/` that is not
done, and names the command; `browser-control.md` tells whoever saves a screenshot. **An advisory
gate, not a guarantee**: it sees what is tracked when the suite runs, and a commit can carry a file
changed after it. *Passed over:* a pre-commit hook, which needs `core.hooksPath` in every clone and,
if it rewrote files, re-staging into the temporary index `git commit -- <paths>` uses; and
compressing in the screenshot helpers, of which there is no one (agents shoot with the MCP tools
and a dozen scripts).

**The existing files** are committed in batches of about 150, by name, each through
`check:staged-revert`. History keeps the old blobs: this shrinks every checkout, not `.git`.

## Sol's plan review

| # | Finding | What changed |
| --- | --- | --- |
| 1 (P1) | Live browser profiles were missing; a fresh file does not save an old sibling | Audited every live process's `/tmp` files; browser profiles at 30 days; first run with `--prefix=/tmp`, health watched |
| 2 (P1) | Under `sudo` the activation looks in root's store, misses the tmux lock | Store read out of the unit; dry run under sudo confirms |
| 3 (P1) | Old start limits alone with the new back-off would not go red | The `--old` run restores the whole old policy; it went red. (The back-off is gone anyway, finding 6) |
| 4 (P1) | Including untracked PNGs fails every agent on peers' screenshots, and the compressor rewrites them | Tracked only; new ones by name |
| 5 (P2) | An empty key passes "has a line"; "no agent can read it" ignores sudo | Preflight requires a non-empty plain value; wording corrected |
| 6 (P2) | systemd's back-off counter never resets after a healthy run | Fixed `RestartSec=30s`, Sol's simpler alternative |
| 7 (P2) | One look at `active` proves nothing; a missing `EnvironmentFile=` fails elsewhere | Stable PID plus the write; a `--env` run added |
| 8 (P2) | The `tried` mark can outlive the pixels it certifies | Bound to a hash of the image data, with a test |
| 9 (P2) | 70 is a low floor | `85-98`, which costs 1 MB in 54 |
| 10 (P2) | A test cannot guarantee nothing uncompressed is committed | Called advisory; hook passed over, above |

## Sol's code reviews

Two write-capable runs in parallel on disjoint files: stages A and B
([prompt](261007j-box-followups-code-review-ab-prompt.md),
[answer](261007j-box-followups-code-review-ab-sol.md)) and stage C
([prompt](261007j-box-followups-code-review-c-prompt.md),
[answer](261007j-box-followups-code-review-c-sol.md)). Their fixes, all kept, each seen red first:

- **The attention check could pass on an empty journal**, and flooring the restart time to the
  second could pick up the old daemon's warning. It now reads only the current invocation's journal
  (`_SYSTEMD_INVOCATION_ID`) and needs the daemon's `scheduler:` startup line, which it prints after
  the `attention:` line, before it believes the absence of `attention: off`.
- **The key file must hold exactly one assignment**: a second line could empty the key or override
  the unit's store or arming. Mode exactly 0600.
- **`e /tmp/claude-*` kept Claude's `claude-<hex>-cwd` files for ever**: a path with its own line is
  skipped by the parent, and `e` cleans only directories. Narrowed to numeric uid directories.
- The tmpfiles test now uses idle ordinary files (a live socket survived without its exclusion), and
  the provisioning check rejects a shadowed or duplicated `/tmp` rule.
- The compressor refuses animated and 16-bit PNGs, a path outside the checkout or a symlink, an
  unknown option, and a source changed under it; validates chunk CRCs; keeps the file mode; uses a
  private temporary directory. The test skips only when pngquant is absent, not when it is broken.

Reported and then done here: the `tried` mark hashed only IDAT, so adding transparency passed. It
now hashes every chunk that affects rendering (`tried v2`), re-marking replaces an old mark, and the
five marked files were re-marked; the gate went red on exactly those five first. And two calls in
`tests/overseer-scheduled-dispatch.test.ts` lacked the new `attentionOffSinceRestart`, which my
first typecheck run hid behind a `tail`.

## Log

- 2026-10-07: planned, reviewed, built, code-reviewed. `/etc/overseer-secrets.env` created (root
  0600; a transient unit as `greg` saw a key of the source's length). Restart test green in all
  three modes.
- 2026-10-07 11:07–11:22 UTC: `/etc/tmpfiles.d/tmp.conf` installed, the 30-day rule confirmed no
  longer read, and one `systemd-tmpfiles --clean --prefix=/tmp` under `nice`/`ionice -c3`: 880 s,
  **`/` from 85% to 68% (46 GB free to 93 GB)**. Dashboard 200, tmux socket and the Overseer's
  scratchpad present, the daemon's heartbeat fresh throughout. The top-level entry count did not
  fall (826,251): emptying a directory refreshes its mtime, so the empty directories go on the next
  daily run. 928 "Opening file … SingletonSocket failed, ignoring" lines: dead Chrome sockets,
  which tmpfiles tries to probe for a listener and skips.
- 769 screenshots compressed in six commits, 135 MB to 53 MB a checkout; three more from a peer
  after the merge.
- Not done here: the Overseer's cut-over to `overseer.service` (its switch; the steps are above).

## Order

Stage A: `/tmp`. Stage B: the unit, the test, watchdog, tick, activate, docs. Stage C: the script,
the test, the batches. A Sol code review per stage; push to `dev` at the end.
