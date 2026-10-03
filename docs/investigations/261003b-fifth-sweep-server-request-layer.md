# Server request layer: fifth sweep investigation

The depth stage of the fifth codebase sweep for the **server request layer**: `src/routes.ts`, the
gate and error mapping in `serveApi`, the streaming route shells, the copies of `httpError`, the
hand-rolled OpenRouter key checks, `isAdmin` call sites, `Retry-After` parsing, `src/messages.ts`'s
failure kinds as routes use them, and `src/after-response.ts`. Its parent is
[261003f-fifth-codebase-sweep-umbrella.md](../plans/261003f-fifth-codebase-sweep-umbrella.md). It
proposes; it builds nothing. Measured against `dev` at `59bd41171`, 2026-10-03.

The short version: the request layer's *rules* are sound and well-guarded (one gate, a typed
`VerifiedUser`, one table, one dispatch, a contract test that parses the source). What has decayed
is the edges: three "two ways to do one thing" here have **provably drifted** (a fix reached one
copy only), one hand-kept inventory is a third wrong, and `routes.ts` mixes a stable transport kit
with seven self-contained feature regions that change for unrelated reasons.

## Scope, and what the method cannot see

**Looked at:** all of `src/routes.ts` by region (structure, the 2,700-line `AUTH_ROUTES` table,
`serveApi`/`serveAuthenticatedApi`, every `sse(res)` caller's catch/finally), `src/stream-run.ts`,
`src/after-response.ts`, `src/public/routes.ts` (its copies), `src/admin.ts` `isAdmin`, the eight
`OPENROUTER_API_KEY` pre-checks, both `Retry-After` parsers, the `[ai-unusable]` pair in the referee
runners and `src/messages.ts`, `src/vercel.ts` (server entry; only skimmed), and the test files that
drive `handleApi` (84 of them, `git grep -l -E "handleApi|serveAuthenticatedApi|dispatchAuthRoute" -- tests`).

**Skipped:** route-handler business logic beyond its shape (chat's turn semantics, upload
admission, billing internals — owned by other zones), `src/messages.ts` as copy (5,662 lines, ~70%
comment; it is a sentence catalogue with one reason to change, and `stepGaveUp` is pipeline, not
request), fleet/Overseer HTTP (`tools/fleet/*`, its own `Retry-After` writers), and the client side
of every stream.

**Blind spots of the method.** Nothing here was run against Postgres or a live server; "reproduced"
below means reproduced in isolated `node -e` or by an existing test's own assertion. Region
boundaries in `routes.ts` were found by section markers and a name-reference script that counts
words, so it can over-count (a function called `answer` collides with prose) but not under-count a
call. Churn was attributed to functions by `git log -p` hunk headers, which name the *enclosing*
declaration at the time of the commit; hunks in the file header and imports read as `(none)`.

## Measurements that frame everything else

| Fact | Number | How |
|---|---|---|
| `src/routes.ts` size | 10,616 lines; ~4,300 code, ~5,900 comment | line classifier in the scratchpad (`srl-count.mjs`): block/line-comment lines vs the rest |
| Commits touching it | 192 total, 81 since 2026-09-08, 60 since 09-20 | `git log --oneline --no-merges [--since=…] -- src/routes.ts \| wc -l` |
| Where those 81 landed | `AUTH_ROUTES` 47 commits, header/imports ("none") 50, `serveAuthenticatedApi` 12, `streamChat` 9, `search` 8, `answer` 5 | hunk-header attribution, one count per commit per function |
| Table rows | 106 (`method:` lines), 71 `first-capture`, 35 `none`, 2 `handler` | `grep -c -E '^\s+method: "(GET\|POST\|PATCH\|DELETE\|PUT)"' src/routes.ts` |
| Distinct modules imported | 81 | `grep -o -E 'from "\./[^"]+"' src/routes.ts \| sort -u \| wc -l` |
| Largest units | `AUTH_ROUTES` 2,700 lines; `streamChat` 701; `answer` 252; `serveApi` 246; `parseJobRequest` 175 | gap between top-level declarations |

The dominant reason this file changes is **"a feature gained a route"**: a row, often a 30-100 line
inline handler, an import, and a line in the header inventory. The rows are not the problem — the
table is the settled design (260907b) and must keep its single dispatch and order. The problem is
everything a row drags in beside it.

## Findings

Tiers: T0 live defect · T1 cheap mechanical with evidence · T2 extraction worth doing, test first ·
T3 rearchitecture (named and sized only).

### R1 — A malformed `%` escape in an authenticated path is a 500 and a Sentry report; the public copy was fixed in August (T0, drift)

- **Where:** `src/routes.ts` § `part` (`return decodeURIComponent(m[group] ?? "")`, ~line 5025) and
  `slugPart` beneath it; the fixed twin is `src/public/routes.ts` § `slugFrom` (~line 344), whose
  docstring records the fix: *"`decodeURIComponent("%")` raises `URIError`, which names no status,
  so the shared catch in `serveApi` mapped it to **500** … GPT Sol's finding 7, 2026-08-28."*
- **What:** every authenticated pattern admits `%` (`[\w.%-]+`); `part` lets the `URIError` escape;
  `serveApi`'s catch finds no numeric `status`, maps it to 500, and `captureFailure` fires at
  `status >= 500`. So a signed-in reader (or a script with a token) requesting
  `/api/article/%E0` produces a Sentry issue that says *we are broken* about a typo.
- **How I know:** `node -e 'decodeURIComponent("%E0")'` → `URIError URI malformed`; the pattern
  matches (`/^\/api\/article\/([\w.%-]+)$/.test("/api/article/%E0")` → `true`). And the repo
  already reproduces it: `tests/authenticated-api-route-contract.test.ts` § *decodes the slug first
  on PATCH /api/library/:slug, so it is a 500* asserts `reply.status === 500`, with the comment
  *"Copying the public helper here would be a behaviour change, so this asserts what is, not what is
  tidy."* That was right during the table migration (no behaviour change allowed); the migration
  closed on 2026-09-11 and the pin outlived its reason.
- **Evidence:** reproduced (by the existing test's own assertion).
- **Fix:** `part` catches `URIError` and throws `httpError(400, "That is not a path we can read.")`
  (fixed words — see R11). Edit the two pinned cases in the contract test deliberately, as its own
  comment asks; the pair test then asserts the two *messages* differ rather than the statuses.
  Better still, as part of R8, one `decodeCapture` used by both dispatchers.
- **Effort** S · **value** med (Sentry noise, wrong status) · **risk** low.
- **Files:** `src/routes.ts`, `tests/authenticated-api-route-contract.test.ts`.

### R2 — Two `Retry-After` parsers, and they disagree (T1, drift reproduced)

- **Where:** `src/ai-call.ts` § `retryAfterMs(headers: Headers)` (~1241) and `src/fetch.ts` §
  `retryAfterMs(header, now)` (~1961) — same name, both exported. `ai-call.ts`'s own docstring says
  *"a second parser for it would be a second opinion about what 'a minute' means, and the two would
  disagree the day one of them learned about the HTTP-date form."* There is a second parser.
- **How I know** (both bodies copied into `node -e`, current time):

  | header | ai-call | fetch |
  |---|---|---|
  | `0` | null | 0 |
  | `1.5` | 1500 | **0** (V8 `Date.parse("1.5")` is a date in 2001) |
  | `0x10` | **16000** (`Number("0x10")`) | null |
  | `-5` | null | 0 |
  | past HTTP date | null | 0 |

  RFC 9110's `delay-seconds` is `1*DIGIT`, so fetch's digits-only test is the correct half and
  ai-call's `Number()` the lenient one; fetch's fallthrough to `Date.parse` is the lenient half
  there.
- **Callers:** ai-call's → `ProviderRefused` and `src/structure-deepen.ts:851`; fetch's →
  `readBody` → `classifyStatus` → every `FetchFailure` (link previews, bibliographic cooldowns).
- **Evidence:** reproduced (divergence); no observed harm — every disagreeing input is unusual.
- **Fix:** one parser (`(header: string | null, now: number) → number | null`, digits-or-IMF-date,
  null for a past date), in `fetch.ts` or a leaf; ai-call's becomes `parse(headers.get("retry-after"),
  Date.now())`. A table test over the five rows above, which goes red on today's ai-call.
- **Effort** S · **value** low-med · **risk** low.
- **Files:** `src/ai-call.ts`, `src/fetch.ts`, one new test.

### R3 — Eight OpenRouter key pre-checks read a key nothing uses, and break the env-loading rule (T1, drift)

- **Where:** `src/converse.ts:1717`, `explain.ts:510`, `quiz-mark.ts:566`,
  `referee-claims-run.ts:451`, `referee-criteria-run.ts:560`, `referee-mirror.ts:1533`,
  `search.ts:558`, `transcribe.ts:203` — each `loadEnvLocal(); const key = process.env.OPENROUTER_API_KEY;
  if (!key) { line.error(…); throw … }`.
  Count: `git grep -n "loadEnvLocal()" -- src | grep -v -E ":\s*(\*|//)"` → those 8 plus
  `cli-ledger.ts`, `db/client.ts` ×2, `embeddings.ts`, `env.ts`, `pdf-read.ts`.
- **What, two things:**
  1. **The key is dead after the check.** In all eight, the only later reference to `key` is the
     `if (!key)` (checked per function body, comments excluded). The calls go through
     `src/ai-call.ts`, whose `apiKey()` reads the key itself and throws the same `NOT_CONFIGURED`.
     Seven blocks are now a pre-check duplicating the real check; their one distinct value is a log
     line naming the variable.
  2. **The rule they break was written down twice and reached two sites.**
     `src/messages-stream.ts` § `messagesClient` (~117-135): *"`loadEnvLocal()` is deliberately NOT
     called here … A library that re-reads credentials a caller has just removed cannot be told
     not to … nothing in the request path or a test loads anything."* `src/ai-call.ts` § `apiKey`
     says the same. Eight request-path sites still call it. It is harmless today **only because**
     `src/db/client.ts:73` calls `loadEnvLocal()` at import and the function latches `done`; the
     moment a test that deletes the key runs before anything imports `db/client`, these eight are
     the hazard those two comments describe.
- **Evidence:** proved from the code (unused binding; masking import traced).
- **Fix (deletion):** move the operator log line into `apiKey()` (`log("model").error("OPENROUTER_API_KEY
  is not set")`, no interpolation) and delete the seven blocks. Keep transcribe's: it is a 503 with
  `[mic-not-set-up]`, which `src/web/dictation-upload.ts:122` reads — but drop its
  `loadEnvLocal()`. No test pins the log lines (`git grep -n "is not set — every" -- tests` → 0).
  Prior sweeps (S4 T2.6, S5 K) left this open as "hand-rolled"; the new evidence is that the key
  is now unused, so the fix is a deletion, not a helper.
- **Effort** S · **value** med · **risk** low (behaviour: a missing key now surfaces at the call,
  still before any spend — `apiKey` runs before the meter).
- **Files:** the 8 listed + `src/ai-call.ts`.

### R4 — Eleven rows attribute their spend twice (T1)

- **Where:** rows at ~8612, 8637, 8931, 8955, 8983, 9056, 9216, 9271, 9337, 9492, 9526 in
  `AUTH_ROUTES` declare `article: "first-capture"` — so `dispatchAuthRoute` already wraps the
  handler in `withSpendAttribution({ articleSlug })` — and then wrap their own body in
  `withSpendAttribution({ articleSlug: slugPart(captures, 1) })` again.
  Found by walking back from each `withSpendAttribution` call in the table to its row's `article:`.
- **What:** two ways to say one thing. Today they agree (same capture, same `isSlug` test), and
  the nested wrap is a no-op (`src/ai-spend.ts` § `withSpendAttribution` merges the patch). The
  inner wraps predate the `article` field (SPIDERYARN-READING2-68, 2026-09-30) and were not removed
  when it arrived.
- **Evidence:** proved from the code.
- **Fix:** delete the eleven inner wraps. `tests/route-spend-attribution.test.ts` already drives
  `dispatchAuthRoute` with its own rows, so the dispatcher half is covered. Optionally a contract
  rule: a `first-capture` row's handler may not call `withSpendAttribution` (one AST check in the
  existing parser).
- **Effort** S · **value** low · **risk** low.
- **Files:** `src/routes.ts` (+ optional contract test).

### R5 — The route inventory in `routes.ts`'s header is a third copy, and it is wrong (T1, doc deletion)

- **Where:** `src/routes.ts:1-110`, 77 `METHOD /api/…` lines. `AUTH_ROUTES` has 106 rows.
- **How I know:** 17 of 17 routes I spot-checked are absent from the header —
  `/api/admin/{articles,feedback,users,voucher-emails}`, `/api/article/:slug/{high-power,reset,visibility}`,
  `/api/illustrated`, `/api/sketch`, `/api/similar`, `/api/projection`, `/api/transcribe`,
  `/api/feedback`, `/api/library/terms`, `/api/glossary/:slug/hidden`,
  `/api/chat/:slug/:threadId/cancel`, `/api/comments/:slug/:id/answer`. The table's own docstring
  (~7644) says the opposite of keeping one: *"`EXPECTED_AUTH_ROUTES` in
  tests/authenticated-api-route-contract.test.ts is where the inventory lives."*
- **Why it matters beyond accuracy:** it is the hunk every new-route commit touches, so it is where
  two feature agents' merges collide (`git log -L1,110:src/routes.ts` shows three commits on
  2026-10-03 alone).
- **Fix:** replace the list with three lines pointing at `EXPECTED_AUTH_ROUTES` and the public
  dispatcher. Deletion of ~100 lines; nothing checks the list, so nothing breaks.
- **Effort** S · **value** med (merge friction, a wrong map) · **risk** none.
- **Files:** `src/routes.ts` (header only).

### R6 — `CLAIMS_UNUSABLE` and `ANSWER_UNUSABLE`: still outside `messages.ts`, and their own comments are stale (T1)

- **Where:** `src/referee-claims-run.ts:235`, `src/referee-criteria-run.ts:511`; the registration
  in `src/messages.ts` `CODE_KINDS` (`"ai-unusable"`, the long note ~340-370).
- **What:** registration was done (e9e16fefc, `tests/every-ai-code-is-registered.test.ts`), yet
  `referee-claims-run.ts:227-229` still says *"same two mechanical steps to pay it: export it there
  **and** register `ai-unusable` in `CODE_KINDS`"*, and `referee-criteria-run.ts:~500` still says
  *"Skipping the second has no symptom here"* as if it had not happened. And `messages.ts`'s own
  note records the live consequence: `monitoring-scrub.ts`'s allowlist argument is *"the vocabulary
  is closed because tests/messages.test.ts round-trips every sentence in that file, and these two
  sentences are not in this file."*
- **Evidence:** proved from the code.
- **Fix:** move both constants into `src/messages.ts` (re-export from the runners if tests import
  them there), delete the stale paragraphs. Whether the pair keeps one code or gets two is a copy
  decision for docs/project/copy.md's batch (the "one sentence, one code" rule, S4 T2.8) — name it,
  do not decide it here.
- **Effort** S · **value** low-med · **risk** low.
- **Files:** `src/messages.ts`, both runners, `tests/referee-copy-is-about-the-model.test.ts` imports.

### R7 — `POST /api/citations/:slug/:id/find` was kept "one deploy for open tabs" and has outlived several (T1, deletion)

- **Where:** row at ~8931; header line *"no button calls it since plan 260930d, kept one deploy
  for open tabs"*.
- **How I know:** no client caller (`git grep -n "/find" -- src/web` hits only comments in
  `useCitations.ts`); at least three production deploys since (changelog commits `d04216d53`,
  `ea5fc67d2`, `5ba507809`).
- **Fix:** delete the row and its test file `tests/citation-find-route.test.ts`, and its
  `EXPECTED_AUTH_ROUTES` entry. `findCitation` stays — Investigate runs it as step one.
- **Effort** S · **value** low · **risk** low.
- **Files:** `src/routes.ts`, `tests/citation-find-route.test.ts`, the contract test.

### R8 — Extract the transport kit into a leaf module (T2)

- **What moves:** `send`, `httpError`, `readBody`, `fields`, `objectBody`, `part`/`slugPart`,
  `sse`, `heartbeat`, `contentDisposition` — ~350 code lines from `routes.ts:600-1415, 5025-5065`.
  They change rarely (`heartbeat` 2 commits since 09-08, `serveApi` 2) and are the only things the
  feature regions need from each other (see R12's measurement).
- **What it deletes:** `src/public/routes.ts` keeps its own `httpError`, its own `send` and its own
  `slugFrom` *because* importing `routes.ts` would create a cycle (its comment says so; precedent:
  `src/binary-response.ts` was extracted as a leaf for exactly this). A leaf kit lets it import
  them. The other seven `httpError` copies (`git grep -n "function httpError" -- src` → 9) import
  it too, and the four identical `refusedBy(kind)` switches in `citation-find.ts`,
  `citation-investigate.ts`, `dig-deeper.ts`, `source-guess-run.ts` collapse to one
  `allowanceRefusal(kind, { busy, limited, resting })` beside `AllowanceTaken`.
- **Why now, given S2's "revisit `httpError` when one drifts":** `httpError` itself has not drifted
  (all nine are byte-identical). Its sibling helper did — R1 is exactly a fix that reached the
  public copy of the decode and not the authenticated one. The kit is the place both live.
- **Test first:** unit tests for the kit with no database (`decodeCapture` on `%`, `%E0`, `..%2F`;
  `readBody` at the limit, empty, non-JSON; `sse` on an already-destroyed response). Then the move,
  with `npm run cycles` and `tests/public-imports.test.ts` as the gates.
- **Effort** M · **value** med · **risk** low-med (≥8 tests read `src/routes.ts` as text — see R12).
- **Files:** new `src/http/*.ts` (or `src/http-kit.ts`), `src/routes.ts`, `src/public/routes.ts`,
  the 7 other `httpError` files.

### R9 — `ENOENT → 404` in `serveApi`'s catch has no intended producer left (T1, hypothesis)

- **Where:** `src/routes.ts` ~7351, `(thrown?.code === "ENOENT" ? 404 : 500)`.
- **What:** it existed for the filesystem store, deleted 2026-09-05. The remaining `readFile`
  callers reachable from requests are guarded (`src/db/ssl.ts` checks `existsSync`) or test-only
  (`loadThreads`/`loadComments`/`loadRuns`/`loadShelf`/`loadLookups` — no `src` caller; only
  `tests/helpers/seed-reader-state.ts` and two tests import them). So the branch now only fires for
  an *unexpected* ENOENT — a missing bundled asset — and then does three wrong things: reads as
  "no such article", skips Sentry (404 < 500), and, because a sub-500 status passes `err.message`
  through, sends `ENOENT: no such file or directory, open '/var/task/…'` to the client.
- **Evidence:** the mapping and its consequences are proved from the code; a reachable producer is
  **not** — hypothesis. `src/store/db-errors.ts:~507` already guards the one Postgres case.
- **Fix:** delete the branch (an ENOENT becomes a reported 500). No test pins it
  (`git grep -n ENOENT -- tests` → none about routes). The five test-only filesystem readers are a
  lead for the store zone, not this one.
- **Effort** S · **value** low · **risk** low.

### R10 — The `gone` signal: the comment says every stream, the code says some (T1, doc)

- **Where:** `sse()` (~1331-1400): *"GPT Sol's second review … it applies to every streaming route
  here."* Five `sse(res)` users never take `gone`: `answer` (comments), `streamTermLookup`,
  `runRefereeCriterion`, `runRefereeClaims`, and `search` for meaning runs.
- **What:** this is a rule nobody wrote down, not a bug: streams whose result is **stored** run to
  completion when the tab closes (the answer lands on a row), ephemeral ones cancel. `search`'s
  comment (~4436) says so for its own case: *"Meaning keeps running when the tab closes, as it
  always has: changing that is a product call."*
- **Fix:** one sentence in `sse()` and in docs/project/comments.md § streaming stating the rule.
  The product question is P1 below.
- **Effort** S · **value** low · **risk** none.

### R11 — Messages that interpolate the offending value, against the file's own logging rule (T1, low)

- `logRequest`'s comment: *"every `httpError` message in this file is written to a log, so it must
  contain nothing but words we chose. Not the URL, not the body, not the offending value."* Yet
  `slugPart` throws `` `Not a slug: ${JSON.stringify(value)}` ``, and so do store errors that reach
  the same catch with a numeric status (`src/store/require-slug.ts:32`,
  `src/store/public-reader.ts:185`, `jobs.ts:3432` *"Too many articles already called
  "${slug}""*, `term-lookup.ts:301`). The catch treats every status-bearing error as "ours".
- **Harm:** small — the value is a path segment, already in `path`, and `JSON.stringify` escapes
  control characters. Worth folding into R1/R8 (the kit's decode uses fixed words) rather than a
  stage of its own.

### R12 — Split `routes.ts` by reason, keeping the table (T2 for the first slice; T3 overall, L)

See § One level up. Named here so the cluster list can refer to it.

### R13 — Billing lock tests prove "blocked" by sleeping 400 ms (T1, testability)

- **Where:** `tests/billing-vouchers.test.ts` ~342 and ~372: start an admission behind a held
  `for update`, `setTimeout(r, 400)`, `expect(settled).toBe(false)`.
- **What:** a check that passes when the lock works *and* when the box is merely slow — on this
  machine, under suite contention, an unblocked admission can easily take 400 ms
  ([silent-success.md](../reusable/silent-success.md)). Same shape at
  `tests/public-visibility-pg.test.ts` ~2100 (300 ms).
- **Fix:** poll `pg_stat_activity` for the admission's backend reaching `wait_event_type = 'Lock'`,
  then assert not settled. Hypothesis that it has ever passed vacuously; the shape is the finding.
- **Effort** S · **value** med (it guards the quota) · **risk** low.

## Two ways to do one thing

| Pair | Drifted? | Evidence |
|---|---|---|
| URI decode: `part` vs public `slugFrom` | **Yes** — URIError fix reached public only (R1) | contract test pins the 500 |
| `Retry-After`: ai-call vs fetch | **Yes** — five disagreeing inputs (R2) | reproduced |
| OpenRouter key: 8 pre-checks vs `apiKey`/`messagesClient` | **Yes** — "don't `loadEnvLocal` in a library" reached 2 of 10 (R3) | proved |
| Route inventory: header vs table vs `EXPECTED_AUTH_ROUTES` | **Yes** — header missing ≥17 (R5) | grep |
| Spend attribution: row `article` vs inner wrap | No, redundant (R4) | proved |
| `httpError` ×9, `refusedBy` ×4 | No — byte-identical | `git grep -n "function httpError\|function refusedBy" -- src` |
| SSE headers: `sse()` vs `streamChat`'s own | No — same four headers; chat writes them inside its `try` so a dead socket cannot leak the `streaming` key. `sse(res)` could be called inside that `try` instead; low value, chat is the riskiest stream to touch | read both |
| After the model, the store write fails: `answer` frames `done` with its patch; `search`, `runRefereeCriterion`, `runRefereeClaims` frame nothing, so the client reports "stopped arriving" and the row stays `pending` until swept | Divergent; not shown to be wrong — each is documented locally. A shared route-side stream shell would force the choice | read all four catch blocks |
| Model loop: `runStream` (2 callers: `explain.ts`, `citation-investigate.ts`) vs seven hand-rolled loops | No new drift: the judgement is shared (`classifyEnd` in all seven), so the copies are thin. S1's rejection of a stall-timer helper stands. (Prior notes said 3 callers / 8 files; it is 2 and 7.) | `git grep -n runStream -- src` |

## Testability

- **Request-path logic inside table closures.** The `POST /api/jobs` row (~10022, 100 lines) holds
  the admission order — existing upload → bytes arrived → quota slot — and the "URL spends a slot,
  slug is free" rule (docs/project/billing.md § The quota) inline. It is tested only through
  `handleApi` against Postgres (`an-upload-is-queued-only-once-its-bytes-arrive`,
  `billing-admission`). Extracting `admitJob(request, deps) → { kind: "article" | "job" | "refused" }`
  would let the order be unit-tested. T2, M; worth doing only alongside R12's jobs slice.
- **`serveApi`'s status mapping** is reachable only via `handleApi`, but it is well covered
  (`routes-status-classes-survive-the-store-guard`, the contract test, `owner-isolation`). No action.
- **Fixed waits:** R13. The route stream tests (`chat-live-turn`, `store-wiring`) poll at 10 ms with
  a bound, which is fine.
- **Timers:** `heartbeat` already takes `everyMs` for tests; the orphan-grace constants are module
  constants guarded at import. No seam missing.

## Product simplifications (PRODUCT — not to build without Greg)

- **P1. Cancel stored-result streams when the reader leaves** (meaning search, referee criteria and
  claims, comment explanations). Removes paid calls nobody watches; the reader loses the answer
  quietly landing on the row while they are away. `search.ts`'s route already calls this a product
  call it did not make.
- **P2. One sentence for `[ai-unusable]`.** The two referee sentences differ only in "pointed at
  passages" vs "returned"; one sentence ends the "two sentences, one code" exception (R6). The
  reader loses the claims/criteria nuance in the failure line.

## Considered and rejected

- **Wrap the four module-scope registries** (`answering`, `searching`, `refereeing`,
  `pullingClaims`) in `processSingleton` — S2 rejected; nothing new.
- **`isAdmin(userId: string | undefined | null)` → a branded parameter.** 16 server call sites
  (`git grep -n -E "\bisAdmin\(" -- src ':!src/web'`, excluding the definition). Every one I read
  passes `user.id`, `currentOwnerId()`, an `OwnerId`-typed parameter or a database `ownerId`; none
  takes an id from a body or query. The client shares the function, so narrowing it costs a client
  type change for no reachable defect. Still open from S3; still not worth it.
- **A route-side stream shell** wrapping `sse` → for-await → catch/`captureFailure` → store write →
  `res.end`. Eleven routes have the shape, but the store-failure divergence above means the shell
  would have to take a policy parameter for the one decision that differs — the YAGNI test fails
  until that divergence is decided. Revisit after P1.
- **Migrating hand-rolled model loops onto `runStream`.** Structured-item streams (search, referee)
  are a real difference, and there is no drift (table above). Rejected again.
- **B-knowledge lead 10** (`routes.ts:1117`/`9737` "same hole latent"): both are history paragraphs
  describing a fixed bug, not stale claims. Dropped.
- **`after-response.ts`.** Sound: one scope opened in `handleApi`, drained in batches, failures
  logged and swallowed, inline outside a request. One latent trap only: tasks drain *outside*
  `collectSpend` (inside `runInRequest`), so a future after-response task that called a model would
  record unscoped spend. No task does today (voucher emails, arrival notice, upgrade mail). A
  sentence in its header would do; not a finding.
- **Splitting `src/messages.ts`.** Large, but one reason to change (the words) and one test that
  round-trips it. Splitting would weaken the "closed vocabulary" argument R6 relies on.

## One level up: is the approach sound, and what would splitting `routes.ts` do?

**The approach is sound.** One gate inside the `try`, a `VerifiedUser` only `requireUser` can mint,
a static ordered table with a single dispatch, `article` attribution required per row, and a
contract test that parses the source and refuses unknown syntax. None of that should move, and
docs/project/security-map.md names `routes.ts` as the home of "the one `requireUser` call" and
`slugPart` — a split must leave both there (or `slugPart` in the kit, imported).

**Its distinct reasons to change** (by region, with the reference check below):

| Region | Lines | Changes when |
|---|---|---|
| Header + imports | 1-600 | any route is added (R5 deletes most of the header) |
| Transport kit | 600-1415, 5025-5065 | almost never |
| Comments, glossary, citation streams | 1414-2168 | comments/glossary/citations features |
| Quiz marking | 2168-2407 | Remember/Quiz |
| **Chat + live sessions** | 2407-4256 (1,850; 632 code) | chat/live features — the second-biggest churn after the table |
| Search | 4256-4508 | search |
| Referee | 4508-5002 | referee |
| Request parsers | 5065-5555 | per-feature parsing |
| Uploads, jobs, profile, dictation | 5555-6520 | ingest/billing/profile |
| Feedback | 6520-7059 | feedback |
| Gate, error mapping, logging | 7059-7442 | rarely; security-sensitive |
| The table + dispatch | 7442-10616 | every route |

**Would splitting by reason concentrate complexity or spread it?** Measured, not argued: for each
region I listed its top-level declarations and counted references to them from every *other*
region outside the table (script in the scratchpad, comments excluded). Result: **every feature
region's only outbound dependencies are the transport kit plus `powerOf`/`resolveProfile`, and its
only inbound references are table rows.** Chat's 31 declarations have zero references from other
regions except one shared constant (`SEARCH_ORPHAN_GRACE_MS`, defined in chat, used by search);
referee's 11 and feedback's 14 have none at all. So moving a region out concentrates — each
feature's request logic ends up beside nothing but itself — and spreads nothing, because there is
no cross-region web to cut. The table stays in `routes.ts` with one-line handlers
(`handler: async (ctx, c) => chatRoutes.stream(ctx, c)`); the contract test's rule that a handler
is "written out here" is satisfied by a one-line arrow.

**What it costs.** ≥8 tests read `src/routes.ts` *as text* by path and pin locations inside it
(`authenticated-api-route-contract`, `cacheable-covers-artefact-routes`,
`embedding-route-failures`, `owner-isolation`, `referee-scan-route`,
`routes-status-classes-survive-the-store-guard`, `source-store`, `public-imports`; from the 12 files
`git grep -l -E "src/routes\.ts" -- tests | xargs grep -l readFileSync` returns, the rest of which
scan the whole tree generically). 260907b's table analysis
called out exactly this: each will go loudly empty, not silently green, when its target moves —
which is the good failure, but it is one edit per test per slice.

**Is this a re-proposal of S5 G?** S5 G rejected "per-domain files" *as the alternative to the
table* — fourteen `tryXRoutes` dispatchers, each with its own handled/miss boolean. This keeps the
one table and moves only handler bodies and their helpers, which is the half 260907b deferred:
*"Only a later file split moves the declaration."*

**T3, sized:** kit (R8, M) then one region per slice — chat first (largest, self-contained, 9
commits since 09-08), then uploads/jobs (with the `admitJob` seam), feedback, referee, the rest.
Six to eight slices, L overall. Do the kit and chat; re-measure merge friction before the rest.
Acceptance is not a line count: it is that a new chat route is an edit to `chat-routes.ts` plus one
row, and the header no longer exists to conflict on.

## Ranked top list, clustered for parallel builds

Clusters have non-overlapping file sets where possible; `src/routes.ts` is unavoidable in several,
so those are ordered and sequential.

**Cluster A — model-call plumbing (no `routes.ts`):**
1. **R3** — delete seven OpenRouter pre-checks, log once in `apiKey` (S, med). Files: `converse`,
   `explain`, `quiz-mark`, `referee-claims-run`, `referee-criteria-run`, `referee-mirror`, `search`,
   `transcribe`, `ai-call`.
2. **R2** — one `Retry-After` parser (S). Files: `ai-call.ts`, `fetch.ts`, new test. (Touches
   `ai-call.ts` with R3 — same agent.)
3. **R6** — move the `[ai-unusable]` pair to `messages.ts`, delete stale prose (S). Files: the two
   referee runners (shared with R3 — same agent), `messages.ts`, one test.

**Cluster B — `routes.ts` small edits, one agent, in order:**
4. **R1** — `part` answers 400 on a bad escape; edit the two pinned contract cases (S, med).
5. **R5** — delete the header inventory (S, med).
6. **R4** — delete eleven inner spend wraps (S).
7. **R7** — delete the `/find` row and its test (S).
8. **R9** — delete `ENOENT → 404` (S), with a test that an ENOENT from a handler is a 500.
9. **R10/R11** — the `gone` sentence; fixed words in the decode message (S).

**Cluster C — tests only:**
10. **R13** — replace the 400 ms / 300 ms waits with a `pg_stat_activity` lock-wait poll (S, med).
    Files: `tests/billing-vouchers.test.ts`, `tests/public-visibility-pg.test.ts`.

**Cluster D — after B lands (T2):**
11. **R8** — the transport kit as a leaf; `public/routes.ts` and the seven `httpError` files import
    it; one `allowanceRefusal` (M).
12. **R12, slice 1** — chat region out of `routes.ts` behind its rows (M), then stop and measure.

Top five by ease × value: **R3, R1, R5, R2, R13.**
