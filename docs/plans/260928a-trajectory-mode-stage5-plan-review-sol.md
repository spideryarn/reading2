Verdict: **rethink**. The main route changes are sound, but the flash lifecycle and 5g need redesign before implementation. No files were changed.

### Findings

**F28 — P1 — A `?stop=` deep link does not currently scroll, so adding callbacks to existing scrolls cannot make it flash.**

Evidence: `stop` only selects `current` in [TrajectoryMode.tsx:227](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:227). Scrolling happens only in interaction handlers such as [TrajectoryMode.tsx:264](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:264). Initial reading-position restoration handles `?at=`, not `?stop=`, at [useReadingPosition.ts:61](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/reader/useReadingPosition.ts:61).

Fix: add a one-shot initial-stop effect after the route and blocks resolve. Key it to the initial `(slug, requested stop)` rather than to `current`; a generic `current` effect would duplicate flashes for rows and ordinary stepping.

---

**F29 — P1 — The planned direct-scroll callback leaves two narrow-window paths covered and can produce a stale flash followed by the right flash.**

Evidence:

- `flashBlock` stores a pending flash while prose is covered: [flash.ts:57](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/flash.ts:57).
- `beginJump` first discards an older pending flash: [keynav.ts:353](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/keynav.ts:353). A direct `scrollToBlock(..., flashBlock)` does not.
- Band arrows call `onAway`: [TrajectoryMode.tsx:391](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:391).
- Keyboard arrows call the controller’s bare `step`: [Reader.tsx:1151](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/reader/Reader.tsx:1151).
- A depth change calls the bare depth handler: [TrajectoryPanel.tsx:143](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/TrajectoryPanel.tsx:143).

A keyboard step can therefore leave flash A pending behind the band. The next band-arrow movement can reveal A during the glide, then flash B on arrival.

Fix: every direct trajectory movement should go through one helper that:

1. calls `dropPendingFlash()`;
2. scrolls and flashes only on settled arrival;
3. steps the band aside on narrow windows when movement occurred.

Use it for keyboard, band arrows, moving depth changes, door/repeat as appropriate, and initial deep links. Keep row presses on `beginJump`; they already flash exactly once and already step the band aside.

---

**F30 — P1 — Stale Quotes is the broken prerequisite case today; the plan should require the fix rather than merely investigate it.**

Evidence: `useTrajectory` adds Quotes only when its state is none/error at [useTrajectory.ts:146](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/useTrajectory.ts:146). The trajectory stage explicitly accepts stale Quotes and filters unusable entries at [pipeline.ts:3304](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/pipeline.ts:3304).

The three cases are:

| Quotes state | Current result |
|---|---|
| No Quotes | Works: queues `["quotes", "trajectory"]`. |
| Quotes run in flight | Usually works, but is not deduped: `["quotes"]` and `["quotes","trajectory"]` are different work keys. Per-article serialization makes the combined job run later, and `stepIsDone` skips Quotes if the first job completed it. |
| Stale Quotes | Broken: queues trajectory alone and plans against the stale, filtered set. |

Exact-step deduping is visible at [jobs.ts:3095](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/jobs.ts:3095), while freshness skipping is at [pipeline.ts:1045](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/pipeline.ts:1045).

Fix: prepend unforced Quotes whenever Quotes is missing **or stale**, for both automatic generation and regeneration. Keep route regeneration forced while allowing a current Quotes step to skip.

---

**F31 — P1 — The card will not fill as its separately queued source jobs finish.**

Evidence: the band uses read-only hooks at [TrajectoryMode.tsx:126](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/modes/trajectory/TrajectoryMode.tsx:126). For example, `useIdeasRead` fetches once and merely exposes `refresh`: [useIdeas.ts:113](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/useIdeas.ts:113). The only completion subscription here is for the trajectory step itself at [useTrajectory.ts:136](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/useTrajectory.ts:136).

Fix: if 5g remains, add one controller-level jobs subscription filtered to this slug and the four source steps, then call the relevant read-hook refresh functions on completion. Alternatively, mount four step subscriptions. The current hooks do not revalidate each other.

---

**F32 — P1 — Automatically starting the four card-source modes is extra paid work that is neither a route prerequisite nor disclosed before activation.**

Evidence: the card was deliberately specified to use artifacts that already exist, without generating them, at [stop-card.ts:1](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/stop-card.ts:1). The mode description currently promises the trajectory pass and, when needed, Quotes—not another roughly £0.35 of work: [mode-catalog.ts:487](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/mode-catalog.ts:487). The job hook documents the requirement to disclose prerequisite spending before the press at [useStepJob.ts:165](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/useStepJob.ts:165).

Greg’s wording was conditional—other modes “that should also run first as part of generating Trajectory.” In this plan, those modes do not generate the route; they only enrich its card afterward.

Fix: simplest is to drop automatic 5g and show source material when it already exists. If generating the scrapbook sources is wanted, make it an explicit, pre-disclosed action rather than silently attaching four calls to the first open.

---

**F33 — P2 — Four separate jobs do not provide concurrency and the plan does not guarantee the route reaches the queue first.**

Evidence: jobs for one article are serialized by the store at [pg-jobs.ts:772](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/store/pg-jobs.ts:772). The global default concurrency is three at [jobs.ts:422](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/jobs.ts:422), but it does not make four jobs for one article parallel. Separate jobs also lose the same-job prompt-cache grouping described at [step-order.ts:77](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/step-order.ts:77).

There is no owner queued-job count limiting these late runs, and they do not consume article-ingest slots; [billing.md:578](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/docs/project/billing.md:578) confirms late step runs are quota-free.

Fix: if 5g stays, await the route enqueue response before enqueueing sources. Prefer one second unforced job containing the allowed source steps unless incremental publication is important enough to justify four serialized jobs.

Also define “first automatic open” precisely: `useAutoRun` means an activation-token open while trajectory status is `none` ([useAutoRun.ts:141](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/useAutoRun.ts:141)). It excludes existing routes, manual empty-state runs, and regeneration.

---

**F34 — P2 — “The experimental switch only decides whether the button is listed” is false.**

Evidence: `visibleModes` supplies the filtered set at [Dock.tsx:855](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/Dock.tsx:855), and the command bar renders that same set at [CommandBar.tsx:439](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/CommandBar.tsx:439). Thus promotion exposes both Dock and command-bar activation.

Auto-run itself has no experimental check, but needs an activation token. Last-view restoration records trajectory independently at [last-view.ts:66](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/last-view.ts:66) and does not arm paid auto-run.

I found no non-owner paid path:

- Visitors receive an owner-only gap: [visitor.ts:331](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/visitor.ts:331).
- The trajectory band is mounted only for owners: [Reader.tsx:1941](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/reader/Reader.tsx:1941).
- A direct job POST still resolves the article through the authenticated owner: [jobs.ts:3111](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/jobs.ts:3111).

Fix: correct the plan’s gate description and test Dock plus command-bar promotion. Update `trajectory.md` as well as `experimental-features.md`, since it currently records the behind-the-switch product decision.

---

**F35 — P2 — “Use the same `canOpen` rule” does not define availability for all four proposed source jobs.**

Evidence: card targets are only glossary terms, ideas, and timeline events at [stop-card.ts:76](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/stop-card.ts:76). FAQ contributes card text but has no card link and therefore no `canOpen` case.

Fix: define source-job availability directly from the mode catalog/experimental visibility rule. Do not derive job authorization from card-link targets.

---

**F36 — P2 — The proposed word-position function has an unhandled zero-total contract failure.**

Evidence: block word counts are numbers but are not constrained positive at [types.ts:80](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/types.ts:80); generated blocks can have zero words at [blocks.ts:1550](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/blocks.ts:1550). Dividing by total words can therefore return `NaN`, not the promised `0..1`.

Fix: specify a fallback for a zero-word article—prefer block-order midpoint, or `0.5` when there is no meaningful order—and make missing block IDs return `null` rather than an apparently valid position. Test both cases.

### Simpler cut

Implement 5a–5f, with stale Quotes made a required predecessor fix, but omit automatic 5g. The card can continue showing whichever glossary, ideas, FAQ, and timeline artifacts already exist. That delivers the visible feature set Greg requested without four undisclosed jobs, revalidation plumbing, queue-order concerns, or a second definition of experimental availability.