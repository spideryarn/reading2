# Fifth codebase sweep: the umbrella plan

The audit half of a whole-tree sweep, run on 2026-10-03 the way
[improve-the-codebase.md](../reusable/improve-the-codebase.md) says. **Nothing here is built** except
one tiny fix (§ Already done). This doc lists what was found, groups it into clusters that separate
agents can build without touching each other's files, scores each cluster, and ends with the
decisions that are Greg's. Each cluster is then an ordinary
[engineering-manager.md](../reusable/engineering-manager.md) run, dispatched by the Overseer.

What it is for, in Greg's words (2026-09-30):

> I bet there are bits of the code that have got a bit crufty (e.g. should be refactored, or there
> are multiple code paths that should be amalgamated, or files/functions that got large and could be
> split up, or hotspots that tend to be a source of bugs, or where the docs need updating or adding,
> or where we could rejig things to be more testable, or anything else you notice that would be
> long-term-best for the codebase […] For tiny stuff, just go ahead. For bigger or more
> consequential changes or where there's tradeoffs, hold off on implementing them until we have
> discussed them.

Earlier sweeps: [first](260903a-improve-the-codebase-sweep.md),
[second](260903d-improve-the-codebase-second-sweep.md),
[third](260905b-improve-the-codebase-third-sweep.md),
[fourth](260906h-improve-the-codebase-fourth-sweep.md),
[260908f](260908f-prioritised-spideryarn-codebase-improvements.md), and the
[docs sweep](261001i-docs-and-signposting-sweep.md).

## The short version

- **The architecture is sound in every area looked at.** No rewrite is proposed. All six
  investigations reached the same conclusion from different directions: the recurring failure is
  **a fix or a defence that reached one copy and not its siblings**, or a check that proves less
  than it says.
- **Fifteen live defects (T0)** were found and confirmed by a second model family. The four that
  matter most: a mistyped deploy flag runs a real production deploy; the Referee's injection scan
  misses hidden-Unicode attacks on most stored pages; a stale Referee answer can overwrite a newer
  one; and a failed first read in seven-plus modes leaves the reader with no retry.
- **About seventy cheap, mechanical items (T1)**, most of them deletions: dead routes, a route list
  that is 22 entries out of date, 16 redundant wrappers, 7 redundant key checks, a script that
  passes over a missing app.
- **Seven decisions for Greg**, in § For Greg. None is urgent.

## The investigation docs

One per area, in `docs/investigations/`. Each was written by one model family and reviewed by the
other. Finding ids are local to a doc, so this plan prefixes them.

| Prefix | Doc | Written by | Reviewed by |
|---|---|---|---|
| **SR** | [server request layer](../investigations/261003b-fifth-sweep-server-request-layer.md) (R1–R13) | Opus | GPT Sol |
| **WC** | [web client](../investigations/261003b-fifth-sweep-web-client.md) (W1–W13) | Opus | GPT Sol |
| **DP** | [data model and pipeline](../investigations/261003b-fifth-sweep-data-and-pipeline.md) (D1–D6) | GPT Astra | Opus |
| **DF** | [defences, evals and tooling](../investigations/261003b-fifth-sweep-defences-evals-and-tooling.md) (F1–F10) | GPT Astra | Opus |
| **KN** | [knowledge and postmortem classes](../investigations/261003b-fifth-sweep-knowledge-and-postmortem-classes.md) (K, M, G, E, F, D ids) | Opus | GPT Sol |
| **XZ** | [deploy scripts and cross-zone leads](../investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md) (X1–X13m) | GPT Sol nominated, Opus verified | GPT Sol |

The raw reviews and the breadth pass are kept beside them: `261003b-fifth-sweep-review-*.md` (four)
and `261003b-fifth-sweep-gpt-breadth-nominations.md`.

**The reviews corrected the docs, and the corrections are in this plan, not in the docs.** Where a
doc and this plan disagree, this plan is the later word. § What the reviews changed lists every
correction.

## Scope line

- **Swept:** `src/` (server and `src/web/`), `scripts/`, `tools/fleet/`, `tools/overseer/`,
  `evals/`, `tests/` (as defences, not line by line), `docs/postmortems/` dated 260908 or later
  (64), the six earlier sweep plans, commit bodies since 2026-09-08 (2,288 non-merge commits, 108
  with a body over 15 lines and no doc change), and the 78 files in the agents' memory directory.
- **Measured:** `npm run typecheck` (0 errors, 2,810 files), `npm run lint` (advisory baseline),
  `npm run knip`, `npm run cycles` (0 circular imports), size, churn since 09-08 and fix-commit
  counts per file.
- **Not swept:** `infra/`, `supabase/` migrations as SQL, CSS, `docs/tutorials/`, the marketing
  pages, anything under `data/`.
- **Not run:** the full test suite, a browser, a deploy, any paid model call, any write to a
  database. One local database was read (66 articles) for WC-W1's prevalence figures.
- **What the method cannot see:** races and ordering bugs that exist only at runtime (the ones
  listed here were found by reading two code paths side by side, and are marked *proved from the
  code*, not reproduced); how often a reachable defect actually happens in production; anything
  visual. Every "unused" below is an absence and is only as good as the directories named beside
  it — **re-run the grep before deleting.**
- **Tree audited:** `59bd41171`. Dev moved during the sweep; line numbers are already stale, so
  locate by content.

## Evidence states

Each item carries one, separate from its tier:

- **R** — reproduced (a script or probe ran and showed it).
- **C** — proved from the code (a reachable call path was traced).
- **H** — hypothesis.

"×2" means both model families reached it independently or the second re-reproduced it.

## The measurements, shown

Top hotspots by churn since 09-08 × lines × fix commits since 09-01 (hub files collect broad
commits, so read the fix counts loosely):

| File | Lines | Commits | Fix commits |
|---|---:|---:|---:|
| `src/routes.ts` | 10,616 | 81 | 81 |
| `src/types.ts` (fan-in 954, the highest) | 6,749 | 90 | 69 |
| `src/messages.ts` | 5,662 | 53 | 72 |
| `src/web/reader/Reader.tsx` | 3,475 | 86 | 46 |
| `src/db/schema.ts` | 6,242 | 46 | 47 |
| `src/web/Dock.tsx` | 4,206 | 51 | 53 |
| `src/pipeline.ts` | 4,905 | 48 | 48 |
| `src/web/Metadata.tsx` | 3,932 | 52 | 46 |
| `src/store/pg.ts` | 4,190 | 53 | 41 |
| `src/jobs.ts` | 4,477 | 25 | 42 |

**Size was not the finding in any of them.** `types.ts`, `schema.ts` and `pg.ts` were each read for
"reasons to change" and each is one long file with one reason (DP § `types.ts`); splitting is
rejected again. `routes.ts` is the exception, and only partly — see T3.

Postmortem classes, 64 postmortems since 09-08 grouped into seven families (KN § classes):
A, a check asserts less than it claims (13); B, the comment states the rule and the line below
breaks it, or the instance was fixed and not the class (7); C, layout or scroll computed at the
wrong time (8); D, React store or event timing (8); E, a test depends on state it does not own (6);
F, a model-output contract too strict or leaking (9); G, a timeout or cancel that does not converge
(5). By-construction defences exist for part of A and for C. Clusters 11 and 12 build the missing
ones for G, D and F.

Finding counts as the docs reported them, before review:

| Doc | T0 | T1 | T2 | T3 | PRODUCT |
|---|---:|---:|---:|---:|---:|
| SR | 1 | 10 | 2 | 1 | 2 |
| WC | 3 | 7 | 5 | 0 | 2 |
| DP | 2 | 2 | 2 | 0 | 2 |
| DF | 3 | 6 | 1 | 0 | 1 |
| KN | 0 | 27 | 2 | 0 | 0 |
| XZ | 4 | 20 | 0 | 0 | 2 |

After review: T0 is **15** — 12 distinct in the docs (WC-W11 and DF-F1 are one defect), less DF-F2
and DF-F3 which Opus re-tiered to T1 (an eval control and a latent operator-facing hazard, neither
a defect a reader hits), plus XZ-X4 and X11 promoted by Sol, plus three found by the reviewers (the
`foldWithMap` offset bug, AccessSharing's silent copy, Illustrated's missing retry) —
and seven proposed extractions were cut back as not worth their keep.

## Already done

- **Help page:** the per-voice typefaces are no longer called "experimental" (two places) —
  `59bd41171`. A lead from session fbd896sz.

No product simplification was small enough to make without asking.

## The clusters

Ordered by tier first, then ease × value, because the process doc says the first stage addresses
the highest confirmed tier unless risk vetoes it. **Ease** and **value** are 1–5 (5 is easiest /
most valuable); **risk** is the risk of making the change. File sets are disjoint unless the
"after" column says otherwise.

### Tier 0 — live defects

| # | Cluster | Items | Evidence | Ease | Value | Risk | Files | After |
|---|---|---|---|---:|---:|---|---|---|
| **1** | **Deploy front door** | XZ-X1, X2, X13e | R ×2 | 4 | 5 | low | `scripts/deploy.ts`, `scripts/deploy-checks.ts`, `tests/deploy-checks.test.ts`, delete `scripts/check-production-gate.sh`, `docs/project/deployment.md` | — |
| **2** | **Injection scan decodes stored pages wrongly** | XZ-X3 | R ×2 | 5 | 5 | low | `src/source-scan.ts`, one new test | — |
| **3** | **Two one-file reader fixes** | WC-W1, XZ-X12 | R (W1 on local data), R (X12 geometry) | 5 | 3 | low | `src/web/Spine.tsx`, `tests/spine-card.test.tsx`; `src/web/PageContents.tsx` | — |
| **4** | **Shelf link finds nothing for an accented word** | WC-W11 = DF-F1, plus the `foldWithMap` offset bug | R ×2 | 3 | 3 | low | `src/web/library-hits.ts` (which owns `foldWithMap`), `src/web/Library.tsx` (snippet only), `tests/library-hits.test.ts` | — |
| **5** | **A failed read is a dead end; raw error text on screen; Regenerate re-arms early** | WC-W2, XZ-X9, XZ-X11, Illustrated's retry | C ×2 | 2 | 4 | med | the 14 read hooks XZ-X9 lists and the panels WC-W2 and XZ-X11 list, `FaqPanel.tsx`, `IllustratedView.tsx`, a new `ReadError.tsx`, one mode-matrix test | — |
| **6** | **Referee runs can lose or overwrite answers** | DP-D1, DP-D3, XZ-X4, XZ-X5 | R (D1), C ×2 (rest) | 2 | 4 | med-high | `src/store/pg-referee-*.ts`, `src/store/pg-searches.ts`, `src/store/contracts.ts`, `src/searches.ts`, `src/referee-criteria-store.ts`, the Referee handlers in `src/routes.ts`, possibly one migration | — |
| **7** | **Link summaries survive a profile change** | XZ-X10 | R ×2 | 3 | 3 | med | `src/web/link-facts.ts`, `src/web/useProfile.ts`, `src/web/purpose.ts`, `src/web/useAutosavedText.ts` | — |
| **8** | **`routes.ts` small edits** (one agent, in this order) | SR-R1 (T0), R5, R4 = XZ-X6, R7, R9, R11, R10; XZ-X8, XZ-X7 | R (R1), C (rest) | 4 | 3 | low | `src/routes.ts`, `src/public/routes.ts` (the one `slugFrom` message), `src/auth.ts`, `src/billing/admission.ts`, `tests/authenticated-api-route-contract.test.ts` | **6** (both edit `routes.ts`) |
| **10** | **Illustrated loses the refusal sentence** | DP-D2 | C ×2 | 4 | 2 | low | `src/illustrated.ts`, `src/job-failure.ts` (a false comment), one test | — |

What each is, plainly:

1. **Deploy front door.** `scripts/deploy.ts` decides its mode with `argv.includes`, and anything it
   does not recognise means "deploy for real". So `--verify-onyl`, `--dryrun`, or
   `npm run deploy --verify-only` without the `--` (npm 11 swallows the flag) each run the gates,
   then the remote migrations, then the push to `main`. `--host` does the same, though
   [deployment.md](../project/deployment.md) describes it as a verification. **Fix:** a small
   explicit mode parser that refuses anything unknown, and also refuses when npm has swallowed a
   flag — *including a misspelled one* (`npm_config_verify_onyl`), which Sol showed a list of known
   names would miss. Test the two mistakes in combination. Make `--host` verify-only. Give the two
   `fetch` calls a deadline (a trickling body can outlive the poll and hold the deploy lock). Delete
   `check-production-gate.sh` — it passes over a page with no app, nothing calls it (grepped
   `scripts/`, `package.json`, `tools/`, docs) — after porting its one unique check
   (`DELETE /api/health` answers 405) into deploy's own verify step. Sol also found that deploy's
   stronger `verifyPage` accepts HTML served at a JavaScript URL; fix it here. This is
   orchestrator-tier tooling, so it gets the higher bar.
2. **Injection scan.** Fetch stores every page as UTF-8. The Referee's source scan then re-sniffs
   the charset from the stored bytes with no HTTP header, so a page with no `<meta charset>` is
   decoded as windows-1252, and zero-width and tag-character injections produce **0 findings** where
   the same page with the tag produces 2. ASCII hidden text is still caught, so the scan is partly
   blind, not wholly. **Fix:** decode stored HTML as UTF-8 at that boundary — one line — and a
   storage round-trip test.
3. **Two one-file reader fixes.** *Spine card (the Overseer's lead):* a part's heading block lands
   as the first leaf of its first section, so the hover card's first bullet repeats a row the new
   outline shows two lines above. On the local database, 531 of 1,321 cards start with a heading
   leaf and about 319 (24%) repeat a row exactly. **Fix:** in `BandCard`, drop a bullet whose text
   is already a row in `where`, before the `+ n more` count; red test first with heading leaves in
   the fixture (it has none, which is why nothing caught it). No new helper. Do not filter on
   `startsAtHeading`: that would also drop 257 real sub-headings. If Greg says yes to For Greg 1,
   this fix is replaced by a deletion. *Contents list:* Metadata's sections land at `6rem` and
   "reached" means within 100px; at a 20px root font that is 120px, so the previous entry stays
   marked. **Fix:** derive the threshold from the scroll margin.
4. **Shelf passage link.** `libraryHitHref` sends the accent-stripped term (`café` → `cafe`), and
   find-on-page only folds case, so the link highlights nothing; `tests/library-hits.test.ts` pins
   the wrong value. **Fix:** send the hit's own spelling. But first fix `foldWithMap`, which indexes
   code points while its callers index UTF-16 units (`"😀 café"` → the slice yields `afé`), and
   handle a one-character ligature needle.
5. **Read failures.** FAQ gained a read-only retry in `418a3d57f`; the fix reached four of the
   bands. In Ideas, Timeline, Quotes, Debate, Glossary, Citations, Quiz and Illustrated a failed
   first read shows an error with no retry in the band (closing and reopening the mode does work).
   Fourteen hooks also put `(err as Error).message` on screen instead of going through
   `describeFetchFailure`. And Quiz holds its Regenerate button until the replacement has been read;
   Summary, Ideas, Glossary, Tweets and Sketch do not, so a slow or failed reload re-enables a second
   paid run against the old artefact. **Fix:** `retryRead` in each hook, one shared `ReadError`
   presentation, `describeFetchFailure` in the 14, the hold in the five — and **one mode-matrix
   test** that iterates the modes and goes red at the one that was missed, because "the fix landed
   only in the mode being built" is the pattern found three times. No generic hook factory (rejected
   by earlier sweeps and again here). This is the largest T0 cluster; it can be staged hook by hook.
6. **Referee runs.** Four related holes. History trimming's SQL has no `pending` filter, so it can
   delete a criterion that is still being answered (reproduced as a pure decision). Claims' `finish`
   updates by article id with no attempt token, so with two tabs an old answer overwrites the newer
   run. Criteria and Claims release their live marker before `finish`, where Search's repaired path
   (`1714d1aa3`) holds it through. And the store contracts still make attempt tokens optional — a
   leftover of the deleted filesystem store (unfinished Stage H of
   [260903f](260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md)). **Fix:** filter
   the SQL; delete the unused "trimmed list" return from `withRun` and `withCriterion`; give Claims
   Criteria's attempt fence; extend the marker lifetime the way Search does; make the tokens
   required (splitting `appendSpoken`'s return type, which legitimately has none). Sol adds that
   Claims loads blocks before `begin` fingerprints the revision, so a re-extraction in between
   mislabels the input — fence that in the same change. No generic registry.
7. **Link summaries.** A profile or purpose save made as its box unmounts skips
   `forgetSummaries()`. Sol showed the hole is wider: an in-flight summary that completes after the
   cache was cleared refills it. **Fix:** a small generation fence in `link-facts.ts`, not the
   two-line patch the doc proposed.
8. **`routes.ts` small edits.** `part()` turns `/api/…/%E0` into a 500 and a Sentry report; the
   public copy was fixed on 08-28 (R1, the T0 — do it first). Then deletions: the route list in the
   file's header (85 lines against 106 routes, 22 missing, and where new-route merges collide); the
   16 inner `withSpendAttribution` wraps the dispatcher already does (not a double charge, two edit
   sites); the `/find` compatibility route kept "for one deploy" three deploys ago; the
   `ENOENT → 404` mapping whose producers went with the filesystem store; request values
   interpolated into logged refusal messages (both `slugPart` and public `slugFrom`); the constant
   `isAllowed` beta gate and its obsolete comment; high-power admission's private copy of
   `admitOrResync`. R10 becomes a comment that states each stream's actual disconnect policy.
9. **Evals.** `toc10-frozen.ts` imports `TOC10_SYSTEM`, which interpolates the live `plainWords()`
   and `paperwork()` rules, and its test was updated along with them (`9ac3ee21b`), so the
   historical control moves with every rule edit. **Census: one affected frozen definition, zero
   others** (163 eval source files, 66 using the vocabulary, each checked; both families agree).
   **Fix:** pin the rendered prompt text from the right commit with a digest. Not "ban `src/`
   imports in frozen files", which forbids harmless types and misses indirect dependencies.
   Alongside: paperwork comparisons skip missing and failed counterparts without changing the
   denominator; two Structure eval paths accept a truncated answer production would refuse; and
   provenance hashes cover a hand-kept file list rather than the request actually sent (F5 — the
   reviewer judged the full fix too big for its value; do the cheap before-and-after source check
   only).
10. **Illustrated refusal.** One `MODEL_REFUSED` throw site is undeclared, so the reader gets the
    generic sentence instead of the specific one. `noteUndeclaredBlocked` already logs a warning for
    exactly this, so the logs say how often. A comment in `job-failure.ts` claims all ten sites are
    declared; it is false.
11. **Blocking child processes.** Postmortem
    [260910a](../postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md)
    showed a synchronous `timeout:` signals and then keeps waiting, which freezes the dashboard's
    event loop — the tool you reach for when the box is struggling. The owned-child fix reached the
    collector and not its siblings. Three counts were made and they differ by definition: Astra's AST
    census finds 26 `execFileSync` calls with a `timeout` in `scripts/` and `tools/`; a grep window
    gave 44; the reviewing Opus's AST census of every sync child call with a literal timeout
    (`J-sync-census.mjs`) gives **39, 18 in `tools/`, 15 of them reachable from a request, a timer
    or the daemon loop** — including `work-probe.ts`, which runs on every daemon tick and which
    Astra's list missed. Use the 39/18/15 census; re-run it before building. **Stage 1:** convert the read-only probes
    (health, readiness, rename, attention, usage, report artefacts) to the existing owner, and add
    the guard 260910a proposed and nobody built: a test that walks imports from the dashboard server
    and the daemon's composition roots — including the callbacks `scripts/overseer.ts` injects — and
    fails on a sync child call, with a named list of exceptions that may only shrink. **Not in this
    cluster:** steering. Its synchronous send is what currently provides mutual exclusion
    (`drain.ts` relies on never yielding), so making it async needs per-target serialisation in the
    same change. That is its own plan. Also here: the daemon tests that sleep 40–60ms and then assert
    that nothing happened (they pass vacuously if no tick ran) move onto the existing
    `tests/helpers/overseer-until.ts`.

### Tier 1 — cheap, mechanical, evidence in hand

Clusters 9 and 11 were filed T0 by Astra and re-tiered T1 by the Opus review; their explanations are
in the list above, where they were first written. 11 is orchestrator-tier, so it still goes early.

| # | Cluster | Items | Evidence | Ease | Value | Risk | Files | After |
|---|---|---|---|---:|---:|---|---|---|
| **9** | **The "frozen" eval control is not frozen, and eval comparisons can shrink silently** | DF-F2, F6, F7, F5 | C ×2 | 3 | 3 | low | `evals/structure-whole-document/toc10-frozen.ts` and its test, `evals/paperwork/`, `evals/plain-words/`, `evals/quiz-*` | — |
| **11** | **The dashboard and the Overseer daemon can block on a child process** | DF-F3 (stage 1 only), KN-G1, DF-F4, KN-G2 | C ×2 | 2 | 4 | med (stage 1); **high** for steering, which is its own later job | `tools/fleet/health.ts`, `readiness-wiring.ts`, `routes-rename.ts`, `routes-actions.ts`, `tools/overseer/{attention-probe,report-artefacts,usage,work-probe}.ts`, `tools/fleet/drain.ts` (comment only), `tests/fleet-imports.test.ts`, the four `tests/overseer-daemon*.test.ts` files | — |
| **12** | **Model-call plumbing** | SR-R3, R2, R6, XZ-X13a | R (R2), C (rest) | 4 | 3 | low | `src/ai-call.ts`, `src/fetch.ts`, `src/converse.ts`, `src/explain.ts`, `src/quiz-mark.ts`, `src/search.ts`, `src/referee-claims-run.ts`, `src/referee-criteria-run.ts`, `src/referee-mirror.ts`, `src/transcribe.ts`, `src/embeddings.ts`, `src/messages.ts`, `src/models.ts`, `src/citations.ts`, `src/skim.ts` | — |
| **13** | **Two lint rules become gates; one census test** | KN-D1, DF-F8, KN-F1, DF-F9 | R (D1's 13 diagnostics) | 3 | 4 | low | `biome.json`, the check scripts, the 13 client files D1 names, `knip` config, one new test | **5** (shares hooks) |
| **14** | **Docs: knowledge that never reached its owner** | KN-K1–K13, E2, M7 | C, each owner doc's contents read | 5 | 3 | low | `docs/project/{overseer-direction,overseer,hetzner-remote-server-box,fleet-dashboard-modes,ai-gateway,dictation,granularity-zoom,testing,feedback-reports}.md`, `tools/overseer/decisions.ts` (a stale comment), `drizzle.config.ts` | — |
| **15** | **Lock and tooltip tests that wait on the clock** | SR-R13, WC-W9 | C | 3 | 3 | low | `tests/billing-vouchers.test.ts`, `tests/public-visibility-pg.test.ts`, the tooltip tests | — |
| **16** | **Small script fixes** | XZ-X13f, g, h, i (= DF-F10), d | R (f–i) | 4 | 2 | low | `scripts/stage.ts`, `scripts/check-remote-auth.sh`, `scripts/check-google-redirect.sh`, `scripts/remote-smoke-mcp-browser.mjs` | **1** (X13d touches `deploy.ts`) |
| **17** | **Boundary types** | XZ-X13b, X13c, DP-D4, XZ-X13l | C | 4 | 2 | low | `src/fetch.ts` (the `FetchedDocument` union), `src/db/schema.ts` + 5 readers (15 casts), comments in `src/types.ts`/`src/step-order.ts`/`src/models.ts`, `src/web/useOrderedRead.ts` | **12** (`fetch.ts`) |
| **18** | **Client tidy** | WC-W3 step 1, W7, W8 (guard only, plus AccessSharing's silent copy, which Sol rates a small T0), W13 (dictation `busy` only), W5 (hoist the existing boolean only) | C | 4 | 2 | low | `GlossaryPanel.tsx`, `CitationsPanel.tsx`, `ThresholdSlider.tsx`, `Metadata.tsx`, `ViewportProbe.tsx`, `AccessSharing.tsx`, the dictation hook and its 5 callers, `reader/Reader.tsx` | **5** (Glossary and Citations panels) |

12. **Model-call plumbing.** Seven of eight hand-rolled `OPENROUTER_API_KEY` checks read a key
    nothing then uses and repeat the gateway's own check (transcription's is different and stays);
    each calls `loadEnvLocal()` in a request path against the documented rule, as does
    `embeddings.ts`. Delete the seven, log once in `apiKey()`. Two exported `Retry-After` parsers
    disagree on five inputs (`"1.5"` → 1500 vs 0): one parser, and decide zero and past-date
    behaviour on purpose. The two `[ai-unusable]` sentences move into `messages.ts` (open since the
    second sweep). Three unchecked `SPIDERYARN_PIPELINE_EFFORT as Effort` casts get one parser.
13. **Gates.** Biome's `useExhaustiveDependencies` has 13 findings today (3 missing, 10 extra);
    suppress each with a reason and make it a gate — it would have caught postmortem 260916a. The
    floating-promise rule works and is advisory; make that one rule a gate. A test that every model
    call parsing JSON uses the structured-output adapter or is a named exception (count calls, not
    files that mention the adapter — Sol). Knip's 14 "unused" research scripts are documented entry
    points: fix the knip config, do not delete them.
14. **Docs.** Thirteen facts that live only in a commit body or the code: `overseer-direction.md`
    says multi-account was never built (it shipped 09-10); `feedback-reports.md` says only Greg
    deploys while `overseer.md` gives it to the Overseer; `granularity-zoom.md`'s copied `TreeNode`
    lacks the `question` field added 09-05 (delete the copy, point at the type). None of these edits
    a rule's wording, so none needs approval. The ones that do are in For Greg 7.
15. **Timing tests.** The billing lock tests prove "blocked" by sleeping 400ms. Reuse
    `waitUntilBlockedBy` from `tests/store-job-draft.test.ts`, which names the blocking backend.
    Tooltip tests: 53 real waits of 300–500ms (about 20s in total); convert the hover-delay ones to
    fake timers. No universal helper.
16–18 are as their rows say. In 18, Sol cut five proposed extractions down to their cheap core:
    reuse what exists, add no new abstraction.

### Tier 2 — extractions worth doing, each with a test first

| # | Cluster | Items | Ease | Value | Risk | Files | After |
|---|---|---|---:|---:|---|---|---|
| **19** | **One helper for reading a Messages result** | DP-D6 | 2 | 3 | med | a helper beside `wasRefused`/`truncationFailure`, then the 17 stage files (30 copies) | **10**, **12** |
| **20** | **A copy-button hook** (token, timer, result) | WC-W12, W8 | 3 | 2 | low | the 8 clipboard files plus `FeedbackDialog.tsx` | **18** |
| **21** | **Freshness: an agreement test, then maybe an extraction** | DP-D5 | 3 | 2 | low | one new test first | — |
| **22** | **Live conversation: the tap policy as a pure function** | WC-W10 (tap only) | 2 | 2 | med | `src/web/live/*` | — |

19 is the still-open "DOC #7" from an earlier sweep, now with drift proved (D2 is an instance of
it). Both reviewers say it earns its keep; build it from the two existing predicates, not from
`stream-run.ts`, which does a different job.

### Tier 3 — named and sized, not started

- **Split `routes.ts` by reason, keeping the one table (SR-R12).** The file has distinct feature
  regions that are reached only from route-table rows, so moving handler bodies out concentrates
  each feature without creating a second dispatcher (which the earlier sweep rejected). But Sol
  found the claimed isolation is not quite true — Referee calls a helper defined in Search's region
  — and that size alone does not justify six to eight slices. **Sized:** one slice (chat), M, after
  clusters 6 and 8 have landed; then stop and measure whether merges and review got easier. At
  least eight tests read `routes.ts` as text and will need to follow. The wider programme is **not
  accepted**.
- **Async steering for the fleet dashboard** (the rest of DF-F3). L, high risk, its own plan.

## For Greg

Seven decisions. None blocks the clusters above except where it says so.

**1. Drop the bullet list from the spine's hover card?**
When you point at the spine, each section's card shows an outline of where it sits, its gist, and
then up to five bullets. Those bullets are the short labels of the section's first paragraphs (or
its headings). Since 10-03 the card also has the outline, and the bullets are where the "repeated
heading" bug lives.
- *Removes:* the bullet list, the "+ n more" line, and the code that picks and filters them
  (`childLabel`, `MAX_CHILDREN`). Cluster 3's spine fix becomes a deletion.
- *Costs:* a reader loses the peek at the first few paragraph labels of a section they have not
  reached. The gist and outline stay.
- *If you say no:* cluster 3 fixes the repetition and keeps the list. Either way the bug goes.

**2. Retire `?spine=0`?**
A hand-typed URL can still hide the spine, and the app remembers it, though no control has written
it since 09-05. `?text=` was retired the same way on 09-29.
- *Removes:* one layout state and one remembered setting (5 references).
- *Costs:* an old link that hides the spine would show it. Sol's caution: nothing shows readers
  benefit, so this is purely about fewer states to keep working. Low priority.

**3. One word and one track for the threshold sliders?**
Six mode panels have a slider that hides weaker results. They call it "threshold", "bar" or
"confidence", and there are two designs: Search runs 0–100 always; Quotes and Debate have "stops"
at the scores that exist.
- *Removes:* if every slider used stops and one word, four copies collapse into the one shared
  component by deletion.
- *Costs:* Search loses its fixed 0–100 scale, which was chosen on purpose because results stream
  in and stops would jump about.
- *If you say no:* cluster 18 still moves the two exact copies (Glossary, Citations) onto the shared
  component; the other four stay as they are.

**4. Stop a paid answer when the reader walks away from it?**
For Search, Referee criteria and claims, and comment explanations, if the reader closes the tab
mid-answer the model call carries on and the result is saved for when they come back. Seven of ten
streaming routes behave this way; three cancel.
- *Removes:* paid calls nobody is watching, and the question "which streams cancel?" gets one
  answer.
- *Costs:* a reader who leaves and returns finds the answer missing and has to ask again.
- No recommendation; it is a real trade between cost and convenience. Cluster 8 only documents what
  each stream does today.

**5. One sentence when the AI's answer is unusable in Referee?**
There are two near-identical failure sentences sharing one code, differing in "pointed at passages"
against "returned". *Removes* one sentence and a standing exception to "one code, one sentence".
*Costs* that small distinction in a failure line. Tiny — say yes and cluster 12 does it.

**6. Flip `STEP_START_DRAFT_SWEEP` from "count" to "delete"?**
Carried over from the earlier sweeps and still waiting on you (`pg-revisions.ts`). It only counts
stale drafts today rather than removing them. It deletes data, so it is yours.

**7. Edits to docs whose wording is a rule.**
Seven facts sit in one agent's memory and belong in a doc every agent reads. Because they change
instructions, each goes through
[edit-important-docs.md](../reusable/edit-important-docs.md), before and after shown:
- `overseer.md` § The tick still tells the Overseer to ration weekly usage over seven days. Your
  rule of 10-01 is the opposite (run to 100%), and the Overseer paused this very sweep on the old
  wording. **Replace, don't append.** This is the one worth doing today.
- `hetzner-remote-server-box.md`: `SUPABASE_ACCESS_TOKEN` needs a fresh yes from you each use.
- `version-control.md`: pull on waking; a refused merge can wipe uncommitted edits; and it still
  describes a round trip to you for every merge conflict, which the reusable conflict doc no longer
  asks for.
- `docs/reusable/`: three delegation lessons into `engineering-manager.md`; a provenance warning
  into `codex-cli-as-subagent.md`. Sol judged the proposed additions to `silent-success.md` and
  `long-waits.md` as examples of classes already taught, so those two are dropped.

Not for you, recorded so nobody asks: making `--host` verify-only is folded into cluster 1 (the docs
already describe it that way). Removing the cross-step prompt-cache marking that never fires is a
code decision; it waits for a cost measurement, not a product call. Removing Referee's automatic
history trimming, and removing steering from the dashboard, were both raised and **not
recommended**.

## What the reviews changed

Shown so the next reader can see which claims were tested and which fell.

**GPT Sol on SR and WC** (26 findings: 15 confirmed, 11 overstated, 0 wrong):
- Counts corrected: R4 is 16 wrappers, not 11; R5's header has 85 route lines and 22 omissions, not
  77 and "a third"; R10 is seven streams, not five; W9 is 53 long waits, not 51; W8 is eight
  executable writes, not thirteen.
- Cut back: R8 (moving nine identical `httpError` constructors re-proposes an earlier rejection
  with no drift in them — only the shared decoding leaf survives, and R1's local fix does not need
  it); W5 (no new `bandCoverage` object); W6 (deferred); W10 (tap policy only); W13 (the three
  search predicates answer different questions); W3 step 2 (needs an interface demonstration first).
- Order corrected: R1 before R3.
- Missed, now in clusters: `foldWithMap`'s offsets (4), AccessSharing's silent copy (18),
  Illustrated's retry (5), FeedbackDialog's copy (20), `embeddings.ts`'s env reload (12),
  `waitUntilBlockedBy` (15).

**Opus on DP** (6 findings, all confirmed; every quantifier re-run and matched):
- D1's fix changed: the pure trimmed list is never read in production, so fix the SQL and delete
  the list.
- D3 is not new: unfinished Stage H of 260903f.
- D4: the cross-step cache marking never fires today.
- The Referee live-set ordering lead is effectively unreachable; dropped.

**GPT Sol on KN and XZ** (54 findings: 39 confirmed, 11 overstated, 2 unverifiable and held, and 2
where the doc's own downgrade was wrong):
- Promoted to T0: X4 and X11; X10 stays T0 but grows from S to M. X13e and X13k restored to real T1s (undici's body timeout resets on
  every chunk; a server's `maxDuration` does not bound a browser's read).
- X1's fix must cover a swallowed *misspelled* flag. X10 needs a generation fence. X3 is a partial
  blindness (Unicode only), still T0.
- KN: G1's exposed list sums to 14, not 13, and its roots must include injected callbacks; F1 has
  19 importers, not 21; E1 and E3 held; M6 and M8 dropped; the proposed postmortem-defence status
  table rejected as one more unchecked inventory.
- Missed: Claims fingerprints input it may not have sent (6); `verifyPage` accepts HTML for a JS
  asset (1); `deploy.ts` hard-codes the migration table name in two queries (14, with K13).

**Opus on DF** (10 findings, all real; the ranking was inflated):
- F1 confirmed and reproduced (also a curly apostrophe and a ligature give 0 hits).
- F2 is T1, not T0: an eval control, already recorded in
  [261003a](../investigations/261003a-summary-and-structure-skip-the-front-matter-prompt-eval.md).
  The census of one was spot-checked, not re-run in full.
- F3 is T1 and splits three ways: the guard (S, a flat allowlist), the read-only probes (M),
  steering (T2, L, deferred). Count corrected as in cluster 11.
- F8: the floating-promise rule has a baseline of **1** and runs in 5.6s, so it is gateable now.
- F9: keep 12 of the 14 scripts; the `260930a` pair imports live prompt wording, so freeze or
  delete those two.
- F5's proposed fix is too big for its value; F7 and F10 are low value. F4's value is medium.
- Missed: commit `9ac3ee21b` changed Structure's prompt wording without bumping the `toc/12`
  version stamp — **hypothesis**, production effect unverified, check it in cluster 9; 16 private
  `waitFor` helpers in tests; knip's unused-files check becomes gateable once F9 is fixed (13).

## Considered and rejected

For the next sweep's search. Earlier rejections that were raised again and stay rejected are marked
*(again)*.

- Splitting `types.ts`, `schema.ts`, `pg.ts`, `Reader.tsx`, `Dock.tsx` or `Metadata.tsx` by size
  *(again)* — each has one reason to change, or no drift.
- A mode registry, a generic artefact-read hook, a generic stream shell on either side *(again)*.
  The mode-matrix test in cluster 5 is the lever instead: it finds the mode a fix missed without
  coupling the modes.
- Moving the nine `httpError` constructors into one module *(again)* — identical, stable, no drift.
- Narrowing `isAdmin`'s parameter *(again)* — 16 server call sites read, none takes an id from a
  request.
- Wrapping the module-scope registries in `processSingleton` *(again)*.
- One per-step registry owning models, storage, order and prompts — couples separate policies. The
  "high effort table repeated for the third time" lead was factually wrong: those are prose, and the
  compiler already checks the step tables (DP § Step registration).
- Merging Search's and Referee's retry state machines — their product behaviour differs.
- A generic argv library for `scripts/`; a TypeScript rewrite of `check-remote-auth.sh`.
- A blanket ban on sleeps in tests; faking the daemon's clocks *(again)*; raising timeouts.
- Banning `src/` imports in frozen eval files; copying every live prompt into `evals/`.
- Deleting knip's 14 flagged scripts; pruning the 463 flagged exports *(again)*; promoting all of
  lint or knip to a gate *(again)*.
- A meta-test that every "must agree" comment names its test — 65 hits, mostly invariants.
- A `Mark` type restructure, a tracked-fixture-path checker, a `import.meta.url` ban — no second
  instance yet.
- New Sentry alerts — no incident replay shows one would have fired, and the two classes that
  matter most here (a moving eval baseline, a blocked event loop) cannot report themselves.
- Bulk-moving the agents' memory into docs — beyond the items in cluster 14 and For Greg 7, that is
  the memory owner's call.

## One level up

**Is the overall approach sound? Yes, in every area.** One store, stable block ids, an ordered route
table with one gate, explicit pipeline stages, a client built on URL state and ordered reads, a
deploy with real gates. Nothing found argues for a different design.

What the tree does have is one habit, seen in all six investigations: **work is built in the mode,
route or script at hand, and a fix made there does not travel.** FAQ's retry reached four bands of
eleven. Search's marker lifetime did not reach Referee. The public route's decode fix did not reach
the authenticated one. The owned-child fix reached one collector. The deploy verifier's hardening
did not reach the older script. Each time the two copies were both valid code, so nothing went red.

The cheapest answer is the same each time, and it is not a shared abstraction: **a test that
iterates the siblings** (the mode matrix in 5, the import-walk in 11, the structured-output census
in 13), or a required type where the siblings share a contract (the attempt tokens in 6). Where
ownership or identity is the real problem (7, and the Claims fingerprint in 6), a sibling test is
not enough and a small fence is.

Much of the T1 list is also one event's unfinished business: the filesystem store was deleted in
early September, and optional tokens, the `ENOENT` mapping, unused return values and several
comments still describe it.

## Review status

- Each investigation doc: reviewed by the other model family (table above).
- This umbrella: GPT Sol, read-only, up to two rounds — recorded below.

## What happens next

The Overseer dispatches clusters as separate engineering-manager runs. Suggested first wave, all
with disjoint files: **1, 2, 3, 4, 9**. Second wave: **6** (then **8**), **5**, **7**, **11** stage 1, **10**.
Cluster 14 (docs) can run at any time. Before each: re-run the cluster's greps against the tree of
the day, because this audit's tree is already behind.
