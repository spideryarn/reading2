## Findings, ranked

1. **Must-fix — the proposed shared read cannot support `reset()` or `look()`.**

The plan exposes state plus `reload()` only ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/glossary-read-latency.md:91)). But today:

- `reset()` clears `glossary`, flags, and status immediately after DELETE ([useGlossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:301)).
- `look()` merges the returned entry into the current glossary without refetching ([useGlossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:334)).

After those setters move to `Reader`, the band needs explicit `clear()` and `updateEntry()` operations, or those verbs must move into `useGlossaryRead`.

There is still a same-slug race: an old GET can land after DELETE, lookup, or a job reload and restore old data. The `live` flag only handles unmount/slug change; it does not order concurrent operations for one slug. Replace `pushed` with a request generation or abort controller. Invalidate older requests before applying a mutation.

2. **Must-fix — removing the band’s mount fetch makes completed work in another tab invisible.**

Today the band fetches whenever it mounts ([useGlossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:208)). After the refactor, it receives whatever `Reader` fetched earlier.

`useJobs` deliberately treats its first poll as a baseline and does not call `onFinished` for already-completed jobs ([useJobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useJobs.ts:316)). Therefore:

1. Reader loads glossary A.
2. Another tab produces glossary B while this band is closed.
3. This tab opens the band.
4. The first job poll sees the completed job but suppresses the callback.
5. Glossary A remains indefinitely.

I would build Reader-owned shared state, but revalidate in the background when the band opens. Render the existing list immediately; do not return to `loading`. Deduplicate if the initial request is still in flight. Consequently, “exactly one request for the page’s lifetime” is the wrong invariant.

A module-global SWR cache is worse here: it needs user-aware keys, sign-out clearing, mutation invalidation, 404 rules, and response cloning. Summaries and ideas do not currently have duplicate readers, so it buys them little.

3. **Must-fix — the proposed hash-only rows do not satisfy the existing contracts.**

The plan selects `{ blockId, text }` ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/glossary-read-latency.md:121)), but `hashBlocks` requires `{ id, text }` ([source-hash.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:36)). Select:

```ts
{ id: revisionBlocks.blockId, text: revisionBlocks.text }
```

There is a second type gap: all four staleness functions currently accept full `Block[]`, including ideas’ fingerprint ([tweets.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tweets.ts:106), [glossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:705), [summarise.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:776), [ideas.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:123)). Narrow those signatures to `readonly Pick<Block, "id" | "text">[]`, or compare a precomputed hash.

The sanitiser omission itself is safe: its contract explicitly says it never changes `text`, and its implementation changes only `html` ([sanitize.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize.ts:127), [sanitize.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize.ts:147)). Downstream implementations use only `hashBlocks`; ideas additionally hashes the tree.

4. **Must-fix — the named parity test does not cover ideas.**

`store-parity.test.ts` compares tweets, glossary, and summaries, but not `loadIdeas` ([store-parity.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-parity.test.ts:195)). The plan changes `loadIdeas` and claims parity covers every artefact ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/glossary-read-latency.md:182)). Add ideas, including a case where only the tree changes.

5. **Should-fix — the diagnosis identifies waste, but does not establish the production bottleneck.**

The visible loading state waits for one second GET, not two serialized GETs. Duplication explains why that GET exists; it does not double that panel wait.

The warm server path has four serial database phases:

1. `currentRevision`
2. block read and sanitisation
3. lookup read
4. `resolveProfile`, which performs profile and shelf queries in parallel ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2367))

`withProfileChanged` starts only after `loadGlossary` finishes ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2936)). The lookup and block-hash reads can run concurrently once the revision is known, and profile resolution can run concurrently with the artefact read.

My likely warm ordering, explicitly an inference, is:

- jsdom sanitisation and large-row transfer/decoding;
- the serial query waterfall;
- small lookup/profile queries;
- `guardDbStore`, which is only a function wrapper and rejection handler.

Cold requests can instead be dominated by DB TLS connection setup, JWT-key retrieval, bundle loading, and jsdom initialisation. `sanitize.ts` constructs a JSDOM instance at module load ([sanitize.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize.ts:59)), so skipping the sanitiser call does not remove its cold-start cost.

The 1 MB figure is a disk-derived estimate, not wire evidence, and excludes attached lookup answers. Measure production p50/p95 with spans for authentication, pool acquisition/connect, each query including row decoding, sanitisation, JSON serialisation size, and total response time. Separate cold and warm invocations. Vercel and Supabase are both in London, so cross-region latency is not the issue ([deployment.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/deployment.md:23)).

6. **Should-fix — narrowing the HTML columns is safe, but one shared revision projection remains too broad.**

Independent tracing confirms `extractedHtml` and `stampedHtml` are not read through `currentRevision`:

- carry-forward derives its own exhaustive column list ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:234));
- export deliberately selects the full revision and writes `stampedHtml` ([export.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/export.ts:235));
- import writes the columns;
- `pg-admin.ts` does not read revisions.

Narrowing would also affect `listArticles` and `publishRevision`, because both use `REVISION_COLUMNS`; the plan should name that. Their current uses do not need the two HTML fields, and inferred types should make a mistaken direct access fail at typecheck.

But glossary still receives every unrelated JSONB artefact. Prefer projections per use:

- glossary: identity plus glossary;
- ideas: identity, ideas, tree;
- article: metadata, tree, arc;
- metadata: the artefacts it checks;
- list and publication: their own small sets.

That better matches the latency goal than a common “everything except three columns” selector.

7. **Should-fix — the proposed column guard is underspecified and can become tautological.**

If `selected` is still produced by object-rest from `getTableColumns`, a new schema column automatically enters `selected`; `selected ∪ omitted = all` stays green. That contradicts the claim that a new column makes the test fail ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/glossary-read-latency.md:144)).

Use an exhaustive policy map keyed by every revision column, like `REVISION_COLUMN_POLICY`, and separately assert that each real query projection equals the columns assigned to it. A completeness union alone proves neither that the chosen side is correct nor that the query uses the selector.

8. **Should-fix — several proposed checks can pass while behavior is broken.**

- Request counting at hook level can pass while `App.tsx` wires a second hook or fails to pass the shared read.
- “No loading message” can pass with no panel or with `ready` plus an empty glossary. Assert the actual term, all three warning flags, and prose underlines.
- A selected-column constant can be correct while the real query uses `.select()`. Assert generated SQL or exercise the real builder.
- Hash equality over already ordered fixture arrays does not prove the SQL orders by `ordinal`.
- Database parity may skip; completion evidence should require it to run.
- Temporarily editing the shared schema is risky. Test an extracted classifier with a synthetic extra column instead.
- No check measures the promised latency or transferred bytes.

Add controlled-race tests for slug switching, reset during an outstanding GET, lookup during reload, band unmount, and a job completed before the band’s first poll.

9. **Note — scope is mostly right.**

`listArticles` is the larger aggregate win, but it does not explain this panel’s delay, so it need not go first. The sanitiser stamp is not load-bearing for the hash-only path.

Two scope facts should nevertheless be recorded:

- `blocksFor` has seven call sites, not five; `listArticles` is the omitted seventh path.
- Production `reset()` already returns 501 because Postgres glossary deletion is deliberately unimplemented ([store/index.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/index.ts:253)). That is separate from read latency, but reset tests with a mocked successful DELETE do not describe production.

**Verdict: not ready to build.**