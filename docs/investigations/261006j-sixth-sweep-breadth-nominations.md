# Sixth sweep: the breadth nominations, as returned

The raw output of the six Sonnet nominators of 2026-10-06, unedited and unverified, kept as evidence
for [the umbrella plan](../plans/261006j-sixth-codebase-sweep-umbrella.md), which is the later word
wherever the two disagree. The two GPT Luna nominators returned no nominations.


---

<!-- nomA-leftovers -->

## nomA: what the fifth sweep left undone (checked against the tree of 2026-10-06)

Method: read umbrella 261003f lines 155-411 (cluster tables, "Held", For Greg) and every cluster plan's
"Left / Not done / Known and left" text (261003g, 261004b-e); then grepped today's tree for each item
by content, and checked `git log --since=2026-10-03` and the 261005/261006 plans.

### Every cluster 1-23: status

| # | Landed? | Left items listed |
|---|---|---|
| 1 | landed (261003g-deploy-refuses-unknown-flags; `scripts/check-production-gate.sh` is gone; deploy.ts refuses unknown/`--host` without `--verify-only`) | none |
| 2, 3, 4 | landed | 4: hit inside drawn maths highlights nothing (known limit, not a defect to fix) |
| 5 | landed | F16 casts (DONE: `832b1d2b4` MalformedReply; grep `json()) as` in src/web = 1, in dictation-upload.ts only); job-level Retry hold; reload forgets a hold (see Still held) |
| 6a | landed | fingerprint order in Search/Criteria: DONE (src/store/pg-searches.ts "The fingerprint is the caller's", plan 261005i § D; criteria same). Client stale mark / Try again: `useCriteria.ts` has `stale` + `retry(id)` now, treated as done |
| 6b | landed | marker assumes `begin` answers in commit order (open, see N3) |
| 7 | landed | known limit between keepalive leaving and landing (accepted) |
| 8 | landed | slug-echo messages in require-slug / public-reader / jobs / term-lookup: DONE (all say "Not a slug"; grep "slug" in jobs.ts, term-lookup.ts: no echoing message). `citation-find` bucket in the CHECK: OPEN (N2). `SPIDERYARN_CITATIONS_FIND_MODEL`: still read by `src/models.ts:1520,1527` for two stages, so it is not dead |
| 9 | landed | `TOC10_STRUCTURE`/`TOC10_OUTPUT` "carry the false name": on reading `src/structure.ts:230-262` they are the toc/10 text the toc/11 patch replaces, and the error message says so. The umbrella's claim looks stale. Not nominated |
| 10 | landed | none |
| 11 | landed | sync `capturePane` in daemon attention pass: STILL THERE (see cluster 23, Still held) |
| 12 | landed | queue `qi-7mpz6n48` (refusal metering), not checked: lives in the Overseer's queue |
| 13 | landed | making Knip a gate: `scripts/check.ts:258` still `gate: false`. Knip now reports no "Unused files" section (checked by running `npm run knip`), but still 538 unused exports, 240 types, 4 unlisted deps, 19 unlisted binaries, 1 unresolved import. See N6 |
| 14 | NO "landed" note in the umbrella, but its facts are in the owner docs now: overseer-direction (multi-account at :719 says "mechanically possible"), feedback-reports, granularity-zoom (no copied TreeNode), overseer.md § tick (the 100%-of-weekly rule is in, :421). Treated as done |
| 15 | landed | five shelf files sleeping through `wait(ms)`: still open for `tests/shelf-table-hide-columns.test.tsx:228` (real `setTimeout`, waits of 400 ms and 100 ms at :404,:413); `shelf-action-touch.test.tsx:606` is already fake-timer. Low value (see N5) |
| 16 | landed | two shell checks never run (needs `.env.prod`; Overseer-only) |
| 17 | landed | redundant null checks: OPEN for `src/link-previews.ts:722`, `src/chat-tools.ts:1078`, `src/paper-text.ts:460` (N1) |
| 18 | landed | none |
| 19 | landed | five hand-written `.content` reads in evals/scripts: still there (`evals/embedding-retrieval.ts:614`, `evals/summaries/generate.ts:334`, plus others), by design left; throttle idiom no defect shown |
| 20 | landed | useShelf stale copy-failure notice: DONE (`useShelf.ts` notice now carries `from`, a working copy clears a copy failure) |
| 21 | landed | `structure` and `blocks` disagreements pinned, not fixed (see Still held) |
| 22 | landed | refused tap event not tied to the turn that sent it: open, needs a design (still held) |
| 23 | NOT built, conditional | see Still held |

### Nominations (still open)

#### N1. Three dead null-checks on `FetchedDocument.text` after the union landed
- `src/link-previews.ts:722` `if (doc.kind === "pdf" || doc.text === null)`, `src/chat-tools.ts:1078` same, `src/paper-text.ts:460` `new JSDOM(doc.text ?? "", ...)` (after the `doc.kind === "pdf"` branch returns at :440).
- How I know: read `FetchedHtml {kind:"html"; text: string}` / `FetchedPdf {text: null}` at `src/fetch.ts:84-103`; plan 261004d-sweep-cluster-17 lines 48-49 says these three were "left alone... listed in the debrief". Grep `doc.text === null` across src: these two sites; `?? ""` at paper-text.ts:460. (I did not verify `pg-shelf-terms.ts` or the no-op cast in `public/dto.ts` named in the umbrella; not grepped to a conclusion.)
- Evidence: proved from the code (types) for link-previews/chat-tools; paper-text narrowing read at the surrounding lines, not compiled.
- Fix: drop `|| doc.text === null` and `?? ""`; `npm run typecheck` is the proof. Size S. Trade-off: none, plainly right. Note the `|| doc.text === null` also guards against a future third kind: after the edit the `kind === "pdf"` test alone is exhaustive, which the compiler checks.

#### N2. `citation-find` rate bucket lives on only in a DB CHECK and one test
- `src/db/schema.ts:6739-6745` comment says: not in `RateBucket`, its only spender (POST …/find) went 2026-10-04, removing it "needs a migration that first proves no such rows remain". `tests/rate-bucket-union.test.ts:15` keeps a `retired` constant for it. Grep `citation-find'` in src/ scripts/ tools/ tests/: schema.ts (3 hits incl. the comment), the one test.
- Fix: a migration that deletes (or proves absent) `rate_limit_events` rows with that bucket and replaces the CHECK; drop the retired-case test. Size S-M. Trade-off: touches the schema and, to be safe, needs a read of production row counts first (read-only is fine), and the delete of old rows, if any, is a production data change: Greg asked-first rule applies if rows exist. Evidence: proved from the code.

#### N3. Referee/Search live-marker assumes `begin` answers in commit order
- Documented in 261004d-fifth-sweep-cluster-6b… "A wider, pre-existing scheduling risk": a delayed older `begin` response can replace the newer request's marker, then remove it. `src/routes.ts:5056 refereeing = liveKeys()`, `:5322 pullingClaims`, and Search's marker. Plan says "one count per key would fix all three"; reviewer left it "for the parent to decide"; harm needs two out-of-order begins and the newer run to outlive the older.
- Evidence: hypothesis (reasoned, not reproduced). Size S-M. Trade-off: touches the `liveKeys` shape in one shared place; changes marker semantics. Honest value: low. I would not rank it high.

#### N4. (optional) The two Criteria/Claims "Try again" claims in 6a were left for "a client cluster" — checked, done
Not a nomination; recorded so nobody re-checks.

#### N5. Real-time sleeps in the shelf tests
- `tests/shelf-table-hide-columns.test.tsx:228` `wait(ms)` real timers (`await wait(400)`, `wait(100)`, `wait(10)`, `wait(20)` at :327,:404,:413,:503,:513). Umbrella's 261003f line 405 and 261004b plan said "left"; no drift shown. 16 private `waitFor`/`wait` helpers across tests (grep `const wait = \|function wait(` in tests: 13 files). Evidence: proved from the code. Size S per file. Value low; it only costs seconds, and the earlier sweeps explicitly rejected "a blanket ban on sleeps". Listing for completeness; I would not do it.

#### N6. Knip: promote to a gate for the one check that is at zero
- `scripts/check.ts:258` `knip` is `gate: false` with note "promote to a gate when this reaches zero". Whole-run counts are nowhere near zero (538 unused exports), so the *whole* gate is not available; only the "unused files" category is at zero (run `npm run knip`: no "Unused files" heading in the output). Umbrella says: "For the Overseer".
- Fix: a `knip --include files` gate step; but the umbrella notes `--include files` alone reports two live Vite configs, so it needs a config tweak first. Size S-M. Trade-off: adds a gate step to `npm run check`; the umbrella left it as an Overseer decision. Evidence: ran it. Treat as a weak nomination (the check already runs advisory and nothing has regressed since).

### Still held (reason still applies; not nominations)

- **Cluster 23, async fleet steering and the daemon's sync `capturePane`**: `tools/fleet/pane.ts:1396` is still `execFileSync`; `tools/overseer/attention-probe.ts:35-36,113,173` re-exports it and calls it per session. Umbrella: "conditional: build when a steering stall has actually been recorded". I looked in `docs/postmortems` 261004-261006 for a steering stall: none by name. Still conditional, high risk, needs its own plan.
- **Tier 3: split `routes.ts` by reason**: held ("programme not accepted"; one slice, chat, after 6b/8, then measure). 6b and 8 have landed so the precondition is met, but it is a decision with measured-benefit ("stop and measure"), not a leftover.
- **Cluster 22's turn-ownership gap** (a refused tap event cannot be tied to its turn): "needs a turn number per event", a design; Sol rated it residual.
- **Cluster 21's two pinned disagreements** (`structure`, `blocks` falls to `isCurrent`'s `default: true`): pinned by test on purpose; fixing `blocks` is a product/freshness decision.
- **Cluster 5: a job-level Retry after a failed forced run has no hold; a full reload forgets a hold**: `src/web/rewrite-hold.ts` holds are a module `Map` (`:87`), so a reload forgets them by construction; to fix would need server state. Plan marks offline-identity changes "held". Reason still applies.
- **Cluster 9: `faq-levels` and `arc-length` fingerprints**: "not worth it for experiments that have run" (Opus). Still true.
- **Held list (lines 402-410)**: SR-R8 decoding leaf (only if a third decoder appears; unchanged), `admitJob` seam (no defect), WC-W4-Mirror/W6/W3 step 2/W13 rest/DP-D5 extraction/X13m/KN-E1/E3/X13j (no second instance; W3 step 2 waits on For Greg 3), removing never-firing cross-step cache marking (waits for a cost measurement), the four `scripts/eval/` CLIs and probe scripts (left).
- **For Greg items, undecided in the doc**: 1 (drop the spine hover-card bullets: `src/web/Spine.tsx` still has `childLabel`/`MAX_CHILDREN`, 6 refs), 2 (`?spine=0` still alive: `src/web/params.ts:99`, `layout.ts:56,397,437,714`), 3 (threshold slider unification), 6 (the toc/10 arm: it is still kept, pinned). Decisions 4 and 5 were decided 10-04 and built 10-05.
- **For Greg 7, the rule-doc approval queue** (needs Greg's approval, one set at a time): `overseer.md` bullet DONE; hetzner `SUPABASE_ACCESS_TOKEN` DONE (`hetzner-remote-server-box.md:60-66`); `codex-cli-as-subagent.md` `--output` stale-review: DONE (`:351`); engineering-manager § Delegate KN-M2: partly present (fallback at `:175`, "do not read output before completion notice" `:157`; the "a claim in a brief nobody checked ends up in a source comment" sentence not found by grep); **`version-control.md`: still open** — the doc still says a replayed conflict is "a round trip with Greg each time" (`:232-235`) and "the proposal rule fires on real textual conflicts" (`:258`), while CLAUDE.md and `git-resolve-merge-conflicts.md` say resolve it yourself; also nothing about "merge origin/dev on waking from a wait" (grep wake/waking: no hit). Both are rule wording, so they wait for Greg's before/after approval. This is the one genuinely stale fact in the held set and worth surfacing to him.

### Claims in the brief / umbrella that turned out false or stale
- Brief: "about 850 non-merge commits": not checked.
- Umbrella cluster 8 "Left: same value-echoing slug message in require-slug.ts, public-reader.ts, jobs.ts, term-lookup.ts": already fixed (require-slug.ts:32, public-reader.ts:236 say "Not a slug"; jobs.ts and term-lookup.ts have none).
- Umbrella cluster 9 "TOC10_STRUCTURE/TOC10_OUTPUT carry the same false name": on reading, they are legitimately the toc/10 blocks the patch replaces; not a defect.
- Umbrella 6a "Left: fingerprint order in Criteria and Search": done by plan 261005i § D.
- Umbrella cluster 5 "Left: F16 unchecked casts": done by `832b1d2b4`/`28e2abfff` (MalformedReply).
- Umbrella cluster 20 "Left: useShelf failure notice": done.
- Umbrella cluster 14 has no "landed" note but its docs are in.
- Umbrella cluster 13: "knip unused-files gate" - the full Knip run no longer lists unused files at all (cluster 13 achieved it).

### Scope line
Looked at: umbrella 261003f lines 155-683 (cluster tables, held, For Greg, rejected), the cluster plans 261003g, 261004b, 261004c, 261004d, 261004e "left" sections, and for each item grepped `src/`, `tools/`, `scripts/`, `evals/`, `tests/`, `docs/project/`, `package.json`. Skipped: the individual investigation docs under 261003 (their T2/T3 items outside the umbrella's clusters), the memory-file items, the Overseer queue file (`overseer-queue.md`) for items already queued, `pg-shelf-terms.ts` and `public/dto.ts` null-check claims (not verified). A method that greps by content cannot see items whose fix was done under a different name; I relied on plan docs dated 261005/261006 and the commit log for those, and did not read all of them.


---

<!-- nomB-history -->

## nomB-history: what the last three days of history know (lens: knowledge)

Range 59bd41171..HEAD. 126 postmortems named 261003* or later (one more, block-chat-was-never-in-the-gutter, is undated).

### N1. Deploy's robots.txt check is the small fix; the postmortem's "real fix" (reuse the group-aware judge) is still not built
- scripts/deploy.ts `verifyRobots` (~l.1540-1552) calls `hasDisallowAll` (scripts/deploy-checks.ts:1041, a per-line regex). Its own doc comment says "one directive in the wrong group satisfies this too. judgeRobotsTxt in scripts/check-public-shell.ts:733 reads the groups, and a deploy does not run it". docs/postmortems/261005j-keyword-checks-accept-comments-as-restrictions.md says the second item "is still the real fix and is still not built".
- How I know: grep `judgeRobotsTxt` over src scripts tests: defined at check-public-shell.ts:733 and called only inside check-public-shell.ts self-tests; deploy.ts imports only hasDisallowAll.
- State: proved from the code. Fix: call judgeRobotsTxt(contentType, body) from verifyRobots and delete hasDisallowAll plus its 6 tests (that is a deletion). Size S.
- Trade-off: touches the deploy script (Overseer's tier, higher bar); judgeRobotsTxt is written for the production file (Allow lists, Sitemap line), so confirm it is the right judge for the TARGET_HOST deploy checks. Otherwise plainly right.

### N2. Class: "text-matching guard standing in for a parser" has five live copies left
- Postmortems: 261004b-matching-source-text-is-not-parsing-imports, 261004d-a-syntax-guard-can-walk-the-whole-tree-and-miss-a-whole-import-form, 261005j-keyword-checks-accept-comments, 261005r-...empty-needle..., 261006k-a-first-id-match-hid-a-later-valid-script, 261006m-an-exact-inventory-check-silently-narrows-its-universe. That is 6, two of them import-specific.
- The by-construction defence already exists: tests/helpers/import-graph.ts `runtimeImportsOf(file)` (l.37) and tests/helpers/ts-ast.ts. Regex import readers still in tests (grep `from\s` over tests/*.test.ts, 6 hits):
  - tests/sanitize-client.test.ts:283 and :288 (its own comment at ~l.247 says "An AST check would be the real thing, and ts-ast.ts is already in hand for it")
  - tests/fleet-recovery-resume-route.test.ts:342 (`/^import[^;]*?from\s+"..."/gms`, double quotes only: exactly the 261004b failure)
  - tests/overseer-launch-protocol.test.ts:1821-1841 (four regexes)
  - tests/stop-details.test.ts:580 (an import-statement regex, even though the file already imports @babel/parser at l.73)
  - tests/cold-start-lazy-imports.test.ts:66 reads a built bundle, so it is arguably fine; leave it.
- State: proved from the code. Fix: replace the first four with `runtimeImportsOf` or `parseSource`. Size S-M. No trade-off beyond the tests becoming stricter (they may go red on something real, which is the point).

### N3. Class: "a read is a value plus one or two booleans, chosen per section" (5+ postmortems), by-construction fix named and not built
- Postmortems: 261004c-an-empty-artefact-state-can-still-carry-a-failed-read, 261004f-a-previous-404-cannot-settle-the-next-failed-retry, 261005q-a-refetch-cannot-tell-never-had-from-no-longer-has, 261005r-a-publication-404-does-not-establish-sharing-state, 261006b-a-read-completion-does-not-prove-it-followed-a-write, 261006g-a-read-still-out-drawn-in-the-words-of-a-read-that-failed-and-one-failure-final, 261005i-failure-presence-inferred-from-message-contents.
- 261006g says: "What would be better, and was not done: one type for a read (asking | failed | known) handed whole to every section of the page ... a section that forgot a case would not compile."
- Evidence: src/web/useOrderedRead.ts is shared, but useGlossary/useIdeas/useQuiz/useSimple/useQuotes/useCitations each carry their own status+error handling (all six contain MalformedReply handling, 3 hits each), and fixes keep arriving "in six modes", "seven more artefact reads", etc. (commits fb514efd3, a78132470, 832b1d2b4). Only src/web/public-api.ts:46 has a discriminated `PublicRead<T>`.
- State: hypothesis for the size; the class is proved by the postmortems. Fix size L (rewrite of how Metadata and ~10 panels receive a read). Trade-off: large touch, product-invisible. Honestly only worth it if the sweep has appetite; the cheap half (read-error-matrix test) already exists.

### N4. Class "a fix reached one sibling, not the others" has no sibling-iterating test in two spots
- Postmortems: 261004k-a-coarser-fact-loses-the-carry-policy-of-its-precise-sibling, 261006a-a-secret-bearing-response-url-escaped-through-a-diagnostic-sibling, 261004e-shared-error-markup-can-carry-a-source-modes-visual-policy, 261003e-copying-a-derived-command-vocabulary-can-silently-drop-aliases, 261003a, 261005n-adding-an-access-path-does-not-replace-the-old-one. Most already shipped a guard (alias test, stylesheet guard). I could not verify the remaining two; listed as leads only (hypothesis).

### N5. Lead from a postmortem's "worth a look in the next codebase sweep"
- docs/postmortems/261003h-debate-default-bar-hides-...md item 3: "a default may hide rows only if the panel's first line says how many. Not done. Glossary, Quotes and Search each chose their default against their own data ... Worth a look in the next codebase sweep." Not examined by me beyond reading it (hypothesis). Owner: a nominator on the web panels; S to check, a test per mode (rows stored == rows shown or the count line says so).

### Postmortem prevention that IS in the tree (verified, so not nominations)
- Retry on the Messages wire (261003f): ai-call.ts now has `TRANSPORT_ATTEMPTS`/`warnRetry` (transport-retry.ts, plan 261006b), so "other wires not audited, Queued" is done.
- load-env-local census, no-key-runners, words-that-name-a-key test, freshness-deciders-agree: all exist.
- Already recorded in test not docs but fine: freshness-deciders-agree.test.ts `DISAGREEMENTS` pins structure:inputHash with the reason.
- 261004m countermeasure 4 (a checkable representation for "the source note was discarded") and 261006j (provider template versions v1.15-v1.26 not captured): not built, but they are open research, not a cheap defence. Not nominated.

### Task 2: fix hotspots (git log --grep=fix -i --name-only, counted)
Top 15: src/feedback-endings.generated.ts 49; src/web/reader/Reader.tsx 22; src/types.ts 22; src/web/ChatPanel.tsx 21; src/web/help/help-modes.tsx 18; src/routes.ts 17; src/pipeline.ts 17; src/web/help/help-topics.tsx 16; src/messages.ts 14; docs/project/web-client.md 11; src/web/CommandBar.tsx 10; docs/project/citations.md 11; summaries.md 10; structure-step.md 10; search.md 10.
- The measurement is mostly noise: of the 20 Reader.tsx and ~20 ChatPanel.tsx "fix" commits, nearly all are subjects like "GPT Sol's code-review fixes" or a feature commit whose body says fix. Real bug fixes are the minority. The top-5 non-doc files (Reader, types, ChatPanel, help-modes, routes) therefore do NOT share a bug shape; they are the files every feature touches. feedback-endings.generated.ts is a script output rewritten by every feedback-note commit (deliberate: scripts/feedback-endings.ts, tests/feedback-endings.test.ts check staleness); not a nomination.
- Nothing nominated from this task.

### Task 3: co-change without import (4+ commits, neither imports the other)
Top pairs: ChatPanel.tsx+help-modes.tsx 18; types.ts+help-modes.tsx 17; schema.ts+routes.ts 14; help-modes.tsx+Reader.tsx 11; schema.ts+store/contracts.ts 11; ChatPanel+QuizPanel 8; converse.ts+ChatPanel 8; CommandBar+help-topics 8; messages.ts+ArticlePage 7; pipeline.ts+store/pg-revisions.ts 6; useGlossary+useIdeas 5 (also useQuiz/useSimple/useQuotes/useCitations pairs 4); AnnotateDialog+CommentDialog 5; evals/simple/{length-bands,probe}.ts+src/simple-summary.ts 5; ai-call.ts+messages-stream.ts 5; ai-call.ts+cost-categories.ts 5.
- help-modes/help-topics with everything: told to the editor by `Record<Mode, ...>` tables (mode.md §605 says so, and the types force it). Fine.
- schema.ts+routes.ts / contracts.ts: schema change -> route/contract; typed through Drizzle. Fine.
- useGlossary/useIdeas/useQuiz/useSimple/useQuotes/useCitations: six hooks changed together 4-5 times with no shared type; this is N3's evidence. AnnotateDialog/CommentDialog (830 and 1172 lines, 5 co-changes): not examined for duplicated logic (lead only).
- ai-call.ts+cost-categories.ts: cost-tracking.md describes the pairing; not checked further.

### Task 4: long commit bodies (>15 lines) with no docs/ in the diff
Only 18 commits qualify (brief expected up to 40). Examined the 8 with design content.
- Gap, one sentence each:
  - 7fc1b41fb (261005i D): contract "a stored run stamps the hash of the exact blocks it sent: the handler loads the article first, passes hashBlocks(blocks) as sourceHash into begin, and hands that same article to the model, so a re-extraction between cannot leave a fresh answer stamped stale." grep sourceHash/hashBlocks in docs/project: database.md:154-176 covers hash INPUT choice only, not the load-before-begin ordering. Owner: architecture.md § Conventions (next to the hash-input sentence). Also records a behaviour change: a failed loadArticle is now an HTTP error with no stored error row.
  - bddf8c0c8 (cluster 7): `forgetSummaries()` is a generation fence for the link-card summary cache; guarantee is "no stale summary survives the save settling, not none ever shown". grep forgetSummaries in docs/: only plans, not docs/project/links.md. Owner: links.md (near "Once per title per session", l.447).
- Already recorded (checked): d5a445c32 live-keys.ts counts holders (architecture.md mentions live-keys); 782563861 deciders disagreement (pinned in tests/freshness-deciders-agree.test.ts DISAGREEMENTS with reasons); 832b1d2b4 MalformedReply; 7cc5c3cb1 (loadEnvLocal census test enforces it).
- Rest are test-hygiene (daemon tests wait for the fact; 49cd981fa; 4e6184fde): no decision worth a doc.

### Task 5: agent memory
`find /home/greg/.claude/projects/*/memory/ -newermt 2026-10-03 -type f` returns one file, MEMORY.md (2 lines, an empty index). Nothing to move into docs.

### Claims in the brief that turned out false / weak
- "Fix hotspots" via `--grep=fix` is dominated by "GPT Sol's code-review fixes" subjects, so it measures review churn, not defects.
- Task 4 expected up to 40 hits; only 18 commits in range match, and most are test-hygiene.
- Task 5 expected several memory files; there is one empty index.

### Scope line
Looked at: all 126 postmortem titles, "what would have caught" sections via grep and about 15 read closely; fix-commit subjects for the top 5 files; a script-computed co-change table (src/scripts/tools/evals .ts/.tsx, commits touching <=25 such files, import check by basename regex, so dynamic imports and re-exports through index files are invisible); all 18 long-body commits, 8 read. Skipped: reading every postmortem body; verifying N4 leads; whether AnnotateDialog/CommentDialog duplicate logic. Method cannot see: bugs fixed without the word "fix", co-change through generated files or docs, or recommendations phrased without the words I grepped (not built, still open, deferred, follow-up).


---

<!-- nomC-tools -->

## Sixth sweep, slice C: run the tools (measurement)

Raw output: `nomC-raw-{typecheck,lint,knip,cycles,jscpd}.txt` plus `nomC-lintrules.txt`, `nomC-jscpd-out/jscpd-report.json`, `nomC-funcsize.mjs`, `nomC-diffclones.mjs` in the scratchpad. Commit under test: worktree head (fbdt-sixth-sweep, ba56c1cb1 lineage).

### Numbers (fifth sweep in brackets where it gave one)

| Tool | Now | Fifth |
|---|---|---|
| typecheck | 0 errors, 3,336 source files in 4+ projects, all covered | 0 errors, 2,810 files |
| cycles | 0 cycles (1 info = the deprecated `recommended` field in biome.jsonc) | 0 |
| knip unused FILES | 0 | 0 (after cluster 13) |
| knip unused DEPENDENCIES / devDeps | 0 | n/a |
| knip unlisted deps | 4 (below) | n/a |
| knip unused exports | 538 values + 240 types = 778 | 463 |
| lint | 174 errors, 166 warnings, 5,326 infos | "advisory baseline" |
| jscpd (src api scripts evals) | 548 clones, 1.22% of lines, 1.79% of tokens; 548 non-test | n/a |
| @ts-ignore / @ts-expect-error | 0 / 0 in src, scripts, tools | n/a |

The unused-exports count rose ~68% (463 to 778). Part of that is that knip now splits types out (240), so compare 538 to 463 for like with like (+16%). The plan already rejects pruning them ("again"), so I do not nominate it.

### Knip in full

- Unused files: none. No grep needed.
- Unused dependencies: none.
- Unlisted dependencies (4), all in tests/scripts, all installed transitively (present in node_modules, absent from package.json by name):
  `@jridgewell/trace-mapping` (scripts/trace-scroll.ts:795), `@supabase/auth-js` (tests/session-sdk-ordering.test.ts:1), `@tailwindcss/oxide` (tests/tailwind-utilities-resolve.test.ts:106), `@vitest/utils/error` (tests/test-workers-hold-no-secrets.test.ts:22). `grep -c` of each in package.json = 0. Risk: a hoisting change in a dependency breaks the import silently. Small (S), plainly right to list them as devDependencies, but it adds 4 package.json lines.
- Unlisted binaries (19): all CLIs on PATH (cloc, ssh-keygen, codex, jq, mkfifo, flock, ss, ...). Noise, not a finding.
- Unresolved import (1): `src/extract.ts:470` is a false positive. It is the text `@import URL "<whatever the page said>"` inside a prompt string/comment (also lines 702, 1266), which knip parses as an import. Could be silenced in knip.jsonc; not worth a nomination.
- Duplicate exports (4): `PUBLIC_INGEST_COST|INGEST_OVERDRAFT` (src/billing/points.ts), `TAGS_PER_ARTICLE|TAGS_PER_EDIT` (src/tags.ts), `MAX_PURPOSE_CHARS|MAX_LENS_CHARS` (src/types.ts), `libraryTopicsParam|libraryTagsParam` (src/web/params.ts). These are deliberate aliases (two names, one value); I did not check whether each alias has callers on both names.
- Unused exports, 10 files with most: src/citations.ts 17, src/pdf-figure-paint.ts 16, src/store/pg-shelf-terms.ts 14, src/pricing.ts 13, src/pdf-figure-region.ts 11, src/paper-evidence.ts 10, src/types.ts 9, src/cost-analysis.ts 9, src/backfill-registry-facts.ts 9, then src/web/DebatePanel.tsx / src/store/pg-voucher-emails.ts / src/store/contracts.ts at 7 each.

### Lint, per rule (5,326 infos are noExcessiveCognitiveComplexity 452 + useLiteralKeys 4,795 etc.)

Counts (rule: n): useLiteralKeys 4795 (info, bracket access on an index-signature type, forced by `noPropertyAccessFromIndexSignature`; ignore), noExcessiveCognitiveComplexity 452, useTemplate 59, noExplicitAny 55, useAltText 47, noDescendingSpecificity 26, noControlCharactersInRegex 19, suppressions/unused 17, useOptionalChain 17, noArrayIndexKey 15, noTemplateCurlyInString 12, noExportsInTest 12, noImportantStyles 10, noAssignInExpressions 9, noUselessFragments 9, useSemanticElements 9, noDuplicateProperties 8, noDoubleEquals 8, useConst 8, noSvgWithoutTitle 8, noUnsafeOptionalChaining 6, noUselessStringRaw 5, then 4s, 3s, 2s, 1s (full list in nomC-lintrules.txt).

Important framing: **lint runs over tests/fixtures/ HTML** (captured web pages): noDoubleEquals 8, noSvgWithoutTitle 6 of 8, useSemanticElements 2, noUnusedVariables 2 are inside `tests/fixtures/data-root/...raw.html` and `tests/fixtures/latexml|figure-wrappers/*.html`. Those are other people's pages, so the lint run's 174 errors include noise nobody can fix. Excluding fixtures from biome (files.includes) would make the error count mean something. Size S, plainly right, but it changes what the lint command reports, so check the "9 parse errors" note in linting.md before touching.

Rules with count <= 10 and the files (cheap to clear then promote to error):

- suppressions/unused 17: src/web/SketchView.tsx 15 (lines ~1244-1296, JSX `{/* biome-ignore noArrayIndexKey */}` comments that do nothing because the key is a template literal `p${j}`), src/web/ScoreBars.tsx:106, src/web/StructurePanel.tsx 1. The most valuable one: dead suppressions are comments that lie. Delete 17 comments (S, plainly right). Then promoting `suppressions/unused` to error stops it recurring (adds a rule, no trade-off beyond one config line).
- noDuplicateProperties 8: all src/web/styles/annotations.css (duplicate CSS properties in one rule, usually a fallback pair or a stale override; check each before deleting). In src, S.
- noImportantStyles 10: src/web/styles/site.css 6, tooltip.css 2, quotes.css 2. Probably deliberate overrides; needs a look, not a mechanical fix.
- noUselessFragments 9: src/web/Tweets.tsx, TimelinePanel.tsx, QuotesPanel.tsx, IdeasPanel.tsx, GlossaryPanel.tsx, tools/fleet/web/src/SessionsPanel.tsx, SchedulePreview.tsx, a test. S, mechanical.
- noImplicitAnyLet 4: src/store/pg-jobs.ts, scripts/probes/261006f-bot-wall-probe.ts, scripts/gjd-remote.ts, scripts/gjd-remote-host.ts. S.
- useImportType 3: tools/fleet/web/src/HealthHistory.tsx, tools/fleet/server.ts, src/web/DiagramPanel.tsx. S, autofixable.
- useRegexLiterals 4: tools/fleet/pane.ts. S.
- useConst 8: tests/fleet-drain.test.ts 5, tests/fleet-refresh.test.ts 1, evals/command-pick/results/261006/compare.ts 2.
- noUnsafeOptionalChaining 6 (all tests: fleet-composer-envelopes.test.tsx 3, blocks-baseline.test.ts 2, collect-pdf-figures.test.ts 1). This is the only correctness-class rule in the list (`(a?.b)()` or `...a?.b` throwing), though in tests. Worth fixing; S.
- noDangerouslySetInnerHtml 3: src/web/TableView.tsx, ProseHoverCard.tsx, DesignPage.tsx (each with a biome-ignore presumably; security-map territory, so check each is a known sink; I did not).
- noExplicitAny 55: none in `src/`; 24 evals/footnote-digits, 9 tests, 8 evals/live/gpt-live-spike, 5 scripts, 5 evals/pdf/minimal-metadata, 4 other evals. Research scripts only.
- Nothing in lint's top counts (useLiteralKeys, useTemplate 59, useOptionalChain 17) is small enough to be cheap-and-safe to promote.

### Cycles

None. Biome's `noImportCycles` is clean on 3,986 files.

### Duplication (jscpd). 15 largest non-test clones by tokens, with drift

Drift is measured as differing lines after trim, from `nomC-diffclones.mjs`; ranges are the clone, locate by content.

1. evals/dictation/bench-models.ts:349-376 ~ bench-vocabulary-sources.ts:520-549: 12 lines of ~27 differ. Already drifted, comments name each other as the sibling. Eval code; low value.
2. src/referee-claims-run.ts:499-567 ~ src/search.ts:674-753 (261 tok): 46 of ~70 differ. Heavily drifted, shared shape only. Not a candidate.
3. src/ai-call.ts:2814-2860 ~ ai-call.ts:3325-3359 (237 tok, same file): 38 of 47 differ. Drifted.
4. scripts/eval/quotes-spread-eval.ts:100-132 ~ skim-coverage-eval.ts:173-205: `sectionsOf` + `Section` interface copied verbatim (4 lines differ out of 29, all differences are neighbouring lines). Not drifted yet. Two copies in scripts/eval/.
5. src/store/export.ts:433-454 ~ src/store/pg.ts:1592-1613: block row to Block mapping (see the strong finding below). 11 differ = comments only.
6. src/web/IllustratedView.tsx:463-516 ~ SketchView.tsx:528-604: 49 of ~50 differ. Drifted (same skeleton, different content).
7. src/store/artifacts-pg.ts:455-471 ~ src/store/pg-revisions.ts:948-964: same mapping, 4 lines differ (the wrapper `{ blocks: ... }` and indentation).
8. src/web/add-share-link.ts:184-232 ~ add-share.ts:193-259: 38 of ~50 differ. Drifted.
9. src/web/live/gpt-live/useGptLive.ts:969-998 ~ src/web/live/useLiveConversation.ts:1666-1694: 8 of ~28 differ. Partly drifted; two voice-session hooks with parallel logic. Worth a look by whoever owns live-conversation; not a clear delete.
10. src/store/artifacts-pg.ts:456-471 ~ src/store/export.ts:434-449: same mapping again.
11. scripts/measure-cpu.ts:391-413 ~ scripts/measure-startup.ts:238-260 (and scripts/trace-scroll.ts:118): the `class Cdp` CDP client (`send`, `close`) is copied three times (`grep -rn "class Cdp" src scripts tools evals tests` = 3: measure-cpu.ts:345, trace-scroll.ts:118, measure-startup.ts:189). measure-startup's copy has grown an event-listener table the others lack, so it has already forked. Probe scripts, low stakes.
12. evals/command-pick/jev.ts:41-60 ~ evals/shelf-topics/jev.ts:45-64: 4 of 20 differ.
13. scripts/db-reown.ts:166-202 ~ scripts/db-seed-dev.ts:145-190: 28 of ~40 differ. Drifted.
14. src/link-summary.ts:541-573 ~ src/referee-mirror.ts:1621-1655: 30 of ~34 differ. Drifted.
15. scripts/measure-startup.ts:115-139 ~ trace-scroll.ts:75-95: 7 of ~20 differ.

#### Strongest duplication finding: the revision_blocks row to `Block` mapper exists five times

`grep -rn 'contextType as "callout"' src` = 5: src/store/artifacts-pg.ts:470, src/store/pg-revisions.ts:963, src/store/pg.ts:1609 (`storedBlocksFor`), src/store/export.ts:448, src/store/public-reader.ts:945. Four are byte-identical modulo whitespace (the 11-field `...(row.x === null ? {} : {x})` spread block, including the `as "callout"` cast). The fifth (public-reader, `PublicBlock`) omits `note` on purpose. A new nullable column on `revision_blocks` needs five edits and only the typechecker (not even that, as the spreads are optional) tells you if you miss one: `export.ts` is a rollback exporter, so a missed field there silently drops data on export. Fix: one `blockFromRow` in src/store (the row types differ slightly: `row.id` vs `row.blockId`, which is itself the drift risk), S to M, plainly right, no reader-visible change. Evidence: proved from the code (diffed the four copies). Not found in the fifth sweep's rejected list by this slice (I did not grep plans/ for it; the coordinator should).

### Function size, 15 longest in src/ (non-test, oxc-parser, lines incl. nested bodies)

15,784 functions; 162 over 200 lines, 463 over 100. (TypeScript 7 has no compiler API, so I used oxc-parser from node_modules.)

1. Reader (src/web/reader/Reader.tsx:270) 4,242 lines (the file is 4,511)
2. useLiveConversation (src/web/live/useLiveConversation.ts:345) 2,092
3. DiagramPanel (src/web/DiagramPanel.tsx:668) 1,606
4. useDictation (src/web/useDictation.ts:626) 1,302
5. useGptLive (src/web/live/gpt-live/useGptLive.ts:213) 1,165
6. CommandBar (src/web/CommandBar.tsx:1477) 1,154
7. ChatDialog (src/web/ChatDialog.tsx:284) 1,130
8. converse (src/converse.ts:2244) 1,125
9. QuizPanel (src/web/QuizPanel.tsx:357) 1,108
10. AddPage (src/web/AddPage.tsx:551) 1,106
11. TableViewInner 1,023; 12. FeedbackDialog 1,013; 13. SketchBody 975; 14. SpineInner 968; 15. Metadata 953.
Server-side, non-React: converse 1,125; runPdfExtract (src/pdf-read.ts:2897) 874; streamChat (src/routes.ts:2896) 745; generateStructure (src/structure.ts:2500) 727; exportArticle (src/store/export.ts:325) 642; walkClaim (src/jobs.ts:2532) 638; articleMetadata (src/store/pg.ts:3076) 560; pgStoreSession (src/store/pg-session.ts:291) 521; enqueue (src/jobs.ts:3455) 491; settleExpired (src/store/pg-jobs.ts:1492) 489.

Nominate one only if it has more than one reason to change. Candidate: `exportArticle` (src/store/export.ts:325, 642 lines) reads rows, maps blocks (reason 1, the duplicated mapper above), builds a rollback artefact set with stamps, and writes via `put`. It changes whenever any table gains a column, and that is the same event that forces edits in the four other mappers. Reader.tsx (4,242 lines, ~101 hook calls in one component) has many reasons to change, but it is the central component and splitting a long function is not a nomination by the brief; I flag the number only.

### TypeScript suppressions (non-test; src / scripts / tools)

- `@ts-ignore`: 0 / 0 / 0. `@ts-expect-error`: 0 / 0 / 0.
- `as any`: 80 / 6 / 19 (note: includes occurrences inside comments/strings; I did not filter). In src the largest are 3 each in src/web/ChatPanel.tsx, src/structure.ts, src/labels.ts. Not a cheap class to kill.
- `as unknown as`: 34 / 10 / 7.
- `eslint-disable`: 0 / 0 / 2, both in tools/fleet and both stale because the repo uses Biome not ESLint: tools/fleet/routes-new.ts:443 (`no-control-regex`; biome has its own `noControlCharactersInRegex`, which the lint run reports 19 times, so this suppression does nothing) and tools/fleet/web/src/ReadinessPanel.tsx:403 (`react-hooks/exhaustive-deps`; biome's equivalent is `useExhaustiveDependencies`, which is a gate, so this line is either dead or hides a gate violation). S, plainly right: convert to `biome-ignore ...: reason` or delete.
- `biome-ignore`: 191 / 6 / 24 (rule counts across src/scripts/tools non-test: useExhaustiveDependencies 87, noArrayIndexKey 55, a11y/* 61 (several rules), noControlCharactersInRegex 13, noDangerouslySetInnerHtml 1, noExcessiveCognitiveComplexity 1). The 17 `suppressions/unused` lint warnings above are a subset (15 in SketchView.tsx).

### Claims in the brief / config that turned out false or stale

- Nothing in the brief was false. Two stale comments: biome.jsonc's complexity comment says "~16 worth looking at" at threshold 25; it now reports 452 (it says not to trust old counts, but the 16 was never likely true over the whole tree incl. evals). The `recommended` field in biome.jsonc:112 is deprecated (`biome migrate`) and prints on every lint/cycles run.
- The `npm run dupes` script runs over `src api scripts evals` only, so tests/ and tools/ are never checked for duplication; a hit like the `Cdp` class lives in scripts/ and is found, but tools/ is blind.

### Scope line

Ran: typecheck, lint, knip, cycles, jscpd (console and JSON), an oxc-parser function-size pass over src/, grep counts for suppression idioms in src/scripts/tools (excluding `*.test.*`). Skipped: tests/ and evals/ for suppression and function size; evals clones in results/ directories; checking each knip unused export; checking each of the 4 knip duplicate exports for callers; verifying the 3 dangerouslySetInnerHTML sinks; per-function cognitive complexity numbers (452 lint infos only counted by rule, not listed). Cannot see: jscpd only matches near-token-identical code, so a mapper duplicated with renamed variables is invisible to it; function size counts nested closures into the outer function; `as any` count includes comments; lint per-rule counts come from the `file:line rule` header lines of the raw output, so a rule that biome reports in aggregate would be undercounted. I did not run lint at error severity per rule, so I cannot say which of the 174 errors belong to which rule.


---

<!-- nomD-unswept-zones -->

## nomD — the zones the fifth sweep did not sweep (root, infra, supabase/drizzle, CSS, tutorials, marketing)

Commit swept: worktree `fbdt-sixth-sweep` (dev at ba56c1cb1). Nothing changed in the repo.

### Ranked nominations

#### D1. Delete the finished filesystem-store "witness" instrument (~1,170 lines + a root config) — S, plainly right
- Files: `vitest.witness.config.ts` (root, 163 lines), `scripts/store-migration-witness.ts` (539), `scripts/store-migration-candidates.ts` (363), `tests/setup/fs-store-witness.ts` (71), `tests/setup/fs-store-witness-setup.ts` (31), `tests/store-migration-witness.json`; plus the `"vitest.witness.config.ts"` entry in `tests/one-store-only.test.ts:128` (and the comment at :216), and the knip entry sentence at `docs/project/static-analysis.md:97`.
- How I know (proved from the code): `scripts/store-migration-witness.ts` ~line 101 says "One left, and it is not condemned ... there is nothing condemned left for it to witness. Retiring it belongs with the tombstone in stage I." `ls src/store/fs.ts` -> No such file. `INSTRUMENTED` is a one-element list of `src/store/copy-artefacts.ts`, which still exists but is not condemned. No `package.json` script names any of it (grepped `package.json`, `src/`, `scripts/`, `tests/`, `docs/project`; hits are only the files themselves, `one-store-only.test.ts`, `static-analysis.md`).
- Not in the 261003f rejected/held lists (grep "witness" hits only cluster 13's row, unrelated).
- Trade-off: none beyond losing a historical measurement tool; the plan 260903f keeps the reasoning. Check that `one-store-only.test.ts` still passes after dropping the FILES entry.

#### D2. 83 comments say `styles.css § <section>`, but `src/web/styles.css` is now imports only — S, plainly right
- Evidence: `grep -rn "styles\.css §" src scripts tests --include=*.ts --include=*.tsx --include=*.css | wc -l` -> 83. `src/web/styles.css` is 73 lines, all `@import`; the sections moved into 48 files under `src/web/styles/`. Examples: `src/web/BlockGutter.tsx:47` ("styles.css § the gutter"), `src/web/layout.ts:172` ("styles.css § tokens"), `src/web/OfflineStrip.tsx:64`, `src/messages.ts:5647` ("src/web/styles.css § referee mode"), `src/web/SearchPanel.tsx:868` ("styles.css § --depth-0"; the token is in `src/web/styles/tokens.css`). `docs/project/*` has 0 such pointers, so the docs were already fixed and the code comments were not.
- Fix: a sweep that re-points each to `styles/<file>.css § ...` (a cheap subagent; `grep` the heading text to find the file). Defence: extend `tests/doc-links.test.ts`-style check (or a 10-line test) that fails on `styles\.css §`. Hypothesis that every one is wrong: I did not open all 83; the 12 I read were.
- Trade-off: none.

#### D3. Dead CSS: seven class names styled and never emitted — S, plainly right
Method: wrote a script (scratchpad `d-cls.mjs`) extracting all 1,538 class tokens from `src/web/**/*.css` + `styles/*.css`, then checking the bare string against every .ts/.tsx/.html/.js/.json/.svg in `src scripts tools public evals` and `index.html` (substring, so dynamic template classes survive). 53 absent; 46 are dynamic compositions (`diag-near-N`, `tier-*`, `lvl-N`, `is-${state}`, `tl-when-${tone}`, `dbt-lean-*`, `prose-card-part-*`) that I checked and cleared. Left, with no emitter anywhere (`src/`, `tests/` checked):
- `.cite-note` (`src/web/styles/citations.css:155`)
- `.sk-crumb` (`src/web/styles/diagram-sketch.css:65,77,78`; its siblings `.sk-up`, `.sk-zoom` ARE used in `SketchView.tsx`)
- `.skim-place-repeat` (`skim.css:150`)
- `.srch-retry` (`search.css:592-602`)
- `.tip-soon-flag` and `.tip-soon p.tip-soon-learned` (`dock.css:900-950`, a whole block of rules plus a long comment about specificity for a class nothing renders)
- `.cmt-transport-error` (`annotations.css:1289`); `tests/a-failed-comment-write-is-said-on-the-dock.test.tsx:5` records that it moved to the dock, so the CSS is a leftover.
- Evidence state: proved by grep for the string; "never generated by concatenation" is the part grep cannot see (checked for prefix hits: none for these).
- Trade-off: none. Do not delete semantic class names in the *design* sense? `web-client.md § Never delete a semantic class name` says keep names "even where they carry no rules"; that is about class names in TSX, not rules for classes no TSX emits. Say so in the PR.

#### D4. `.claude`-style stale paths in config/comments that the doc-links test does not read — S, plainly right
Comments naming files that do not exist (plans were renamed with date prefixes, `hierarchy`->`structure`, `remote-box`->`hetzner-remote-server-box`):
- `infra/hetzner/provision.sh:1295` writes **into the box's SSH config** "written by provision.sh, see docs/project/remote-box.md" -> file does not exist (is `hetzner-remote-server-box.md`). This one lands on a real machine's config text.
- `infra/hetzner/main.tf:10` `docs/research/remote-server-for-claude-code.md` -> `260831a-remote-server-for-claude-code.md`.
- `knip.jsonc:107` `docs/plans/simplification-wave-2.md` -> `260828aj-simplification-wave-2.md`.
- `supabase/config.toml` (comments): `docs/plans/raw-bytes-in-storage.md`, `pdf-upload-and-storage.md`, `hosting-the-articles-images.md`, `auth-supabase.md`, `auth-ui-and-production.md`, `docs/postmortems/the-config-file-is-not-the-bucket.md` (six dead).
- `.env.example`: `docs/plans/auth-supabase.md`, `error-monitoring-sentry.md`, `google-sign-in-production.md`, `src/store/live.ts` (four dead).
- `tests/gjd-remote-env.test.ts:14` (`remote-box-dev-environment.md` -> `260831x-`), `tests/chat-markdown-render.test.tsx:205` (`chat-web-links.md`), `tests/overseer-usage.test.ts:33` (`docs/project/orchestrator-direction.md` -> `overseer-direction.md`).
- Also frozen in applied drizzle migrations (`drizzle/0011` ... `0036`, ~16 dead plan paths and `src/store/import.ts`): DO NOT edit; drizzle hashes files. Just exempt them.
- How I know: ran a loop over each root config, hook, `drizzle/*.sql`, `infra/hetzner/*` extracting `(docs|src|scripts|tests|...)/path.ext` and `[ -e ]`-testing it (output saved scratchpad `d-deadrefs.txt` for the src/ side; 16 hits there, 8 of them test-fixture strings, so the real count in TS code is 3).
- Defence that would kill the class: widen `tests/doc-links.test.ts` (which covers `.md`) to also check `docs/...` paths in comments of `*.ts`, `*.toml`, `*.jsonc`, `*.sh`, `*.tf`, `*.example`, excluding `drizzle/*.sql` and test fixtures. Trade-off: it adds a test and an exemption list (a small piece of machinery). The fixes themselves have no trade-off.

#### D5. Three tutorials describe removed machinery — nomination to retire or banner, a decision
(I only grepped 5-10 identifiers each, as asked.)
- `docs/tutorials/import-pipeline-and-database.html`: line ~476 diagram "SPIDERYARN_STORE = files | postgres (default: files...)" (flag removed 2026-09-06), line ~1212 `src/store/import.ts` (does not exist), 4 mentions of the filesystem store. The tutorial's whole premise is the two-store world.
- `docs/tutorials/architecture.html`: points at `docs/project/hierarchy.md` (gone; the step is `structure`, renamed 2026-10-02), 13 mentions of `hierarchy` incl. the pipeline strip and `STEPS.hierarchy`, "Fourteen modes ... plain, hierarchy, outline, summary..., remember" (remember -> learn 2026-10-06; Skim, Quiz, etc. missing); the file's last change was 2026-10-01.
- `docs/tutorials/revisions-and-the-schema.html`: 7 mentions of the `hierarchy` step (publication gate) and "filesystem store is scaffolding being deleted".
- `docs/project/tutorials.md:57` already says tutorials go stale quietly; none of these three carry a "drifted" note.
- Fix: either regenerate (L, three tutorials) or add a one-line drift banner to each and in `tutorials.md` (S). Product/priority trade-off -> Greg decides. The other five tutorials resolved all their file names (only `statusline-script.sh`, which is a path on the user's own machine, `~/.claude/statusline-script.sh`, so fine).

#### D6. Two token names fall back forever: `--danger` and `--ink-faintest` — S, plainly right
- `var(--danger, var(--highlight))` at `src/web/styles/mode-band.css:921`, `dock.css:857`; `var(--ink-faintest, var(--ink-faint))` at `dock.css:471`, `diagram-drift.css:37`. Neither is defined anywhere (`grep -rn -e "--danger" -e "--ink-faintest" src styles` -> only those 4 uses). `tests/css-tokens.test.ts` only polices fallback-less `var()`, so the fallback hides it. The rules "work" by always taking the fallback. Fix: write the fallback token directly (or define the token if an error colour was intended: the chat tool error currently draws in the brand orange, `--highlight`, which may not be what was meant; that is the one trade-off, a reader-visible colour question).
- Dead definitions (defined, no reader anywhere in `src styles tests scripts docs/project`): `--depth-3` (`src/web/styles/tokens.css:158,483`), `--header-height` and `--quote-color` (`styles/tokens.css:246,114`), `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border` (`styles/tokens.css:233-235,421`...), shadcn leftovers: there is no sidebar component (`src/web/components/ui/` has only button, toggle). 23 flagged by my script; the 15 `--color-*`/`--radius-*` are Tailwind theme names that generate utilities, so not nominated. Hypothesis for `--depth-3`: intentional to complete a 4-step ramp; `--sidebar-*` likely shadcn bridge boilerplate.

#### D7. Mirrored/triplicated CSS blocks; the sort/gate/reset controls — M, known and partly held
- `dbt-bar-reset` / `gloss-gate-reset` / `srch-gate-reset` / `quotes-bar-reset` are byte-identical 7-declaration blocks (4 copies); `*-range` x4 (5 decls), `*-gate-value` x3, `.gloss-sort` / `.quotes-rank` / `.srch-sort` x3, `.gloss-stale` / `.srch-stale` / `.ref-notice` x3, `.ideas-group > h3` / `.tl-group > h3` (15 decls), `.sk-*` vs `.ill-*` (7 pairs: title/up+zoom/full/elsewhere/note/busy). My script (`d-dup.mjs`, normalised bodies of >=5 declarations, whole `src/web/styles/`) found 24 groups.
- Already known and held: `ThresholdSlider.tsx` header says "Search, Quotes and Debate still draw their own" (WC-W3 step 2, held in 261003f for lack of a second instance). Now there ARE three sibling copies of the reset/range/value CSS, so the "no second instance" reason is weaker than when it was held. The cheapest delete is CSS-only: let Search/Quotes/Debate use the `.gloss-gate-*` markup via `ThresholdSlider` (needs `ThresholdSlider` to accept their `max`/`noun`, which it already does) and delete ~150 lines of CSS. Trade-off: touches markup in three panels (tests pin it for Glossary/Citations only).

#### D8. `docs/project/design-css-overview.md` carries a stale count — S, but the doc is an entry point (rule-doc wording needs Greg's approval)
- "`wc -l src/web/styles.css src/web/styles/*.css` on 2026-09-06: 65 lines of `@import` over 37 files, 15,951 lines in all." Today (ran `find src/web -name '*.css' | xargs wc -l`): 73 import lines, 48 files, 25,018 lines in all. Also "reads all four stylesheets" (`css-tokens.test.ts`) — now five paths (tailwind.css + styles.css chain + 2 root + ...); I did not verify the test's list. Fix: delete the sentence (counts are in `counting-lines.md`). Trade-off: this file is one of the seven entry-point docs, so per CLAUDE.md the edit goes one approved set at a time.

#### D9. `supabase/config.toml` lists `sql_paths = ["./seed.sql"]` with `[db.seed] enabled = true`, but `supabase/seed.sql` does not exist — S, hypothesis it's harmless
- `ls supabase` -> `config.toml`, `templates/` only. The Supabase CLI tolerates a missing seed file (default config). `db:reset` seeding is done by `scripts/db-seed-owner.ts`. A reader seeing "enabled = true" would assume SQL seeds. Fix: `enabled = false` or a one-line comment. Also `config.toml:427,433` points at `supabase/templates/invite.html`, `password_changed_notification.html` (commented out; templates dir has only confirmation, recovery). Fine.
- Brief claim false: "`supabase/` migrations as SQL": there is no `supabase/migrations/`; migrations live in `drizzle/` (154 files incl. `meta/` 152 snapshot entries).

#### D10. Measured, not recommended: tracked artefact weight (for Greg's decision; no deletion nominated)
- `docs/plans/`: 855 image files (png/jpg/webp), 147,426,425 bytes (147 MB); biggest folders: `260909c-dashboard-design-system-screenshots/` 5.9 MB (32 files), `261001i-shots/` 4.7 MB (25), `261001d-annotations-mode-shots/` 3.1 MB (14), `261005l-shots/` 3.0 MB (21), `260930a-shots/` 2.8 MB (11).
- `docs/plans/`: 132 `.diff`/`.txt`/`.log` files, 8,857,677 bytes (86 `.diff`, 42 `.txt`, 4 `.log`: `260928a-...stage1-tests.log`, `260930a-stage1-pg-tests.log`, `260930d-pg-tests.log`, `260930d-quote-stop-rerun.log`). `red-first.txt` is `docs/plans/261005j-red-first.txt`, not at the root.
- `evals/results/`: 663 tracked files, 4,439,197 bytes (my `du -cb` total), the largest being a 2.0 MB and a 1.8 MB PNG and 1-2 MB JSON dumps.
- Largest tracked file: `evals/pdf/harder/source.pdf` 11.6 MB; three PDFs 6-11 MB.
- Clone weight, not defects.

### Checked and clean (so the next sweep does not redo it)
- `package.json`: 79 scripts; every script's file path exists (ran a node check over `.ts/.sh/.mjs` path tokens: 0 missing); 0 scripts share an identical command. 4 or fewer references outside package.json for `eval:summaries` (docs name `npx tsx evals/summaries/run.ts` instead of the npm script: undocumented alias, trivial), `pdf:pass0`, `eval:learn`, `eval:tutorial` (their own file headers, documented in `setup-dev.md`/plan), `structure:flatten`, `check:conflicts`; none broken, none removable on evidence. Dependencies: all non-`@types` packages are mentioned somewhere in `src scripts tests tools evals api`.
- Root: `git ls-files` at depth 1 = 28 files, all config/docs (`admission-journal.ts` and `vitest-admission.ts` are read by `scripts/readiness-*.ts`; `vite.fleet.config.ts`, `components.json`, `.mcp.json` referenced). No `.activity.log`, `.log`, `shot-c.png` tracked at root.
- `.claude/settings.json` hooks: all four hook files exist and each is referenced; `protect-shared-tree.test.sh` is named in `version-control.md:210`.
- `src/web/styles.css`: all 48 stylesheet files in `src/web/styles/` are `@import`ed (no orphan sheets). Also no `!important` outside site.css (7) and 12 elsewhere; literal colours outside tokens are masks and explained (`prose.css:507 #1c1c1c`, `site.css:255 #e79a5b`, `site.css:186 --site-display-mid: #eda86e` are the only unexplained hex ones; I did not open their context).
- `infra/hetzner/provision.sh` vs `hetzner-remote-server-box.md`: spot-checked 17 identifiers (PROVISION OK status file, `AS_USER`, `fleet-dashboard.env`, tailscale, emacs, nano, playwright, codex, credential helper, swap...): doc and script agree; `overseer-watchdog` unit is documented in `overseer.md` not in the hetzner doc (fine, one home). All `../../` links in the hetzner doc and `infra/hetzner/README.md` resolve (0 missing). I did not read the 2,298-line script end to end.
- `docs/project/marketing-pages.md`: linked files exist; all 13 `src/web/assets/*.png` and the `public/` icons are referenced.
- `.env.example` (32 vars): every var is read somewhere. 17 `process.env.*` read in `src/` and `api/` are not in `.env.example` (SPIDERYARN_DEEPEN_*, SPIDERYARN_JOB_CONCURRENCY, SPIDERYARN_EMAIL_SEND, ...), tuning knobs, left alone.
- `experiments/decorated/` and `example/` are tracked, intentional (README says so; `example/` is referenced from `scripts/count-lines.ts`, `evals/*`); `docs/tutorials/260929a-decorated-mode.html` covers the former.

### Claims in the brief that turned out false or off-target
- "`shot-c.png` is untracked in the primary": not in this worktree and not tracked (nothing to nominate).
- "`supabase/` migrations as SQL": `supabase/migrations/` does not exist; only `config.toml` + `templates/`. The SQL is `drizzle/`.
- "`red-first.txt`" is not a root file (it is in `docs/plans/`).
- "`.activity.log`" is gitignored (`*.activity.log`), 0 tracked.
- "scripts nothing documents or calls": of 79, only `eval:summaries` had zero textual `npm run` hits anywhere; 3 more had 1-2; every one exists. No duplicate scripts.
- "custom properties used and never defined": the 60-odd candidates were mostly inline-style-set (`--chip-x`, `--quote-top`, `--hl`, ...) or the `--h${i}` family that `tests/css-tokens.test.ts` already knows; the real ones are the two in D6.

### Scope line
Looked at: repo root files and config (`package.json`, `.gitignore`, `.vercelignore`, `.worktreeinclude`, `knip.jsonc`, `vercel.json`, `drizzle.config.ts`, `.mcp.json`, `.env.example`, `.claude/settings.json` and hooks), all CSS under `src/web/` and `styles/` (scripted: classes, custom properties, duplicate blocks, hex literals), `infra/hetzner/` (spot-checked against its doc and README), `supabase/config.toml`, `drizzle/` (comment paths only), `docs/tutorials/*.html` (identifier spot-check, `hierarchy`/store/modes), marketing assets, tracked-artefact sizes. Skipped: `tools/` (259 files, not in this slice), `evals/`, anything under `src/` outside CSS pairing, the interior of `provision.sh` beyond spot-checks, SQL content of the 154 drizzle migrations (no schema nominations by instruction), `docs/plans` contents. Method cannot see: class names built by string concatenation from a computed prefix (my substring test would count a matching prefix as "used", so some dead CSS in the 1,485 "used" is invisible), custom properties set from a name built at runtime, whether a visual rule is wrong in a browser, CSS reached only through a `tests/` string, and nothing was rendered or screenshotted.


---

<!-- nomE-self-knowledge -->

## nomE — what the code says about itself, and stale comments

Baseline 59bd41171 -> HEAD (worktree-fbdt-sixth-sweep). Today 2026-10-06. Read-only; nothing changed.

### Phrase counts (src scripts tools evals; .ts/.tsx/.js/.mjs/.css; lines / files)
TODO 62/24 (but only ONE real marker: tools/fleet/pause.ts:145; rest are "not a TODO", `todo` variables, tests) · FIXME 0 · HACK 4 (hacking/hack the incident, not markers) · XXX 7 (spya-e7pxxx fixtures) ·
for now 30/24 · temporar* 63/35 (mostly English) · until we 8 (all English, none a marker) · don't forget 3 (tag-add fixture text) · also update 2 · stay in step 1 · must match 20 · must agree 50/47 · keep in sync 3 · in step with 33 · mirrors 59 (mirror sites, PDF) · same as in 2 · copied from 97 · is latent 2 (routes.ts, one quoted old comment) · third time 20 · not yet 191 (English / the add-share "not yet" state) · no longer 830 · legacy 339 (mostly `liftLegacy*` URL shims, legacy keys) · deprecated 21 · backwards compat 1 (a Supabase field) · remove after/once 0 · delete after 1 / delete once 4 (all the HTTP verb DELETE) · after the next deploy 0 · once deployed 1 (English).
Vocabulary widened: "copy of" 542 (mostly "copy of the app"/"copy of the article"), "duplicat" 818 (English). The tree is **very clean of self-confessed unfinished work**: since baseline only 146 added comment lines match any phrase, and I read all of them; the only ones that bind two things are listed below.

### Claims in the brief that turned out false / thin
- "`git log -S` per phrase" was unnecessary: the phrase vocabulary is almost all English prose, so a plain-diff grep of comment lines was enough.
- `.claude/worktrees/` "as the only worktree location": no comment in src/scripts/tools asserts that now (scripts/worktree-roots.ts, tools/fleet/actions.ts, collect.ts, recovery-view.ts all name the external root too). 0 false hits.
- `Fable`: 92 src / 58 tools / 46 evals / 43 tests hits, **all historical attribution** ("Fable's ruling, 2026-09-08") or the declared `fable` wire token (AttentionPanel.tsx:644, actions.ts:330). 0 false.
- `Remember`/`remember` rename (261006a): landed. Remaining `remember` hits in src are the English verb, the `remember()` memo helpers (arrivals.ts, projection.ts), the dated `RETIRED_MODES` alias and history. 0 false.
- `Trajectory`: src 22, all history/prompt-version labels (`trajectory/5..8` are stored version strings), plus the 4 deliberate retired-name tables. The `?mode=trajectory` alias has a deliberate "bookmark/shared link" rationale (modes.ts:322), no removal condition -> not a deletion.

---

### N1. DELETE `scripts/migrate-fs-toc-to-hierarchy.ts` (163 lines) — dead twice over  [proved from the code, S, plainly right]
- It migrates the **filesystem store's** `data/<slug>/steps/*.running`, `data/_jobs/*.json`, `data/_ai-calls.jsonl` from step name `toc` to `hierarchy`. The filesystem store went 2026-09-05; the step is now `structure` (2026-10-02). The script's own header cites `src/store/artifacts-fs.ts`, "deleted 2026-09-05".
- How I know: `grep -rn "migrate-fs-toc" . --include=*.ts --include=*.json --include=*.md` -> only the file itself, `docs/project/structure-step.md:31` (a link), and two plans. `package.json`, tests/, knip config: 0 hits. Nothing imports it.
- Fix: delete the file, drop the link line in structure-step.md. No trade-off.

### N2. `scripts/backfill-raw-manifests.ts` (299 lines) + `tests/backfill-manifest.test.ts` — same family, probably dead  [hypothesis, S-M]
- Repairs `data/<slug>/raw.json` on a laptop disk for a Postgres refusal landing 2026-08-27/28. With the filesystem store gone (2026-09-05) there is no `data/<slug>/raw.json` to repair. Only live reference: the `NoStoredDocument` error text (src/store/artifacts-pg.ts:1017, and the docblock at :1008) tells the reader of the log to "run scripts/backfill-raw-manifests.ts if the bytes are still on disk".
- Not proved: I did not check whether any other script still writes a `raw.json` with that shape on disk. Check that first (`grep -rn "raw.json" scripts src`), then delete script + test and reword the error.
- Trade-off: small (touches an error string).

### N3. `ReaderPlan` arm `{ kind: "off" }` has no producer  [proved from the code, S-M]
- src/billing-plan.ts:103-110 documents it as "Quota is not enforced on this deployment at all — a filesystem store ... src/store/index.ts refuses to boot on a filesystem store, so this is what a developer sees." Both halves are false today (no filesystem store; index.ts has no such refusal, see its header lines 7-34).
- Producers: `grep -rnE 'kind: ?.off.' src tests scripts tools` -> the type (billing-plan.ts:110) and ONE test construction (tests/billing-plan.test.ts:399) plus tests/plan-help-copy.test.ts:146. Nothing in src builds it. It still costs three `case "off":` arms (billing-plan.ts:749, 818, 916), a "No plan on this copy of the app" copy block, and test rows.
- Fix: remove the arm; the compiler then lists every switch to delete. Trade-off: none visible to a reader (no producer), touches a union other code switches over.

### N4. `visibility?` / `privateLinkOn?` / `sharing?` optionals justified only by the dead store  [proved (comments) / hypothesis (type tightening), M]
- src/types.ts:2078-2092, 2252, 3007-3030: "Absent means *this store cannot say* ... the filesystem store has no visibility column — `visibilityStore.set` refuses with a 501 there". There is one store. The comment defends optionality with a store that no longer exists, and the card's "we could not check" state is then reached only if the metadata fetch failed.
- Evidence of consumers branching on absence: src/web/Masthead.tsx:214, :872, usePreloadRecent.ts:72, feedback-article.ts:304, Metadata.tsx:1507.
- Fix: at minimum correct the comments (plainly right, S). Making the field required is a type change that also needs "metadata fetch failed" modelled separately (a trade-off; do not do without checking Postgres always supplies it: src/store/pg.ts ~3609 builds `sharing`).

### N5. Present-tense filesystem-store comments that are false as written  [proved from the code, S, plainly right]
Counts: "filesystem store" src 117 lines, scripts 11, evals 4, tests 211; `SPIDERYARN_STORE` src 19, scripts 7, tests 56, evals 3. The great majority are "went on 2026-09-05" history. False-as-written (present tense, or pointing at code that is gone):
- src/billing-plan.ts:104-108 (N3).
- src/types.ts:2079, 2253, 3008, 3016 (N4).
- src/store/contracts.ts:1789-1791: "so that the filesystem store can refuse it ... src/store/index.ts, where `files` gets an adapter whose only method throws" — index.ts has no `files` adapter (grep "files\b" src/store/index.ts: only history comments).
- src/messages.ts:5735-5736: "the filesystem store answers this route with a 501 by design (src/store/index.ts)"; :4558 "The filesystem store has no column, or the page's metadata fetch failed".
- src/chat.ts:448-449: "The filesystem store calls it inside its mutex, the Postgres store inside its transaction".
- src/block-policy.ts:64 and src/source-hash.ts:58: "the filesystem store carries an absent field and Postgres a null column" (justifies `null | undefined`; the normalisation is still fine, the reason is stale).
- src/store/contracts.ts:1750: "what the filesystem store holds".
- src/store/pg-searches.ts:15, :497: "burying it is what the filesystem store does wrong" (present tense about a deleted thing).
- src/fetch.ts:380: "All of this dies at stage 4 with the filesystem store, which is the right time" (stage 4 long past).
- vite.config.ts:97-105: "refused at module load when the filesystem store was selected ... failed on any machine with the default SPIDERYARN_STORE=files" (reads as live; rationale for the dynamic import still stands for other reasons?) — check.
Fix: one sweep, reword each to the surviving reason or delete the sentence. No trade-off. Do it together with N3/N4.

### N6. Stale "gist columns" / "Hierarchy" statements about today's tree  [proved from the code, S, plainly right]
Counts: "gist column" src 51 / scripts 1 / tests 9; `hierarchy` word in src 123 (most are history, d3-hierarchy, alias tables). Present-tense and false (columns/mode removed 2026-09-29, default mode `plain` since 2026-08-31, modes.ts:286):
- src/web/library-hits.ts:149 "the default mode is `hierarchy`" (false: default is plain).
- src/web/Dock.tsx:49 "layout.ts ... shrinks the gist columns, and when that is not enough it starts dropping levels" (layout.ts:8 itself says "There were gist columns here until 2026-09-29"); Dock.tsx:73 buttons list "`Hierarchy` / `Summary` ...".
- src/web/styles/narrow-window.css:33-34 "can fit one gist column beside the prose ... `fitView` shows no gist columns at all"; GIST_MIN survives in layout.ts:59-62 only to compute NARROW_WINDOW_MAX (a constant named for a deleted thing, still used: harmless, but the name lies).
- src/models.ts:1075-1078 "`labels` ... the core of the product: the gist columns *are* granularity zoom".
- src/web/styles/mode-band.css:91 "the gist columns (`.ctx-*`, `.nav-label`, `.outline td.gist`)": `grep -rn "nav-label\|td\.gist" src/web --include=*.css` shows `.nav-label` and `td.gist` have no rules in any stylesheet; `.ctx-*` now means `ctx-callout` (an authored box, TableView.tsx:1587). referee.css:77 names ".ctx-panel's own mask": no `.ctx-panel` selector exists.
- src/web/StructurePanel.tsx:27 "Hierarchy goes through `buildGeometry`" and "the contract AGENTS.md ... state" (AGENTS.md exists; fine); src/web/FeatureBoundary.tsx:98, ModeHerald.tsx:39 ("Plain and Hierarchy ... have no band"); src/web/structure.ts:291 "the spine, Outline and Hierarchy all still call it the third"; src/routes.ts:4544 example URL `?mode=hierarchy&thread=` (resolves via RETIRED_MODES, so works, but is an example of a retired spelling); src/web/useArc.ts:31 "Hierarchy"; src/web/tree.ts:258.
- src/command-pick-catalogue.generated.json:35 lists "hierarchy" as an alias of `mode:structure`: that is deliberate (reader vocabulary), not a defect.
Fix: reword. No trade-off. (The `.nav-label` / `td.gist` / `.ctx-panel` CSS rules: grep shows no rule definitions, so only the comments are stale; confirm no CSS ruleset by those names before also deleting `td.gist .sticky` mentions at tokens.css:322 and shell.css:680.)

### N7. Stale TODO whose condition already landed: tools/fleet/pause.ts:145-152  [proved from the code, S, plainly right]
- "TODO(w2-usage-limits): the `w2-usage-limits` session owns rate-limit collection and will publish `ConversationRateLimit` in wire.ts. That type was **not present in wire.ts when this was written** ... Replace it with the import when it lands."
- It is present: tools/fleet/wire.ts:514; imported at pause.ts:71; `rateLimitFrom(answer: ConversationRateLimit)` (pause.ts:194) is the adapter, and its own docblock explains why the adapter stays (ms -> ISO, `cannot-tell` pass-through). The only TODO marker in 5 directories is therefore itself stale.
- Fix: rewrite the paragraph to say `RateLimitReading` is the deliberate narrow local type and `rateLimitFrom` is the seam; delete "TODO". No trade-off.

### N8. Two constants that "must agree" with a comment and no test: `MAX_DEPTH = 12` in src/citable.ts:69-70 and src/web/Cited.tsx:264  [proved: no enforcement; no drift (both 12), lesser]
- citable.ts:69 "Kept in step with `MAX_DEPTH` in src/web/Cited.tsx"; Cited.tsx:261 says the same back. Consequence of drift: the server counts citations in different text from the text the reader gets chips in. `grep -rn "MAX_DEPTH\|depth" tests/chat-markdown-render.test.tsx` -> only a nested-quote smoke test (`">".repeat(4000)`) and a 200-deep list; nothing compares at the boundary (11/12/13 deep + a citation).
- Fix (S): export the constant from citable.ts and import it in Cited.tsx (Cited.tsx already imports the shared ./citations.js; citable.ts imports only mdast + two src/*.ts helpers), or add a one-line equality test. Trade-off: none.
- Checked and enforced (no nomination): page-head `documentTitle` (one shared function + tests/page-head.test.ts:417-539), build-stamp `builtAt` (vite.config.ts computes the stamp once), `RETIRED_STEPS` copy in src/feedback-payload.ts:76 (tests/feedback-payload.test.ts:73), hit-colours palette size (tests/hit-colours.test.ts reads the stylesheet), step/mode alias tables.

### N9. Copy-and-diverge pairs, deliberately declared, with no drift test (hypothesis, lesser)
- src/web/live/gpt-live/useGptLive.ts:46-70 and six "Copied from the Realtime hook" notes (lines 342, 470, 1247, 1291, 1314): the serial write queue, caps effect, pagehide effect, reconnect/hangUp, stall reporting. The header's rule is "when one engine is deleted, delete its copy". Nothing checks the two have not drifted; the file says why lifting was refused. I did not diff them.
- "one write in flight, newest behind it" now exists three times: useAutosavedText.ts (original), src/web/add-purpose.ts:30-33 ("This is the second copy of it"), and the GPT-Live commit queue. add-share.ts / add-share-link.ts also repeat `MAX_NOT_YET` and the "404 is *not yet*" rule with "six things differ" justification. The fifth sweep already held "WC-W4 ... no drift or no second instance"; this is the third instance of the write-queue rule, so the "no second instance" reason no longer holds for it. Per the umbrella "third decoder" precedent a shared `serialWriter` is now due — but it is a new abstraction touching three live hooks (M, has a trade-off), so it is a nomination for Greg's call, not a certainty.

### N10. `RETIRED_STEPS` / `RENAMED` / `RETIRED_MODES` alias tables: conditions NOT passed (no nomination)
- trajectory->skim and hierarchy->structure appear in 4 tables (modes.ts:329-332, step-order.ts:198-201, cost-categories.ts:319-320, feedback-payload.ts:76-79). All are for stored rows or old tabs and the ledger is append-only, so they stay; each is tested. `?remember=` alias kept on purpose (modes.ts, plan 261006a).
- `liftLegacyAnchor/Slug/About/Tweets/DebateBy` (router.ts:1187-1341): permanent public-URL shims with no removal condition. Left.
- src/db/schema.ts:4130 `chat_threads.stance` "legacy, read-only": kept so exports preserve rows; fine.

---
### Scope line
Looked at: every comment line in src/ scripts/ tools/ evals/ (.ts/.tsx/.css) that matches the phrase list, whole tree counts; all 146 such lines added since 59bd41171 (extracted from `git diff -U0`); every `must agree|must match|in step with|stay in step` hit outside src/web .tsx (~55), spot-checked 8 for enforcement; the filesystem-store, SPIDERYARN_STORE, Fable, Trajectory, hierarchy, remember/Recall, gist-column and `.claude/worktrees` stems in src, scripts, tools, evals, tests. Skipped: tests/ for TODO-style markers beyond counts, docs/, evals/results data (the evals counts for `hierarchy`/`remember` are fixtures and results, not comments), a line-by-line diff of useGptLive vs the Realtime hook, the 55 "must agree" pairs I did not open, Python/shell. Cannot see: a must-agree pair phrased without any of my words; runtime drift between a comment and behaviour; whether scripts/backfill-raw-manifests.ts is still wanted by Greg for some other disk layout.


---

<!-- nomF-defences -->

## nomF — the defences (tests, readiness, gates), sixth sweep

Worktree /var/tmp/spideryarn-worktrees/fbdt-sixth-sweep, 2026-10-06. Nothing in the repo was changed.
I ran one test file (`tests/store-roundtrip.test.ts`, 95 passed) and `npx biome lint` (read-only).

### What I could and could not read (data sources)

- `~/.fleet-readiness/runs/` : 110 JSON records (10-04..10-06). 106 finished: 67 pass, 32 fail, 7 void.
  104 are `check`, 6 are `test`. Median duration 49.7 min, range 3.3 min..77 min.
  **They carry counts only** (`files.failed: 6`) — never the names of the failing files.
- `/home/greg/code/spideryarn2/.claude/worktrees/readiness-checks/logs/readiness-runs/` : only 21 per-run
  logs survive (2026-10-04 23:13 to 10-06 16:54), 10 of them with failing files. That is the real data below.
  (The loop's older logs, 09-09..09-12, are in `readiness-loop-*.log` there as one-line outcomes only.)
- `/home/greg/code/spideryarn2/logs/tmux-jobs/` : 354 logs, but suite logs stop at 09-29 and the bulk of
  failures are 08-02..09-11. Used for the slow-file list and older failure names.
- `docs/project/readiness.md` says "its output is kept"; in practice the tmux-job logs for the loop since 10-01
  are not in the primary's `logs/tmux-jobs` (they are in the readiness-checks worktree, 21 of them).

### N1. The readiness record cannot say WHICH file failed (so "what goes red" is unanswerable from the record)
- Evidence: all 106 records in `~/.fleet-readiness/runs/`; `grep -h -o '"name": "test"'` on failed steps = 22;
  none holds a file name. `tools/fleet/readiness-parse.ts` `parseVitestCounts`/`parseCheckTable` keep tallies only.
- 22 of 99 finished runs failed in `test`, 3 in `typecheck`, 3 in `committed`; nobody can tell from the record whether
  22 failures are one red for six hours or 22 different flakes. I had to dig 21 raw logs out of a *different* worktree.
- Fix (S): parse the `FAIL <lane> tests/x.test.ts` lines (already in the output, one regex) into `failedFiles: string[]`
  (capped, e.g. 20) on the `vitest` counts. Then the Readiness tab can show "red for N runs: store-roundtrip" and a flake
  ledger falls out for free. Trade-off: adds a field to a record shape (`schema: 1`), nothing visible. Proved from the code.

### N2. `tests/admin-only-routes.test.tsx` waits 50 x `setTimeout(1)` for a lazy chunk (a flake, recorded)
- `show()` loops `for (i<50 && !host.querySelector("h1")) await act(setTimeout 1)` — about 50-100 ms total — then asserts.
  Failed twice in the 21 surviving readiness logs (2026-10-05T02:59 and 10-06T06:27): `/admin/vouchers: expected '' to be 'Gift vouchers'`
  (the empty heading is the Suspense fallback). Both on a loaded box; the same file passes alone.
- This is exactly "waiting on a fixed time rather than on the thing it checks". Fix (S): `await vi.waitFor(() => expect(heading()).not.toBe(""), { timeout: 10_000 })`
  (or the existing helper the other lazy-page tests use). Plainly right, no trade-off. Evidence: reproduced from logs; the cause is read from the code.

### N3. `tests/fetch.test.ts` 400 ms wall-clock budgets (lines ~1075-1078 and ~1150-1153)
- Two `expect(performance.now()-started).toBeLessThan(400)` on a linearity claim. `docs/project/worktrees.md` (~line 309) records 478 ms at
  load ~40 on 2026-09-08. The test's own comment says "if red, do not raise the number: run the shape at 2x and 4x and see whether time quadruples" —
  i.e. the *assertion it wants* is a ratio, but the test asserts an absolute number. Fix (S/M): time the 1x and 4x inputs in the same test and assert `t4 < 8*t1 + slack`
  (quadratic gives 16x). A ratio survives load because both arms slow down together. Trade-off: slightly weaker at tiny sizes; the comment says it is the intended check. Hypothesis that it still flakes today (no failure in the 21 recent logs); the doc record is the evidence.

### N4. Other wall-clock budgets (a list; I nominate none by name beyond N3, because none has a recorded failure)
`grep -rn -E "(elapsed|duration|took|ms|dt|Ms)\)?\.toBeLessThan\(" tests` = 23 hits, plus ~25 `Date.now() - started … toBeLessThan(N)` (about 48 asserting on elapsed time overall).
Budgets that sit at 1-2 s and would be first to go on a loaded box (all `tests/`): `fleet-child.test.ts:212` (750 ms), `collect-assets.test.ts:973` (1500 ms),
`fleet-readiness-async.test.ts:58` (1500), `overseer-source.test.ts:532,550` (2000/1500), `fleet-collect.test.ts:553,583` (1000),
`overseer-diagnose.test.ts:501` (2000), `fleet-actions-list-processes.test.ts:62`, `overseer-usage-auth-status.test.ts:65` (2000), `width-gate.test.ts:649`, `transcribe.test.ts:327` (3000).
`fleet-collect.test.ts` also has a recorded FAIL (Sept), `overseer-diagnose.test.ts` too (one each in tmux logs) — hypothesis these are the budget, did not open the log.
Fixed sleeps in general: `setTimeout(r, N)`-style sleeps = 336 lines in 349 files; not nominated (fifth sweep rejected a ban).

### N5. `tests/fleet-child.test.ts` intermittent: a global `process.kill` spy sees someone else's call (2 recorded failures)
- 2026-10-05T15:03 (`proves a process group from stat parsed after a comm containing spaces…`, "expected 1st kill call to have been called with [-1234,'SIGTERM']")
  and 2026-10-06T05:06 (`signals only the pid when stat reports a different process group`, "expected kill to not be called at all, but … 1 times").
- Cause (hypothesis, not reproduced): `vi.spyOn(process,"kill")` is process-global; an owner from an earlier test in the same file whose fake child never emitted `exit`
  still has a live timer and calls `process.kill` inside this test's window. Fix (S): `afterEach` that emits `exit` on every fake child / calls `owner.dispose()`, or pass `kill` into `probeOwner` as a dependency instead of spying on the global (the file already injects `spawn` and `readProcStat`, so this is the same shape). Plainly right.

### N6. `pgReady` returns `pool?: Pool` for callers that asked for it, so 179 `!pool` / `pool?.` / `pool!.` guards exist, and 4 of them are `describe.skipIf(!pool)` that can never skip
- `tests/helpers/pg-ready.ts` `interface PgReady { pool?: Pool }`; `keepPool: true` is used in 26 test files.
  `grep -rn -E "skipIf\(!pool\)|if \(!pool\)|pool\?\.|pool!\." tests` = 179 (22 `pool?.`, 28 `pool!.`, 125 `if (!pool)`, 4 `skipIf(!pool)`).
  The 4 `describe.skipIf(!pool)` are `tests/reader-arrivals.test.ts:107,260,332` and `tests/billing-upgrade-notice.test.ts:237`. They look like the old silent skip that
  `pg-ready.ts` says was removed 2026-09-05, and `tests/one-store-only.test.ts` (which hunts only the identifier `reachable`) does not see them. A reader
  seeing them believes the suite can opt out; it cannot (pgReady throws first). That is a false comment in code form.
- Fix (S): overload `pgReady(options & { keepPool: true }): Promise<{ pool: Pool }>`; the compiler then makes every guard dead and it can be deleted (mechanical,
  ~179 lines out). Types close the class "a guard for a state that cannot happen". Plainly right; no behaviour change.

### N7. Residual silent self-skips (all declared; I list so they are decided, not rediscovered)
`grep -rn -E "describe\.skip|it\.skip|\.skipIf\(" tests` (real uses, excluding comments): 1 `it.todo` count = 0, `it.skip` = 0, `describe.skip` ternaries = 5:
`db-test-create.test.ts:529` (opt-in env, writes a stderr line), `migration-reconciliations.test.ts:124` (`DATABASE_URL` local only, else silently `describe.skip`;
its own comment says the first test asserts connection happened, but if the whole block is skipped nothing asserts anything), `gjd-remote-tab-lifecycle:174`,
`gjd-remote-prompt:288` (mac-only), `gjd-remote-upload:149` (GNU only). `skipIf` = 51 uses: Chrome-dependent (`*-in-chrome` x7, `chrome === null`),
`pdf-bundle-trace`/`cold-start-lazy-imports`/`no-secrets-in-bundle` (`!built`), `gjd-remote-*` (flock/python), `seed-admin-signin` (`!auth.ready`, stderr line), `test-workers-hold-no-secrets` (`SECRETS.size===0`).
- Worth deciding: the **`!built` skips** (`pdf-bundle-trace` line ~96, `cold-start-lazy-imports` line ~84, `no-secrets-in-bundle` ~80,101). `docs/project/worktrees.md` says these fail loudly
  "rather than skipping"; the code is `it.skipIf(!built)`. One of the two is stale. Since `worktree:setup` now builds (261006g), the skip can become a failure,
  as `pgReady` did for the database. Stale-doc-or-code, S, plainly right once confirmed (I did not run them).
- The old wish "a `test:db` that fails when the database is absent" **exists in a better form**: `tests/setup/private-db-global.ts` fails the whole run once, and `pgReady` throws per suite
  (header of `tests/helpers/pg-ready.ts`). 229 files call `pgReady`. No `REQUIRE_POSTGRES` code remains (only stale mentions in 8 test-file header comments and `infra/hetzner/README.md:100`):
  `grep -rn REQUIRE_POSTGRES` outside docs/plans = 8 hits, all comments describing a switch that no longer exists. Nomination (S): reword those comments; one in `tests/store-pg-referee-claims.test.ts:41` still says "Skips when there is no database, loudly; `REQUIRE_POSTGRES=1` turns the…" — false today.

### N8. Tests that read source or CSS as text — counts and the weak ones
- Count: 268 test files contain both `readFileSync`/`readFile` and a literal `src|scripts|tools/...` path; 98 lines `readFileSync(".../(src|scripts|tools)/...")` direct;
  63 test files read a `.css` file. (Exact number of "source-as-text" tests is bounded by 268; not every one asserts on it.)
- Sampled 15: block-flash, layout-margin, spine-reading, prose-centred-in-its-cell, marginalia-shut-notes, touch-selection-chip, visitor-arc-gap, api-fetch-offline,
  sanitize-stale-artefact, fleet-questions, simple-check, public-imports, overseer-standing-jobs, structure-band-width/spine-width, shared-notice-banner (rendered HTML — not source).
  Verdict by kind:
  - **CSS-as-text** (block-flash, layout-margin, spine-reading, prose-centred-in-its-cell, touch-selection-chip's `annotations.css` rule, marginalia-shut-notes line ~187): asserts a declaration *appears inside a rule slice*
    (`toContain("margin-inline: auto")`, `toContain("var(--safe-left)")`). A wrong implementation that passes: the declaration kept but overridden later in the cascade, moved into a media query that does not apply,
    or on a selector that no element carries. Vocabulary, not relationship. jsdom cannot lay out, so the honest fix is the `*-in-chrome.test.ts` pattern (real Chrome, 7 files exist) for the few that guard a visible regression, and deleting the rest rather than adding more regexes.
  - **Source-shape on a hook call** (`visitor-arc-gap.test.ts:112-134`: `expect(visitorArticle).not.toContain("useArc(")`; `touch-selection-chip.test.tsx:403-412`: regexes `onSelect=\{selectProseByTouch\}` on the JSX tag):
    passes if the prop is present but the function it names is wrong, or if `useArc` is called via an alias (`const f = useArc; f()`), or inside a helper imported by the file. A render test of the visitor path with a spy on the arc fetch would pin the relationship.
  - **Good**: `sanitize-stale-artefact.test.ts:300-310` already says "a *call*, not a mention" and anchors on a call pattern; `public-imports.test.ts` builds the real import graph; `overseer-standing-jobs` reads fixtures and checks hashes. Leave.
- No single deletion here; the nomination is: **for each of the 63 CSS-reading tests ask whether a `*-in-chrome` test or an existing computed-style test already covers the behaviour; delete the text check where it does.** Size M, trade-off: loses a cheap check if the Chrome test is skipped (it self-skips when no Chrome, see N7).

### N9. Slowest files, from the last complete full-suite log (`fullsuite-0929b-2138-2669804.log`, 2195 s wall, 1216 files, one failure)
Per-file wall-clock (inflated: run at heavy load; relative order is what matters):
```
128.4s tests/extract-protect.test.ts         41 tests   real extract pipeline (Readability) per case — slow for a reason
 91.5s tests/dock-mode-tooltips.test.tsx     24 tests   3.8 s/test, no fake timers, no sleeps found by grep: accident? renders the full App per case
 61.2s tests/run-claude.test.ts              73 tests   spawns real CLIs / sleeps — reason
 52.8s tests/run-codex.test.ts               94 tests   same
 47.7s tests/collect-pdf-figures.test.ts     37 tests   real pdf parsing — reason
 45.8s tests/notes-canonical.test.ts         58 tests   real pipeline over fixtures — reason
 44.5s tests/pdf-integrity.test.ts           28 tests   real pdf — reason
 37.2s tests/fleet-web.test.tsx             511 tests   many renders — reason
 31.0s tests/shelf-action-tooltips.test.tsx  15 tests   2 s/test; has 10 real-timer waits; also 4 recorded FAILs/timeouts (30 s timeout in "belongs to the control it was opened from") — accident
 27.7s tests/a-broken-mode-leaves-the-article-readable.test.tsx 75 tests  renders per mode — reason
 24.6s tests/block-roles.test.ts             23 tests   ?
 24.1s tests/worktree-remove.test.ts         52 tests   real git — reason
 24.1s tests/claim-session-postgres.test.ts  11 tests   real DB, 2.2 s/test — reason
 22.2s tests/every-mode-draws-its-surface.test.tsx 51 tests  renders per mode — reason
 21.5s tests/public-network-trace.test.tsx   69 tests   renders — reason
```
(also gjd-remote-tmux-script 20.8 s real tmux, maths-import 20 s, trajectory-panel 19.9, referee-tooltips 19.9, diagram-panel-hover 19.2.)
The whole suite is 36 minutes under load (readiness `check` median 50 min), 1216 files in 3 lanes (`unit`, `private-postgres`, `shared-services`).
Nominations: `dock-mode-tooltips.test.tsx` (91 s, 24 tests) and `shelf-action-tooltips.test.tsx` — the tooltip family. `shelf-action-tooltips` and `referee-tooltips` already use fake timers for the open delay; `dock-mode-tooltips` does not
(grep `useFakeTimers|advanceTimersByTime|waitFor` = 0 non-comment) — so it is slow without a visible reason; hypothesis that it renders the whole App per case. Look at before touching. S/M.
Note: I did not have vitest JSON timing output; these come from the verbose reporter in a tmux log dated 09-29, so 7 days old.

### N10. What goes red — the table (all I can establish)
Surviving per-run logs 2026-10-04..06 (21 logs, 10 with failing files):
```
store-roundtrip.test.ts "preserves chat.json exactly"   6 runs 10-06 05:06..15:42  REAL regression, lived on dev ~10 h (the 261006a learn/thread-kind rename); passes at this HEAD (I ran it: 95 passed)
gutter-target-size.test.ts (2 tests, grid-area slots)    2 runs 10-04 23:13, 10-05 00:42  REAL regression (CSS text test), later fixed
fleet-child.test.ts (process.kill spy)                   2 runs                              flake, N5
admin-only-routes.test.tsx /admin/vouchers               2 runs                              flake, N2
dock-corner-controls.test.tsx ("find" of undefined)      1 run  10-06 05:06                  unknown (TypeError on undefined .find) — one-off, not investigated
store-export-thread-kind.test.ts                         1 run  10-04 23:13                  ENOSPC "no space left on device" — environment
```
Older tmux suite logs (Aug-Sept, 24 failing runs; names by count of failing tests): store-parity 11, site-footer 7, admin-store 7 (all "Test timed out in 20000ms" calling GoTrue + 5 aggregates — real-network, shared-services lane),
store-roundtrip 6, doc-links 5, step-failure-seam 4 (timeouts), shelf-action-tooltips 4. `Test timed out` appears in 14 log files (20 s x7, 30 s x11, 120 s x1).
Reading: of the recorded reds only about a third are timing/environment; the larger share is a **real regression reaching dev and staying red for hours** — the readiness loop is working, the gap is that it does not name the file (N1).

### N11. Gates vs advice (from docs/project/static-analysis.md and the latest `check` record)
- Gates: typecheck, build, build:fleet, test, cycles, hook-deps, promises, chain, conflicts, committed (10).
- Advisory: lint (Biome whole), knip, complexity, dupes. Latest check record: complexity **452** findings, dupes **548**, knip "has findings", lint "findings". **None is at zero.**
- `npx biome lint` today: **174 errors, 166 warnings, 5326 infos**. Errors by rule: noArrayIndexKey 36, noControlCharactersInRegex 19, noExportsInTest 12, noAssignInExpressions 9, noDuplicateProperties 8 (CSS fallbacks, intentional e.g. `content: "−"; content: "−" / "counts against"`), noDoubleEquals 8 (in saved web pages), noUnsafeOptionalChaining 6, noImplicitAnyLet 4, useIterableCallbackReturn 4, noDangerouslySetInnerHtml 3, others <=2.
- Nomination A (S, plainly right): a real-bug rule at near-zero can follow the `cycles`/`hook-deps`/`promises` pattern (a one-rule gate). Candidates: `noUnsafeOptionalChaining` (6, all in `tests/*` casts like `(x?.y as T).z`), `noUnsafeFinally` (1), `noVoidTypeReturn` (2), `noChildrenProp` (2), `noShadowRestrictedNames` (2). 13 findings total across five rules, each plausible to fix by hand, then gate. Trade-off: each gate is another step in the `check` loop (seconds). Say per rule, not as a bundle.
- Nomination B (S, plainly right): 8 `noDoubleEquals` + 1 `noAssignInExpressions` findings are in `tests/fixtures/data-root/**/raw.html` — saved web pages the repo does not own. `biome.jsonc` already excludes `evals/extraction/fixtures/**` for the same reason; add `!tests/fixtures/**` (check no authored files live there first). Removes 9 false errors and the "lint is noisy" excuse for them.
- Nomination C: the 19 `noControlCharactersInRegex` errors are probably intentional (sanitisers/control-char stripping) — a one-line `biome.jsonc` override for those files, or leave; not verified.
- The `✓ typecheck … gate: "unknown"` in the readiness record is by design (mark `✓` is printed for gates and advisories alike, `readiness-parse.ts` § CHECK_ROW) — not a bug, but it means the Readiness tab cannot show "which step is a gate" for green steps; a `[gate]` tag in `scripts/check.ts`'s table line would remove the tri-state. S, tiny; adds one word to a printed table, and the parser tests need updating. Low value.

### Claims in the brief that turned out false or stale
- "read the last ~30 recorded runs and list which test files failed" — the records hold counts only; names exist for 21 raw logs in a worktree (N1).
- worktrees.md "a `test:db` … was wanted" — satisfied by `pgReady` + global preflight, not a `test:db` script (none in package.json).
- worktrees.md claims the build-output tests "say so out loud rather than skipping" — the code uses `it.skipIf(!built)` (N7). One is stale.
- Several test headers still describe `REQUIRE_POSTGRES=1` as live (N7).

### Scope line
Looked at: 110 readiness records, 21 per-run logs in the readiness-checks worktree, 354 tmux-job logs (24 with failures; names aggregated), the verbose per-file timing of one full-suite log (09-29),
`tests/` greps (1759 files incl. helpers) for sleeps, elapsed assertions, skips, readFileSync-of-source, pool guards; `package.json`, `static-analysis.md`, `readiness.md`, `worktrees.md`, a read-only `biome lint` run,
the one test I ran (`store-roundtrip`, green).
Skipped: running the full suite; reading each 15-file sample in full (assertions were read, not the surrounding setup); verifying each nominated flake by repeated runs under load; knip and dupes output (read only the counts in the check record);
`tests/` subfolders other than top-level greps; evals/. Cannot see: failures in runs older than 10-04 other than in the tmux logs; whether fetch.test.ts still flakes today (no recent failure recorded); load at the time of each failure (inferred).
