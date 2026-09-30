# Plan review: quiz scores answers by section (260930i)

You are reviewing a plan, read-only. Repo: Spideryarn, an AI-assisted reading app.

Read the plan: docs/plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again.md

Then read what it builds on, and check the plan's claims against the code, not the prose:
- docs/project/quiz.md (especially: A path; It adapts: the premise; What a mark says; Only what you have read; What is deliberately not here)
- src/web/QuizPanel.tsx (verdicts, move, pick, included/includedAt, the render)
- src/web/quiz-ladder.ts, src/web/read-filter.ts, src/section-path.ts, src/types.ts (TreeNode, Tree, QuizQuestion, QuizVerdict)
- src/web/modes/conversation/ConversationModes.tsx (RememberBand), src/web/reader/Reader.tsx (where RememberBand is rendered)
- docs/project/privacy.md (quiz and reading-time paragraphs), docs/project/remember-mode.md (the rules against grading the reader)

Greg asked for a SIMPLE v1. Tell me:
1. Is anything factually wrong about the existing code the plan relies on?
2. Is the section mapping right (sectionNodesOf(...)[0] as the top-level section; flat trees; supplements; heading-derived provisional trees; stale block ids from an older quiz batch)?
3. Does "Where to look again" break any stated rule (the premise rule, the path never re-sorting, the no-grading rules, the banned-words test, the filter's "never draw a question the panel has not moved to") in a way the plan does not name? Is the proposed softening of "verdict never rendered" acceptable, or is there a simpler framing that keeps more of the rule?
4. Is there a simpler design that still does all three things Greg asked (per-section picture, steer the quiz, say what to re-read)?
5. Anything that will bite in implementation (state reset on a new batch, filtered-out questions as "its questions" targets, a section whose wrong question is currently hidden by the filter, the mark still streaming).

Write findings numbered, severity P0/P1/P2, each with the file/line evidence and a concrete fix. Be terse.
