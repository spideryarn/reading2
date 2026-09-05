# Review the plan: the gutter's blue chip, help metadata, and the explanation prompt

You are reviewing a **plan, before any code is written**. Bias hard towards **simplicity and
cleanness** — that is the report author's explicit request, quoted in the plan itself.

## The candidate

Worktree: `/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip`
Base commit: `15f2cb39` (branch `worktree-feedback-comment-chip`, level with `origin/dev`).

**Nothing is committed and nothing is edited yet.** The only new file is untracked:

- `docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md` — the plan under review

Read that first. The tree is otherwise exactly `origin/dev` at `15f2cb39`.

## Reading list (a starting point, not a limit on scope)

- `docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md` — the plan
- `docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md` — especially
  § "The decision the review forced: no new `ThreadKind`", and § "Stage 4 — the addendum", which was
  never built and which this plan proposes to finish differently
- `docs/plans/260905b-gutter-back-to-a-vertical-line-and-a-help-prompt-that-admits-nearby-blocks.md`
  — landed this morning; this work sits on top of it
- `src/web/App.tsx` — `chatAboutBlock`, `helpAboutBlock`, `openCommentDialog`, `openChatThread`
- `src/web/BlockGutter.tsx` — the four gutter slots and their handlers
- `src/web/useChatAnchors.ts` — `helpThreadFor`, `foldInLocalWrites`
- `src/web/chat-handoff.ts` — `HELP_QUESTION`
- `src/converse.ts` — `buildConverseMessages`, `anchorSection`, `systemFor`
- `src/routes.ts` — `streamChat`, and the `anchor` / `sourceCommentId` per-turn validation around
  line 2260
- `src/db/schema.ts` — `chatThreads` (~line 2838) and `comments` (~line 1447)
- `src/store/export.ts` — the hand-written per-column export lists
- `docs/project/prompt-caching.md`, `docs/project/sql.md`, `docs/project/vision.md`

You have no network. Any test you can run inside the tree, run it; anything needing Postgres or a
local service is mine to run and you should say so rather than assert a result.

## What I want from you

An independent adversarial pass on the plan, in this order:

1. **Is the 1Q diagnosis right?** The plan claims the "blue Comment box" Greg clicked is
   `.block-chat.has` (the chat chip) and not `.blk-cmt` (the orange bookmark), and therefore that the
   bug is `chatAboutBlock` never reopening. Check that against the code and the colour tokens. If the
   diagnosis is wrong the whole of stage 1 is wrong, so this is the highest-value thing you can do.
2. **Is the persisted `chat_threads.from_help` column justified, or is it inert state?** The plan
   argues 260904b's rejection of a fourth `ThreadKind` survives intact and that a narrow column is
   the honest way to give report 1R what it asks for. Attack that. In particular: is there a simpler
   answer that satisfies "record that this was a request for explanation" without a migration at all?
3. **Does anything in the plan break prompt caching, the anchor invariants, or the "every mark the
   reading view draws is a chat" rule?**
4. **Is any stage not independently landable?** Each is supposed to end green and committable.
5. **What is missing** — a file the plan does not name that will have to change (export, parity
   tests, filesystem store, types), or a failure mode it has not thought about.
6. **What should be cut.** Simplicity is the brief. If the `Plus` button, or the copy change, or the
   whole of stage 2 is not earning its place, say so.

Give every finding an **ID** and a severity:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

End with a one-line verdict: build it as written / build it with these changes / do not build it.

## My own suspicions, which are worth less than yours

These are already mine, so spend most of the run elsewhere.

- I am least sure about the `Plus` button in the `ChatDialog` header. It is the one new control, and
  "prefer boring" might say the door back to a new conversation should be something else, or nothing.
- `threadFor` admitting selection-anchored threads (so the chip opens what its count promises) may
  put a reader into a conversation about three words when they pressed a chip beside a paragraph.
- The pedagogical instruction in stage 3 could easily produce answers that replace the passage
  instead of unlocking it, which is against `vision.md`. I have not written the wording yet.
