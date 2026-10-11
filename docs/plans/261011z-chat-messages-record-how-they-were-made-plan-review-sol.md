## Findings

**F1 — P1: Retry/edit cannot simply leave `via` unchanged.**

The plan says both operations leave `via` alone ([plan:60](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/docs/plans/261011z-chat-messages-record-how-they-were-made.md:60)), but:

- Retry accepts any last assistant message, including a spoken one ([chat.ts:722](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/chat.ts:722)), then replaces its contents with a streamed text answer ([chat.ts:737](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/chat.ts:737)). Leaving `via` untouched would keep `spoken`, or keep `null` on an old row, for newly written text.
- The database retry update resets attempt-specific fields but would preserve `via` unless explicitly changed ([pg-chat.ts:595](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/store/pg-chat.ts:595)).
- Edit preserves the user row by spreading it, correctly retaining its original provenance and adding `editedAt` ([chat.ts:814](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/chat.ts:814)), but creates a completely new assistant row ([chat.ts:815](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/chat.ts:815)). That row must receive `written`.

Suggested fix: preserve the user row’s `via`; set the assistant row to `written` on every retry and edit in `withRetry`, `withEdit`, the SQL retry update, and the retry/edit optimistic rows. Add a regression test that retries a `spoken` answer and observes `written`.

**F2 — P1: Submission provenance must be snapshotted before clearing and awaiting Live shutdown.**

The plan says to reset the refs when sending ([plan:69](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/docs/plans/261011z-chat-messages-record-how-they-were-made.md:69)). However, `submit` clears the box, may await `live.stop()`, and only then calls `onSend` ([ChatPanel.tsx:3281](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/ChatPanel.tsx:3281)). The code deliberately allows the reader to begin another draft during that await.

Computing `via` after clearing yields `null`; reading live refs after the await can attribute the next draft’s input to the previous question; resetting after the await can erase the next draft’s provenance.

Suggested fix: before clearing, capture `const submittedVia = composerVia(...)`; immediately reset the refs for the new draft; after `live.stop()`, send the captured value. Test with a deferred `live.stop()` while another draft is typed.

**F3 — P1: Clearing without sending leaves stale provenance attached to the next draft.**

The plan resets only on send. Escape clears the same mounted composer without remounting it ([ChatPanel.tsx:3385](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/ChatPanel.tsx:3385)). Likewise, selecting all and deleting runs the textarea’s `onChange`.

A dictated draft cleared with Escape, followed by a keyboard-only question, would be recorded as mixed.

Suggested fix: centralize draft-provenance reset and invoke it on send, Escape-clear, and whenever textarea `onChange` produces an empty value. Add a dictate → clear → type test.

**F4 — P1: A non-empty seeded draft can be falsely classified as entirely typed or dictated.**

`Composer` initializes its state from `draft` ([ChatPanel.tsx:3146](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/ChatPanel.tsx:3146)). The proposed refs begin false, so a handed-over or restored paragraph followed by one keystroke becomes `typed`, despite most of its words being injected; adding dictation alone makes it `dictated`.

That contradicts the proposed meanings “keyboard only” and “dictation only” ([plan:34](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/docs/plans/261011z-chat-messages-record-how-they-were-made.md:34)). The acknowledged conversation-switch imprecision does not cover this broader seeded-draft case.

Suggested fix: initialize an `unknown/prefilled` flag when `draft` is non-empty and conservatively return `null` until the draft has been emptied and begun afresh. Alternatively, add an explicit prefilled/mixed value, though `null` is simpler.

**F5 — P2: The rollback restore writer is omitted from the plan.**

The rollback export is explicitly covered, but `seedChatFromFiles` is its hand-written restore side and maps every message field individually ([seed-reader-state.ts:310](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/tests/helpers/seed-reader-state.ts:310)). Without adding `via`, an export/restore test silently drops it.

Suggested fix: add `via: message.via ?? null` to this writer and ensure the rollback round-trip fixture contains a non-null value. The downloadable bundle needs no extra projection change because `rowJson` exports every column generically ([export-bundle.ts:164](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/store/export-bundle.ts:164)).

**F6 — P2: `dictated_edited` asserts an ordering the detector does not know.**

The plan defines it as both inputs “either order” ([plan:36](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/docs/plans/261011z-chat-messages-record-how-they-were-made.md:36)). Typing first and then appending dictation is not edited dictation.

Suggested fix: use `mixed` or `typed_and_dictated`. One nullable, role-constrained column remains the right shape; two booleans weaken exclusivity and a child table is unnecessary. I would also prefer `modality` or `creation_mode` over the vague `via`, with assistant values `text | spoken`, though that column-name change is less important than replacing `dictated_edited`.

## Other answers

The two-callback detection seam itself is correct. Dictation writes that actually land call the hook’s supplied `onChange` ([useDictationField.ts:328](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/useDictationField.ts:328)); keyboard input, paste, IME, undo, and browser editing operations reach the textarea `onChange` ([ChatPanel.tsx:3339](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/ChatPanel.tsx:3339)). The double-Stop path calls `submit` through `onDone` ([ChatPanel.tsx:3233](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/web/ChatPanel.tsx:3233)); form submit and Enter do too. I found no composer send path bypassing `submit`.

There is no hidden production inserter beyond `begin`, `appendSpoken`, and edit’s new reply in `pg-chat.ts`. Article transfer deletes chat as reader state rather than copying it ([pg-article-transfer.ts:526](/var/tmp/spideryarn-worktrees/fbz30x5n-chat-message-modality/src/store/pg-article-transfer.ts:526)); the bundle export is generic; the rollback export is correctly identified. The command-bar dictation omission is explicit rather than missed, but those rows will remain unknown until its queued follow-up lands.

**REWORK**