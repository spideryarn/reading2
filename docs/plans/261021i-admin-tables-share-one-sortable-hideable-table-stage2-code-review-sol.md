Found and fixed two Stage 2 defects. No unfixed code findings.

- D1 — P1 — [AdminVouchersPage.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/src/web/AdminVouchersPage.tsx:1118): hiding Articles left claimed-voucher edits with no focus target. Fixed by focusing the always-visible name field. Red-first test: [admin-vouchers-page.test.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/tests/admin-vouchers-page.test.tsx:1851).

- D2 — P1 — [admin-vouchers-columns.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/src/web/admin-vouchers-columns.tsx:147): the non-sortable Usage header lost the old table’s muted colour. Fixed with an explicit header voice. Red-first test at [admin-vouchers-page.test.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/tests/admin-vouchers-page.test.tsx:1743).

- D3 — P2 — tests did not fully protect refresh/tab identity, refusal ownership, cross-cell forms, `?gift=` coexistence, Created ordering, Usage’s unsortability, or the extracted default-row dress. Fixed with mutation-proven coverage in [admin-vouchers-page.test.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/tests/admin-vouchers-page.test.tsx:1721) and [data-table-pin-first.test.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/tests/data-table-pin-first.test.tsx:127).

Confirmed:

- Voucher identity remains keyed by ID through sorting, hiding, refresh additions/removals, and tab switches.
- Every visible editor control remains attached to its row’s form.
- Column definitions and drawers are compile-time exhaustive.
- Default `DataTable` row attributes/classes match the parent behavior.
- Status, missing-note, Created, Usage, and URL semantics are correct. Claimed-first on the first Status click is intentional and consistent with its rank and hint.
- `admin.md` and `web-client.md` remain accurate.

Verification:

- Requested suites: 7 files, 259 tests passed.
- Typecheck passed using the requested fallback; the npm wrapper hit sandbox `EPERM`.
- Scoped lint: no new findings; one pre-existing complexity advisory.
- Full `npm test` could not start because the sandbox cannot reach the local private Postgres lane.
- No commit made; pre-existing untracked review files were preserved.

VERDICT: APPROVE WITH CHANGES