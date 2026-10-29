## Findings

1. **High — fast Quiz jobs could finish without refreshing the reader. Fixed.**  
   [useQuiz.ts](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/useQuiz.ts:536), [useQuiz.ts](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/useQuiz.ts:640)  
   If a margin-triggered job was already complete on the job engine’s first poll, the always-mounted listener treated it as its baseline and the job hook’s no-op callback refreshed nothing. The questions existed server-side but appeared only after another read or reload. The exact-job callback now refreshes, with same-turn coalescing to prevent the ordinary two-listener case issuing two GETs.

2. **Medium — removing Ideas changed the failure message for existing Ideas/Skim jobs. Fixed.**  
   [job-state.ts](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/job-state.ts:260)  
   A historical or manually requested `quotes → ideas → skim` job that failed stopped saying the article itself was unaffected because the predicate was derived from today’s import list. Ideas remains a transactionally harmless extra even though imports no longer queue it, so it is now explicitly retained in that classification.

3. **Medium — keyboard users could not open Quiz’s delegated card, and its touch target was too short. Fixed.**  
   [MarginaliaColumn.tsx](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/marginalia/MarginaliaColumn.tsx:423), [marginalia.css](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/styles/marginalia.css:541)  
   `data-marg-tip` was on the unfocusable parent, so focusing a question button failed the delegated card’s `:focus-visible` check. The trigger and AI voice metadata now sit on each button, and coarse pointers get the required 40px target. The question text continues to use the AI face.

4. **Low — two edited documents made false claims. Fixed.**  
   [q-ejp09q.md](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/docs/user-feedback/questions/q-ejp09q.md:17) claimed missed questions could be offered tomorrow without storing Quiz’s deliberately forgotten verdict. It now names that privacy trade-off.  
   [skim.md](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/docs/project/skim.md:416) still said questions were always drawn in the prose; it now records the margin exception. The plan’s inaccurate context/memo description was also corrected.

I found no unresolved serious issue. In particular:

- Ideas is absent from import jobs, including Skim’s dependencies, and gifts use the same corrected main-mode queue.
- Margin and press-armed Quiz runs share the atomic attempt guard; a new simultaneous-arrival test confirms one POST.
- Visitor, viewing-as, hidden-margin and opening-outline gates prevent spend.
- `marginRoom` controls both suppression and margin insertion, so questions are not duplicated or lost.
- The relevant memo dependencies are stable on scroll.
- The reported Ideas and Quiz costs reconcile with the plan’s measurements.

Verification:

- 209 targeted unit tests passed.
- 18 documentation-link tests passed.
- Equivalent typechecking passed all 4,078 covered source files.
- `npm run typecheck` itself cannot start here because `tsx` is denied its `/tmp` IPC socket (`EPERM`); `node --import tsx scripts/typecheck.ts` passed.
- Scoped lint had only two pre-existing CSS specificity warnings.
- The two database-backed gift/publication tests could not connect to the sandboxed local Postgres port. Static inspection confirms both routes use the shared corrected queue.