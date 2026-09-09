## Verdict

**Not fit to build.**

Deleting the dialog join removes the original question-identity defect, but the plan relocates an equivalent identity defect into the prose address lookup. There is one small product-level change needed before building; the remaining corrections can be made during Stage 1.

## 1. The join was relocated

### `sessionId → row` is not identity-safe

The inbox item identifies only a tmux `sessionId`; it carries neither the tmux-server generation nor the execution token ([wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/wire.ts:737)).

That is insufficient in two real cases:

- After a tmux-server restart, handles can be reused. The collector explicitly says handles are meaningless without `tmuxServerPid` ([collect.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/collect.ts:206)).
- More importantly, the same tmux session, pane, pane PID, and Claude session ID can survive one Claude process exiting and another starting. The repository added `ExecutionToken {boot,pid,startTicks}` specifically because all the plan’s proposed identity fields remain unchanged across that replacement ([wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/wire.ts:1595)).

Therefore an old prose observation for execution A can be joined by `sessionId` to execution B’s row and submitted to B. The send-time checks prove B is live; they do not prove B produced the prose excerpt.

Relatedly, the plan has not actually adopted an execution-identity draft key. It calls `paneId + panePid + claudeSessionId` “execution identity” ([plan](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md:345)), while the source explicitly says those fields are not execution identity. The real identity is `row.execution.token`.

### Dropping prose when any dialog appears is wrong

A dialog does not prove that an earlier prose decision was superseded. Prose A can be followed by unrelated dialog B before the next inbox scan. Dropping A loses a real waiting item.

It is worse for permission or unknown dialogs: they produce no dialog card, so the prose item can be dropped with nothing standing in its place. The plan’s claim that “the dialog card stands in its place” is therefore false ([plan](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md:264)).

With the identity join deleted, there is deliberately no evidence that two observations concern the same question. Presence alone cannot supply that missing evidence. Keep both cards.

### `questionGroupKey` is too strong and too weak for grouping

It is an excellent stale-answer safety comparison, but not a semantic grouping identity.

- False merge: two sessions can show identical prompt, material and options while asking about different tasks or repositories. Since session context is excluded, they collapse.
- False split: `sameQuestion` deliberately treats a moved cursor as different because option keys change—even though its own comment calls it “the same QUESTION but a different ANSWER” ([steer.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/steer.ts:1388)).

This is safe for send verification, where false negatives are cheap. It is unsound as “these sessions are asking the same semantic question.” The simplest v1 is one dialog card per row.

### Discarding inbox dialog items does lose information

They are not strictly staler:

- The attention and row collectors run independently; either observation may be newer.
- Both server producers use `parsePane`; this is not a different dialog parser.
- Inbox dialog items uniquely carry `waitingSince`, classifier ranking, answerability and producer duplicates.
- If row collection failed or predates a newly observed dialog, discarding the inbox item loses a known waiting item, even though a completeness gap prevents a false empty-state reassurance.

Discarding them may still be an acceptable simplification, but the plan must describe these losses honestly. “Strictly a staler reading” is false.

## 2. The four-arm union is not settled

The four labels cover the simple cases, but not the actual state space:

- A grouped dialog may contain both addressable and unaddressable sessions. Neither whole-group arm represents that.
- A prose item may have an addressable primary and unaddressable duplicates, or the reverse. `duplicates: QuestionTarget[]` cannot represent mixed members.
- `dialog.material: FleetMaterial` permits `unreadable`, although the plan says that state is impossible. The type therefore expresses an impossible state.
- More fundamentally, the `prose` arm claims an addressable relationship that the available sources cannot establish safely.

The material claim is true only on the server producer path: `classifyGate` requires `material.kind === "read"` before returning `conversation` ([pane.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/pane.ts:290)). Consequently both `unreadable` and `no-material` conversation dialogs are impossible there.

It is not true on every client path. The client parses `gate` and `material` independently and accepts `{kind:"conversation"}` without checking that material is readable ([types.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/types.ts:881)). The Questions resolver must detect this cross-field inconsistency and downgrade it to a gap. The dialog item should narrow material structurally to the `read` arm.

## 3. The gap list is still incomplete

The adopted list omitted several earlier requirements:

- `collectedAt === null`: no fleet snapshot has ever completed.
- A stale fleet snapshot.
- A stale coordinator checkpoint.
- A stale attention scan.
- `sessionsScanned === 0`: the existing panel explicitly treats this as a broken probe.
- Client `unreadableRows > 0`.
- A view that was complete when parsed but has since aged past its freshness threshold in the browser.

The composer signature also lacks `refreshMs`, so it cannot apply the dashboard’s cadence-derived fleet-staleness rule without inventing another threshold.

The downgrade-only rule is correct:

- The server establishes source-side incompleteness.
- The client may discover unreadable rows, malformed fields, unresolved references, cross-field inconsistencies, transport age and later staleness.
- The client must never promote server `partial` or `not-observed` to `complete`.

But the downgrade cannot happen only once inside `parseFleetState`; freshness changes while the page remains open. Rendering or a derived selector must downgrade against current client time.

## 4. I escalate the read-only-prose refusal

The refusal is not defensible as a safety decision.

This is not merely the previously accepted stale-tail risk. The remaining address lookup can bind an old prose observation to a different execution. The plan then sends an authoritative Greg instruction to that execution without checking the excerpt that justified the card.

The product argument is strong—prose is most of the value—but it does not make the operation correctly bound. Disclosure does not mitigate it.

Until the guarded tail-fingerprint operation exists, prose cards should be read-only. If interactive prose is non-negotiable, the work must be rescop​ed to include that guarded operation.

## 5. Stage 1’s tests are not all writable from existing fixtures

These cannot be written as stated:

- “`conversation` with `no-material`, `/loop` shape”: impossible. `/loop` is explicitly `unknown`, and the existing test proves it ([fleet-pane.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tests/fleet-pane.test.ts:600)).
- Conversation dialog with no `paneId`: impossible through the real collector, because there is no pane to capture the question from.
- Same labels but consequence-only difference: impossible from the server parser because consequence is a pure derivation of the label.
- Key-only differences require a synthetic cursor-dialog variation; there is a synthetic conversation menu in the tests, but no existing pair of pane fixtures.
- “Every gap” cannot be tested until the missing gap causes above are added.

Dangerous missing cases:

- Old prose observation plus a replacement execution under the same session handle.
- Prose A followed by unrelated conversation dialog B.
- Prose plus a permission/unknown dialog.
- Mixed addressable/unaddressable grouped members and prose duplicates.
- Inbox dialog newer than, or absent from, the row snapshot.
- Client `{gate:"conversation"}` paired with valid `no-material` or `unreadable` material.
- Never-collected, stale fleet, stale checkpoint, stale scan, zero scanned sessions, and unreadable client rows.

## Smallest remaining change

Before building, change one rule:

> Prose items are composed from the inbox alone, are never joined to a row, are never suppressed by a row dialog, and are read-only in v1.

That genuinely deletes the identity join. If prose answering must ship now, expand scope for the guarded prose write instead.

The grouping simplification, union narrowing, mixed-member representation, missing gaps, and test corrections are bounded Stage 1 work and do not require another full plan rewrite.