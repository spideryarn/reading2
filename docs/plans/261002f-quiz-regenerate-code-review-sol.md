No P0 findings.

- **P1 — Open:** [useQuiz.ts:396](/home/greg/code/spideryarn2/.claude/worktrees/quiz-regenerate-for-profile/src/web/useQuiz.ts:396). Leaving Quiz discards `pressedOn`. Returning while the replacement GET is pending or failed re-enables paid Regenerate on the old batch. Reproduced with the actual button. The hold needs to survive band changes and still release after job failure.
- **P1 — Fixed:** [QuizPanel.tsx:556](/home/greg/code/spideryarn2/.claude/worktrees/quiz-regenerate-for-profile/src/web/QuizPanel.tsx:556). The stale banner’s “Write them again” ignored `rewriting`, allowing another forced run. It now honours the hold.
- **P1 — Fixed:** [QuizPanel.tsx:887](/home/greg/code/spideryarn2/.claude/worktrees/quiz-regenerate-for-profile/src/web/QuizPanel.tsx:887). A failed replacement GET left Regenerate held without recovery. Added “Read the new questions”, which retries only the GET.
- **P2 — Fixed:** [quiz.md:434](/home/greg/code/spideryarn2/.claude/worktrees/quiz-regenerate-for-profile/docs/project/quiz.md:434). Legacy quizzes lack a **profile hash**, not a freshness stamp. Corrected that wording and documented the remaining lifetime limitation.

Both panel regressions failed before the fixes. Added [integration tests](/home/greg/code/spideryarn2/.claude/worktrees/quiz-regenerate-for-profile/tests/quiz-regenerate-revalidation.test.tsx) using the real reader, job hook and profile panel through completion, delayed/failed reads and recovery; they verify exactly one forced job.

Confirmed the old-client band bridge remains applied, legacy missing hashes report unchanged, and the profile hash stays outside the freshness stamp. No additional null-batch or slug-change defect found; `reader-profile.md` is accurate.

Left for you: the hold-lifetime P1. Shared dictation and other modes’ regeneration gaps remain untouched as requested.

**Validation:** 249 tests across nine targeted files passed. Typecheck passed through Node’s loader after the npm command hit sandbox IPC restrictions. No full suite run; no commit.

**Verdict: changes required — one P1 remains.**