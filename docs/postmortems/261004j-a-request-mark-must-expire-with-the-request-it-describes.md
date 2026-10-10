# A request mark must expire with the request it describes

Up: [postmortems.md](../project/postmortems.md) · stage:
[261004h](../plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md)

Caught during review of `e8de3e851`, before this review's fixes. Two new regressions in
[use-citers.test.tsx](../../tests/use-citers.test.tsx) exposed independent gaps in the hook's
guards: an invalidated request could leave a permanent spinner, and a malformed row could pass
the response check and crash the band. The main reviewer observed both tests fail on the candidate;
this root-cause investigation read the code without running those tests. No production changes were
made in this investigation.

## The request mark outlived the request generation

[useCiters](../../src/web/useCiters.ts) marked an article as asked before starting its request.
[useOrderedRead](../../src/web/useOrderedRead.ts) separately invalidates a request whenever its read
callback changes, including when a different article does not want a new read. With A pending,
rendering B with `wanted=false` invalidated A but left A's asked mark intact. Returning to A skipped
the request, and the original response could no longer commit.

The regression expected two `/api/citers/one` requests and a settled `not-indexed` answer; the
candidate made one request and retained `waiting`. The existing tests exercised ordinary toggling
and article changes with immediate replies. Neither separated request admission from eventual
completion. Both guards were correct for their own purpose; their lifetimes disagreed.

This is a hook contract failure, rather than a currently reachable article-navigation failure:
[ArticlePage](../../src/web/article/ArticlePage.tsx) keys the article subtree by slug, and
[Reader](../../src/web/reader/Reader.tsx) keys the band by article and mode. Those remounts destroy
the old hook. They do not repair its explicit support for a changed slug, which the tests exercise.

The stage fix invalidates the asked mark on every slug transition, even when the
section is unwanted, while retaining it across toggles of the same article. A completed answer can
still be retained according to the hook's existing state policy; a discarded request must not count
as the answer a guard is protecting.

## A list check did not establish that its rows were drawable

The second class is **checking a collection's container while casting its unchecked elements**.
`asCitersResult` checked `Array.isArray(citers)` and cast the complete body to `CitersResult`.
[CitersList and CiterRow](../../src/web/ReceptionAndClaimsPanel.tsx) immediately read each row's id, author array
and display fields. A list containing `null` passed validation; the first row-key access would
throw. An object title and a missing author array were other unchecked rendering inputs.

The regression expected `unavailable` for a response containing `citers: [null]`; the candidate
returned `found`. Existing malformed-response controls checked an absent list and a string list,
but supplied no malformed element inside an otherwise valid envelope. The comment promising to
check as far as the panel reads described a stronger boundary than the code implemented.

The stage fix validates each field the row renderer consumes before admitting a
`found` response. Server-side normalization remains responsible for registry text and storage;
the browser boundary must establish that the response it actually received is drawable.

The main reviewer's initial targeted run reported **2 files, 6 failed, 42 passed**, including these
two hook failures and the stage's other regressions. After the fixes, its targeted run reported
**4 files, 106 passed**: `citation-index`, `use-citers`, `bibliographic` and `article-registry`.
These are reported runner results, not database-backed evidence.

## Siblings and limits

[useSourceGuess](../../src/web/useSourceGuess.ts) also records a slug before requesting, but does
not invalidate its pending reply through `useOrderedRead`; it does not reproduce this deadlock.
The raw-DOI URL constructors in [source-guess](../../src/source-guess.ts),
[paper-evidence](../../src/paper-evidence.ts) and [citations](../../src/bibliography.ts) share a separate
encoding defect found in this review. Those pre-existing sites are outside this stage and were
reported separately, without edits.

Both hook defects were introduced in `e8de3e851`, which added the module. The related lifetime
lesson is [longer lived results need a generation boundary](261004b-longer-lived-results-need-a-generation-boundary.md).

## Countermeasures, ranked by ease against value

1. **Control one deferred reply across a transition that performs no new request.** A cheap
   regression, added and observed red here. It checks that an admission mark and the request it
   describes expire together, rather than merely counting immediate requests.
2. **Put malformed elements inside a valid response envelope.** Cheap boundary regressions, added
   and observed red here, with a well-formed row as the positive control. Checking only malformed
   envelopes cannot establish safety for the element renderer.
3. **Review cooperating guards against their invalidation and consumption boundaries.** A small
   code-review cost: ask what invalidates the request, and enumerate what consumes the admitted
   value. The location of a guard is not evidence that it covers either boundary.
4. **Introduce a generic hook combining parsing, request admission and ordering.** Rejected:
   these answers and failure states differ between modes. The existing shared ordering mechanism
   and a local, complete response check are enough; combining their responsibilities would obscure
   the conditions each guard actually establishes.
