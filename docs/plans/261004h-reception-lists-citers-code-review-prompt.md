# Code review: Reception lists the papers that cite the piece, from OpenAlex

You are reviewing **and fixing** one committed stage, write-capable, in this worktree.

## The candidate

Commit `e8de3e851` on branch `worktree-qi-aabv7jjy-debate-openalex-citers` (its parent,
`3c46bca57`, holds the plan). The diff and the complete list of changed paths:

```
git show --stat e8de3e851
git diff 3c46bca57 e8de3e851
```

Start with these, which does not limit scope:

- `src/citation-index.ts`, `src/store/pg-citation-index.ts`, `src/citer-link.ts`
- `drizzle/20261004140330_citation_index_and_openalex_service.sql`, `src/db/schema.ts`
- `src/bibliographic.ts` (the limiter extracted into `inServiceTurn` and `coolAfter`; `askService`
  now goes through it, so Crossref and DataCite lookups changed shape too)
- `src/routes.ts` § `/api/citers`, `src/store/pg.ts` § `loadArticleIdentity`
- `src/web/useCiters.ts`, `src/web/DebatePanel.tsx` § `CitedBy`, `src/web/modes/debate/DebateMode.tsx`,
  `src/messages.ts` § the citers sentences
- `src/web/PrivacyPage.tsx`, `docs/project/privacy.md`, `docs/project/debate.md`,
  `src/web/help/help-modes.tsx`
- the tests: `tests/citation-index.test.ts`, `tests/citation-index-pg.test.ts`,
  `tests/use-citers.test.tsx`, and the changed cases in `tests/debate-panel.test.tsx` and
  `tests/modes-that-start-themselves.test.tsx`

The plan is `docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md`;
its § *GPT Sol's plan review, and what changed* overrides the text above it. Your plan review is
`docs/plans/261004h-reception-lists-citers-plan-review-sol.md`. This code was written by another
model and has had no review. Weight this review above the plan review.

## What it is for

Debate's Reception sub-mode gains a "Cited by" section for the article's owner: OpenAlex's count
and up to 100 citing works, most cited first, looked up by the article's DOI. No model call. Cached
per DOI in two tables for 7 days. Shown before the paid Debate search has run, without starting it.
Greg approved sending the DOI to OpenAlex.

## What to do

1. An independent pass first. Look for wrong behaviour a reader can reach, a contract of this repo
   broken, and anything that reports success while doing nothing. In particular check claims in
   comments and docs against the code.
2. **Fix what is inside this stage**, narrowly, each finding red-first: write the test that
   reproduces it, see it fail, then fix. **Report, do not fix, anything wider.**
3. Run tests that need nothing outside the tree: `npx vitest run tests/<one>.test.ts`. You have no
   network and no Postgres, so `tests/citation-index-pg.test.ts` and any other database-backed
   test are mine to run; say which you want run and I will hand you the raw output next round. Do
   not report a database-backed assertion as checked.
4. Do not commit. Do not edit a migration that is already written
   (`drizzle/20261004140330_…sql`): if it is wrong, say so and describe the follow-up migration;
   do not generate one (it needs the database).
5. **Do not write any sentence, in a doc, a comment or your answer, that attributes words or a
   decision to Greg.** The one quotation of him is already in the plan.

Evidence already in hand, raw:

- `npm run typecheck`: all four projects pass.
- `npx vitest run tests/citation-index.test.ts tests/use-citers.test.tsx tests/debate-panel.test.tsx tests/privacy-page.test.ts tests/doc-links.test.ts`: 5 files, 201 tests, all pass.
- The implementer reports `tests/citation-index-pg.test.ts` 13/13 on a freshly migrated private
  database, and one real end-to-end run against OpenAlex for DOI `10.3390/e26060481`: `found`,
  count 39, 39 listed, a second call served from cache with no request, and another article
  carrying that DOI answered `unconfirmed` off the cache.
- Not yet done: the full suite, the browser check, applying the migration to the shared local
  database.
- Mutations the implementer ran and saw the suite notice: drop the title check; drop the author
  check; skip the check on cached rows; store a count when the list failed; take the DOI string
  from the response; remove the hook's ask-once guard.
- `tests/citation-index.test.ts` and the pg cases were **not** seen red before the code existed;
  they were written alongside it.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an id (C1, C2, …), a severity, file and line, whether you fixed it, and the
test that shows it. List separately what you noticed that is wider than this stage. End with one
verdict: *land*, *land with the fixes I made*, or *not yet*, and what *not yet* needs.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `inServiceTurn` is a refactor of the path every Crossref and DataCite lookup takes. Did it change
  their behaviour (slot freed on every path, cooldown re-check after waiting, log lines)?
- The route: is the owner check the same one Debate's read uses, and can a visitor or a signed-out
  caller learn anything (existence of the slug, a DOI) from the refusal?
- `openAlexAuthors` splits a display name at the last word. Names with a suffix, a compound family
  name, or family-first order.
- The panel before a debate exists: does opening Debate by a normal press still start exactly one
  paid search, and does a failed citers read leave the rest of the band working?
- The replace-in-one-transaction write under two concurrent writers for one DOI.
- The privacy page's new paragraph: is every clause true of the code (what is sent, by whom, when)?
- The sentences for `capped` and `dropped`: do the numbers printed always match what is listed?
