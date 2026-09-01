## Findings

### 1. Must fix: the “independent” placement is not independent

The test proves only that `PlaceOnCriterion` does not itself render model results. It does not prove that the referee cannot see them while using it.

In the real reader:

- The criteria panel stays mounted and displays model valences: [App.tsx:4494](/home/greg/code/spideryarn2/src/web/App.tsx:4494), [App.tsx:4633](/home/greg/code/spideryarn2/src/web/App.tsx:4633).
- `AnnotateDialog` is added over that reader: [App.tsx:2329](/home/greg/code/spideryarn2/src/web/App.tsx:2329).
- It is a fixed bottom-right panel, not a modal or sealed view: [styles.css:8346](/home/greg/code/spideryarn2/src/web/styles.css:8346).
- Editing from a prose mark opens `CommentDialog` with the placement control: [App.tsx:2418](/home/greg/code/spideryarn2/src/web/App.tsx:2418), [CommentDialog.tsx:251](/home/greg/code/spideryarn2/src/web/CommentDialog.tsx:251).

Therefore a referee can read the model’s valence in `CriteriaPanel`, select or open the passage, and then make or revise their “independent” placement. Nothing records whether their first placement preceded exposure to the model. The anchoring safeguard exists in the plan, not in the state model.

The named test is theatre: [referee-placement.test.tsx:522](/home/greg/code/spideryarn2/tests/referee-placement.test.tsx:522) mounts `AnnotateDialog`, not the reader or `CriteriaPanel`. The fixture’s model results are dead data because the mounted component reads only criterion configuration.

A real test needs to mount the full referee criteria view with an unmistakable model result, open the selection instrument, and assert that no model placement is visible or accessible until the referee has committed their first placement. It also needs the `CommentDialog` edit path.

This is not fixed merely by moving the picker. The product needs a sealed-envelope state: preserve the first pre-reveal human placement, or stop describing later placements as independent.

### 2. Must fix: comment mutations race and can preserve the wrong click

Every placement click launches an independent PATCH: [useComments.ts:605](/home/greg/code/spideryarn2/src/web/useComments.ts:605). The buttons remain enabled: [PlaceOnCriterion.tsx:349](/home/greg/code/spideryarn2/src/web/PlaceOnCriterion.tsx:349). Responses replace the whole local comment: [useComments.ts:622](/home/greg/code/spideryarn2/src/web/useComments.ts:622).

Two quick clicks can execute or return out of order. The stored value can therefore be the first click rather than the last one. The browser can also end with a different value from Postgres.

There is a second race: editing prose and clicking a placement. Body changes commit on blur: [CommentDialog.tsx:564](/home/greg/code/spideryarn2/src/web/CommentDialog.tsx:564). That PATCH and the mark PATCH update disjoint database columns, but both responses contain and replace the whole comment in client state. A late body response can visually restore the old mark; a late mark response can visually restore the old body.

The server updates are unconditional too: [pg-comments.ts:484](/home/greg/code/spideryarn2/src/store/pg-comments.ts:484). Cross-tab writes remain last-arrival-wins.

Serialize all mutations per comment, as existing criterion/search mutation code already does, or add versioned compare-and-set semantics. Tests need held promises resolved in reverse order.

### 3. Must fix: changing criterion silently transfers an answer between different poles

When an already placed comment changes criterion, the client sends the old numeric valence unchanged:

[PlaceOnCriterion.tsx:249](/home/greg/code/spideryarn2/src/web/PlaceOnCriterion.tsx:249)

```ts
place(comment.id, {
  criterionId: id,
  valence: value.valence,
})
```

That turns, for example, “clearly supports Pole A” into “clearly supports an unrelated Pole C” without the referee selecting Pole C. This fabricates a judgement.

Changing criterion must clear `valence` and require a fresh choice on the new criterion. Existing tests cover selecting a criterion for an unplaced comment, but not changing the criterion of a scored comment.

The route’s requirement that both keys be present is otherwise correct. It makes the pair atomic and permits:

- `{criterionId, valence: null}`: retain the criterion without a placement.
- `{criterionId: null, valence: null}`: clear the entire review mark.

The UI currently exposes only the second clearing operation.

### 4. Must fix: block matching falsely attributes and falsely labels valid placements

The panel reduces all human placements on a block to the first one:

[CriteriaPanel.tsx:555](/home/greg/code/spideryarn2/src/web/CriteriaPanel.tsx:555)

Every model result on that block then receives that same placement: [CriteriaPanel.tsx:732](/home/greg/code/spideryarn2/src/web/CriteriaPanel.tsx:732). If the model has two results in one block, one human judgement is displayed beside both as though it matched both passages.

Conversely, every additional human placement on that block is placed under “Yours, that the model did not turn up”: [CriteriaPanel.tsx:619](/home/greg/code/spideryarn2/src/web/CriteriaPanel.tsx:619), [CriteriaPanel.tsx:750](/home/greg/code/spideryarn2/src/web/CriteriaPanel.tsx:750). That heading is false: the model may have turned up the block, but the matching scheme could not decide which passage matched.

This does not require implementing deferred span-overlap matching. The current version can represent same-block multiplicity as ambiguous, group it, or use one-to-one pairing. It must not reuse one placement multiple times or call every leftover placement a miss.

### 5. Must fix before calling the provider guard a completed safeguard

The split fixes the previous self-installing-test flaw. Removing `setupFiles` should now fail the installed check.

But the guard can still disappear while reporting itself installed:

- `providerGuardInstalled()` reads a boolean: [provider-guard.ts:247](/home/greg/code/spideryarn2/tests/setup/provider-guard.ts:247).
- Installation is idempotent based on that boolean: [provider-guard.ts:274](/home/greg/code/spideryarn2/tests/setup/provider-guard.ts:274).
- A test can assign a new `globalThis.fetch`; the boolean stays true and reinstalling does nothing.
- The repository already contains direct global replacement patterns, for example [feedback-button-visibility.test.tsx:71](/home/greg/code/spideryarn2/tests/feedback-button-visibility.test.tsx:71).

A stub is not inherently safer. It may delegate to `undici.fetch`, call `node:http`, or launch a subprocess. None is guarded. A new provider host is also invisible until somebody remembers to add it to the same registry used by both implementation and test.

`unstubAllGlobals` is covered. `resetAllMocks` is not the main weakness; replacing the global outright is.

At minimum, retain the installed wrapper’s identity and verify or restore it after every test. For a real boundary, deny non-local networking below `fetch` and separately audit subprocesses. Otherwise keep calling this a tripwire, as the testing doc does, not a safeguard layer.

### 6. Record now: the two valence encodings become wrong when treated as one metric

The current display and misses list retain provenance: human valence comes from comments, model valence from criterion results. Export also keeps those record types separate. So the shared integer does not currently cause those features to confuse authorship.

The first wrong answer will occur when raw arithmetic is introduced—especially the deferred gap-sorted list. A human `-50` means one of five selected categories; a model `-50` is a continuous estimate. Subtracting them asserts that both are measurements on the same interval scale. A zero gap would be reported despite the values having different measurement semantics.

Before calling `valenceGap` for sorting, either bin model results into the same five categories or store an explicit human step/instrument version. Export should preserve that distinction rather than requiring future readers to infer it from the table containing the number.

Worth recording and leaving until gap sorting is built; it is not currently corrupting the panel.

### 7. Record, then resolve before disagreement becomes prominent: `directionsDiffer` answers too little

No code currently averages or reconciles the two valences. `RefereeGap` prints both separately: [CriteriaPanel.tsx:952](/home/greg/code/spideryarn2/src/web/CriteriaPanel.tsx:952). That rule is honored.

But the justification for ignoring `valenceGap` is wrong:

- Human `-100` and model `-5` are not necessarily “the same answer.” The five-step picker deliberately records strength.
- Zero is labelled “counts neither way,” not “declined to answer.” The comment at [CriteriaPanel.tsx:577](/home/greg/code/spideryarn2/src/web/CriteriaPanel.tsx:577) gives it the wrong semantics.

Do not blindly switch to raw numeric difference because of the discrete/continuous problem above. Either describe the current predicate honestly—“point in opposite directions”—or define shared categorical bins and then measure categorical disagreement.

## Tests that do not prove their named claim

These concrete production changes survive the relevant tests:

- Anchoring: expose model valence anywhere outside `PlaceOnCriterion`. [referee-placement.test.tsx:522](/home/greg/code/spideryarn2/tests/referee-placement.test.tsx:522) still passes because it never mounts the panel.

- Five-position mapping: change the production `-50` step to `-40` at [PlaceOnCriterion.tsx:91](/home/greg/code/spideryarn2/src/web/PlaceOnCriterion.tsx:91). The parameterized test at [referee-placement.test.tsx:372](/home/greg/code/spideryarn2/tests/referee-placement.test.tsx:372) derives both its clicks and expected values from the same exported production table. Use an independent literal expectation table.

- Matching correctness: change [CriteriaPanel.tsx:744](/home/greg/code/spideryarn2/src/web/CriteriaPanel.tsx:744) to `placement={placements[0]}`. The existing gap tests still pass because they do not contain multiple blocks with qualifying human placements or same-block multiplicity.

- “No third number”: add `Gap: {Math.abs(refereeValence - modelValence)}` to the disagreement paragraph at [CriteriaPanel.tsx:971](/home/greg/code/spideryarn2/src/web/CriteriaPanel.tsx:971). The number check scans only `.crit-gap`: [referee-gap.test.tsx:276](/home/greg/code/spideryarn2/tests/referee-gap.test.tsx:276).

- Provider coverage: change production to a provider host absent from `PROVIDER_HOSTS`. The “every registered host” test at [no-provider-calls-guard.test.ts:117](/home/greg/code/spideryarn2/tests/no-provider-calls-guard.test.ts:117) still passes because it iterates the same registry. Replacing `globalThis.fetch` also leaves the installed boolean green.

- Criteria request serialization: remove the redundant rejection arm from the queue, changing `.then(patch, patch)` to `.then(patch)`. The test at [referee-criteria-panel.test.tsx:525](/home/greg/code/spideryarn2/tests/referee-criteria-panel.test.tsx:525) still passes because an inner catch already produces the same outcome. This is acknowledged in the test and is less concerning than the cases above.

I did not find an equivalent shared-assumption defect in the core filesystem/Postgres parity assertions. They use literal expected marks against both stores. The final “empty store” assertion is weaker than its comment suggests, but it is not concealing the placement bugs above.

## What held up

The body-wipe fix is complete:

- Non-object JSON becomes `{}`: [routes.ts:718](/home/greg/code/spideryarn2/src/routes.ts:718).
- Absence is distinguished with `"body" in raw`: [routes.ts:6239](/home/greg/code/spideryarn2/src/routes.ts:6239).
- `{body: null}` still clears.
- Primitive, array, null, empty, and unrelated bodies return 400.

I swept the other PATCH branches in `src/routes.ts`. I found no other route where an absent destructured field currently means “erase.” There is a pre-existing bare-JSON-null failure in the chat-title PATCH path, but it is a 500 bug, not another absent-field wipe, and it is outside this change.

## If I could make only one change

Implement the sealed-envelope state for the first referee placement.

Without that, the feature’s central scientific claim—an independent human judgement beside the model’s—is false even when every request and rendered number is technically correct. The current UI records “what the referee said after any amount of model exposure,” which is a different datum.