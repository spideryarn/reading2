# Second review: did I actually fix what you found?

You reviewed this change an hour ago and returned PROCEED-WITH-CHANGES. Your review is in
`docs/plans/260828s-readability-unhide-code-review-sol.md`, in this repo — read it first. This is the
follow-up. **Your job is to check the fixes, not to re-review the original design**, except where a
fix creates a new problem.

Every finding you raised was reproduced independently before being acted on. One of your claims did
not reproduce on my first attempt and I want to be explicit about it: your mobile-drawer
counter-example did **not** get admitted when I placed the drawer as a sibling of `<article>` — link
density sinks it. It IS admitted when the drawer is inside the article container, at 1,370 characters
for thirty items. So you were right about the substance and the placement matters; both facts are now
written down.

## What I changed in response

**Finding 1 (High) — additions scored as "helps", warning suppressed.** Accepted.

- The READ THEM warning is now unconditional on any non-empty gain. The `!helped` condition is gone,
  with a comment naming the counter-example.
- `helped` is renamed `recoveredALot` and documented as a quantity, not a verdict.
- The run prints 10 additions instead of 3, and says how many more are in the JSON.
- The summary line no longer says "un-hiding helps N"; it says it adds text on N and that the added
  text is not scored.
- The closing paragraph no longer says the regression count decides whether un-hiding ships. It names
  the pattern the corpus cannot exhibit.

**Finding 2 (Medium) — `gainedText` is neither a block comparison nor complete.** Partly accepted,
partly declined; tell me if I drew the line wrong.

- Renamed in prose to *passages*. The tag list gained `td, th, caption, figcaption, dt, dd`, and
  elements whose ancestor is already reported are skipped (a `<li>` wrapping a `<p>` was counted
  twice).
- The doc comment now states the floor, the tag list, and three blind spots explicitly: a gain whose
  exact text already appears in stock is invisible, so a **duplicate never shows up**; text added
  inside an existing paragraph is invisible; short additions are invisible by construction.
- **The count changed from 94 to 76** after de-nesting. I verified your 96 independently: the real
  stage-3 block delta on the constitution is 358 → 454. The prose now gives 96 blocks and 76
  passages and explains the gap.
- **Not fixed**: the duplicate blind spot. `compare()` in inventory.mts already has multiplicity
  machinery that would solve it. Is leaving it a documented limitation defensible, or is a
  duplicate-insertion the exact harm this instrument exists to catch?

**Finding 3 (Medium) — the test does not prove stage 2 calls the helper.** Accepted, and this was
the best catch of the three.

- Added a test that goes through `runExtract` into a temp dir and asserts the recovered text is in
  the written file. **Watched it fail** with the production call deleted, then restored the line and
  watched it pass.
- Added a `describe("what this rule is known to let in")` block pinning your drawer counter-example
  as behaviour — both placements, with the assertion that the inside-the-article case clears 1,000
  characters.
- Corrected the "each caught by exactly one assertion" claim in the plan; you were right, it is two
  each.

**Design Q1 — restore-after-parse.** Not built. Your three-way rule (keep removal on recovered
content regions, restore on decorative/duplicate leaves, special-case a fallback image whose twin did
not survive) is recorded verbatim in the `src/extract.ts` doc comment as the design to revisit, with
the reason blanket-restore is also wrong. **Is deferring that acceptable, given the drawer pattern is
now known-and-unfixed and pinned as a test?** Say so plainly if you think the change should not ship
without it.

**The Wikipedia claim.** Reworded to yours — "restores non-empty accessible names to 188 retained
formula images" — with your three falsifiers written into the plan, and "audible" and "accessibility
win" removed from the code comment and the plan.

**The 48,147 / 39,355 conflation.** Fixed in `docs/project/content-extraction.md`, which now gives
39,355 as the accordion bodies, notes 48,147 is the total absent, and says the two were run together.

## What I want from you

1. **Does Finding 1 stay fixed?** Construct another page where the runner would print something a
   reader would take as reassurance while furniture came in. If you can, that is the third instance
   of this bug and it means the design is wrong, not the code.
2. **Is the de-nesting correct?** 94 → 76 is a big drop and I want it attacked. Does `contains()`
   over a list of already-reported elements miss a case, or over-suppress a real sibling addition?
3. **Is the duplicate blind spot acceptable to leave?** Argue the other side.
4. **Is the new `runExtract` test sound?** It writes to a temp dir. Anything about it that could go
   green for the wrong reason.
5. **Anything in the prose that still overstates.** That class of error has bitten this work three
   times: `\frac`, `48,147`, and "the instrument could have detected a wide harm".

Verify against the working tree, which has all of this in it. Read
`docs/plans/260828s-readability-unhide-code-review-sol.md`, `src/extract.ts`, `evals/extraction/corpus.mts`,
`tests/extract-unhide.test.ts`, `docs/plans/260827ab-readability-repair-pass.md`,
`evals/extraction/fixtures/README.md` and `docs/project/content-extraction.md` directly. Run
`npx vitest run tests/extract-unhide.test.ts` and, if you have the patience,
`npx tsx evals/extraction/corpus.mts` (about two minutes, no network, no model).
