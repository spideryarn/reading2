You are reviewing CODE for the Spideryarn reading app, after it was built and committed (HEAD, on top of 09cb866c8). You may edit files in this worktree to fix what you find inside this change's scope; report anything wider for the author to decide. Do not run git commands that change history or the index (no commit, reset, checkout, stash, restore). Do not touch .env.local, infra/ or any production system. Do not call any paid model.

Read first:
- docs/plans/261011r-skim-more-always-longer-than-gist-a-pass-intro-shorter-quotes-skim-for-box.md (the plan, including "What the plan review changed")
- docs/plans/261011r-skim-plan-review-sol.md (your own plan review, for what was promised)
- docs/plans/261011r-skim-code-review.diff (the scoped diff: src, tests, scripts; generated files excluded)
- docs/investigations/261011b-skim-more-beats-gist-intros-and-short-stops.md (the measurement; the results files it names are in evals/results/)

Check especially:
1. src/skim.ts growPasses / repairSizes: is the plan always applicable (can moveDeeper or carryTo ever find no candidate, or exceed maxCarried, or create/empty a pass)? Does the applied route always have the sizes the plan predicted? Does buildSkim's `rearranged` set (index pairing of validated vs grown) identify exactly the passes whose own stops changed? Is introsOf right for absent passes and for the `rearranged` case? Do validateRoute's carry caps and growPasses agree?
2. targetsFor: every q from 1 to MAX_QUOTES_TOTAL respects the cumulative caps and q >= 8 gives gist < more <= most.
3. The prompt (SKIM_SYSTEM section 2's sizes and SHORT STOPS, section 4 intros, OUTPUT) and SKIM_OUTPUT_SCHEMA: consistent with each other and with what introsOf/validateRoute accept? ANSWER_TOKENS still covers the largest answer?
4. src/web/SkimPurpose.tsx: the edit-in-place state machine — double submission, the banner, owner.rewriting/job/starting, the ambiguous-save path (it must still reconcile and then re-plan once), unmount during save, switching article (key={owner.slug}).
5. src/web/SkimPanel.tsx: the intro line only when a route is drawn, owner only; nothing leaks to the visitor route (src/public/dto.ts is unchanged on purpose).
6. scripts/eval/skim-walked-metrics.ts and skim-walk-pairs.ts: do they compute what the investigation says they compute (walked passes, word counts, the blind key balance)? Spot-check one number in the investigation against the results files.
7. Tests: do the new tests fail when the behaviour breaks (not tautological)? Anything untested that should be?

Then run: npx vitest run tests/skim.test.ts tests/skim-purpose-line.test.tsx tests/public-dto.test.ts tests/voices-css.test.ts and npm run typecheck, after any edit you make.

Write your answer as numbered findings, each with severity (high/medium/low), file:line evidence, and either "FIXED: <what you changed>" or "NOT FIXED: <why, and the proposed fix>". End with a one-line verdict: "ship", "ship after the fixes made", or "do not ship".
