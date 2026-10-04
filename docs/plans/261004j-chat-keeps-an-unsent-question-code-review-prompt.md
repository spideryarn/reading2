# Review: Chat keeps an unsent question across a mode change

Repo: this worktree, branch worktree-qi-ja6rdqm8-chat-draft-on-mode-change. TypeScript, ESM, React client under src/web.

## The candidate

Committed: commit 0e3633def
git diff fc7f86c2c..0e3633def
changed paths: git diff --name-only fc7f86c2c..0e3633def

Start with: src/web/chat-draft.ts, src/web/modes/conversation/ConversationModes.tsx (`ConversationBand`),
src/web/ChatPanel.tsx, src/web/ChatDialog.tsx. Not the limit of scope.

## What it is meant to do

The plan is docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md. Where its
"What we will build" and its "Round 2" section disagree, Round 2 is the contract. Your two plan
reviews (F1-F11) are beside it. In short: a question typed but not sent in Chat, in the box under
Chat's list, and in Recall, Tutorial and Explore, is in the box when the reader comes back from
another mode. In memory for the life of the page; not across a reload. The plan lists what is
deliberately not built.

## What I want

This is a fixing review. You have write access to this worktree.
- Fix what is inside this stage, narrowly, and red first: write or extend a test, see it fail, then fix.
- Report, do not fix, anything wider you notice.
- Do not commit. Do not run git commands that discard work.
- Do not write any sentence attributed to Greg. The only Greg quote for this work is the one in the plan.

Independent attack first: which sequences of reader actions lose a draft, put words in the wrong box,
duplicate a conversation, resurrect a deleted one, or send a follow-up without its history? Check each
of F1-F11 against the code as built, not against the plan's prose. Check the call sites, not only the
store. Check that the new tests would fail without the fix they claim to cover.

You can run a single test file that needs nothing outside the tree, for example:
npx vitest run tests/chat-draft-survives-a-mode-change.test.tsx --configLoader runner
I ran these and they pass (7 files, 98 tests): tests/chat-draft.test.ts,
tests/chat-draft-survives-a-mode-change.test.tsx, tests/chat-dialog-shares-the-draft.test.tsx,
tests/chat-list-composer.test.tsx, tests/conversation-band-handoff.test.tsx,
tests/remember-own-thread.test.tsx, tests/doc-links.test.ts.
`npm run typecheck` is red on six errors in src/backfill-registry-facts.ts, a peer's file that is
red on the trunk and is not part of this change; src/web passes.

Severity: P0 data loss / security / broadly unusable; P1 user-visible wrong behaviour or contract
violated; P2 design or maintainability risk, no wrong behaviour today; P3 prose. Mark each finding
established or reasoned, and say for each whether you fixed it. Number new findings from F12.
End with a verdict line: APPROVE or REFUSE (refuse only on an established P0 or P1 you did not fix).

## My own suspicions (already mine; spend most of the run elsewhere)

- The destination-recording effect runs in the same commit as the arrival decision and records a
  stale value for one render. Can anything read it in that window?
- On a failed load the old arrival rule still starts an empty conversation, and a never-submitted
  conversation's words stay stranded under the old id for that visit.
- StrictMode double effects around `arrived` and `started`.
- The dialog and the panel both writing one entry: can the two be mounted at once?
