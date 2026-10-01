You are reviewing a PLAN (not code) in the Spideryarn repo, read-only. The plan is
docs/plans/260930i-simple-summaries-eli15-sub-mode.md. Read it, then read enough of the repo to test it:
CLAUDE.md, docs/project/summaries.md, docs/project/mode.md, docs/project/prompting-guide.md,
docs/project/vision.md, the FAQ stage-1 commit b31d8b87 (show --stat, and the files) and stage-2 0e947eb4
as templates, src/web/modes/summary/SummaryMode.tsx, src/web/SummaryPanel.tsx, the Remember/Quiz sub-mode
(`?remember=quiz`, src/web/useQuiz.ts, src/web/auto-run-targets.ts, src/web/useAutoRun.ts), src/models.ts,
src/step-order.ts.

Answer:
1. Is the design sound and the simplest version that meets Greg's request (quoted in the plan)? Is there
   a smaller version that gets most of the value? Should ELI15 or ELI12 ship first?
2. Anything the plan gets wrong about the repo's machinery (step placement and cached prefix, effort,
   PROFILE_RULES interaction, public projection policy, auto-run rules, URL key naming, migrations,
   PROMPT_VERSION/outdated comparison)?
3. The streaming deferral: acceptable or not, given CLAUDE.md's rule?
4. The artefact shape and validation rules: holes?
5. Anything missing from the stage list or the tests that a code review would later find.

Number your findings P0/P1/P2, each with file/line evidence. Say plainly if the plan's conclusion
(build it as a job-backed stage beside faq) is wrong. Write your findings as your final answer.
