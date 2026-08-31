Verdict: **revise before building**. Three numbered Tier 0 items are live defects, but the plan also misses another paid CLI. More seriously, **do not build 2.4’s ToC/arc changes**: the current code explicitly records why that freshness scheme is unsafe. I would also defer 2.6 and narrow 2.2.

## Tier 0: what is actually a bug

| Item | Verdict | Correction |
|---|---|---|
| 0.1 | **Real bug, but under-scoped** | Labels leaks spend, and so does `npm run pdf`. The proposed proximity-grep gate is not sound. |
| 0.2 | **Real for ideas and tweets** | Summaries is latent, as the plan says. |
| 0.3 | **Real bug** | The server can receive and refuse the request while the UI says it never arrived. |
| 0.4 | **Coverage gap, not a known defect** | One of the claimed unexecuted guards is already covered. Five tests are still reasonable. |
| 0.5 | **False comment plus dead code** | Delete the function now rather than merely editing the comment. |
| 0.6 | **False documentation and unfinished migration** | Correct it now; make `sweep()` a release condition for the wiring work, not a separate emergency fix. |

The heading “five live defects” is therefore wrong twice: it contains six numbered items, and only 0.1–0.3 are current product defects.

### 0.1: real, but the proposed gate would go quiet

[labels.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:1141) makes paid calls and its entrypoint at [labels.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:1643) calls `main()` directly. The other six stages use `withLedger`. That diagnosis is correct.

The fix is one behavioural line plus an import:

```ts
await withLedger("cli", main);
```

Use `await`, not a floating `void`, so ledger flushing and failures remain part of CLI completion.

But labels is not the only paid CLI outside the ledger:

- [package.json](/Users/greg/Dropbox/dev/experim/spideryarn2/package.json:20) exposes `npm run pdf`.
- [pdf-read.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:376) calls `openRouterJson("pdf", ...)`.
- Its entrypoint at [pdf-read.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:1274) runs `main()` without `collectSpend` or `withLedger`.
- [pdf-read.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/pdf-read.test.ts:386) already demonstrates that spend is emitted only when a collector surrounds the call.

So fix **labels and PDF together**. Otherwise the new gate will memorialise another false “all paid CLIs” claim.

Do not write a textual “`withLedger` appears near an entrypoint guard” test. It can be defeated by a comment, dead branch, unrelated wrapper, or a paid call reached transitively.

Use one of these:

1. Preferably move 2.5 forward and introduce a metered entrypoint helper such as `runStageCli(import.meta.url, main)`, which performs both the exact main check and the ledger wrapping.
2. Until then, keep an explicit list of paid CLI entry modules and AST-check that the executed main branch directly invokes the wrapper. Test the detector against a deliberately unwrapped fixture.

Keep generic `isMain` separate from the metered helper; not every importable CLI spends money.

### 0.2: the source reasoning is sound

Ideas is live:

- [useIdeas.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useIdeas.ts:83) changes `status` to `error`.
- Its job completion callback reloads at [useIdeas.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useIdeas.ts:124).
- [IdeasPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/IdeasPanel.tsx:171) renders the list only while `status === "ready"`.

Tweets is also live and clearer still: [Tweets.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tweets.tsx:114) replaces the discriminated state with `{ status: "error" }`, and the thread is only rendered in the ready branch at [Tweets.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tweets.tsx:254).

Summaries is only latent: [SummaryPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SummaryPanel.tsx:226) deliberately keys visibility on `summaries !== null`, not `status`.

A browser is not required to establish those render outcomes. The regression test should nevertheless exercise the real sequence:

1. Initial fetch produces a list.
2. Matching job finishes.
3. Background GET fails.
4. Existing list remains visible and the failure is reported.

Also retain the initial-load-failure sibling. Testing `load()` alone would not prove the job callback is wired correctly.

### 0.3: correct

[useIdeas.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useIdeas.ts:188) turns every `started === null` into “did not reach the server.” But [useJobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useJobs.ts:422) returns `null` for any thrown POST failure, including a server response, while preserving its real message in `queue.error`.

Use the same render-time expression as the other hooks. This is a real reader-facing falsehood.

### 0.4: good work, but one claim is wrong

The search tests do already execute the clean reader-abort outcome. In particular, [search-stream.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/search-stream.test.ts:411) completes JSON, cancels without `[DONE]`, and relies on the clean-abort branch at [search.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/search.ts:728). So “four guards have never been executed” is false.

The genuinely missing cases are:

- Deadline.
- Restartable stall clock, including clean cancellation by that clock.
- Ordinary premature EOF.

The proposed search non-2xx and explain non-2xx tests are also worthwhile caller-boundary tests. Thus five tests is reasonable, though only three cover the claimed stream guards.

If you need the cheapest useful subset, write those three first. Do not replace them with helper-only tests: the risk is the caller failing to interpret the helper’s outcome.

Make these tests a hard prerequisite for extracting the **end-of-stream classifier**, not for all of 2.3. Citation collection and the clock construction can be moved independently.

### 0.5: delete rather than preserve

The comment at [pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1254) is false, and `glossaryIsCurrent` is test-only. Pipeline currency is already tested through `stamp` in [pipeline-artifact-store.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/pipeline-artifact-store.test.ts:589).

After one final import grep, delete `glossaryIsCurrent`, delete or rewrite its obsolete tests, and remove the comment. Waiting for the wider stamp migration buys nothing.

### 0.6: correct the header; escalate as an acceptance condition

The seam is not wired. [revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/revisions.ts:24) is wrong, and [jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:57) still binds pipeline artefacts to `fsArtifacts` unconditionally.

Do not collide with the other agent’s work. But notify that owner now that these must land atomically:

- First production `begin()`.
- Artefact wiring.
- Production scheduling of `sweep()`.
- A test proving abandoned drafts are removed.

`sweep()` is not a live leak while nothing creates drafts. It becomes a ship blocker the moment `begin()` becomes reachable.

## Tier 2: what I would refuse

### Refuse 2.4 as written

This is the largest error in the plan.

[pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1083) explicitly records that a ToC stamp was implemented and then withdrawn on 2026-08-27. A regenerated ToC can change ranges while arc and summary still look current, silently dropping range-attached content. The plan is proposing the exact change the current code warns not to make.

Arc is not a four-line stamp either. [artifacts.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts.ts:243) says `tree.json` and `arc.json` do not carry a source hash. Arc depends on both blocks and the tree, so a blocks-only hash is insufficient.

Split 2.4:

- **Do:** tweets and summary `isDone → stamp`.
- **Do not:** add ToC or arc stamps until consumer invalidation and a structure-aware fingerprint are designed.

### Refuse/defer 2.6 in its current shape

Your instinct is right: `useArtefactRead` is the riskiest extraction.

Glossary has two distinct operations:

- `reload()` may join an in-flight fetch.
- `refresh()` must schedule a trailing fetch, because a job may have completed after the in-flight request began.

That distinction is documented and implemented around [useGlossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:89) and [useGlossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:241). A generic single reload verb can preserve stale data while appearing to deduplicate correctly.

Extract a smaller concurrency primitive first: request generation plus `refreshAfterCurrent`. Keep each domain’s response parsing, 404 handling, and state machine local. If a future shared hook exists, it must expose both semantic verbs.

### Narrow 2.2 rather than refusing all of it

Your confidence is justified for `articleSystem`, not for the broad `stageCall`.

[models.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:815) defines article rendering only for arc, tweets, glossary and ideas. ToC, labels and summarise construct materially different requests.

I would permit:

- `articleSystem(stage, ...)` for those four stages.
- A small final-text response helper if it stays free of stage policy.

I would reject one seven-stage `stageCall` with truncation callbacks and request-shape options. Labels’ retry semantics, summarise’s repair loop, and ToC’s user-message article are not configuration details.

The request-shape test should pass against current code. Then mutate renderer selection, block order and cache-control locally to prove the test detects each failure. That is a characterisation test plus mutation check, not a naturally red bug test.

### Adjust 2.3

`roundClock` and citation collection are sensible. For `endOfStream`, prefer a pure classifier returning something like:

```ts
"complete" | "reader-abort" | "clock-abort" | "premature-eof"
```

Let each caller log, throw, retain partial output, or store a stopped answer according to its own contract. A callback-driven effects helper is close to the rejected catch-options machine.

## Ordering

The stated dependency between 0.2/0.3 and 2.1 is correct, but add tests for the abstraction itself: matching step/slug completion, unrelated jobs, active-job selection, and terminal failures.

I would reorder the work as follows:

1. Fix both leaked paid CLIs: labels and PDF. Add the bounded paid-entrypoint check.
2. Correct 0.6’s header and notify the migration owner of the begin-plus-sweep condition.
3. Fix and test 0.2/0.3.
4. Do 2.1.
5. Add 0.4’s five tests.
6. Move 2.5 earlier so future paid CLIs are structural.
7. Perform Tier 1 mechanical work after correcting its counts.
8. Migrate only tweets and summary to `stamp`.
9. Build the narrow halves of 2.2.
10. Extract 2.3’s clock, citation collector and pure outcome classifier.
11. Defer 2.6.

## Same-genre misses

I found four important undercounts in the current shared tree:

- **Paid CLI:** `npm run pdf`, described above.
- **Readiness probes:** I count **34 test files**, not 29, containing a `Pool` plus conditional Postgres readiness/skip logic. The three 2-second and five silent counts appear right, but the extraction inventory is five files short.
- **Atomic writers:** there are three copies, not two: [toc.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:586), [labels.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:1572), and [artifacts-fs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:305). The comments claiming two copies are themselves stale.
- **Bad suffix entrypoint guards:** besides `fetch.ts` and `toc-flatten.ts`, the same genre appears in [backfill-raw-manifests.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/backfill-raw-manifests.ts:292) and an even weaker form in [inventory.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/inventory.mts:630).

Also include test consumers when moving `partsOf`: [arc.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/arc.test.ts:17) and [job-failure.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/job-failure.test.ts:22) import it from `arc.ts`.

## “What not to do”

Keep almost all of that section. In particular, continue declining the broad streaming verb, catch classifier, message-builder merge, validator simplification, and summarise rewrite.

Change three things:

- Add **ToC/arc stamps** to “do not do yet.”
- Add the broad form of **`useArtefactRead`** to “do not do.”
- Reconsider the atomic-write entry: the stated evidence is stale because there are three copies. Given the active artefact-store migration, I would let that migration absorb the stage writes rather than create a new helper immediately. But the current “two deliberate copies” justification no longer stands.

No files were changed. I did not run a browser or the test suite; this was a source-led plan review against the current shared tree.