You are reviewing a plan before it is built, in the repo at the current directory (Spideryarn, an AI-assisted reading app; read CLAUDE.md for the house rules). Read-only: do not edit files.

The plan: docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md

It changes Summary mode's controls (src/web/modes/summary/SummaryMode.tsx, src/web/SummaryPanel.tsx, src/web/SimplePanel.tsx, src/web/params.ts, src/web/styles/summary.css) and the Simple stage (src/simple-summary.ts, src/types.ts SimpleSummary/isSimpleParagraphs, src/pipeline.ts step `simple`, src/store/pg.ts loadSimpleSummary/public projection, src/public/dto.ts, src/routes.ts GET /api/simple and withProfileChanged). The prior plan for Simple is docs/plans/260930i-simple-summaries-eli15-sub-mode.md; the profile machinery is src/profile.ts (PROFILE_RULES, profileSection, hashProfile, profileIsStale), ProfileCarrying in src/store/pg.ts, OWNED_ARTEFACT in src/messages.ts, WrittenForYou in src/web/WrittenForYou.tsx.

Please check, against the code:
1. Is anything in "Checked first" false? Especially: does every slug job carry ctx.profile for the `simple` step; is reusing profileSection/PROFILE_RULES right here (vs the quiz's own readerSection)?
2. The artefact shape change (paragraphs -> levels, simple/1 read as absent): every reader of simpleSummary that would break or silently misbehave — store guards, public DTO, export/import, sharing, metadata re-run list, tests, fixtures. Anything that would report success while doing nothing.
3. One call writing both levels: sound, or is there a failure mode (one level bad kills both, token budget, latency) that argues otherwise?
4. The control design: Parts|Sections as a ladder (Sections lights both), Simple|Fuller a switch, ?deep=0 dropped, activation/arming (src/web/activation.ts, useAutoRun) with two pills arming the same `simple` step, last-view restore, ModeBoundary. Accessibility of hidden legends.
5. Profile not in the stamp + profileChanged badge + Write it again: consistent with the house's other profiled artefacts? Public/visitor privacy implications.
6. The measurement design: will it actually test the claim?
7. Anything simpler that gets Greg what he asked for.

Output: a numbered list of findings, each with severity P0/P1/P2, the file/line evidence, and a concrete fix. Then a one-paragraph verdict. Be concrete; skip praise.
