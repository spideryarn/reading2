# Code review, Stage 3 of 261009w: Reception and Claims' stored names

You are a reviewer **and fixer**, write-capable in the worktree. Candidate: commit `9ac4332ae`
(`git show --stat 9ac4332ae`). Plan: `docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md`
(§ The names, § What keeps its word, § The database, § After GPT Sol's plan review, § Log, § The
migration review). Your earlier reviews: `261009w-plan-review-sol.md`, `261009w-stage-2-code-review-sol.md`,
`261009w-migration-review-sol.md`. Stage 2 (`citations` → `bibliography`) is the template this stage
copied.

## What the stage is

`debate` → `reception`, `debate-claims` → `sources-claims`, `debate-check` → `sources-claim-check`:
steps, jobs, columns (expand migration `drizzle/20261010063350_reception_expand.sql`), routes, files,
types, `dbt-` → `rcp-`, `?debateby=`/`?debatethread=` → `?receptionby=`/`?receptionthread=` with lifts,
env var, eval, chat origins split by shape (claim → `sources-claims`, lens → `reception`), the
claim-check table renamed `sources_claim_checks` with a `debate_claim_checks` view for old code, the
rate limiter counting both bucket spellings, stale-notice words, one-deploy route/payload aliases.

**Do not edit `drizzle/20261010063350_reception_expand.sql` or its snapshot.** A separate read-only
review is looking at the SQL; report anything you find in it instead.

## Evidence you cannot produce yourself

No Postgres in your sandbox. Raw output of the database tests on this commit:
`docs/plans/261009w-stage-3-pg-tests-output.txt` (reception-expand-pg, reception-old-names,
bibliography-expand-pg, fetch-allowance, chat-origin-route, stale-notices-route, db-step-constraint,
pg-session-sharing-rebase). The builder ran the full suite in chunks, green.

## What to do

An independent attack first:

1. **Old code vs the expanded schema, and new code vs the old code's writes**, for every stored
   name this stage touches: columns, step runs, jobs, chat origins (both shapes), the claim-check
   table through the view (the old store's statements: `git show 9ac4332ae^:src/store/pg-debate-claim-checks.ts`),
   the rate buckets (old code counting only `debate-check` in the window — acceptable?), stale notices.
2. **The one-deploy aliases** against the pre-Stage-3 client (`git show 9ac4332ae^:src/web/useDebate.ts`,
   `useDebateClaims.ts`, `useDebateChecks.ts`): exactly what it reads, including none-yet headers and
   the POST's response.
3. **Hits decided wrongly**: renamed English ("debate" in prose/prompts), or still named for Debate
   where it is the step/artefact/mode name. Specifically decide these, which the builder left: 
   - `src/web/PrivacyPage.tsx` (~416) says "Reception in Debate" — reader-facing and stale (the mode
     is Sources); fix it, and check the privacy doc and help pages for the same.
   - `src/web/visitor.ts` NOUN `reception: "a debate"` — reader-facing copy; is it right?
   - `evals/command-pick/phrases.ts`, `blind.raw.json`, `tests/command-suggest-route.test.ts` still use
     catalogue ids `mode:debate`, `submode:debate:reception` (and Stage 1/2 left `mode:citations`,
     `mode:peer-review`?). Are those ids still produced by the live catalogue
     (`src/command-pick-catalogue.generated.json`)? If not, the eval's gold labels are stale: fix
     them to the live ids unless a file is a dated, frozen input.
   - Log strings and an authored message saying "debate"; `liftLegacyDebateBy` keeping its name.
4. **Identifier naming** against the plan's rule (Reception artefact → `Reception…`; claims list /
   claim check → `SourcesClaims…` / `SourcesClaimCheck…`; serving both → `ReceptionAndClaims…`):
   anything misnamed in a way that will mislead (e.g. a Claims-only thing called Reception)?
5. Docs: `docs/project/reception.md`, `mode.md § Renaming a mode`, `sources.md`, `setup-dev.md`,
   `AGENTS.md` signposts — true against the code?

Fix what is inside this stage, narrowly, red-first where it is behaviour. Report, do not fix,
anything wider. Run any vitest file needing no network or Postgres; `npm run typecheck`. Do not
commit; no git command that discards work.

## Severity and output

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

First line: `LAND`, `LAND AFTER FIXES`, or `DO NOT LAND`. Findings C1, C2, … most severe first, each
with evidence and whether fixed (files) or reported.
