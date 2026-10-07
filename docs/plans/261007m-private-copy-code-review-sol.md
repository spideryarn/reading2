# Private-copy code review — Sol

Up: [plan 261007m](261007m-a-private-copy-of-a-public-article-on-your-own-shelf.md)

Write-capable review, 2026-10-07. No commit made.

## Findings and fixes

1. **P2 — the visitor network contract never exercised the new shelf request.**
   [public-network-trace.test.tsx:2777](../../tests/public-network-trace.test.tsx#L2777)
   used a public payload with no source URL. The unchanged comparison therefore passed
   without ever reaching the private-copy lookup. Giving that fixture a URL first made
   all three parity cases red on the additional `GET /api/library`. The tests now require
   exactly one shelf GET for an eligible signed-in visitor, zero for a signed-out visitor,
   and otherwise the existing request parity. The shelf response is a real empty shelf
   rather than malformed `{}`; the SDK mock also carries the current reader identity.
   Added real-App checks for no shelf request on the owner's page, the next reader's
   own-copy link after an account change, and an ordinary Link click starting exactly one
   add POST without a reload. The navigation test checks the request body and free-repeat
   outcome, not merely the href.

2. **P3 — a mounted shelf hook did not reload after a reader change at the same URL.**
   [link-facts.ts:436](../../src/web/link-facts.ts#L436)
   subscribed to invalidation but loaded only when its URL changed. The new mounted test
   was seen red (`unknown` instead of `next-readers-copy`). A shelf generation now restarts
   that effect after the reader-change fence clears the cache; it then passed. Current
   `ArticlePage` composition already unmounts the visitor during an account change, so
   this was a hook robustness defect, not demonstrated cross-reader exposure. Independent
   root-cause review confirmed that distinction. The existing late-response fence remains.
   [Postmortem](../postmortems/261007s-invalidating-a-cache-does-not-restart-its-mounted-readers.md).

## Prior review

F1 is addressed by conditional pricing when shelf ownership is unknown. F2 is addressed
by the explicitly narrowed promise: cached active matches link directly; archived or
unknown copies go through the free server repeat path. F3 is addressed by the offer in
`VisitorBand`, including when a covering band hides the masthead notice. Eligibility
excludes signed-out and unconfirmed sessions, private links and missing published URLs.
No additional production correctness defect found in the component wiring or hook rules.

## Verification

- Nine focused suites passed, 222 tests, covering private-copy offers, network traces,
  add visits and reader changes, link facts, notice wiring and mode surfaces.
- Full network-trace rerun passed all 97 tests, including client navigation and account
  changes. Documentation-link checks passed all 18 tests. The account-switch check also
  explicitly synchronizes SDK and UI identity before render, matching production's
  invalidation-before-notification ordering.
- All four TypeScript projects passed, with all 3463 source files covered, using
  `node --import tsx scripts/typecheck.ts`. The npm wrapper itself was denied permission
  to create its `tsx` IPC socket; this invokes the same checking script directly.
- Scoped Biome check: no errors. The original touched files have baseline warnings and
  complexity notes; the three files changed in this review have one existing complexity
  note. `git diff HEAD --check` passed.
- Full `npm test` attempted and blocked before collection: Docker/Postgres unavailable
  in this sandbox. This is not a full-suite green result.

## Wider limits, unchanged

The shared shelf cache does not automatically observe additions/deletions in another tab,
and an initial failed read suppresses retries for that reader's session. Reload or an
explicit `refreshShelf` resolves those states. This review did not introduce a new refresh
policy. Archived matches still use the add page's free repeat route, as the revised plan
allows. No production data or deployment was touched.

ready with changes
