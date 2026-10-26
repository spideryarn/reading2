# Code review: 261026g stages 2–5 — Where it sits made clear, runs itself, links out

Repo: this worktree. The change is uncommitted: `git diff HEAD` plus the new file
`src/web/useWhereAutoRun.ts` (`git status --short`). Read first:
docs/plans/261026g-where-it-sits-made-clear-runs-itself-and-reaches-the-margin.md (all of it,
including § Review, which says how your plan findings F1–F7 were taken and the one declined),
your plan review docs/plans/261026g-plan-review-sol.md, then docs/project/sources.md § Where it
sits / § Opening it is the request / § Where this piece sits, docs/project/chat-from-a-mode.md,
and src/web/activation.ts's header.

What changed:
- Stage 2 (SituateDossier.tsx, situate-dossier.ts, reception.css): a summary box (head line,
  overview, overview chat, count strip); groups folded as `<details>` with the first in a new
  display order open; passage cards with the quote as a jump; same-passage findings merged; a focus
  opens its group; `ready` no longer counts an error as an answer.
- The overview chat's origin: a `situate` origin with an `so-<digits of generatedAt>` item id
  (types.ts `SITUATE_OVERVIEW_ID`, routes.ts `parseSituateOrigin`, thread-source.ts, chat-title.ts,
  Reader.tsx `askOverview`, InvestigatePanel's chats type, SourcesMode wiring).
- Stage 3 (WhereItSitsPanel.tsx): tools moved under the dossier as "Go further", shadcn Buttons
  with a line each (`SOURCES_TOOL_WHAT`).
- Stage 4: composite activation target `sources-where` (auto-run-targets.ts, activation.ts),
  owned by `WhereBand` via `useWhereAutoRun` — one job, situate preceded by bibliography, or
  bibliography alone; useSituate.ensure takes `withBibliography`. Privacy page, help, docs reworded.
- Stage 5 (part): Before it rows get an outward link (`WorkOut`).

Review for correctness above all, money first:
1. Can any non-press path now POST situate (pasted link, reload, Back/Forward, last-view restore,
   margin Open in Sources, chat way back, crumb, Investigate mounting useSituate, a press that
   lands on Bibliography/a tool then moves to Where)? Can a stored/stale/outdated dossier be
   re-run? Can two POSTs happen for one press (StrictMode, the two statuses settling at different
   times, bibliography's own useAutoRun also mounted in Where)? Is `precededBy: ["bibliography"]`
   correct with `StepBefore<"situate">` and the server's job handling?
2. The overview origin end to end: route accepts, DB CHECKs (drizzle/20261025183854_*) admit it,
   chat list label/voice, way back (`openFindingInSources` with an `so-` id), reopen logic.
3. Folding/focus/scroll logic in SituateDossier: any render loop (the effect depending on
   `setKindOpen`, which depends on a new Set each render), stale state across a new dossier, a
   focus landing on a shut group, keyboard/a11y of the count strip and `<details>`.
4. Anything stale in comments or docs this diff left behind, and anything in tests that passes
   vacuously.

Fix inside this diff's scope what you are sure of (edit files; run the relevant vitest files and
`node --import tsx scripts/typecheck.ts`). Report anything wider for me to decide. Output: numbered
findings, P0–P3, file:line, what you changed. End with a verdict line.
