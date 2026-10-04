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
- **Fifteen live defects (T0)**, each confirmed by a second model family. The four that matter
  most: a mistyped deploy flag runs a real production deploy; the Referee's injection scan misses
  hidden-Unicode attacks on most stored pages; a stale Referee answer can overwrite a newer one;
  and a failed first read in eight modes leaves the reader with no retry in the panel.
- **About seventy cheap, mechanical items (T1)**, most of them deletions: dead routes, a route list
  22 entries out of date, 16 redundant wrappers, 7 redundant key checks, a script that passes over a
  missing app.
- **Seven decisions for Greg**, in § For Greg. One is worth doing today (7, the Overseer's usage
  rule); the rest can wait.

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
  with a body over 15 lines and no doc change), and the 77 files in the agents' memory directory.
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

"×2" means the second model family re-reproduced or re-traced it.

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

**Size was not the finding in any of them.** `types.ts` has six active reasons to change (DP
§ `types.ts`), but its dependents are almost all type-only imports and no measured benefit supports
a split, so splitting is rejected again; likewise `schema.ts` and `pg.ts`. `routes.ts` is the
exception, and only partly — see Tier 3.

Postmortem classes: 64 postmortems since 09-08 were grouped into seven families
(KN § classes). The family counts as reported sum to 56, not 64, and the difference was not
resolved — treat the counts as approximate: A, a check asserts less than it claims (13); B, the comment
states the rule and the line below breaks it, or the instance was fixed and not the class (7); C,
layout or scroll computed at the wrong time (8); D, React store or event timing (8); E, a test
depends on state it does not own (6); F, a model-output contract too strict or leaking (9); G, a
timeout or cancel that does not converge (5). By-construction defences exist for part of A and for
C. Clusters 11 and 13 build the missing ones for G, D and F.

Finding counts as the docs reported them, before review (GPT Sol re-added these and they match):

| Doc | T0 | T1 | T2 | T3 | PRODUCT |
|---|---:|---:|---:|---:|---:|
| SR | 1 | 10 | 2 | 1 | 2 |
| WC | 3 | 7 | 5 | 0 | 2 |
| DP | 2 | 2 | 2 | 0 | 2 |
| DF | 3 | 6 | 1 | 0 | 1 |
| KN | 0 | 27 | 2 | 0 | 0 |
| XZ | 4 | 20 | 0 | 0 | 2 |
| **Total** | **13** | **72** | **12** | **1** | **9** |

(SR-R12 is counted under both T2 and T3: a first slice and the wider programme.)

After review: T0 is **15** — 13, less one duplicate (WC-W11 and DF-F1 are one defect), less DF-F2
and DF-F3 which Opus re-tiered to T1 (an eval control and a latent operator-facing hazard, neither a
defect a reader hits), plus XZ-X4 and X11 promoted by Sol, plus three found by the reviewers (the
`foldWithMap` offset bug, AccessSharing's silent copy, Illustrated's missing retry). Seven proposed
extractions were cut back as not worth their keep.

## Already done

- **Help page:** the per-voice typefaces are no longer called "experimental" (two places) —
  `59bd41171`. A lead from session fbd896sz.

No product simplification was made in this run. One is small enough to just make, and is assigned
to cluster 12 rather than held for Greg: one failure sentence for Referee's unusable answer.

## The clusters

Ordered by tier first, then ease × value, because the process doc says the first stage addresses
the highest confirmed tier unless risk vetoes it. **Ease** and **value** are 1–5 (5 is easiest /
most valuable); **risk** is the risk of making the change. **A cluster's file set is disjoint from
every other's unless its "After" column names the cluster it must follow.** Sol checked the
manifests against the tree; the edges it found are in.

### Tier 0 — live defects

| # | Cluster | Items | Evidence | Ease | Value | Risk | Files | After |
|---|---|---|---|---:|---:|---|---|---|
| **1** | **Deploy front door** | XZ-X1, X2, X13e, X13d (the `deploy.ts` half), and the `deploy.ts` half of KN-K13 | R ×2 | 4 | 5 | low | `scripts/deploy.ts`, `scripts/deploy-checks.ts`, `tests/deploy-checks.test.ts`, delete `scripts/check-production-gate.sh`, `docs/project/deployment.md` | — |
| **2** | **Injection scan decodes stored pages wrongly** — **landed 10-03, `be1d4fd5a`** ([261003g](261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md)): strict UTF-8, with the sniff kept for bytes that are not, because stage 1 stored raw network bytes from 08-25 to 08-27 | XZ-X3 | R ×2 | 5 | 5 | low | `src/source-scan.ts`, one new test | — |
| **3** | **Four one-file fixes** — **landed 10-03** ([261003g](261003g-sweep-clusters-2-and-3-scan-decoding-and-four-one-file-fixes.md)): R1 `3c6ab877f`, W1 `a93af4623` (the list stays, pending For Greg 1), X12 `848a32084`, copy `de9fbbdb0`; Sol's review fixes `f09897985`. Also touched `src/messages.ts` and a comment in `Metadata.tsx` | SR-R1, WC-W1, XZ-X12, AccessSharing's silent copy | R (R1, W1, X12), C (copy) | 5 | 3 | low | `src/routes.ts` (`part()` only) + `tests/authenticated-api-route-contract.test.ts`; `src/web/Spine.tsx` + `tests/spine-card.test.tsx`; `src/web/PageContents.tsx`; `src/web/AccessSharing.tsx` | — |
| **4** | **A shelf link finds nothing for `café`, `don’t` or `eﬃcient`** — **landed 10-03, `54c48e508`** ([261003h](261003h-shelf-link-sends-the-hits-own-spelling-and-foldwithmap-offsets.md)): the link sends the hit's own spelling; `foldWithMap` walks by cluster, which fixes three offset bugs (the two named and a mark left outside its letter) and the snippet's bold word with them; the browser fold now equals the server's over every code point (it had also parted on pointed Hebrew). `Library.tsx` needed no edit. Known limit: a hit inside drawn maths still highlights nothing | WC-W11 = DF-F1, the `foldWithMap` offset bugs, DF's fold-twin parity test | R ×3 | 3 | 4 | low | `src/web/library-hits.ts` (owns `foldWithMap`), `src/web/search-hits.ts`, `src/web/Library.tsx` (snippet only), `tests/library-hits.test.ts` | — |
| **6a** | **Referee can lose or overwrite an answer** | DP-D1, XZ-X4, the Claims input fingerprint | R (D1), C ×2 (rest) | 3 | 4 | med | `src/store/pg-referee-criteria.ts`, `src/store/pg-referee-claims.ts`, `src/store/contracts.ts` (the Claims signatures only), `src/searches.ts`, `src/referee-criteria-store.ts`, `src/db/schema.ts` + one migration (Claims' attempt column), the two Referee handlers in `src/routes.ts` | **3** (R1 lands in `routes.ts` first; minutes). **Landed 2026-10-03, `80ace2976` and the commit after it** — [261003h](261003h-referee-answers-are-not-lost-or-overwritten.md): the trim skips `pending`; Claims has an attempt token (migration `20261003125044`, one nullable column) and is told the fingerprint of the blocks it sent; the pure trimmed-list returns are gone. Left for 6b or a client cluster: the live panel's stale mark and *Try again* in `src/web/`, and the same fingerprint order in Criteria and Search |
| **7** | **Link summaries survive a profile change** — **landed 10-04, `bddf8c0c8`** ([261004b](261004b-sweep-clusters-7-and-10-link-summary-fence-and-illustrated-refusal.md)): `forgetSummaries` is a generation fence over all three maps; the two keepalive saves forget on send and again when the write settles; an open card asks again. Also touched `src/web/lib/api.ts` (`leavingFetch` now returns its settle); `useAutosavedText.ts` needed no edit. Known limit: between a keepalive write leaving and landing, a hover can still be answered from the old profile, until the settle throws it away | XZ-X10 | R ×2 | 3 | 3 | med | `src/web/link-facts.ts`, `src/web/useProfile.ts`, `src/web/purpose.ts`, `src/web/useAutosavedText.ts` | — |
| **10** | **Illustrated loses the refusal sentence** — **landed 10-04, `5ae9316e7`** ([261004b](261004b-sweep-clusters-7-and-10-link-summary-fence-and-illustrated-refusal.md)): the throw is declared; the two false comments carry no count; a source test in `tests/stop-details.test.ts` holds every use of `MODEL_REFUSED` to an `authored` `stageFailure` | DP-D2 | C ×2 | 4 | 2 | low | `src/illustrated.ts`, `src/job-failure.ts` (a false comment), one test | — |
| **5** | **A failed read is a dead end; raw error text on screen; Regenerate re-arms early** — **landed 10-04** ([261004c](261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md)): stage 1 `64e947f0e` + Sol's fixes `2cb2bfd10` (all 14 hooks through `describeFetchFailure`; `retryRead` and one `ReadError` in thirteen panels; `tests/read-error-matrix.test.tsx` is the mode-matrix test); the scan's deadline `b56e98e12`; stage 2 `fb514efd3` + Sol's fixes `d18af7c10` (`src/web/rewrite-hold.ts`: one hold for Quiz, Summary, Ideas, Glossary, Thread and Sketch; Quiz's `readMark` on `readAnswerStream`). Also fixed: Thread stuck on "loading" after a failed retry; Sketch's *written for you* badge, which had never drawn. Sol found nine more defects across the two code reviews and fixed them. Left: unchecked response casts in the read hooks (Sol F16); a job-level Retry after a failed forced run has no hold; a full reload forgets a hold | WC-W2, XZ-X9, XZ-X11, Illustrated's retry, XZ-X13k, WC-W4 (Quiz only) | C ×2 | 2 | 4 | med | the 14 read hooks XZ-X9 lists and the panels WC-W2 and XZ-X11 list (including Simple, Skim and Tweets), `FaqPanel.tsx`, `IllustratedView.tsx`, `useSourceScan.ts`, a new `ReadError.tsx`, one mode-matrix test | — |

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
   `check-production-gate.sh` — it passes over a page with no app, and nothing calls it (grepped
   `scripts/`, `package.json`, `tools/`, docs) — after porting its one unique check
   (`DELETE /api/health` answers 405) into deploy's own verify step. Deploy's stronger `verifyPage`
   accepts HTML served at a JavaScript URL; fix it here. Use `src/env.ts`'s parser instead of
   deploy's private one, and the shared migration-table constants instead of the two hard-coded
   queries. This is orchestrator-tier tooling, so it gets the higher bar.
2. **Injection scan.** Fetch stores every page as UTF-8. The Referee's source scan then re-sniffs
   the charset from the stored bytes with no HTTP header, so a page with no `<meta charset>` is
   decoded as windows-1252, and zero-width and tag-character injections produce **0 findings** where
   the same page with the tag produces 2. ASCII hidden text is still caught, so the scan is partly
   blind, not wholly. **Fix:** decode stored HTML as UTF-8 at that boundary — one line — and a
   storage round-trip test.
3. **Four one-file fixes.** Each is minutes; one agent, four commits.
   - *Bad escape (R1):* `part()` turns `/api/…/%E0` into a 500 and a Sentry report; the public copy
     was fixed on 08-28. Answer 400, and edit the two contract cases that pin the 500.
   - *Spine card (the Overseer's lead, W1):* a part's heading block lands as the first leaf of its
     first section, so the hover card's first bullet repeats a row the new outline shows two lines
     above. On the local database, 531 of 1,321 cards start with a heading leaf and about 319 (24%)
     repeat a row exactly (one family's count; Sol confirmed the path, not the figures). **Fix:** in
     `BandCard`, drop a bullet whose text is already a row in `where`, before the `+ n more` count;
     red test first with heading leaves in the fixture (it has none, which is why nothing caught
     it). No new helper. Do not filter on `startsAtHeading`: that would also drop 257 real
     sub-headings. If Greg says yes to For Greg 1, this fix is replaced by a deletion.
   - *Contents list (X12):* Metadata's sections land at `6rem` and "reached" means within 100px; at
     a 20px root font that is 120px, so the previous entry stays marked. Derive the threshold from
     the scroll margin.
   - *Copy link (found by Sol):* AccessSharing's copy button does nothing and says nothing when the
     clipboard is unavailable or refuses. Show the failure.
4. **Shelf passage link.** `libraryHitHref` sends the folded term (`café` → `cafe`, `’` → `'`), and
   find-on-page only folds case, so the link highlights nothing; `tests/library-hits.test.ts` pins
   the wrong value. Curly apostrophes make this common in ordinary English prose, not only in
   accented words. **Fix:** send the hit's own spelling. But first fix `foldWithMap`, which is wrong
   two ways: it indexes code points while its callers index UTF-16 units (`"😀 café"` → `afé`), and
   a combining mark before the match shifts the slice (`"á café"` → `" caf"`). Handle a
   one-character ligature needle (`search-hits.ts` rejects one-unit needles). Add the parity test
   between the two fold implementations.
6a. **Referee answers.** History trimming's SQL has no `pending` filter, so it can delete a
   criterion that is still being answered (reproduced as a pure decision). Claims' `finish` updates
   by article id with no attempt token and no pending guard, so with two tabs an old answer
   overwrites the newer run. And Claims loads its blocks before `begin` fingerprints the revision,
   so a re-extraction in between labels an old-input answer with the new hash. **Fix:** filter the
   SQL, and delete the unused "trimmed list" return from `withRun` and `withCriterion` (the pure
   list is never read in production); give Claims the attempt fence Criteria already has; fingerprint
   what was actually sent. No generic registry.
7. **Link summaries.** A profile or purpose save made as its box unmounts skips
   `forgetSummaries()`. Sol showed the hole is wider: an in-flight summary that completes after the
   cache was cleared refills it, on ordinary saves too. **Fix:** a small generation fence in
   `link-facts.ts`, not the two-line patch the doc proposed.
10. **Illustrated refusal.** One `MODEL_REFUSED` throw site is undeclared, so the reader gets the
    generic sentence instead of the specific one. `noteUndeclaredBlocked` already logs a warning for
    exactly this, so the logs say how often. A comment in `job-failure.ts` claims all ten sites are
    declared; it is false.
5. **Read failures.** FAQ gained a read-only retry in `418a3d57f`; the fix reached four of the
   bands. In Ideas, Timeline, Quotes, Debate, Glossary, Citations, Quiz and Illustrated a failed
   first read shows an error with no retry in the panel (closing and reopening the mode does work).
   Fourteen hooks also put `(err as Error).message` on screen instead of going through
   `describeFetchFailure`. Quiz holds its Regenerate button until the replacement has been read;
   Summary, Ideas, Glossary, Tweets and Sketch do not, so a slow or failed reload re-enables a second
   paid run against the old artefact. And the source-scan notice can say "Checking document" for
   ever, because its read has no deadline. **Fix:** `retryRead` in each hook, one shared `ReadError`
   presentation (markup only — no parsing or state policy in it), `describeFetchFailure` in the 14,
   the hold in the five (each panel's own behaviour kept), the existing finite-read machinery in
   `useSourceScan` — and **one mode-matrix test** that iterates the modes and goes red at the one
   that was missed, because "the fix landed only in the mode being built" is the pattern found three
   times. While in `useQuiz`, move its private stream reader onto `readAnswerStream` (W4), keeping
   its partial text and verdict; Mirror's copy is held. No generic hook factory (rejected by earlier
   sweeps and again here). This is the largest T0 cluster, which is why it is listed last; it can be
   staged hook by hook.

### Tier 1 — cheap, mechanical, evidence in hand

Clusters 9 and 11 were filed T0 by Astra and re-tiered T1 by the Opus review. 11 is
orchestrator-tier, so it still goes early.

| # | Cluster | Items | Evidence | Ease | Value | Risk | Files | After |
|---|---|---|---|---:|---:|---|---|---|
| **11** | **The dashboard and the Overseer daemon can block on a child process** — **landed 10-04** ([261004c](261004c-sweep-cluster-11-no-blocking-child-process-on-the-dashboard-or-the-daemon.md)): the guard `046396e2f` (a flat scan; its list of 15 files is now 10); the probes `3666e3979` (process scan, rename, new-session admission, readiness tmux and git, auth status, attention, the daemon's process table); Sol's review fixes `7c1544ca5`; the daemon tests `b7e4848f3`. KN-G2 as written does not work (a child that ignores TERM returns `signal: null`); the fix keys on `ETIMEDOUT`. **Not done:** the report drain (`report-artefacts.ts` — holding and settling the drain's promise through shutdown and lock loss is its own job), and the sync `capturePane` the daemon's attention pass still calls (cluster 23). **Takes effect only when the dashboard and the daemon are restarted.** Also touched, outside the list: `tools/fleet/{child,server,collect}.ts`, `tools/overseer/{daemon,attention-cli}.ts` | DF-F3 (guard and read-only probes), KN-G1, DF-F4, KN-G2 | C ×2 | 2 | 4 | med | `tools/fleet/{health,readiness-wiring,readiness-git,routes-new,routes-rename,routes-actions}.ts`, `tools/overseer/{attention-probe,report-artefacts,usage,work-probe}.ts`, `tools/fleet/drain.ts` (comment only), `tests/fleet-imports.test.ts` or a new sibling, the four `tests/overseer-daemon*.test.ts` files | — |
| **6b** | **Referee and Search contracts say what the store requires** — **landed 10-04** ([261004d](261004d-fifth-sweep-cluster-6b-store-contracts-require-the-attempt-and-markers-outlive-finish.md)): `37a078408` (X5: both Referee markers are held until the answer is stored and released only by their holder; D3: attempt tokens required in the Comments, Chat, Search and Criteria contracts, `appendSpoken` returns a `StoredExchange`, `finish` patches narrowed), Sol's review fixes `38a3a82f6` (a Criteria overlap is reachable by DELETE then re-POST, and is now tested). Also touched `src/comments.ts` (`AnswerFinish`). Left: the marker assumes `begin` answers in commit order, in `search` too (one count per key would fix all three), and the fingerprint order in Criteria and Search from 6a | DP-D3, XZ-X5 | C ×2 | 3 | 3 | med | `src/store/contracts.ts`, `src/store/pg-searches.ts`, `src/store/pg-referee-*.ts`, the Chat and Comments adapters and their callers, the Referee handlers in `src/routes.ts` | **6a** |
| **8** | **`routes.ts` deletions** (one agent, in this order) | SR-R5, R4 = XZ-X6, R7, R9, R11, R10; XZ-X8, XZ-X7 | C ×2 | 4 | 3 | low | `src/routes.ts`, `src/public/routes.ts` (the one `slugFrom` message), `src/auth.ts`, `src/billing/admission.ts`, the route contract test, the citation-find route tests, `docs/project/{auth,security-map}.md` (pointers to `isAllowed`) | **6b** |
| **9** | **The "frozen" eval control is not frozen, and eval comparisons can shrink silently** — **landed 10-04, `32ed6903c`** ([261004b](261004b-sweep-clusters-9-15-16-21-frozen-control-lock-tests-script-fixes-freshness-agreement.md); Sol's review fixes `3e2da25fe`): the toc/10 system prompt is a literal reconstructed from the run's commit and pinned by its own digest (the arm is kept, pending For Greg 6); `TOC10_SYSTEM` is `STRUCTURE_BASE_SYSTEM`; paperwork pairs refuse or list what they dropped; the two eval paths refuse a truncated answer; source fingerprints follow shared prompt modules one hop (not request hashes; `faq-levels` and `arc-length` left); the `260930a` pair is deleted. Also touched `src/plain-words.ts` (one exempt entry) and a comment in `src/citation-investigate.ts`. Left: `TOC10_STRUCTURE`/`TOC10_OUTPUT` and two "toc/10" sentences in `src/structure.ts` carry the same false name | DF-F2, F6, F7, F5 | C ×2 | 3 | 3 | low | `evals/structure-whole-document/toc10-frozen.ts` and its test, `src/structure.ts` (rename the live base only), `evals/paperwork/`, `evals/plain-words/`, `evals/quiz-*`, the two `260930a` scripts | — |
| **12** | **Model-call plumbing** — **landed 10-04** ([261004c](261004c-fifth-sweep-cluster-12-model-call-plumbing.md)): R2 `8398d68a5` (one parser in a new leaf, `src/retry-after.ts`; a zero or past wait is `null`; a zone-less HTTP date is read as UTC, which both old parsers got wrong), R3 `7cc5c3cb1` (seven pre-checks deleted, `apiKey()` logs once, a census test pins which functions may call `loadEnvLocal()`), Sol's F11 `9dfdc96e5` (a refusal's `usage` is metered before its status is judged, on the JSON and streaming seams; queue `qi-7mpz6n48`), R6 `17ac8705e` (one `ANSWER_UNUSABLE` in `messages.ts`), X13a `46b94d73f` (`pipelineEffortOverride()` throws on a value that is not an effort); Sol's review fixes `20507c82d`. Also touched `src/structure-deepen.ts` (the parser's third caller), comments in `src/routes.ts` and two panels, and `evals/simple/probe.ts` (a `max` arm that only worked through the cast) | SR-R3, R2, R6, XZ-X13a, one `[ai-unusable]` sentence | R (R2), C (rest) | 4 | 3 | low | `src/ai-call.ts`, `src/fetch.ts`, `src/converse.ts`, `src/explain.ts`, `src/quiz-mark.ts`, `src/search.ts`, `src/referee-claims-run.ts`, `src/referee-criteria-run.ts`, `src/referee-mirror.ts`, `src/transcribe.ts`, `src/embeddings.ts`, `src/messages.ts`, `src/models.ts`, `src/citations.ts`, `src/skim.ts` | — |
| **13** | **Two lint rules become gates; one census test** | KN-D1, DF-F8, KN-F1, DF-F9 | R (D1's 13 diagnostics, F8's baseline of 1) | 3 | 4 | low | `biome.jsonc`, the check scripts, `tests/biome-config-is-live.test.ts`, the 11 client files D1's 13 diagnostics name (one is `BlockGutter.tsx`), `scripts/changelog/release-notes.ts`, the knip config, one new test | **5** (shares hooks) |
| **14** | **Docs: knowledge that never reached its owner** | KN-K1–K11, K12 (the doc half), K13 (the `drizzle.config.ts` half), E2, M7 | C, each owner doc's contents read | 5 | 3 | low | `docs/project/{overseer-direction,overseer,hetzner-remote-server-box,fleet-dashboard-modes,ai-gateway,dictation,granularity-zoom,testing,feedback-reports}.md`, `tools/overseer/decisions.ts` (a stale comment), `drizzle.config.ts` | — |
| **15** | **Lock and tooltip tests that wait on the clock** — **landed 10-04, `4e6184fde`** ([261004b](261004b-sweep-clusters-9-15-16-21-frozen-control-lock-tests-script-fixes-freshness-agreement.md)): the three lock tests wait on `pg_blocking_pids`, followed transitively, through one helper (`tests/helpers/blocked-by.ts`, replacing three copies in the store tests); 19 tooltip test files use fake timers (about 272 s → 51 s of test time); `Tooltip.tsx` exports `DELAY`. Left: five shelf files that sleep through a shared `wait(ms)` helper; and the visibility race test cannot see the article row's `for update` at all, because the billing lock already serialises one owner | SR-R13, WC-W9 | C | 3 | 3 | low | `tests/billing-vouchers.test.ts`, `tests/public-visibility-pg.test.ts`, the tooltip tests | — |
| **16** | **Small script fixes** — **landed 10-04, `616208526`** ([261004b](261004b-sweep-clusters-9-15-16-21-frozen-control-lock-tests-script-fixes-freshness-agreement.md); Sol's review fix `3e2da25fe`): all five, each with a test that was red; new `scripts/env-value.sh`. The smoke script was run for real; **the two shell checks were not** (a worktree has no `.env.prod`) | XZ-X13f, g, h, d (the shell half), i = DF-F10 | R (f–i) | 4 | 2 | low | `scripts/stage.ts`, `scripts/check-remote-auth.sh`, `scripts/check-google-redirect.sh`, `scripts/remote-smoke-mcp-browser.mjs` | — |
| **17** | **Boundary types and false comments** | XZ-X13b, X13c, DP-D4, XZ-X13l, K12 (the `types.ts` comment) | C | 4 | 2 | low | `src/fetch.ts` (the `FetchedDocument` union), `src/db/schema.ts` + 5 readers (15 casts), comments in `src/types.ts`/`src/step-order.ts`/`src/models.ts`, `src/web/useOrderedRead.ts` | **12** (`fetch.ts`, `models.ts`), **6a** (`schema.ts`) |
| **18** | **Client tidy** | WC-W3 step 1, W7, W8 (the `ViewportProbe` guard only), W13 (dictation `busy` only), W5 (hoist the existing boolean only) | C | 4 | 2 | low | `GlossaryPanel.tsx`, `CitationsPanel.tsx`, `ThresholdSlider.tsx`, `Metadata.tsx`, `Dock.tsx` (export `withPanel`), `ViewportProbe.tsx`, the dictation hook and its 5 callers, `reader/Reader.tsx` | **5** (Glossary and Citations panels) |
| **21** | **Freshness: an agreement test** — **landed 10-04, `782563861`** ([261004b](261004b-sweep-clusters-9-15-16-21-frozen-control-lock-tests-script-fixes-freshness-agreement.md)): `tests/freshness-deciders-agree.test.ts`. The 18 stamped steps agree. Two disagreements pinned, not fixed: `structure` (known; its stamp was withdrawn 08-27) and `blocks` (new: it has an `isDone` but falls to `isCurrent`'s `default: true`) | DP-D5 (test only) | C | 4 | 2 | low | one new test | — |

11. **Blocking child processes.** Postmortem
    [260910a](../postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md)
    showed a synchronous `timeout:` signals and then keeps waiting, which freezes the dashboard's
    event loop — the tool you reach for when the box is struggling. The owned-child fix reached the
    collector and not its siblings (new-session admission in `routes-new.ts` still calls the
    synchronous `collectHealth`). Three counts were made and they differ by definition: Astra's AST
    census finds 26 `execFileSync` calls with a `timeout` in `scripts/` and `tools/`; a grep window
    gave 44; the reviewing Opus's AST census of every sync child call with a literal timeout
    (`J-sync-census.mjs`, described in its review) gives **39, 18 in `tools/`, 15 of them reachable
    from a request, a timer or the daemon loop** — including `work-probe.ts`, which runs on every
    daemon tick. Use the 39/18/15 census, and re-run it before building. **The guard first:** the
    check 260910a proposed and nobody built. The two reviewers disagreed on its shape — Sol wanted a
    walk from the composition roots, including the callbacks `scripts/overseer.ts` injects; Opus a
    flat scan of `tools/` with a named exception list. **This plan picks the flat scan**, over
    `tools/` plus `scripts/overseer.ts`: it cannot miss an injected callback, because it does not
    depend on working out what is reachable, and it is a dozen lines. The exception list may only
    shrink. **Then** convert the read-only probes (health, readiness, rename, attention, usage,
    report artefacts, work-probe) to the existing owner, one at a time. **Not in this cluster:**
    steering — see Tier 2. Also here: the daemon tests that sleep 40–60ms and then assert that
    nothing happened (they pass vacuously if no tick ran) move onto the existing
    `tests/helpers/overseer-until.ts`; and KN-G2, a reordered diagnostic in `work-probe.ts`, which
    improves the message and frees nothing.
6b. **Contracts.** The store contracts still make attempt tokens optional and let `finish` take a
    `Partial` of the whole row — leftovers of the deleted filesystem store (unfinished Stage H of
    [260903f](260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md)). Make the tokens
    required, splitting `appendSpoken`'s return type, which legitimately has none. X5 — Criteria and
    Claims release their live marker before `finish`, where Search's repaired path (`1714d1aa3`)
    holds it through — is here as a **consistency repair only**: the Opus review found its harmful
    interleaving effectively unreachable, so it is not counted among the defects.
8. **`routes.ts` deletions.** The route list in the file's header (85 lines against 106 routes, 22
   missing, and where new-route merges collide); the 16 inner `withSpendAttribution` wraps the
   dispatcher already does (not a double charge — two edit sites); the `/find` compatibility route
   kept "for one deploy" three deploys ago; the `ENOENT → 404` mapping whose producers went with the
   filesystem store; request values interpolated into logged refusal messages (both `slugPart` and
   public `slugFrom`, and the lookup messages — census them all); the constant `isAllowed` beta gate
   and its obsolete comment; high-power admission's private copy of `admitOrResync`. R10 becomes a
   comment stating each stream's actual disconnect policy (see For Greg 4 for why there is no
   single rule to state).
9. **Evals.** `toc10-frozen.ts` imports `TOC10_SYSTEM`, which interpolates the live `plainWords()`
   and `paperwork()` rules, and its test was updated along with them (`9ac3ee21b`), so the
   historical control moves with every rule edit. **Census: one affected frozen definition, zero
   others.** That is GPT Sol's census (163 eval source files; 66 or 94 vocabulary candidates
   depending on the regex, each traced); Astra repeated it and agreed; Opus spot-checked it rather
   than re-running it. **Fix, if the arm will run again (For Greg 6):** pin the rendered prompt
   text from the right commit with a digest; rename the live base so nothing calls it "toc10"; give
   the historical fixture its own expectation, separate from the production one. Not "ban `src/`
   imports in frozen files", which forbids harmless types and misses indirect dependencies.
   Alongside: paperwork comparisons skip missing and failed counterparts without changing the
   denominator (F6); two Structure eval paths accept a truncated answer production would refuse
   (F7, low value); in the harnesses that will run again, hash the **rendered system prompt** rather
   than a hand-kept file list (F5, cut down by the reviewer from "hash every request"; still a
   T2 — it rides here because it shares these harness files, and gets its own test first); and the two
   `260930a` scripts, which import live wording they claim to compare against, are frozen or
   deleted. One hypothesis to check here: `9ac3ee21b` changed Structure's prompt wording without
   bumping the `toc/12` version stamp — production effect unverified.
12. **Model-call plumbing.** Seven of eight hand-rolled `OPENROUTER_API_KEY` checks read a key
    nothing then uses and repeat the gateway's own check (transcription's is different and stays);
    each calls `loadEnvLocal()` in a request path against the documented rule, as does
    `embeddings.ts` (whose key *is* used: keep its check, drop the reload). Delete the seven, log
    once in `apiKey()`. Two exported `Retry-After` parsers disagree on five inputs (`"1.5"` → 1500
    vs 0): one parser, and decide zero and past-date behaviour on purpose. The two `[ai-unusable]`
    sentences move into `messages.ts` (open since the second sweep) **and become one sentence** —
    they differ only in "pointed at passages" against "returned"; this is the one tiny product
    simplification the sweep assigns rather than asks about. Three unchecked
    `SPIDERYARN_PIPELINE_EFFORT as Effort` casts get one parser.
13. **Gates.** Biome's `useExhaustiveDependencies` has 13 findings today across 11 files (3 missing,
    10 extra); suppress each with a reason and make it a gate — it would have caught postmortem
    260916a. The floating-promise rule has a baseline of 1 (`release-notes.ts`) and runs in 5.6s:
    fix the one, make the rule a gate, and add its red control to
    `tests/biome-config-is-live.test.ts` so the gate is seen to fail. A test that every model call
    parsing JSON uses the structured-output adapter or is a named exception (count calls, not files
    that mention the adapter). Knip: 12 of its 14 "unused" research scripts are documented entry
    points — fix the knip config rather than delete them (the other two are cluster 9's `260930a`
    pair); after that knip's unused-files check is itself gateable.
14. **Docs.** Thirteen facts that live only in a commit body or the code: `overseer-direction.md`
    says multi-account was never built (it shipped 09-10); `feedback-reports.md` says only Greg
    deploys while `overseer.md` gives it to the Overseer; `granularity-zoom.md`'s copied `TreeNode`
    lacks the `question` field added 09-05 (delete the copy, point at the type). None of these edits
    a rule's wording, so none needs approval. The ones that do are in For Greg 7. The
    heading-anchor finding is already in the Overseer's queue and is not repeated here.
15. **Timing tests.** The billing lock tests prove "blocked" by sleeping 400ms. Reuse
    `waitUntilBlockedBy` from `tests/store-job-draft.test.ts`, which names the blocking backend, and
    in the visibility test prove both requests are waiting. Tooltip tests: 53 real waits of
    300–500ms (about 20s in total); convert the hover-delay ones to fake timers. No universal helper.
16. **Scripts.** `stage.ts` silently ignores `--froce` and extra positionals; `check-remote-auth.sh`
    treats the string `"false"` as on; `check-google-redirect.sh` does not encode its callback. The
    browser-MCP smoke check never re-reads the first page after the second client navigates, so it
    cannot see shared state — the two reviewers tiered it differently (T1 and T2); it is low value
    either way and goes last.
17, 18, 21 are as their rows say. In 18, Sol cut five proposed extractions down to their cheap core:
    reuse what exists, add no new abstraction.

### Tier 2 — extractions worth doing, each with a test first

| # | Cluster | Items | Ease | Value | Risk | Files | After |
|---|---|---|---:|---:|---|---|---|
| **19** | **One helper for reading a Messages result** | DP-D6 | 2 | 3 | med | a helper beside `wasRefused`/`truncationFailure`, then the 17 stage files (30 copies), `src/structure.ts` among them | **9**, **10**, **12** |
| **20** | **A copy-button hook** (token, timer, result) | WC-W12, W8 | 3 | 2 | low | the 8 clipboard files (one is `BlockGutter.tsx`) plus `FeedbackDialog.tsx` | **13**, **18**, **3** |
| **22** | **Live conversation: the tap policy as a pure function** | WC-W10 (tap only) | 2 | 2 | med | `src/web/live/*` | — |
| **23** | **Async steering for the fleet dashboard** | the rest of DF-F3 | 1 | 3 | **high** | `tools/fleet/{steer,pane,send-coordinator,drain}.ts`, route adapters, tests | **11** |

19 is the still-open "DOC #7" from an earlier sweep, now with drift proved (D2 is an instance of
it). Both reviewers say it earns its keep; build it from the two existing predicates, not from
`stream-run.ts`, which does a different job. When consolidating, compare the copies' failure states
first: postmortem
[261003a](../postmortems/261003a-consolidating-duplicate-controls-keeps-the-survivors-omissions.md)
is about a merge that kept the survivor's omissions.

23 is **conditional**: build it when a steering stall has actually been recorded, not before. Its
synchronous send is what currently provides mutual exclusion (`drain.ts` relies on never yielding),
so making it async needs per-target serialisation and the ambiguous-delivery quarantine in the same
change. It needs its own plan.

### Tier 3 — named and sized, not started

- **Split `routes.ts` by reason, keeping the one table (SR-R12).** The file's feature regions are
  reached only from route-table rows, so moving handler bodies out concentrates each feature
  without creating a second dispatcher (which the earlier sweep rejected). But Sol found the claimed
  isolation is not quite true — Referee calls a helper defined in Search's region — and that size
  alone does not justify six to eight slices. **Sized:** one slice (chat), M, after clusters 6b and
  8 have landed; then stop and measure whether merges and review got easier. At least eight tests
  read `routes.ts` as text and will need to follow. The wider programme is **not accepted**.

### Held, with the reason

- **SR-R8's decoding leaf** (one shared path-decoding helper for the two route files): R1's local
  fix closes the proved drift. Build the leaf only if a third decoder appears.
- **SR's `admitJob` seam:** a testability extraction with no defect behind it yet.
- **WC-W4 for Mirror, W6, W3 step 2, W13's other extractions, DP-D5's extraction, XZ-X13m, KN-E1,
  KN-E3, XZ-X13j:** no drift or no second instance. W3 step 2 also waits on For Greg 3.
- **Removing the cross-step prompt-cache marking that never fires (DP-D4's other half):** a code
  decision, not a product one; it waits for a cost measurement.
- **Moving the four `scripts/eval/` CLIs, and the two probe scripts DF-F9 mentions:** left where
  they are; the knip config change in 13 is what was needed.

## For Greg

Seven decisions. Number 7's first bullet is worth doing today; the rest can wait, and none blocks a
cluster except where it says so.

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
- *Costs:* an old link that hides the spine would show it. Nothing shows readers would benefit;
  this is purely about fewer states to keep working. Low priority.

**3. One word and one track for the threshold sliders?**
Six mode panels have a slider that hides weaker results. They call it "threshold", "bar" or
"confidence", and there are two designs: Search always runs 0–100; Quotes and Debate have "stops"
at the scores that exist.
- *Removes:* if every slider used stops and one word, four copies could collapse into the one
  shared component.
- *Costs:* Search loses its fixed 0–100 scale, which was chosen on purpose because results stream
  in and stops would jump about. And it is not yet shown that one component can serve all six:
  Debate's levels are words rather than numbers, and the reset wording, counts and screen-reader
  text differ. That would have to be demonstrated before anything is built.
- *If you say no:* cluster 18 still moves the two exact copies (Glossary, Citations) onto the shared
  component; the other four stay as they are.

**4. What should happen to a paid answer when the reader leaves mid-stream?**
There are ten places where an answer streams in. If the reader closes the tab part-way, today:
- **three stop the model call**;
- **seven let it run to the end**: comment answers, glossary term lookups, Referee criteria,
  Referee claims, meaning searches (quick searches do stop), citation investigations and Mirror.
  They do not share a reason. Six of them save the finished answer, so it is there when the reader
  comes back. Mirror saves nothing — its call just runs on, paid for and unseen. And glossary Ask
  does the opposite: it stops, although it would have saved.

So there is no rule today, only seven separate choices. The decision is what the rule should be:
- *"Always stop":* no paid call runs unwatched. A reader who leaves and returns finds no answer and
  asks again.
- *"Finish only what will be saved":* Mirror stops, which is pure saving. The six that save carry
  on as now. Glossary Ask would start carrying on too — so when a reader changes their question
  mid-answer, the first answer would finish and be paid for, where today it is cut off.
- *Leave it:* cluster 8 writes down what each one does, and nothing changes.
The cheapest useful step is narrower than any of the three: **stop Mirror, change nothing else.**
It costs readers nothing and ends the one call that is pure waste.
Which of the seven really save was read from the code by one reviewer, not tested; whoever builds
this checks each first.

**5. Start deleting abandoned drafts?** (`STEP_START_DRAFT_SWEEP`, carried over from earlier sweeps)
When a pipeline step runs, it writes a draft copy of the article's data and publishes it at the
end. If the step dies, the draft is left behind. A sweep at the start of each new job finds drafts
that are more than six hours old, belong to no job, and were never published or current — only
for the article the new job is about, and at most ten per job — and today only **counts** them. Switching it to "delete" removes them.
- *Removes:* dead rows that grow without limit, and the "count" mode itself.
- *Costs:* those intermediate outputs are gone for good. Nothing a reader sees is built from them.
- *How many:* on a local database in September the plan that added the sweep measured 134
  candidates, 9.9 MiB. **Production has not been measured**, by this sweep or since; that number
  should be in front of you before you decide, and reading it is a small read-only job for the
  Overseer.

**6. Will the old "toc/10" Structure eval arm ever be run again?**
It exists to compare today's Structure prompt against the one from before. It turned out not to be
frozen (cluster 9).
- *If yes:* cluster 9 pins it properly, and it has to be kept working.
- *If no:* delete the arm and keep the saved 2026-10-02 results as the baseline (keeping the
  parser, which `evals/paperwork/structure-starts-replay.ts` still uses). That is less code and
  nothing to keep in step — but a future prompt change can then only be compared with those
  saved numbers, on those articles.

**7. Edits to docs whose wording is a rule.** This is an approval queue rather than one decision.
Each goes through [edit-important-docs.md](../reusable/edit-important-docs.md), with the before and
after shown to you one at a time; the proposed wording is not in this plan and is the first job of
whoever picks this up.
- **`overseer.md` § The tick** still tells the Overseer to spread weekly Claude usage over seven
  days. Your rule of 10-01 is the opposite (run to 100%, you reset it), and the Overseer paused
  this very sweep on the old wording. **Replace, don't append.** Worth doing today.
- `hetzner-remote-server-box.md`: `SUPABASE_ACCESS_TOKEN` needs a fresh yes from you for each use.
  The doc says where the token is; it does not say that.
- `version-control.md`: merge `origin/dev` on waking from a wait, not at push time; and one
  recorded case where a refused merge left uncommitted edits at HEAD — one incident,
  to be written as that, not as a general law. It also still describes a round trip to you for
  every merge conflict, which
  [git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md) no longer asks for.
- `docs/reusable/engineering-manager.md` § Delegate, three things learnt about briefing subagents
  (KN-M2): a claim in a brief that nobody checked ends up in a source comment; a brief that
  introduces a refusal should name its own fallback; a subagent can end its turn while the job it
  started is still running.
- `docs/reusable/codex-cli-as-subagent.md` (KN-M1, cut down by Sol): reusing an `--output` path
  makes a stale review look fresh. The rest of the proposed addition did not survive review.
- Dropped: the proposed additions to `silent-success.md` and `long-waits.md`. Sol judged them
  examples of classes those docs already teach.

Not for you, recorded so nobody asks: making `--host` verify-only is folded into cluster 1 (the docs
already describe it that way). One sentence for Referee's unusable answer is assigned to cluster 12.
Removing Referee's automatic history trimming, and removing steering from the dashboard, were both
raised and **not recommended**.

## What the reviews changed

Shown so the next reader can see which claims were tested and which fell.

**GPT Sol on SR and WC** (26 findings: 15 confirmed, 11 overstated, 0 wrong):
- Counts corrected: R4 is 16 wrappers, not 11; R5's header has 85 route lines and 22 omissions, not
  77 and "a third"; R10 is seven streams, not five, and its proposed stored/ephemeral rule is false;
  W9 is 53 long waits, not 51; W8 is eight executable writes, not thirteen.
- Cut back: R8 (moving nine identical `httpError` constructors re-proposes an earlier rejection
  with no drift in them); W5 (no new `bandCoverage` object); W6 (deferred); W10 (tap policy only);
  W13 (the three search predicates answer different questions); W3 step 2 (needs an interface
  demonstration first).
- Order corrected: R1 before R3.
- Missed, now in clusters: `foldWithMap`'s offsets (4), AccessSharing's silent copy (3),
  Illustrated's retry (5), FeedbackDialog's copy (20), `embeddings.ts`'s env reload (12),
  `waitUntilBlockedBy` (15).

**Opus on DP** (6 numbered findings, all confirmed; every quantifier re-run and matched):
- D1's fix changed: the pure trimmed list is never read in production, so fix the SQL and delete
  the list.
- D3 is not new: unfinished Stage H of 260903f.
- D4: the cross-step cache marking never fires today.
- The harm in the Referee live-marker ordering is effectively unreachable; X5 is kept as a
  consistency repair in 6b, not as a defect.

**GPT Sol on KN and XZ** (54 findings, leaving out two product rows: 39 confirmed, 11 overstated, 2
unverifiable and held, and 2 where the doc's own downgrade was wrong):
- Promoted to T0: X4 and X11; X10 stays T0 but grows from S to M. X13e and X13k restored to real
  T1s (undici's body timeout resets on every chunk; a server's `maxDuration` does not bound a
  browser's read).
- X1's fix must cover a swallowed *misspelled* flag. X10 needs a generation fence. X3 is a partial
  blindness (Unicode only), still T0.
- KN: G1's exposed list sums to 14, not 13; F1 has 19 importers, not 21; E1 and E3 held; M6 and M8
  dropped; M3–M5 change instructions and so need approval; the proposed postmortem-defence status
  table rejected as one more unchecked inventory.
- Missed: Claims fingerprints input it may not have sent (6a); `verifyPage` accepts HTML for a JS
  asset (1); `deploy.ts` hard-codes the migration table name in two queries (1); two postmortems
  filed after the nominator ran (see One level up).

**Opus on DF** (10 findings, all real; the ranking was inflated):
- F1 confirmed and reproduced (a curly apostrophe and a ligature also give 0 hits).
- F2 is T1, not T0: an eval control, already recorded in
  [261003a](../investigations/261003a-summary-and-structure-skip-the-front-matter-prompt-eval.md).
- F3 is T1 and splits three ways: the guard (S), the read-only probes (M), steering (T2, L,
  deferred). Count corrected as in cluster 11.
- F8: baseline of 1, 5.6s, gateable now with a red control.
- F9: keep 12 of the 14 scripts; freeze or delete the `260930a` pair.
- F5's fix cut down to hashing the rendered system prompt; F7 and F10 are low value; F4 is medium.
- Missed: the `toc/12` stamp hypothesis (9); 16 private `waitFor` helpers in tests (not clustered —
  no drift shown); knip's unused-files check gateable after F9 (13).

**GPT Sol on this umbrella** — see § Review status.

## Considered and rejected

For the next sweep's search. Earlier rejections that were raised again and stay rejected are marked
*(again)*.

- Splitting `types.ts`, `schema.ts`, `pg.ts`, `Reader.tsx`, `Dock.tsx` or `Metadata.tsx` by size
  *(again)* — no measured benefit and no drift; `types.ts`'s dependents are type-only.
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
- Deleting all of knip's 14 flagged scripts; pruning the 463 flagged exports *(again)*; promoting
  all of lint to a gate *(again)*.
- A composition-root walk for the sync-child guard — the flat scan in cluster 11 is simpler and
  cannot miss an injected callback.
- A meta-test that every "must agree" comment names its test — 65 hits, mostly invariants.
- A `Mark` type restructure, a tracked-fixture-path checker, an `import.meta.url` ban — no second
  instance yet.
- New Sentry alerts — no incident replay shows one would have fired, and the two classes that
  matter most here (a moving eval baseline, a blocked event loop) cannot report themselves.
- A postmortem-defence status table — one more inventory nothing checks; accepted defences go in
  the Overseer's queue with their evidence instead.
- Bulk-moving the agents' memory into docs — beyond the items in cluster 14 and For Greg 7, that is
  the memory owner's call.

## One level up

**Is the overall approach sound? Yes, in every area swept.** One store, stable block ids, an ordered
route table with one gate, explicit pipeline stages, a client built on URL state and ordered reads,
a deploy with real gates. Nothing found argues for a different design.

What the tree does have is one habit, seen in all six investigations: **work is built in the mode,
route or script at hand, and a fix made there does not travel.** FAQ's retry reached four bands of
eleven. Claims never got Criteria's attempt fence. The public route's decode fix did not reach the
authenticated one. The owned-child fix reached one collector. The deploy verifier's hardening did
not reach the older script. Each time the two copies were both valid code, so nothing went red.

The cheapest answer is often the same, and it is not a shared abstraction: **a test that iterates
the siblings** (the mode matrix in 5, the sync-child scan in 11, the structured-output census in
13), or a required type where the siblings share a contract (the attempt tokens in 6b). It is not
always enough. Where ownership or identity is the real problem — the link-summary cache in 7, the
Claims fingerprint in 6a — a sibling test would pass and a small fence is what is needed.

Two postmortems written during the sweep bear on building it. Deleting the weaker of two copies is
only safe after comparing what each does on failure:
[261003a](../postmortems/261003a-consolidating-duplicate-controls-keeps-the-survivors-omissions.md)
is a consolidation that kept the survivor's omissions. And class G is wider than synchronous
children:
[261002e](../postmortems/261002e-an-aggregate-rejection-does-not-settle-its-descendant-work.md) is
asynchronous work outliving its owner after an aggregate rejection.

Much of the T1 list is also one event's unfinished business: the filesystem store was deleted in
early September, and optional tokens, the `ENOENT` mapping, unused return values and several
comments still describe it.

## Review status

- Each investigation doc: reviewed by the other model family (table above).
- This umbrella, round 1: [GPT Sol](261003f-fifth-codebase-sweep-umbrella-review-sol.md), read-only.
  Verdict **ready with these fixes**; all eight are applied in this version: the file manifests and
  ordering edges (and "cluster 14 can run at any time" removed); the dropped findings restored or
  given a disposition (X13k, W4, the decoding leaf, the fold parity test, `admitJob`, the
  heading-anchor item); the eval corrections carried; AccessSharing moved to T0 and the confirmed
  defects ordered ahead of cluster 9; R1 split from the `routes.ts` deletions; cluster 6 split into
  defects and contracts; counts corrected (77 memory files, 56 of 64 postmortems in families, 13
  diagnostics in 11 files, the census attribution); gate landing conditions and combining-mark
  coverage added; For Greg 4 and 5 rewritten and 6 added; the `types.ts` attribution and the guard
  design settled. It also re-checked five claims against the tree (clusters 1, 2, 4, 6a and R1) and
  all five held.
- Round 2: [GPT Sol](261003f-fifth-codebase-sweep-umbrella-review-2-sol.md). Four of the eight
  applied in full and four partly; **no remaining file overlap** between clusters that may run in
  parallel. Verdict again **ready with these fixes**, five of them, all applied here: 6a's manifest
  gains `contracts.ts`; F5 stays T2; the postmortem coverage claim replaced with the measured sum;
  For Greg 4's count corrected (six save, not four) and its recommendation narrowed to Mirror;
  For Greg 5 gains its scope and the one measurement that exists; 21 and 22 scheduled. **One gap
  is left open on purpose:** the production count of abandoned drafts was not measured.

## What happens next

The Overseer dispatches clusters as separate engineering-manager runs.

- **First wave, disjoint files:** **1**, **2**, **3**, **4**, **7**, **10**.
- **As soon as 3's `routes.ts` commit lands:** **6a**.
- **Second wave:** **5**, **11**, **9**, **12**, **14**, **15**, **16**, **21**.
- **Then, in the order their "After" columns give:** 6b → 8; 13 and 18 after 5; 17 after 12 and 6a;
  19 after 9, 10 and 12; 20 after 13, 18 and 3; 22 whenever there is room; 23 only on a recorded
  stall.

Before each: re-run the cluster's greps against the tree of the day, because this audit's tree is
already behind.
