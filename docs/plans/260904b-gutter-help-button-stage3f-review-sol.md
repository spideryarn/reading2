One commit-blocker remains, but the recovery architecture is right.

1. Reader authority and scope

Yes: an explicit reader decision is sufficient authority to abandon the uncertain ID, and dropping only the client summary is the correct scope. It cannot delete stored conversation data or race a late server commit.

However, the UI contract is currently inaccurate:

- “This conversation never started” asserts exactly what the preceding reasoning says is unknowable ([ChatDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/ChatDialog.tsx:253), [rendered copy](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/ChatDialog.tsx:501)).
- “Start over” only drops the shortcut and closes; it does not start anything ([ChatDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/ChatDialog.tsx:505)). The test explicitly requires another `?` press ([help-sends-once.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/tests/help-sends-once.test.tsx:413)).

The honest cheap version is something like:

> We didn’t see this conversation start, and can’t tell whether it was saved.  
> **Forget this attempt**

Alternatively, keep “Start over” but make that click actually initiate the replacement.

The reader loses no persisted content today, but may lose the current-page shortcut to a live conversation; it may reappear after reload. “Forget this attempt” accurately describes that.

2. ID-transfer class

Yes, the verdict is now free of cross-ID transfer.

- A timed-out A cannot stall B.
- A → draft → A retains A’s verdict within the same mounted component; that is reuse for the same ID, not transfer.
- A remount resets `timedOut` and gives A a fresh window.
- Cleanup prevents the old timer continuing after a committed target change; even a queued A callback remains harmless because it cannot satisfy B’s ID comparison.

3. Commit verdict

Not yet. Align the recovery copy and button with what is actually known and performed. That is the one remaining issue.

My scoped verification passed: 104/104 relevant tests, all three TypeScript projects, and `git diff --check`. The full suite was unusable in this sandbox because socket/process-dependent tests fail with `EPERM`.