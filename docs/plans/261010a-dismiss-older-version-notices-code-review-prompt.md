Code review, with permission to fix, of the uncommitted work in this worktree (cwd is the repo root).

The plan is docs/plans/261010a-dismiss-older-version-notices.md. Its last section, "After GPT Sol's plan review", is your own plan review being applied, and it overrides the sections above it. The diff of tracked files is in docs/plans/261010a-scratch.diff. The new files are drizzle/20261009232712_stale_notice_dismissals.sql, src/stale-notice.ts, src/store/pg-stale-notices.ts, src/web/StaleNotice.tsx, src/web/useStaleNotices.ts, and tests/stale-notice*.test.* plus tests/stale-notices-*.test.*.

What it does: every "older version of the article" banner (all modes except Quiz) gets an × that dismisses it until the artefact is regenerated. The dismissal is stored per (article, mode) in a new table, and a shared client cache reads and writes it.

Please check, and FIX inside this change whatever you find:
- Correctness of each panel's identity key. It must change when the artefact is regenerated, and stay the same across reads otherwise. That includes Search's `<runId>@<finishedAt>` and the Sketch/Illustrated hashed identity.
- The race handling in useStaleNotices.ts: a stale GET after a dismiss, concurrent dismisses, a slug change, sign-out/epoch, and a failed POST.
- **One known UX choice to change**: the builder fetches dismissals only once something is stale, and shows the banner while that read is out, so an already-dismissed banner flashes for a round trip. Make the banner wait until the dismissals for that slug are known, or the read has failed (then show it). Add a test.
- Wherever a panel hid its foot or job progress while stale, the gate must now read "banner showing", so a dismissed banner never hides a running or failed job or its Stop.
- Route: owner-only (a stranger's slug is a 404), validation, and bounded storage. Server-side checks must match the DB check constraint.
- Export coverage and registries.
- Anything a reader would see wrong at 390px width.

Then run `npm run typecheck` and the touched tests (`npx vitest run tests/stale-notice* tests/stale-notices-* tests/mode-surface-changes-no-markup.test.tsx tests/skim-panel.test.tsx tests/close-cross.test.ts tests/authenticated-api-route-contract.test.ts`). Do not commit, push, or touch any remote database.

Write your findings numbered, each with a severity (P1/P2/P3), file:line, and what you changed or why you didn't. End with a one-line verdict: "land", "land with fixes" (made), or "do not land".
