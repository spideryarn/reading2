Code review of commit 805b40654 in this worktree: plan docs/plans/261002b-written-for-your-profile-panel-edit-in-place-and-regenerate.md (revised after your own plan review, docs/plans/261002b-written-for-your-profile-panel-plan-review-sol.md). The scoped diff is docs/plans/261002b-written-for-your-profile-panel-code-review.diff. Read the touched files in full, not only the diff.

You may edit files to FIX what you find inside this stage (src/web/ProfilePanel.tsx, WrittenForYou.tsx, ProfileBox.tsx, useAutosavedText.ts, useProfile.ts, purpose.ts, PurposePrompt.tsx, Metadata.tsx, the mode panels and hooks in the diff, styles/profile.css, the tests). Add a failing test first for any behaviour bug you fix. Do not commit, do not run git commands that change history or discard work, do not touch the database, .env.local or infra. Report anything wider than this stage for me to decide.

Look hardest at:
1. Text loss: dismissal latch, dictation busy, unmount `leave` in useAutosavedText (StrictMode double-mount, a `leave` firing after a successful save, a `leave` racing an in-flight ordinary save and landing older text last), the panel trigger unmounting when a mode re-reads after `refresh()` or when a job starts (does the badge vanish mid-edit?), two badges open at once on one page.
2. The refused-save case: the builder made each outside press retry, and the panel cannot be dismissed while a save is refused. Is that a trap (e.g. a 500 or offline PATCH with valid text)? Propose and implement the least surprising escape that does not silently drop words.
3. Regenerate: shown only when `changed`; refresh() after a settled save — called exactly once, not in a loop; disabled while pending/in-flight/busy/job; each mode's wiring calls a verb that REPLACES (Glossary uses `more()`, relying on existingFor rejecting a hash mismatch — verify that path, including a profile cleared to null, where profileIsStale says not stale). Can it ever be pressed against the old profile?
4. Offline copy shown read-only: is the header check right for both halves and for a later reopen?
5. The 390px phone width and a 288px band: anything in profile.css that will overflow.
6. Silent success in the new tests: would each fail if the behaviour it names were removed?

Run `npm run typecheck` and the touched test files after your fixes. Answer with findings as P0/P1/P2 with file:line, what you fixed (and the test that proves it), and what you left for me.
