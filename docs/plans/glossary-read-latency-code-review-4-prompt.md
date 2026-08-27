# Fourth code review — the last one

Three reviews, three "not safe to commit", every finding right. All fixed. Read-only; rank
findings; verdict on one line.

## Read

- `docs/plans/glossary-read-latency-code-review-3-sol.md` — your last review.
- `docs/plans/glossary-read-latency-code.diff` — regenerated, and it now includes
  `docs/project/glossary.md`.
- `docs/plans/glossary-read-latency-new-tests.txt` — the three new test files.
- `docs/plans/glossary-read-latency.md` — the plan.
- The live files.

`src/web/App.tsx` still carries another agent's concurrent work. Mine: the `useGlossaryRead` call,
`terms`, the `GlossaryBand` props, the deleted `onEntries` effect.

## What changed since your third review

1. **The doc.** `docs/project/glossary.md` § the underlines no longer describes `useGlossaryTerms`,
   the second list or `onEntries`. It says what happens now, why the band still revalidates, and
   that the rule is "`status` never returns to `loading`" rather than "fetch once".
2. **The plan** now documents `refresh`, the `patchEntry(id, lookup)` signature, and the fact that
   `patchEntry` deliberately does *not* bump the generation — it previously said every mutation did.
3. **`pg.ts`** — the orphaned "everything except raw bytes" docblock is gone; its 23.89 MB
   measurement is carried into the policy's own docblock, and the `raw-bytes-in-storage.md` note
   moved onto the `rawBytes: []` line.
4. **`patchEntry(id, lookup)`.** The invalid state is no longer representable. `look()` throws if
   the server returns an entry with no lookup, rather than resolving as though it had worked.
5. **The SQL loop covers all eight reads**, `tweets` and `summaries` included, and the glossary
   assertion now also excludes `"tweets"`. The test says in a comment that `library` and `publish`
   are asserted there through `currentRevisionQuery` rather than through the queries they really
   run, and that the source check below is what covers those.
6. **The fifth tautology is gone** — `expect(hashBlocks(blocks)).toEqual(hashBlocks(blocks))` — and
   the comment records what it was.

362 tests pass across the suites this touches. Typecheck clean for every file in this change. Lint
clean on the touched files.

## Attack

1. **The sixth tautology.** There has been one every round. Find it, or say there is none.
2. **`look()`'s new throw.** It sets `lookFailed` and the reader sees a message. Is throwing right,
   or does it turn a recoverable oddity into a visible failure? Could the server legitimately
   return an entry with no lookup?
3. **Does the doc now say anything false**, or leave a reader of `glossary.md` with a wrong model
   of the fetch?
4. **Anything in the diff that is still wrong.** Assume I have stopped being able to see it.
