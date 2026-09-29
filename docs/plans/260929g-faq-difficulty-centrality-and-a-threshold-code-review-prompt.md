# Code review: FAQ difficulty/centrality, prioritised order and threshold (260929g)

**Candidate:** commit `f23e1346` in this worktree (branch `worktree-faq-priority`). Its parent
`f23e1346^` is the base. `git show --stat f23e1346` lists every changed path; the diff is
`git diff f23e1346^ f23e1346`. Start with `src/faq.ts`, `src/web/faq-order.ts`,
`src/web/FaqPanel.tsx`, `src/web/threshold.ts` (the new "the track" section),
`src/web/GlossaryPanel.tsx` and `src/web/CitationsPanel.tsx` (now wrappers), `src/score-fields.ts`,
`src/public/dto.ts`, `src/web/params.ts`, `src/web/modes/faq/FaqMode.tsx`. That list does not limit
scope.

**What it is for:** the plan `docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md`
(read § Stage 1 — your own plan review's findings and what was done with each — and § Progress for
the eval). In short: the FAQ prompt (`faq/4`) now asks for up to three broad pressure questions and a
`difficulty` and `centrality` on every question; the panel defaults to a prioritised order on
`centrality × (1 − difficulty)`, which both gates (a slider) and orders; reading order is one tap
away; lists from before `faq/4` have no scores and must render exactly as before; visitors get the
same order.

**You may edit files to fix what you find** (workspace-write), inside this change's scope. Do not
commit, do not run git commands that change history or the index, and do not touch files outside
the change unless a fix requires it — say so if it does. Report anything wider for me to decide.
After fixing, run `npx vitest run tests/faq.test.ts tests/faq-order.test.ts tests/faq-panel.test.tsx
tests/public-dto.test.ts tests/glossary.test.ts` and `npm run typecheck`, and report the results.

**Attack, in order:**
1. Correctness of the ordering and threshold: `orderQuestions`, `effectiveOrder`, `canPrioritise`,
   the panel's use of them; that the list, the `N of M`, the foot line and the pressed button cannot
   disagree; unscored and partly-scored questions; a `?faqbar=` above the data's top.
2. That the Glossary and Citations wrappers are behaviour-identical to what they replaced (the
   hundredth-grid edge cases: `.501/.509`, `.005/.009`, `.57/.58`, off-range URL values).
3. Validation in `toQuestions`: duplicates, counters, zero, null, out-of-range; the answer budget.
4. The prompt text in `FAQ_SYSTEM`: does the new section contradict any existing rule, or invite
   summary questions or unanchored ones?
5. The public DTO and old artefacts; URL params (`last-view.ts`, `url-state.md`); any test that
   pins something now untrue.
6. The conclusion in the plan's § Progress: is "the ordering is the effect; the prompt wording alone
   is inside the noise" a fair reading of the table? Is the default bar's choice sound?

Severity: P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or contract
violated; P2 design/maintainability risk; P3 prose. For each finding: severity, where, what, and
whether you fixed it (and how). End with a one-line verdict.

**The finding I would least like to be wrong about:** that a list from before `faq/4` (no scores at
all) renders exactly as it did — same order, no order row, no slider, no score bars — for both owner
and visitor.
