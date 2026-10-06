# Review, round two (narrow): one helper for both Anubis shapes

Repo: this worktree, branch `worktree-bot-check-walls`. You reviewed `61b440abd` and wrote fixes
F4 to F7 (`docs/plans/261006f-other-bot-check-walls-code-review-sol.md`). This round checks only
what was changed **on top of your fixes**. Discovery is otherwise closed. New IDs start at **F8**.

## The candidate

Committed: `4953bd666`. It contains your F4 to F7 edits as you left them, plus mine:

    git diff 61b440abd..4953bd666 -- src/challenge-page.ts tests/extract-challenge-page.test.ts docs/postmortems/261006k-a-first-id-match-hid-a-later-valid-script.md

Mine, which nobody has reviewed: in `src/challenge-page.ts`, your per-branch lookup became one
helper, `hasJsonScript(doc, id, passes)`, used by **both** shapes, so the first shape
(`anubis_challenge`) no longer uses `getElementById` either; three tests for that in
`tests/extract-challenge-page.test.ts` (*"an earlier … with the challenge id does not hide the
real challenge script"*), seen red before the change; and two paragraphs of the 261006k postmortem
reworded to say so.

## What I want

1. Does `hasJsonScript` keep your F4 fix intact, and is the first shape's behaviour unchanged for
   every input except a duplicated id?
2. Is there any input the first shape refused before `61b440abd` that it no longer refuses, or a
   real article it now refuses?
3. Is the 261006k postmortem still accurate?

Run `npx vitest run tests/extract-challenge-page.test.ts` (82 passed for me). You may fix narrowly
and red-first; do not commit. Never attribute words to Greg that are not already in the repo
verbatim. Same severity scale (P0 to P3, established or reasoned). End with *land it* / *fix
first* and list every file you changed.
