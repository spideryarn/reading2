Verdict: no P0 found. I found three P1s and two P2s. The merge resolution preserved both sides correctly.

## Findings

`QM2-01 | P1 | tools/fleet/web/src/QuestionsPanel.tsx:169 | Only answerable current rows receive option buttons | canAnswer does not cover all server refusal conditions | centralise the complete local answerability predicate and table-test every retained malformed-row case | Reproduced`

Two paths produced two enabled buttons on rows the real answer route must refuse:

- A retained `conversation` question with `material.kind === "no-material"` is already downgraded to `partial` as `dialog-source-inconsistent`, but `canAnswer` accepts it. `QuestionCard` only suppresses buttons for `unreadable`. The server recomputes this gate as `unknown` and refuses it.
- A row with a non-steerable `shell` status also gets buttons; `answerQuestion` rejects that status before sending.

The earlier P1 fix is therefore incomplete as a class. It closed missing addresses and mismatched targets, but not all conditions needed for an answer to be admissible.

`QM2-02 | P1 | tools/fleet/web/src/QuestionsPanel.tsx:35 | Dialog state belongs to the current question and execution | the key contains rowId and execution, but no question identity | include the fields used by sameQuestion in the dialog key | Reproduced`

After answering dialog A successfully, I rendered dialog B on the same row and verified execution. The card showed B’s new prompt with A’s `Sent.` receipt underneath, and B’s buttons remained disabled because `repeatUnsafe` survived.

This can happen if one agent asks another question before an intervening snapshot removes its dialog card. The key needs prompt/material/options identity as well as row and execution identity.

`QM2-03 | P1 | tools/fleet/web/src/types.ts:2597 | A browser-accepted complete empty view has independently established that neither source contains an item | reference resolution validates reported items but never checks for omitted items | compare the reported item identities against every eligible parsed dialog row and prose attention item before retaining complete | Reproduced`

I supplied a fresh, readable payload containing a valid live dialog row but `questions: {kind:"complete", items:[]}`. `parseFleetState` retained `complete`, `questionsAtTime` retained it, and the DOM rendered `Nothing needs you.`

The same omission is possible for a prose attention item. The exact path is:

1. `parseQuestions` accepts the server’s empty `complete`.
2. `resolveQuestionReferences` has no items to validate and performs no inverse coverage check.
3. `questionsAtTime` checks clocks, collection failure, unreadable rows and attention health, but does not recompose coverage.
4. The renderer prints reassurance.

Normal `composeQuestions` does produce the right set, but the browser’s stated role as the final authority on `complete` is not currently fulfilled.

`QM2-04 | P2 | tests/fleet-questions-panel.test.tsx:436 | The prose regression test prevents a later pane write | it only checks for textareas and enabled buttons, not click side effects | click with a recording SteerApi and assert that neither message nor answer was called | Reproduced by mutation`

Current prose cards do not write: their click only selects Sessions through the URL.

However, I added a `steer.message` side effect to that same click while preserving navigation. All 14 committed panel tests still passed. `QuestionItems` already has `steer` in scope, so this is an easy edit the claimed guard does not catch.

`QM2-05 | P2 | tools/fleet/web/src/QuestionsPanel.tsx:394 | The answering notice explains missing dialog controls | it is rendered for empty and prose-only lists where no option buttons exist | show it only when at least one dialog would otherwise be action-bearing | Reproduced`

A complete empty view under a hold renders both:

> This server has declared an answering hold … option buttons are withheld.

and:

> Nothing needs you.

The banner also appears for prose-only lists, where prose answering in Sessions is a message operation rather than the held option-answer operation. The narrower suppression is right.

## Requested checks

1. Enabled buttons on unanswerable rows: yes. `QM2-01` shows the class is not closed.

2. False “Nothing needs you”: yes. `QM2-03` reproduces an omitted live dialog surviving parsing, ticking-clock recomputation, and rendering.

3. Prose writes: none now. The role-button only navigates. The regression protection is insufficient; `QM2-04`.

4. Receipt target: `sentTarget(row)` is correctly captured before the await and is never compared with a later row. A re-render cannot alter that captured object. If the React key changes mid-flight, the old component is unmounted and its receipt is discarded rather than miscompared. The actual defect is the opposite: the key does not change when the question changes, so an old receipt attaches to a new question (`QM2-02`).

5. Merge resolution: correct. It retains the decisions side’s overflow state/effects/classes, the Questions side’s `--dock-mode-count`, both icons and React imports, and both mode registrations. `decisions` remains seventh and `questions` remains last.

## The remaining suspicions

- `repeatUnsafe`: the conservative policy is right for the same question. A successful send is not proof that the dialog processed it, so blind retry remains unsafe. The defect is that a genuinely new question inherits the lock.
- Future `waitingSince`: ordinary measured clock skew is already applied in `parseQuestionItem` through `shiftToBrowserClock`. This suspicion is not borne out.
- Dialog-first ordering: currently held by `observeFleet` running before `observeAttention`, and explicitly asserted by the server composition test. A later reversal would make that test fail.
- Duplicate gaps/index keys: no valid duplicate path reproduced. Recomputed gaps have structurally identical fields and are deduplicated; the index key carries no state.
- Constant `"unverified"`: it does not collide different items because `rowId`/`itemId` and kind remain in the key. It deliberately retains state across an unverifiable execution replacement for the same item. The reproduced key defect exists even with verified execution tokens.

On an isolated archive of `9efbdecf`, the committed tests passed: 14 panel tests and 40 server/client tests. The additional throwaway regressions were run only in `/tmp`; the repository was not edited.