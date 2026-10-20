No P0 or P1 findings. The transaction, throttle, migration, aggregate, and ownership handling look correct.

### P2 — fixed

The privacy bullet said the open record kept the time “but not which article.” The durable table does omit article identity, but ordinary request logs include the slug in `/api/library/:slug/open` ([routes.ts](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/routes.ts:11322), [routes.ts](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/routes.ts:9355)).

Fixes made:

- Corrected the disclosure to distinguish the durable record from the roughly one-day request log ([PrivacyPage.tsx](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/web/PrivacyPage.tsx:236)).
- Updated the privacy documentation and plan to match.
- Strengthened the privacy test; watched it fail before the wording change, then pass ([privacy-page.test.ts](/var/tmp/spideryarn-worktrees/active-days-article-opens/tests/privacy-page.test.ts:214)).

### Review conclusions

- `recordOpen` reads the owner once, checks ownership and 404s before insertion, and performs both writes atomically ([pg-shelf.ts](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/store/pg-shelf.ts:430)).
- The composite primary key plus `on conflict do nothing` is race-safe.
- The UTC-midnight origin and 30-minute divisor ensure no slot crosses a UTC day.
- `sql.raw` is injection-safe here because its entire value is the compile-time constant `OPEN_SLOT`; no request or model input reaches it.
- The migration is purely additive. Its hand-written cascading owner FK matches the other account-owned history/cache tables ([migration](/var/tmp/spideryarn-worktrees/active-days-article-opens/drizzle/20261020164021_article_open_times.sql:1)).
- No explicit app-role grant is needed: migrations are applied as `postgres`, whose schema default privileges grant the app role DML on new tables.
- The fifth union branch has compatible columns; the first branch establishes `owner`/`at`, and the outer query still excludes the site account ([pg-admin.ts](/var/tmp/spideryarn-worktrees/active-days-article-opens/src/store/pg-admin.ts:828)).
- The admin and MCP surfaces expose only activity counts and dates, never article identity.
- Per-article exports and transfers correctly ignore this account-scoped table; account deletion removes it through the FK cascade.

The positive tests would fail without the feature. The 404/no-row assertion would also pass against the old implementation, but appropriately guards against inserting before ownership is established.

Validation passed:

- 71 focused unit tests
- Full typecheck
- Migration-chain check
- Biome lint on all changed TypeScript files
- `git diff --check`

The database-backed suites could not run because this sandbox was denied access to local Postgres at `127.0.0.1:54362`; that was an environment failure, not a test failure. No wider decisions remain.