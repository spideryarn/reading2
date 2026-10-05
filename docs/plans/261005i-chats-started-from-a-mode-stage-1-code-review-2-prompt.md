# Review, round two: a narrow check of six fixes made by the round-one reviewer

Repo: this worktree, branch `worktree-chats-started-from-a-mode`.

## The candidate

Committed: commit `1cf578937` alone (`git diff 1cf578937^..1cf578937`; `git show --stat 1cf578937`
lists its paths). It is the round-one reviewer's own fixes for CR-1 to CR-6, on top of the stage
commit `eaf3a3fee`. Round one's prompt and answer are
`docs/plans/261005i-chats-started-from-a-mode-stage-1-code-review-prompt.md` and
`…-stage-1-code-review-sol.md`; the contract is in that prompt and is unchanged.

Start with: `src/chat.ts` (§ `withTurn`), `src/web/chat-draft.ts`, `src/web/chat/controller.ts`,
`src/web/chat/model.ts`, `src/web/useChat.ts`, `src/web/modes/conversation/ConversationModes.tsx`,
`src/web/useChatAnchors.ts`, `src/web/reader/Reader.tsx`.

## What this round is for

Treat the six fixes as unreviewed code written by someone else. For each of CR-1 to CR-6: is the
fix correct, does its test fail without it, and did it break anything that worked before it,
in particular for conversations that have nothing to do with origins: an ordinary chat, a block
chat in the floating dialog, Remember's three single conversations, a draft restored on returning
to Chat, the arrival rule that starts a blank chat, a retry, an edit, a spoken (Live) turn?

Discovery outside those six fixes is closed. A new finding is in scope only if one of the six
fixes caused it.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp is writable. You have no network, so Postgres suites will not connect;
I ran these on `1cf578937`, all passing: 48 test files, 908 tests, covering `tests/chat-origin*`,
`conversation-band*`, `chat-anchors*`, `debate*`, `chat-controller*`, `chat-draft*`,
`glossary-ask-in-chat`, `summary-ask-in-chat`, `use-chat*`, `thread-origin*`,
`remember-own-thread`, `chat-kind*`, `live-tail-handoff`, `doc-links`, `store-export*`,
`store-roundtrip*`; `npm run typecheck` clean. Offline test files you can run one at a time.

## Findings

Reuse CR-1 to CR-6 for the same finding; number new ones from CR-7. For each: severity
(P0/P1/P2/P3 by consequence), established or reasoned, (a) the input or order of events that shows
it, (b) the smallest change that closes it, as a code block.

End with one line: land, or do not land. Refuse only on an established P0 or P1.

Do not change any file.
