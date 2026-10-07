# A shared wait still belongs to one request

F1's loading-line review found three caller defects before the candidate was approved: Search's
press response was delayed, an Illustrated prerequisite lookup kept its immediate spinner, and
switching between unresolved plates inherited the earlier request's timer. No production incident
was established; these were reproduced in review. The findings and final verification live in
[the review](../plans/261007h-f1-code-review-sol.md) (E2–E4).

## The class: presentation reuse discards the request's meaning and identity

Moving loading markup into one component made the rendering consistent, but the component did not
know whether a request answered a press or an opening read, or whether a still-loading component
now represented a different request. The caller must retain both facts. A sentence can also combine
a known empty state with a separate pending prerequisite; its spinner does not make the entire
sentence a wait.

`cd1db5533` introduced Search's delayed first response and the plate timer reuse. The latter's
previous immediate spinner had no request timer to inherit. The prerequisite spinner predates F1:
`git log -S` and `git blame` identify `8d619a060`, which introduced Illustrated's `checking` branch.
F1 missed that branch when migrating the caller; it did not first introduce its immediate spinner.

## Why the existing checks agreed

Component tests mounted one wait and then removed it. That proves a fast request stays silent,
but says nothing about two requests sharing a component. Search's other acknowledgements and the
Illustrated empty-state sentence made the pages look responsive, while their distinct loading
contracts were wrong. Existing Illustrated tests checked settled prerequisite outcomes, not the
pending lookup's delay.

Three new caller tests ran against the unfixed candidate: **3 failed, 69 passed**. Search expected
“Reading the article for you…” before timers ran and received an empty string. Switching plates
expected an empty fresh wait and received “Fetching the picture…”. Checking Sketch readiness
expected no initial spinner and received a `LoaderCircle` SVG. The first caller-fix run made both
Illustrated cases green; Search still failed, independently exposing the shared zero-delay timer
defect (E5 in the review).

The shared component's no-timer regression also failed separately (**1 failed, 6 passed**);
the zero-delay override now draws synchronously. The final targeted run passed **418 tests**,
including all seven requested suites and the caller regressions. That result excludes the
blocked Chrome geometry test; E1 was unresolved at that first review.

## The fix that keeps the meaning

Search explicitly requests the immediate override. Illustrated keeps the known absence sentence
immediate without a spinner, and names the prerequisite lookup in a separate delayed wait. A plate
wait is keyed by the request's slug, hash and extension, so switching requests remounts its timer.
These are the long-term caller fixes: they express information already owned by the caller and
leave the shared loading component responsible only for presentation and timing.

**E1 remained unresolved at the first review.** Its `min-height: 1lh` includes
caller padding under the reader's `border-box` reset, so an empty padded wait can grow when words
arrive; wrapping is another source of growth. The Chrome geometry regression was written, but
Chrome startup was refused with `setsockopt: Operation not permitted` (`EPERM`). It did not reach
the layout assertions. The reviewer left the geometry CSS unchanged rather than claim a verified
fix. Caller tests establish timing and identity, not browser geometry; their green results do not
close E1. The orchestrator subsequently reserved the unseen sentence and spinner in `5fb8b4783`;
`337fee2ed` let that sentence shrink and wrap like the visible one. The round-2 review found no
remaining geometry defect for the existing plain-text callers; Chrome still could not launch in
the review sandbox, so it supplied no fresh height measurements.

## Round 2: a placeholder accepts more than its serialization preserves

`5fb8b4783` introduced `wordsOf`, which silently dropped React elements while `children` still
accepted `ReactNode`. An accepted fragment containing emphasis and a line break therefore reserved
no sentence before 600ms. Every existing caller passed plain words, and both the tests and the
serialization shared that narrower assumption. No affected production caller was found.

The long-term fix retains CSS content for plain words and renders formatted children inside the
same hidden, `aria-hidden` footprint. This preserves their actual markup rather than guessing its
geometry from flattened text. The new fragment/emphasis/line-break regression first failed with
missing emphasis (**1 failed, 8 passed**), then the component and four caller suites passed
**142 tests**. A formatted multiline fixture was added to the Chrome geometry test, but browser
startup still failed with `setsockopt: Operation not permitted` and SIGTRAP before measurement.

Countermeasures for this class, ranked: exercise a placeholder with a richer value allowed by its
public type (done); compare its input type with its serialization whenever extracting shared UI
(cheap); reject a separate markup-measurement system, which adds machinery when rendering the
existing hidden markup already preserves the footprint.

## Countermeasures, ranked by ease against value

1. **Caller tests with controlled time and two unresolved requests** — done. The new tests cover
   immediate press feedback, pending prerequisite lookup, and request replacement while still
   loading. Each was observed failing against the original behavior.
2. **Check request identity and origin when extracting asynchronous UI** — low cost; inspect the
   state transition and its trigger, rather than classifying a line by its words or spinner.
3. **A generic request registry or mode-wide loading controller** — rejected. It would duplicate
   ownership already present in the hooks and add machinery to communicate facts a key and an
   explicit override can preserve directly.

Up: [Postmortems](../project/postmortems.md).
