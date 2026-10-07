F14 and F15 are closed. F16 closes the invalid-slug bug, but introduces one P1 regression.

### F17 — P1, established: four-digit arXiv versions are no longer recognized

At [paper-sources.ts:75](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/paper-sources.ts:75), `ARXIV_VERSION` now stops at three digits. The resolver’s contract says versions are supported without imposing that limit.

(a) Input:

```ts
resolvePaperSource("https://arxiv.org/abs/2608.13566v1000")
```

This returns `null`, so the generic URL path imports the abstract page—the original failure this stage is meant to prevent. The test asserting `v1234` is invalid enshrines the regression.

(b) Smallest change:

```ts
/**
 * A version: `v` and one to 44 digits. Forty-four is the most that can
 * possibly fit PAPER_SLUG_MAX with the shortest admitted arXiv id;
 * arxivPaper applies the exact combined-length check.
 */
const ARXIV_VERSION = "v\\d{1,44}";
```

Remove `…v1234` from `TOO_LONG` and add it to the resolving cases. The existing 50-digit case remains rejected, while [arxivPaper’s explicit guard](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/paper-sources.ts:146) handles longer individual identifier combinations.

### Closure assessment

- **F14: closed.** The article row and `currentRevisionId` are read under the existing article lock; an unpublished row no longer excuses the exact-holder lock. The barrier test reproduces the shorter race and proves that only C remains active, while the positive control proves a live holder still permits B.
- **F15: closed.** [The hand-back predicate](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/jobs.ts:3636) now agrees with `jobs_active_work` by excluding `cancelling`. The supplied Postgres evidence proves the replacement job is created and carries the reservation.
- **F16’s original defect: closed.** Every `ResolvedPaper` produced through `arxivPaper` has a slug no longer than 60 characters. F17 concerns the unnecessary three-digit restriction, not slug validity.

### The F14 409 decision

The 409 is acceptable as it stands; I would not add silent reallocation in this fix.

It is a conservative response to a stale queue adoption, creates no job, charges nothing, releases the reservation, and gives an explicit working recovery. The case with another adopter still alive is an avoidable transient refusal, but not a wrong durable result or a charging failure. Reallocation would require another typed store outcome/error and another loop through quota-critical allocation merely to hide a rare retry. That is more change than the remaining consequence warrants.

The permitted tests passed:

- `tests/paper-sources.test.ts`: 95
- `tests/ingest.test.ts`: 45

VERDICT: ship it after fixing F17