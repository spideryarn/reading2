Code review, with permission to fix, in the Spideryarn worktree
/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox. Stay focused on this change: fix
what is wrong inside it, and report anything wider for the caller to decide. Do not commit, do not
run git commands that discard work (no checkout/restore/stash/reset/clean).

The change is uncommitted: `git diff HEAD` plus the new files
docs/plans/261030a-experimental-checkbox-unknown-is-not-off.md and
docs/postmortems/261030a-a-check-that-found-a-control-by-its-kind-read-a-different-one.md.
Your own plan review is docs/plans/261030a-experimental-checkbox-unknown-is-not-off-plan-review-sol.md;
its four findings were taken (see the plan's § The change). Note the diagnosis changed after your
plan review: the original report came from a browser script whose `input[type=checkbox].first()`
matched the closed Feedback dialog's consent box (Settings unmounts its children while shut);
the unknown-drawn-as-off gap was found on the way and is what the code fixes.

Check, and fix where needed:
1. `hasValue` (src/web/experimental-store.ts) vs `toggleVariant`/`SWITCH_LOOK`/`PRESS` (src/web/Dock.tsx):
   identical "no value" answer for every reachable state, including the new
   `error && !loaded && !stale → waiting`. Does that Dock change hide a save failure the reader
   should be told about, or break the `aria-pressed`/description rules documented there? Is
   `SWITCH_STATE` (the sentence per variant) still right for that state?
2. SettingsSection.tsx: indeterminate via callback ref, `disabled` now includes `!hasValue`,
   `aria-describedby` → status line `useId`. Any state where the box is mixed and enabled, or
   unmixed while no value exists? Any state where the "Try again" path is now unreachable?
3. HighPowerSwitch.tsx: same for `!loaded`.
4. The tests: were the new ones genuinely red before the fix (reason it through against the old
   code), and are they strong enough? Run: npx vitest run tests/profile-settings.test.tsx
   tests/dock-experimental-switch.test.tsx tests/metadata-high-power-switch.test.tsx
   tests/experimental-store.test.tsx tests/doc-links.test.ts, and npm run typecheck.
5. The docs (experimental-features.md, browser-testing-playwright.md, the plan, the postmortem):
   any claim that does not match the code or the evidence. The postmortem quotes the original
   script; the transcript is
   /home/greg/.claude/projects/-var-tmp-spideryarn-worktrees-fbt858ug-live-default-engine/37fcbbec-0ec6-4997-957f-a8f4db501ff5/subagents/agent-a807023d08f3fca2f.jsonl
   (large; grep it) and the script /tmp/claude-1000/-home-greg-code-spideryarn2/37fcbbec-0ec6-4997-957f-a8f4db501ff5/scratchpad/t2.ts.
   Check whether the first `input[type=checkbox]` on /profile with Settings shut really is the
   Feedback dialog's (src/web/FeedbackDialog.tsx, where it is mounted, src/web/PageSection.tsx).

Report: a numbered list of findings (P1/P2/P3, file:line), for each what you changed or why you
left it, the test results you ran, and a one-line verdict.
