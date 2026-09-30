Second code review, on the work done after your first one. The current directory is the worktree. You may fix what you find inside this change's scope; report anything wider. Do not commit, do not run git commands that change history or the index, do not touch databases or .env files.

Read your first review: docs/plans/260930e-code-review-sol.md. Then the commit that answered it: `git show 1ef4b909` (the whole change is `git diff 464821c5 HEAD`, plan docs/plans/260930e-metadata-run-it-without-a-confirm-and-start-again-in-the-rerun-section.md).

What changed since your review:
1. Your P1 glossary finding: instead of exposing existingFor's verdict from the server, the glossary now gets the same "Run it"/"Run it again" label as every mode (off `done`), plus a note under its name: "Adds more terms to the list; if the article or your reader profile has changed, writes a new one". Is that note true in every case existingFor can decide (source hash, prompt version, profile)? Is there a case where it's still misleading?
2. Extending your Retry-latch finding to Run: a two-clicks-in-one-act test showed Run also posted twice. A latch in useStepJob.start broke tests/modes-that-start-themselves.test.tsx and tests/step-job-force.test.tsx (they call start twice on purpose), so it was reverted there and put in RerunRow in src/web/Metadata.tsx instead (a `pressing` ref held for the POST's round trip). Is that latch correct — can it get stuck, can it let a second post through after the POST answers but before the job is polled (starting should still hide the button then)?
3. Your useStepJob Retry latch was kept, with its comment reworded.

Gates: `npx vitest run tests/metadata-rerun-section.test.tsx tests/metadata-reset-section.test.tsx tests/modes-that-start-themselves.test.tsx tests/step-job-force.test.tsx`, `npm run typecheck` (judge by exit code).

Write findings as a numbered list: severity (P0-P3), evidence (file:line), what you changed or the proposed fix. End with a one-line verdict.
