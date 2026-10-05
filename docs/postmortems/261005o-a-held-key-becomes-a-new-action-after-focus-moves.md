# A held key becomes a new action after focus moves

**Fixed the same day**, in the stage that found it: `isSendEnter` refuses a held Enter's repeats for
every box that sends, Chat's composer also cancels the repeat so it adds no blank lines, and
`tests/debate-lens-in-chat.test.tsx` keeps the regression across the focus change (countermeasures 1
and 2 below). What follows is the write-up as the reviewer left it, when it was still open. Review of [261005k stage 1](../plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md)
found that Enter can open a seeded Chat, move focus to its composer, and then send the question
when the same held key repeats. The integration reproduction used the fake server: one POST,
no paid call and no database write. Physical keyboard timing has not been checked in a browser.

Owned by [postmortems.md](../project/postmortems.md). Root-cause tracing was delegated to a separate
reviewer. The review brief required reporting wider defects without fixing them, so the shared Chat
handler remains unchanged. This is not resolved by the lens input's separate IME guard.

## The class: a held activation key becomes confirmation after focus moves

Each component treats a matching keydown as a new intention. Their composition moves the focused
control and turns one physical press into two actions. Debate hands over the angle; ConversationBand
stores the seed and raises its focus nonce; Composer focuses its populated textarea. A subsequent
`keydown` with `key: "Enter", repeat: true` reaches Chat rather than Debate.

`isSendEnter` in `src/web/key-chord.ts` checks the key, Shift and composition, but neither names nor
checks `repeat`. Composer in `src/web/ChatPanel.tsx` therefore calls `submit`, which finds the seed
nonblank and posts it. Guarding repeat only on the source input cannot protect a destination that
already holds focus.

The original Enter handler omitted repeat protection in `3a99eb048`. The seeded Glossary handoff
and caret focus arrived in `e0fb40a776`; `fdd595b416` extracted the shared predicate without adding
repeat protection. Candidate `97179213f` adds another path into this inherited behavior.

## Evidence

A temporary App integration regression entered a lens, waited for the populated Chat composer to
hold focus, dispatched a repeated Enter to it, and asserted zero chat POSTs. It failed:

```text
holding the handoff key is not a separate Send: expected [ { … } ] to have a length of +0 but got 1
```

The temporary failing case was removed after reproduction; the reviewed stage's permanent suite
does not defend this behavior. The reproduction establishes the destination handler's response,
not the timing of native keyboard auto-repeat. The existing tests separately covered handoff and
ordinary Send, so neither asked whether the activation key could cross between them.

## The long-term fix and countermeasures, ranked

1. **Reject auto-repeat in the shared send-key predicate.** A small separate change covering Chat,
   question editors and Candidates. Decide explicitly whether rejected repeated Enter should also
   have its default newline canceled. Verify ordinary Enter and Ctrl/Command-Enter still send,
   while repeated Enter does not.
2. **Retain an App regression across focus transfer.** Seeded handoff followed by a repeated Enter
   must produce zero POSTs; a later deliberate Enter must produce one. This tests the composition
   and the write boundary, rather than only the two controls in isolation.
3. **Debounce each handoff or delay focus.** Rejected: timing guesses leave other callers exposed
   and weaken the normal caret behavior. The destination should recognize a repeated key directly.

The lesson is to follow an activation key across focus changes. A populated destination whose
confirmation key matches the source's activation key needs to distinguish a new press from the
old press repeating.
