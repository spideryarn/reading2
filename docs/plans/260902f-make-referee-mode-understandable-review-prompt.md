# Review prompt — plan for making Referee mode understandable

You are reviewing a **plan, before any of it is built**. Repository root is the current directory
(a git worktree of the Spideryarn repo). Read the plan and the code it names, and give a verdict.

## The plan

`docs/plans/260902f-make-referee-mode-understandable.md` — read it first, in full.

## The code it changes

Read enough of these to judge the plan rather than to describe them:

- `src/web/search-hits.ts` — `Found`, `resolveCriterion`, `resolveClaim`, `resolveHits`,
  `findLiteral`, `hitMarks`, `blockHues`
- `src/web/annotate.ts` — `Mark`, `annotateHtml`, and the slot→`--h0…--h5` code
- `src/web/styles.css` § `mark.hit` (the wash and the stripe rules)
- `styles/colourscales.css` — `--cat-N-rgb` (RGB triples) vs `--div-N` / `--div-rg-N` (hex)
- `src/web/valence.ts`, `src/web/hit-colours.ts` — the two colour systems
- `src/web/CriteriaPanel.tsx` — `CriteriaBand`, `NewCriterion`, `CriterionRow`, `CriterionResult`
- `src/web/ClaimsPanel.tsx`, `src/web/MirrorPanel.tsx`, `src/web/CandidatesPanel.tsx`
- `src/web/App.tsx` — `RefereeBand`, `RefereeViews`, `RefereeSubMode`, and the `passages` →
  `buildHitMarks` path around it
- `src/web/Tooltip.tsx` — `Tooltip`, `TooltipGroup`, `ControlTip`
- `src/referee-criteria.ts` — `RefereeCriterionConfig`, `DivergingScale`, `DEFAULT_DIVERGING_SCALE`
- `tests/referee-criteria-resolve.test.ts` — the two tests the plan deliberately reverses
- `tests/annotate.test.ts`, `tests/hit-colours.test.ts`, `tests/referee-criteria-panel.test.tsx`
- `docs/project/referee-mode.md`, `docs/project/colour-scales.md`, `docs/project/url-state.md`
- `src/web/install-hint.ts` — the existing dismissible-hint idiom

## What I want from you

Be adversarial. The plan reverses a decision that a previous cross-family review helped put in
place, so "it was decided before" is not by itself an objection — but the *reasons* it was decided
are in `referee-mode.md` and `resolveCriterion`'s docstring, and I want to know which of them the
plan has failed to answer.

Specifically:

1. **Does the paragraph bar actually preserve provenance?** The plan's whole affordability argument
   is that identity survives in `BAR_HUES` / `blockHues` while the phrase stripe goes over to
   valence. Check that in the code, not from the prose. Is the bar rendered in every place a hit
   mark is? Does it survive the reader having several criteria on? Is it visible enough to be a real
   answer, or is the plan leaning on something that is 3px wide and easy to miss?

2. **The dedup.** The plan keeps `annotateHtml`'s dedup keyed on `slot` and changes only what each
   stripe is painted with. Verify that this genuinely leaves Search, Ideas, Quotes, Timeline, the
   literal find and Claims byte-identical. Name any path where a `hue` that is absent would not fall
   back correctly, and any place two stripes could now be painted the same colour while `data-hues`
   says two.

3. **The mode-level scale.** The plan removes the per-criterion `Scale` select and puts one scale on
   the URL as `?refscale=`, because red means *against* on `rg` and *favour* on `br`, and the prose
   has no words beside it. Is that reasoning right? Check `valenceStep`, `--div-8`, `--div-rg-0`.
   Does painting the panel from a URL parameter rather than the stored `referee_criteria.scale`
   introduce a case where the panel and a stored row disagree in a way that matters? Is leaving the
   column unread the right call, or does it need to go now?

4. **Colour as a carrier.** `colour-scales.md` says colour may never be the only carrier of a
   good/bad judgement, and `DEFAULT_DIVERGING_SCALE` writes down the condition under which the
   red↔green default must move to `br`: *if the panel ever stops printing the direction in words*.
   The prose stripe has no words at all. Does putting valence into the prose break that rule, or is
   it — as the plan argues — no worse than today, since the stripe already carried an unlabelled
   meaning and the panel keeps all four carriers? If it breaks it, say what the plan must do instead.

5. **Stage boundaries.** Would abandoning this after stage 1, or after stage 2, leave something
   coherent? Is anything in stage 1 actually two stages?

6. **What the plan does not mention that it should.** In particular: anything about the referee's own
   placement (`PlaceOnCriterion`, `RefereeGap`) that a prose colour change touches; anything about
   `?crits=` and marks being default-off; the `open`/`openPassage` highlighted-mark path; and whether
   `Found.hue` is the right shape at all versus carrying the raw valence number and resolving the
   token at paint time.

7. **The dropped items.** The plan explicitly drops "bias automatic slot assignment away from
   ramp-adjacent hues". Is that right, or is a flat identity green sitting beside a valence green the
   thing that will re-create exactly the confusion this whole plan exists to remove?

8. Anything else you would refuse to build as written.

Answer with a verdict — **build as written / build with changes / do not build as written** — then
numbered findings, most serious first, each naming the file and what you would do instead. Do not
summarise the plan back to me.
