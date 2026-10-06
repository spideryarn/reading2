No—the F11 statement is not accurate. There are three blocking findings.

### F14 — P0, established: the address-adoption race still permits two articles and two charges

[pg-jobs.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/pg-jobs.ts:382) explicitly acknowledges that a non-reserving adopted row can outlive its holder, while [jobs_active_source](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/db/schema.ts:2905) covers only reserving rows.

(a) Reachable sequence:

1. H, work W1, reserves arXiv paper P on slug S and creates S’s article row without publishing.
2. A, work W2, adopts H and is inserted non-reserving on S.
3. H ends; A remains active.
4. B and C both request W3.
5. B’s lookup sees A and adopts S. Because W3 differs from A’s W2, the new hand-back does not fire.
6. A ends before B inserts. The article row still exists but has no published revision.
7. C sees neither a shelf URL nor an active job and mints S2.
8. B’s insert finds the bare article row, so [requireWhatTheAllocationLeanedOn](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/pg-jobs.ts:528) skips `lockAdoptedHolder`; B inserts non-reserving on S.
9. C inserts reserving on S2.

B and C are identical work, carry distinct `ingestEventId`s, can publish different articles, and can both charge. No index joins B’s `(S, non-reserving)` row to C’s `(S2, reserving)` row.

The existing deploy-window test does not exercise this interleaving.

(b) Smallest credible closure: only a published article may waive the adopted-holder lock.

```ts
async function lockArticleFor(tx: Tx, job: Job) {
  return await tx
    .select({
      id: articles.id,
      currentRevisionId: articles.currentRevisionId,
    })
    .from(articles)
    .where(ownedSlug(job.slug, job.ownerId))
    .for("update")
    .limit(1);
}

// In enqueueIn:
const articleExists = article !== undefined;
if (!articleExists && ticket.requiresArticle === true) throw noSuchArticle();

const restart = await requireWhatTheAllocationLeanedOn(
  db,
  job,
  ticket,
  article?.currentRevisionId != null,
  look,
);
```

Then change the guard to:

```ts
if (!publishedArticle && ticket.adoptedFromJob !== undefined) {
  const [holder] = await lockAdoptedHolder(db, job, ticket.adoptedFromJob);
  if (!holder) return restartRatherThanRefuse(look);
}
```

Add a Postgres barrier test reproducing steps 4–9 and asserting B and C cannot both be created. A durable `(owner, url_key) → slug` claim would be the broader long-term fix.

### F15 — P1, established: a cancelling holder is handed back

The new condition in [jobs.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/jobs.ts:3636) checks `status` but not `cancelling`.

(a) Claim a pre-deploy `pdf/<id>` job, request cancellation while it remains `running`, then paste the equivalent `abs/<id>` address. `inFlightSlugForUrlKey` adopts it, `sameWork` succeeds, and the stopping job is returned. The new reservation is released; when cancellation settles, the newly requested work disappears. This contradicts `jobs_active_work`, which deliberately excludes cancelling rows for exactly this reason.

(b) At minimum:

```ts
holder !== undefined &&
(holder.status === "queued" || holder.status === "running") &&
holder.cancelling !== true &&
sameWork(...)
```

Add a deploy-window test asserting that a cancelling holder is not returned and the new request’s reservation reaches its replacement job. This guard does not replace F14’s unpublished-article fix.

### F16 — P1, established: the resolver can return an invalid slug

[ARXIV_ID_PATTERN](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/paper-sources.ts:54) permits unbounded legacy archive names and version numbers, while [isSlug](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/ingest.ts:430) caps slugs at 60 characters.

(a)

```ts
const url = `https://arxiv.org/abs/2608.13566v${"1".repeat(50)}`;
const paper = resolvePaperSource(url)!;

paper.slug.length === 67;
isSlug(paper.slug) === false;
```

`slugFromUrl` returns that invalid slug, the client considers it nonempty, and the route rejects it with HTTP 400. This violates both `ResolvedPaper.slug`’s explicit contract and “recognises … and nothing else.”

(b) Smallest closure:

```ts
const slug = `arxiv-${id.versionedId.replace(/[^a-z0-9]+/g, "-")}`;
if (slug.length > 60) return null;

return {
  source: "arxiv",
  ...id,
  canonicalUrl: `https://arxiv.org/abs/${id.versionedId}`,
  key: `arxiv.org/abs/${id.versionedId}`,
  slug,
  candidates: arxivCandidates(id.versionedId),
};
```

A cycle-free shared slug validator or a closed legacy-archive grammar would be stronger.

The supplied Postgres evidence proves the seeded `pdf/` and `html/` cases accurately, including reservation release, but covers neither F14 nor cancellation. All seven permitted test files passed; the extraction test also passed from a clean archive of commit `0f63486a2`, excluding the next-stage working-tree edits. I found no additional fetch-loop, extraction-base, caller, or project-doc defect. Ignoring arXiv queries is safe because the fetched candidate is reconstructed solely from the validated ID; redirected 404/410 fallback and `[fetch-incomplete]` with Retry are consistent with the stated contract.

VERDICT: do not ship