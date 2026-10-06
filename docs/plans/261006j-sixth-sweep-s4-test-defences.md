# Sixth sweep, cluster S4: tests that wait on a clock, or carry guards a type could delete

One cluster of the [sixth codebase sweep](261006j-sixth-codebase-sweep-umbrella.md) (§ S4, and U2,
U5 and U6 of § "What the review changed"). It is about the test suite's own defences: guards for a
state that cannot happen, waits that are a count instead of a deadline, skips that should be
failures, and import checks done with a regex. Nothing a reader sees changes. One source file
changes: `tools/fleet/child.ts`, by one optional parameter.

Built on 2026-10-06 in five stages, one commit each.

## What landed

### 1. `pgReady` promises a pool when asked to keep one

`tests/helpers/pg-ready.ts` returned `pool?: Pool` whatever it was asked. It now has two public
overloads: `keepPool: true` returns `{ pool: Pool }` (`PgReadyWithPool`); anything else returns
`{ pool?: Pool }` as before. The implementation is unchanged.

`tests/pg-ready.test.ts` carries the compile-time cases as `// @ts-expect-error` lines: `true`,
omitted, a plain `boolean`, and `false`. Shown able to fail: widening the first overload to
`keepPool: boolean` gives two TS2578 errors.

Guards removed, in the 25 suites that bind `const { pool } = await pgReady({ … keepPool: true })` at
module scope (27 files call it that way; two had no guard of the forms below, only `if (pool) {`).
None of them shadows the name `pool`, checked by grep before the edit.

| form | removed |
|---|---|
| `if (!pool) return …;` / `if (!pool) throw …;` | 124 lines |
| `if (!pool \|\| x)` | 2 |
| `describe.skipIf(!pool)` | 4 (three in `reader-arrivals`, one in `billing-upgrade-notice`) |
| `pool?.` | 21 |
| `pool!` | 26 |
| `if (pool) { … }` unwrapped | 5 |
| `if (!pool) { return nulls }` block | 1 |

183 in all. Pools that did not come from the helper (`tests/store-transaction-isolation.test.ts`
and the rest) are untouched. None of the five files cluster S1 holds had such a guard.

### 2. Two tests that waited on a clock

**`tests/admin-only-routes.test.tsx`** waited fifty turns of `setTimeout(1)` for a lazy page, about
50 ms. It now waits on the heading's text, bounded by a 5 s deadline. Each turn is still its own
short `act`, because React holds the lazy page's commit until the `act` it was scheduled in closes;
one long `act` (or a `vi.waitFor` inside one) would wait for itself. With the deadline set to 0 the
recorded failure reproduces: `/admin/vouchers: expected '' to be 'Gift vouchers'`.

**`tests/fleet-child.test.ts`** spied on the global `process.kill`. The nominated cause was wrong;
the real one was reproduced in a two-test scratch file:

- the *real* children at the top of the file are process-group leaders, so when one exits
  `probeOwner` sends SIGTERM to its group and arms a SIGKILL sweep one grace later;
- that sweep is a real, unref'd timer that `finish` does not clear;
- a later case installs a global spy and hears the call as its own. The scratch test recorded
  `[[-1837480, "SIGKILL"]]` on a spy that had done nothing.

That matches both recorded failures ("expected kill to not be called at all, but 1 times", and a
first call that was not the expected one). The fix is the one-parameter seam: `probeOwner` takes
`kill` beside `spawn` and `readProcStat`, defaulting to `process.kill`, and the nine cases pass a
`vi.fn` of their own.

One more in the same file, found while reading it: "does not let an old child's later close remove
its replacement" used the default `readProcStat`, so it read the real `/proc` for a made-up pid
(41101). Had that pid been a live group leader, the test would have signalled somebody else's
process group for real. It injects a stat now, as its siblings do.

`tests/fetch.test.ts`'s 400 ms budget is not changed (U6).

### 3. Skips that should be failures

Checked first: `scripts/check.ts` builds before its test step, `scripts/deploy.ts` builds before
its test gate, and the readiness runner is created through setup, which builds. So a missing build
is a step somebody left out.

- `tests/no-secrets-in-bundle.test.ts`: both bundle cases skipped without `dist/`. They fail now,
  naming `npm run build`. The stale-bundle case is still only a warning.
- `tests/cold-start-lazy-imports.test.ts` and `tests/pdf-bundle-trace.test.ts`: each had a separate
  "has a build to inspect" case beside an `it.skipIf(!built)`. Folded into one case each that
  asserts the bundle first.

Watched red with `dist/` and `api-dist/` moved aside: 4 failed, each naming the command.

- `tests/migration-reconciliations.test.ts` gated its live half on
  `URL_ && isLocalDatabaseUrl(URL_) ? describe : describe.skip`. With a remote `DATABASE_URL` it
  printed "9 passed | 21 skipped". It now throws at module scope: for a non-local address before
  anything connects (watched: "refuses to run", no tests), and through `pgReady` for an unset or
  unreachable database. The local-only protection is kept, and now covers the probe too.
- `REQUIRE_POSTGRES`: no code reads it. Fourteen test and setup files and
  `infra/hetzner/README.md` described it as live, or said the suite "skips loudly" with no
  database. They say what happens now. The dead `vi.stubEnv("REQUIRE_POSTGRES", "")` in
  `tests/pg-ready.test.ts` is gone.

### 4. Two import checks moved to the shared reader

- `tests/sanitize-client.test.ts` wanted the word `from`, so `await import("../sanitize.js")` and a
  bare `import "jsdom"` passed. Watched: a temporary client file with both got 0 hits from the old
  patterns and fails the new test.
- `tests/fleet-recovery-resume-route.test.ts` wanted double quotes and a semicolon. Watched: a
  single-quoted fifth import in the route passed the old test and fails the new one. The expected
  list is now the four run-time imports the test's title names; the two `import type` lines erase.

### 5. The six `noUnsafeOptionalChaining` hits

`(x?.y as T).z` becomes `(x?.y as T | undefined)?.z` in `tests/blocks-baseline.test.ts` (2),
`tests/collect-pdf-figures.test.ts` (1) and `tests/fleet-composer-envelopes.test.tsx` (3).
`npx biome lint tests` reports none of that rule.

## Claims that turned out false

- **"`tests/fleet-child.test.ts`: a leaked timer from one fake child."** It is a real child's
  timer; see above. A fake child's timers are fake and are thrown away by `vi.useRealTimers()`.
- **"`worktrees.md` says these fail loudly; the code skips."** True of `no-secrets-in-bundle` only.
  The other two already failed loudly through a second case, so `worktrees.md` was already true
  and is not edited.
- **"`runtimeImportsOf` is the AST helper."** It was not (it is since the review, below). It was a
  regex reader too, a better one: both quote
  styles, multi-line clauses, side-effect and dynamic imports, type-only imports skipped. Only its
  refusal of a non-literal dynamic import parses.
- **"`sanitize-client`'s own comment says an AST check would be the real thing."** That comment is
  about a different check in the file (the `article:` doorway pattern), which is left alone.
- **"8 test files" describe `REQUIRE_POSTGRES` as live.** Fourteen, plus the README.
- **"179 guards"**: 183 by the forms counted here, all on helper pools.

## Left, and why

- **`tests/overseer-launch-protocol.test.ts`'s four regexes.** Not moved. Its scan covers
  `scripts/` and `evals/`, where `runtimeImportsOf` refuses seven files with a non-literal dynamic
  import, so using it needs an allowlist the cluster may not add. It also needs type-only
  importers, which the reader drops. **A real hole remains and is not fixed here:** `IMPORTS_LAUNCH`
  and `IMPORT_STATEMENTS` want the word `from`, so a production file that reached the protocol with
  `await import("./launch-protocol.js")` would pass.
- **`tests/stop-details.test.ts`.** Its regex removes import statements from a text so that
  mentions of a name can be counted; it does not read specifiers, so the reader does not answer it.
- **`tests/one-store-only.test.ts`** (cluster S1's file) has a comment saying
  `migration-reconciliations` gates on `isLocalDatabaseUrl` with a `describe.skip` and that this
  "survives on purpose". That is now out of date: it refuses instead of skipping.
- **`tests/store-migration-registry.ts`** (S1's) mentions `REQUIRE_POSTGRES` twice.
  `scripts/check.ts` mentions it once, as history.
- **`tests/db-test-create.test.ts`** still skips unless `SPIDERYARN_TEST_DB_FACTORY=1`. That is an
  opt-in for a file that creates databases, not a database probe; only its stale comment changed.
- **The real children's SIGKILL sweep still fires after their test ends**, through the real
  `process.kill`, at a group that is gone. It is harmless (`ESRCH`, caught) and it is production
  behaviour; no test hears it any more.

## Review, round one

[GPT Sol's code review](261006j-sixth-sweep-s4-code-review-sol.md)
([prompt](261006j-sixth-sweep-s4-code-review-prompt.md)), verdict **do not ship**, on one finding.
Both findings accepted.

- **C1 (P2): moving `sanitize-client` onto `runtimeImportsOf` weakened it.** The reader lost an
  import that follows a comment on the same line (`/* parser */ import { JSDOM } from "jsdom";`),
  which the old pattern caught, and missed `import ("x")` with a space before the parenthesis. The
  hole was in the shared reader, so every caller had it. Fixed there, red first:
  `tests/import-graph-helper.test.ts` is new, 19 cases, and **9 were red** against the regex
  reader: an import after a block comment or after another statement on the same line; a
  side-effect import after a comment; `import (` with a space or a newline; a template-literal
  specifier with no holes; a `.tsx` file whose JSX attribute contains the text of an import; the
  text of an import inside a comment; inside a string; and a file that does not parse.
  `runtimeImportsOf` now parses with `tests/helpers/ts-ast.ts` (already a dev dependency) and walks
  import, export-from and dynamic-import nodes. A file that cannot be parsed is refused, like a
  dynamic import that cannot be named. All seven callers pass (192 tests). The `sanitize-client`
  conversion was re-proved against a temporary client file, one run each: the comment-prefixed
  `jsdom` import, a comment-prefixed server-sanitiser import, and `import ("../sanitize.js")`. All
  three fail the test.
- **C2 (P3), fixed by the reviewer:** `pgReady` read `options.keepPool` after its awaits, so an
  alias that changed the flag mid-probe got `{}` from a call typed to return a pool. It captures
  the flag first; a mocked-pool regression is in `tests/pg-ready.test.ts`. Kept as written.
- **Also:** a bare `npm test` in a fresh clone with no build fails three build-output files. That
  is intended, and `docs/project/testing.md` and `docs/project/setup-dev.md` now say so.

## Review, round two

[GPT Sol's narrow re-check](261006j-sixth-sweep-s4-code-review-2-sol.md)
([prompt](261006j-sixth-sweep-s4-code-review-2-prompt.md)) of the C1 fix, verdict **ship**. C1 is
closed: the two comment-prefixed imports and `import ("../sanitize.js")` pass the sanitiser test
with the old reader and fail it with the new one. No new findings.

It compared the old and new edge sets over 1,144 files in `src/` and `tools/`. Ten files lost an
edge and every one was a false positive of the regex reader: text in a comment, or a type-only or
type-position import. No real run-time edge was dropped and no scanned file was refused. A file
that cannot be parsed fails the caller loudly, with its name.

One limit is unchanged, in the old reader and the new alike: `require(...)` and
`import x = require(...)` are not reported.

## Gates

- `npm run typecheck`: 0 errors, after every stage.
- `npx vitest run` on every test file touched: all pass. Stage 1's 26 files: 559 passed, 0 skipped.
- `npx biome lint` on the files with new code: two `useLiteralKeys` infos in
  `tests/fleet-recovery-resume-route.test.ts`, both there before.
- The full `npm test` was not run; the orchestrator runs it on the branch.
