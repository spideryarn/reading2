# Code review, second pass: the storage behind the pair tidy

Read-only. Do not edit files, and do not run vitest, typecheck or a build: the box is overloaded and
I have run them (the two search test files and typecheck pass). Read and reason.

Your first pass is `docs/plans/261004l-pair-tidy-code-review-sol.md`. I kept R2 and R3. For R1 I
did **not** keep the Web Lock: `src/web/modes/search/stored-pairs.ts` now stores **one key per
pair**, named by the thorough row's id, so there is no shared list for another tab to write back.
It is synchronous again, with no lock, no fallback and no quarantine. I also reverted your
`loadedSlug` change in `useSearch.ts`; the tidy effect in `auto-thorough.ts` instead leaves `slug`
out of its dependencies, and its comment says why. R4 (a `removeItem` that throws) is accepted and
written in the module comment.

Read `src/web/modes/search/stored-pairs.ts`, the tidy effect and the `storedPairs` calls in
`src/web/modes/search/auto-thorough.ts`, the calls in `src/web/modes/search/SearchMode.tsx`, and
the plan's § Follow-up
(`docs/plans/261004l-quick-search-starts-a-thorough-search-in-the-background-and-swaps-it-in.md`).

1. Does one key per pair close R1? Name any interleaving of two tabs' `add`, `forget`,
   `invalidate`, `rename` and a tidy pass that revives a cancelled pair or deletes a quick row the
   reader kept. `rename` is the one read-then-write left.
2. Is leaving `slug` out of the tidy effect's dependencies sound on an article switch inside one
   mount, given `useSearch` resets `loaded` in an effect? The test is "a second article waits for
   its own opening list inside the same mount".
3. Anything else in these three files that is wrong, P0 or P1 only.

Findings numbered S1…, with severity and evidence. End with one line: land as is / land with the
changes named / do not land.
