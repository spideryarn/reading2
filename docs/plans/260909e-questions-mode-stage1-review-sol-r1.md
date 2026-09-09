## Verdict

**No P0 findings. Two P1 findings. This stage is not fit to commit/push as-is.** The dialog-disagreement logic should be fixed first. The current-time selector must also be wired when the panel lands.

The local `HEAD` already contains the `FleetState` alias correction you proposed.

## P1

### P1 — Normal answered dialogs create false completeness gaps

You are right, with one nuance: the gap is not permanent for one item—the next attention scan forgets an answered dialog—but it can remain for roughly two minutes. Across several sessions, that is enough for the page to spend much of healthy operation in `partial`.

The server emits the gap at [questions.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/questions.ts:154), and the client recreates it independently at [types.ts:2786](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/types.ts:2786). The test at [fleet-questions.test.ts:193](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tests/fleet-questions.test.ts:193) currently enshrines the defect.

What I would do:

- Continue discarding inbox dialog items; never turn them into cards.
- If a readable authoritative pane observation no longer shows a conversation dialog, discard the inbox dialog silently. It is ordinary observer lag, not a gap.
- If pane collection was absent, failed, stale, or the row’s question was unreadable, the existing fleet gaps already describe the incompleteness.
- Preserve a distinct temporal gap only when the inbox demonstrably observed the dialog after the pane observation.

The last case cannot be determined perfectly from the current clocks: `collectedAt` is stamped after the whole collection, while `scannedAt` is stamped near the beginning of the attention pass. Exact treatment needs a pane-observation timestamp or source-observation interval. Until that exists, a broad “not in rows” gap is wrong; name temporal uncertainty explicitly rather than claiming every disagreement is missing data.

No distinct non-gap observation needs to cross the wire. Silence is the correct representation when the authoritative, sufficiently recent pane reading says the dialog is gone.

### P1 — Current-time freshness exists as a function but is not applied by runtime rendering

[questionsAtTime](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/types.ts:2743) correctly recomputes all three clocks against a supplied current time. But its only production call is during parsing at [types.ts:2952](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/types.ts:2952). Nothing calls it from a render path; the other caller is the unit test.

Therefore the selector is prepared for Stage 2, but the requirement “a view goes stale while the page remains open” is not yet true in the application.

What I would do: when `QuestionsPanel` is mounted, derive its prop with `questionsAtTime(feed.state, now)` on every render, where `now` is App’s existing ticking clock. Add a DOM test that advances time without delivering another payload and observes the panel leave `complete`.

## P2

### P2 — `not-observed` is slightly too hard to reach

The top-level condition at [questions.ts:58](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/questions.ts:58) is otherwise sound for normal producer states.

The defect is that `observeAttention` returns `true` for every `list`, including:

- `sessionsScanned === 0`;
- `sessionsUnreadable === sessionsScanned`.

Those contain no usable observation. If fleet collection is also absent, the result is `partial`, not `not-observed`.

This is defensive rather than normal-operation severity because the real producer normally converts these cases to `unknown`, but both server and client checkpoint parsers accept such a `list`.

What I would do: define usable attention observation as `sessionsScanned > sessionsUnreadable`, or normalize zero/all-unreadable lists to `unknown` at the checkpoint boundary.

### P2 — Important test holes and weak assertions

The most important still-untested round-three case is mixed prose membership. The test named “records addressability independently” at [fleet-questions.test.ts:180](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tests/fleet-questions.test.ts:180) makes both the primary and duplicate unaddressable. It does not test:

- addressable primary plus unaddressable duplicate;
- unaddressable primary plus addressable duplicate.

Also missing:

- `needs-you + {kind:"none"}` must remain gap-free;
- inbox-dialog disagreement with the pane observation newer versus older;
- zero/all-unreadable attention plus no fleet collection must produce `not-observed`;
- future and unparseable values for each completeness clock;
- dialog target identity/addressability mismatches at the client resolver;
- malformed gate/material cards remaining present, not merely producing some gap;
- a render-level freshness test.

The read-only prose assertion at [fleet-questions.test.ts:164](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tests/fleet-questions.test.ts:164) only prohibits three particular property names. A future `send`, `canAnswer`, or similar field would pass it. The current union is safe, but the regression guard is weak.

No red-first history exists, so none should be credited as having been witnessed red.

Against a conventional empty server stub returning `{kind:"complete", items:[]}`, the positive test “returns a complete empty view…” at [fleet-questions.test.ts:277](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tests/fleet-questions.test.ts:277) would pass. The other whole tests would fail, although several individual assertions are non-discriminating:

- the fixture gate assertions test `parsePane`, not Questions;
- the first two size assertions pass if every card is dropped;
- the negative property assertions accept any unlisted write-shaped property;
- the current-time test calls the selector directly and says nothing about runtime wiring.

### P2 — Freshness numbers agree today but are copied policy

The values are consistent:

- `2.5 × refreshMs` matches the masthead’s `STALE_AFTER_CADENCES`;
- five minutes matches `AttentionPanel`’s checkpoint threshold;
- six minutes matches its attention-scan threshold.

So this is not currently a fourth numerical opinion. It is, however, three new literal copies across [questions.ts:25](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/questions.ts:25) and [types.ts:2748](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/types.ts:2748). A small Node/DOM-neutral freshness-policy module would prevent drift.

`isStale` is applied to every clock that determines Questions completeness: fleet collection, checkpoint write, and attention scan, on both server and client. Future and unparseable instants fail closed. `waitingSince`, `attemptedAt`, and `servedAt` have different purposes and do not require Questions-staleness gaps.

One defensive hole remains: a non-finite `refreshMs` makes the server deadline `NaN`, causing an old fleet snapshot not to count as stale. Validate `refreshMs` or make `isStale` reject a non-finite/non-positive deadline.

## `FleetStateWithQuestions`

Yes: putting required `questions` directly on `FleetState` and deleting the alias is the right change. The current code does that at [wire.ts:1235](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/wire.ts:1235).

The alias bought only migration convenience: old construction sites could keep naming `FleetState` without supplying `questions`. That convenience defeats the required-field contract. It provided no runtime behavior or useful type safety that is lost by deleting it. Compatibility with an older server belongs in `parseQuestions(undefined, …)`, not in the current producer type.

The compile guard now correctly inspects the real `FleetState` at [fleet-compile-guards.test.ts:342](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tests/fleet-compile-guards.test.ts:342).

## Client composition

Apart from the missing runtime selector call, the client half is well built:

- conversation plus non-`read` material becomes `dialog-source-inconsistent`;
- dangling dialog and prose references retain their cards and add gaps;
- copied prose is checked against the authoritative attention item;
- server `partial` and `not-observed` are never promoted;
- prose items carry no write operation or steer handles.

The three targeted suites pass: 47 tests. I could not independently rerun typechecking in this sandbox because `tsx` was denied permission to create its IPC socket; that is an environment failure, not a TypeScript result.