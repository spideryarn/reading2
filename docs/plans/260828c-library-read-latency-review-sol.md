## Findings, ranked

1. **Must-fix — `root_gist = null` does not mean “scalar missing.”**

The proposed fallback runs when any of the five scalars is null ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828c-library-read-latency.md:252)). But `deriveLibraryScalars` deliberately returns `rootGist: null` when there is no gist, summary, or excerpt ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:294)). That is valid data.

A legitimate gistless article would therefore read and sanitise all its blocks, log a warning, and do both again on every shelf request.

Use the four numeric fields as the completeness signal, checking `=== null`, not falsiness. Recompute all five when one of those four is null. Add a case with `wordCount = 0`, `partCount = 0`, `sectionCount = 0`, and `rootGist = null` that proves no fallback and no warning.

A database constraint is preferable eventually, but it cannot be simple column-level `NOT NULL`: drafts intentionally start with null derived fields. It would need a conditional check such as “if status is published, the four numeric scalars are non-null.” `root_gist` must remain nullable unless a separate “scalars computed” marker is added.

2. **Must-fix — the immutability proof misses the importer, and one skip rule is reachable.**

The claim that nothing changes `tree` or `revision_blocks` after publication is false ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828c-library-read-latency.md:302)).

For unchanged text, the importer deliberately reuses the current published revision ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:440)), updates `tree` and all scalars through `ON CONFLICT DO UPDATE` ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:509)), then deletes and recreates that revision’s blocks ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:567)). This is safe today because all of it is in one transaction and the scalars come from the same files. That—not immutability—is the invariant.

The importer also bypasses `reasonsNotToPublish`. It requires the two files but never requires a non-empty block array ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:217)). It can publish and point at an empty revision, so the shelf’s `blockCount === 0` skip can fire. “Neither has ever fired” is unsupported and cannot be inferred from `publishRevision`.

Add tests that:

- Re-import unchanged text with changed `words`, tree depths, and root blurb; require the same revision ID and matching stored scalars.
- Decide whether an empty block file must be refused or deliberately produces a skipped shelf entry.
- Assert the importer and publisher are the only production publication paths.

Carry-forward itself is safe: derived fields are omitted from the draft and recomputed at publish. Failed jobs do not move the pointer, and re-publishing a published revision is refused. I found no admin revision writer.

3. **Must-fix — the proposed projection does not fit its own policy or current row typing.**

`headingTitle` is placed inside `REVISION_PROJECTIONS.library` ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828c-library-read-latency.md:149)), but it corresponds to no `article_revisions` column. The proposed policy test derives its complete expected key set only from revision columns, so it must reject `headingTitle`.

Keep `headingTitle` as a separate top-level computed selection, or explicitly model computed fields outside the revision-column policy.

There are two more typing details:

- In installed Drizzle 0.45.2, `isNotNull()` returns `SQL<unknown>`, not `SQL<boolean>`. Node-postgres parses PostgreSQL booleans into real JS booleans, so there is no truthy-string runtime bug, but use `sql<boolean>\`${column} is not null\`` to make the type honest. No mapper is needed.
- Current `RevisionRowFor` assigns every projection alias that is not a schema key the type `never` ([pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:388)). `hasArc`, `hasTree`, and `headingTitle` therefore need real select-result typing, not that schema-key mapping.

The proposed `"value" | "presence"` axis is otherwise reasonable. Rename the two same-named maps to `REVISION_READ_POLICY` and `REVISION_CARRY_POLICY`; their present names make this plan needlessly easy to implement in the wrong file.

4. **Must-fix — several checks can still pass over the exact regression they name.**

Check 2 must build the actual `listArticles` query. Building SQL from `REVISION_PROJECTIONS.library` alone repeats the last review’s failure: the projection can be perfect while production selects the whole row. Export a `listArticlesQuery` builder seam.

Check 4 must:

- Fail if the pool wrapper did not attach.
- Assert exactly the intended normal-path query count—apparently two—not merely that two runs have equal counts.
- Assert the fixture created exactly N shelf rows.
- Inspect captured SQL and require no block query on non-null scalar rows.

Otherwise zero captured queries, zero selected articles, or one constant megabyte block query all pass.

The benchmark has the same fail-open hole: `scratch-lib-bench.mts` silently continues when its private Drizzle client path is absent ([scratch-lib-bench.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/scratch-lib-bench.mts:11)). Make absence an error. Its “bytes decoded” number is actually `JSON.stringify(result.rows)` size, not wire bytes or decoded memory; rename it.

5. **Should-fix — split Part 8, and make concurrency the helper’s responsibility.**

`allSettled` with artefact-first rethrow preserves the visible error priority. Starting `resolveProfile` for a nonexistent slug is benign: its shelf error is already swallowed ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2508)). Attaching `allSettled` immediately also avoids unhandled rejections.

But taking an already-started promise makes concurrency a caller convention. A helper test can pass while all four routes still await the artefact before calling it. Take a thunk instead:

```ts
withProfileChanged(slug, () => loadGlossary(slug), stampOf)
```

Then the helper starts both operations and can prove it.

This should be a separate change. Parts 1–7 are one coherent shelf optimization. Part 8 changes four unrelated routes, error scheduling, and pool scheduling without a production measurement. One artefact query plus the profile’s two concurrent queries can consume three of the five pool slots per request; under contention that can delay the artefact’s next query rather than accelerate it.

6. **Should-fix — the stated gist and title coverage is overstated.**

`tests/library.test.ts` does not cover the complete gist fallback chain. It covers root gist and total absence, but not root summary or excerpt ([library.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/library.test.ts:145)). The scalar tests cover gist and excerpt, but not summary. Add all four outcomes: gist, summary, excerpt, null.

The title SQL rule itself is equivalent:

- `blocksFor` orders by ordinal before `.find`.
- Nullable `level` does not match `= 1`.
- The sanitiser changes only `html`, not `text`.
- The `(revision_id, ordinal)` unique index supports an ordered scan, filtering until the first H1.

Check 7 is useful as an integration parity guard, but not an independent oracle. Changing both spellings together stays green. Use a controlled fixture containing multiple H1s, a preceding H2, and block IDs whose lexical order differs from ordinal order.

7. **Note — the grouped comment query is sound, with one correction.**

The grouped count correctly handles absent rows as zero, and Drizzle’s `count()` maps the result to a number.

There is no new ownership leak. The IDs come from owner-filtered articles, and the old query also filtered comments only by `article_id`. The schema does not enforce that `comments.owner_id` equals the article owner, so a malformed cross-owner comment would be counted before and after. That is a separate schema invariant, not a regression here.

Also, installed Drizzle turns `inArray(column, [])` into SQL `false`; it does not emit invalid `IN ()`. The short-circuit still avoids a pointless query, but the plan’s stated reason is false.

## Mutation audit of the numbered checks

| Check | Edit that should make it red | What can remain green |
|---|---|---|
| 1 | Return `wordCount + 1` from the Postgres shelf | Restored N+1 reads; a shared derivation bug affecting both stores; entire suite skipped |
| 2 | Replace `hasArc`’s presence expression with the JSONB column | Production query selects whole row if the test builds only the projection |
| 3 | Drop `hasArc` while leaving its policy grant | Change both policy and projection together; current design also cannot account for `headingTitle` |
| 4 | Restore either per-row block or comment query | Failed wrapper, zero-row fixture, or constant batched block read unless exact counts and SQL are asserted |
| 5 | Default a missing comment count incorrectly or key the map by the wrong article | Empty-list behavior unless separately tested; cross-owner corruption |
| 6 | Remove the title subquery | Passes if the fixture’s revision title is not really null |
| 7 | Change only SQL to level 2 or block-ID order | Changing both implementations; corpus data that does not distinguish the orders |
| 8 | Remove fallback or warning | Broken handling of another scalar; falsy-zero bugs; legitimate null `rootGist` causing fallback |
| 9 | Swap `partCount` and `sectionCount`; break one gist rung | Summary fallback is currently untested |
| 10 | Make profile reject first, then replace `allSettled` with `all` | Routes awaiting before calling a promise-taking helper |
| 11 | Restore the old reads | Missing instrumentation can report zero; the byte metric is not wire size |
| 12 | Introduce a type error or failing assertion | Behavioral regressions outside the focused tests |

The new leaf module is a good home. The complete code-import sweep is `pg-revisions.ts`, `import.ts`, `api.ts`, `pg.ts` for the fallback, and `store-revision-policy.test.ts`. Prose hits include those files, `tests/chat-anchor.test.ts`, `docs/plans/260826e-postgres-storage-implementation.md`, and the stale `describeArticle` statement in `docs/plans/260825f-postgres-migration.md`. Update `docs/project/library.md` to add the new module and record that the Postgres shelf now consumes stored scalars; `docs/project/database.md` should record the importer exception to published-revision immutability.

Deferring the sanitiser stamp remains right; removing shelf block reads strengthens that decision. The shared tree currently contains uncommitted `0020`, not the plan’s stated uncommitted `0019`, so refresh that coordination note before implementation.

**Verdict: not ready to build.**