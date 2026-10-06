# Seventh sweep, depth: server request path (GPT Sol, read-only, 2026-10-06)

## What I read

Checkout: `bf78e90c7f718fb042d51f9aa394c72c335514a5`. No tracked files changed. No network or database access.

I used the requested churn measurement:

```sh
git log --since=2026-09-20 --format= --name-only -i --grep=fix \
  -- src/routes.ts 'src/routes-*.ts' src/index.ts src/store src/stream-run.ts \
  | sort | uniq -c | sort -rn
```

The leading counts were `routes.ts` 41, `pg.ts` 24, `contracts.ts` 14, `public-reader.ts` 8 and `pg-revisions.ts` 6. These count appearances in commits whose messages contain “fix”, not distinct defects. I concentrated on request validation, streamed completion and transactional chat invariants.

| Coverage | Files and sections |
|---|---|
| Full source reads | `src/auth.ts`, `src/chat.ts`, `src/store/pg-chat.ts`, `src/store/pg-comments.ts`, `src/stream-run.ts` |
| Executable bodies read end to end; comments selectively read | `src/store/pg-revisions.ts`, `src/store/public-reader.ts`, `src/store/db-errors.ts`, `src/faq.ts`, `src/search.ts` |
| Substantial partial reads | `routes.ts`: authentication/error boundary, dispatch, artefact reads, comment explanation, glossary streams, citation investigation, quiz marking, typed chat, search and referee streams; `pg.ts`: ownership/locking, current-revision reads, article loading and mode loaders |
| Supporting partial reads | `contracts.ts`: comments, chat, search and attempt contracts; `store/index.ts`: adapter selection and guards; `converse.ts`: generation loop, tools, deadlines and terminal classification; other listed mode runners: fingerprints, generation-input preparation and freshness checks |
| Narrow supporting reads | `term-lookup.ts`, `dig-deeper.ts`, citation investigation allowance, public DTO construction, client comment replacement, queue admission and transport entry points |
| Skipped | Remaining route families, most other mode parsers/prompts, unrelated store adapters, complete job execution, complete public DTO leaf transforms, and most transport configuration |

There is no `src/index.ts` or `src/routes-*.ts` in this checkout. The transport entries are `src/vercel.ts` and the Vite middleware; these received a partial read.

I read the required fifth/sixth sweep material, including the server investigation and server review findings. Relevant recent postmortems included the live-hold cleanup boundary, the per-process origin check, the missing-versus-deleted thread distinction and the optional memory boundary.

Local verification:

```sh
npx vitest run tests/chat-origin-transaction.test.ts
npx vitest run tests/comment-answer-marker.test.ts
npx vitest run tests/store-guard-idempotent.test.ts
```

Results: respectively **15, 2 and 13 tests passed**. No test failed. These verify existing protections; they do not cover the defects below.

## What the method could not see

This was a source investigation with focused execution of pure helpers and extracted current handler bodies. Handler probes mocked store, model and transport leaves. They reproduce the local decision or ordering error, not an HTTP request through Postgres.

I could not measure deployed frequency, inspect existing rows, exercise two server processes against one database, or verify database timing and publication behaviour. I did not run the full suite or typecheck, or audit the entire server zone.

For database verification, the orchestrator can run:

```sh
npx vitest run tests/store-chat-pg.test.ts
npx vitest run tests/store-comments.test.ts
```

Those suites need the configured database test environment. They should be extended with the cases below; their existing tests alone do not establish that these cases work.

## Findings

Tier 0 first, ranked by ease × value. Ease and value use 1–5.

### SV1 — A stale edit stops the current answer before it is rejected

**Evidence:** R for handler ordering with mocked leaves; C for the database-backed path.  
**Tier:** 0. **Ease:** 5. **Value:** 4. **Risk:** low.

**Where:** `src/routes.ts` → `streamChat`, “Refuse a stale request before anything is aborted”; `src/store/pg-chat.ts` → `edit`, `requireTail`; `src/chat.ts` → `requireTail`.

The route validates an edit with `withEdit(snapshot, …)`, then calls `settleThread`. But `withEdit` does not check `expectedTailId`. That check happens later inside the store transaction.

**Failing input:**

1. Tab B last saw Q1/A1.
2. Tab A appends Q2; A2 is streaming in this process.
3. B submits an edit of Q1 with `expectedTailId: A1.id`.
4. `withEdit` accepts Q1 as an editable user message.
5. `settleThread` aborts and awaits A2.
6. The store rejects the edit because the real tail is A2.

Tab A’s answer is stopped even though its reader pressed nothing. B receives a conflict, and no replacement answer starts.

I extracted the current `streamChat` declaration with Babel, transpiled it with esbuild and supplied the actual `withEdit`/`requireTail` helpers. The resulting trace was:

```text
abort live Q2 answer
store edit
This conversation has moved on since you opened it. Reload before editing.
currentAnswerStopped: true
```

The real `settleThread` performs the abort and wait; the real store applies the tail check afterward. `serveApi` maps `ChatConflict` to 409.

**Fix claim:** Apply the existing `requireTail(snapshot, threadId, expectedTailId)` before `settleThread` when the edit supplies a string tail. Retain the transactional check. This adds no mechanism: the helper and authoritative fence already exist.

Characterise both cases: a stale edit must leave the active stream running; a valid edit must still stop and replace it. This fixes the locally visible stale request. It does not make the route snapshot authoritative across processes.

### SV2 — Explanation completion sends the old copy of an edited comment

**Evidence:** R for the current handler with mocked leaves; C for the store/client interaction.  
**Tier:** 0. **Ease:** 5. **Value:** 3. **Risk:** low.

**Where:** `src/routes.ts` → `answer` → `settle`, `frame("done", { ...comment, ...patch })`; `src/store/pg-comments.ts` → `patch`; `src/web/useComments.ts` → `put(done)`.

`commentStore.patch` returns the comments as currently stored. On success, the route discards that result and constructs the terminal frame from the comment captured at `beginAnswer`.

**Failing input:**

1. An existing explained comment has body `"old note"` and colour `"yellow"`.
2. Its next explanation begins.
3. A body or colour PATCH succeeds while the model is answering.
4. Explanation completion writes only model fields, correctly preserving the reader’s edit.
5. The terminal frame carries the old body/colour.
6. `useComments.put` replaces the displayed row with that frame.

The database keeps the edit; the tab visibly loses it until a later read.

The extracted current `answer` handler produced:

```text
store result: body "new note", colour "blue"
done frame:   body "old note", colour "yellow"
```

The store’s answer UPDATE does not write body or colour. Its returned list already contains the information the route needs.

**Fix claim:** On a successful patch, frame the matching comment from `kept`, rather than spreading the beginning snapshot. This requires neither an extra query nor a new store signature. Handle a missing matching row deliberately rather than silently claiming the beginning snapshot is current.

Characterise a reader PATCH landing between `beginAnswer` and terminal completion, for both successful and failed model answers.

**Scope limit:** The client’s delta path also spreads its captured `pending` comment. The server correction fixes the terminal rollback, not that separate intermediate-display issue. Forward that sibling to the client-zone owner.

### SV3 — Anchor and help rules stop at the process-local chat check

**Evidence:** R for actual `withTurn` calls; C for the two-process request schedule.  
**Tier:** 0. **Ease:** 4. **Value:** 3. **Risk:** low–medium.

**Where:** `src/routes.ts` → `streamChat`, “A thread is anchored once” and “a ‘?’ press CREATES a conversation”; `src/chat.ts` → `withTurn`; `src/store/pg-chat.ts` → `begin`.

The route refuses a conflicting anchor and a later `help: true` under `inTurnOrder`. The store locks the article and reads an authoritative snapshot, but `withTurn` rechecks only kind and origin. It silently ignores an offered anchor on an existing thread and accepts help on a later user message.

**Failing input:**

Two processes receive first sends for the same owner, article and optimistic thread ID. Both route checks see no thread. Process A creates a thread anchored to passage A. Process B then acquires the database lock with a request anchored to passage B, or carrying `help: true`.

B appends under A’s stored anchor, or records a later question as a help press, although the route’s stated rules forbid both.

Actual helper execution showed:

```text
offered anchor: spya-bbbbbb
stored anchor:  spya-aaaaaa
messages after accepted send: 4

help on later user message: true
messages after accepted help send: 4

conflicting-origin control: ChatConflict
```

The origin control matters: commit `1cf578937` fixed this same class for origins, checking them inside `withTurn`. Its postmortem is `261005h-a-per-process-origin-check-leaves-the-transaction-accepting-another-origin.md`. The neighbouring anchor/help rules did not receive equivalent protection.

**Fix claim:** Enforce anchor compatibility and first-turn-only help against `withTurn`’s existing-thread snapshot, before producing either message. Preserve an identical anchor resend and an ordinary follow-up without an anchor.

The existing `sameAnchor` implementation is private to `routes.ts`. Move that small predicate into an existing pure module and reuse it; do not create a general metadata validator or duplicate its comparison rules. Keep route checks for early, specific refusals.

Add pure transaction-snapshot cases beside `chat-origin-transaction.test.ts`, then verify the same refusals through the Postgres store.

### SV4 — Glossary comments still describe behaviour that changed

**Evidence:** C, including introduction and correction commits.  
**Tier:** 1. **Ease:** 5. **Value:** 1. **Risk:** low.

**Where:** `src/routes.ts` → glossary Ask route, “it writes nothing” and “there is none to reuse”; `streamTermLookup`, “nothing it produces outlives the page”.

These statements are false:

- Ask saves a finished term through `deps.lookups.addTerm`, introduced in `0abd03712`.
- Lookup uses the shared `dig-deeper` allowance, introduced in `2c7a61a8e`.
- The central SSE comment already says that Ask stores its term and cancels. That correction reached the central explanation, not these older comments.

Ask itself remains unbounded. The defect is the obsolete description of its sibling and the supposed reason that no reusable allowance exists.

**Fix claim:** Correct the factual statements and signpost the owning implementation. Keep the existing cancellation choice. Do not replace the false rationale with a new universal stream rule or silently introduce a rate limit.

## Siblings compared

The ownership and accounting mechanisms are shared, but they are separate facts:

- Owner endpoints pass the verified-user gate and resolve owner-scoped articles in the store. `article: "first-capture"` attributes spend; it does not authorise access.
- Public/link reads use the separate public reader and DTO. They do not anonymously invoke the owner endpoints or their mutations.
- **J** below means whole-article generation through `POST /api/jobs`: normally 202 with the public job shape. The route has no per-mode allowance. Queue concurrency is separate from request rate limiting; ingest slots apply to import work.
- **A** means GET returns 200 with the mode response and freshness fields when present. During generation or after a failed generation, an existing artefact remains readable. Absence is 404 `{ error, … }`, or 200 `null` when the client supplies `x-spideryarn-none-yet-as-null`. A genuine storage failure remains an error.
- Reads do not spend on models. **J** work uses job/step accounting; direct streamed work uses the request collector and article attribution.

| Mode | GET; POST / stream; DELETE | Public access | Freshness / stamps | In-flight, failed or absent | Disconnect; allowance |
|---|---|---|---|---|---|
| Glossary | GET; J; `ask` and entry `lookup` SSE; DELETE list retained | Stored DTO; no lookup/hidden owner state | Article hash, prompt version, profile state, panel-run classification | A; item streams use `done` or `error` | Ask cancels; Lookup continues and saves. Lookup: `dig-deeper`; Ask: none |
| Ideas | GET; J; no item stream or DELETE | Stored DTO | Article-with-IDs hash, version, profile | A | Job continues independently; no mode allowance |
| Quotes | GET; J; no item stream or DELETE | Stored DTO | Article hash, version, profile; cleared-profile handling explicitly differs for appended lists | A | Job continues independently; no mode allowance |
| Timeline | GET; J; no item stream or DELETE | Stored DTO | Dated article hash, version; no profile | A | Job continues independently; no mode allowance |
| FAQ | GET; J; no item stream or DELETE | Stored DTO | Article-with-IDs hash, version; no profile | A; an empty questions list is a present artefact | Job continues independently; no mode allowance |
| Citations | GET; J; entry `investigate` SSE; no DELETE | Stored DTO | Article-with-IDs hash and version; investigation stored separately | A; matching-link failure does not discard the list | Investigation continues and saves; `citation-investigate` |
| Debate | GET; J; no generation stream or DELETE | Stored DTO | Article-with-IDs hash and version; search age is provenance, not expiry | A | Job continues independently; no mode allowance |
| Quiz | GET; J; `mark` SSE; no DELETE | Not in public article DTO | Source hash, version, batch ID, profile label | A; failed kept-answer read returns `attempts: null`. Mark errors carry `{ error, text }`; save failure can return `done` with `kept: false` | Mark cancels; no marking allowance |
| Simple summary | GET; J; no request generation stream or DELETE | Stored DTO | Rendered-input hash, prompt compatibility, evidence band, profile | A; unusable legacy shape counts as absent | Job continues independently; no mode allowance |
| Search | GET runs; POST SSE; DELETE run | Completed stored searches through DTO | `hashBlocks` of the exact loaded model input; attempt fence | 200 `{ runs }`, including pending/done/error rows; no runs is `[]`. Model failure is a terminal error row; superseded finish produces no terminal frame | Quick cancels; meaning continues. No route allowance |
| Converse / typed chat | GET threads; POST SSE; DELETE thread; explicit stop/cancel routes | No public chat history or mutations | Attempt token, thread metadata, edit tail; no whole-article freshness stamp | 200 `{ threads }`, with pending/terminal messages; no threads is `[]`. Model failure frames an error and attempts terminal storage | Continues after disconnect; explicit stop aborts. No route allowance |

The null-on-absence helper has **10 call sites**. I counted AST `CallExpression`s whose callee is `orNullWhenNotMadeYet`: glossary, ideas, quotes, timeline, quiz, FAQ, crossrefs, simple summary, debate and citations. The definition is excluded.

Additional read siblings examined:

| Sibling | Difference and reason |
|---|---|
| Tweets, Skim, Relations, Sketch, Illustrated, Arc | Their reads still use 404 for absence; they are outside the current null-on-absence conversion |
| Crossrefs | Uses the null-on-absence helper; public DTO includes fresh crossrefs only |
| Skim | Counts a cleared profile as changed because its route through the piece depends on the profile |
| Illustrated | Freshness depends on both its Sketch/figures and the Sketch’s article inputs |
| Referee criteria / claims | Stored pending work and attempt fences; continue after disconnect |
| Comment explanation | Continues after disconnect and must reconcile a refused write; unlike Search, its client treats an unterminated stream as an error replacement |

The clearest unexplained drift is in validation placement:

| Rule | Early route check | Transaction check |
|---|---|---|
| Thread kind | Yes | `withTurn` |
| Thread origin | Yes | `withTurn`, fixed in `1cf578937` |
| Thread anchor | Yes | Missing — SV3 |
| First-turn help | Yes | Missing — SV3 |
| Edited thread tail | Missing before abort | `requireTail` — SV1 |

## For the owner

No product redesign is needed for SV1–SV4.

Ask’s allowance remains a product choice. Its old “nothing to reuse” rationale is now false, but sharing `dig-deeper` would make ordinary explanations consume the allowance used by deeper searches. A separate allowance would add another policy to maintain. This investigation proposes correcting the facts, not choosing a cap.

The explanation fallback after a superseded write and failed read-back remains a deliberate policy that deserves separate consideration. It can send this attempt’s own answer despite not knowing what the store now holds. Eliminating that fallback requires coordinating with the client: simply ending the stream causes the current client to write its own failure over the row. That is wider than SV2’s successful-write correction.

## Considered and not proposed

- **Split `routes.ts` by size, introduce a mode registry, generic read hook or generic stream shell:** no new evidence that these abstractions close the defects found. The fixes fit existing helpers and transaction boundaries.
- **One disconnect policy:** the differences are explicit choices. Finished-result storage does not imply that unfinished work must continue; Ask demonstrates this.
- **Make all absent artefacts return null:** the current conversion is explicit and opt-in. Its remaining scope is not proof of accidental drift.
- **Make all store methods return the current row:** Chat’s void completion avoids reading every thread after each answer. SV2 already receives the needed stored result.
- **Require an edit tail for every client:** the optional field preserves existing callers. SV1 can be fixed without changing that contract.
- **Rewrite quiz marking around a revision snapshot:** its remaining ABA window and the mismatch between rendered metadata and fingerprint inputs are already documented. I found no new reproduction warranting reversal of that decision.
- **Consolidate error constructors or guards:** the examined adapters are guarded at construction; repeated selection-side guarding is idempotent. The local guard tests passed.
- **Treat `public-reader.scrubbed`’s non-optional status access as a live defect:** a null rejection would break that catch, but I found no reachable producer. Not ranked as a live finding.
- **Repeat the fifth sweep’s URI-decoding, duplicate spend-attribution or obsolete citation-find findings:** the relevant changes are present in this checkout.

## One level up

The request/store division remains workable: owner identity is established at the boundary, public reads use a separate projection, durable generation goes through jobs, and stores own transactional decisions. The weakness exposed here is incomplete transfer of invariants between layers. A store correctly rejects an edit after the route has already stopped something; a store returns current data that the route replaces with an older snapshot; a transactional origin check sits beside anchor/help checks that remain process-local. Extending those existing guarantees closes more concrete failure paths than another routing or streaming abstraction.