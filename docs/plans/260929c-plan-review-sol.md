### Findings

- **F1 — P1 — `src/web/GlossaryPanel.tsx:299`, `src/web/GlossaryPanel.tsx:441`, `src/glossary.ts:469`**  
  Removing Glossary’s outdated banner leaves **Find more** visible. On an outdated glossary, that action does not append: `existingFor` rejects the old version and the run replaces the list. The only visible action would therefore silently rewrite under the wrong label.  
  **Fix:** mirror Quotes: hide idle *Find more* while outdated, but retain a status-only footer for an active/failed job. Add an outdated-list test.

- **F2 — P2 — `src/web/QuizPanel.tsx:461`**  
  Quiz is missing from the plan’s footer-gate inventory. Its `!owner.outdated` gate has the same hidden-progress problem as Ideas, Timeline and Debate once `Staleness` stops rendering the outdated notice.  
  **Fix:** name all five gated panels: Ideas, Timeline, Debate, Quiz and Trajectory. Drop Quiz’s outdated gate and test it. For Trajectory, replace `!outdatedBy(owner)` with explicit `!owner.stale && !owner.profileChanged`; merely weakening/removing the helper gate would also expose a duplicate footer under retained notices.

- **F3 — P2 — `src/chat-tools.ts:1589`**  
  One additional reader path still announces prompt age: the citations chat tool tells the model that the list came from an older citations step, which may be repeated to the reader. Metadata rows, shelf, command bar/chips and visitor views do not show an outdated verdict; visitors do not receive freshness fields.  
  **Fix:** decide explicitly whether chat is an exception. If Greg’s request covers every reader-facing notice, remove this sentence and update its tests/docs. Do not change visitor/access code.

- **F4 — P2 — docs omitted from the plan**  
  Current documentation promises banners/actions that this change removes: `docs/project/trajectory.md:79`, `docs/project/quotes.md:593`, `docs/project/quotes.md:631`, `docs/project/glossary.md:535`, and `docs/project/new-mode.md:249`. `docs/project/chat-tools.md:218` also changes if F3 is taken.  
  **Fix:** add these documentation updates to the plan; historical plans and feedback notes can remain historical.

The stale/profile/outdated branches are otherwise clean: stale wins in all nine panels, profile notices are separate except Trajectory’s intentional helper, and removing only the outdated arms leaves no empty banner.

Keeping Quotes’ *Find more* hidden is correct: the server would replace rather than extend an outdated list, so showing it would mislabel a destructive rewrite. Metadata remains the honest route.

**Verdict: approve with changes.**