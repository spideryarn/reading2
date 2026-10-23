# Code review: 261023b, endnotes typed as references are kept as notes

You are reviewing code built from a plan you reviewed earlier. **You may fix what you find**, inside
this stage's files only (src/pdf-read.ts, tests/pdf-footnotes.test.ts, docs/project/content-extraction.md,
docs/plans/261023b-*.md). Report anything wider for me to decide. Do not commit, do not run git
commands that change state.

Read:

- the plan, now with your plan review's findings answered and the measurements:
  docs/plans/261023b-endnotes-typed-as-references-are-kept-as-notes.md, and your plan review
  docs/plans/261023b-endnotes-typed-as-references-plan-review-sol.md
- the diff: data/261023b/code.diff (`git diff HEAD -- <those files>`)
- in src/pdf-read.ts: `endnotesTypedAsReferences`, `startsNote`, `BARE_LABEL`, `LABEL`/`NOTE_LABEL`,
  `collectNotes`, and the call in `renderHtml`; and what reads notes after (`findMarkers`, note linking)
- evidence: data/261023b/notes-chunks.json (the real readings), data/261023b/replay-notes.mts and
  notes-list.mts (the replay; run them with
  `npx tsx data/261023b/replay-notes.mts data/261023b/rovelli-chunks.json`, all 33 real readings),
  data/261023b/notes-after.txt

Check especially:

1. Did each plan-review finding land correctly (F1 labelled `continues`, F2 Notes section + list
   heading close + symbol reset, F3 order, F4 held bare label)?
2. `startsNote` now changes `collectNotes` for every PDF: a `continues` footnote whose label is the
   last note's + 1 starts a note. Any real shape where that splits a note wrongly? Is `lastNumber`
   kept right across a join, a held label and a symbol note?
3. The held bare label: is it right that any non-footnote record between the label and its
   continuation does not clear it? (`collectNotes` sees only footnote records.) Could a held label
   wrongly join a much later continuation? The page window is 0–1.
4. `NOTE_LABEL` was rebuilt from a string with `new RegExp(..., "u")`: identical behaviour to the old
   literal, including `\p{L}` and the superscript classes?
5. `endnotesTypedAsReferences`: the `near` test uses `lastPage`, which a typed footnote also sets;
   a reference in the Notes section on a page far from any note resets `last`. Anything else that
   would resume a chain it should not, or stop one it should (Rovelli's real 128|129–134 reading)?
6. Tests: missing cases, or a test that would pass against the old code for the wrong reason.

Run `npx vitest run tests/pdf-footnotes.test.ts` and `npm run typecheck` after any fix. Number
findings F1, F2, … with severity and what you changed (or recommend). End with one line: SHIP, SHIP
WITH THE FIXES MADE, or DO NOT SHIP.
