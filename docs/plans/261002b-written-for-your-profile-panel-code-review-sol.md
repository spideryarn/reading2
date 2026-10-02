No P0 findings. I fixed four issues and left one wider P1 for decision.

### P1

- [useAutosavedText.ts:212](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useAutosavedText.ts:212): an unmount keepalive save could land before an older ordinary PATCH, allowing the older text to overwrite the newest words. Unmount now waits for the in-flight request before sending the latest draft. Proven by [autosaved-text.test.tsx:224](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/tests/autosaved-text.test.tsx:224), which failed before the fix.

- [ProfilePanel.tsx:503](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/ProfilePanel.tsx:503): Regenerate became enabled after a save but before `refresh()` returned, so it could use the previous `profileChanged` verdict. Refresh is now awaitable and Regenerate remains disabled through it. Clearing the profile correctly removes the button once `profileIsStale` returns false. Proven by [profile-panel.test.tsx:546](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/tests/profile-panel.test.tsx:546) and [profile-panel.test.tsx:574](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/tests/profile-panel.test.tsx:574).

- [ProfilePanel.tsx:464](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/ProfilePanel.tsx:464): persistent 500/offline save failures made every outside press retry and provided no escape. Outside press/Escape now keep the panel open without retrying; Done explicitly retries; “Close without saving” explicitly abandons the draft and suppresses the unmount flush. Proven by [profile-panel.test.tsx:414](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/tests/profile-panel.test.tsx:414).

- Left for you: an active dictation is still aborted if mode/article navigation unmounts the entire subtree. The dismissal guard only controls the popover; [useDictation.ts:1854](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/useDictation.ts:1854) deliberately aborts on parent unmount. Closing this requires navigation or editor ownership work outside this stage.

### P2

- [ProfilePanel.tsx:259](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/src/web/ProfilePanel.tsx:259): independent badges could leave two profile panels open. Opening another now closes the clean panel or is vetoed while the existing panel is dirty/busy. Proven by [profile-panel.test.tsx:593](/home/greg/code/spideryarn2/.claude/worktrees/fb7s-written-for-your-profile-panel/tests/profile-panel.test.tsx:593).

- Test-coverage gap left: Glossary’s `more(true)` wiring has a behavioral test, but Summary, Ideas, Tweets, and Sketch do not have equivalent mode-level tests proving their exact regenerate verb. Their wiring is typechecked and reviewed, but removal could escape the current focused suite.

Verified without changes:

- Glossary’s `existingFor` rejects every profile mismatch, including hash-to-null; clearing to null does not show Regenerate because `profileIsStale` deliberately returns false.
- Refresh/job state does not remove the badge: each hook preserves the existing artefact during revalidation and job startup.
- Offline-copy detection gates both halves read-only and reopening fetches anew.
- The panel’s viewport cap, global border-box sizing, internal wrapping, and textarea width do not introduce a static overflow at 390px or in a 288px band. No real-browser geometry pass was available.

Checks:

- 7 touched test files: 128 passed.
- Full TypeScript check: passed.
- Scoped lint: passed.
- Literal `npm run typecheck` was blocked by the sandbox denying `tsx`’s IPC socket; the same script passed via `node --import tsx`.
- Full `npm test` could not start because the local Postgres service was unavailable; I did not start or touch the database as requested.

No commit was made.