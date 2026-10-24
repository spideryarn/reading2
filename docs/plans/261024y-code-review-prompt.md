# Code review: 261024y — a second press on a page already on the shelf opens it

Review commit ef7185d81 (`git show ef7185d81`) against its plan,
docs/plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md, and your own plan
review docs/plans/261024y-plan-review-sol.md (were F1-F4 actually met?).

You may fix what you find, inside this change's files, and run the gates
(`npm run typecheck`; `npx vitest run tests/extension-handoff.test.ts tests/save-page-bookmarklet.test.ts tests/saved-from-url-pg.test.ts tests/add-from-extension-already-have.test.tsx tests/authenticated-api-route-contract.test.ts tests/view-as-gate.test.ts`).
Do not commit, push, or touch git state. Report anything wider than this change for me to decide.

Look especially at:
- src/web/AddFromExtension.tsx: the once-guard (`asked`, `spendAsk`, `releaseAsk`), Strict Mode,
  the new `unchecked` state and Try again (does resetting `started` and bumping `attempt` re-run
  safely, and can it ever upload twice or take twice?), ONE_UPLOAD_AT_A_TIME interplay, and the
  `have` path's `stillFor` checks.
- The route in src/routes.ts (search `/api/library/by-url`): owner scope, input validation, status
  codes, anything a stranger could learn.
- extension/src/handoff.ts + src/web/save-page-bookmarklet.ts: the new `savedFrom` field, old stored
  entries without it, and that `capturePage` remains self-contained (it is stringified into the
  bookmarklet and run by executeScript).
- docs/project/security-map.md: does this touch a defence?
- Whether the tests could pass while the feature is broken (silent success).

Write findings first, numbered, each with severity, file:line, what you changed (if anything), and
end with a verdict: SHIP, SHIP AFTER FIXES (MADE), or REWORK.
