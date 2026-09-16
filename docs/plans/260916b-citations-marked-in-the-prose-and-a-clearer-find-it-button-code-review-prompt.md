# Review the built code

You reviewed the **plan** for this earlier today and found six P1s
(`docs/plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button-review-sol.md`).
This is the code built from the revised plan. **You may fix what you find inside this change** —
`--sandbox workspace-write` — but write your findings to the `--output` file first, so I can read
the diff against them.

## What to read

- The plan, as revised after your review:
  `docs/plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md`. Every section
  you corrected says so in place.
- The diff. Three commits, all mine, nothing else in them:

  ```
  git show 5c8e4213   # the marks: MarkKind, citeMarks, the sanitiser, the CSS, the /design specimens
  git show 5ad4585b   # the list reaches the prose, and the hover card
  git show d6b417b0   # the Find it ControlTip (-3K), independent of the rest
  ```

  `git diff d1add28a HEAD` is all three at once (`d1add28a` is the plan commit).

## What was done with your six findings

Please check each of these against the code rather than taking my word for it.

1. **`start` / first-occurrence.** Accepted in full. `citeMarks` uses
   `quoteFinderWithMultiplicity` (which I exported from `src/quote-match.ts` — its comment said
   "kept private until a second bulk caller exists"), so it takes the **only** occurrence or none.
   `resolveMark` is not used, and `CiteSelection.places` has no `start` field at all so no caller can
   pass one. Is the forgiving/spaced pass choice right? Is there a case where the unique-match rule
   silently loses a mark I should be reporting rather than dropping?
2. **`resolveOne`'s whole-block fallback.** Accepted — not used. `tests/citation-marks.test.ts` pins
   that an unfindable place draws nothing.
3. **`NOT_A_BLOCK_SELECTION`.** Accepted, and I went further than you suggested: rather than letting
   cite marks fall through to block selection, `mark.cite` is now in the hover card's `tapSelector`
   (so a tap opens the card) **and** `"mark.hit.cite"` is in `NOT_A_BLOCK_SELECTION`. Please check
   that pairing carefully — it is the part I am least sure of. Specifically: is there a tap path
   where a citation now does nothing at all, and does a citation inside a *link* still navigate?
4. **The sanitiser needs three changes.** Accepted: `data-cite`, the `cite` reserved class, and
   `SANITIZER_VERSION` 6 → 7 with a history entry. Is there anything else that a version bump
   implies that I have not done — a migration, a stamp, a cache key?
5. **The hook split and `find`.** Accepted with the seam you preferred: `CitationsRead.applyFound`
   rather than `refresh()`. `tests/citations-find-late-reply.test.tsx` now drives both hooks
   together, and I mutation-tested the guard. Please check the split for anything that should not
   have crossed.
6. **The Find it copy.** Accepted in full. No call count, no fixed price, not "its own page". The
   existing regression test was re-pointed from `button.title` to the card rather than deleted.

And the scope cut: `?cite=`, the foot button and `barToReveal` are **not** built.

## What I would least like to be wrong about

- **The experimental switch.** I dropped the gate on your advice, so every owner's article load now
  issues a fourth GET. Is that actually harmless here — is there anywhere it makes a visitor, or a
  signed-out reader, issue anything? `tests/public-network-trace.test.tsx` asserts an exact
  request list, which I believe covers it.
- **`ProseHoverCard` importing `sourceOf` from `CitationsPanel.tsx`.** I did that so the card and the
  band cannot disagree about provenance. Does it drag anything into the bundle that was not there, or
  create a cycle?
- **The `works` prop being required.** It forced four call sites to decide, which I wanted. Did I get
  any of the three test call sites wrong — is there one where `[]` hides a real case?
- **`citeSelections` / `works` in `Reader.tsx`.** These are computed every render from
  `owner?.citations.citations?.citations`. Is the memo keyed correctly, and is `NO_WORKS` doing what
  I think for the empty case?

## What I have NOT verified

**Anything about how it looks.** No browser has rendered this. In particular the plan's open
question — whether a 1px dashed `text-decoration` on a citation reads as distinct from the glossary's
1px dotted `border-bottom` when both are on one phrase — is unanswered, and `/design` has three
specimens added for somebody to look at. Please do not guess at it; if you have a view on the CSS as
written, say so as a CSS finding rather than a visual one.

The full test suite has not run yet either. Scoped runs: 18 files / 436 tests green after the last
commit, typecheck exit 0.

## What I want back

Numbered findings, severity (P0 / P1 / P2), file and line, and what you would do. Say which of the
six above you actually re-checked. **Fix inside this change what you are confident about**, and
report anything wider for me to decide. If it is broadly right, a short review is a fine outcome.
