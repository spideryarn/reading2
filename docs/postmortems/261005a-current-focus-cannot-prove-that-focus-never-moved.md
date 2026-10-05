# Current focus cannot prove that focus never moved

Up: [postmortems.md](../project/postmortems.md).

Caught in review of `804de1a92`, before landing the four-fix candidate. Root cause
checked in a separate agent; reproduced in
[`tests/chat-dialog-keeps-the-caret-across-a-switch.test.tsx`](../../tests/chat-dialog-keeps-the-caret-across-a-switch.test.tsx).

`ChatDialog` remembered that a removed composer held focus while its replacement
loaded. It cancelled that debt only if another element was focused during a
later React commit. Focusing an article control and blurring it between commits
therefore left the debt alive: the replacement stole focus. The existing negative
test kept the control focused until the commit, so missed the event history.

The class is **current-state sampling loses intervening events**. A present value
cannot prove the absence of a change since the previous sample.

The fix observes `focusin` throughout the dialog's lifetime and cancels pending
focus when an element takes it. The commit still checks the current element before
restoring focus. Both floating and card regressions now exercise focus followed
by blur between commits; the floating assertion failed before this fix.

Countermeasures, ranked by ease against value:

1. Observe the event that invalidates delayed work: a small listener, implemented.
2. Test a change and its reversal between asynchronous completions: implemented.
3. A general focus-history service is rejected: this debt has one owner and needs
   one cancellation event, not a new application-wide state machine.
