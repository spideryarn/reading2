You are reviewing a plan (and, because the fix is small and was drafted test-first, its draft
diff) in the Spideryarn repo, worktree /var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox.
Read-only: do not edit files.

Read:
- docs/plans/261030a-experimental-checkbox-unknown-is-not-off.md (the plan)
- docs/postmortems/261030a-a-second-control-on-one-store-drew-the-placeholder-as-the-answer.md (the diagnosis)
- the uncommitted diff: `git diff HEAD` plus the two new files above
- src/web/experimental-store.ts, src/web/SettingsSection.tsx, src/web/Dock.tsx (§ toggleVariant,
  PRESS, DockExperimentalSwitch, SWITCH_LOOK), src/web/HighPowerSwitch.tsx, src/web/Metadata.tsx
  (where HighPowerSwitch is mounted), docs/project/experimental-features.md

The bug report: a browser agent said /profile's Experimental checkbox "reads false even when
Experimental is on". The diagnosis claims there is one source of truth, and that the agent read
the box before GET /api/reader answered, when it drew the store's placeholder `on:false` as an
unchecked (disabled) box.

Questions, answer each:
1. Is the diagnosis right? Look hard for a real second source of truth or a stale read I missed
   (e.g. a path where the store is `loaded` but `on` is wrong; the offline cache in
   src/web/lib/api.ts; session changes; Supabase INITIAL_SESSION timing; the collapsed Section on
   /profile). If you find a plausible real mismatch, say exactly how to reproduce it.
2. Is `hasValue`'s precedence exactly equivalent to Dock's SWITCH_LOOK `is-unknown` for every
   reachable state? Is setting `indeterminate` through a callback ref correct with React 19
   (re-runs on every render? any case it is left stale, e.g. when the element is reused)?
3. Is `indeterminate` + `aria-describedby` the right accessible pattern here, vs hiding the box
   until known? Any screen-reader or keyboard regression (e.g. a click on an indeterminate box
   that is enabled — can a box be indeterminate and enabled in any state)?
4. HighPowerSwitch: is `!loaded` the right condition, and does the change break anything there?
5. Anything wrong or overclaimed in the docs/postmortem wording versus the code.

Give findings as a numbered list with severity (P1 blocker / P2 should fix / P3 nit), file:line,
and a suggested fix. End with a one-line verdict: approve / approve with fixes / reject.
