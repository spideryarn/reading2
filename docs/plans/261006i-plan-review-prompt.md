# Review: a plan to find an article by the address it was asked for, and to import the paper when a redirect ends on a paper source

Repo: this worktree, branch `worktree-qi-fbrh4kck-asked-for-address` (TypeScript, ESM, Postgres via
Drizzle). Read-only review of a plan. Nothing is built.

## The candidate

Committed: `1f7731bac`, one file:
`docs/plans/261006i-an-article-is-found-by-the-address-it-was-asked-for-and-a-redirect-that-ends-on-a-paper-source-imports-the-paper.md`

It is the deferred item `qi-fbrh4kck` from
`docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md` (§ Deferred,
§ The options passed over, and your own findings G1, G2, G6 and G14 in its review tables).

Start with, and do not stop at: `src/store/find-article.ts`, `src/jobs.ts` (`freeSlug`,
`slugForRetry`, `slugAlreadyHolding`, `inFlightSlugForUrlKey`, and `enqueue` around
`request.url ?? … urlForSlug(slug)`), `src/store/pg-revisions.ts` (`lockOrCreateArticle` and its
three callers), `src/pipeline.ts` (`fetchFirstCandidate`, `fetchFromPaperSource`, `STEPS.fetch`),
`src/paper-sources.ts`, `src/ingest.ts` (`urlKey`), `src/fetch.ts` (what `doc.url` is after
redirects), `src/db/schema.ts` (`articles`, `jobs.url_key`, the partial unique indexes).

## What to do

An independent pass first. Check every factual claim the plan makes about the code against the
code, by name: the plan's § Background and § Design each assert where something is written or read.
Then attack the design:

- Does `articles.asked_url`, written once at row birth and read by `slugForUrlKey`, actually close
  G1 for every path a second paste can take (the shelf, a queued or running job, a retry, a failed
  first import, two tabs a second apart)?
- Is there a path where the row is born with the wrong address, or by a job whose `url` is not what
  the reader pasted?
- Does the redirect look in stage 2 open anything in `docs/project/security-map.md` § Where the
  defences physically live? What does `doc.url` hold after a redirect chain, a meta refresh, or a
  final address with credentials or a port?
- Charging: name any sequence in which a reader is charged twice for one paper that today costs
  them once or nothing.
- Is any stage unsafe to land alone?

Severity: P0 data loss, exploitable security, incorrect charging, or the service broadly unusable;
P1 user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk with no wrong behaviour today; P3 prose. Refuse only on an *established* P0 or P1 (direct
evidence, no unresolved material inference); mark the rest *reasoned*. Give every finding an ID,
`K1`, `K2`, … End with one verdict line: *build it*, *build it after fixing <ids>*, or *do not
build*.

## My own suspicions, last, and worth less

- Whether matching every article by `asked_url` (not only papers) is a behaviour change a reader
  can be hurt by.
- Whether `lockOrCreateArticle`'s caller really has the job's own pasted address in hand.
- Whether "the document already fetched may satisfy a candidate" should compare addresses exactly
  or by something looser.

The statement I would least like to be wrong about: *a refresh, a retry and a late-stage re-run
can never change `asked_url`, because all three find the row already there.*
