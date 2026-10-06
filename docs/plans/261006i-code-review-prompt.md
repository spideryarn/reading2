# Review and fix: a paper is found by the address it was asked for, a redirect that ends on a paper source imports the paper, and NBER

Repo: this worktree, branch `worktree-qi-fbrh4kck-asked-for-address` (TypeScript, ESM, Postgres via
Drizzle, vitest). You reviewed the plan for this work earlier today
(`docs/plans/261006i-plan-review-sol.md`, findings K1–K7).

## The candidate

Committed: `fb8a55b5d`, on top of the plan commits `1f7731bac` and `8f45d1ff7`.

    git show --stat fb8a55b5d
    git diff 8f45d1ff7..fb8a55b5d

The plan, with your K1–K7 and what was done about each:
`docs/plans/261006i-an-article-is-found-by-the-address-it-was-asked-for-and-a-redirect-that-ends-on-a-paper-source-imports-the-paper.md`.
Evidence: `docs/plans/261006i-evidence/` (the probe of NBER and OSF, and the live check).

Start with, and do not stop at: `src/store/pg-revisions.ts` (`rememberAskedUrl`,
`lockOrCreateArticle`, `openOrBeginJobDraft`), `src/store/find-article.ts` (`slugForUrlKey`),
`src/jobs.ts` (`claimSession`, and the callers of `slugForUrlKey`), `src/pipeline.ts`
(`fetchByAddress`, `fetchFromPaperSource`), `src/paper-sources.ts` (`nber`, `paperAt`),
`drizzle/20261006144348_articles_asked_url.sql`, and the tests
`tests/asked-url-claim-session.test.ts`, `tests/find-article.test.ts`,
`tests/fetch-candidates.test.ts`, `tests/paper-sources.test.ts`.

## What to do

You may write. **Fix what is inside this candidate, narrowly, and red-first**: a failing test seen
red before each fix. **Report, do not fix, anything wider** (K2, the import slot a repeat paste
spends, is one such: it is recorded in the plan as raised with Greg, and is not to be changed
here). Do not edit `docs/project/*` beyond correcting a statement this candidate made wrong, do not
write any quotation attributed to Greg, do not commit, and do not touch git state.

You have no network and no Postgres. These need neither, so run them yourself:

    npx vitest run tests/fetch-candidates.test.ts tests/paper-sources.test.ts
    npm run typecheck

The Postgres-backed tests were run by me on this commit and passed: `tests/find-article.test.ts`,
`tests/asked-url-claim-session.test.ts`, `tests/store-export-bundle.test.ts`,
`tests/reserved-article-address.test.ts`, `tests/retry-keeps-the-checkpoints.test.ts`,
`tests/checkpoints-durable-resume.test.ts` (471 passed; the only red was
`tests/knip-without-build-output.test.ts`, which copies tracked files and ran before the migration
was committed). If a fix of yours touches the store, say which of those I must re-run.

An independent pass first. Then, in this order:

1. **K1 and K3, whose fixes you have not seen.** Is `rememberAskedUrl`'s rule accurate as stated in
   its comment: *the only job that reaches an unpublished row with an address is an import carrying
   what the reader pasted*? Name any job shape that reaches it with another address. Is
   `slugForUrlKey`'s paper-only rule right for every source in the registry, including one whose
   candidate's final address the registry would not recognise?
2. Charging: any sequence where this candidate makes a reader pay for a read they do not pay for
   on `8f45d1ff7`.
3. The redirect look against `docs/project/security-map.md`: what a stranger's redirect can now
   cause that it could not before.
4. `paperAt` now strips `www.` from the key. Does that change any existing source's key?
5. NBER's patterns against the rules in
   `docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md`
   § The rules every source here follows.
6. The docs changed in `docs/project/fetching.md` and `docs/project/ingest-queue.md`: is each new
   statement true of the code?

Severity: P0 data loss, exploitable security, incorrect charging, or the service broadly unusable;
P1 user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk with no wrong behaviour today; P3 prose. Refuse only on an *established* P0 or P1. IDs continue
from the plan review: start at `K8`. For each finding say *fixed by me* (with the test) or
*reported*. End with one verdict line: *ship*, *ship with the fixes I made*, or *do not ship*.

## My own suspicions, last, and worth less

- A reader who names a slug and an address together in `POST /api/jobs` for an unpublished row.
- Whether the held document should count in `tried`.
- Whether an NBER paper held for subscribers answers an HTML page with a 200; none was found to
  measure.

The statement I would least like to be wrong about: *after this candidate, a published article's
`asked_url` is never changed by anything.*
