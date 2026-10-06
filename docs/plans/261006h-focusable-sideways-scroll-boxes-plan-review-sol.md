The statement is **not accurate**. The shared hook is a reasonable fix for the listed boxes, but the inventory is incomplete.

- **F1 — P1, established: React scrollers are omitted.** The search at [plan line 15](/var/tmp/spideryarn-worktrees/qi-t2ee3kyx-focusable-scroll-boxes/docs/plans/261006h-focusable-sideways-scroll-boxes.md:15) excludes CSS and misses `overflow-auto`. Concrete counterexamples:
  - [Cited.tsx:374](/var/tmp/spideryarn-worktrees/qi-t2ee3kyx-focusable-scroll-boxes/src/web/Cited.tsx:374) renders chat code blocks as `<pre><code>…</code></pre>`; `mode-band.css` gives them horizontal scrolling and preserves unwrapped lines.
  - [AdminFeedbackList.tsx:260](/var/tmp/spideryarn-worktrees/qi-t2ee3kyx-focusable-scroll-boxes/src/web/AdminFeedbackList.tsx:260) renders unwrapped diagnostics JSON in an `overflow-auto` `<pre>`.
  - [DesignPage.tsx:684](/var/tmp/spideryarn-worktrees/qi-t2ee3kyx-focusable-scroll-boxes/src/web/DesignPage.tsx:684) renders colour scales; `design-page.css` sets `overflow-x: auto` and nonshrinking steps.

  None has a focusable child. Long code/JSON lines and narrow colour scales therefore remain unnamed and unreachable in the browsers this fix targets. These are React elements, outside both stated exclusions. Extend the inventory through CSS selectors and `overflow: auto`, handle these boxes, and test their actual renderers.

- **F2 — P1, established against the stated contract: one-pixel overflow gets no focus or name.** [The proposed predicate](/var/tmp/spideryarn-worktrees/qi-t2ee3kyx-focusable-scroll-boxes/docs/plans/261006h-focusable-sideways-scroll-boxes.md:39) uses `> NEAR`, where `NEAR = 1`. With `scrollWidth = 361` and `clientWidth = 360`, content overflows, but all three attributes disappear. The existing tolerance addresses fractional **scroll positions**, not whether integer widths differ. Use `scrollWidth > clientWidth` for accessibility eligibility, retaining `NEAR` for shades. Add an exact one-pixel boundary test.

- **F3 — P2, reasoned: the proposed tests leave caller mistakes undetected.** The chart gets only an overflowing case, and vouchers get no accessibility case. A chart with unconditional `tabIndex={0}` would pass its proposed test despite violating “only while”; leaving vouchers untouched would also escape these new assertions. Test overflow and fit on both actual renderers. Name WebKit/Safari explicitly in browser validation: desktop/iPad/phone **widths** do not establish the behaviour of the browser named in the defect.

I found no established shelf keyboard conflict: article arrow navigation is mounted by the reader, and the shelf’s local key handler belongs to its search input. `SidewaysScrollBox.tsx` is already in the eager graph’s shared allowlist, so exporting the hook adds no module boundary change.

Adding and removing `role="region"` together with its label is semantically valid; a region must be named. [WAI-ARIA](https://www.w3.org/TR/wai-aria-1.2/#region) The `cue={false}` design is adequate, and browser verification can settle the default focus ring.

The static renderer should remain functional with DOM access confined to the effect. However, its explicitly absent attributes mean the guarantee must exclude **unhydrated static reports**, or the report needs a separate accessibility solution.

No files changed. This was a source and plan review, not validation of an implemented build.

REFUSE