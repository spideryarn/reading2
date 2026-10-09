You are reviewing built code in the Spideryarn repo (this checkout, a git worktree). You may edit
files to fix what you find, inside this change's scope; report anything wider instead of fixing it.
Do not commit, do not run git commands that discard work, and never touch .env.local, infra/ or a
remote database.

The change: commit HEAD, "261009i: Skim's profile-changed notice can be dismissed". The plan is
docs/plans/261009i-skim-profile-notice-can-be-dismissed.md (revised after your plan review,
docs/plans/261009i-skim-profile-notice-plan-review-sol.md). The scoped diff is
docs/plans/261009i-skim-profile-notice-code-review.diff (`git diff origin/dev...HEAD`, without the
drizzle snapshot).

Read AGENTS.md first for house rules. Then check, concretely:

- Correctness of the key rule and its null cases (src/skim.ts `profileNoticeKey`, the GET and POST
  in src/routes.ts, src/store/pg-skim-notice.ts's conditional update).
- Ownership and security: is the POST owner-only on every path; can it write for a route the
  reader did not see; does any reply leak the stored key (docs/project/security-map.md).
- The client (src/web/useSkim.ts `dismissProfileNotice`; src/web/SkimPanel.tsx `RouteBanner`,
  `bannerReason`, the foot gate): the optimistic hide, failure reconciliation, races with an
  in-flight read, the slug-keyed failure, accessibility of the × (close.css / `.close-x`
  conventions, docs/project/controls.md), Tooltip use.
- Tests: tests/skim-profile-notice-route.test.ts and the tests/skim-panel.test.tsx additions — do
  they bite, and what is missing? Is a useSkim-level test of the failure path worth adding?
- Any registry, export or doc the change should have touched and did not (docs/project/sql.md and
  database.md conventions; export of `articles` columns, src/store/export.ts and export-bundle.ts;
  docs/project/skim.md).

Run what you need: `npm run typecheck`, and the touched suites with `npx vitest run <files>`. The
box is shared: do not run the full suite. If you change code, re-run them.

Answer with numbered findings, each with severity (P1/P2/P3), evidence (file:line), and whether you
FIXED it (and how) or are REPORTING it. End with one line: LAND, LAND WITH FIXES, or DO NOT LAND.
