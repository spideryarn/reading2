# Draft recovery eligibility must follow accepted submissions and known local state

Fixing review of `0e3633def` (base `fc7f86c2c`), plan
[261004j](../plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md).
Up: [postmortems.md](../project/postmortems.md).

Two gaps in the new recovery rules were reproduced in this worktree. This review did not
establish production exposure. Both fixes and regression tests remain uncommitted for the
implementer to review.

## A provenance guard applied beyond the uncertainty it protects

**F12.** A failed Chat list fetch still starts a local conversation, as Round 2 deliberately
allows. The reader types there, leaves, and returns after a successful fetch. The words are
stored under the old id, but the destination was never recorded, so arrival starts another
conversation with an empty box. An untouched handoff on a failed load has the same outcome.

The new destination effect rejected every `loadFailed` snapshot. A failed fetch cannot establish
absence, but `begin()` independently supplies a known local conversation that the panel really
shows. The effect applied uncertainty about the server's list to positive local evidence.

The fix records a positively matched selected thread even after fetch failure. Recording the
list still requires a successful fetch. Recovery itself continues to reject failed-load
evidence. This keeps the failure guard's purpose while allowing drafts written into known
local conversations to survive.

Both new action-sequence tests failed before the fix: the textarea contained `""` instead of
the typed question or the untouched handed-over question. Existing failed-load tests checked
that old words were not moved during failure; they never typed into the conversation the old
arrival rule supplied after that failure.

## Eligibility revocation delayed across an asynchronous handoff

**F13.** In a new Chat conversation, the reader presses Send while Live is active, then types a
follow-up while Live hangs up. If they leave and return before the hang-up finishes, recovery
moves that follow-up into a new conversation without the accepted first question's history.

`Composer.submit()` accepts and clears the question before awaiting `live.stop()`. The new band
revoked `fresh` only when `onSend()` finally ran after that wait. Eligibility therefore answered
whether the transport had started, instead of whether the reader had submitted a question.
The irreversible store mark was correct; its call-site timing was wrong.

The fix adds `onSubmitStarted` to Composer and passes it through Conversation. ChatPanel uses it
to revoke eligibility for the open Chat id immediately after the submission guards pass.
The band's later revocation remains for direct callers and the id returned by `send`.
Live still finishes before the typed request starts. Inferring submission from clearing text
would be wrong because Escape also clears; revoking when Live starts would be premature.

The new deferred-hang-up test failed on the observable wrong box: it contained
`"a follow-up typed during the hang-up"` in a replacement conversation. After the fix, those words
remain under their pending first question's id. Existing typed and spoken tests called the band
callbacks directly, bypassing Composer's asynchronous handoff.

Both defects were introduced by `0e3633def`'s recovery implementation. The older failed-load
default and awaited Live stop exposed the gaps; changing either would broaden this stage.
The root-cause analysis was independently checked in a read-only subagent.

## Countermeasures, ranked by ease against value

1. **Action-sequence regression tests with a failed read and a deferred dependency** — implemented
   in [chat-draft-survives-a-mode-change.test.tsx](../../tests/chat-draft-survives-a-mode-change.test.tsx).
   Assert the box and the draft's owner, not only the store flags. Each new regression was seen red.
2. **Check state-transition timing at the real call sites** — inexpensive during review. A store's
   irreversible flag does not prove callers revoke it when the reader commits the action; a failed
   remote read does not invalidate independently known local state.
3. **Keep the entire conversation controller mounted across modes** — rejected for this stage.
   It changes operation, fetch and Live lifetimes to solve two small recovery-boundary gaps.

The narrow fixes also serve as the long-term fix for these two gaps: eligibility follows the
accepted submission, and positive local selection evidence is separate from remote absence.

Validation: the seven supplied files plus `chat-live-handoff` and `chat-live-dictation` passed
149 tests. Fourteen temporary mutations, including removing each new fix, failed at the intended
assertions and were undone. The full suite stopped at database setup because Docker was inaccessible
in the review sandbox. The full typecheck script (run with `node --import tsx` because the `tsx`
CLI's IPC socket is blocked here) passed the web client and reported only the six pre-existing
errors in `src/backfill-registry-facts.ts`. Lint on the touched code reported five complexity
advisories and no errors.
