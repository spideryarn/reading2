# Main app architecture: a reader shell with explicit feature boundaries

Status as of 2026-09-05: reviewed proposal, not adopted or built; source audit, client build and
independent review complete. Source baseline: `fd370cfe050fc9ad0bdfd107668b857abaab5219`.

## Brief

> Can you see a better way to rearchitect the main app (e.g. for ease of maintenance, extensibility,
> app performance, reusability, simplicity, ease of adding/updating modes, reliability, UI especially
> on mobile, consistency etc)? Write up a detailed set of observations and suggestions in docs/plans
> (in enough detail that other agents could implement confidently & correctly). Then commit these
> changes and push.
>
> — Greg, 2026-09-05

Greg added a second direction during the audit: revisit previous agent decisions, give his product
choices more weight, and explore a text/voice command bar, with user-authored modes and a marketplace
as distant possibilities. The full quotation, decision provenance, and implementation proposal are
in the companion [Mode catalog and command bar](260905e-mode-catalog-and-command-bar.md).

The deliverable is a reviewed architecture assessment and a staged implementation proposal. It
preserves the reading intent in [vision.md](../project/vision.md), the stable
[block-id contract](../project/block-ids.md), and the single tree behind
[granularity zoom](../project/granularity-zoom.md). Implementation remains future work.

## Recommendation

Keep the application stack and the article model. Reorganise the client around a persistent session
shell, an article-access boundary, a stable reader surface, and explicit feature controllers. Add a
typed mode catalog for discovery and a separate action interface for the dock, command bar and future
voice input, as developed in the companion plan. Give
mode failures a smaller scope, concentrate mobile panel behaviour, and reduce expensive work at the
point that its inputs change. These changes can land separately and preserve the existing URLs,
API routes, data and reading experience before introducing new command-bar behaviour.

The problem is **coordination across unrelated responsibilities**, not simply long files. A new
mode currently reaches into the same component that decides who may read an article, saves reading
position, fits columns, composes annotations and dispatches conversations. Moving those reasons to
change behind narrow interfaces is worthwhile. A new framework, universal mode schema, central
store for every state value or replacement document renderer would add much more migration risk
than the evidence justifies today. Those are this review's engineering recommendations, not claims
that Greg has prohibited a different architecture. In particular, the command bar supplies a new
consumer that strengthens the case for a mode catalog.

Start with the confirmed cache-ordering gap, failure containment and extracting the existing boundaries. Then improve loading and
the common mode surface. Treat the deeper annotation and geometry work as measured optimisations.
Keep mobile interaction redesign as an explicit product experiment after the behaviour-preserving
work, so an architecture cleanup does not quietly decide how reading on a phone should work.

## Scope, evidence and existing work

**Inspected:** the entry graph from `src/web/main.tsx`; `App.tsx`, `TableView.tsx`, `Dock.tsx`;
representative mode controllers/panels; layout, viewport, scrolling, URL and annotation helpers;
article access, authenticated/public transport, offline storage, job/upload lifetimes; shared mode,
article and store contracts; relevant tests, Vite configuration, project docs and earlier plans.
Three parallel audits covered modes, mobile/rendering and data/lifetimes; GPT Sol supplied early
design input on the last area. Findings below name the defining files and symbols, not historical
line numbers that will move during extraction.

**Excluded:** an exhaustive pipeline, billing, security or database audit; production data and
logs; dependency benchmarking; real-device browser testing. No runtime failure or device speed
improvement is inferred from a grep. Evidence states are **measured** (a command was run),
**proved from source** (a concrete dependency/branch exists) and **hypothesis** (needs a scenario
or measurement). A source-proved extra loop is not a measured responsiveness problem.

This is downstream of several recent pieces of work, not a replacement backlog:

| Existing work | What this proposal preserves or takes forward |
|---|---|
| [Adding a mode](260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md) | Total mode tables, shared request ordering and `.band-head` already landed. Passage lifecycle and larger reader composition were left open. Its blanket registry rejection is reconsidered here; its specific counterexamples still need answering. |
| [More scroll CPU wins](260904a-more-scroll-cpu-wins.md) and [performance](../project/performance.md) | `TableView`/`Spine` memoisation and stable `{ __html }` objects already exist. This plan does not count them as future wins. |
| [Public access audit](260902j-public-read-only-access-audit-and-improvements.md) and [more shared modes](260904c-more-modes-on-a-shared-link.md) | Keep owner/visitor component boundaries, projected public data and read-only comments/searches. |
| [Offline reading](260827r-offline-reading.md) | Keep browser response caching above the API. It does not justify changing Drizzle or exposing Postgres to the browser. |
| [One storage implementation](260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) | Current `src/store/index.ts` wires Postgres unconditionally. `src/api.ts` still contains filesystem code; its presence is not proof the app serves through it. |
| [Remembering the last view](260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md) | Preserve the distinction between restoring an address on entry and URL state while reading. |
| [September 5 codebase sweep](260905b-improve-the-codebase-third-sweep.md) | Reuse its backlog and prevention findings rather than declaring the same work newly discovered. |

### Dated baseline

Commands run on the Mac on 2026-09-05 against the source baseline above. Line counts include
comments and are navigation aids, not complexity scores:

```sh
wc -l src/web/{App,TableView,Dock,OutlinePanel,ChatPanel,Library}.tsx \
  src/web/{styles,tailwind}.css
npm run build:client
rg -n 'componentDidCatch|getDerivedStateFromError' src/web
rg -n 'useVisualViewport' src/web
```

| File | Lines |
|---|---:|
| `App.tsx` | 5,951 |
| `TableView.tsx` | 1,330 |
| `Dock.tsx` | 1,945 |
| `OutlinePanel.tsx` | 413 |
| `ChatPanel.tsx` | 2,138 |
| `Library.tsx` | 900 |
| `styles.css` | 15,007 |
| `tailwind.css` | 349 |

The successful production client build transformed **2,682 modules**. Its principal assets were:

| Asset | Minified/output size | Gzip |
|---|---:|---:|
| `main-*.js` | 1,471.79 kB | 443.84 kB |
| secondary `index-*.js` | 20.69 kB | 8.12 kB |
| `main-*.css` | 217.45 kB | 37.11 kB |

Vite also reported an ineffective dynamic import of `src/web/lib/supabase.ts`: eager imports
elsewhere keep it in the initial graph. This is evidence that one dynamic import does not establish
a loading boundary. These are output sizes, not a network trace: they do not establish actual
transfer size, cache hits, parse time, LCP or mobile interaction latency. Do not sum emitted images
or font variants and call the result the first-page download.

## Observations and proposed changes

### A0. Cache freshness currently follows completion order, not request order

**Proved from source; not yet reproduced with a real request interleaving.**
[`lib/api.ts`](../../src/web/lib/api.ts) § `saving` clones a successful GET and passes the parsed
body to [`offline-store.ts`](../../src/web/lib/offline-store.ts) § `writeCached`. The latter
assigns `Date.now()` only when that write begins, then uses `savedAt` to reject an older write.
An old GET that completes last receives the later timestamp and wins. The timestamp is useful as
save time; it cannot prove response freshness.

Concrete sequence: OLD GET starts; NEW GET starts; NEW returns and is cached; OLD returns and
overwrites it; the next offline read serves OLD. A related sequence is a GET started before a
successful PATCH/DELETE, completing after cache invalidation and putting the pre-mutation data back.
`useOrderedRead` protects a mounted hook's state, not every cached response across independent
callers. Class: **completion time used as causal freshness**, plus unfenced invalidation.

Make this the first implementation investigation, before optional structure work. Write deferred
fetch tests using real `apiFetch` and fake IndexedDB, observing the eventual cache rather than
asserting immediately after the fire-and-forget save. Keep the existing valid account partition.

Proposed fix contract: every cacheable read carries an issue-order ticket; a successful relevant
mutation invalidates both cached bodies and outstanding pre-mutation tickets. A response may be
stored only if its ticket is still eligible at the **atomic cache commit**, not just at JSON parse.
Keep `savedAt` for display/LRU; never reuse it as the causal version. Compare the response ticket
against the **last successfully committed ticket**, not the latest issued ticket. A later failed
request must not prevent an earlier successful response from filling an empty cache.

Specify cross-tab behaviour before choosing the mechanism, because IndexedDB is shared by tabs.
The strongest modest option is to reserve monotonic per-owner/URL issue sequences and an owner mutation
epoch in IndexedDB. Each ticket captures both. Store the last committed sequence separately; in one
readwrite transaction, accept a response only if its epoch is current and its sequence is newer
than that committed sequence, then update body and committed sequence together. This allows an
older successful response to commit while a newer one is pending, but never to replace a newer
successful commit. No list of outstanding response bodies or ticket-retirement scheduler is needed.
An owner-wide mutation epoch is simpler than a new dependency graph and conservatively discards some
unrelated in-flight cache writes; existing resource-specific body invalidation remains. Ticket
reservation must complete before the corresponding **cache-eligible** network request is issued.
Give reservation a short bounded deadline; if unavailable, blocked or timed out, start the network
read and irrevocably skip caching that request. A late reservation result must not restore its
eligibility. Keep reading usable even if IndexedDB is locked. Retain invalidation/version metadata
while older tickets may still return; deleting or reusing it recreates the race. Monotonic sequences
must not reset merely because a body is evicted. Specify upgrade and bounded metadata retention
without reusing a retired key generation; these are browser-cache records, not a server migration.

**Cover every cache writer, not just network saves.** `readCached` currently schedules a `put` of
the whole previously read row to touch `lastOpened`. That stale copy can overwrite a newly saved
body. `evict` chooses victims from a snapshot and deletes later; it can delete fresh replacements.
Class: **stale read-modify-write outside a transaction**. A metadata touch must read the current
row and update only its metadata inside one transaction; it must never put a copied old body or
recreate a deleted row. Keep article-wide eviction: select/revalidate the article's current rows,
versions and recency and delete the whole selected article in the same readwrite transaction.
Do not validate/delete one row at a time and leave a partially evicted article. Successful mutation
invalidation and its epoch advance must be atomic with each other. The cache commit, touch,
invalidation, eviction and account teardown operations all participate in this protocol.

**Account teardown is also a writer.** `forgetUser(owner)` must atomically advance and retain the
owner epoch and delete that owner's cached bodies. No ticket reserved before that retirement may
commit afterward, including after the same owner signs back in. Deleting the bodies without
retaining the epoch lets a delayed private response recreate them after sign-out. Test a paused A
response after reservation → completed sign-out/`forgetUser(A)` → release response: no A body is
recreated, and B's rows are untouched. Repeat through A signing back in, with a new eligible request
that may cache normally. Preserve the current distinction between an actual teardown and a direct
A → B identity change that retains separately partitioned copies; this fix fences any teardown
that runs, not a new product policy to purge every account switch. Test direct switching separately
for correct partitioning. Source: `offline-store.ts` § `forgetUser` and `api.ts`'s auth callback.

This is a proposal for client request ordering, not proof that the latest-issued request observed
the latest server revision. If this bookkeeping is too much for the measured problem, a tab-local
generation fence is a smaller first slice, but must be labelled as leaving cross-tab ordering open.
No production data change is involved. Test reverse completion; empty-cache T1-success/T2-failure
in either completion order; mutation during body parsing; delayed LRU touch versus save/delete;
eviction versus a newly saved/touched article; account changes; concurrent tabs; metadata failure/
timeout; and a post-mutation fresh read. An older ticket cannot overwrite a newer successful body,
and a failed newer request cannot remove the only successful copy.

### A1. Extract responsibilities that already have distinct lifetimes

**Proved from source; high maintenance value.** [`App.tsx`](../../src/web/App.tsx) contains `App`,
`SignedIn`, `resolveAccess`, `useArticleAccess`, `ArticlePage`, `OwnedArticle`, `OwnedReader`,
`VisitorArticle`, `Reader`, position/measurement hooks and feature-specific bands. These are
different reasons to edit the same module. `Reader` contains both shared reading machinery and
Ideas/Timeline/Quotes/Glossary/Search/Referee selection policy, with feature controllers later in
the same file.

Extract along those existing seams first. Proposed paths are destination suggestions, **not files
that exist today**:

| Destination | Responsibility | Must not absorb |
|---|---|---|
| `src/web/App.tsx` | Session subscription, persistent services, route choice | Feature selection, block annotation or article parsing |
| `src/web/article/ArticlePage.tsx` | Existing access resolution and three article views | Mode rendering or a replacement HTTP client |
| `src/web/reader/Reader.tsx` | Compose prose, spine, controls, active mode and reader overlays | Per-mode sorting, filtering, generated-data parsing |
| `src/web/reader/useReadingPosition.ts` | Existing restore/spy coordination using `position.ts` and `scroll.ts` | A second canonical reading-position store |
| `src/web/modes/<feature>/<Feature>Mode.tsx` | Owner/visitor controllers, feature URL selection and panel composition | Owning global jobs or reaching another mode's internals |
| Existing `*Panel.tsx` | Feature presentation, moved alongside its controller when useful | Generic plugin metadata or transport policy |

Start with Ideas and Timeline because they expose the passage seam; use Chat as the later test that
the design does not depend on all modes being lists. Imports flow from composition to features to
small shared reader helpers. Feature modules must not import `App.tsx` or each other. Keep shared
pure types in their existing homes unless the extraction actually requires a new one.

**Simpler option:** move functions without changing interfaces. That is the first implementation
stage. It will improve discoverability but not, by itself, reduce renders or coordination. Do not
hide sixteen unrelated values in a `readerContext` object and claim the interface became smaller.
Keep explicit props; extract a shared interface only when the values form a coherent contract with
multiple real consumers. No whole-app context whose value changes for every keystroke or scroll.

### A2. A mode failure should leave the article readable

**Proved from source; failure scope is established, frequency is unknown.**
[`main.tsx`](../../src/web/main.tsx) wraps `<App />` in the one
[`AppBoundary`](../../src/web/AppBoundary.tsx). Its fallback replaces the children. A render
exception in a mode therefore loses the prose and navigation along with that mode. This is a
consequence of the boundary placement, not evidence of a current mode throwing in production.

Add a reader-owned feature boundary around the **controller and its panel**, not only around the
last JSX element. Mode-only computations left in `Reader` would otherwise still escape it. Keep
the root boundary as a last resort. The local fallback should name the feature, offer a working
return to Plain and an explicit retry, preserve `?at=` and the article, and use the existing
sanitised reporting and failure-copy conventions. Do not expose exception messages or article text.

Reset the feature boundary on article identity, access identity and active mode/sub-mode changes,
or an explicit retry generation. Do not reset it on scrolling, typing or every URL edit. A failed
retry must settle back to an actionable fallback rather than loop. A boundary catches rendering
failures; request, event-handler and stream errors still need the existing feature state paths.

The lowest-risk first slice is an extracted Ideas controller behind this boundary, then a throwing
Diagram fixture and a stateful conversation. Unmounting a failed controller must follow its current
operation cleanup policy; it must not restart a paid job or stop the tab-level upload service.

Containment also needs an **activation retirement seam**. `Dock` arms a token before changing mode;
`useAutoRun` claims it in an effect. If the initial controller render throws, that effect never
runs and an ownerless token can survive until a later Back/retry mount. Capture the exact pending
activation identity at the reader/boundary seam before rendering the target controller, and retire
that `(sessionEpoch, slug, target, nonce)` when its render fails. Add a compare-and-retire operation
to `activation.ts`; it must not erase a newer press or another target's token. Do not mutate the
activation store during render or rely on a failed child's effects. Boundary retry grants no new
spend intent, whether the old token was unclaimed or already claimed. Test Dock press → initial
render throw → Plain → Back/retry: zero job POSTs until a fresh explicit activation. Also test a
newer press arriving before failure handling and StrictMode, with exactly-once normal activation.

### A3. Make mode dispatch complete, and share only passage publication mechanics

**Proved from source; continuation of earlier work.** `Reader` currently keeps five `Found[]`
states, several open keys, and separate `passages`/`openPassage` selection chains. The comments
explain why: outgoing passive cleanup must not erase incoming layout-effect publication. This is a
real ownership requirement, not five states that can safely become one unqualified `setFound`.

Use an exhaustive `switch` at the composition point after extracting controllers. `plain` and
`hierarchy` explicitly render no band; they are not a default that silently accepts a new mode.
Require `never` exhaustiveness and preserve the coverage of the existing total tables in `modes.ts`,
`title-text.ts`, `visitor.ts`, `Dock.tsx` and activation policy. The companion plan deliberately
reopens how their discovery metadata is collected: migrate true duplicates into a mode catalog,
retain exhaustive per-layer adapters for distinct policies. A renderer table is also viable once
controllers have stable interfaces; the switch is the cheaper extraction step, not a permanent ban.

For passage publication, take the modest improvement first: keep separate producer slots and
extract only publish/clear/invalid-selection cleanup. In one total selection function, return
`{ found, openKey }` together; all prose, spine and gutter projections read that same answer.
It should explicitly return the empty constant for modes with no active passage producer, rather
than inheriting Search's state through a fall-through.

[`search-hits.ts`](../../src/web/search-hits.ts) § `Found` remains the shared currency. Ideas and
Timeline may automatically open/jump in cases where Search and Criteria deliberately do not;
Quotes and Claims have no open key. Do not move those editorial decisions into a generic hook.
The narrow lifecycle helper needs a keyed/unkeyed discriminated input and stable cleanup callbacks.

A **single** reader-scoped publication slot is an optional later simplification, not this first
stage. If pursued, give each mounted producer an opaque owner token scoped to article/access and
mode/sub-mode. `publish(token, snapshot)` and `clear(token)` accept only the active owner. A late
publication and an outgoing cleanup both become no-ops. No writes during render, no module-global
slot shared between readers, no reliance on effect ordering, and no reuse of paid-activation tokens
for this different lifetime. It earns adoption only if it deletes more machinery than it adds.

**Acceptance:** switch Ideas → Timeline → Search with pending work, change Referee sub-modes, go
through Plain, then Back. Assert the visible passage marks, selected ring and spine agree at each
commit, including the transition before passive cleanup. Repeat under StrictMode and A → B → A
article changes. Extend [`passage-mode-cleanup.test.tsx`](../../tests/passage-mode-cleanup.test.tsx)
and the actual mode wiring tests; a unit test of a reducer alone cannot catch wrong wiring.

### A4. Introduce loading boundaries where they preserve the offline contract

**Measured bundle size; source-proved eager graph; benefit size is a hypothesis.** `App.tsx`
statically imports pages and mode panels. For example, `DiagramPanel` reaches the diagram
implementations, while admin/design/profile code is reachable even on a simple reading route.
File moves alone do not change this graph.

First lazy-load secondary routes that are outside the supported offline reading path, starting with
Admin and Design. Use existing React lazy/Suspense mechanisms and a route fallback. Keep session
services mounted above the fallback. Verify the emitted graph and the actual requested chunks:
moving an import while another eager import remains is exactly what the build warning demonstrates.

The reader, shelf and mode-code question is more constrained. Cached JSON cannot make an unloaded
JavaScript chunk execute. Today [`offline-remount.test.tsx`](../../tests/offline-remount.test.tsx)
protects opening cached mode data after a remount, and the in-tab shelf/article path is part of the
offline intent. **Keep that code eager in the first tranche.** Do not claim a loading improvement by
breaking first activation offline or navigation to an article cached earlier in the tab.

Optional later mode splitting needs its own measured tradeoff: background-import the code required
for the existing offline contract after prose settles, or get an explicit product decision about
which modes are ready offline. Background imports must not mount controllers, fetch private data,
call generation endpoints or mint/consume an activation. They improve scheduling of initial work;
they may not reduce total bytes. Do not add a service worker or PWA migration as an incidental fix.

Retain small loading/error surfaces with an escape to reading, and test a rejected chunk import.
A retry must not reissue a model call. Avoid vendor/manual chunk configuration until import
boundaries work and the build graph shows a remaining reason for it.

### A5. Give the active mode a common surface with a real mobile responsibility

**Proved from source; device impact is a hypothesis.** `.band-head` already removes header styling
duplication. The old proposal for a `<Band>` wrapping identical chrome offered little deletion.
There is now a more substantial seam to consider: the active surface's viewport fit, scroll area,
footer/composer placement, local error/loading state and route back to prose.

[`useVisualViewport.ts`](../../src/web/useVisualViewport.ts) already exposes visible height,
offset and keyboard inset. Comment, Chat, Annotate and Feedback dialogs use it. Mode bands such as
`ChatPanel` use the `.mode-band` fixed top/bottom rules without that hook. That difference is
source evidence of two fit mechanisms, **not proof the composer is hidden on a particular phone**.
Reproduce on iOS with the keyboard before claiming a mobile defect or choosing its arithmetic.

Proposed `ModeSurface` owns only the container: accessible label, header/content/footer slots,
visible-viewport constraint, one designated body scroller and optional composer. It knows nothing
about jobs, `Found`, HTTP statuses, filters or model output. Place the feature boundary outside the
controller; a surface inside its output cannot catch a controller failure. Reuse `.band-head` and
the established z-index ladder. Pilot with Search and Chat, which have different footer needs.

Keep `fitView` as the horizontal authority. `band-covers` already derives from `fit.modeW`; the old
JavaScript/CSS crossover disagreement is fixed. A future explicit
`{ kind: "none" } | { kind: "beside"; width: number } | { kind: "cover" }` presentation result
can clarify the zero-width sentinel, but it is a type cleanup, not a newly found breakpoint bug.
CSS consumes the decision; it must not recompute a competing breakpoint.

For vertical fit, measure the visible viewport and actual occluding bars. Do not add keyboard
inset twice to a surface already bounded by visual-viewport height. Preserve a CSS fallback without
`visualViewport`, account for its `offsetTop`, clamp negative insets, and unsubscribe when inactive.
Header and footer remain reachable at enlarged text sizes. One mode body owns its vertical scroll;
a diagram canvas may own pan/zoom deliberately, not accidentally inherit a list's wheel rules.

**Product experiment, separate from refactoring:** compare the current covering band with a compact
mode switch and a collapsible panel that exposes the cited prose. Test a result → cited paragraph
→ same result round trip, with list position and draft preserved. A bottom sheet, automatic close
on citation, hiding the spine by default, or moving all controls into a menu changes the product;
none is decided here. Preserve the current default Plain and the granularity/outline options until
that comparison is approved. An implementation agent should request the decision only when it has
a concrete prototype and evidence to review.

### A6. Model modal and modeless surfaces as different interaction families

**Proved from source; keyboard impact needs a browser check.** `Dock.tsx` § `Drawer` declares
`role="dialog" aria-modal="true"` and installs Escape handling, but its file contains no matching
focus containment/restoration or inert-background management. Meanwhile Lightbox/Feedback and the
modeless reading dialogs have different intended behaviour. A common-looking panel is not
necessarily a common interaction contract.

First determine whether the Dock drawer is supposed to permit interaction with the dock and prose.
If yes, its modal declaration must change and its labelled close/focus-return behaviour must be
tested. If no, implement actual modal focus/background behaviour, retaining access to all intended
drawer controls. Treat that as a concrete accessibility correction with a red interaction test,
not an opportunity to convert every reading overlay to a modal.

Prefer two small existing-pattern families: a true modal using the established native-dialog
approach where applicable, and a modeless reader popover that permits selecting article text.
Share Escape/focus-return mechanics only where the interaction is the same. Keep block-id anchors,
selection capture before focus moves, click-away/touch ordering and tooltip top-layer placement.
Audit nested Lightbox/help/menu behaviour. Define which one consumes Escape so it closes the
topmost intended surface once. Do not add a global overlay manager unless actual overlap tests
show local ownership cannot express the requirement.

### A7. Reduce annotation computation before changing the document renderer

**Proved loops; unmeasured latency.** [`TableView.tsx`](../../src/web/TableView.tsx) § `marksByBlock`
depends on `openComment` and `openChat` and resolves stored anchors again when either changes.
`proseHtml` loops over the blocks when mark inputs change. Its existing `proseCache` preserves
`{ __html }` identity for unchanged output, which prevents DOM replacement; it does not avoid
computing that output first. This distinction is the optimisation opportunity.

Separate stable anchor resolution from transient selection. Cache rendered block text from the
sanitised block HTML; resolve comment/chat anchors against that text only when the HTML or anchor
changes. A changed block with the same ID invalidates the cached result: stable identity is not
immutable content. Do not key this work on the streamed answer body if the anchor stayed the same.
Apply open-state decoration after resolution, touching the previous and next selected blocks.

Then, if profiles justify it, keep per-block annotation inputs and reuse the existing output object
when those inputs are unchanged. Inputs include sanitised HTML, resolved comments/chats, glossary
occurrences, passage marks, selected flags and figure-handle policy. Keep ordering and overlapping
mark semantics from [`annotate.ts`](../../src/web/annotate.ts). Rebuild and evict on article/content
changes; an unbounded module-global cache keyed only by BlockId is wrong. Begin with plain typed
maps owned by the reader/renderer, not an observable store for each paragraph.

**Acceptance:** instrument `renderedText`, `resolveMark`, `annotateHtml` and DOM child-list changes
on fixed fixture articles. Selecting a different comment should resolve no unchanged anchors.
Unchanged paragraphs retain DOM nodes, text selection and working term/note/image handlers. A new
comment, changed HTML, overlapping search result, note-return marker and changed glossary entry
must still update the relevant block. A zero-work result is invalid unless a changed-input control
also proves that the instrument and update path run.

Do not virtualise prose or replace the HTML table in this stage. `rowSpan`, native text selection,
find-in-page, stable anchors, accessibility, note navigation and measured scroll geometry all depend
on the current document. Virtualising an independent, very long result list is a separate lower-risk
option only after measuring that list; it still must retain focus and selected-result navigation.

### A8. Share measured geometry without forcing all navigation to mean the same thing

**Proved multiple consumers; savings are a hypothesis.** Reading-position tracking,
[`useColumnContext.ts`](../../src/web/useColumnContext.ts), the spine and scroll helpers observe
related row/bar geometry. They do not all ask the same question: the URL tracks section position,
the fisheye tracks its focus line, and explicit navigation owns a glide target.

**Source refresh during this audit:** the long-article work in
[260905d](260905d-mode-switching-is-sluggish-on-a-very-long-article.md) has already introduced
[`rows.ts`](../../src/web/rows.ts) § `rowsForBlockIds` and
[`fonts.ts`](../../src/web/fonts.ts) § `onFontsChanged`. Reuse those helpers; repeated selector
lookup and the font subscription are not still wholly unsolved. This recommendation concerns
remaining measured geometry reads after that work, not rebuilding its fixes.

After profiling shows repeated layout reads are material, introduce a reader-scoped, read-only
geometry snapshot at the existing measurement seam. One scheduled read per frame/invalidated
layout can serve row tops, visible viewport bounds and actual bar occlusion. Keep consumers' pure
selection functions separate, and notify only when their selected result changes. Do not publish
the entire scrolling snapshot through `Reader` state and invalidate the whole tree on every frame.

Invalidate on article/column/spine/layout changes, root-font changes, image load/resize, resize of
the measured content, viewport movement and relevant bar transitions. Batch DOM reads before
writes. Preserve fresh on-demand measurements for an explicit jump until cached measurements have
proved equivalent; a stale fast answer is the wrong optimisation for navigation. Observing only
the article's total height is insufficient: rows can redistribute while that height stays equal.
Use explicit layout invalidation for app-owned changes and fresh jump measurements as the fallback.

Tests must retain `position.ts`'s fine-grained `?at=` preservation inside a section, suppression
during a programmatic glide, interruption by a real gesture, and link/history semantics. Count
layout reads and listener/subscriber teardown, not only resulting block IDs. Start with two
consumers; if the subscription machinery outweighs a small duplicated measurement, stop there.

### A9. Keep state ownership and network policy explicit

**Proved existing safeguards; consolidation opportunity.** The app already has useful lifetime
separation. Preserve it when extracting the shell:

| State/service | Authority and lifetime | How a mode consumes it |
|---|---|---|
| Authentication and session epoch | Session, above routes | Explicit access identity; no account-private snapshot reused for another reader |
| Job/upload engines | Tab service, bound to reader identity | Existing `useJobs`/`useUpload` subscriptions; page changes do not own their work |
| Article access and payload | Slug + reader identity, shared across article/metadata/tweets | Existing `ArticleAccess` union; synchronous stale-answer fence |
| Reading/view selection | URL via router/nuqs | Existing parsers and history policy; no mirrored canonical store |
| Last-view restore | Owner/slug entry policy in `last-view.ts` | Resolve address once; it does not supersede an explicit URL |
| Generated artefact read | Feature controller with current article inputs | `useOrderedRead` plus feature-specific parsing/status/freshness |
| Paid activation | Explicit press, session/slug/target/mount ownership | Existing `activation.ts` and `useAutoRun`; arrival/prefetch/retry is not permission to spend |
| Draft, hover and transient selection | Feature/overlay lifetime | Local state with an explicit save/clear policy |
| Offline response copies | Account-scoped browser storage | Existing `apiFetch` fallback, invalidation and copy indicator |

Keep [`useOrderedRead`](../../src/web/useOrderedRead.ts)'s distinction: ordinary reload may join an
in-flight read; post-write refresh must trail it. A query-cache replacement that merely deduplicates
would reintroduce the same-slug stale-response race. Keep feature differences: Arc can treat stale
as absent, Sketch validates a scene, and missing/failed/outdated/profile-changed are not one state.

Keep private `apiFetch` and token-free [`public-api.ts`](../../src/web/public-api.ts) distinct.
`resolveAccess`'s 401/public-200 and 401/public-404 outcomes are different. Visitor controllers take
public projected data without owner verbs, not an owner hook with an `enabled: false` convention.
No generic resource layer may cache an authentication/HTTP error as an offline success, serve one
account's copy to another, or retry mutations as though they were idempotent GETs.

For conversational operations, retain their existing stop/persist/reconcile semantics and
server-side attempt fences. A stream ending without its required terminal event is not successful
completion. Do not move all streams into a tab engine just because jobs/uploads belong there:
whether changing mode leaves a conversation running is a feature contract, to be preserved and
tested before changing its owner.

No new Redux/Zustand/query framework, direct browser SQL access or offline write queue is proposed.
Those can be reconsidered if a measured, repeated problem survives the smaller boundaries above.

There is also a concrete unfinished reliability consolidation:
[`classifyEnd`](../../src/ai-call.ts) already defines provider stream outcomes, but the accepted
[stream-end plan](260901g-one-stream-end-classification-shared-by-five-callers.md) still has Referee
Claims/Criteria/Mirror and `converse` callers to migrate. Source inspection confirmed the remaining
local classification in `referee-claims-run.ts`, `referee-criteria-run.ts`, `referee-mirror.ts` and
`converse.ts`. Complete that existing work before adding a natural-language command interpreter's
new stream. Classify each provider round and fold all rounds of a conversation; the last round's
finish reason must not erase an earlier truncation. Preserve feature-specific stop/persist policy.

**Done, 2026-09-05.** All four migrated, in
[260901g](260901g-one-stream-end-classification-shared-by-five-callers.md) § Stages D, E and F.
Both requirements above are met and tested: `converse` classifies once per round and folds, so a
`length` on round two no longer vanishes when round three ends cleanly; every caller kept its own
stop/persist policy, each now a written `case` with a comment rather than an absence. The one
behaviour change is that `finish_reason: "error"` throws in all four, as it already did for the same
event arriving as `chunk.error` data.

### A10. Organise styles and extension checks around ownership

**Proved shared stylesheet and edit surface; maintainability judgement.** The semantic CSS model
is appropriate for table geometry and reading typography. The problem is finding which rules own
a feature in a 15,007-line file, not the existence of both CSS and Tailwind.

Make `styles.css` an ordered composition of smaller semantic sheets: reader geometry/typography,
shared mode surfaces, dock/overlays, feature sections and site/shelf chrome. Extract contiguous
sections preserving cascade order first; do not simultaneously redesign selectors or group every
rule with the same prefix. Later overrides may depend on intervening rules. Keep one documented
import order under `tailwind.css`'s `app` layer, the `tw` prefix, source-scanning guards, token
bridge and intentional absence of Preflight. Do not import a feature stylesheet unlayered from
its component. Global geometry tokens and stacking rules retain one home.

Use the existing `/design` page to show real shared surfaces in loading, missing, stale, error,
running and success states, including long labels and larger text. Reuse `JobProgress` and
`.band-head`; feature-specific filtering/scoring, chronology and provenance remain distinct.

Improve the **extension contract**, not just the documentation: new modes should fail compilation
at their presentation, visitor policy, label and activation decisions. The active-mode test should
render each real controller through the shell and check its expected surface or deliberate absence.
Keep independently written expected behaviour; deriving both implementation and expectation from
one new table creates a test that agrees with an omission.

Preserve existing tests that import bands directly or inspect `App.tsx` source by updating their
targets in the same extraction. For a boundary rule, prefer resolved imports/behaviour over a
regex tied to one filename, but do not weaken the assertion simply to make a move pass. Run the
repo-wide rename/import sweep required by [rename-or-move](../reusable/rename-or-move.md).

## Priority and tradeoffs

Effort estimates are relative engineering scope including review and integration, not calendar
promises. S = one bounded change; M = a few coherent commits; L = its own project with profiling
and a migration pilot. Risk is regression risk while implementing, not finding severity.

| Order | Work | Value | Effort | Risk | Stop condition |
|---|---|---|---|---|---|
| ~~First~~ **done** | A0 cache-ordering reproduction and fence — [260905g](260905g-cache-freshness-follows-issue-order-not-completion-order.md), 2026-09-05 | Confirmed reliability gap | M | Medium | Met: reverse completion and pre-mutation responses can no longer restore stale cached data |
| Next | A2 local failure containment, with A1's smallest controller extraction | High reliability and a safe seam | S–M | Medium | A broken mode leaves readable prose and a working escape |
| Next | A1 article/reader/feature files; A3 exhaustive dispatch | High maintenance/extensibility | M | Medium | New mode integration no longer requires editing access or position logic |
| Next | A4 secondary-route lazy loading | Measured bundle opportunity | S–M | Low–medium | Measured initial graph shrinks; offline reader path remains intact |
| After controller seams | [Mode catalog and command actions](260905e-mode-catalog-and-command-bar.md) | High extensibility and requested command UX | M, then staged L | Medium | Dock and command bar share validated actions and accurate availability |
| Next | A5 mode surface; A6 overlay semantics | High mobile/consistency potential | M | Medium | Keyboard, focus, close and scroll checks pass in two unlike modes |
| Alongside isolated stages | A10 ordered CSS extraction and extension checks | Medium maintenance | M | Medium | Ownership clearer, cascade/geometry unchanged |
| Profile first | A7 per-block annotation inputs | Potentially high interaction performance | M | Medium | Measured work drops without stale annotations or lost selection |
| Profile first, later | A8 shared geometry | Unknown until duplicate reads measured | M–L | High | Equivalent navigation with fewer layout reads |
| Product experiment | Mobile mode navigation/presentation | Potentially high usability | M | Product decision | A tested layout choice, separately authorised for implementation |

Do not undertake all rows as one rearchitecture. Cache reliability and controller isolation give a useful result
even if every optimisation is deferred. If the Dock keyboard audit establishes a reachable defect,
its small correction goes into the first stage; a confirmed defect outranks an attractive cleanup.

## Implementation stages and handoff

All boxes below are **future work**, not tasks implicitly authorised by the request to write this
proposal. Each stage starts in a worktree, gets a GPT Sol plan/code review, updates its owning
project docs, runs the required gates and commits/pushes to `dev`. No production schema, data or
API migration is needed for the recommended first stages. Do not rename URLs or mode IDs.

### Stage: Close the cache-ordering gap

**Done, 2026-09-05**, in [260905g](260905g-cache-freshness-follows-issue-order-not-completion-order.md).
Greg scoped that run to A0 alone; every stage below remains a proposal. Two things this section got
wrong are worth carrying forward. The mechanism it sketched was right and the cheaper substitute was
not — see that plan for why ordering by a stamped issue time restores deleted data. And it did not
foresee that **bumping `DB_VERSION` at all** can hang the offline read behind a tab still running the
old code, nor that bounding the database *open* bounds nothing else, since a transaction can wait
indefinitely behind a locked one in another tab. Both were found by GPT Sol with a real harness, and
both would apply to any future schema change here.

- [ ] Reproduce A0's two deferred-response sequences against the current cache seam. Check the
  introducing history and write the required bug-class postmortem before implementing the fix.
- [ ] Choose and document the ticket scope; implement atomic eligibility and invalidation with a
  bounded, migration-safe metadata lifecycle. Keep offline copies readable if metadata admission
  fails or times out, while refusing to write an unfenced new response. Compare against the last
  committed successful sequence, not the last issued one; include LRU touches and whole-article
  eviction in the transactional protocol.
- [ ] Run the cross-tab/account and invalidation acceptance cases from A0. Use old/new bodies with
  distinct values and wait for background saves; a future timestamp fixture is not the race.
- [ ] Include actual sign-out teardown: complete `forgetUser(A)` before releasing A's paused
  response; it must not recreate any A body or disturb B's rows. Old tickets remain retired after
  A signs back in; newly reserved reads can save normally. Keep direct-switch partitioning policy.
- [ ] Update the existing offline plan's implemented-state record and current owning doc signposts.
  Review and land independently; no reader refactor is needed to fix this seam.

### Stage: Establish the behavioural baseline and contain one mode failure

- [x] Refresh this source snapshot and check which earlier work has since landed. Record a scoped
  manifest, source SHA and relevant test names; do not reuse this audit's counts as current facts.
- [x] Run existing access, public-network, mode-entry, passage and offline-remount tests before
  extraction. Capture the real request trace of Plain, Ideas and Chat on one fixture article.
- [x] Extract Ideas' existing owner/visitor controller without changing its props, sorting or
  lifecycle. Leave a deliberate import compatibility shim only while named tests are moved.
- [x] Write a failing shell-level test that throws inside that controller: prose and navigation
  should survive, and choosing Plain should work. Add the local feature boundary and pass it.
- [x] Test explicit retry and an article/account change; neither should leave a stuck fallback or
  cause an automatic paid request. Extend the throw to mode-only computation, not only its panel.
- [x] Add exact-token retirement for a failed initial render before `useAutoRun` claims its press.
  Test throw → Plain → Back/retry and a racing newer press, without effects in the failed child.
- [x] Audit the Dock's real focus contract; if a defect is established, reproduce it first and
  apply the smallest semantic/focus correction described in A6.
- [x] Update [web-client](../project/web-client.md), [copy](../project/copy.md) and the relevant
  mode doc. Acceptance: one independently failing feature, still a usable reader.

### Stage: Separate article access, reader composition and mode controllers

- [ ] Move `ArticleAccess`/`resolveAccess`/`useArticleAccess`/article-view composition as one unit,
  preserving identity fences and the shared article fetch across reading/metadata/tweets.
- [ ] Move `Reader` and its position hook, leaving `App` as route/session composition. Keep
  `useJobSession` above all route returns and loading/error boundaries that replace pages.
- [ ] Move Timeline, Quotes, Glossary, Search and Referee controllers in small batches. Keep the
  current access union and data hooks. Move shared helpers only after identifying their callers.
- [ ] Extract Chat/Remember last as the counterexample: preserve draft, send-new URL update,
  anchored conversations, detached operation handling and live-conversation lifecycle.
- [ ] Replace mode dispatch with an exhaustive switch and add the narrow passage lifecycle/paired
  selection from A3. Retain separate slots unless a tested single-owner alternative is simpler.
- [ ] Sweep tests/docs/imports for each old exported band name and filename. Remove temporary
  re-exports after the caller census is empty. Assert feature files cannot import `App.tsx`.
- [ ] Update [new-mode](../project/new-mode.md), [web-client](../project/web-client.md),
  [URL state](../project/url-state.md) and feature signposts. Acceptance: adding a fixture mode
  makes all required policy decisions visible, and leaves article access/position code untouched.

### Stage: Cut secondary-route startup cost

- [x] Record an emitted import graph and a production network trace for signed-out landing,
  signed-in shelf, Plain reader and direct Admin/Design routes. Use the same source/config/device.
- [x] Lazy-load Admin and Design with local loading/error handling. If a shared import retains the
  heavy graph, move only that shared constant/type to a small existing home and verify again.
- [x] Keep reader/shelf/mode code eager in this tranche. Test in-tab offline navigation and first
  cached-mode activation before accepting a bundle reduction.
- [x] Test a failed chunk load with a usable escape; session engines survive pending/rejected
  imports, and loading a module emits zero generation requests.
- [x] Record before/after initial requested JS and time-to-readable-prose, not just the largest
  emitted chunk. Update [performance](../project/performance.md). Stop if no meaningful gain.

### Stage: Make the common mode surface fit and behave consistently

- [ ] Write failing checks for any reproduced keyboard/focus/scroll defect before changing it.
  Otherwise capture a behaviour baseline rather than inventing a bug the test pretends to fix.
- [ ] Pilot `ModeSurface` in Search and Chat, keeping header/body/footer roles explicit. Match
  current desktop dimensions and current covering-band behaviour; share visible-viewport fit.
- [ ] Verify narrow portrait, landscape/notch, keyboard open/closed, pinch/viewport pan, large text,
  long labels and touch selection. No footer/composer or close control may be unreachable.
- [ ] Check true modals separately from modeless annotations. Tab, Shift-Tab, Escape, click-away
  and return focus must follow the declared contract, including nested help/lightbox/tooltips.
- [ ] Migrate remaining surfaces in batches, including visitor/empty/error variants. Delete the
  replaced geometry rules after checking all callers, retaining feature-specific scrolling.
- [ ] Update [touch](../project/touch.md), [tooltips](../project/tooltips.md),
  [reading-view-overview](../project/reading-view-overview.md) and [design CSS](../project/design-css-overview.md).
  Any changed rule wording follows the important-doc process; signpost moves do not need approval.

### Stage: Make style ownership visible

- [ ] Extract contiguous CSS sections in original order, keeping `@layer app` and one entry point.
  Use separate commits from selector changes or visual adjustments.
- [ ] Compare computed dimensions/positions and screenshots for Plain, Hierarchy, Outline,
  two different bands, a modeless annotation, a true modal, visitor chrome and the shelf.
- [ ] Preserve semantic classes used by geometry, selection and tests. Search their consumers
  before moving/renaming anything; shared stacking/token rules get a single owner.
- [ ] Add representative real surfaces to `/design`; update the style map and remove stale
  inventories. Acceptance: the same cascade with files that tell an editor where a rule belongs.

### Stage: Optimise annotation inputs, if measurements warrant it

- [ ] Use a fixture matrix: short essay; a long article; many comments and overlapping glossary/
  search marks; figures; footnotes/supplement blocks; RTL/non-Latin prose where fixtures support it.
- [ ] Measure comment/term selection, changing a search, hover, scroll and a streaming answer.
  Verify nonzero block/row counts and a changed-input control before accepting zero-work results.
- [ ] Split anchor resolution from selection; then add bounded per-block input reuse only if the
  first extraction leaves significant repeated work. Keep the existing HTML output identity cache.
- [ ] Test changed content under the same block ID, removed blocks, article/access changes,
  overlapping marks, figures and note navigation. Pair parse/render counters with DOM identity and
  visible correctness. Avoid brittle assertions about every React render in StrictMode.
- [ ] Record the commands, fixture, source SHA, build kind and at least three comparable runs for
  noisy timings. Update [performance](../project/performance.md); no claimed percentage from one run.

### Stage: Consolidate geometry only after the preceding baseline

- [ ] Profile the actual scroll/layout reads after A7. If they are not material, close this stage
  as deferred with evidence; a new observer service has a real maintenance cost.
- [ ] Share the smallest read snapshot between two existing consumers. Preserve distinct focus
  calculations and fresh explicit jumps; test delayed image/font/viewport changes.
- [ ] Test observer teardown, hidden/visible transitions, native gesture interruption, new layouts
  and article changes. Demonstrate a reduction in repeated reads alongside identical destinations.
- [ ] Extend only if the pilot pays back. No table replacement, prose virtualisation or new
  navigation state machine is included. Update the geometry and performance signposts.

## Acceptance contract across stages

Use the existing suite and a small number of integrated scenarios, not a new test framework.
At each stage run `npm test`, `npm run typecheck`, relevant lint and `npm run check`; builds matter
for loading/CSS changes. Database-backed tests must use the repo's local isolated lane, not
production and not a skipped lane described as green. Browser tasks go to the machine-appropriate
browser subagent after reading the project's browser docs; real iOS keyboard behaviour cannot be
proved by jsdom or desktop viewport emulation.

| Scenario | Required invariant | Existing evidence to extend |
|---|---|---|
| Owner A → visitor/B → A, same slug, delayed responses | No stale private content or owner hooks under the wrong access; identity checked before paint | `tests/access-sharing.test.tsx`, `tests/public-network-trace.test.tsx` |
| Article → metadata → tweets → reader | Shared article access; no unnecessary refetch; URL position/view preserved | `tests/access-sharing.test.tsx`, router/URL-state tests |
| Press mode, leave before read completes, return by Back | Arrival and prefetch never spend; abandoned press cannot become a later job | `tests/modes-that-start-themselves.test.tsx`, `activation.ts` tests |
| Job finishes while artefact's initial read is outstanding | Post-write refresh trails; stale response cannot overwrite current data | `tests/artefact-read-race.test.tsx` |
| Change modes while passage publication/cleanup is pending | Prose, spine and selected result belong to the active producer | `tests/passage-mode-cleanup.test.tsx`, feature wiring tests |
| Offline after loading; shelf → cached article; remount cached mode | Cached data and required code available; clear copy indicator; no writes queued silently | `tests/offline-remount.test.tsx`, `tests/api-fetch-offline.test.ts` plus built-app browser run |
| Mode/controller throws or chunk rejects | Article/position survive; retry/Plain works; no automatic paid restart | New shell-level failure scenario |
| Close/switch a streaming or live surface | Preserve that feature's stop/persist policy and server fences; incomplete stream not success | Existing conversation, stream, detached-dialog and live tests |
| Keyboard, touch, enlarged text, nested overlays | Reachable input/send/close; intentional focus/scroll; prose selection retained where modeless | `tests/hover-card-touch.test.tsx`, viewport tests plus real-device pass |
| Change a single annotation then scroll | Changed content updates; unchanged prose nodes retained; no accidental full article rewrite | Annotation tests, `perf.ts`, DOM mutation census |

For performance, a suggested first acceptance target is **no regression** in time-to-readable-prose,
initial requested JS and p95 interaction duration on fixed profiles; choose numeric budgets from the
  measured baseline rather than inventing a device-independent millisecond promise. Give optimisations
an additional mechanism target: fewer parses, fewer layout reads or a smaller initial import graph.
Record CPU as directional when run-to-run variance is large.

## Alternatives and decisions still open

- **Full rewrite, Next/router migration or microfrontends:** declined as the starting point. The
  main problems live inside reader composition and lifetimes; new routing/rendering infrastructure
  would still have to preserve those contracts. Revisit only for a concrete unmet requirement.
- **Mode registry:** now recommended at the discovery/interface level, with a staged pilot in the
  [companion plan](260905e-mode-catalog-and-command-bar.md). Previous agent objections are evidence
  about particular designs, not a product veto. A registry can point at bespoke implementations;
  it need not reduce them all to the same generated schema.
- **Generated UI or universal artefact factory:** explore separately. A common plugin-facing
  interface may pay off long-term; making Quotes/Timeline/Ideas use one extraction schema has
  specific provenance/ordering costs. Compare those costs against an actual prototype, not a blanket
  prohibition. No new generic route/stage factory is needed for the command-bar pilot.
- **One shared client state store/query framework:** deferred. The important distinction is who
  owns a value and when it may commit, not which hook returns it. Preserve current API/cache fences.
- **More server boundaries now:** maintain the existing route/store seams. Splitting `routes.ts`
  into domain handlers can follow a measured edit-conflict or bundling need, preserving auth,
  body validation, errors and response projection. It is not required for the client proposal.
- **Service worker/full offline sync:** separate product work. This proposal must preserve current
  in-tab cached reading; it does not promise a cold offline boot or offline editing.
- **Prose virtualisation/canvas renderer:** deferred until a profile demonstrates a problem smaller
  annotation/geometry changes cannot solve. It would reopen several core reading contracts.
- **Mobile sheet/menu redesign:** promising, undecided. Prototype cited-passage round trips before
  selecting a layout. Keep the behaviour-preserving mobile surface stage independently useful.

The overall approach is sound: ordinary React, one article/block model, explicit capabilities and
feature-specific behaviour are good foundations. The best rearchitecture strengthens those seams
and removes repeated coordination. It should make the next mode easier to add without making the
reader depend on an increasingly elaborate framework of its own.

## Review and delivery record

- [x] Source and earlier-plan audit, including independent modes/mobile/data passes.
- [x] Production client build and dated output baseline.
- [x] GPT Sol review of this proposal and its implementation contracts; all findings closed.
- [x] Documentation checks and repository validation recorded honestly; full check is not green.
- [x] Commit and push documentation to `dev`; candidate SHA recorded in the review artefact.

The [evidence record](260905e-main-app-architecture-evidence.md) contains commands and results.
The [review disposition](260905e-main-app-architecture-review-closure.md) records the independent
review, each finding's correction and the final candidate revision. The application stages above
remain proposals regardless of the documentation delivery status.

Up: [Web client](../project/web-client.md) · [Architecture](../project/architecture.md) ·
[Reading view](../project/reading-view-overview.md)
