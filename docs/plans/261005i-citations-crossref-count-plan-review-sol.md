No established P0 or P1. The main feature path exists as described, and the proposed nullable columns and constraints can be added without rewriting existing data. These are non-blocking findings; their consequences are **reasoned**.

1. **F1 — P2, reasoned: specify `write` for every answer and every store.**  
   Stage 1 names test fakes, but [`memoryBibliographicStore`](src/backfill-registry-facts.ts:427) is a production implementation used by the backfill’s dry run. It also returns a boolean today.

   The returned timestamp must distinguish a successful DataCite or `not-found` write from a lost claim. Returning only `cited_by_count_read_at` would make both successful cases return null.

   **Change the plan:** require `write` to return `fetched_at` for every successful write, and null only when no row was updated. Set `citedByCountReadAt` from that moment only for Crossref `found` results. Explicitly update the production memory store using its injected clock, and test DataCite, `not-found`, cached reads and lost claims.

2. **F2 — P2, reasoned: the stored reader also needs the Crossref source check.**  
   Stage 1 §4 specifies count and timestamp validation in `readCitationRegistry`, but does not explicitly require `source === "crossref"`. Under those stated checks, a stored DataCite `found` record containing a well-formed `citedBy` could pass through the public projection and be labelled Crossref. The proposed writer would not create that shape; this concerns the reader’s stated protection against malformed stored JSON.

   **Change the plan:** retain `citedBy` only on a Crossref `found` record. Add a reader/public-projection test proving that a DataCite record keeps its ordinary metadata but loses `citedBy`.

3. **F3 — P2, reasoned: parser and SQL accept different numeric ranges.**  
   A non-negative JavaScript safe integer can exceed PostgreSQL `integer`’s maximum, `2,147,483,647`. For example, the proposed parser accepts `2,147,483,648`, but the write would fail and [`lookupWork`](src/bibliographic.ts:642) would return `unavailable`, losing the usable bibliographic answer as well. I found no evidence of a real Crossref count approaching that boundary.

   **Change the plan:** either bound accepted counts to the SQL range, treating larger values as no count while retaining the record, or choose a column type covering the promised range. Add boundary tests. The bounded `integer` option is simpler.

4. **F4 — P2, reasoned: “once” needs to mean one successful refresh, and the effects reach other callers.**  
   [`release`](src/store/pg-bibliographic.ts:140) preserves an old answer and clears only its claim. With the proposed freshness predicate, a failed refresh leaves the read timestamp null, so the next caller retries. An in-memory harness using the existing `lookupWork` reproduced two successive failed refreshes and two requests.

   There is no internal infinite loop. A successful Crossref answer without a count becomes fresh. Crossref 404 followed by a successful DataCite answer also becomes fresh because its source changes.

   However, this refresh can first happen during import, Debate or *Dig deeper*. A previously cached answer can become unavailable during an outage, and list enrichment can spend its budget refreshing records. *Dig deeper* already budgets registry time separately from the paper-read deadline; no new deadline allowance is needed. The backfill dry run bypasses the PostgreSQL cache entirely.

   **Change the plan:** say “one successful refresh; failed attempts remain eligible for retry.” Replace “registry facts are untouched” with “their output shapes are unchanged.” Add tests for failed refresh/retry, Crossref-to-DataCite replacement, and replacement by `not-found`, including clearing obsolete count fields.

   Additional call sites beyond the starting list are the wiring in `src/pipeline.ts`, `scripts/backfill-registry-facts.ts`, and the direct lookup in `scripts/probes/261001a-paper-read-probe.ts`.

5. **F5 — P2, reasoned: decoding must not feed opaque DOI characters into punctuation trimming.**  
   The double-encoding description is accurate: the current normalizer stores `%28`, and `doiUrl` writes `%2528`.

   But [`normaliseDoi`](src/paper-metadata.ts:140) also strips trailing brackets and other punctuation. Decoding `https://doi.org/10.1234/a%5B1%5D` and then applying that existing cleanup produces `10.1234/a[1`, losing the final bracket. The plan does not specify the ordering.

   **Change the plan:** handle surrounding prose punctuation before decoding address forms, then validate the decoded identifier without stripping its opaque suffix. Test encoded terminal brackets, literal `%252F`, malformed escapes, and the supported host variants.

   The legacy ambiguity is real: `a%2Fb` cannot reveal whether an old writer intended a literal escape or an encoded slash. `doiOfUrl` already documents that limitation. Preserve it explicitly; do not claim decoding recovers every historical intent.

6. **F6 — P3, reasoned: the named tooltip precedent is inaccurate.**  
   `ControlTip` exists, but *influence unknown* uses `Tooltip` plus `useTapReveal` in `UnknownInfluence`, not `ControlTip`.

   **Change the plan:** name `UnknownInfluence` as the interaction precedent. The required hover, focus and tap behaviour is available.

7. **F7 — P3, reasoned: nulling `fetched_at` would not work as stated.**  
   The rejected alternative says nulling old `fetched_at` values “would also work.” The existing `bibliographic_records_shape` constraint requires that field on `found` rows.

   **Change the plan:** remove that claim or acknowledge that it would also require changing the existing constraint. This does not affect the chosen additive migration.

The two timestamps are justified under the chosen freshness rule: the new nullable moment distinguishes “old code never captured this field” from “new code asked and received no count.” Returning the stored `fetched_at` is a small interface change that preserves the database-clock policy. I would also keep zero visible with its Crossref attribution; hiding it would erase a recorded result.

The restoration spot-check passed: the requested diff against `ac9b5bfcf` contains **52 additions and zero deletions**. No files were changed. The harness used mocked responses; no real registry requests or PostgreSQL checks were run.

**build as written**