Verdict: **ship after fixes (made)** — the Crossref cooldown no longer blanks the rest of a run when there is time to wait, and I found no further ship-blocking fault in identity, faithfulness, visitor reconstruction, freshness, successor scheduling, spend, or the step contract.

## Findings

### P1 — A short Crossref cooldown discarded most pending title searches — fixed

`src/citation-evidence.ts:474`, `src/citation-evidence.ts:515`, `src/citation-evidence.ts:535`, `src/citation-evidence.ts:588`; wired to the claim deadline at `src/citation-blurbs.ts:727`.

Concrete failure: the first Crossref title request returns 429 or 503 with a short `Retry-After` → the shared limiter enters cooldown → both title workers return `transient: cooling-down`, take the next rows, and immediately do the same → every remaining title-only row is omitted from the artefact until another publication or button press. The post-build runs demonstrated 9/19, 11/33, and 36/70 rows lost this way.

Fixed by waiting out a shared Crossref cooldown and asking the row again when both the 120-second lookup budget and the job claim deadline minus its publication margin allow it. A cooldown received on the current request honours its parsed `Retry-After`; an inherited or extended cooldown is checked in the shared limiter. Retry requests count against the existing hard ceiling of 60 Crossref title queries, so the repair does not make spend or registry traffic unbounded. If the wait cannot fit, the row remains transient and the run does not cross its bound.

Red first, `tests/citation-evidence.test.ts:415`:

```text
Test Files  1 failed (1)
Tests  1 failed | 29 passed (30)
AssertionError: expected { state: 'transient', …(1) } to match object { state: 'evidence' }
```

After the fix, the same file passed 31 tests. The added deadline-margin case at `tests/citation-evidence.test.ts:452` also proves a 2.5-second `Retry-After` is not slept through when only two seconds remain.

### P2 — The reported paper still misses the declared coverage gate — wider, not fixed

`docs/investigations/261017c-citation-blurbs-cost-and-quality.md:270-300`.

Concrete result: on the clean 70-work Butlin run, authoritative abstracts produced 28 notes (40%) → the design's 60% coverage gate fails, even though the 33-work coding paper reaches 64%. This is not a path to wrong notes: the implementation correctly says nothing for the 25 strict title-search misses and 14 records without abstracts. Closing the gap requires the already-raised product/credentials decision about another authoritative source (`q-ny49p3`); it is outside this stage-local review, and registry calls were expressly forbidden here.

### P3 — The privacy doc described the upload/public-address signal backwards — fixed

`docs/project/privacy.md:725-733`.

Concrete failure in the documentation: `{ url: "https://example.com/p.pdf", filename: "p.pdf" }` has both the old text's named signals and could therefore be read as eligible for title search → the code correctly classifies it as an upload and forbids title search. I corrected the text: a public-address import has an http(s) address **and no** `meta.filename`; everything else is treated as an upload. Existing coverage in `tests/citation-blurbs.test.ts` exercises the public URL, URL-plus-filename, filename-only, empty, and null cases.

### P3 — The writer uses two sentences more often than its default asks — not changed

`src/citation-blurbs.ts:127-136`; measured at `docs/investigations/261017c-citation-blurbs-cost-and-quality.md:282-287`.

Concrete result: 26 of 49 kept notes used two sentences although the prompt says most works need one. The limit is not violated—the second sentence is expressly allowed and checked independently—and the observed 6.5k output for a 20-work batch did not approach the 16k ceiling. I did not change the prompt or limits: this review could not measure an alternative without the forbidden paid model calls, and the current evidence does not show which wording would retain useful separately-supported second sentences while reducing unnecessary ones. This needs a measured prompt comparison if the product wants a stricter bias.

## Files changed

- `src/citation-evidence.ts` — bounded Crossref cooldown wait/retry; claim-aware stop time; retry-inclusive query cap.
- `src/citation-blurbs.ts` — passes the job deadline and publication margin into evidence collection.
- `tests/citation-evidence.test.ts` — red-first cooldown regression, lookup-budget case, and claim-margin case.
- `docs/investigations/261017c-citation-blurbs-cost-and-quality.md` — records that the review built the bounded-wait option and leaves whole-step requeue as the product decision.
- `docs/project/privacy.md` — corrects the public-address/upload signal.
- `docs/plans/261017h-stage-3-code-review-sol.md` — this review.

## Gate results

Red-first proof before the repair:

```text
tests/citation-evidence.test.ts
Test Files  1 failed (1)
Tests  1 failed | 29 passed (30)
```

Requested non-database tests after the repair:

```text
Test Files  8 passed (8)
Tests  379 passed (379)
Duration  25.17s
```

Those eight files were `citation-blurbs.test.ts`, `citation-evidence.test.ts`, both public-DTO tests, `bibliography-panel.test.tsx`, `citation-hover-card.test.tsx`, `chat-citations-tool.test.ts`, and `doc-links.test.ts`. The React files printed their existing `act(...)` environment warnings; the run exited 0.

The two requested Postgres files, `citation-blurbs-pg.test.ts` and `citation-blurbs-read-pg.test.ts`, could not start in this review sandbox:

```text
[private lane] could not scavenge (carrying on): connect EPERM 127.0.0.1:54362
No database ... could not ask Docker ... docker ps ...
```

The invocation exited 1 during global database setup, before either test file ran. This is an environment limitation, not a test failure.

The literal npm typecheck command was likewise blocked before TypeScript by the sandbox's denial of tsx's local IPC socket:

```text
Error: listen EPERM ... /tmp/tsx-1000/92.pipe
```

Running the same script without tsx's IPC wrapper passed:

```text
✓ src/web/tsconfig.json  (657 files)
✓ tests/tsconfig.json  (3571 files)
✓ tools/fleet/web/tsconfig.json  (108 files)
✓ tsconfig.json  (1112 files)
✓ all 3790 source files are covered by some project
```

Additional checks:

```text
biome lint: Checked 3 files. No fixes applied. Found 1 info.
git diff --check: passed
```

The lint information is the pre-existing complexity score on `generateCitationBlurbs` (35, configured maximum 25); there were no lint warnings or errors in the changed code.
