The mark/letters partition itself is sound: the eleven included animations target disjoint descendants; `.spya-anim` only supplies shared structural rules, pseudo-elements do not overlap, and the `.site-wordmark-*` rules cannot match the loader.

1. **P1 — The fixed 2.4-second handoff will visibly snap and sometimes look stalled.**

   **Evidence:** The plan changes either class every 2.4 seconds ([plan:34](docs/plans/261001q-logo-loading-spinner.md:34)), but Warm Drift lasts 3.2 seconds ([logo-animations.css:390](src/web/styles/logo-animations.css:390)); Dragline is halfway through its second loop at 2.4 seconds, with the spider 8px down and its thread extended ([logo-animations.css:790](src/web/styles/logo-animations.css:790)); and Abseil is 20% into its second drop ([logo-animations.css:713](src/web/styles/logo-animations.css:713)). Removing those classes snaps them home because transitions cannot recover values supplied by an animation ([logo-animations.css:217](src/web/styles/logo-animations.css:217)). Seam, Settle, and Only the i instead hold non-neutral poses ([logo-animations.css:267](src/web/styles/logo-animations.css:267), [logo-animations.css:432](src/web/styles/logo-animations.css:432), [logo-animations.css:543](src/web/styles/logo-animations.css:543)). Meanwhile Sag and Misregistration finish early, so pairing either with Settle or Only the i can leave both tracks static for a substantial part of the period. Thus the plan’s “something visibly moves at every moment” premise is false ([plan:90](docs/plans/261001q-logo-loading-spinner.md:90)).

   Different one-shot keyframe names will restart correctly, and the no-repeat rule avoids reapplying the same name. The defect is the handoff between animations, especially keyframe ↔ transition and held transition → keyframe.

   **Fix:** Replace the universal period with duration-aware sequencing that changes each class only during that animation’s neutral window, with an explicit neutral/exit phase for Settle, Seam, and Only the i. Alternatively, use a smaller loader-safe subset or one purpose-built continuous animation—the simpler option now has stronger justification than the plan acknowledges. Force deterministic browser checks of Dragline → Settle, Abseil → Seam, Seam → Sag, and Only the i → Pluck; random observation is insufficient.

2. **P1 — Transition-based animations need a painted resting frame before their first class is applied.**

   **Evidence:** The plan does not specify initial arming. `/design` already documents that an element born with `spya-settle`, `spya-seam`, or `spya-i` has no previous value to transition from and therefore appears directly in its static end pose; it deliberately waits one `requestAnimationFrame` ([DesignPage.tsx:1174](src/web/DesignPage.tsx:1174)). A loader that initializes either track with an animation ID can consequently look stalled on its first draw.

   **Fix:** Render the glyphs at rest first, then arm both initial classes after `requestAnimationFrame`. Add a test or deterministic browser case that forces each of the three transition-based animations as the first draw.

3. **P1 — Mounting an already-filled `role="status"` does not reliably make the promised announcement, and can duplicate the existing title announcement.**

   **Evidence:** The plan mounts `LogoLoader` only after `slow` and gives that newly inserted node an already-populated `aria-label` ([plan:54](docs/plans/261001q-logo-loading-spinner.md:54), [plan:64](docs/plans/261001q-logo-loading-spinner.md:64)). This repository’s existing live-region implementation explicitly records that creating and filling a region together produces no announcement ([page-title.ts:517](src/web/page-title.ts:517)). Conversely, ordinary SPA waits already announce the delayed “Loading” title through that live region ([page-title.ts:555](src/web/page-title.ts:555)), so if the new status is announced by a particular assistive-technology/browser pair, the reader may hear two announcements. The live specimen on `/design` would also expose a loading status when that page is not loading ([plan:67](docs/plans/261001q-logo-loading-spinner.md:67)).

   **Fix:** Mount an empty persistent status region when loading begins, then insert visually hidden text when `slow` becomes true. Coordinate it with `useDocumentTitle` so exactly one mechanism announces the wait. Use text content rather than relying on an `aria-label` mutation, hide the whole visual glyph from accessibility, and give the `/design` specimen a silent/decorative mode.

4. **P2 — “Read `matchMedia` once on mount” is not a complete reduced-motion contract.**

   **Evidence:** The plan requires no timer under reduced motion but only proposes a one-time query ([plan:58](docs/plans/261001q-logo-loading-spinner.md:58)). If that read occurs in an effect, one animated frame can paint first; if the preference changes during a long wait, the timers and class changes continue. The global guard only shortens animations and transitions ([tailwind.css:147](src/web/tailwind.css:147)); it does not prevent the planned 1.2-second pose changes.

   **Fix:** Initialize the preference synchronously before rendering the animated branch, subscribe to the media query’s `change` event, and make the timer effect depend on the current preference so it cleans up immediately. Test changing the query while the loader is mounted, not only its initial value.

5. **P2 — The no-contention performance claim is technically false and currently unverified.**

   **Evidence:** The plan says the compositor does the work and the main thread is not involved ([plan:79](docs/plans/261001q-logo-loading-spinner.md:79)). Some transforms may be composited, but Misregistration animates `text-shadow` ([logo-animations.css:353](src/web/styles/logo-animations.css:353)), Warm Drift animates a filtered drop shadow ([logo-animations.css:390](src/web/styles/logo-animations.css:390)), and Radius Sweep changes a custom property inside a masked conic gradient ([logo-animations.css:858](src/web/styles/logo-animations.css:858)). Those can require repainting. Conditional rendering after 600ms also does not make the statically imported component’s JavaScript literally free before first paint.

   **Fix:** Narrow the claim to the facts established here: no new asset request, no layout-changing animation, and no loader work before the slow threshold. Add a browser performance check that the article replaces the loader immediately when the held response is released; if strict compositor-only behavior is required, restrict the loader pool accordingly.

6. **P2 — The docs step omits two ownership edits required by the repository gate.**

   **Evidence:** The plan names the new doc, its parent page, and two cross-links, but not the ownership declaration in `AGENTS.md` or the child’s backlink ([plan:70](docs/plans/261001q-logo-loading-spinner.md:70)). `tests/doc-links.test.ts` reads ownership from the seven `AGENTS.md` “↳” lists, requires every project doc to be claimed exactly once, requires a link from its owner, and requires a rendered link back to that owner ([doc-links.test.ts:331](tests/doc-links.test.ts:331), [doc-links.test.ts:403](tests/doc-links.test.ts:403), [doc-links.test.ts:419](tests/doc-links.test.ts:419), [doc-links.test.ts:440](tests/doc-links.test.ts:440)).

   **Fix:** Add `loading-spinner.md` to `design-css-overview.md`’s ownership list in `AGENTS.md`/`CLAUDE.md`, add the parent’s downward link, and end the new doc with an `Up: [design-css-overview.md](../project/design-css-overview.md)` link.

Verdict: Revise before implementation—the selector partition is correct, but the cadence, transition lifecycle, live-region behavior, and performance claims are not yet safe.