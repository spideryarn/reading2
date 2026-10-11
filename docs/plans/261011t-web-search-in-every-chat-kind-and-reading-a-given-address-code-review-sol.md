1. **Low — stale claims and comments.** [web-reach-every-kind.test.ts:2](/var/tmp/spideryarn-worktrees/fbdrbkvc-web-search-all-chats/tests/web-reach-every-kind.test.ts:2) claimed every typed conversation could search; the guide cannot. The feedback summary similarly implied every mode could open pasted links. I corrected both, restored the guide qualification in [converse.ts:340](/var/tmp/spideryarn-worktrees/fbdrbkvc-web-search-all-chats/src/converse.ts:340), regenerated feedback data, and marked the guide-search consult as a historical, backed-out snapshot.

2. **Low — missing regression coverage for the guide’s Chat step.** [web-reach-every-kind.test.ts:52](/var/tmp/spideryarn-worktrees/fbdrbkvc-web-search-all-chats/tests/web-reach-every-kind.test.ts:52) checked only the prompt text. I added a check through `guideModeKeys()` and `checkNextStep()`: `{ kind: "mode", mode: "mode:chat" }` is accepted, so `offer_next_steps` will not refuse it.

The substantive review is clean:

- Recall and Tutorial’s new rule is explicitly conditional on the reader asking where the piece stands. It does not semantically invite searches on `remember` or `word`; the 0/8 controls support that. Recall’s situating compliance remains the documented 2/4 because it sometimes chooses the library despite “never instead.”
- Recall’s length/one-nudge rules, Tutorial’s own-view rule, and the guide’s under-100-word/NEXT STEPS rules remain compatible with the new paragraphs.
- `webSearchTool` and `roundTools` have no behavioral diff from `HEAD`; only `webSearchTool`’s explanatory comment changed.
- Each changed system prompt is stable per kind, causing one new cached prefix. Profile, saved values, and guide experience remain below the breakpoint.
- Chat’s default eval path sends the same cases, questions, anchors, help flag, profile value, tools, and prompt as before. The added output metadata does not reach the model.
- Eval counts are honest as tool-use counts, not quality verdicts. The saved result files reproduce the plan’s table; their URL answers also show actual page content.
- Repo grep found no remaining current-state claim that the guide searches or Recall never searches situating questions. Historical attempted-build artifacts are now explicitly identified.

Checks: 153 targeted tests passed; full typecheck passed across 3,697 files; generated feedback files are current; `git diff --check` passed. The full suite could not run its Postgres lanes under this sandbox, and its broader unit run encountered unrelated process/Git/local-service failures. No paid eval was run.

SHIP AFTER MY FIXES