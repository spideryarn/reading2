You are reviewing a plan, read-only, in the Spideryarn repo (this worktree). Read the plan at
docs/plans/261020c-admin-users-engagement-active-days-reading-time-failed-imports-fewer-default-columns.md,
then the code it touches: src/store/pg-admin.ts (mergeUsers, adminQueries, listUsersAcrossOwners),
src/admin.ts (AdminUser), src/web/admin-columns.tsx, src/web/AdminPage.tsx, src/web/lib/DataTable.tsx
(ColumnsMenu, startsHidden, useSortedTable visibility), src/web/shelf-hidden-columns.ts and its callers,
src/db/schema.ts (ai_calls, ingest_events, comments, reader_arrivals, articles, reading_time, import_records),
src/store/ai-calls-spend-pg.ts (productSpendByOwner's scope predicate), src/mcp/tools.ts (trimUser/userActivity),
docs/project/admin.md (the rule about what admin pages may show), docs/project/privacy.md and
src/web/PrivacyPage.tsx (what we promise about reading time and admin access), docs/project/reading-time.md,
docs/project/tooltips.md.

Look for: wrong assumptions about the data (which timestamps exist, which predicates match the rest of the
file, whether any of the activity sources include rows the reader did not cause — e.g. admin- or script-made
calls, background jobs, the site account), privacy or admin-boundary problems (does anything here expose
more than /privacy and admin.md permit), the UTC-day / last-30-days arithmetic, query cost on production-sized
ai_calls, the hidden-columns refactor keeping the shelf's stored keys and behaviour exactly, accessibility of a
rich card on a count cell, simpler designs I passed over, and anything that would silently succeed while doing
nothing. Give numbered findings with severity (P0-P3), each with the concrete fix. Be concise.
