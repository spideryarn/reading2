# A submit handler test cannot prove the key that reaches it

Stage 1 of [261005k](../plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md)
added Debate's angle form in commit `97179213f`. Review found no application guard against the Enter
used to accept an IME candidate. No reader incident was established: native browsers commonly
suppress implicit submission during composition, and this review had no browser available.

Owned by [postmortems.md](../project/postmortems.md).

## The class: a downstream event bypasses the decision being claimed

`tests/debate-lens.test.tsx` called its direct `submit` dispatch “Enter”. That proves the submit
handler hands off an angle, but never exercises the keyboard event or the browser's decision to
submit the form. The new input had no key handler, so nothing in the application could distinguish
ordinary Enter from composing Enter, including the legacy `keyCode: 229` signal. Search and Chat
already use the shared composition checks in `src/web/key-chord.ts`.

The root-cause pass was delegated to a separate reviewer. It found comparable native forms in
Glossary and comment follow-ups; those were outside this stage and were left alone. The earlier
Search fix, `44b738eb6`, is evidence that composition Enter has needed explicit handling here,
but it does not establish this native form's behavior on every browser.

## Evidence and fix

Two added cases dispatch composing key events, then model implicit submission only when the event
was not canceled. Both failed before the fix with:

```text
accepting a word must not switch to Chat: expected [ '記憶' ] to deeply equal []
```

The input now cancels composing Enter using `isImeComposing`. Ordinary Enter and the button still
use the form. Both cases passed after the fix, alongside the existing form tests. This establishes
the application guard, not real-browser candidate acceptance; a browser check remains necessary.

## What would catch the class, ranked by cost and value

1. **Test the triggering event as well as its downstream action.** Added here: flagged and legacy
   composing Enter, unchanged input, no handoff, then ordinary submission.
2. **Check actual IME input in a browser.** More expensive, and necessary to establish native
   candidate acceptance and submission behavior. This review could not run it.
3. **Rewrite every form or add a source-text rule requiring a key handler.** Rejected: native forms
   are legitimate, and matching handler text would substitute source shape for behavior again.

The narrow guard is also the long-term remedy for this form: use the existing input policy rather
than adding another composition state machine. The lesson is to state exactly what a synthetic
event test reaches; a submit test cannot earn a claim about the key that precedes it.
