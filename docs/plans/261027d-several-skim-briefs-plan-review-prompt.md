# Plan review: several Skim briefs per article (261027d)

You are reviewing a PLAN, read-only, in the repo at the current directory (a worktree of Spideryarn, an AI-assisted reading app). Nothing is built yet.

Candidate: the untracked file `docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md` (live, pre-commit; base is HEAD of this worktree). Read it first.

Then read, to check it against reality (this does not limit scope): `docs/project/skim.md` (especially the purpose box section and "The route says what it was planned for"), `src/skim.ts` (`skimInput`, `skimInputHash`, `routeProfileIsStale`, `profileNoticeKey`, `generateSkim`), `src/pipeline.ts` § the `skim` step (~line 5865), `src/profile.ts` (`renderProfile`, `hashProfile`), `src/web/useSkim.ts`, `src/web/SkimPurpose.tsx`, `src/web/SkimPanel.tsx`, `src/store/pg-chat.ts` and the `chat_threads` table in `src/db/schema.ts` (the pattern being copied), `docs/project/url-state.md`, `docs/project/security-map.md`, `docs/project/export.md`, `docs/project/billing.md`.

## What I want

An independent attack on the plan: is the data model right; is "a request, not a job" for planning an added brief's route sound here (serverless on Vercel, maxDuration 800; cost tracking; any per-owner spend or abuse gate the job path has that a direct route would skip; concurrency of two presses); is staleness per brief correctly specified; what else is keyed on "the one route" that the plan forgot (MCP tools, chat tools, Metadata's AI-processing row, rewrite hold, export/transfer, deletion); and is there a materially simpler version that gives Greg what he asked. Also: is the product question (picker shape A/B/C) a genuine one, and is anything else a product choice I've silently made that should go to him?

## Severity scale

P0 = would lose or corrupt reader data or open a security hole. P1 = the plan as written would not work or would ship a visible bug. P2 = worth fixing, not blocking. P3 = nit. Give every finding an ID (F1, F2, …), a severity, the evidence (file:line), and the fix.

## My own suspicions (worth less; spend most of the run elsewhere)

- Whether a direct route bypasses something the job queue enforces (owner checks, the High-powered AI `power` setting, a running-job lock, a spend cap).
- Whether brief rows should hang off the article or the revision, given quote ids are per revision.
