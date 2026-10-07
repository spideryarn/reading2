Stage 1 is not ready to build as written: its debounce contradicts existing acceptance checks, and closing detail with Back can discard preferences changed inside it.

The core inventory is accurate. Sessions already has a measured 340px list pane and a detail pane above a 740px container width. Changed feed text pushes per keystroke; switching sessions pushes; “← All sessions” pushes and makes Back reopen detail. There is no explicit list-scroll restoration. The fleet has four mode registers and an unchecked mount.

I ran `tests/fleet-web.test.tsx`: **512 tests passed**. A [throwaway harness](/tmp/fleet-plan-review.cjs) verified the history scenarios below. No repository files changed. The live HEAD was `5c4288fa3`; compared with candidate base `844816cce`, the listed fleet source files were unchanged.

**F1 — P1, established: the debounce and unchanged-test promise cannot both hold.**

[Stage 1](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/docs/plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md:85) delays every order, limit and filter write by 300ms. Existing tests assert immediately after changing order, and the feed integration test asserts the session filter immediately after clicking its chip. Waiting for React’s `act()` does not wait for that timer.

Smallest correction:

> Order, limit and discrete feed-filter changes replace synchronously. Text typing alone replaces after a trailing 300ms debounce. Existing synchronous assertions remain unchanged for synchronous controls; text-debounce tests explicitly advance the clock and check both immediate UI state and eventual URL state.

This also avoids delaying persistence of a discrete choice for no typing-related benefit.

**F2 — P1, established: closing detail rewinds more than selection.**

Concrete trace:

```text
#sessions
→ open A
#sessions?sel=A                 [marked]
→ change order to name
#sessions?order=name&sel=A      [replace retains mark]
→ All sessions calls back()
#sessions                      [order silently returns to default]
```

The harness reproduced this. The existing close callback removes `sel` and `selpid` while carrying other parameters; the proposed Back operation restores the whole older entry instead.

Smallest correction:

> Explicitly closing detail replaces the current entry with the current parameters minus `sel` and `selpid`. Opening from the list still pushes, so browser Back from an open detail returns to the list. Explicit close leaves one duplicate list entry; accept that cost for v1.

That removes the marker and asynchronous close machinery too. Preserving preferences while also consuming the opening entry would require a larger design.

**F3 — P2, reasoned, with reproduced failure paths: “flush or cancel” is not a debounce protocol.**

Those operations are not interchangeable:

- Cancel before pushing a session destination: the destination carries the optimistic filters, but Back returns to the stale, unfiltered feed.
- Flush on an incoming `hashchange`: traversal has already changed the current entry, so the stale replacement can overwrite the destination Back just reached.
- Cancel on every `hashchange`: a queued event from the app’s own hash push can cancel a newer optimistic update.

The harness reproduced the first two. It also showed that an opening push’s queued event can have `newURL=A` while the actual location already names replacement B.

Replace the debounce bullet with:

> Before an owned push, synchronously flush pending replacement into the source entry, then push the destination. Incoming navigation cancels pending work and adopts the actual location. Pagehide flushes only work belonging to the current entry. Maintain the latest logical state in a ref so subsequent writes do not depend on a render having completed.

The smaller event model is to use `pushState` and `replaceState` for owned writes, publish local state explicitly, and listen to both `popstate` and `hashchange` for incoming navigation. That also permits atomic entry metadata without a queued hash event.

**F4 — P2, established mechanism mismatch; lifecycle consequences reasoned: the boolean does not prove “this page’s life.”**

`{ fleetOpened: true }` contains no document identity or predecessor identity. History state can survive reload or restoration; losing JavaScript memory does not necessarily lose the mark. Conversely, bfcache can preserve the document and its memory. Neither case is represented by this boolean.

Also, `history.back()` returns before traversal completes—the harness confirmed that the detail URL remains current immediately afterward. The plan does not define what local state displays during that interval or how another navigation is handled.

Smallest correction is F2’s synchronous replace. If retaining Back-on-close, replace the mechanism wording with:

> Store a per-document token and the expected list predecessor, preserve unrelated history state, and mark only Sessions-list → Sessions-detail pushes. Closing waits for navigation completion and serializes other writes during traversal. A missing or foreign token replaces.

“Fall back if Safari or jsdom proves unreliable” does not specify the production behaviour.

**F5 — P2, reasoned: scroll restoration needs a rendering boundary.**

[SessionsPanel’s detail ref](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tools/fleet/web/src/SessionsPanel.tsx:650) focuses and scrolls the attached detail. Restoring `window.scrollY` inside the hash hook, before the list remounts, can be clamped against the shorter detail document. The hook also does not own the measured one-pane decision. Browser history restoration can introduce another scroll writer.

Smallest replacement:

> Capture the list position before selection. Restore it in SessionsPanel after the one-pane list has mounted, and return focus with `preventScroll`. Associate the saved position with that list opening. Define separately whether native Back uses browser restoration or application restoration; do not run both blindly. With no saved position, make no restoration promise.

Remove “a reload starts at the top, as now”; the fleet does not set manual browser scroll restoration.

**F6 — P2, established component incompatibility; resulting preview failure reasoned: existing card parts cannot be reused unchanged in this tooltip.**

The fleet [tooltip surface](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tools/fleet/web/src/tailwind.css:693) has `pointer-events: none`, no pointer corridor and `role="tooltip"`. `Uptime`, `StatusPill`, handles and option-consequence badges contain `Explain` buttons. Full `QuestionCard` can contain scrollable material. Reusing these unchanged creates controls the pointer cannot reach, and sufficiently long content cannot fit or be scrolled.

Smallest replacement:

> Build presentational preview content from the existing data and formatters, without Explain buttons or other focusable descendants. Bound its height and explicitly mark omitted content as available by opening the session. If the preview must expose full scrollable material or controls, use an interactive hover-card surface with pointer entry, keyboard reachability and appropriate dialog semantics.

Add a long-question/material case to Stage 2’s checks. Keeping the fleet port is reasonable, but its current capabilities constrain the preview.

**F7 — P2, established: moving the icon table does not isolate hash tests from lucide.**

The proposed dependency remains:

```text
mode.ts → modes.tsx → lucide-react
```

Runtime re-exports load their dependencies. Moving the import into another file does not remove it from hash tests.

Smallest replacement wording:

> A combined table makes lucide a transitive dependency of mode.ts through its runtime re-exports. Accept that explicitly, or keep the ordered vocabulary, labels and tips in a plain module and retain the compiler-checked icon map in Dock.

The exhaustive mount is worthwhile independently. Table consolidation is optional maintenance work; its scope alone is not a reason to block this job.

**F8 — P3, established: the product-side inventory overstates consolidation and debounce uniformity.**

The reading app does **not** have one mode table: vocabulary is in `src/modes.ts`, catalog copy in `src/mode-catalog.ts`, labels in `src/title-text.ts`, and icons/order in the dock machinery. The separation is expressly documented. Its replace parameters are not all debounced; discrete sorting parameters can push. Also, fleet descriptions clamp in both compact and full-width cards.

Exact replacements:

> Reading modes use a shared vocabulary and compiler-checked records with separate ownership for catalog copy, labels and dock presentation.

> The reading app assigns history and rate limiting per parameter: continuous text/position updates debounce; selection parameters replace; several discrete ordering changes push.

> Compact cards additionally omit question options and material. Descriptions clamp at both widths.

The dashboard may still choose different policies, but label them as dashboard decisions.

**F9 — P3, established: static hosting does not require fragments.**

The fleet server’s `serveStatic` strips the query before resolving a file. A real query string also works with relative assets and a static page served from a prefix; it needs no server route table.

Replace the hash rationale with:

> Keep the existing fragment format because it already supports bookmarks, parsing and navigation, and migrating it brings no necessary benefit here. Static hosting would also support query-string state.

Avoiding the product’s coupled router/parameter modules, retaining the tooltip port, and excluding the undecided three-column vision are otherwise justified. Greg’s explicit request has no material omission. Stage 3 introduces no new visible feature requiring a separate product decision.

**Verdict: do not build.**