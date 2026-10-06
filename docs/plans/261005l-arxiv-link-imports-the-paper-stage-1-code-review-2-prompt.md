# Review, round 2: the fixes to F14, F15 and F16 in stage 1 of 261005l

Repo: this worktree, branch `worktree-fbayettj-arxiv-import`. TypeScript + ESM, strict.

## The candidate

Committed: commit `4afa8d93f`, on top of `0f63486a2`, which you reviewed.
`git show --stat 4afa8d93f` prints the changed paths; `git show 4afa8d93f -- src` the source diff.

Your round-1 review is `docs/plans/261005l-arxiv-link-imports-the-paper-stage-1-code-review-sol.md`.

**Out of scope:** the working tree also holds the next stage, uncommitted (`src/extract.ts`,
`src/latexml.ts`, `src/maths-import.ts`, `src/meta-authors.ts`, `src/protect.ts`, their tests,
`tests/fixtures/latexml/`, `docs/investigations/261005e-…`, `evals/results/`). Read committed
versions where it matters.

## What this round is

Discovery is closed. Check **these three fixes**, and nothing else: is each finding closed, and
does its fix introduce a new P0 or P1? Treat them as unreviewed code by someone else.

| ID | Finding, first sentence | Disposition | What changed |
|----|------------------------|-------------|--------------|
| F14 | the address-adoption race still permits two articles and two charges | fixed, by your closure | `lockArticleFor` also selects `currentRevisionId`; `requireWhatTheAllocationLeanedOn` takes `articlePublished`, so only a **published** article waives `lockAdoptedHolder` (`src/store/pg-jobs.ts`). The implementer found a shorter reachable sequence than yours (no adopter A needed: holder H with a bare article ends between B's lookup and B's insert, C mints) and the test reproduces that one: `tests/one-article-for-one-address.test.ts` § *an article nobody has published into*, with a positive control |
| F15 | a cancelling holder is handed back | fixed | `holder.cancelling !== true` in the hand-back (`src/jobs.ts`); test in `tests/a-paper-queued-before-the-resolver.test.ts` |
| F16 | the resolver can return an invalid slug | fixed | a bounded grammar local to the resolver (`ARXIV_ID_BOUNDED`, `ARXIV_VERSION`), the shared `ARXIV_ID_PATTERN` unchanged, and an explicit length guard in the new exported `arxivPaper` (`src/paper-sources.ts`) |

Raw Postgres output for F14 and F15: `docs/plans/261005l-evidence/postgres-f14-f15-tests.txt`. I
re-ran `tests/one-article-for-one-address.test.ts` (6), `tests/a-paper-queued-before-the-resolver.test.ts`
(6), `tests/article-delete-pg.test.ts` (17), `tests/jobs.test.ts` and the unit files after the fix:
all pass. `npm run typecheck` is clean.

## One decision I want your view on

F14's fix changes behaviour for one case, deliberately left as it fell out:

- A request that adopted an active holder's slug over an **unpublished** article, whose holder has
  ended by the time of the insert, is no longer inserted. After the one restart pass it is refused
  with the existing 409, *"The article this was joining has gone. Add it again…"*. Its reservation
  was never attached and is released by `withIngestSlot`; pasting again works.
- That 409 also reaches a request whose **named** holder ended while another live adopter is still
  on the same slug. Before the fix it joined that slug, correctly.

The alternative is for `enqueue` to catch that refusal and ask `freeSlug` again, as the
`sourceTaken` and `nameTaken` repairs do, turning both into a silent re-allocation. It was left out
as a wider change to the money path than the finding asked for. Is the 409 acceptable as it
stands (grade it), or is the re-allocation the smaller risk? If you recommend the re-allocation,
give the exact code.

## What you can and cannot run, and what you may change

The tree is read-only for this run. No network, so no Postgres. You can run one unit test file at
a time (`tests/paper-sources.test.ts`, `tests/ingest.test.ts`, `tests/fetch-candidates.test.ts`).

For each finding give an ID (continue from **F17**), a severity (P0/P1/P2/P3 by consequence, as
before), established or reasoned, (a) the path or input, (b) the smallest change as code.

Refuse only on an established P0 or P1. End with one line:
`VERDICT: ship it` / `VERDICT: ship it after fixing <IDs>` / `VERDICT: do not ship`.

Do not change any file.
