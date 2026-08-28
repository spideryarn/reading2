## Verdict

Your incident diagnosis is right, but the proposed completion criterion is not quite complete.

- `/var/data` is the first symptom of the filesystem pipeline, not a Wolfram or HTML problem.
- `/tmp` is **NO-SHIP**.
- One-invocation ingest could technically work, so “it cannot work” is too strong; it is still **NO-SHIP as a production patch**.
- Rushing an HTML-only slice of D is **NO-SHIP**.
- Landing D is not sufficient by itself: B3, block-ID carry-forward, and a missed Postgres slug lookup must land too.

## The missing filesystem dependency

The `output/<slug>.html` page is already part of the planned conversion, not a separate hidden wall. The filesystem adapter maps extracted and stamped HTML to that path at [artifacts-fs.ts:112](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:112), while Postgres has separate `extractedHtml` and `stampedHtml` columns at [artifacts-pg.ts:193](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:193). Correct D code should never create that debug file in the server path; only CLI wrappers keep files.

There is, however, one unplanned filesystem read in the live enqueue path:

- `articleExists()` reads `data/<slug>/meta.json` at [pipeline.ts:574](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:574).
- `urlForSlug()` does the same at [pipeline.ts:597](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:597).
- `freeSlug()` defaults to that lookup at [jobs.ts:1293](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1293), before enqueue at [jobs.ts:1006](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1006).

Those lines are also present in deployed commit `2ba408a`. After D, a Postgres article with no local `meta.json` can be treated as an unused slug. A different URL with the same derived slug could therefore be assigned the existing article’s identity. That is **NO-SHIP**. It probably would not stop this fresh Wolfram URL, but it is a production correctness gap in the claimed fix.

The PDF source route is another filesystem survivor at [routes.ts:222](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:222), but the plan already assigns it to D. It affects viewing original PDFs, not HTML ingest.

Also, D is not literally next: the plan says B3 and the block-ID carry-forward precede it at [delete-the-importer.md:58](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/delete-the-importer.md:58). B3 matters for HTML because ToC labelling uses durable retry checkpoints; see [delete-the-importer.md:573](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/delete-the-importer.md:573).

## Interim options

1. `/tmp`: **NO-SHIP**

Your reasoning is correct. Vercel says later requests may reuse an existing function instance, while Fluid Compute dynamically routes and scales invocations. It does not promise affinity between requests belonging to one application job. The safe inference is that warm-instance reuse is an optimization, not durable state. [Vercel Functions](https://vercel.com/docs/functions), [Fluid Compute](https://vercel.com/docs/fluid-compute).

It can therefore appear to work and then fail on another invocation. Worse, warm `/tmp` files keyed only by slug can be stale, causing `stepIsDone` to skip work from an earlier attempt. Vercel’s own guidance recommends object storage for persistent writes. [Vercel file guidance](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions).

2. Whole pipeline in one invocation: technically possible, but **NO-SHIP as the fix**

The timeout and memory claims are unproved. A 173 KB document is not itself evidence of memory trouble. The function allows 300 seconds at [vercel.json:9](/Users/greg/Dropbox/dev/experim/spideryarn2/vercel.json:9), but the job aborts itself after 220 seconds from [jobs.ts:130](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:130).

It also would not discard the entire queue: the durable job record and claim remain. It would discard the important per-stage resume and release boundary deliberately enforced at [jobs.ts:827](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:827). A timeout after paid ToC or arc calls would restart a much larger unit.

Measure it only if Greg wants an emergency, article-specific experiment. Do not build and maintain it as a deployable second runner.

3. Rush D or an HTML subset: **NO-SHIP**

An HTML-only slice still crosses fetch, extraction, blocks, ToC/labels, arc, publication, checkpoints, and previous-revision block identities. That is most of the dangerous shared machinery. The plan’s required proof is an entire pipeline run with `data/<slug>` empty and a retry using another store instance at [transactional-stage-runner.md:381](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/transactional-stage-runner.md:381). Do not start a competing implementation in this shared dirty tree.

The genuinely workable same-day workaround you omitted is operational: finish all five stages locally, then import only that fresh slug into Postgres using the named importer documented at [db-import.ts:4](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-import.ts:4). It requires both `blocks.json` and `tree.json` at [import.ts:258](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:258).

That can work, but only with Greg’s explicit permission to mutate production, verified target and owner, and confirmation that the slug does not already contain reader state. The importer warns why a wrong owner or existing slug is dangerous at [import.ts:395](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:395).

## HTTP 200

Keep the 200.

The endpoint successfully performed its command and returned the resulting job state. `runStep` records the domain failure at [jobs.ts:443](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:443), and `advanceJob` returns `done: true` at [jobs.ts:813](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:813). The route then returns that result at [routes.ts:4001](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:4001).

Returning 500 would incorrectly turn a recorded job failure into a transport failure; the browser retries transport failures at [useJobs.ts:172](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useJobs.ts:172).

The observability gap is real, but HTTP status is the wrong layer to fix it. Application failures already call `captureFailure`, and Vercel flushes monitoring before ending the invocation at [vercel.ts:153](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:153). However, `SENTRY_DSN` is not among health’s expected variables—the list ends at [vercel-health.ts:232](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel-health.ts:232)—and monitoring silently stays off without it at [monitoring.ts:163](/Users/greg/Dropbox/dev/experim/spideryarn2/src/monitoring.ts:163).

Tell Greg:

- The root cause is confirmed.
- The durable fix is D plus its prerequisites and the missing slug lookup.
- Verify this failure actually reached Sentry.
- Alert on structured `jobs / step failed` events rather than depending on Vercel’s HTTP-error dashboard.
- A manual local-ingest plus single-slug import is the only credible today workaround.

No files or production state were changed.

