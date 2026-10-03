# GPT Sol on the code for sweep clusters 2 and 3

Write-capable review of `3c6ab877f..de9fbbdb0`, 2026-10-03, for [the plan](261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md). Its fixes landed as the commit after `de9fbbdb0`. Verbatim below.

All five fixes are correct and appropriately scoped. I changed tests and prose only; no runtime change was needed.

| ID | Severity | File and evidence | Outcome |
|---|---|---|---|
| CR-1 | P2 | `tests/authenticated-api-route-contract.test.ts`: catching only literal `%` passed all 400 tests while other invalid escapes returned 500. | Fixed; four additional cases kill it. |
| CR-2 | P2 | `tests/page-contents-reached.test.tsx`: reading every margin from the first section passed because all sections shared one mocked margin. | Fixed; different section margins kill it. Also pinned the deliberate `0px` fallback. |
| CR-3 | P2 | `tests/access-sharing.test.tsx`: mounting the live region only after a result passed. | Fixed; assertions now require the same region before and after each outcome. |
| CR-4 | P3 | `src/routes.ts`: “Every pattern admits `%`” contradicted the live-session patterns. | Fixed to “Slug patterns”. |
| CR-5 | P3 | `src/web/AccessSharing.tsx`: the clipboard object was described as a promise, and announcement claims were too absolute. | Fixed. |
| CR-6 | P3 | Plan: failure was described as appearing on the button; the legacy raw fixture was described as passing through `storedDocumentBytes`. | Fixed both descriptions. |
| CR-7 | P3 | `docs/project/security-map.md:10,25`: five listed untrusted parties are called four, and the signed-in reader is called the fifth party. | Reporting only; outside this stage. |

Mutation results:

| Fix | Mutations | Result |
|---|---|---|
| `part()` | Catch only literal `%` | Survived initially; killed after strengthening |
| Scan | Non-fatal UTF-8; honour stale meta charset | Both killed |
| Spine | Drop heading condition; drop path condition | Both killed |
| Contents | Drop slack; read heading margin; read first section’s margin | First two killed; third survived initially, now killed |
| Copy | Silence missing clipboard; silence rejection; conditionally mount live region | First two killed; third survived initially, now killed |

Every mutation was restored by editing.

The BOM probe confirmed both decoders remove a leading UTF-8 BOM. Exact trimmed title matching is appropriate. Keeping the pre-mounted region polite is reasonable; actual screen-reader announcements were not tested. [W3C guidance](https://www.w3.org/WAI/WCAG22/Techniques/failures/F103) supports setting live-region properties before adding the message. Neither security doc misdescribes the scan’s decoding, so neither needed that correction.

Validation: **502 tests passed across all five files**. The complete typecheck script passed through `node --import tsx scripts/typecheck.ts`; the npm launcher was blocked by sandbox IPC permissions. Full `npm test` was blocked by database/Docker access. Scoped lint reported only five complexity advisories; `git diff --check` passed.

Files changed:

- [routes.ts](../../src/routes.ts)
- [AccessSharing.tsx](../../src/web/AccessSharing.tsx)
- [authenticated-api-route-contract.test.ts](../../tests/authenticated-api-route-contract.test.ts)
- [page-contents-reached.test.tsx](../../tests/page-contents-reached.test.tsx)
- [access-sharing.test.tsx](../../tests/access-sharing.test.tsx)
- [Stage plan](../../docs/plans/261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md)

SHIP