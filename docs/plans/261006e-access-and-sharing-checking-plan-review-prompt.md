# Plan review: Access & sharing says "checking" while it asks, and asks again after a failed read

Read-only review. Do not edit files.

Read `docs/plans/261006e-access-and-sharing-says-checking-while-it-asks-and-asks-again-after-a-failed-read.md`
and check it against the code it names:

- `src/web/Metadata.tsx` § `readProvenance`, the `useEffect` keyed on `reload`, `SharingSection`,
  `SharingCard`, and every other reader of `provenance` / `provenanceError` on that page
- `src/web/useOrderedRead.ts` (`reload`, `refresh`, the generation counter)
- `src/web/AccessSharing.tsx` § `Learned`, `CardState`, `card`, the `report` effect, the render
- `src/web/lib/api.ts` (`apiFetch`: the offline copy answer, the one auth retry)
- `src/messages.ts` § `SHARING_UNKNOWN`
- `tests/metadata-sharing-card.test.tsx`

Questions:

1. Is the root cause stated correctly, and is there a third path to the stuck sentence the plan
   misses (for example a 200 whose `sharing` does not parse, or `apiFetch` answering from the saved
   offline copy)?
2. Does a timed `reload()` after a failed first read break anything else on the Metadata page that
   reads `provenanceError` or `provenance === null` (Delete, the pipeline rows, `hasShelfRow`, the
   purpose seed)? Does it race `useOrderedRead`'s generation logic or a slug change?
3. Is the retry schedule (2 s, 5 s, 15 s, 30 s, then stop; plus tab-visible) sensible, or is
   something simpler as good?
4. Does a `checking` kind on the card contradict anything the card promises (the `report` effect,
   the private-link control beside it)?
5. Is there a simpler design?

Answer with findings ranked P1/P2/P3, each with the file and line that shows it, and a verdict:
approve, approve with changes, or rethink. Be brief.
