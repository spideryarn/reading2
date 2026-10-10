1. **P1 — FIXED:** Health alerts could be posted without durable state, duplicated after a state-write failure, or lost if the dashboard was temporarily down. [box-health.ts](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/scripts/box-health.ts:285) now fails closed on unreadable/unwritable state, persists the notification intent before target lookup, and persists the exact envelope before POST. Tests cover full-disk-style write failure, corrupt state, transient dashboard failure, and uncertain replay.

2. **P1 — FIXED:** The daily worktree sweep posted before recording its envelope, allowing a second message after a crash. [worktree-sweep-daily.ts](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/scripts/worktree-sweep-daily.ts:155) now uses a durable waiting/ready state machine and reuses the same request ID after uncertainty. `--no-notify` also no longer consumes the once-only alert state.

3. **P1 — FIXED:** Dashboard refresh could print success after failed Git comparisons or a failed served-SHA write. [dashboard-refresh.sh](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/scripts/overseer-tools/dashboard-refresh.sh:27) now checks `rev-list`, `rev-parse`, state reads, both `git diff` exit classes, and an atomic state write. Shell-harness regressions cover each false-success path.

4. **P1 — FIXED:** Rate limiting definitively types nothing but omitted `delivery: "none"`, so a box alert could remain “uncertain” until its request ID expired. [routes-steer.ts](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/tools/fleet/routes-steer.ts:1128) now reports non-delivery. Quarantine already returned `delivery: "none"` with a durable receipt; replay lookup remains before parsing, limiting and quarantine, preventing duplicate typing.

5. **P1 — FIXED:** The health unit’s PATH omitted `/usr/sbin`, where `swapon` lives on the box, allowing swap collection to fail while the overall verdict still looked usable. [box-health.service](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/infra/hetzner/systemd/box-health.service:32) and its provision heredoc now include system administration paths.

6. **P1 — FIXED:** The renewal fallback skipped sweeping when the timer was enabled but inactive, although provisioning deliberately does not start it. [standing-jobs.md](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/scripts/overseer-tools/standing-jobs.md:36) now requires both enabled and active.

7. **P2 — FIXED:** `systemctl is-failed` output such as `unknown` was treated as healthy. [box-health.ts](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/scripts/box-health.ts:100) now turns unrecognised states into `cannot-tell`.

8. **P2 — FIXED:** Systemd wrappers used `npx tsx`, which could fetch a package when the checkout was incomplete. [dashboard-refresh.sh](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/scripts/overseer-tools/dashboard-refresh.sh:71) and [feedback-sweep-once.sh](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/scripts/overseer-tools/feedback-sweep-once.sh:21) now require the checkout’s installed binary.

9. **P2 — FIXED:** The message route accepted `box` but its validation error still claimed only `greg` and `overseer` were allowed. [routes-steer.ts](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/tools/fleet/routes-steer.ts:519) now reports all three. Runtime speaker rendering, receipts, replay, request envelopes and web parsing were otherwise complete.

10. **P2 — FIXED:** Provision checks and operational docs made stale claims about dashboard enablement, feedback enablement, reminder cadence and notification paths. [provision.sh](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/infra/hetzner/provision.sh:3135) now verifies timer links, service users, working directories, commands and dashboard enablement; the related docs and watchdog text were corrected.

11. **P2 — NOT FIXED:** [security-map.md](/var/tmp/spideryarn-worktrees/standing-jobs-survive-reboot/docs/project/security-map.md:619) says all receipt speaker claims use `parseSpeaker`; message receipts now use `parseMessageSpeaker`. The security conclusion remains correct, but this is a rule document requiring an approved before/after wording change. Recommend changing the reference to “`parseSpeaker`/`parseMessageSpeaker`”.

The plan-review decisions were sound: refusing every dirty primary would disable refresh in normal operation, the explicit remote-tracking ref is safer than shared `FETCH_HEAD`, and retrying a sweep killed mid-command remains an explicit accepted residual. Notification delivery itself now has bounded retries plus durable cross-run replay.

Gate results:

- Requested Vitest command: **PASS** — 6 files, 315 tests.
- Additional route regression suite: **PASS** — combined 7 files, 367 tests.
- Typecheck implementation: **PASS** — all 3,645 source files covered. The literal `npm run typecheck` wrapper was environment-blocked because `tsx` could not create its `/tmp` IPC socket; `node --import tsx scripts/typecheck.ts` ran the same checker successfully.
- `bash -n`, `git diff --check`: **PASS**.
- Scoped lint: **PASS** with three existing warnings outside edited hunks.
- Full `npm test`: environment-blocked because this sandbox cannot reach the local Postgres/Docker service.

SHIP AFTER FIXES ABOVE