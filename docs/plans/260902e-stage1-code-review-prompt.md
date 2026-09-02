# Review prompt — Stage 1 code, Referee mode's prose colour

You reviewed the **plan** for this work and returned *do not build as written*
(`docs/plans/260902e-make-referee-mode-understandable-review-sol.md`). The plan was revised against
your findings and Stage 1 is now built. **Weight this review higher than the plan-stage one**: a
plan-stage review cannot find a `PATCH` that writes one field and then rejects the request.

Repository root is the current directory (a git worktree). The whole change is in the working tree
against `HEAD` — a scoped diff is saved at
`/tmp/claude-1000/-home-greg-code-spideryarn2/a4050f5f-51fd-4db5-acf6-5bbf91c54fff/scratchpad/stage1.diff`
(2,447 lines, `src` + `styles` + `tests` + `docs/project`). Read that first, then the files it
touches, then judge.

## What you should hold it to

`docs/plans/260902e-make-referee-mode-understandable.md` is the revised plan. Its § *Stage 1a* and
§ *Stage 1b* are the contract; § *Where this plan still disagrees with the review* is the one finding
of yours that was not taken, and why.

Which of your nine findings this stage was meant to answer, and how it claims to:

1. **Colour as the only carrier in the prose.** Answered by a sign after each valence-painted mark
   (`data-dir` on the mark, `mark.hit[data-dir]::after` in `src/web/styles.css`, generated content so
   it cannot be copied or reach the block's text offsets) and a **key** in the Criteria panel
   (`TheKey` in `src/web/CriteriaPanel.tsx`), shown while a for/against criterion is ticked on.
   **Is that enough?** The glyph's alt text is deliberately empty (`content: "−" / ""`) so a screen
   reader is not handed a stray minus inside the author's sentence. Judge that call.
2. **Paragraph-bar provenance.** Not taken as you proposed — see the plan's disagreement section.
   What *was* taken: `openPassage` is no longer hard-coded `null` in Referee mode (`src/web/App.tsx`),
   so pressing a result rings its exact phrase.
3. **The dedup.** `annotateHtml` now builds two token lists — identity deduped by slot, valence
   deduped by resolved token — and concatenates them. Check the two failure shapes you named are
   genuinely fixed, and that the `.slice(0, HUE_STRIPES)` across the concatenation cannot starve one
   kind of stripe in a way that matters.
4. **The mode-level scale.** `?refscale=` in `src/web/params.ts`; every `valenceToken` caller takes
   it, `src/web/PlaceOnCriterion.tsx` included. New rows write the mode scale into
   `referee_criteria.scale`. Check nothing still reads the column for display, and that
   `PlaceOnCriterion` reading the parameter through its own `useQueryState` (it mounts inside dialogs
   far from `RefereeBand`) cannot disagree with the panel.
5. **`Found` should carry the number, not a token.** It carries `valence: number | null`;
   `hitMarks(found, openKey, scale)` resolves the token. Check the resolution really happens at the
   Reader's edge and nothing upstream learned about the palette.
6. **Stage 1 must carry its own explanation and docs.** `docs/project/referee-mode.md` and
   `docs/project/colour-scales.md` are in this diff. Are they now correct, or do they still assert
   the reversed rule somewhere you can find?
7. **The ramp tick was unbuildable** (`accent-color` cannot hold a gradient). Dropped; the key does
   that job instead. Judge whether a flat identity green beside a valence green is still going to
   re-create the confusion.
8. **The card copy misstated default-off.** `WHAT_THE_TICK_DOES` in `CriteriaPanel.tsx` is the
   visible sentence that landed. Is it true?

## Three departures from the brief, which I want you to attack

1. **`data-dir` has a fourth value, `mixed` → `±`**, written only on the run where a valence mark
   *ends*. Is that right, or does it hide a direction the reader needs?
2. **The glyph is silent to a screen reader.** Finding 1's whole point was a non-colour carrier — and
   a carrier nothing announces is arguably not one, which is an argument
   `docs/project/colour-scales.md` and `CriteriaPanel.tsx` both make in other words.
3. **`docs/project/url-state.md` was not touched**, on the grounds that its parameter table has no
   row for `?runs=` or `?crits=` either. `?refscale=` is documented in `referee-mode.md` and beside
   its parser.

## Specifically go looking for

- **Anything that made Search, Ideas, Quotes, Timeline, the literal find or Claims behave
  differently.** The plan says they must be byte-identical. `resolveOne`'s spec now takes `valence`
  as a required field; check every producer and check `blockHues` and `src/web/spine-marks.ts` still
  read `slot` untouched.
- `src/sanitize-policy.ts` gained `data-dir` to `FORBID_ATTR` — not in the brief, added because an
  article could otherwise ship its own `<mark data-dir>`. Is that the right and complete defence, and
  is there any *other* new attribute or property in this diff that an article could forge?
- The `Mark` type is now `MarkBase & MarkValence`, a union meant to make `hue` without `dir`, `dir`
  without `hue`, and `hue` with a null slot unrepresentable. Can you construct a wrong `Mark` that
  still typechecks?
- `styles/colourscales.css` now defines the diverging ramps as `-rgb` triples with the plain colours
  derived (`--div-rg-0: rgb(var(--div-rg-0-rgb))`). Anything that consumed `--div-*` expecting a
  literal hex — in CSS, in TypeScript, in a test — and would now get an `rgb(var(…))` expression?
- The tests. Are the reversed ones in `tests/referee-criteria-resolve.test.ts` asserting the real new
  behaviour, or a restatement of the implementation? Is there a mutation to this code that leaves the
  whole suite green?

## Evidence

`npm run typecheck` is clean. `npm test`: **4 files / 4 tests red, all four already red before this
work** (`doc-links` — one broken link in an unrelated August plan; `pdf-bundle-trace`;
`store-artefact-manifest`; `store-roundtrip`). Baseline before the change was 10 files / 34 tests red.
Mutating `resolveCriterion` to pass `valence: null` turns 7 of the new tests red, so they bite.

Answer with a verdict — **ship / ship with changes / do not ship** — then numbered findings, most
serious first, each naming the file and line and what you would do instead. Do not summarise the
change back to me.
