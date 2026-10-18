# Code review: the guide opens web pages, as Chat does (261017e § Stage 2, 2B)

You are reviewing code in this worktree, **write-capable**: fix what you find inside this change,
and report anything wider for the author to decide. Do not commit, push, deploy, or touch any
database other than the local one. Do not run git commands that discard work.

## The change

Plan: `docs/plans/261017e-bring-a-web-page-into-chat.md` § "Stage 2 — 2B" and § Reviews (your
plan review is `docs/plans/261017e-2b-plan-review-sol.md`). The product owner chose that the typed
guide may open any web address, as Chat does (risk R29 in `docs/project/security-risks.md`,
accepted, **not up for review**). What is up for review is whether the code does exactly that and
nothing more.

The diff is `docs/plans/261017e-2b-code-review.diff` (`git diff HEAD`, all of it). In short:

- `src/chat-tools.ts`: `READ_WEB_PAGE_TOOL` in `GUIDE_TYPED_TOOLS`; `READ_WEB_PAGE_PER_TURN_GUIDE`
  with `guideReadsThisTurn`, asked through a `beforeFetch` callback inside `readWebPage` after its
  refusals and before the fetch; `ToolContext.spoken` and `spokenToolsFor`, so a live call is gated
  by what Live offers; `toolsOf`/`noSuchTool` take the context.
- `src/live.ts` (`liveTools` uses `spokenToolsFor`), `src/routes.ts` (`liveTool` sets `spoken`).
- `src/converse.ts`: `GUIDE_SYSTEM`'s YOUR TOOLS reworded, `WEB_LINKS` added, last-round nudge.
- Tests: `tests/guide-tool-gate.test.ts`, `tests/chat-live-ticket-route.test.ts`,
  `tests/web-reach-every-kind.test.ts`, `tests/guide-kind.test.ts`, `tests/chat-tools.test.ts`.
- Evals: `evals/chat-web-reach.ts` (a `given` case; per-turn reads, steps, tokens, dollars) and
  `evals/guide/next-steps.ts` (a `hostile-read` case, tools stubbed).
- Docs: chat-tools.md, security-map.md, security-risks.md (R29), the help page and its corpus.

## Look especially at

1. Every caller of `runTool`, and every place a `ToolContext` is built: can any path reach
   `read_web_page` for a guide without the per-turn count (a fresh context per call), or reach it
   from Live? Is `spoken` set everywhere it must be, and nowhere a typed turn is built?
2. `beforeFetch`: are all pre-fetch refusals before it, is anything fetched before it, and can two
   calls in one round both pass?
3. Anything in `src/web/` that assumes a guide turn has no `read_web_page` run.
4. Is the prompt wording plain, consistent with the rest of `GUIDE_SYSTEM` (60 words, Chat for the
   subject), and does adding `WEB_LINKS` conflict with anything already in it?
5. Docs that still say the guide cannot open pages, or that disagree with the code.
6. The eval changes: do the new fields measure what they claim (e.g. `collectSpend` nested inside
   `withLedger`)?

Run `npm run typecheck` and the touched test files (`npx vitest run <files>`) after any fix.

## Output

Findings numbered F1…, each with severity (P0/P1/P2), evidence, and whether you fixed it (and how)
or left it for the author. End with one line: `VERDICT: ship` / `VERDICT: ship after the fixes
made here` / `VERDICT: do not ship`.
