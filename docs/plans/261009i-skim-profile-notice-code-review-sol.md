1. **P2 — FIXED:** An older in-flight GET could undo the optimistic hide. Failed POSTs also restored the banner before reconciliation, and completions from a previous slug could trigger stale updates. Dismissals now use route/slug-scoped attempt identities, preserve the optimistic state until a post-write read answers, and discard stale navigation or replacement-route results. Evidence: [useSkim.ts](/var/tmp/spideryarn-worktrees/fbud2w92-dismiss-profile-notice/src/web/useSkim.ts:170), [hook tests](/var/tmp/spideryarn-worktrees/fbud2w92-dismiss-profile-notice/tests/use-skim-profile-notice-dismissal.test.tsx:175).

2. **P2 — FIXED:** The reader download exported the new columns through whole-row serialization, but the rollback exporter’s hand-written `shelf.json` projection silently dropped them. Both dismissal fields are now exported, with a regression test covering dismissal-only shelf state. Evidence: [export.ts](/var/tmp/spideryarn-worktrees/fbud2w92-dismiss-profile-notice/src/store/export.ts:489), [store-roundtrip.test.ts](/var/tmp/spideryarn-worktrees/fbud2w92-dismiss-profile-notice/tests/store-roundtrip.test.ts:600), [export-bundle.ts](/var/tmp/spideryarn-worktrees/fbud2w92-dismiss-profile-notice/src/store/export-bundle.ts:381).

3. **P3 — FIXED:** Tests did not directly pin `profileNoticeKey`’s no-profile sentinel or its route/profile identity. Added coverage alongside the existing null-transition freshness cases. Evidence: [skim.test.ts](/var/tmp/spideryarn-worktrees/fbud2w92-dismiss-profile-notice/tests/skim.test.ts:882).

The server path otherwise checks out: both read and write are owner-scoped, the SQL update conditionally matches the current route, and GET removes the stored key before replying. The banner priority, foot gate, Tooltip, accessible label, and shared `.close-x` convention are correct.

Verification:

- 692 targeted unit tests passed across five files.
- Typecheck passed via `node --import tsx scripts/typecheck.ts`.
- `npm run typecheck` itself was blocked by sandbox denial creating tsx’s `/tmp` IPC socket.
- The two Postgres-backed suites could not run because local Postgres was unavailable (`connect EPERM 127.0.0.1:54362`).

LAND WITH FIXES