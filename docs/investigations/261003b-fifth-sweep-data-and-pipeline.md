# Data model and pipeline: fifth sweep investigation

This is the read-only data and pipeline investigation for the [fifth codebase sweep](../plans/261003f-fifth-codebase-sweep-umbrella.md), inspected on 2026-10-03 at `59bd411712e4861e3d03a85d25b9f8d88d9797a5`. It identifies two reachable defects, two mechanical improvements, and two bounded extractions. Nothing was edited.

## Scope and evidence limits

Read the depth brief, shared brief, prior-sweep digest, and knowledge nominations in that order.
`C-measurements.md` and `D-gpt-breadth.md` were absent on the initial and final directory checks.
The breadth prompt existed; it was not treated as a completed investigation.

Read the sweep method, project vision, documentation policy, block-id contract, and relevant
architecture and security guidance. Checked the named earlier sweep plans before retaining proposals.

Inspected these areas:

- `src/types.ts`: declarations, runtime helpers, import direction, and recent reasons to change.
- `src/db/schema.ts`: article/revision/block relationships, typed JSON columns, and constraints.
- `src/store/pg.ts`, `contracts.ts`, artifact storage, stamps, and product validation.
- `src/pipeline.ts`, `jobs.ts`, `step-order.ts`, and their registration checks.
- `src/models.ts`, `ai-call.ts`, `messages-stream.ts`, and Messages-wire stage shells.
- Source fingerprints and selected block-id consumers.
- Search and Referee criteria decisions, SQL adapters, and their route lifetimes.
- Relevant tests and historical changes that demonstrate divergence.

This was targeted source and history inspection, not an exhaustive reading of every large file.
No database, provider, browser, dev server, or full test suite was started.
One pure-function probe ran in memory, without importing the application or writing a file.

Consequently:

- “Reproduced” below applies only to that pure decision.
- SQL and request-path conclusions are labelled **proved from the code**.
- Production incidence, provider behaviour, performance, and race frequency were not measured.
- The supplied fan-in figure of 954 was not independently verified.
- No lint, typecheck, cycle, or whole-suite result is claimed.

## Measurements and what they mean

A narrow history measurement supplements the missing measurements input.

| File | Lines | Non-merge changes since September 8 | Subjects containing `fix` |
|---|---:|---:|---:|
| `src/types.ts` | 6,749 | 90 | 16 |
| `src/db/schema.ts` | 6,242 | 46 | 3 |
| `src/store/pg.ts` | 4,190 | 53 | 11 |
| `src/store/contracts.ts` | 2,715 | 35 | 4 |
| `src/pipeline.ts` | 4,905 | 48 | 9 |
| `src/jobs.ts` | 4,477 | 25 | 3 |
| `src/models.ts` | 1,942 | 34 | 4 |
| `src/ai-call.ts` | 2,757 | 26 | 2 |

Commands underlying the table:

```sh
wc -l src/types.ts src/db/schema.ts src/store/{pg,contracts}.ts \
  src/{pipeline,jobs,models,ai-call}.ts
git log --since=2026-09-08 --no-merges --format='%s' -- <file>
```

The subject count used a case-insensitive substring search for `fix`.
It is a rough indicator of maintenance activity, not a count of bugs or independent incidents.

`types.ts` also contains executable domain behaviour:

```sh
rg -c '^export function ' src/types.ts   # 25
rg -c '^export interface ' src/types.ts  # 125
rg -c '^export type ' src/types.ts       # 80
rg -c '^export const ' src/types.ts      # 29
rg -n '^import ' src/types.ts           # 3 imports
```

Those measurements justify inspecting reasons to change. They do not, alone, justify splitting files.

## Findings

### D1 — Referee history trimming can delete a criterion being answered

**Tier T0 · Effort S · Value high · Risk low.**

**Evidence:** reproduced in the pure decision; proved from the code through the live SQL path.

Relevant sites:

- `src/saved-criteria.ts:78`: `MAX_CRITERIA = 20`.
- `src/referee-criteria-store.ts:67`: `withCriterion`.
- `src/referee-criteria-store.ts:126`: unconditional `slice(-MAX_CRITERIA)`.
- `src/store/pg-referee-criteria.ts:233`: SQL trimming after insertion.
- `src/store/pg-referee-criteria.ts:340`: completion requires the pending row and its attempt.
- `src/routes.ts:4706`: begin the criterion before running the model.
- `src/routes.ts:4745`: finish it afterwards; an absent row produces no `done` frame.

The shortest counterexample needs a full history and two requests, not twenty simultaneous calls:

1. The oldest of twenty saved criteria has failed.
2. Retry it. `withCriterion` preserves its original `createdAt` and resets it to `pending`.
3. While that request is answering, begin one new criterion.
4. The SQL trim selects the oldest row beyond the cap and deletes the pending retry.
5. Its eventual `finish` updates nothing because the row no longer exists.
6. Reloading cannot recover the paid answer.

The article lock serializes the `begin` transactions. It does not protect the model call between
`begin` and `finish`, so it does not prevent this sequence.

An in-memory probe extracted the actual `withCriterion` function, stripped its TypeScript using
Node, and supplied twenty rows. Its result was:

```json
{
  "cap": 20,
  "retryKind": "reset",
  "retryStatus": "pending",
  "retryKeptCreatedAt": true,
  "afterCount": 20,
  "pendingRetrySurvives": false
}
```

The probe supplied an unused requested id, so no random-id generation was needed.
It establishes the pure decision; the SQL conclusion comes from reading the adapter.

**Drift is historical, not inferred from resemblance.**
Commit `e630f17a4`, “a running search survives the trim”, fixed this exact class in Search:

- `src/searches.ts:273`: `trimRuns` preserves pending rows.
- `src/store/pg-searches.ts:330`: excludes pending candidates.
- `src/store/pg-searches.ts:337`: repeats the exclusion in the deletion predicate.

The Referee copies retain the old behaviour.

**Cheapest fix:** apply pending-row protection to Referee’s pure and SQL trim.
Keep the SQL status predicate even after filtering candidates.
Do not weaken completion fencing or recreate a deleted row.

**Required evidence before landing:** a database regression using the retry-oldest sequence,
with model work held by a deferred promise. Show the current deletion, then show completion
survives the new criterion. Keep an explicit-delete case proving deletion still wins.

**File set:** `src/referee-criteria-store.ts`, `src/store/pg-referee-criteria.ts`,
their existing pure/store tests, and the Referee reference documentation.

### D2 — Illustrated drops the specific model-refusal explanation

**Tier T0 · Effort S · Value medium · Risk low.**

**Evidence:** proved from the code through the stage and job failure seam.

At `src/illustrated.ts:1211`:

```ts
if (wasRefused(message)) throw new Error(MODEL_REFUSED.message);
```

The corresponding Arc shell at `src/arc.ts:467` throws
`stageFailure(MODEL_REFUSED, { authored: ... })`.

The reachable path is:

```text
STEPS.illustrated.run
  → generateIllustrated                 pipeline.ts:4376
  → plain Error on provider refusal     illustrated.ts:1211
  → runStep catch
  → readerFailureOf                     jobs.ts:1313
  → generic blocked sentence            job-failure.ts:314
```

`failureKindOf` at `src/job-failure.ts:397` still recognizes the bracketed refusal code.
Therefore **Retry remains disabled**. This is not a misclassified retryable error.

The defect is narrower: the specific explanation that the provider declined the request is
discarded. The job stores the generic “could not be done for this article” explanation instead.

There is one exact plain-error throw of this form under `src/`:

```sh
rg -n 'new Error\(MODEL_REFUSED.message\)' src
# src/illustrated.ts:1211
```

Commit `46439f1c2` introduced the separate diagnostic/reader failure seam on September 3.
Illustrated’s plain-error form entered with `6f02dcbbd` that day and remains outside that seam.
The migrated siblings demonstrate the required declaration.

**Cheapest fix:** use the existing `stageFailure` form at this throw site.

**Required evidence:** drive an Illustrated refusal through the real shell and assert the
reader failure is `MODEL_REFUSED`, then check the job’s stored message and blocked kind.
An injected `stageFailure` in a generic job test does not test this caller.

**File set:** `src/illustrated.ts`, `tests/illustrated-run.test.ts`,
and the relevant stage-failure test if its existing harness can exercise this path.

### D3 — Store contracts still permit omitted attempt tokens for a deleted implementation

**Tier T1 · Effort M · Value high · Risk medium.**

**Evidence:** proved from interface declarations and the active adapters’ runtime refusals.
No currently broken production caller was established.

Examples in `src/store/contracts.ts`:

- `CommentStore.beginAnswer`, line 497, returns `attempt: string | undefined`.
- `Turn`, line 980, permits an undefined attempt.
- `ChatStore.finish`, line 1037, permits omitted options and attempt.
- `SearchStore.begin`/`finish`, lines 1163 and 1182, permit an undefined or omitted attempt.
- `RefereeCriteriaStore.begin`/`finish`, lines 1253 and 1267, do the same.

The comments explicitly justify these signatures by the filesystem adapter having no attempts.
That adapter is gone.

The active adapters refuse the allowed input:

```sh
rg -n 'attempt === undefined' src/store/pg-*.ts
```

The four guards are in `pg-chat.ts:433`, `pg-comments.ts:635`,
`pg-searches.ts:367`, and `pg-referee-criteria.ts:284`.

This makes the compiler approve a mistake that the only implementation rejects.
It also weakens test doubles: a fake can omit the token and still satisfy the contract.

**Cheapest fix:** make returned attempt tokens and completion arguments required at these seams.
Keep runtime validation for untyped callers and defence against malformed values.
This requires no database migration.

Start with Search and Referee, whose completion protocols closely match.
Handle Chat’s options object and Comment’s answer patch separately rather than imposing a generic
run interface.

Search and Referee also accept `Partial<...>` completion patches while rejecting nonterminal
statuses at runtime. Narrowing those patches to the writable answer fields and a required
`"done" | "error"` status is a compatible follow-on, provided callers are inventoried.

**File set:** `src/store/contracts.ts`, the four named adapters, actual completion callers and
their fakes. The compiler should identify the caller set; do not repair failures with casts.

**Prior-sweep check:** the old retry-predicate proposal does not close this contract gap.
This finding removes an obsolete concession rather than introducing another retry mechanism.

### D4 — Cache-group prose contradicts the current executable policy

**Tier T1 · Effort S · Value medium · Risk low.**

**Evidence:** proved from the current cache comparison, its schema table, and surviving comments.

The nomination that effort tables are repeated “for the third time” is misleading.
The phrases in `src/types.ts:3096` and `src/step-order.ts:105` are explanatory prose.
Executable effort values live in `src/models.ts:1758`, `STAGE_EFFORT`.

There is nevertheless real drift:

- `step-order.ts` says Glossary/Quotes and Ideas/Timeline/Quiz/FAQ share cached prefixes.
- `types.ts` repeats those claims beside `StepName`.
- `models.ts` now explains that distinct output schemas prevent those shares.
- `pipeline.ts:344` declares `ARTICLE_OUTPUT_FORMAT`.
- `pipeline.ts:377` compares effort, renderer, **and output format**.
- `tests/article-cache-group.test.ts:159` explicitly checks that no distinct compatible pair remains.

The schema migration changed the executable answer and some explanations.
It did not reach these adjacent copies of the rationale.

**Cheapest fix:** delete the duplicated cache-membership explanations from `StepName`.
Keep ordering reasons in `step-order.ts` only where they still affect prerequisites or current
behaviour; point cache policy readers to the executable comparison.

Do not add another effort registry. That would solve a duplication the code does not have.

The older storage narrative in `docs/project/architecture.md` also contains fixed stage counts
and head-function memberships that its later Conventions section correctly tells readers not to copy.
Treat that as the same documentation cleanup, preserving the actual exceptions.

**File set:** `src/types.ts`, `src/step-order.ts`, relevant comments in `src/models.ts`,
and `docs/project/architecture.md`.

### D5 — Metadata freshness reconstructs decisions already made by pipeline stamps

**Tier T2 · Effort M · Value high · Risk medium.**

**Evidence:** current duplication proved from the code; historical behavioural drift documented
at the affected sites. No new present-day freshness mismatch was established.

The queue asks `stepIsDone` at `src/pipeline.ts:1166`:

```text
interrupted? → outputs present? → expected stamp → sameStamp
```

The metadata reader separately answers currency inside
`src/store/pg.ts:2933`, `articleMetadata`, through the switch at line 2973.

It reconstructs expected fingerprints, prompt versions and model generations.
Examples include Labels at line 3023, Tweets at 3071, Simple at 3250, and Skim at 3276.

This is the consequential duplication in `pg.ts`.
Its row types are already derived from schema/projection types; its public methods already
implement `ArticleReader`. Those declarations are not the main duplication problem.

The freshness copies have drifted before:

- The Tweets arm records that prompt/model checks were absent until October 1.
- The Assets arm records its required change from `hashBlocks` to `assetsInputHash`.
- `ideasAreCurrent` records an earlier omission that let completed work appear current.
- `tests/store-revision-columns.test.ts:667` checks that stamped steps have switch cases.

That last check is useful but weaker than agreement: a case with an incomplete comparison passes it.

**Cheapest fix:** share each affected stage’s pure expected-stamp construction between the pipeline
and metadata reader. Start with ordinary non-personalized stages.
Keep data acquisition, output-presence checks, and interpretation of reader-profile changes local.

Do not make `pg.ts` import the pipeline registry: that would pull orchestration back into storage.
Do not collapse these distinct questions:

- Is the output present?
- Does its input/prompt/model stamp match?
- Is this output suitable for the current profile?
- May this revision be published?

**Required evidence:** before extraction, compare both real readers over changed blocks, tree,
metadata, prompt version, and model generation. Include unchanged inputs and absent artifacts.
Preserve `sameGenerator`’s intentional standard/high-power equivalence.

**File set:** `src/store/pg.ts`, `src/pipeline.ts`, the selected stages’ fingerprint/version owners,
and their freshness tests. Expand stage by stage rather than moving the whole switch at once.

### D6 — Messages-wire result handling has enough callers and proven drift to share

**Tier T2 · Effort M · Value medium · Risk medium.**

**Evidence:** repeated executable shells plus D2’s concrete missed failure declaration.

Census:

```sh
rg -l 'streamMessage\(' src --glob '*.ts' | sort
# 18 files, including the defining messages-stream.ts: 17 caller files

rg -l 'now - last < 500' src --glob '*.ts' | sort
# 15 files containing this exact progress-throttling idiom
```

The caller set includes article stages, Structure, Labels, and Structure Deepen.
It is not seventeen interchangeable top-level pipeline steps.

Arc at `src/arc.ts:427`, Glossary at `src/glossary.ts:1515`, and Citations at
`src/citations.ts:1832` show the repeated sequence:

```text
start metered stream → progress → finalMessage
→ refusal → truncation → join text → stage-specific parse/validation
```

D2 proves why keeping the failure sequence in sync matters.
Text extraction also appears separately in answer-length calculations and final parsing.

**Cheapest useful extraction:** a small result-level helper for text extraction and the ordinary
refusal/truncation contract. Use the existing Messages boundary if its import graph permits;
otherwise a small pure companion module with these callers passes the deletion test.

Do not move prompting, validation, retries, checkpointing, or persistence into it.
Do not replace `call.finalMessage()` with the SDK stream’s method; the wrapper records spend.

Simple’s shell returns usage alongside some failures and coordinates sibling calls.
Labels retries batches. Structure Deepen has its own truncation outcome.
Keep those control flows explicit; share only the result operations they actually have in common.

A progress helper is lower priority: repetition is established, but a current behavioural defect
in the throttle was not established.

**File set:** the Messages result helper and the audited caller modules, with shell-level tests.
Start after D2’s failing test exists. This is not the previously rejected stall-timer abstraction.

## `types.ts`: several reasons to change, but not universal runtime coupling

The file is a broad shared-contract home. It is also accumulating domain behaviour.

Examples of independent reasons to change include:

- Block and tree representation.
- Reader comments and highlight colours.
- Search modes and saved runs.
- Simple Summary validation and fidelity-check state.
- Debate result interpretation and legacy compatibility.
- Feedback pagination, cursor encoding, and filters.

The recent history confirms those are active reasons, not imagined future ones:
`3e2d0b9a8` changes highlights, `157a4c74d` feedback counts,
`c549dda30` quick search, and `b5b21cb56` Quiz profile reporting.

But high fan-in does **not** mean every consumer loads every other feature.
`src/types.ts:27` has two type-only imports and one value import, from the leaf `ids.ts`.
It does not import the pipeline, database, or feature implementations.

A whole-file split is therefore not ranked as a repair.
There is no measured bundle, compilation, or merge-conflict improvement to attach to it.

The sensible next boundary is a cohesive domain leaf when that domain is already changing:
Simple’s validators beside its shared shapes, for example, or Feedback’s cursor protocol.
Keep server and browser users on that same leaf. Avoid a new barrel that merely restores the
original dependency hub under another name.

## Step registration: what the compiler already protects

A new step has several declarations, but many missed edits already fail mechanically:

| Declaration | Existing protection |
|---|---|
| `STEP_ORDER` | `StepsMissingFromOrder` checks omitted `StepName` members |
| `STEPS` | Mapped type binds each key to `PipelineStep<K>` |
| `STEP_BUDGET_MS` | Exhaustive `Record<StepName, number>` |
| `STAMP_SOURCE` | Exhaustive `Record<StepName, ArtifactKind \| null>` |
| `STORAGE` | Exhaustive outer step map |
| `STEP_STORAGE` | Exhaustive `Record<StepName, string[]>` |
| Task tier/wire/environment tables | Exhaustive task-keyed records |
| Article effort/renderer/output-format tables | Exhaustive `ArticleStage` records |

Locate these with:

```sh
rg -n 'Record<StepName|\[S in StepName\]|\[K in StepName\]' \
  src/{pipeline,jobs}.ts src/store/{pg,artifacts,artifact-storage}.ts
```

The remaining distinction is between **requiring a row** and **requiring the correct row**.
`STORAGE` uses a partial artifact map; `PipelineStep.produces` names artifacts independently;
`ArtifactParts` is partial. Their relationship is checked by `checkProduct`
(`src/store/session.ts:377`) and `tests/store-artefacts-pg.test.ts:150`.

A literal step-to-output map could make returned products and storage keys agree at compile time.
However, no current mismatch was found, and runtime checks already reject missing and extra parts.
That is a lower-priority type improvement, not a reason to build a universal step registry.

## Block identities and content hashes

The inspected block-id consumers respect document order:

- `src/structure.ts:1899` builds an id-to-position map.
- Its range handling at line 1930 validates shape and resolves both endpoints.
- `src/ideas.ts:262` checks occurrences against existing blocks.
- `src/crossrefs.ts:260` separates document positions from eligible evidence blocks.
- Database identities remain scoped to articles, with revision content stored separately.

No lexicographic-id range defect was established in these inspected paths.
This is not a claim about every client and server consumer.

The fingerprint family is a sound design: different prompt heads have different inputs.
`articleFingerprint`, `articleWithIdsFingerprint`, and `datedArticleFingerprint`
must not be merged merely because their implementations resemble one another.

Likewise, source identity, artifact freshness, provider prompt caching, and paid-work checkpoints
are different contracts. In particular, model-generation equivalence for freshness must not
replace the exact model identity in checkpoint keys.

Structure’s existence-based skip and the blocks step’s structural comparison are documented
exceptions. Turning either into a generic hash cache without addressing identity preservation
and downstream invalidation would be a regression.

## Testability

There are useful seams already: `advanceJobWith` accepts dependencies, query builders expose
their SQL, and fingerprint functions are pure. The queue is not wholly trapped inside a timer.

Two weaknesses remain relevant to this investigation:

- Metadata’s `isCurrent` is nested inside the database reader. Its source-scanning test checks
  case registration rather than behavioural agreement. D5 supplies the missing pure seam.
- `tests/jobs.test.ts:2051` sleeps for 30 ms to keep a mocked fetch running while two advances race.
  The assertions at line 2074 require one caller to observe `busy`.
  A slow database can move the second claim outside the intended overlap.

The latter is a **hypothesis of flakiness**, not a reproduced failure.
Replace the fixed overlap window with an entered/release barrier while retaining the real SQL claim.

Do not mechanically replace all sleeps: the 25 ms settle loop and 50 ms busy loops in that file
poll observable state with bounds. They are different from assuming work overlaps for 30 ms.

## Two ways to do one thing: verdicts

| Pair | Verdict |
|---|---|
| Search and Referee retention | Proven missed fix; D1 |
| Plain versus declared Messages refusal | Proven current user-visible difference; D2 |
| Optional attempt contract versus mandatory adapter | Proven contract mismatch; D3 |
| Cache-group prose versus schema-aware comparison | Proven stale explanation; D4 |
| Pipeline stamp versus metadata currency | Historical drift; bounded extraction D5 |
| Messages result shells | Extraction justified by D2; preserve caller control flow |
| Search versus Referee retry identity | Current differences are deliberate; do not flatten |

Search now requires matching search kind and supports quick-search revision.
Referee deliberately adopts changed configuration on retry.
The older proposal to share a three-condition retry predicate needs reconsideration against that
current behaviour. The demonstrated shared defect is retention, not those differing predicates.

The route’s Referee live-set removal also precedes persistence (`routes.ts:4737`).
Search moved its protection past persistence in `e630f17a4`.
This is an audit lead, not an additional T0: Referee’s age grace must also expire before a sweep
can win, and that timing was not reproduced here.

## PRODUCT possibilities

No product simplification is recommended for implementation from this evidence.

Two options are worth distinguishing from the technical repairs:

- Remove automatic history eviction in favour of explicit deletion.
  This removes retention deletion logic, but requires a separate decision about history growth
  and navigation. D1 can be fixed without changing the product this way.
- Remove cross-step prompt-cache prediction while distinct schemas prevent sharing.
  Current compatible-pair coverage says it provides no cross-step hit today.
  Preserve Simple’s separate within-step caching. There is no established reader-facing loss
  today, but changing the policy deserves a measured cost comparison before deletion.

Do not change model effort, merge modes, or reduce reader capabilities to simplify registration.

## Considered and rejected

- **Split `types.ts`, `schema.ts`, or `pg.ts` by line count:** size is insufficient evidence.
- **Derive browser contracts from database rows:** leaks persistence shape across an intentional seam.
- **Replace schema projections with whole-row reads:** reverses the existing payload protections.
- **One registry owning models, storage, ordering, prompts and runners:** couples separate policies.
- **Treat the repeated “high effort” prose as executable tables:** the nomination was factually wrong.
- **Merge Search and Referee retry state machines:** their current product semantics differ.
- **Reintroduce an alternate store:** no requirement, and it would restore the source of D3.
- **Delete runtime fencing after tightening types:** types cannot validate old rows or untyped input.
- **Merge all AI wires:** metering is shared; streaming and provider contracts legitimately differ.
- **Extract stall timers because progress throttles repeat:** different mechanisms; earlier rejection stands.
- **Report every sampled sleep as a flaky test:** polling and fixed overlap have different meanings.
- **Call documented block-id trust limitations newly discovered defects:** no new exploit path established.

## Ranked work and parallel boundaries

| Rank | Cluster | Findings | File ownership and sequencing |
|---|---|---|---|
| 1 | Preserve active Referee answers | D1 | Referee pure/store files and tests |
| 2 | Preserve the Illustrated refusal explanation | D2 | Illustrated runner and refusal tests |
| 3 | Require attempt tokens in contracts | D3 | Contracts, adapters, callers; after D1 |
| 4 | Share ordinary Messages result handling | D6 | Messages helper and stage shells; after D2 |
| 5 | Remove false cache-group explanations | D4 | Types/order/model comments and architecture prose |
| 6 | Share expected freshness stamps | D5 | Pipeline, reader, selected stage owners; after D6 |

D1 and D2 have non-overlapping primary file sets and can start independently.
D3 overlaps D1’s adapter and may reach `routes.ts`; reserve those files together.
D6 overlaps D2 and the stage files D5 would touch, so those stages should be sequential.
D4 should remain a narrow prose change, not an opportunistic type-module split.

Counts: **2 T0, 2 T1, 2 T2, no T3**.
The five highest-priority findings are D1, D2, D3, D6, and D4.

## One level up

The overall approach is sound: one durable store, article-scoped stable identities, transactional
publication, metered model calls, explicit stage products, and fingerprints tailored to inputs.

The main weakness is policy copied across adjacent consumers while the interfaces remain valid.
One copy gains pending-row protection, a declared failure, or a freshness dimension; its sibling
continues compiling and reporting success.

The useful work is to close those specific gaps with required types, shared pure decisions,
and tests at the consuming seam. This investigation does not justify replacing the pipeline or
rearchitecting the data model.