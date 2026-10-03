# Opus's review of the data and pipeline investigation

Read-only cross-family review of GPT Astra's doc, 2026-10-03. Part of the [fifth sweep](../plans/261003f-fifth-codebase-sweep-umbrella.md); the umbrella carries the corrections. Paths and line numbers are as of `59bd41171`.

# Opus review of 261003b-fifth-sweep-data-and-pipeline.md (GPT Astra)

Reviewer: Claude Opus, cross-family. Tree: dev @ 59bd41171, 2026-10-03. Read-only; one pure probe
(`H-opus-probe-d1.ts` beside this file, run with `npx tsx`, no database).

Overall: an unusually careful doc. Every quantifier I re-ran matched (line counts, 90/16, 53/11,
48/9 history counts, 25 functions / 125 interfaces in types.ts, 18 `streamMessage(` files, 15
`now - last < 500` files, 4 `attempt === undefined` guards, 1 `new Error(MODEL_REFUSED.message)`).
Both T0s are real. Its main blind spot is that several findings are **leftovers of the filesystem
store deletion (260903f)** and it does not say so, which changes the right fix for D1 and D3.

## Per finding

### D1 — Referee trim deletes a pending retry: CONFIRMED (live, T0)

- Pure decision reproduced independently: 20 rows, oldest `error`; `withCriterion` retry →
  `kind: "reset"` (keeps `createdAt`), then a new criterion → `kind: "minted"`, 20 rows,
  `retrySurvives: false`.
- SQL path traced: `pg-referee-criteria.ts` begin → insert → select others
  `notInArray(id,[new])` order by `createdAt desc, id desc` `.offset(MAX_CRITERIA - 1)` → delete,
  with **no status filter** (contrast `pg-searches.ts:330` and `:337`, both exclude `pending`). The
  reset `UPDATE` does not touch `createdAt`, so the retry is the oldest row and is the one deleted.
  `finish` requires `status='pending' AND attempt_id=…` → 0 rows → `routes.ts` sends no `done`.
- Reachable from the ordinary UI: `src/web/useCriteria.ts` `send` is fire-and-forget (`void
  (async () => …)`), with no one-at-a-time guard, and the route takes no per-article run lock beyond
  the `begin` transaction. So "Try again on the oldest failed criterion, then add a new one" is enough.
- **Correction to the fix:** the pure trim in `withCriterion` is not live. Both adapters destructure
  only `{ row, kind }` / `{ run, kind }` (`pg-referee-criteria.ts:160`, `pg-searches.ts:179`); the
  returned `criteria` / `runs` lists are consumed only by tests (`tests/referee-criteria-store.test.ts:132`,
  `tests/searches.test.ts:242,256`). Fixing "the pure and SQL trim" adds code to a filesystem-store
  vestige. Fix the SQL only (copy Search's two `pending` exclusions) and **delete** the list return
  and pure trim from both `with*` functions, moving the cap tests onto the Postgres store. That is
  also the real root cause of the drift: there were two trims, and the fix in `e630f17a4` was
  written against both in Search but tested mostly on the pure one.

### D2 — Illustrated loses the refusal sentence: CONFIRMED (live, T0, narrow)

- `illustrated.ts:1211` is the only plain throw; 16 other sites use `stageFailure(MODEL_REFUSED, …)`
  (tweets, faq, skim, citations, arc, simple-summary, quotes, debate, structure, crossrefs, labels,
  ideas, glossary, timeline, quiz, sketch). Only caller: `STEPS.illustrated` in pipeline.ts.
- `readerFailureOf` = `declaredFailure(err) ?? stepGaveUp(failureKindOf(err) ?? "retry", step)`;
  plain Error has no `readerFailure`, `failureKindOf` falls back to `kindOfMessage` on the
  `[ai-model-refused]` code → `blocked`. So: generic sentence, Retry still disabled. Doc is exact.
- Missed: the system already **alarms** on this: `noteUndeclaredBlocked` (jobs.ts) warns "a blocked
  step gave the reader no way out" for exactly this shape, so log search gives incidence for free.
  And `job-failure.ts` (docstring of `failureKindOf`) claims "the ten `MODEL_REFUSED` throw sites go
  through" `stageFailure` — false today; fix the sentence with the throw.
- Cheaper-than-shell-test guard worth adding: a source test forbidding `new Error(<X>.message)` where
  X is a `ReaderFacingFailure` constant (grep-the-genre), or let D6's helper make the site disappear.

### D3 — Optional attempt tokens: CONFIRMED, but it is a planned unfinished stage

- Signatures at contracts.ts 497, 607, 984, 1048, 1163, 1182, 1253, 1267 all optional; 4 runtime
  guards (`pg-chat.ts:433`, `pg-comments.ts:635`, `pg-searches.ts:367`, `pg-referee-criteria.ts:284`).
- Not cited: this is **Stage H of `docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md`**
  (§ "Two things it omits entirely", ~line 397), and `MissingAttempt`'s docstring (contracts.ts
  ~2149) predicts its own removal there. Not a prior rejection; a deferral that decayed.
- Slightly overstated for Chat: `Turn.attempt: string | undefined` is not only for the deleted
  store — `appendSpoken` returns `attempt: undefined` legitimately (`pg-chat.ts:404`), Sol's caveat in
  that plan. The doc's "handle Chat separately" is right; it should name why (split the return type).
- Tier T1, effort M, value high: agreed.

### D4 — Cache-group prose contradicts policy: CONFIRMED

- `step-order.ts` ~99-120, 154-158 and `types.ts` ~3080-3097, 3154 still describe shared cached
  prefixes; `sharesArticleCache` (pipeline.ts:377) compares effort + renderer + format, and
  `tests/article-cache-group.test.ts` asserts the distinct-pair list is `[]`.
- Missed consequence: with no pair, `cacheArticleForStep` (it looks at *other* steps only) is
  **always false**, so the whole cross-step marker machinery and the `cacheArticle` plumbing
  (`jobs.ts:1059` → every stage) is presently inert. The doc files deleting it under PRODUCT; it is
  not — no reader sees anything. It is a T1/T2 code question (delete vs keep for when schemas
  converge), and belongs beside D4.

### D5 — Metadata freshness duplicates stamps: CONFIRMED (T2)

- `articleMetadata` (pg.ts:2933) `isCurrent` switch has 18 `case` arms; drift comments verified
  (tweets arm "until 2026-10-01", `ideasAreCurrent`, assets hash change). The source-scanning test
  (`tests/store-revision-columns.test.ts` ~667) checks only that an arm exists.
- Brief's preference order says a red test before an extraction: add a **behavioural agreement
  test** (each stamped step, same fixture, `stepIsDone` vs `isCurrent`) as a T1/S first; extract
  only where it goes red or where the arm is non-trivial.

### D6 — Messages-wire result helper: CONFIRMED and worth its keep (narrowly)

- Not new: prior digest lists "pipeline Messages-wire shell helpers messageText/progressEvery:
  absent (DOC #7)" as STILL OPEN; the doc should cite it. It correctly keeps clear of the rejected
  stall-timer extraction.
- The census understates the duplication: `b is Anthropic.TextBlock => b.type === "text"` appears
  **30 times in 17 files**; `stop_reason === "max_tokens"` in 17 files; arc/glossary/quiz/citations
  carry a byte-identical ~18-line refusal → truncation → join block.
- Existing machinery: `wasRefused` (messages-stream.ts:353) and `truncationFailure`
  (token-budget.ts:307) already exist, so the helper is a ~15-line composer
  (`finishedText(message, stage, maxTokens, answerTokens): string`), not a new mechanism; it passes
  the deletion test (~250 lines go, D2's class becomes unwritable). `stream-run.ts`'s `runStream`
  is the SSE route runner for reader-facing streams and does not fit pipeline stages. Put it in
  token-budget.ts (already imports `stageFailure`) to avoid a messages-stream → job-failure edge.
- Effort S-M rather than M; skip the progress helper (agree).

### Other claims

- Referee live-set removed before persistence (routes.ts ~4737 vs Search's finally): grace is
  `LITERATURE_TIMEOUT_MS + 30_000` measured from `attempt_started_at`, and the gap is one DB
  round-trip after a run that cannot exceed its timeout → effectively unreachable. Not a T0; move
  the delete after `finish` for symmetry only (S, low).
- `tests/jobs.test.ts` ~2051 30 ms overlap: plausible flake hypothesis, correctly labelled.
- Search vs Referee retry predicates: verified `withRun` now has a `revises` branch with no Referee
  analogue; agree the S4 "share the retry predicate" item should be retired, not built.
- types.ts verdict (3 imports, leaf-only value import from ids.ts): agree; no split.

## What it missed (area: types/schema/store/pipeline/jobs/registries/retry)

1. The `with*` pure decisions still return a trimmed list that no production code reads
   (filesystem vestige) — the actual reason D1 drifted; delete it (T1, S, med).
2. Stale comments that describe the deleted file store: `pg-referee-criteria.ts:233` ("The file
   keeps the last N array elements"), `withRun`/`withCriterion` docstrings ("both stores share one
   copy"), route comment "`undefined` on the filesystem" (routes.ts ~4480). Delete with #1.
3. `job-failure.ts` "ten MODEL_REFUSED throw sites go through it": false claim of a closed class (D2).
4. `noteUndeclaredBlocked` already detects D2's shape at runtime — use logs for incidence; the doc
   called production incidence unmeasured when a free measure exists.
5. D3 is 260903f Stage H, with the `appendSpoken` caveat; cite it so the caveat is not relearned.
6. Cross-step cache marking is inert today (always false) — a deletion candidate mislabelled PRODUCT.
7. D6 is prior-sweep DOC #7 and the true count is 30 copies / 17 files.
8. D5 should start with an agreement test (cheaper, and it is the check the brief prefers).

## "One level up"

Sound and correctly modest (no rearchitecture). I would sharpen it: the copied-policy pattern it
names is real, but in this area most of the live instances are **cleanup the filesystem-store
deletion promised and did not finish** — optional attempts (Stage H), list-returning pure
decisions with a second trim, comments about "the file". Finishing that deletion closes D1's root,
D3, and several stale sentences in one coherent cluster.

## Table

| Finding | Verdict | Corrected tier / effort / value |
|---|---|---|
| D1 Referee trim deletes pending retry | CONFIRMED (reachable from UI) | T0 / S / high — fix SQL only; delete pure list trim |
| D2 Illustrated plain refusal | CONFIRMED (copy-only impact; Retry already off) | T0 / S / medium (+ fix false "ten sites" comment) |
| D3 Optional attempt tokens | CONFIRMED, slightly overstated for Chat (`appendSpoken`) | T1 / M / high — it is 260903f Stage H |
| D4 Stale cache-group prose | CONFIRMED | T1 / S / low-medium |
| D4b (missed) cross-step cache marking inert | NEW; mislabelled PRODUCT in doc | T1-T2 / S-M / medium (decide delete vs keep) |
| D5 Freshness stamp duplication | CONFIRMED | T1 agreement test S/med first; extraction T2 / M / med |
| D6 Messages result helper | CONFIRMED, worth it; re-proposes open DOC #7 | T2 / S-M / medium (30 copies, 17 files) |
| Referee live-set ordering lead | OVERSTATED as a risk; effectively unreachable | consistency only / S / low |
| jobs.test 30 ms overlap | UNVERIFIABLE (hypothesis, fairly stated) | T1 / S / low |
| M1 pure `with*` list returns unused | NEW | T1 / S / medium |
| M2 stale filesystem-store comments | NEW | T1 / S / low |
