You are reviewing a plan, read-only, in the Spideryarn repo (this worktree). Read the plan at
docs/plans/261019k-admin-vouchers-links-each-account-to-admin-users-with-a-usage-card.md, then the code it
touches: src/web/AdminVouchersPage.tsx (VoucherRow, status, usage), src/admin-vouchers.ts (AdminVoucherRow),
src/web/AdminPage.tsx (AdminUsersPage), src/web/lib/DataTable.tsx, src/web/admin-columns.tsx, src/admin.ts
(AdminUser), src/web/useAdminUsers.ts, src/web/Tooltip.tsx, src/web/TipCard.tsx, docs/project/tooltips.md,
docs/project/admin.md (the rule about what admin pages may show).

Look for: wrong assumptions about the data (e.g. claimedBy vs claimantEmail, address matching and
normalisation, revoked rows), privacy or admin-boundary problems, accessibility of a link with a rich card,
URL-state and nuqs pitfalls (render loops, see docs/postmortems/260827e-shelf-render-loop.md), the
scroll-into-view effect, simpler designs I passed over, and anything that would silently succeed while doing
nothing. Give numbered findings with severity (P0-P3), each with the concrete fix. Be concise.
