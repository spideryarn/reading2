Code review before push. You may fix what you find inside this change (edit files in this worktree);
report anything wider for me to decide. Do not commit, do not push, do not run evals that spend
money (evals/chat-web-reach.ts calls a paid model).

The plan, with what changed during the build and why, and the measurements:
docs/plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address.md
(your plan review: ...-plan-review-sol.md; your consult on the guide: ...-guide-consult-sol.md —
its recommendation was not built, see the plan's § The guide, tried and backed out, and the
question file docs/user-feedback/questions/q-w26r6u.md).

The diff: `git diff` (tracked) plus the untracked files in `git status --short`. Code:
- src/converse.ts — LEARN_SYSTEM (Recall) and TUTORIAL_SYSTEM: a new reason to search ("where the
  piece stands"), Recall's "Do NOT search, unprompted" rule kept; GUIDE_SYSTEM: a paragraph sending
  the reader to Chat for the world; comments on webSearchTool and GUIDE_SYSTEM. `webSearchTool` and
  `roundTools` should be byte-identical in behaviour to HEAD — check that.
- evals/chat-web-reach.ts — `--kind`, OTHER_KIND_CASES, a neutral profile, the guide's saved/experience.
  Chat's own run (no --kind) must send exactly what it sent before: check.
- tests/web-reach-every-kind.test.ts (new).
- docs/project/chat-tools.md, the plan, the question file.

What I most want checked:
1. Do the prompt changes say what the plan says, without contradicting anything else in the same
   prompt (Recall's LENGTH / one-nudge rules, Tutorial's THEIR OWN VIEW, the guide's NEXT STEPS and
   "under 100 words")? Is "ALWAYS search the web … never instead" going to make Recall search on the
   `remember` / `word` style turns? (The controls stayed 0/8; say if the wording invites more.)
2. The guide paragraph: "offer Chat as one of your next steps" — is `mode:chat` actually a key the
   guide's next-steps check accepts (src/next-steps.ts, the catalogue, modeWordsSection in
   src/guide.ts)? If not, the instruction asks for a step that is refused, which sends the turn round
   again (ENDS_THE_TURN/settles): that would be a real bug.
3. Prompt-cache: each changed system prompt is a one-time new prefix; anything that varies per turn?
4. Does any doc, test or comment still claim the guide has web search, or that Recall never searches
   for situating questions? grep the repo.
5. Anything in the eval change that would make its numbers lie.

Write findings (numbered, severity, file:line, what you changed or recommend) and end with one line:
SHIP, SHIP AFTER MY FIXES, or DO NOT SHIP.
