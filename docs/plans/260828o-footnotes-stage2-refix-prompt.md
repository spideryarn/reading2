# Re-review: the three stage-2 blockers, fixed

Repo: `/Users/greg/Dropbox/dev/experim/spideryarn2`. You reviewed stage 2 of the footnotes work and
said DO NOT COMMIT AS-IS, naming three blockers. Your review is at
`docs/plans/260828o-footnotes-stage2-review-sol.md`. All three were accepted and fixed. `src/notes.ts` has
gone from 577 to 829 lines and `tests/notes-canonical.test.ts` from 34 to 50 tests.

**This is a re-review of the repair.** Your first pass found three real defects that 34 green tests
did not, so the question now is whether the repair introduced new ones — not whether the original
findings were right.

Read `src/notes.ts`, `tests/notes-canonical.test.ts`, and `docs/plans/260828o-footnotes.md`.

## What I verified myself, independently of the new tests

Blocker 1 (destroyed block ids). I built a true "before" pipeline — JSDOM + `unhideCollapsedSections`
+ Readability + `sanitizeHtml`, i.e. extraction without `canonicaliseNotes` — split it into blocks,
then ran the new pipeline passing those blocks as carry-over:

| fixture | before the fix | after the fix |
|---|---|---|
| gwern | 0 of 34 note blocks kept their id | **34 kept / 0 re-minted** |
| wikipedia | 90 of 121 kept | **121 kept / 0 re-minted** |

Whole-article churn is now 2 minted blocks each (the notes container), 184 and 356 carried.

Blocker 2: `indexTargets` is now first-in-document-order, ids before names, matching `blocks.ts`.

Blocker 3: recognition is now four explicit shape adapters — the stats report
`shapes: {gwern, wikipedia, substack, tufte}` — plus a `synthesised` count that is **0 for
Wikipedia** (author back-links preserved in place) and **5 for Tufte** (genuinely absent, so minted).

Landing measurements unchanged: substack 36 → prose / 0 → stub; gwern 87/17; wikipedia 338/5; ar5iv
and gutenberg 0 notes.

Your green mutation is dead: blanking `back.textContent` now fails 2 tests. I ran that myself.

## What I want from this pass

1. **Did the repair break anything?** In particular, does preserving the author's back-link in place
   leave a path where a stamp lands on a node that is later moved, or where Wikipedia's plural
   back-links are annotated inconsistently?
2. **Are the four adapters actually narrow?** Or is there still a generic path that can hoist
   ordinary prose out of the document? You reproduced `<td>` and `<nav>` cases before — try to find a
   new one. There are now tests for table/nav/header/footer/aside; look for what they do not cover.
3. **Stable ids again, harder.** My carry-over measurement covers gwern and wikipedia. What about
   substack and tufte, where blocks genuinely must change because the old shape was broken? Is the
   churn there the minimum necessary, and is it a one-time migration or does it recur on every
   re-extraction? The steady state is what matters.
4. **A new green mutation.** Name one, if there is one: a change to `src/notes.ts` that leaves all
   50 tests passing while breaking something a reader would notice.
5. **Anything you flagged as non-blocking that is now worse**, particularly the order-dependent
   suffix for notes with identical text ("Ibid."), which I chose to document rather than fix in v1 —
   tell me if that was the wrong call.
6. **Is it committable now?** Say plainly yes or no.

Cite files and lines. Disagree with my judgment calls where you think they are wrong.
