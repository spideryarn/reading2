# A narrow question: your P1-4 page, exactly

In your plan review of `docs/plans/260930e-figures-readability-deletes-with-their-wrapper.md`
(answer in `docs/plans/260930e-figures-readability-deletes-with-their-wrapper-plan-review-sol.md`),
finding 4 said: *"with four sibling authored `<article>` sections and a separate figure whose long
linked caption is inside the media `div`, the control keeps all four author paragraphs and no image.
After unwrapping, the figure wins candidate selection, the image survives, and all four author
sections disappear."*

Rule C has now been built, differently from the spike you reviewed: see `protectAuthoredStructure`
and `readabilityWouldTakeItForItsLinks` in `src/protect.ts`. It only unwraps a `div` that
Readability's own two link rules would delete, and it no longer deletes any link-only child.

I tried to rebuild your page (`scratch-6a/adv.ts`, and the last test in
`tests/extract-figure-wrappers.test.ts`) and could not make the treatment lose prose.

Please:

1. Write your exact page as a standalone HTML string into a new file
   `scratch-6a/sol-p1-4.html`.
2. Run it through the shipping path — `readArticle(html, "https://example.org/x")` from
   `src/extract.ts`, and the same with `withProtectionDisabled` from `src/protect.ts` — using a small
   script you write at `scratch-6a/sol-p1-4.ts` (`npx tsx scratch-6a/sol-p1-4.ts`).
3. Report `kept`, whether each of the four sections survives in each arm, and whether the image
   survives.
4. If the page no longer makes rule C lose prose under the built gate, find the smallest change to
   it that does, if any exists, and save that as `scratch-6a/sol-p1-4.html` instead. If none exists
   under the gate, say so plainly and explain why the gate prevents it.

Do not edit anything outside `scratch-6a/`. Write your answer to the output file: the `kept` values,
the per-arm survival table, and one paragraph of explanation.
