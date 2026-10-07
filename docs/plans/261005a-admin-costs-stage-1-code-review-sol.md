Reviewed and fixed the established P1 defects. No unfixed P0/P1 findings remain.

### Findings

- **F1 — P1 — established — fixed.** A slug-only article owned by the administrator used its literal slug in the address-bar/filter key. The failing test confirmed this. Article identity now always uses an opaque keyed hash; the slug is display text only. [cost-cube.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/cost-cube.ts:150)

- **F2 — P1 — established — fixed.** Another owner’s pseudonym was the first 40 bits of unsalted MD5 over a known owner ID and a title-derived slug, allowing cheap dictionary checks and carrying collision risk. It is now a full HMAC-SHA256 keyed server-side. The secret never enters SQL, SQL errors, the response, or logs. [ai-calls-spend-pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/store/ai-calls-spend-pg.ts:350)

- **F3 — P1 — established — fixed.** A null upstream and an upstream literally named `(not recorded)` shared one key, merging their figures. A red test demonstrated this; nullable upstream keys are now structurally disjoint. [cost-cube.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/cost-cube.ts:232)

- **F4 — P2 — established — fixed.** Mutation exposed two test holes:
  
  - Removing the `settledCalls` fold left all 26 pure tests green.
  - Zeroing every pivot cell’s `unpricedCalls` also left all 26 green.
  
  New assertions cover every additive `CubeTotals` field across cells, rows, columns and grand totals. Both mutations then failed. [cost-cube.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/tests/cost-cube.test.ts:106)

- **F5 — P2 — established — reporting.** Auth account-list failure still fails the entire endpoint because cube and account reads share `Promise.all`. Silently substituting null emails would falsely mean “account absent”, so a proper fallback needs an explicit availability field. [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/routes.ts:8374)

- **F6 — P2 — reasoned — reporting.** No existing index leads on `started_at`, while this cross-owner query filters only by time. The `(owner_id, started_at)` and `(scope_kind, started_at)` indexes cannot provide an ordinary range scan without predicates on their leading columns. A sequential scan is harmless at 2,245 rows but will become the scaling limit. [schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/db/schema.ts:3453)

- **F7 — P2 — established — reporting.** `category` remains `string` on the wire. Fixing it honestly requires moving the category union into a browser-safe leaf; importing even its type from `cost-categories.ts` violates the client-import boundary. [cost-cube.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/cost-cube.ts:74)

- **F8 — P2 — established — reporting.** Renamed articles have one article key and their totals merge exactly, now explicitly tested. SQL can nevertheless emit two visibly identical cube rows because it groups by historical slug while suppressing that slug for other owners. For the administrator’s own renamed article, `groupRows` chooses whichever historical slug arrives first as the label; SQL supplies no ordering. Current totals are correct, but the label is not guaranteed to be current. [cost-cube.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/cost-cube.ts:367)

- **F9 — P2 — reasoned — reporting.** `.mapWith(Number)` correctly prevents string concatenation, but does not preserve integer precision beyond `Number.MAX_SAFE_INTEGER`, about $9 million in nano-dollars. Current measured totals are nowhere near this.

- **F10 — P3 — established — reporting.** The audit’s finding 9 proposes adding normalized token totals “used by the cost cube”, while the plan and cube deliberately exclude token totals because wire meanings differ. That proposed destination is plainly inconsistent; the later audit review should correct it.

### Security and SQL conclusions

The route is behind the existing namespace gate; the non-admin test returns 403 before either store. Successful responses are `private, no-store`. Invalid, non-UTC, empty, rollover, and reversed bounds are rejected before querying. No bounds deliberately means the whole ledger, bounded by the 20,000-group refusal.

The query’s UTC day expression is correct. It groups by the underlying columns used by both `CASE` expressions, avoiding parameter-expression mismatches and accidental slug merging. The `limit(max + 1)` distinguishes exact-cap from over-cap without truncating silently. Nullable dimensions match the schema, and all aggregate numerics use runtime conversion.

No other owner’s slug, title, URL or prose reaches the response. The query reads no title/prose table; other owners receive opaque article IDs or keyed pseudonyms. `owners` contains only IDs and Auth emails, intentionally. Error messages are fixed prose and neither slug nor HMAC key is logged.

The three inventory edits are minimal and honest:

- browser-safe shared module allowlist;
- one exact authenticated GET route and count increments;
- one private-Postgres lane plus its two seeded owners.

### Verification

- Requested pure/route suites: **2 files, 33 tests passed**
- Inventory suites: **2 files, 431 tests passed**
- Concurrent page/chart compatibility: **2 files, 20 tests passed**
- Typecheck: all four projects passed; all 3,062 source files covered
- Targeted lint: no errors; four pre-existing complexity advisories in unrelated parts of `routes.ts`
- Postgres suite not run, as requested

`npm run typecheck` itself hit the sandbox’s `tsx` IPC `EPERM`; running the same checked script directly with Node passed.

### Files changed

- `src/cost-cube.ts`
- `src/store/ai-calls-spend-pg.ts`
- `src/routes.ts`
- `tests/cost-cube.test.ts`
- `tests/admin-costs-route.test.ts`
- `tests/admin-costs-store.test.ts`

**VERDICT: approve**