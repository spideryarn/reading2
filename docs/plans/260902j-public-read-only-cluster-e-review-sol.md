## Findings, ranked

1. **Should-fix — narrow the DTO to `visibility?: "public"`.**  
   [src/types.ts:1335](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/types.ts:1335) documents a stronger invariant than its type enforces. The shelf only represents the positive capability; neither renderer nor any other `LibraryEntry` consumer needs to distinguish private from absent. Keep `describeArticle`’s input as `Visibility` so it can normalize the database value, but make the returned DTO impossible to construct with `"private"`. This follows the house rule and would catch an accidental pass-through at compile time.

2. **Low — one meaningful mutation survives.**  
   [shelf-shared-badge.test.tsx:46](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/shelf-shared-badge.test.tsx:46) imports `SHARING_BADGE`, then [line 133](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/shelf-shared-badge.test.tsx:133) uses that same constant to find the rendered badge. Mutating `SHARING_BADGE` from `"Shared"` to `"Private"` still passes every new test: the test and UI become wrong together. Pin the reader-facing literal `"Shared"` in one assertion. Removing or replacing the globe also survives, though that is less serious.

3. **Low — the parity comment overstates the retained coverage.**  
   Dropping visibility at [store-parity.test.ts:752](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/store-parity.test.ts:752) is correct: equality cannot express a public value that the filesystem cannot know. But “Nothing is lost” is not literally true; that comparison no longer catches Postgres emitting `"private"` or losing `"public"`. The deterministic Postgres projection test at [store-shelf-pg.test.ts:421](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/store-shelf-pg.test.ts:421) replaces the useful coverage. I would say that explicitly rather than complicating parity with database-side visibility lookups.

## Cleared

- Absence is semantically sound for this shelf: filesystem articles cannot be shared in filesystem mode, and the product asks only the positive question “which are shared?”
- The cast at [pg.ts:1998](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/pg.ts:1998) is honest, backed by `NOT NULL` and the CHECK at [schema.ts:282](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/db/schema.ts:282). A cheap cleanup is `text("visibility").$type<Visibility>()`, centralizing the assertion and removing all three downstream casts; not required for correctness.
- Card layout wraps safely. The table badge is first inside the truncating sub-line, so long bylines lose space before the badge does.
- PATCH responses preserve visibility because [pg-shelf.ts:131](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/store/pg-shelf.ts:131) rebuilds them through `listArticles`.
- No `Required<LibraryEntry>`, exhaustive-key serializer, or other whole-entry consumer is disturbed.
- Not running `store-parity` matters little here: its new behavior deliberately excludes this field, while TypeScript checked the edit and the dedicated Postgres test exercises the projection.
- [library.md:518](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/docs/project/library.md:518) accurately describes the implementation.

**Verdict: landed-and-fine, with `visibility?: "public"` and a literal-label mutation assertion as the changes I want.**