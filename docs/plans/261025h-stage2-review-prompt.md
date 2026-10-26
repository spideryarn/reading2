# Review: Stage 2 of plan 261025h — three chips, *Where it sits*, the dossier out of the switch

Repo: this worktree (TypeScript/ESM, React + nuqs, vitest, Postgres via drizzle). You may fix what you
find inside this stage (house workflow: you fix, I read your diff and commit); report anything wider
for me to decide.

## The candidate

Stages 1 and 2 are committed together as HEAD (`git show HEAD --stat`). Stage 1 is already reviewed
(docs/plans/261025h-stage1-review*-sol.md) — out of scope except where Stage 2 consumes it
(`editions`/`sameAuthors` in useRelatedWork.ts, NotCitedPanel's groups). In scope: everything else in
`git show HEAD`, chiefly src/web/params.ts (`SOURCES_VIEWS`, `SOURCES_CHIPS`, `chipOf`,
`visitorSourcesView`, the parser default), src/web/router.ts (`liftLegacySources`),
src/web/sub-modes.ts, src/web/activation.ts, src/web/WhereItSitsPanel.tsx (new),
src/web/modes/sources/SourcesMode.tsx, src/web/InvestigatePanel.tsx, SituateDossier.tsx,
situate-dossier.ts, item-focus.ts, last-view.ts, reader/Reader.tsx (`openBibliographyWork`,
`askFinding`, `openOrigin`), the `situate` chat origin (src/thread-origin.ts, src/chat-title.ts,
src/web/thread-source.ts, src/routes.ts `parseSituateOrigin`, migration
drizzle/20261025183854_chat_thread_origin_situate.sql), PrivacyPage.tsx, the help pages, and their tests.

The plan: docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md (decisions
5, 7, 8, 9; § Stage 2; the promotion checklist in decision 5). Your plan review:
docs/plans/261025h-plan-review-sol.md (F1–F7 and F6 are this stage's). The keyword toggle (decision
10) is deliberately not in yet. Contracts: docs/project/sources.md, docs/project/url-state.md,
docs/project/mode.md, docs/project/privacy.md, docs/project/security-map.md.

## What I want

An independent attack. In particular:

- **Spending**: can any path — a bare `?mode=sources`, Back/Forward, a pasted link, a last-view
  restore, the command bar, a tool's crumb back — now start paid work (Reception's search, Claims'
  list, the dossier) without the owner's press on that thing? Activation was changed so Reception and
  Claims arm nothing; check their own first-run buttons and every rerun path still work.
- **Addresses**: exactly one chip checked for every legal `?sources=`; `?mode=citations` and any old
  Bibliography address still land on Bibliography (with its row focus); visitors unchanged.
- **Destinations**: every way into a Bibliography row (citation card, Claims' *Cited in this
  paragraph*, chat's way back) and into a finding (marginalia, item focus, a finding's chat) lands
  where it should. One `sources: null` was already found writing the wrong view; look for others
  (`sources: null`, `sources: undefined`, a default-dependent omission).
- **Promotion**: the dossier now shows for every owner. Privacy page and docs accurate? Rate limits
  still apply? Anything still gated that should not be, or ungated that should be (the marginalia
  literature notes were left behind the switch on purpose)?
- **The new chat origin**: the migration (drop and re-add CHECKs) safe on existing rows; old
  lens-origin chats from findings still found and reopened.

Run the suites you touch (`npx vitest run <files>`; the database is the local Supabase and may be
available). Severity: P0 data loss / exploitable security / incorrect charging / broadly unusable;
P1 user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability; P3
prose. IDs S2-F1…. For each: evidence file:line, and either "fixed" (with the test that proves it,
red first) or a suggested fix.
