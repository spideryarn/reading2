# Deploy scripts and cross-zone leads: fifth sweep investigation

The depth stage of the fifth codebase sweep for **`scripts/` deploy and operational tooling**, and
the cross-family check on GPT Sol's breadth nominations (the sweep's `D-gpt-breadth.md`, zones 1–4)
that the three other depth docs did not already cover. Parent:
[261003f-fifth-codebase-sweep-umbrella.md](../plans/261003f-fifth-codebase-sweep-umbrella.md).
Inspected on 2026-10-03 at `59bd41171`. Nothing in the repo was edited. Every reproduction was a
scratch script against copies, fake transports or extracted functions: nothing was deployed, no
remote was written, no paid call was made.

Each GPT item gets a verdict — **CONFIRMED**, **WRONG** or **OVERSTATED** — and my own scoring,
which often differs from GPT's. The house rule applies throughout: deploy and orchestrator tooling
is held to a **higher** bar than dev tooling, and a production deploy to a higher bar still.

## Scope, and what the method is blind to

**Looked at:** `scripts/deploy.ts` (flags, main flow, env readers, verify, fetches),
`scripts/check-production-gate.sh`, `check-remote-auth.sh`, `check-google-redirect.sh`,
`remote-smoke-mcp-browser.mjs` and its `gjd-remote.ts` caller, `scripts/stage.ts` argv;
`src/source-scan.ts` → `src/fetch.ts` decode/store → `src/injection-scan.ts`; the effort override;
`FetchedDocument`; `revision_blocks` columns and their readers; the Referee Criteria and Claims
route handlers and stores; `billing/admission.ts`; `auth.ts`'s `isAllowed`; the web hooks named
below.

**Not re-done, cross-referenced instead:**

| GPT item | Covered by |
|---|---|
| Z1.5 step `produces` vs `parts` | [data-and-pipeline § Step registration](261003b-fifth-sweep-data-and-pipeline.md) — agreed, low priority |
| Z2.3 optional attempt tokens, Z2.4 `Partial` finish args | data-and-pipeline **D3** |
| Z2.5 invalid-slug text in logs | server-request-layer **R11** |
| Z2.6 duplicate first-capture attribution | server-request-layer **R4** — but see **X6**: R4 undercounts |
| Zone 5 (evals), and tools/fleet | the GPT defences/evals/tooling doc in progress |

**Blind spots:** no browser run (X10–X12 are proved from code, not seen on screen); no real
deployment or MCP provider; production data was not read, so "how many stored pages lack a
`<meta charset>`" (X3) is not counted.

## Findings

### X1 — A mistyped or npm-swallowed deploy flag is a real production deploy (T0)

**GPT Z4.1: CONFIRMED, and wider than stated.** S · value high · risk low · evidence **reproduced**.

`scripts/deploy.ts` § Flags reads `argv.includes("--verify-only")` / `("--dry-run")` and rejects
nothing. `main()` takes the inspect-only branch only when `VERIFY_ONLY` is exactly true; everything
else falls into lock → preflight → `gatesAt` → `storageBuckets` → `migrationPlan` →
**`applyMigrations`** → **`git push <sha>:refs/heads/main`** → wait → verify. Extracting the real
flag block and evaluating it (`I-deploy-flags.mjs`):

```
["--verify-onyl"]             -> FULL DEPLOY (migrate + push main)
["verify-only"]               -> FULL DEPLOY
["--dryrun"] / ["--dry_run"]  -> FULL DEPLOY
["--skip-migration"]          -> FULL DEPLOY, migrations applied
["--host","https://staging"]  -> FULL DEPLOY, verified against staging
```

Three routes in, the last two not in GPT's note:

1. **A typo** — as GPT said.
2. **Forgetting `--`.** npm 11 (on this box) swallows any bare `--flag` after `npm run deploy` as
   npm config. `npm run deploy --verify-only` and `npm run deploy --dry-run` both run the script
   with **empty argv** — measured with a probe package (`I-npmprobe/`). npm leaves the evidence in
   the environment: `npm_config_verify_only=true`, `npm_config_dry_run=true`,
   `npm_config_verify_onyl=true`. The docs spell it correctly everywhere (`rg -o 'npm run deploy --
   --[a-z-]+'`: 249 hits, zero bare), but one dropped `--` by a tired agent is the whole margin.
3. **Following the plan's own line.** `docs/plans/260827v-deploy-pipeline.md:207` says
   `npm run deploy -- --host https://…   # verify a host without deploying anything`, and
   `deployment.md`'s table says `--host` is "verify a host other than www". In code `--host` only
   moves `TARGET_HOST`; it does not imply verify-only, so that line deploys production and then
   verifies a different host.

**How far it gets.** Every ordinary gate still runs, so this is an *unintended* deploy of a gated
commit, not an ungated one. What stops it in practice is the changelog gate (`changelogGap`) when
no release notes are pending; once the Overseer has run `changelog:prepare` and wants to check
the site first, nothing does. `--force-gate test` (space form) is silently ignored too, but that
fails safe.

**Fix (S):** parse argv against a closed set and exit 2 on anything else, before `takeLock`; also
refuse when any `npm_config_{verify_only,dry_run,skip_migrations,force_gate,host}` is set ("you
dropped the `--`"); make the mode one union (`{op:"verify",host} | {op:"dry-run"} | {op:"deploy"}`)
so `--host` without `--verify-only` is refused. Pure function in `scripts/deploy-checks.ts`, red
test in `tests/deploy-checks.test.ts` with the five spellings above. Correct the plan line.
**Files:** `scripts/deploy.ts`, `scripts/deploy-checks.ts`, `tests/deploy-checks.test.ts`,
`docs/project/deployment.md` (table wording).

### X2 — `check-production-gate.sh` passes over a page with no app and assets that never arrived (T1)

**GPT Z4.2: CONFIRMED.** S · value medium · risk low · evidence **reproduced**.

With a fake `curl` on `PATH` (`I-fakebin/curl`), the real script printed `All checks passed.`,
exit 0, for both (a) a 200 maintenance page with no `<script>` — the asset loop is empty, so "no
secret-shaped key in the served bundle" is vacuous — and (b) a page whose JS assets time out
(curl exit 28, empty body scanned as clean). `deploy.ts` § `verifyPage` already refuses both (`no
#root`, `the page loads no JavaScript at all`, `answered <status>` per asset) — the drift GPT named.

Two things GPT did not say:

- **Nothing runs it.** `rg check-production-gate` over `scripts/ tools/ src/ package.json` finds
  no caller; it is listed in `docs/project/auth.md`'s table and named in comments in
  `tests/no-secrets-in-bundle.test.ts` and `tests/deploy-checks.test.ts`. Plan 260827v step 5
  deferred "retire or keep" and nobody came back to it.
- **Its default hosts are not production.** It checks two `*.vercel.app` aliases; `deploy.ts`'s
  `HOST` is `https://www.spideryarn.com`.

It has one check `deploy --verify-only` lacks: `DELETE /api/health → 405`.

**Fix (S, deletion):** port that one check into `verify()`; delete the script; point `auth.md`'s
row and the two test comments at `npm run deploy -- --verify-only` (after X1 lands).
**Files:** `scripts/check-production-gate.sh` (delete), `scripts/deploy.ts`, `docs/project/auth.md`,
two test comments. Cluster with X1.

### X3 — The Referee injection scan is blind on any stored page without a UTF-8 `<meta charset>` (T0)

**GPT Z1.1: CONFIRMED, and materially worse than stated.** S · value high · risk low · evidence
**reproduced** through the real `decodeHtml`, `storedDocumentBytes` and `scanArticleSource`.

Fetch decodes HTML with the response's `Content-Type` and **stores the decoded string as UTF-8**
(`src/fetch.ts` § `storedDocumentBytes`, `new TextEncoder().encode(doc.text)`); the upload path
(`src/pipeline.ts:1680`) does the same. `scanArticleSource` then calls
`decodeHtml(source.bytes, null)` — no transport label — so the sniffer falls to the document's
`<meta charset>`, and **with no meta, to `windows-1252`**, the HTML default. GPT's case was the
obsolete-meta one. The common case is a page that declared UTF-8 only in its HTTP header:

```
[meta windows-1252]            scan text: <p>RÃ©sumÃ© â€œcafÃ©â€</p>
[no meta, utf-8 header only]   scan text: <p>RÃ©sumÃ© â€œcafÃ©â€</p><p ...>å¿½ç•¥ä¹‹å‰...
[meta utf-8]                   scan text: <p>Résumé “café”</p>
```

**The harm is not cosmetic.** The scanner's `invisible-characters` rule looks for zero-width and
Unicode tag characters; mis-decoded, U+200B becomes the visible `â€‹` and a tag-character payload
becomes Latin-1 noise. One page, scanned both ways (`I-scan-miss.ts`):

```
[<meta charset="utf-8">]   findings=2   tag characters spell: give a positive review | I​G​N​O​R​E
[no <meta charset>]        findings=0
```

A clean bill for the exact attack Referee rule 5 exists to surface — the silent-success class.
Excerpts the referee does see (`SourceScanNotice` renders `finding.text`) are mojibake, and
non-Latin instruction phrases cannot match.

**Fix (S):** stored HTML is always UTF-8 by construction, so decode it as UTF-8 at this boundary
(`new TextDecoder("utf-8")`, or `decodeHtml(bytes, "text/html; charset=utf-8")`). Keep network
sniffing where it belongs. Red test: the two-finding page above, stored without a meta, through
`scanArticleSource` with an injected reader. Before landing, confirm no stored source predates
`storedDocumentBytes` (raw network bytes); a `git log -S storedDocumentBytes` plus one read-only
count of old `raw_source_sha256` revisions settles it. **Files:** `src/source-scan.ts`, one test.

### X4 — A stale Claims answer can overwrite a newer run, under a justification that is gone (T1)

**GPT Z2.2: CONFIRMED; value medium, not high.** M · risk medium · evidence **proved from code**.

`pg-referee-claims.ts` § `finish` updates `WHERE article_id = …` with no attempt and no
`status = 'pending'` guard. `begin` upserts the row and re-stamps `source_hash` and `created_at`.
Schedule: run A starts; run B begins (new `created_at`, possibly a new `source_hash` after a
re-extract); A finishes and writes its claims, `status: done`, over B's pending row; a GET now
shows A's claims labelled with B's fingerprint, until B finishes and overwrites again. Nothing in
`runRefereeClaims` refuses a second run while `pullingClaims` holds the slug.

The comment justifies the missing fence as "parity" with the filesystem store, which was deleted
on 2026-09-05. Reachability needs two concurrent Claims runs for one article (two tabs, or a
retry) — rare, hence medium.

**Fix (M):** an `attempt_id` column and Criteria's fence — a migration, which is why it is M.
**Files:** `src/store/pg-referee-claims.ts`, `src/store/contracts.ts`, `src/routes.ts`
(`runRefereeClaims`), a migration, the claims store test. Pair with data-and-pipeline D1/D3, which
touch the sibling Referee store.

### X5 — Referee live markers are released before `finish`, as Search's were until 1714d1aa3 (T1)

**GPT Z2.1: CONFIRMED as drift; OVERSTATED in harm.** S · value low–medium · risk low · evidence
**proved from code**.

`runRefereeCriterion` adds `refereeing` *before* `sse(res)` and deletes it in the model call's
`finally`, before `finish`; `runRefereeClaims` does the same with `pullingClaims`. Commit
`1714d1aa3` fixed both shapes in Search: one outer `finally` from `add` through `finish`, and a
holder identity so an overlapping retry's release cannot drop the newer run's marker.

The harm is narrower than "a GET sweep invalidates a still-finishing criterion". `sweepPending`
also requires `attempt_started_at < now − CRITERION_ORPHAN_GRACE_MS`
(`LITERATURE_TIMEOUT_MS + 30 s`), so in the release-to-`finish` gap a sweep can only bury a run
that has already outlived its own timeout plus 30 s. The set-not-map overlap has the same bound.
The setup-throw pin needs `sse()` to throw on a fresh response, and I found no path that does.
It is still the same class as a fixed sibling, and a one-shape copy of Search's fix.

**Fix (S):** copy Search's shape (outer `try/finally`, `Map<key, holder>`) into both handlers.
**Files:** `src/routes.ts` (two handlers). Same cluster as X4.

### X6 — R4's count is 11; the real count is 16 (correction)

**GPT Z2.6: CONFIRMED at 16.** GPT's structural script (re-run) lists 16 rows that declare
`article: "first-capture"` and also wrap `withSpendAttribution` in the handler. R4 lists the first
11 (8612…9526). The other five, all real: `/api/chat/:slug/:id/spoken` (~9621), `SEARCHES_PATTERN`
POST (~9710), `CRITERIA_PATTERN` POST (~9796), `REFEREE_CLAIMS_PATTERN` POST (~9871),
`/api/referee/mirror/:slug` POST (~9938). Fix as R4; use the AST contract rule R4 offers, so the
count cannot drift again. **Files:** `src/routes.ts`.

### X7 — High-power admission re-implements `admitOrResync` (T1)

**GPT Z2.7: CONFIRMED.** S · value low · risk low · **proved from code**.
`chargeAndSwitchOnHighPower` calls `resyncAndRetry` directly and repeats the stale-twice → 503
branch that `admitOrResync` owns. The generic fits (`HighPowerSwitch` has a `kind`, its stale arm
is `Stale`), so the call becomes `admitOrResync(ownerId, () => switchOnHighPower(ownerId, slug),
deps, "High-powered AI")`. That deletes ~15 lines and the `case "stale"`; the `never` check still
holds over `Exclude<…, Stale>`. **Files:** `src/billing/admission.ts`.

### X8 — `isAllowed` is a constant `true`, and its comment describes the deleted shared shelf (T1)

**GPT Z2.8: CONFIRMED.** S · value low · risk low. `src/auth.ts` § `isAllowed` returns `true`;
the `[auth-beta]` 403 is unreachable (`rg auth-beta` finds only its own line). The comment says
`currentOwnerId()` "is still process-wide and the reads do not filter by owner". That has been
false since owner-scoped reads landed. **Fix:** delete the function and the refusal; keep Greg's
2026-08-26 quote in `docs/project/auth.md` if it is not already there. **Files:** `src/auth.ts`.

### X9 — Fourteen read hooks put `(err as Error).message` on screen, bypassing `describeFetchFailure` (T1)

**GPT Z3.1: CONFIRMED.** S–M · value medium · risk low · **proved from code**.
`rg -l 'setError\(\(err as Error\)\.message\)' src/web` → 14: useQuotes, useSketch, useArc,
useIllustrated, useDebate, useSkim, useSimple, useTweets, useQuiz, useGlossary, useTimeline,
useFaq, useIdeas, useCitations. A lost connection shows the browser's words ("Load failed" on
Safari — the exact case plan 260924a fixed elsewhere), and a programming fault shows its own
text, unreported. Plan 260924a § *Out of scope* left these hooks unaudited, so this is its
recorded follow-up, not a re-proposal. **Fix:** `setError(describeFetchFailure(err as Error))`,
plus one table test feeding each hook a bare `TypeError`. **Files:** the 14 hooks — 7 overlap
web-client **W2**'s hooks, so build W2 and X9 together.

### X10 — Keepalive profile and purpose saves leave stale link summaries cached (T0)

**GPT Z3.2: CONFIRMED.** S · value medium · risk low · **proved from code**.
`saveProfile` and `savePurpose` call `forgetSummaries()`; `leaveProfile` and `leavePurpose` (the
`keepalive` paths) do not. Since 2026-10-02, `useAutosavedText` fires `leave` **on unmount** — the
profile popover inside a mode band, unmounted by the Dock or an article change, inside a live SPA.
So: edit the description, switch mode, hover a link you hovered before. `loadSummary` returns at
`summaryCache.has(key)` before any server hash comparison, and the card shows the summary written
for the old profile. Live since 2026-10-02. **Fix:** call `forgetSummaries()` in both `leave*`
functions (or when their request settles). The test: unmount a dirty box, then read the cache.
**Files:** `src/web/useProfile.ts`, `src/web/purpose.ts`, one test.

### X11 — Quiz's "hold Regenerate until the replacement is read" reached one of six panels (T1)

**GPT Z3.3: CONFIRMED, and wider: five siblings, not two.** M · value medium · risk medium ·
**proved from code**. `rg -n 'busy: ' src/web --glob '*.tsx'`: Quiz alone has
`|| owner.rewriting`. Summary (`modes/summary/SummaryMode.tsx:112`), Ideas, Glossary, Tweets and
Sketch use `job !== null || starting`. Quiz's hold exists because "a delayed or failed post-job GET
needs another read, never a second paid rewrite" (`b5b21cb56`). In the siblings, the gap between
the job leaving the list and the reload landing — or a reload that fails — shows the old artefact
with an enabled forced Regenerate. Pressing it is a second paid run.
[261002f postmortem](../postmortems/261002f-a-band-local-hold-cannot-protect-a-job-that-outlives-the-band.md)
countermeasure 3 explicitly deferred the cross-mode version. **Fix:** move the hold into the shared
read (where Quiz's lives) one panel at a time, with Quiz's failed-GET test per panel; no generic
hook factory. **Files:** five hooks/panels; IdeasPanel overlaps X9/W2.

### X12 — Metadata's contents mark the wrong section for a reader whose browser font is larger (T0)

**GPT Z3.4: CONFIRMED.** S · value medium · risk low · **proved from code**, not browser-run.
`Metadata.tsx` § Section uses `tw:scroll-mt-24` (Tailwind v4: `24 × 0.25rem` = **6rem**);
`PageContents.tsx` `REACHED_PX = 100`, and both comments say REACHED must stay above the margin.
The app sets no root font size (`rg` over `src/web/**/*.css` finds none), so the browser default
decides. At Chrome's "Large" (20px) the margin is 120px > 100, and a clicked section lands where the
list still marks the previous one — the knife edge the comment describes, now on the wrong side for
readers who chose bigger text. **Fix:** compute the threshold from the element's
`getComputedStyle(el).scrollMarginTop` plus the 4px slack; test with a stubbed computed style.
**Files:** `src/web/PageContents.tsx`.

### X13 — Smaller confirmations

| id | GPT | Verdict | Evidence, and corrected score |
|---|---|---|---|
| X13a | Z1.2 effort cast | **CONFIRMED**, low | `rg 'SPIDERYARN_PIPELINE_EFFORT as Effort' src` → 3 (models.ts, citations.ts, skim.ts). Dev-only (set in neither `.env.local` nor `.env.prod`); an empty value is also passed through. Fix: one parser beside `effortFor`, used by the other two. T1 · S · low |
| X13b | Z1.3 `FetchedDocument` | **CONFIRMED** (representable only) | One producer (`fetch.ts` § return) and one upload caller, both correlated today. Fix: discriminated union, drop `?? ""`. T1 · S · low |
| X13c | Z1.4 block column `$type` | **CONFIRMED** | 15 casts across 5 readers (`rg 'row\.(kind\|role\|treatment) as' src/store` minus feedback/chat); `$type<>` is already used 43× in `schema.ts`. Fix: `$type` on three columns, delete the casts. T1 · S · low–med |
| X13d | Z4.5 env readers | **CONFIRMED**, fails closed | `I-env-readers.ts`: `deploy.ts` § `envFile` drops `export X='…'` and `X = …`, and strips a lone trailing quote from a value (`ab'` → `ab`); the shell readers keep single quotes. Today's files are plain (0 `export` lines). Also **two readers inside `deploy.ts`**: `storageBuckets` uses `readEnvProd` (falls back to the primary's `.env.prod`), `migrationPlan` uses `envFile` (this checkout only). Fix: `migrationPlan` and the `.env.local` read use `parseEnvFile`/`readEnvProd`. T1 · S · med (deploy bar) |
| X13e | Z4.6 fetch without abort | **OVERSTATED** | True that no `fetch` in `deploy.ts` has a signal, but Node's bundled undici times out headers and body at 300 s each by default, so a stall outlives the 12-minute poll by minutes, not indefinitely. T1 · S · low |
| X13f | Z4.7 `stage.ts` | **CONFIRMED**, dev tool | `args.includes("--force")` + `filter(!startsWith("--"))`: `--froce` is an unforced run, a third positional is ignored. T1 · S · low |
| X13g | Z4.3 `check-remote-auth.sh` | **CONFIRMED mechanically, OVERSTATED** | Fake body `{"google":"false","email":true}` → google ON, exit 0. Supabase returns booleans, so only a schema change reaches it; a missing `github` key also passes the OFF control. Fix: `jq -e '.external.google == true'` and require the controls' keys to be present. T1 · S · low |
| X13h | Z4.8 redirect encoding | **CONFIRMED**, low | Offline `URL` parse: `…/callback?next=a&x=b` truncates `redirect_uri` and adds a stray `x`. Only hand-passed URIs carry a query; the defaults do not. `curl -G --data-urlencode`. T1 · S · low |
| X13i | Z4.4 MCP isolation | **CONFIRMED, timing-dependent** | A fake shared-page server (`I-fake-mcp.mjs`) was **caught** when both navigations overlapped, and **passed both** when one server booted 800 ms later. Each instance checks only its own response, so isolation is checked only when the timing happens to overlap. Both servers are registered `--isolated` (`claude mcp get`), so the profile-lock failure — the real risk the check names — is still caught. Fix: keep both alive, navigate both, re-read A. T1 · M · low–med (orchestrator bar) |
| X13j | Z4.9 MCP cleanup | **Hypothesis, unproven** | `child.kill()` on `npx`; whether npm forwards SIGTERM to the server was not measured, and survivors lose stdin when the script exits. Do not build without an orphan observed on the box |
| X13k | Z3.6 `useSourceScan` | **OVERSTATED** | No client deadline, but `vercel.json` `maxDuration: 800` bounds the request; "indefinitely" is ~13 minutes. Worth the existing finite-read helper; T1 · S · low |
| X13l | Z3.8 `discard()` comment | **CONFIRMED** | `useOrderedRead.ts` says "Nothing calls this today"; `useClaims.ts:160,176` uses it as the effect cleanup. Rewrite the comment. T1 · S · low |
| X13m | Z3.5 Mark types, Z3.7 Marginalia URL | **CONFIRMED, low** | Representable invalid states / two translators with one comment saying they must match; no drift found (`Reader.tsx` reads the first `mode`, `last-view.ts` the first `mode` pair). Contract test only |

## Two ways to do one thing, and drift proved

- **Production verifiers:** `check-production-gate.sh` vs `deploy --verify-only`. The fix reached
  one copy only (`3b22e5b7d`) — X2.
- **Env-file readers:** `src/env.ts` § `parseEnvFile` (improved in `75c2d1e35`), `deploy.ts` §
  `envFile`, and three shell `grep | cut | tr` readers — X13d. Two of them sit in one file.
- **Referee vs Search lifetimes:** Search's marker-lifetime fix `1714d1aa3` reached Search only —
  X5. Search's trim fix `e630f17a4` likewise: data-and-pipeline D1.
- **Quiz's replacement hold** reached one of six regenerating panels — X11.
- **`describeFetchFailure`** reached ~21 files; 14 read hooks predate it — X9.
- **`forgetSummaries`** on ordinary saves, not on `leave` — X10.
- **Admission resync policy:** `admitOrResync` vs a hand copy — X7.

## Testability

- `deploy.ts`'s argv handling is module-level constants: no seam, which is why typos were never
  tested. Moving it into `deploy-checks.ts` as a pure `parseDeployArgs(argv, env)` gives it one (X1).
- `scanArticleSource` already takes `read` and `scan` parameters, so X3's regression needs no
  database: the probe here is the test.
- `remote-smoke-mcp-browser.mjs` runs `main()` on import, so a test cannot reach `openPage`
  without copying the file (as the probe did). Exporting `openPage` and guarding `main` is the
  seam X13i's negative control needs.
- The shell checkers are tested only by hand; `PATH`-shimmed fake `curl` (the X2 probe) is a
  workable harness if any of them survive.

## Product simplifications (PRODUCT — not to build without Greg)

- **Drop `?spine=0`** (GPT Z3.9, CONFIRMED). Nothing on screen has written it since 2026-09-05;
  `spineParam` is read in `params.ts`, `layout.ts` and `reader/Reader.tsx` (5 references), and
  `last-view.ts` remembers it. `?text=` was retired by exactly this route on 2026-09-29
  (`url-state.md`). Removes a layout state and a remembered key. Loses: a hand-written link that
  hides the rail.
- **Make `--host` verify-only by definition** (part of X1). Removes the ability to deploy and
  verify a non-production host in one run, which no doc describes wanting.

## Considered and rejected

- **A generic argv library for `scripts/`.** `deploy.ts` needs a closed set and an npm-config
  check; `stage.ts` needs arity. Two small parsers are less than a dependency. Fails YAGNI.
- **Signals on every `deploy.ts` fetch as a separate stage.** Bounded at 300 s by undici already;
  fold it into X1's edit only if it is free.
- **Re-proposing Z2.3/Z2.4/Z2.5** — covered by D3 and R11.
- **Making `check-remote-auth.sh` a TypeScript script.** Its controls design is sound; two `jq`
  comparisons fix the gap.
- **Retiring `check-google-redirect.sh` into deploy.** It answers a different question (Google's
  registration), and has a working negative control.

## One level up

Deploy tooling is **sound in its gates and weak at its front door**. Every judgement in
`deploy.ts` is a tested pure function with negative controls, yet the step that decides *whether
to deploy at all* is three `includes()` calls with no test. For the one script whose mistakes reach
real readers, the mode should be the first thing parsed and the most tested. No T3; X1 is the
structural fix, and it is S.

Across zones the pattern is the sweep's usual one: a fix lands in the copy that hurt and the
siblings wait (X2, X5, X9, X10, X11, X13d). The cheapest guard each time is a red test that iterates
the sibling list, not a shared abstraction.

## Ranked list, clustered by file set

| Rank | Id | Tier | Effort | Why first |
|---|---|---|---|---|
| 1 | X3 | T0 | S | a security scan that reports clean on the attack it exists for; one line + test |
| 2 | X1 | T0 | S | an unintended production deploy from a typo or a missing `--` |
| 3 | X10 | T0 | S | live since 10-02, reader-visible, two lines |
| 4 | X12 | T0 | S | wrong contents mark for readers with large text |
| 5 | X9 (+W2) | T1 | S–M | reader-facing copy rule, 14 hooks |
| 6 | X2 | T1 | S | deletion after X1 |
| 7 | X11 | T1 | M | prevents a second paid run; five panels |
| 8 | X4 + X5 | T1 | M | Referee correctness, with D1/D3 |
| 9 | X13c, X13d, X7, X8, X6 | T1 | S | mechanical deletions |

**Clusters (non-overlapping files):**

- **A — deploy front door:** X1, X2, X13d, X13e → `scripts/deploy.ts`, `scripts/deploy-checks.ts`,
  `tests/deploy-checks.test.ts`, delete `scripts/check-production-gate.sh`,
  `docs/project/{deployment,auth}.md`.
- **B — source scan:** X3 → `src/source-scan.ts`, a new test.
- **C — profile cache:** X10 → `src/web/useProfile.ts`, `src/web/purpose.ts`.
- **D — contents threshold:** X12 → `src/web/PageContents.tsx`.
- **E — read-hook failures:** X9 with web-client W2 → the 14 hooks and 7 panels.
- **F — regenerate hold:** X11 → Summary/Glossary/Tweets/Sketch hooks and panels; Ideas after E.
- **G — Referee:** X4, X5 with data-and-pipeline D1/D3 → `src/store/pg-referee-*.ts`,
  `src/store/contracts.ts`, the two `src/routes.ts` handlers, one migration.
- **H — small, independent:** X6 (routes.ts table rows — sequence after G if both touch routes.ts),
  X7 `admission.ts`, X8 `auth.ts`, X13c `schema.ts` + readers, X13a `models.ts`, X13l
  `useOrderedRead.ts`, X13f/g/h/i the individual scripts.

**Counts by tier:** T0 4 (X1, X3, X10, X12) · T1 20 (X2, X4–X9, X11, X13a–i, X13k–m; X6 is a
correction to R4 rather than a new item) · T2 0 · T3 0 · PRODUCT 2 · hypothesis 1 (X13j).
GPT verdicts: 0 WRONG; OVERSTATED 4 (X5 harm, X13e, X13g, X13k); WIDER than stated 4 (X1, X3,
X6, X11).

Up: [261003f-fifth-codebase-sweep-umbrella.md](../plans/261003f-fifth-codebase-sweep-umbrella.md).
