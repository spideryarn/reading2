# Citation influence: explaining more than the saved state can prove

Up: [postmortems.md](../project/postmortems.md) ·
[plan](../plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md)

Found during the stage-1 review of **2b2dc6b7e**, before landing. No production incident is
established. A separate GPT Sol agent traced the causes and reviewed the fixes read-only.

## Provenance erased before explanation

The list reader maps explicit `null`, a missing influence and a rejected influence to the same
absent stored field (`influenceCounting`, `scoreCounting`, `readDraft` in
[`src/citations.ts`](../../src/citations.ts)). The row and chat then said every absent value meant
the model was not confident it knew the work. That claims a cause the saved state cannot prove,
including for old lists. Help also said every low score meant confidently minor, although old
prompts explicitly assigned low numbers to unknown works. These explanations arrived in
**2b2dc6b7e**.

The narrow fix keeps the planned storage contract: explain that no usable score was saved, then
state the new prompt's rule separately. Qualify low-score meaning by new versus old lists. A
future feature that needs the precise reason must save it; wording cannot recover discarded
provenance. See the score comments in [`src/types.ts`](../../src/types.ts), the copy in
[`CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx), and
[`chat-tools.ts`](../../src/chat-tools.ts).

## Capability and selected order drift apart

`orderOptions` omitted influence when no work had a number, while `effectiveOrder` still honoured
`?citeby=influence`. This mismatch originated in **abde65f7c7**. Stage 1's unknown-tail sort
made it visibly reorder an all-unknown list by relevance, with no selected order button.
The fix falls back to first cited when influence is unavailable, using the same influence accessor
as the menu. The wider, pre-existing sibling for `?citeby=relevance` with no relevance is reported
to the caller and left outside this influence stage.

## Interaction and explanation omit their context

The new unknown label used an unfocusable span and a hover-only tooltip. A touch press opened no
persistent explanation. Its words also implied a threshold was active in orders that show no
slider. Both were introduced in **2b2dc6b7e**. A real button with the existing `useTapReveal`
hook now opens on hover, focus or tap and dismisses a finger's card on scroll. Threshold advice
names prioritised order.

## Why nothing went red

The three requested suites initially reported `Tests 213 passed (213)`. The new tests in the
candidate checked unknown copy on a generic missing-score fixture and opened the card with a
mouse. They shared the implementation's assumption about provenance and input device. Sort tests
covered a mixed list; fallback tests covered date and prioritised, but never a saved influence
order on an all-unknown list.

The review regressions were observed red before implementation changes: `Tests 5 failed | 123
skipped (128)` for URL selection, absent-score explanations and touch; a separate run established
the context and Help claims (`Tests 3 failed | 94 skipped (97)`). They are in
[`citations-panel.test.tsx`](../../tests/citations-panel.test.tsx) and
[`chat-citations-tool.test.ts`](../../tests/chat-citations-tool.test.ts).

## What would have caught this, ranked

1. Test each possible origin of a stored absence against the explanations, including old artifacts.
2. Render an unavailable saved order and compare the actual row order with the selected button.
3. Open the new card with touch as well as mouse; include an iPad click that reports mouse.
4. Read explanation copy against every order and artifact version it can appear under.

The mutation checks also detected two broken contracts: storing unknown as zero failed the absent
field test; treating unknown influence as unscored failed relevance filtering and the all-unknown
slider test. Both mutations were undone by text edits before the final verification.

## The thing I would tell myself

I should derive explanation tests from the states the reader can actually encounter. A fixture
with no score does not tell me why it has no score, and a mouse hover does not establish that a
finger can open the same explanation. The tests need to challenge those missing facts.
