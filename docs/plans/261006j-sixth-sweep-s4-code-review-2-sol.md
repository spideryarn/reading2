**ship**

C1 is closed. Using the unchanged `tests/sanitize-client.test.ts` in a temporary fixture tree:

- Both forbidden imports behind leading comments **pass with the old helper and fail with the candidate**.
- `import ("../sanitize.js")` likewise passes before and fails afterward.
- Separate fixtures confirm each forbidden import is caught; the clean control passes.

No new C3 findings.

Compared old and new edge sets across **1,144 files** in `src/` and `tools/`. These ten files lost edges; every loss was a false positive:

| File | Dropped edge | Classification |
|---|---|---|
| `src/ai-spend.ts` | `./models.js` | Type-only |
| `src/cold-start.ts` | `../api-dist/vercel.js` | Comment |
| `src/cost-categories.ts` | Malformed specifier spanning the metadata comment | Comment |
| `src/jsdom-lazy.ts` | `jsdom` | Comment |
| `src/pdf.ts` | `pdfjs-dist/…` | Comment |
| `src/web/LazyPage.tsx` | `./AdminPage.js` | Comment |
| `tools/fleet/actions.ts` | `./wire.js` | Type-only |
| `tools/fleet/deploys-wiring.ts` | `node:http` | Type position |
| `tools/fleet/health-wiring.ts` | `node:http` | Type position |
| `tools/fleet/web/src/build-stamp.d.ts` | `../../wire.js` | Type position |

**No real runtime edge was dropped; no scanned file was refused.** Focused probes preserved star and namespace re-exports, confirmed removal of type-position `import("…")`, and found edges beyond the old regex’s reach. `require(...)` and `import x = require(...)` remain unreported by both versions—existing limitations. A temporary graph verified `.js` resolution to both `.ts` and `.tsx`.

Refusal fails loudly. Both thrown parse errors and collected recovery errors fail the actual sanitizer test with the offending filename. An invalid transitive dependency makes `graphFrom` throw; it does not return a partial graph. Callers do not suppress these errors.

Validation: **126 tests passed** across the helper, sanitizer, recovery-route, public-imports and public-page suites. **Eight connection-free pgReady cases passed**, including C2’s mocked regression. The registry suite had 12 passes and one sandbox subprocess `EPERM`. The exact requested command was attempted but blocked by database setup; database-dependent pgReady cases remain unverified here.

No repository files changed. Nothing committed.