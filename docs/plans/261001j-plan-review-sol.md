No P0. I found four P1 issues that should be resolved before building the remaining stages.

## P1 findings

1. **Stage 1 will not increase collapsed-icon spacing on a coarse-pointer phone.**  
   The proposed rung-3 padding still produces a button narrower than the existing `min-width: 2.5rem`, so the minimum wins and the phone layout is unchanged. This matters because the report specifically says “especially when collapsed.” See [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/src/web/styles/narrow-window.css:768).

   Simplest correction: retain the proposed desktop padding changes, but also increase the coarse-pointer minimum width slightly. Measure the additional scroll cost deliberately. Ensure rung 2 changes both segmented buttons and loose `.dock-mode` links.

2. **Stage 2 does not consistently produce a circle.**  
   The plan explicitly produces a pill at rung 0, despite being titled “in its own circle.” At coarse-pointer widths, `.dock > .dock-btn { flex: 1 }` can also stretch an allegedly square Feedback button.

   Simplest correction: put the icon in a fixed square circular inner span and leave the label beside it. That remains circular on the label-showing rung and through flex growth. Keep focus on the outer button, preserve the existing `.dock-btn:focus-visible` ring, and override the inherited full-button hover background if hover should paint only the circle.

   `margin-left:auto` itself is sound: with positive free space it pushes right; during overflow its auto margin resolves to zero. Verify that in Chrome because this row’s measurement has already exposed browser-specific overflow behaviour.

3. **The 320px nav claim is not supported and is probably false.**  
   The existing measurement is for one page link plus plain-text *Sign in*; icon + *Feedback* is materially wider. The current comment says a third entry already overflowed and that the surviving layout only just recovered 11px. See [SiteBits.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/src/web/SiteBits.tsx:170).

   Simplest correction: make the nav trigger icon-only below `sm`, with `aria-label="Feedback"`, and show the word from `sm` upward. The 320px check must be required, not “if cheap.”

4. **Stage 5’s proposed rule contradicts its implementation.**  
   “Every date … carries both forms” conflicts with “past 30 days the relative form gives way to the date.” Greg’s quoted request also says both forms whenever a date is shown. Decide explicitly:

   - either retain the 30-day cutoff and narrow the rule to recent dates; or
   - add month/year relative forms so the universal rule is true.

   Also, `design-css-overview.md` is an important rule doc. The plan correctly says not to commit it before approval, but the worktree already contains that uncommitted edit.

## Simplest implementation by stage

- **Stage 1:** Change `.dock` gap and rung padding, plus the coarse-pointer minimum. No `dock-fit.ts` logic or fit-signature change is needed: the browser measures the resulting CSS. Update stale numerical prose in `dock-fit.ts`, `dock-fit.css`, and `tests/dock-fit.test.ts`. Check that every rung remains strictly narrower than the preceding rung.

- **Stage 2:** Use `margin-inline-start:auto` on the outer trigger and a circular inner icon wrapper. Preserve the outer button’s complete click target and focus ring. Confirm the trailing `.dock-tail` remains reachable when overflowed.

- **Stage 3:** Add `nav` to `FeedbackVariant` and `FEEDBACK_SHAPE`, including `placement: "bottom"` and likely `keepSide: true`; render it conditionally as SiteNav’s final item. Use a named App predicate for the four SiteNav route kinds when suppressing the corner trigger. Update the many “three shapes” comments. The existing derived selector will count `nav`, but that alone is insufficient.

- **Stage 4:** The proposed deletion is correct. It is already present uncommitted, including removal of the unused CSS.

- **Stage 5:** `exactly(...)` plus one `Date.now()` per render and `relativeAgo(..., "narrow")` is the simplest implementation once the >30-day policy is settled. The current app uses `createRoot`, not SSR/hydration, so `Date.now()` cannot currently cause a hydration mismatch. It would if this component were later server-rendered.

## Missing verification

- Strengthen the SiteNav route walk. Its current assertion only requires exactly one trigger; leaving the corner trigger and failing to add the nav trigger would still pass. Require `.fb-nav` inside `.site-nav` and require `.fb-button` absent on all four signed-in routes. See [dock-corner-controls.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/tests/dock-corner-controls.test.tsx:406).
- Add nav-shape class, word, tooltip-placement, and focus assertions to `feedback-button-tooltip.test.tsx`.
- Browser-check 320px and 390px in a coarse-pointer context, not only ordinary desktop Playwright at a narrow viewport.
- Sweep widths around every fit-rung transition; 1280 and 390 alone can miss non-monotonic or premature rung changes.
- At overflow, assert `scrollWidth > clientWidth`, the last trigger can be scrolled fully into view, and the trailing gutter remains.
- Keyboard-tab through both the dock circle and nav trigger; verify visible unclipped focus rings and tooltip placement.
- Add an absence assertion for the removed Stage 4 sentence.
- The current Earlier test derives its expected exact text using the same `exactly()` helper as production, so a shared regression can stay green. Independently assert that the rendered exact part contains a time; `relative-time.test.ts` currently claims to verify that but only checks for the year.
- Run `npm run check` as the gate in addition to test, typecheck, and scoped lint.

Finally, the worktree is already partly built: Stages 4 and 5, their test, and the rule-doc edit are present as uncommitted changes, so the plan’s “none built or in flight” statement is now stale.