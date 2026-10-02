# Plan review: quick search on Jev (261002e)

You are reviewing a **plan**, read-only. Repo: the worktree you are in (branch
`worktree-fb-c77zuq-quick-search`, base = `origin/dev` at the time of branching). Nothing is
committed yet; the candidate is these **untracked files**:

- `docs/plans/261002e-quick-search-v1.md` — the plan (start here)
- `docs/investigations/261002o-quick-search-spike.md` — the spike it rests on
- `evals/results/quick-search-spike-2026-10-02/` — raw spike results and the runner scripts (as `.txt`)

Background: Spideryarn is an AI-assisted reading app. Its article Search mode has a words matcher
(in-browser substring) and a meaning matcher (whole article to Sonnet, ~5–40 s, returns quoted hits
with confidence and reasoning, saved as `search_runs`). The owner asked for a fast version using
TypeSafe's Jev decision model via OpenRouter's alpha Decisions API. The plan adds a third matcher arm
`quick`, saved as a `SearchRun` with a new `kind` column, with a "flesh out" action that runs the
full meaning search for the same words.

Read for context (scope is not limited to these): `docs/project/search.md`, `src/search.ts`,
`src/searches.ts` (`withRun`), `src/routes.ts` § search (around `async function search`),
`src/web/useSearch.ts` (`send`, `ask`, `retry`), `src/web/SearchPanel.tsx` (`Box`, `Saved`),
`src/web/params.ts` (`MATCHERS`, `resolveMatcher`), `src/ai-call.ts` (`openRouterTranscription` is the
model for the new seam; `AI_JOB_ROUTE`, `OpenRouterPath`), `src/models.ts` (`Wire`, `AI_JOB_WIRE`,
`TASK_TIER`), `src/spend-declarations.ts` (the existing `shelf-topics-jev` bypass and the provider-path
scan), `docs/project/cost-tracking.md`, `docs/project/ai-gateway.md`, `src/block-policy.ts`
(`isSearchable`), `src/store/pg-searches.ts`, `src/db/schema.ts` § search_runs.

## What I want

An independent attack on the plan first: is the design right, is it the simplest thing that gets
Greg a fun-to-play-with v1, what will break, what is missing (tests, docs, places that must hear about
a new matcher / a new job / a new wire / a new column — e.g. export, admin, the public visitor view,
the `?match=` URL handling, the ledger's job enum or DB constraints, `tests/no-undeclared-spend.test.ts`,
privacy). Check the spike's conclusions against its raw data where it matters (billing once per state,
the 0.8 floor, chunking).

## Severity scale

P0 data loss / security / incorrect charging / broadly unusable · P1 user-visible wrong behaviour or an
authoritative contract violated · P2 design or maintainability risk · P3 prose. Refuse only on an
*established* P0/P1 (direct evidence, no unresolved inference). Give every finding an ID (F1, F2, …),
a severity, the evidence (file:line), and a concrete fix.

## My own suspicions (worth less; spend most of the run elsewhere)

- Whether `kind` should be a DB column or derivable; whether the `withRun` retry rule needs to know
  the kind (a retried quick run must stay quick).
- Whether "flesh out" as a *new* run plus unticking the quick one is right, vs resetting the same row.
- Whether the printed confidence for quick hits (Jev's p(yes)×100) misleads next to meaning hits'
  confidence, and whether the *Prioritised* bar's default `?conf=` threshold interacts badly with it.
- The visitor (public, read-only) view of saved searches: a quick run would appear there too.

End with a verdict line: `VERDICT: proceed` / `proceed with changes` / `refuse`.
