# Code review: v1 of model-named shelf topics (261003f)

You reviewed this design earlier today
(`docs/plans/261003f-shelf-topics-named-by-a-model-v1-plan-review-sol.md`). It is now built, with
your findings applied as the plan's § Reviews lists. **Review the code and fix what you find inside
the files in scope**; report anything wider for me to decide. Weight this review above the plan
review: it is the one that can find a write that lands in the wrong order.

Nothing is committed yet. `git status` and `git diff HEAD` show the whole change (untracked files
are new). Do not run state-changing git commands. The local database is shared and its migration
ledger has a peer's row, so `npm run db:migrate` refuses; do not try to work around that. The
`private-postgres` test lane makes its own database.

## In scope

Server:
- `src/shelf-terms/model-topics.ts` — prompts, parsers, `rethink`, `fileWorks`.
- `src/shelf-topic-sets.ts` — what a request does: the answer, what is due, the claim, the work.
- `src/store/pg-shelf-terms.ts` (the `topicShelf` … `releaseTopicSet` functions and
  `shelfBoundary`), `src/store/contracts.ts` (the topic-set contract), `src/db/schema.ts`
  (`shelfTopicSets`), `drizzle/20261003144031_shelf_topic_sets.sql` and its snapshot and journal
  entry.
- `src/routes.ts` (`GET /api/library/terms`), `src/types.ts` (`LibraryTermsResponse`).

Client:
- `src/web/shelf-narrow.ts`, `src/web/ShelfTerms.tsx`, `src/web/ShelfTermChip.tsx`,
  `src/web/ShelfTermsDetail.tsx`, `src/web/PaperCard.tsx`, `src/web/useShelfTerms.ts`,
  `src/web/PrivacyPage.tsx`.

Tests: `tests/shelf-topic-model.test.ts`, `tests/shelf-topic-sets.test.ts`,
`tests/shelf-topic-sets-pg.test.ts`, `tests/shelf-topics-route.test.ts`, and the client tests
`tests/shelf-narrow.test.ts`, `tests/shelf-topics.test.tsx`.

Eval (evidence, not product): `evals/shelf-topic-clusters/hier.ts` and `results/hier-*.md`.

Docs: `docs/project/shelf-terms.md`, `docs/project/privacy.md`, and the plan's § "Greg's answer,
and v1".

## What to look for

1. **Correctness of the request flow in `shelf-topic-sets.ts`**, line by line: the first read; the
   claim; the re-read and second decision under the claim; the allowance; `refresh` for a filing
   and for a re-think; the drain of arrivals (its second claim, and what `held` is at every exit,
   including every throw); what happens to the claim and the allowance token on each failure path;
   whether any path can leave a claim held for the lease with nobody working, write a stale result,
   or lose a filed membership. Is `whatIsDue` free of loops (a state that is due again immediately
   after it is done)? Check the cap, the shrink trigger and the below-eight rule against each other.
2. **`rethink`**: the duplicate-name rule across parallel siblings; the retry-once; that every
   stored membership includes its ancestors; that a topic's works are always a subset of its
   parent's; `SAME_AS_PARENT`; keys unique within a set in every case (including the
   `<parent key> <key>` form colliding with another topic's key).
3. **The store functions and the migration**: the single-statement claim; the fences; the jsonb
   merge in `fileIntoTopicSet`; owner scoping on every statement; the CHECK constraints against
   what the code writes (a re-think with zero topics cannot be written — can the code try?); the
   migration being additive and matching the schema; on-delete behaviour.
4. **What reaches the browser**: `termsFromSet` ordering and `within`; `scope`, `pending`,
   `sorting`, `refreshing`; then the client — does anything still assume a phrase `count`, does
   `withinChosenFirst` ever reorder a pill under the pointer or lose one, does the URL-key rule
   drop a key it should keep or keep one for ever, does the 18-ask loop stop?
5. **Security and privacy**: anything from titles, gists, labels or the profile reaching a log line
   or an error message; the label and key cleaning; the privacy page's sentence against what is
   actually sent.
6. **The tests**: is there a rule in the code that no test would notice being removed? Add the
   missing test where it is cheap.
7. **Docs against code**: any number or behaviour in `shelf-terms.md` or the plan's v1 section that
   the code does not do.

Run `npm run typecheck` and the test files in scope (`npx vitest run <files>`; re-run a red
Postgres file alone before believing it). Report findings numbered, most serious first, each P0, P1
or P2, saying what you changed and what you left for me. End with one line: is this sound to push
to `dev` (which deploys nothing)?
