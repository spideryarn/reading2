# Review prompt, round 2: the revised plan for quiz questions that build up (260930c)

Read-only. Revision: commit 37cd0734 in this worktree.

Round 1 is docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways-review-sol.md (yours).
The plan, docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md, has been rewritten
around your F1 (adaptive premise disclosure). Its § Review log says how each finding was handled.

Please:

1. Check each round-1 finding against the revised plan: resolved, partly, or not. Be specific.
2. F4 is overruled (count internal gaps instead of failing the batch), on the evidence that 3 of 10
   baseline batches dropped a whole question (evals/results/quiz-build-up/before*/*.json, field
   `dropped`). Is the overrule sound? If you still object, say what smaller measure you would accept.
3. Look for new defects introduced by the revision: the premise rule (`showPremise` keyed on the
   previous question's verdict), the response-only compatibility fields on GET /api/quiz/:slug
   (src/routes.ts), the stems-only list, the marker seeing the premise whether or not it was shown
   (src/quiz-mark.ts builds the marking request from the server's copy of the question), and the
   old quiz/4 artefacts walked in array order.
4. Anything in the prompt design (§ The prompt) that will make the model produce premises that are
   giveaways, or questions that are unreadable without their premise.

Severity P0–P3 as before, IDs R2-1, R2-2 …, a proposed fix each. End with: build / build with the
listed fixes / do not build.
