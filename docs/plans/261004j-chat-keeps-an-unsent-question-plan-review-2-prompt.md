# Review: a plan to keep Chat's unsent question across a mode change

Repo: this worktree, branch worktree-qi-ja6rdqm8-chat-draft-on-mode-change. TypeScript, ESM, React client under src/web.
This is a PLAN review: read-only, change no file.

## The candidate

Live pre-commit: base 556c8cd63; untracked: docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md
No code has been written yet.

Start with: the plan; src/web/ChatPanel.tsx (the `drafts` and `listDraft` refs, `draftFor`, `leave`, `Composer`);
src/web/modes/conversation/ConversationModes.tsx (`ConversationBand`: `startNew`, the arrival latch, the handoff effect, Remember's one conversation);
src/web/useChat.ts (controller per mount); src/web/search-draft.ts (the pattern being copied). Not the limit of scope.

## What it is meant to do

Greg decided: a question typed but not sent in Chat survives switching mode and is there when the reader returns.
In memory, for the life of the page. Not across a reload. The plan names what it deliberately does not build.

## What I want

An independent attack on the plan first. Is each statement under "Why it is lost today" accurate against the code?
Is the orphan rule correct and the simplest thing that works, for chat and for Remember's three single-conversation kinds?
Which sequences of reader actions lose a draft, duplicate a conversation, resurrect a deleted one, or put words in the wrong box?
Is there a simpler design that reaches the same behaviour?

Severity: P0 data loss / security / broadly unusable; P1 user-visible wrong behaviour or contract violated;
P2 design or maintainability risk, no wrong behaviour today; P3 prose. Mark each finding established (direct evidence,
exact source path) or reasoned. Give every finding an ID: F1, F2, ...
End with a verdict line: APPROVE or REFUSE (refuse only on an established P0 or P1).

## Round 2

This is round 2. Round 1 is docs/plans/261004j-chat-keeps-an-unsent-question-plan-review-sol.md (F1-F6, REFUSE). The plan was rewritten along the simpler design you proposed. Check each of F1-F6 is closed by the plan as it now reads, then attack the new Chat rule and the by-kind Remember draft. Number new findings from F7.

## My own suspicions (already mine; spend most of the run elsewhere)

- The module-level map and sign-out without a reload: can a second reader on the same tab meet the first one's draft?
- Whether `?thread=` really is kept across every kind of mode change, and what Remember does with it.
- StrictMode double effects around the orphan rule and the arrival latch.
- Switching between Remember sub-modes (Recall, Tutorial, Explore) and whether that is a remount.
