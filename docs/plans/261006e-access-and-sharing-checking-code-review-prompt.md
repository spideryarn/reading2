# Code review: Access & sharing says "checking" while it asks, and asks again after a failed read

You are reviewing commit `134376afd` in this worktree (`git show 134376afd`). The plan, with your
own plan review and what was done about each finding, is
`docs/plans/261006e-access-and-sharing-says-checking-while-it-asks-and-asks-again-after-a-failed-read.md`.

You may write. Rules:

- **Fix what is inside this change**, narrowly, and each finding red-first: write the test that
  reproduces it, watch it fail, then fix. Do not commit.
- **Report, do not fix, anything wider.** The plan names two things left on purpose: a 200 whose
  `sharing` does not parse, and the private link's own read.
- Do not start a dev server and do not run the whole suite; run
  `npx vitest run tests/metadata-sharing-card.test.tsx tests/access-sharing.test.tsx` and
  `npm run typecheck`.
- Do not attribute words to Greg in anything you write.

Look hardest at:

1. The retry effect in `src/web/Metadata.tsx` (`READ_AGAIN_AFTER_MS`, `failedReads`). Can it fire
   for the wrong article after a slug change, fire after a success, loop for ever, or stop early?
   `setFailedReads(0)` runs in the effect keyed on `reload`; is there an ordering in which a late
   failure from the previous slug bumps the new slug's count (check `current()` in
   `readProvenance`)? Does a failed *refresh* (a row's `refresh` after a job) with `provenance`
   null re-arm it, and is that right?
2. `checking={provenance === null && provenanceError === null}`: is there a moment after a slug
   change, or during a retry, where this is wrong, e.g. says *could not check* about the new
   article because the old error is still in state for one render?
3. The `checking` kind in `src/web/AccessSharing.tsx`: every place that branches on `card.kind`,
   the `report` effect, `shared`/`publicAt`, the confirm dialog. Can a control be offered while
   checking? Can `acted` and `checking` disagree?
4. `src/web/PrivateLink.tsx`: drawing nothing in place of `SHARING_INVENTORY_UNKNOWN` while
   `checking`. Is anything else there false during the wait?
5. The four new tests in `tests/metadata-sharing-card.test.tsx`. Would each fail if the fix were
   removed? The fourth (unmount) was never watched red; mutate the code to check it, and say what
   you saw. Is anything asserted that the stub makes trivially true?
6. Any other reader of the Metadata page's first-read failure that now behaves differently because
   the read is retried (Delete, Archive, the pipeline rows, the purpose seed).

Answer with findings ranked P1/P2/P3, each with file and line, what you changed for each, what you
left, the output of the two commands above, and a verdict. Be brief.
