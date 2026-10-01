No P0s. The rename architecture is basically sound; the vision doc needs several factual and question-design corrections before approval.

## P1

- **The narrow-width claim is false on phones.** The doc says that below 900px “whichever was pressed last wins” and calls that the current phone behavior ([interface-vision.md:98](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/project/interface-vision.md:98), [interface-vision.md:144](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/project/interface-vision.md:144)). In fact:

  - ≥900px with the rail: band and margin coexist.
  - 612–899px: the most recently pressed one swaps in.
  - <612px: Marginalia cannot fit even alone, so pressing it leaves the band open and the notes hidden.

  That behavior is explicit in [press.ts:18](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/web/annotations/press.ts:18), [press.ts:55](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/web/annotations/press.ts:55), and the phone test at [every-mode-draws-its-surface.test.tsx:1568](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/tests/every-mode-draws-its-surface.test.tsx:1568).

- **The proposed Dock-recession question rests on content coverage that does not exist.** Option B says Ideas, Timeline and FAQ already show in the prose ([interface-vision.md:183](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/project/interface-vision.md:183)); they do not. Ideas and Timeline marks are selected only while their respective band is active, and FAQ marks nothing ([passages.ts:117](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/web/reader/passages.ts:117), [passages.ts:160](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/web/reader/passages.ts:160)). Glossary, Quotes and Citations are the current standing prose marks. Do not ask about hiding the other modes until replacement access has shipped.

- **Question 2 combines two independent decisions and its options are not mutually exclusive.** “What content next?” and “may opening Marginalia generate missing artefacts?” need separate answers. “Free-to-store modes” is also undefined and potentially misleading: generating those artefacts costs money ([interface-vision.md:179](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/project/interface-vision.md:179)). The recommendation “A now, C later” likewise does not choose one offered answer.

- **Not every Debate claim row is disputed.** The anchoring claim is correct: every `ClaimDebateRow` has a validated `blockId` and located `claimQuote` ([types.ts:5412](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/types.ts:5412), [debate.ts:1014](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/debate.ts:1014)). But its relation may be `qualifies`, `extends`, `corroborates`, or `unclear`, not only `disputes` ([types.ts:5057](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/types.ts:5057)). The vision should say that the margin filters anchored claim rows to genuinely disputing/against rows, and define that filter before implementation.

## P2

- **The legacy translation is correct today, but “any non-band Mode” is too implicit.** Currently Marginalia is the only non-band `Mode`, so the proposed condition gives the intended result. Prefer one named predicate such as `isMarginaliaModeWord(value)`, explicitly accepting canonical `marginalia` and legacy `annotations`, then use it in:

  - `marginInSearch`
  - Reader’s atomic arrival rewrite
  - Dock’s link canonicalisation
  - `rememberableSearch`

  This avoids silently turning a future second non-band control into Marginalia. Tests should mirror the existing legacy conflict cases—especially `mode=marginalia&margin=0`, both parameter orders, metadata links retaining another band, and the mounted owner/visitor Reader rewrite—not merely the pure helper checks in [marginalia-name.test.ts:31](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/tests/marginalia-name.test.ts:31).

- **Skipping `RETIRED_MODES` is right.** That table maps old words to a `BandMode` ([modes.ts:304](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/modes.ts:304)); Marginalia deliberately is not one. Adding it would either fail the type or make `readMode`/titles incorrectly treat Marginalia as a left band. `modeFromParam("marginalia") === null` is what keeps server and client titles equivalent to today’s `annotations` behavior ([modes.ts:320](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/modes.ts:320), [read-address.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/read-address.ts:47)). However, the generic retirement checklist currently says every removed word goes into that table ([mode.md:415](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/project/mode.md:415)); add the approved non-band exception so the governing doc remains true.

- **No database artefact is orphaned, but one diagnostic wire value loses compatibility.** Feedback currently publishes only the active `BandMode`, not Marginalia state ([feedback-context.ts:50](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/web/feedback-context.ts:50)), so the plan’s claim that feedback diagnostics normally “say the mode word” is wrong ([plan:77](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md:77)). Existing stored blobs are safe, but a cached old client that submits `mode: "annotations"` after deployment will have that field dropped because the server validates against current `MODES` ([feedback-payload.ts:506](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/feedback-payload.ts:506)). Either accept and document that small diagnostic loss or let the V1 parser accept the legacy word.

- **The Sentry statement is inaccurate.** Changing a `feature` tag does not guarantee a new issue group; this code only attaches tags before `captureException` ([plan:48](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md:48), [monitoring.ts:174](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/web/monitoring.ts:174)). Say that historical events retain the old tag and new events use the new one; grouping may remain unchanged.

- **The docs claim completion before the rename exists.** The vision says “renamed” and “done” ([interface-vision.md:52](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/project/interface-vision.md:52), [interface-vision.md:155](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/project/interface-vision.md:155)), while the feedback note says “Shipped” and “on dev” ([feedback note:48](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/user-feedback/261001_1132-interface-vision-and-annotations-become-marginalia.md:48)); current code still contains `"annotations"` in `MODES` ([modes.ts:232](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/src/modes.ts:232)). Keep those statements pending until the implementation has landed.

## Recommendation

Do the full internal rename now. The code is new and compact, and “annotation” already has a different legitimate meaning in `annotate.ts`, `annotations.css`, URL-citation annotations, and MathML. Rename the folder and Marginalia-specific identifiers, while leaving those generic annotation mechanisms alone. I would use `MarginaliaNote`, not `MarginNote`, because the margin may later also contain reader-authored notes.

The better first three questions are:

1. For the first version, should the left remain today’s one-mode-at-a-time band, or should that decision be deferred? Recommend deferring structural change and retaining the band.
2. Which already-stored content should enter Marginalia next: genuinely disputing Debate rows, FAQ passages, or one small trial first? Recommend one small stored-data trial.
3. May opening Marginalia ever generate a missing artefact? Recommend no: show only existing data until Greg explicitly approves an automatic-spend policy.

The Dock-recession question should wait until equivalent access to each affected mode’s content actually exists.