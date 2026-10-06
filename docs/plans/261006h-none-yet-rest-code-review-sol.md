# 261006h code review and fixes

Candidate: `a7813247055b3aa899e91aeb03fded8a3b3b59d8`. No P0 or P1 found.
Production files are unchanged by this review. No Git state-changing commands were run.

**F1 — P2 — the new exact inventory check could silently miss a mismatch. Reproduced; fixed.**
Candidate `tests/api-fetch-offline.test.ts:454–465` skipped unrecognised route patterns before
comparing names, then tested the offline pattern against only recognised names. A new wrapped
GET with a different slug regex could disappear; an extra offline alternative with no route had
no probe. This was a future-drift guard defect, not a mismatch in the current ten production reads.

The tests that went red first were **“refuses a wrapped GET whose pattern the inventory cannot
recognise”** and **“refuses an offline-pattern name with no wrapped route”**. Both passed after
accounting for every actual helper call and checking the entire regexp. A follow-up negative
fixture, **“does not let a commented wrapper compensate for an unrecognised real call”**, also
went red before associating actual AST call locations with individual entries. The finished guard
is at `tests/api-fetch-offline.test.ts:94`; the three controls start at line 507. Unsupported helper
entries now fail rather than vanish; comments cannot serve as calls; extra alternatives fail.
The existing text scanner still deliberately requires its supported route formatting.

A read-only subagent independently root-caused this, then reviewed the test additions. The
[postmortem](../postmortems/261006m-an-exact-inventory-check-silently-narrows-its-universe.md)
names the class and the wider shared-parser option. Sharing the full route AST inventory with
other cacheability guards is outside this stage; no wider production defect was established.

## Independent route trace

All seven requests pass through `handleApi`, the authenticated dispatcher, its real route table,
and the guarded Postgres loader. Authentication precedes the handler. Article attribution is
accounting; ownership is enforced by `currentRevisionQuery` → `ownedSlug`, which includes both
slug and current owner. An unknown slug and another owner's article therefore produce the same
ordinary `notFound` error before inspecting artefact presence.

For **each of simple, ideas, faq, timeline, debate, glossary and quotes**:

| Situation | Header present | Header absent |
| --- | --- | --- |
| Made, usable artefact | 200 response envelope | Same 200 envelope |
| Owned article, artefact absent | 200 JSON `null` | Original 404 error envelope |
| Unknown slug | 404 error envelope | Same 404 |
| Another reader's article | 404 error envelope | Same 404 |
| Ordinary exception inside `load` | Guarded 5xx error, never null | Same failure |

The ordinary injected store exception reproduced as a 500. Store errors retain their deliberate
numeric statuses; this helper does not rewrite them. Authentication refusal is 401 and does not
call a loader. The owner-isolation conclusion follows from the actual query, rather than a new
Postgres run in this sandbox. Unknown-slug and usable/unusable database cases have the builder's
supplied raw passing output as additional evidence.

| Read | Unusable / empty document | `resolveProfile` failure after successful load |
| --- | --- | --- |
| simple | `simple/1`, null, invalid levels or provenance → absence; fully empty levels are not a valid Simple | 500, either header |
| ideas | Presence predicate unchanged; a valid empty `ideas` array stays a 200 artefact | 500, either header |
| faq | Missing/non-array `questions` → absence; empty array → 200 artefact | No profile read |
| timeline | Presence predicate unchanged; empty `events` → 200 artefact | No profile read |
| debate | Failed `isDebateDocument` → absence; both groups empty → 200 artefact | No profile read |
| glossary | Presence predicate unchanged; valid empty `entries` → 200 artefact, with existing lookup attachment logic | 500, either header |
| quotes | Presence predicate unchanged; an empty list is refused at the write boundary, though a forced stored empty document still reads as 200 | 500, either header |

For the four profiled reads, a later artefact-absence rejection still takes precedence over an
already failed profile read: 200 null with the header, 404 without it. `withProfileChanged` awaits
artefact first and handles the profile promise independently, as before. Added tests control that
ordering rather than merely rejecting both promises immediately. Glossary's `alsoFrom` and
Quotes' cleared-profile rule remain intact.

The helper sets `Cache-Control: private, no-store` before either await, on made, absent and failed
answers. Nothing in the seven clients relies on the former cache headers. The application offline
cache uses its own rules and intentionally ignores this HTTP header.

## Independent client trace

Each named hook has one artefact GET parse, shared by its full/read halves where applicable; the
other Glossary requests are separate mutations or streams. All seven send the opt-in header.
Each checks `current()` after fetch and again after `readJson`, before publishing any setter.

| Reply / circumstance | All seven hooks |
| --- | --- |
| 200 `null` | `none`, artefact null, error cleared, stale/outdated cleared |
| 404 | Same absence state, without trying to parse its error body |
| Real response | `ready`, artefact and flags published |
| `false`, `0`, `""`, `{}`, or artefact field null | Opening read: error / `PAGE_FAULT`; later read: old artefact remains ready, error reported |
| Failed revalidation with an artefact on screen | Existing artefact and ready state remain; error is shown |
| Offline with saved real response | Cache serves synthetic 200 copy; hook accepts the artefact |
| Offline without saved response | Transport failure reaches the hook; opening read fails, already loaded artefact remains |
| JSON finishes after moving to another article | Old absence or artefact is ignored |

Profile-related flags also clear on absence where they exist; Glossary clears `panelRun`.
Added transition tests first set these flags, including a non-null profile hash, before asserting
the reset. Saved-copy acceptance is tested at the hook boundary; fallback, no-copy failure,
owner partitioning and preservation of earlier real copies are tested in the real `apiFetch`.
Null responses are not saved or used to invalidate the earlier copy, whichever request header
was used. HTTP failures are not replaced with offline copies.

The shape checks are intentionally envelope/presence checks, not full document validators.
They reject every requested malformed envelope before publishing state. An object with malformed
inner arrays can still be published, as before; widening this stage into complete schema validation
would change an existing contract. Simple's stricter null-field treatment does not reject a
supported older saved response: from its first loader implementation (`63b2976a5`), a null Simple
was a 404, never a successful `{ simpleSummary: null }` owner response. The offline cache saved
only successful 200s. Public payloads may have a null Simple but do not feed this owner hook.
An artificially malformed cached envelope now gets the same fault treatment as a malformed live
one; actual older Simple documents remain non-null and are not rejected by this presence check.

## Mock repair and mutation evidence

The mode-containment mock's `{}` fall-through was an accidental successful malformed response.
Answering absence as 404 is the real server contract for a request without opt-in, and remains a
supported hook response with opt-in. This isolates the injected render exception without weakening
the existing throw counters, one-report assertions, article-survival checks or zero-spend controls.
Malformed-response handling is independently pinned by the hook suite.

With the seven hooks and that test file temporarily restored to their exact parent-commit bytes,
its **24 tests failed, 64 passed**. Twenty-three failed the one-report check; the Marginalia note
case failed its all-reports-belong-to-Marginalia check. All saw the incidental citations fault.
The builder's explanation was right; its count of 23 omitted that last case. Files were restored
in a `finally` block; no branch switch or Git state-changing operation was used.

Actual mutations, all restored:

- Null checks widened to truthiness in seven hooks: **42 failures** in the original 125-test hook suite.
- Post-body `current()` removed in seven hooks: original suite **125 passed**. Added delayed-body
  controls caught the same mutation with **14 failures**; the production guards needed no fix.
- Seven names removed from offline exclusion: **15 failures**.
- Inventory omission fixtures: **two red first**, then green; compensating-comment fixture:
  **one red first**, then green after per-entry call accounting.

[Mutation evidence](261006h-none-yet-rest-review-mutation-evidence.txt) includes complete inventory
red output and clearly labelled raw summary excerpts for the other experiments. The durable
negative fixtures and delayed-body tests are the reproductions retained in the tree.

## Validation

The exact four-file command in the request passed locally on the candidate: **363/363**.
The final three affected files passed **339/339** after the added tests and fixes. Final combined
four-file plus doc-link run passed **444/444** (427 across the four requested files, 17 doc-link
checks). [Raw test output](261006h-none-yet-rest-review-tests-output.txt). Targeted Biome lint passed
on all three edited test files.

`npm run typecheck` initially failed because the sandbox denies the `tsx` CLI's local IPC socket.
The same script via `node --import tsx scripts/typecheck.ts` passed, covering all **3325** source
files. [Raw typecheck output](261006h-none-yet-rest-review-typecheck-output.txt).

The Postgres route suite was not run here: no network or loopback is available. Its supplied
[seven-file output](261006h-none-yet-rest-gates-output.txt) records **469 tests, exit 0** on the
candidate. That evidence is the builder's run, not a claimed local run. No route or store code was
changed by the review.

VERDICT: land it with my fixes
