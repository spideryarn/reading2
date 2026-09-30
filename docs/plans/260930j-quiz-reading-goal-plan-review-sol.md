No P0 findings. I found three issues worth resolving before implementation.

1. **P1 — “Every quiz job carries the current profile” is too broad.**

   **Evidence:** The normal browser path is correct: both `ensure()` and `write()` call `queue.start()` without disabling the profile ([useQuiz.ts:306](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/web/useQuiz.ts:306), [useQuiz.ts:310](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/web/useQuiz.ts:310)); `useStepJob` defaults `useProfile` to true ([useStepJob.ts:554](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/web/useStepJob.ts:554)); the route calls `resolveProfile` unless explicitly told not to ([routes.ts:9310](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/routes.ts:9310)); and that resolver combines the reader profile and this article’s purpose ([routes.ts:5815](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/routes.ts:5815), [profile.ts:81](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/profile.ts:81)). Metadata reruns and reset-and-regenerate also resolve a fresh profile when initiated.

   Exceptions:

   - The CLI enqueues only the slug and step, with no profile ([scripts/stage.ts:277](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/scripts/stage.ts:277)).
   - Retry deliberately copies the failed job’s old profile snapshot ([jobs.ts:4283](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/jobs.ts:4283)).
   - `POST /api/jobs` may explicitly use `useProfile: false`.
   - Failure to read the shelf purpose is swallowed, yielding an About-only or empty profile ([routes.ts:5823](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/routes.ts:5823)).
   - Two concurrent unforced jobs with different profile snapshots are distinct work ([jobs.ts:3712](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/jobs.ts:3712)), but the second may skip after the first writes because quiz freshness deliberately ignores the profile.

   **Concrete fix:** Narrow the plan’s claim to normal browser-created jobs, explicitly document CLI and Retry semantics, and decide whether purpose-read failure should fail a personalized quiz request instead of silently producing a generic one. Add one route/job integration test that asserts the frozen job profile includes the current article purpose. If the CLI is expected to behave like the UI, extract profile resolution from `routes.ts` into shared code and call it there.

2. **P1 — Whole-profile is a reasonable v1, but the proposed rules do not actually confine “About the reader” to pitch.**

   **Evidence:** The plan says About affects only explanation and question proportions, then proposes appending `PROFILE_RULES` ([plan:81](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md:81), [plan:84](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md:84)). But `PROFILE_RULES` says the profile changes “pitch and emphasis” and governs “which things you spend words on” ([profile.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/profile.ts:170)). That invites About information to alter topic selection. The proposed/current reminder also unconditionally says to aim the path at why the reader is reading, even when the rendered profile contains only About information ([quiz.ts:889](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/quiz.ts:889)).

   There is no safe cheaper purpose-only route that the plan missed. Parsing the rendered string by its heading is brittle because both fields contain arbitrary multiline reader text. Reusing `Job.profile` to mean purpose-only for quiz jobs would make mixed jobs, retry, reset and work identity inconsistent. A structured field is the honest purpose-only implementation.

   **Concrete fix:** Keep the whole rendered profile for v1, but replace shared `PROFILE_RULES` with quiz-specific constant rules: About may alter assumed vocabulary and minimal context only; only the labelled purpose may alter takeaway selection and proportions. Make the reminder conditional on the purpose label being present, and add an About-only evaluation arm.

3. **P1 — Two pieces of the proposed wording conflict with existing quiz constraints.**

   **Evidence:** “Never mention the reason” can be read literally as banning subject terms contained in the purpose itself—for example, a purpose of “understand the causal identification method” could suppress questions naming that method ([plan:80](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md:80)). Also, allowing About to change “how much a question explains” risks violating the existing rule that a question must not contain enough explanation to answer itself ([quiz.ts:697](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/quiz.ts:697), [prompting-guide.md:44](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/docs/project/prompting-guide.md:44)).

   The other substance is compatible: purpose may override “Cover the piece” when the piece has enough relevant material; a few setup questions fit the path rules; and returning to an ordinary path when evidence is thin avoids padding.

   **Concrete fix:** Say: “Do not mention that a reading purpose was supplied or frame anything as being asked because of it. Terms and topics named in the purpose may be used normally when the article supports them.” Replace “how much the question explains” with “assumed vocabulary and the smallest non-answer-bearing context needed to identify what is being asked.” Apply the no-meta-framing rule to premises and reference answers too.

4. **P2 — The caching split is correct.**

   **Evidence:** The article-with-IDs is the first system block and carries the cache breakpoint; `QUIZ_SYSTEM` follows it and `renderPrompt` is the user message ([quiz.ts:998](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/quiz.ts:998)). Pipeline prompt sharing groups compatible stages around that article block ([pipeline.ts:303](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/pipeline.ts:303)). Quiz shares the cached article prefix with several other high-effort stages, but not its later system or user text ([models.ts:1593](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/models.ts:1593), [models.ts:1745](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/models.ts:1745)).

   **Concrete fix:** Keep the planned placement. Add a request-shape test asserting profile text appears only after the cache-controlled article block; testing `renderPrompt` alone does not protect that boundary.

5. **P2 — Omitting `profileHash` is defensible, but the plan should record the export/public boundary.**

   **Evidence:** Adding it would make quiz `ProfileCarrying` and pull it into the existing personalized-artifact machinery and make-public dialog ([pg.ts:2464](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/store/pg.ts:2464)). Quiz is absent from the public artifact type and DTO ([types.ts:2282](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/types.ts:2282), [dto.ts:977](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/public/dto.ts:977)), so neither public sharing nor the visitor payload currently exposes it.

   Quiz is, however, included in the owner’s export bundle ([export-bundle.ts:458](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/store/export-bundle.ts:458)). That export also includes the article purpose, so this is consistent with an owner-controlled data export rather than an accidental public disclosure.

   **Concrete fix:** Keep `profileHash` out for v1, but document that personalized quizzes must remain excluded from public DTOs until a generic visitor quiz exists. Preserve that exclusion in a regression test.

6. **P2 — No `PROMPT_VERSION` bump is the right product choice, with a provenance trade-off.**

   **Evidence:** The version controls whether stored quizzes appear current or outdated ([quiz.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/quiz.ts:154), [pg.ts:3045](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/src/store/pg.ts:3045)). Bumping it would mark every existing quiz stale, contrary to the stated decision not to regenerate automatically. The cost is that `quiz/5` no longer uniquely identifies the exact prompt behavior.

   **Concrete fix:** Do not bump it. Record in `quiz.md` that goal-aware generation was intentionally introduced within version 5 and only affects newly requested quizzes.

7. **P1 — The evaluation is directional but its pass condition is too weak and underspecified.**

   **Evidence:** “More than half” can pass even when the target part already supplies more than half of the baseline questions; comparing only two runs per arm is noisy at a maximum of twenty questions; and evidence location is an imperfect proxy because legitimate setup questions may cite other sections ([plan:122](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md:122)). The prompting guide recommends comparing against control variation and reading/blindly judging the actual outputs ([prompting-guide.md:112](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/docs/project/prompting-guide.md:112)).

   There is also a CLI parsing trap: the existing evaluator treats the first non-`--` token as the directory, so naively adding `--purpose "text"` makes the purpose value look like the directory ([evals/quiz.ts:492](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/evals/quiz.ts:492)).

   **Concrete fix:** Predeclare the target section, require both an absolute majority and a meaningful lift over pooled no-purpose runs—e.g. at least 20 percentage points—and inspect the actual question topics, path quality, premise use and meta-addressing. Add an About-only control and require its topic distribution to remain within ordinary control variation. Parse `--purpose` and its value before selecting the positional directory.

8. **P2 — The plan is missing durable documentation and end-to-end coverage.**

   **Evidence:** `quiz.md` documents freshness and deliberately omitted capabilities but not purpose-shaped generation or its whole-profile/no-hash compromise ([quiz.md:322](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/docs/project/quiz.md:322)). The planned tests exercise prompt rendering and a fabricated context ([plan:132](/home/greg/code/spideryarn2/.claude/worktrees/fb-6q-quiz-reading-goal/docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md:132)); they would not catch a route, job-freezing or CLI regression.

   **Concrete fix:** Update `quiz.md` with the behavior and exceptions, and add one route-to-job trace test plus the full model-request placement test described above.

**Verdict: revise before build.**