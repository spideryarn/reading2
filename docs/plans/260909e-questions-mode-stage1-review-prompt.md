# Code review: Stage 1 of the Questions mode (the data contract and its composition)

You reviewed this plan three times before it was built. Your reviews are at
`docs/plans/260909e-questions-mode-plan-review-sol-r{1,2,3}.md`. **This is the built code**, and the
brief for this job says a code review is weighted higher than a plan review — a plan-stage review
cannot find a handler that writes one field and then rejects the request.

Repository root: `/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`

Stage 1 was implemented by another model from
`docs/plans/260909e-questions-mode-stage1-codex-task.md`. It was killed by a 45-minute timeout while
waiting on a reviewer it had started itself, so **there is no implementer's report** — you are
reviewing code whose author never got to explain it, and you should not assume any claim about it.

## What to read

- The diff: `git diff HEAD` plus the untracked files `tools/fleet/questions.ts`,
  `tests/fleet-questions.test.ts`, `tests/fleet-questions-client.test.ts`.
- The plan, § The design and § Stage 1:
  `docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md`.
- Your round-three review, which is the specification most of this was written against.

## The rules this code has to satisfy

From the plan, each there because one of your rounds found a defect:

1. **The pane is the authority on dialogs; the inbox is the authority on prose.** No identity join.
2. A dialog item only for `gate.kind === "conversation"`. **One card per row**, no grouping.
3. **A prose item is never suppressed by a row dialog.** Both cards kept.
4. Nothing is ever dropped: no row, or no address ⇒ an `-unaddressable` arm.
5. **Nothing on a prose item may imply a write is possible** — v1 is read-only there by a decision
   taken under gate 2 and recorded in the plan.
6. `complete` may only be returned when every source was positively observed and complete; `partial`
   carries a non-empty `gaps`; the client may only ever downgrade.

## Specific things I want attacked

### 1. A gap I think fires in normal operation

`composeAttentionItem` pushes `attention-dialog-not-in-rows` whenever an inbox **dialog** item has no
matching conversation dialog on the row. **My concern: that is the ordinary case, not an incomplete
observation.** The inbox scans every ~2 minutes and the collector every ~73 seconds, so a dialog
answered in between is normal operation — and this would put a permanent caveat on the page and
downgrade `complete` to `partial` more or less always. That is A17 (healthy operation spending most
of its time alarming), which the plan explicitly forbids.

Am I right? If so, what is the correct treatment — silence, a distinct non-gap observation, or a gap
only when the row was *not* readable? Note the plan's own claim that discarding inbox dialog items
loses a real waiting item when row collection failed or predates the dialog; the fix must not throw
that away either.

### 2. `FleetStateWithQuestions`

The implementer added `export type FleetStateWithQuestions<Row, Health> = FleetState<Row, Health> &
{ questions: QuestionsView }` and re-pointed `state.ts` and two tests at it, rather than adding the
field to `FleetState`. **That was caused by my task prompt**, which told it not to edit anything
already in `wire.ts`. I intend to replace it with a required `questions` field on `FleetState` and
delete the alias. Do you agree that is right, and is there anything the alias was buying that I am
about to lose? Note `tests/fleet-compile-guards.test.ts` refuses an *optional* top-level key.

### 3. The completeness logic

- Is `not-observed` reachable in the cases it should be, and unreachable in the ones it should not?
  The condition is `collectedAt === null && !attentionObserved && items.length === 0`.
- `observeFleet` pushes `row-question-unreadable` when `status.kind === "needs-you" && question ===
  null`. Is that the right predicate for *the pane capture or parse failed*, or does it also catch
  ordinary states?
- `isStale` treats a future or unparseable instant as stale. Correct — but is it applied to every
  clock that needs it?
- Are the thresholds (`2.5` cadences, 5 min, 6 min) consistent with what the rest of the dashboard
  already uses, or is this a fourth opinion about staleness?

### 4. The tests

- Which of them could actually fail? Look for assertions that pass on any implementation.
- The task told the implementer to watch each test go red first. **There is no report, so that claim
  does not exist** — tell me which tests you believe would not have gone red against an empty
  implementation.
- What dangerous case from your round-three list is still untested?

### 5. The client half

`tools/fleet/web/src/types.ts` grew ~450 lines. Check especially: the cross-field inconsistency
downgrade (a `conversation` gate beside a non-`read` material), reference resolution producing gaps
rather than dropped cards, and whether the freshness downgrade is re-applied against **current client
time** rather than only at parse — the plan requires a derived selector because a view goes stale
while the page is open.

## Output

Rank P0 / P1 / P2, say what you would do instead for each, and **state explicitly whether this stage
is fit to commit.** Do not re-open settled plan decisions: the read-only prose half, the absence of a
rule detector, and the absence of a rewrite chip are all decided and recorded.
