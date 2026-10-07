# Cross-review: Sol on Opus’s reader-client investigation

Reviewed checkout `bf78e90c7`. No tracked files changed. Probes were written under `/tmp/spya-depth-review`; no browser or production data was inspected.

**R** = reproduced; **C** = proved from code; **H** = hypothesis. Reproduction with an invented malformed response does not establish a current producer.

## WCO1 — Quiz misses its step completion

**Confirmed · R · Tier 0. Safe to build without the owner.**

Trace: `OwnedArticle` mounts `useQuizRead` → `Reader` draws its questions when ready and fresh. The completion listener exists only in the band’s `useQuiz` → `useStepJob`. Leaving the band removes that listener. The engine continues running, but the standing read does not subscribe to its completion.

I copied `always-mounted-reads-refresh.test.tsx` into `/tmp` and added Quiz:

```text
Tests  3 failed | 14 passed (17)

expected:
  GET /api/quiz/always-mounted
  GET /api/quiz/always-mounted
received:
  GET /api/quiz/always-mounted
```

The failures are Quiz’s closed-band refresh, StrictMode refresh, and expected second completion listener. Existing sibling cases pass.

**Fix:** import and call `useStepFinished(slug, "quiz", refresh)`, and add Quiz to the existing test. This reuses the quiet listener and existing request ordering; it introduces no new refusal or spending.

The proposed membership guard needs explicit exclusions: `OwnedArticle` also mounts Crossrefs, Arc and other reads. “Every hook called here” is broader than the four artefact reads named in this finding.

## WCO2 — Crossrefs discards accepted links on failure

**Confirmed · R · Tier 0. Safe to build without the owner.**

Trace: engine completion → `useJobs` drains it → Crossrefs’ `onFinished` → ordered `refresh` → `readJson` throws for a 500 → catch stores `{ slug, links: null }` → `Reader` receives no links.

The real-engine probe produced:

```text
crossrefs after 500: null
AssertionError: expected null to deeply equal [the accepted link]
```

The count is correct:

```sh
rg -l 'setStatus\(\(was\) => \(was === "loading" \? "error" : was\)\)' src/web/use*.ts
# 14 files
```

**Fix:** leave accepted same-slug state untouched in the catch. Initial failure already projects to null; successful absence, foreign-slug and stale responses must still clear links.

Replacing the local completion wrapper with `useStepFinished` is equivalent: both check slug and step membership and use quiet subscriptions. It deletes a duplicate mechanism. Risk is low, rather than literally none: the regression must distinguish failed refresh from a successful stale answer.

The network-fallback qualification is conditional: transport failure preserves links only **if a saved response exists**. Cache eligibility alone does not guarantee that.

## WCO3 — Forced runs lack rewrite holds

**Confirmed · C · Tier 0 for the reachable completion gap. Safe to build under the existing written rule.**

The census is correct: thirteen artefact hooks have forced verbs; six use the hold, seven do not.

```text
AST calls: useRewriteHold = 6
Unheld: Illustrated, Quotes, Timeline, FAQ, Debate, Citations, Skim
```

Tracing the controls resolves the original H:

- Illustrated’s `PaintAgain` disables only for steering restrictions, `job` or `starting`.
- Timeline, FAQ, Debate, Citations and Skim route stale-banner controls through `JobProgress`, which offers the run button again when the job disappears.
- Quotes’ `quotesFindMoreOffered` likewise accepts a loaded, idle queue.

During a slow completion GET, these hooks retain the old artefact. The controls become available before that GET lands. `useStepJob.start` has no start latch; server deduplication concerns active work, so a completed job does not prevent another forced run.

**Fix:** reuse `useFreshReads` and `useRewriteHold`; wire every forced control to `rewriting`. This closes the documented defect without a new abstraction. Glossary already supplies the append precedent, and Quotes’ append updates `generatedAt`.

The suggested literal scan is insufficient: Skim uses a conditional spread, while Glossary passes `force` through `run(force, …)`. A membership check must cover those forms and distinguish other callers such as Metadata. Do not claim that searching `queue.start({ force: true` closes the class.

Writing exemptions would change the rule and belongs with the owner. Applying the existing rule does not require asking again.

## WCO4 — Tweets and Skim publish unchecked replies

**Confirmed · R for malformed inputs; H for current reachability · Tier 1. Safe to build with absence handled explicitly.**

Trace: `readJson<T>` parses JSON but does not validate its shape. Tweets queues `setLoaded(found)` before accessing `found.thread`; Skim publishes fields directly.

The probes produced:

```text
tweets after null: status=ready, thread=null, error=[rd-recheck sentence]
AssertionError: expected null to equal the previously accepted thread

skim after {}: ready undefined
AssertionError: expected 'ready' to be 'error'
```

The nine `MalformedReply` callers are correctly counted; Sketch and Illustrated additionally use domain validators.

The current routes and store reads construct envelopes for present artefacts and throw 404 for absence. I found no current producer of either demonstrated malformed envelope.

**Fix:** validate and derive before setters, using the existing `MalformedReply` class and extending the malformed-refresh matrix. Preserve the previous accepted answer on rejection.

Do **not** throw on an intended `200 null` absence: handle it as none before validating non-null replies. Valid current envelopes should pass; today’s production payloads were not sampled.

The server-first prediction is overstated. The absence protocol is header opt-in, and these hooks currently send no such header. Adding server support alone need not change their 404 responses.

## WCO5 — Metadata exposes raw exception wording

**Confirmed · R for raw wording; H for empty-message reachability · Tier 0 for the former. Safe to build.**

Trace: real `apiFetch` marks a transport `TypeError` → Metadata catches it and stores `.message` → `RerunSection` renders it and opens the section.

A copy of the Metadata sharing-card harness, with the metadata transport rejecting, produced:

```text
metadata raw message in DOM: true
AssertionError: expected page text not to contain 'Load failed'
Tests  1 failed | 24 skipped
```

The predicate census is accurate: four `Boolean(provenanceError)` uses and one `provenanceError === null` use. Those disagree for `""`; no current empty-message producer was established. `errorFor` already rejects blank server error sentences and supplies fallback copy.

**Fix:** use existing `describeFetchFailure`, derive failure presence with `provenanceError !== null`, and use that predicate consistently. Check `StageRecord`’s `!error` gate too. This replaces raw copy and duplicated interpretation; no new refusal is introduced.

## WCO6 — Failed retry forgets an accepted absence

**Confirmed · R · owner decision; no automatic Tier 1 repair.**

I exercised opening 404 → failed refresh → failed retry across all thirteen hooks:

```text
Ideas, Timeline, FAQ, Debate, Quotes, Glossary, Citations, Quiz,
Simple, Sketch, Illustrated, Skim: none → error
Tweets:                            none → none
```

Trace: nullable-value check in `retryRead` sets loading → ordinary catch changes loading to error. Tweets instead consults `answered` and settles to none. Panel gates consequently retain Generate only on Thread.

**Fix claim:** a discriminated read can preserve accepted absence, but it does **not** decide whether Generate remains available after a failed retry. An adapter can reproduce either policy.

The owner must choose that spending policy. If retaining Generate wins, the smallest repair is to retain knowledge of the accepted absence through retry; it does not require the whole type migration.

## WCO7 — Illustrated stringifies `StepFailure`

**Confirmed · C; string coercion reproduced · Tier 1/P3. Safe to build.**

`useStepJob.failed` returns an object. Its interpolation feeds `useSketchReadiness`’s effect dependency.

```text
original keys equal: true
message keys equal: false
```

That probe compared two different failure messages with no job ID. Job appearance/disappearance still changes the other key component, so this is not evidence that ordinary job completion is missed.

**Fix:** `queue.failed?.message ?? ""` is a small correction and duplicates nothing. It may trigger an additional prerequisite GET when refusal wording changes. It is not a unique failure-event identity: identical messages still collide. No new refusal.

## WCO8 — Stale counts and filesystem descriptions

**Confirmed · C · Tier 1/P3. Safe to correct current descriptions.**

Recount:

```sh
rg -l 'useOrderedRead\(' src/web
# 20 matching files: 19 executable callers + the definition

rg -n 'useAutoRun\(' src/web
# 16 matching lines: 14 calls + definition + comment
```

AST counting confirms **19 ordered-read calls, 14 auto-run calls, six hold calls**. Sol’s zone-only count of fifteen ordered-read calls is also correct; Arc, Relations, Citers and Metadata account for the wider difference.

Metadata’s route calls `articleMetadata`, whose Postgres implementation reads revision runs and blocks. The directory-walking descriptions are false.

**Fix:** remove current sibling counts and correct storage descriptions. The dated `useOrderedRead` account of the original seven copied readers is historical evidence, not a claim about today’s membership; do not treat every historical number as stale.

The visible “Checking which files…” wording is a separate copy change, as Opus correctly records.

## WCO9 — Reader branches missing from the checklist

**Confirmed · C, with an overstated executable count · Tier 1/P3. Safe signposting change.**

The original grep returns **21 lines**, including comments and `quizNav.mode`.

AST counting of executable comparisons whose left operand is the direct `mode` identifier gives:

```text
19 expressions on 17 lines
7 modes: chat, learn, plain, quotes, referee, skim, structure
```

The nine-mode count includes retired/comment-only comparisons. Nevertheless, the chrome, stepping, handoff and overlay branches exist outside `modeBand`, and the client residue does not identify them.

**Fix:** add a short pointer to those responsibilities. This duplicates neither the switch nor a registry. It is signposting, not a new rule. Include sub-mode foreground and recovery checks: Sol’s Debate findings show why a comparison-only search is incomplete.

## WCO10 — Shared read-result type

**Confirmed · C for the representation problem; H for estimates · Tier 2 for the approved Ideas spike, Tier 3 for broad rollout.**

`useIdeasRead` independently stores status, value, error and answer metadata. Its failed refresh preserves the previous status; `IdeasPanel` consumes status and error separately. `PublicRead<T>` represents an HTTP result and is not the lifecycle type.

The stated regex reproduces **93 matching lines in twenty files**, but that is a status/error census, not the migration’s complete scope. The claimed four Ideas consumers omit `modes/ideas/IdeasMode.tsx`, which passes the value and generation identity. There are at least **five direct consumer files**, plus the hook. The time estimates remain H.

**Fix:** the already-approved one-hook spike can proceed without further owner approval if it preserves presentation and spending policy. Delete Ideas’ independent read-state machinery; retain domain parsing, ordered reads, freshness bookkeeping, job state and holds.

Shared pure transitions are a separate proposal, not a prerequisite proved by these postmortems. A union alone does not enforce transitions or failure rendering. Stop conditions should concern duplicated **read facts**, not legitimate companion state.

## Agreements

| Opus | Sol | Independent agreement |
|---|---|---|
| WCO10 | WC3 | Ideas is the representative spike; retain previous knowledge and domain facts; keep ordering/jobs/holds separate; do not generalise `PublicRead`. |
| WCO4 | Unnumbered malformed-response matrix | Tweets and Skim lack acceptance checks; no current malformed producer established. |
| WCO2 | Unnumbered Crossrefs matrix | Failed reads discard accepted links. Sol records the behavior but does not nominate its repair. |

WCO1 and WCO3 have no independently nominated Sol counterpart. Sol’s WC1, WC2 and WC4 have no Opus counterpart.

## Disagreements

- **Refresh-in-flight state:** Sol requires it; Opus rejects it because nothing currently draws it. Current refreshes are invisible to consumers; neither design is compelled by present rendering. The spike should characterise retained knowledge and preserve presentation. Exposing a spinner is a separate choice.
- **Type versus generic loader:** neither entails the other. Existing hooks have domain validators, mutations and prerequisite policies. An atomic result type need not centralise fetches.
- **Collections:** Opus’s blanket “no retry on purpose” exclusion is too broad. Comments, Search and Criteria deliberately use opening snapshots; Chat exposes `reload`. This does not enlarge the Ideas spike.
- **Coverage counts:** fifteen zone calls and nineteen whole-client calls are compatible. Ninety-three regex lines do not establish a complete migration scope.
- **Hold authorization:** the written rule already covers forced verbs, including an existing append mode. Applying it is defect repair; adding exemptions needs an owner decision.

## Missed by both

**P3 · C:** `src/routes.ts`, immediately above the Metadata GET, still says “stat-ing every file”. The handler calls the Postgres `articleMetadata` implementation. Correct it with WCO8; no separate abstraction or worktree is warranted.

No additional live defect was established.

## Build order and overlaps

| Order | Work | File set / overlap |
|---|---|---|
| 1 | WCO1: Quiz completion | `useQuiz.ts`, always-mounted refresh test. Overlaps WCO8’s Quiz comment cleanup. |
| 2 | WCO2: retain Crossrefs on failure; reuse listener | `useCrossrefs.ts`, focused regression. Independent of other implementation files. |
| 3 | WCO5: Metadata failure copy/presence | `Metadata.tsx`, Metadata regression. Cluster WCO8’s Metadata cleanup here. |
| 4 | WCO3: missing holds | Seven hooks/panels, `find-more.ts`, rewrite-hold tests. Overlaps WCO4, WCO7, WCO8 and several read-type consumers. |
| 5 | WCO4: validate Tweets/Skim before publication | Two hooks and malformed-response matrix. Run after the hold cluster where files overlap. |
| 6 | WCO7–WCO9: mechanical cleanup/signposts | Fold touched-file comments into earlier clusters; keep remaining docs/route cleanup separate. |
| 7 | WCO10: characterised Ideas spike | Ideas hook/panel/mode, Marginalia, Skim hook/mode, adapter. Overlaps WCO3/WCO4 through Skim and WCO8 through Ideas. |

WCO6 waits for the owner’s Generate-after-failure decision. Broad read-type rollout waits for evidence from the spike. Sol’s separate comment and Debate defects should retain their own reviewed build scopes.