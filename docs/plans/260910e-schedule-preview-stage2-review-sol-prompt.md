# Review: Schedule preview Stage 2 — the daemon writes schedule.json, `overseer status` prints it

Repo: /home/greg/code/spideryarn2/.claude/worktrees/schedule-preview, branch worktree-schedule-preview. TypeScript,
ESM, tsx, vitest. The Overseer daemon on the Hetzner box; its scheduler is OFF and this stage must launch nothing.

## The candidate

Committed: commit 6b5ce4a9 (one commit)
            git diff 6b5ce4a9^ 6b5ce4a9
            changed paths: git show --stat --format= 6b5ce4a9   (9 files)

Start with: tools/overseer/schedule-preview.ts (new), tools/fleet/schedule-parse.ts (new), the block appended to
tools/fleet/wire.ts, tools/overseer/daemon.ts (the `preview` option and the checkpoint ticker), scripts/overseer.ts
(`schedulerWiring`, `run`, `status`). Not the limit of scope.

Stage 1 (18f64a04, 2ead21e4) is the planner this builds on and was reviewed by you already
(docs/plans/260910e-schedule-preview-stage1-review-sol.md); spend your time on what 6b5ce4a9 changed.

## What it is meant to do

The plan: docs/plans/260910e-schedule-preview-make-periodic-work-inspectable-before-launch.md § D1, D6, D7, Stage 2.
The task given to the implementer: docs/plans/260910e-schedule-preview-stage2-task.md. The implementer's own list of
where it departed from that task is at the end of this prompt.

The contract, stated at its true strength: **`schedule.json` is what THIS daemon's planner would decide for each job at
`writtenAt`, from the list it loaded, the documents as they were at that tick, its in-memory ledger, its arming and the
capabilities it holds — assuming each proposed live session launch in the pass succeeds.** `overseer status` prints that
file faithfully and says whether the running daemon holds the list this checkout builds. The one parser reads every
shape the writer can produce, and turns anything it does not know into an explicit unreadable arm rather than another
valid-looking value or a throw. Writing the file never stops the daemon, never dispatches, and never touches the store's
checkpoint or event log.

Is that statement accurate? That is the question — not "is it sound".

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside the stage under review — each finding red-first, with the test that
reproduces it — and leave everything wider as a finding for me to decide. Do not commit. List every file you changed at
the end. Run focused files only, e.g.
`npx vitest run tests/overseer-schedule-preview.test.ts tests/fleet-schedule-parse.test.ts tests/overseer-schedule-plan.test.ts tests/overseer-daemon.test.ts tests/overseer-cli.test.ts tests/overseer-standing-jobs.test.ts tests/fleet-imports.test.ts tests/fleet-compile-guards.test.ts`,
and the typecheck (`node --import tsx scripts/typecheck.ts` if `npm run typecheck`'s tsx IPC is refused; judge by exit
code). Never start, signal or reconfigure a running daemon or the fleet dashboard, never write to ~/.overseer, never set
OVERSEER_JOBS_ENABLED / OVERSEER_RULES_ENABLED. My focused run: 12 files, 349 tests, exit 0; typecheck exit 0.

## Attack it

Independently, before you read the notes below. Break the contract above: find a ledger state, a document state, an
arming, a capability set, a clock, a failed write or a hand-edited file under which the file says something the tick in
the same process would not have done at that instant, the CLI prints something the file does not say, or the parser
accepts a shape as a different valid value. Hand me the call sites: who builds the preview's inputs in the daemon, and
are they the same objects the jobs ticker uses?

For each finding: an ID (continue from the Stage 1 review's F3 — start at F4), severity (P0/P1/P2/P3), established or
reasoned; (a) the input or mutation I can run; (b) the smallest change that closes it. A finding with no (a) goes last.
P0 data loss / exploitable / broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2
design or maintainability risk with no wrong behaviour today; P3 prose. Refuse only on an established P0 or P1.

## The implementer's departures, and my own suspicions — read last

These are already known, so confirming them is worth less than anything you find yourself.

Departures the implementer reported: (1) the file carries `list: { given, listRevision } | { not-given, why }`;
(2) the daemon's `preview` option also carries `arming` and `launchSeparationMs`; (3) `londonFirst` built on
`zonedReadings` instead of `zonedLine`, because `zonedLine` marks days against UTC; (4) extra next-run arms `due-now`
and `after-arming`; (5) a document's `changed` is yes/no/cannot-tell and `behaviourHash` may be a reason; (6)
`newestAttemptOf` repeats `lastRunOf`'s newest-occurrence rule, held together by a test; (7) the daemon now imports
`status-cli.ts` (and through it `scripts/gjd-remote-tmux.ts`) for `describeAge`; (8) rules print "next 0s after the
scheduler is armed" and a rule's lease is labelled "launcher lease".

My suspicions: (7) is a new import edge into a long-lived daemon for one formatting function — worth a leaf instead?
Whether the daemon computes the preview with the same `arming` and `launchSeparationMs` the jobs ticker uses when armed,
or a second copy that could drift. Whether "after-arming" is chosen correctly for a rules-only daemon. Whether the
checkpoint ticker now does enough synchronous work (document digests, JSON, fsync-less rename) to matter at 30 s.
