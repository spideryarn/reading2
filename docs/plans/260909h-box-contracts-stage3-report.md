Implemented Stage 3 without committing.

- Added strict, all-or-nothing preview-envelope parsing and split `boxPreview`/`boxConfirm` APIs.
- Confirm requests echo frozen material verbatim, including `excluded`, with no live rows, recipients, PIDs, or top-level speaker.
- Added generation-based stale-response protection.
- Added human-readable kill/broadcast confirmations and collapsed diagnostic detail.
- Threaded fleet rows through the Health tab.
- Turned the historical kill refusal test into a successful end-to-end confirmation test.

Tests:

- Watched all three acceptance tests fail first on missing `boxPreview`.
- Required suite: 8 files, 755 tests passed.
- Typecheck: clean.
- Full `npm test` could not start because local Postgres on port 54362 was unavailable.
- Scoped lint only reported existing issues in the large touched files.

The review resolved the underspecified action classification by passing the catalogue's `{ id, effect }` to `boxPreview`. Preview inputs, expected operations, and material kinds now derive from `effect`; a new broadcast id therefore carries recipients and can produce a confirmation without another client-side id list.

Files I changed:

- `tools/fleet/web/src/actions-client.ts`
- `tools/fleet/web/src/ActionButtons.tsx`
- `tools/fleet/web/src/HealthPanel.tsx`
- `tools/fleet/web/src/App.tsx`
- `tests/fleet-actions-route.test.ts`
- `tests/fleet-box-confirm.test.tsx`
- `tests/fleet-web.test.tsx`
- `tests/fleet-questions-panel.test.tsx`

The plan document also has concurrent modifications from another session; I did not edit it.
