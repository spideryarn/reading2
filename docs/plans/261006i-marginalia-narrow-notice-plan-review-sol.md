The change is directionally right: fade plus dismissal answers Greg’s report, non-persistent dismissal is the simpler default, and retaining the hidden node is sound. However, the plan and tests need correction before implementation. No files were edited.

1. **F1 — P2 — established:** One red-first test fails for the wrong reason. At [marginalia-narrow-notice.test.tsx:88](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/tests/marginalia-narrow-notice.test.tsx:88), `readerSheets()` returns an array, but `stripComments()` requires a string. The test throws `TypeError: css.replace is not a function`, so a correct implementation would remain red. Fix: use `readerCssNoComments()`, or select and pass the `marginalia.css` sheet’s `.css` string.

2. **F2 — P2 — established:** The remount table and browser check do not match the real width states. With the rail on:

   | Width | No band | Band open |
   |---|---|---|
   | `<612px` | standalone notice | covering band; `MarginaliaHead` unmounted |
   | `612–699px` | notes fit; no notice | covering band; head unmounted |
   | `700–899px` | notes fit; no notice | panel-specific notice |
   | `≥900px` | notes fit | notes and band both fit |

   With the rail off, the thresholds are 600, 688, and 888px. This follows [layout.ts:581](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/src/web/layout.ts:581), [layout.ts:678](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/src/web/layout.ts:678), and the conditional mount at [Reader.tsx:3553](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/src/web/reader/Reader.tsx:3553).

   Consequently:

   - Closing a covering band restores the notice only below 612/600px, not throughout “under 700px.”
   - The two sentences never replace one another in a continuously mounted production notice. The test at [marginalia-narrow-notice.test.tsx:94](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/tests/marginalia-narrow-notice.test.tsx:94) constructs an unreachable Reader state.
   - The planned 650px no-band browser check at [the plan:136](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/docs/plans/261006i-marginalia-narrow-notice-fades-and-can-be-dismissed.md:136) cannot show the notice on the box; the notes fit there.

   Fix: rewrite the table, test no-band behavior around 590px, retain 800px with a band, and add a Reader-level covering-band close check below 600px. The sentence `key` is unnecessary for today’s production transitions.

3. **F3 — P2 — established:** Two clock contracts are untested. The existing clock deliberately keeps its callback in a ref so ordinary parent renders do not restart it ([Toast.tsx:63](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/src/web/Toast.tsx:63)); the new test only rerenders after dismissal. A naïve hook depending on the inline `onGone` callback could restart every render and still pass. Also, Toast’s test proves focus pausing inside Toast, but nothing proves the four handlers were all attached to `NarrowLine`. Fix: test a rerender partway through the five-second countdown, and test focus/blur on the new Dismiss button with remaining time preserved.

4. **F4 — P1 — reasoned:** Reusing `onMouseEnter`/`onMouseLeave` can make automatic dismissal sticky after a touch-generated hover. The repository already records that touch produces hover-family events and that synthetic unit tests missed the resulting bug ([touch.md:117](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/docs/project/touch.md:117)). Fix: generalise the shared hook around pointer events and ignore touch pointers for hover pausing, while retaining focus pausing. Exercise this with a browser-generated touch sequence; this should also repair the existing Toast behavior.

5. **F5 — P1 — reasoned:** The new close cross has no specified touch target. This notice appears at tablet widths, while the house close-control rule provides a 32px box and 40px finger target through `.close-x` ([controls.md:139](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/docs/project/controls.md:139)). Fix: use `className="marg-narrow-close close-x"`, leave sizing out of `marginalia.css`, and add it to `tests/close-cross.test.ts`.

6. **F6 — P1 — reasoned:** Auto-hiding creates an assistive-technology regression the plan has not resolved. The notice is a generic `aside`, not an announced status; focus remains on the Dock button when it appears. A screen-reader user may therefore never reach the explanation before `visibility:hidden` removes it from the accessibility tree. Focus pausing only helps after they locate its button. Fix: define an explicit accessible-feedback path—preferably a live region that already exists before its text changes, or an accessible explanation that remains after visual fading—and test that structure. Merely adding `role="status"` to an element mounted together with its text is not reliable, as Toast’s own design notes recognize.

The proposed `opacity` plus delayed `visibility` transition is otherwise sound for a one-way fade, and `:has(.marg-narrow)` continues matching a `visibility:hidden` descendant. Not remembering dismissal is also the appropriate simpler-first choice.

Test evidence: `tests/toast.test.tsx` passed all 10 tests; the new suite had the expected 1 pass and 7 failures, but F1 accounts for one failure unrelated to the missing implementation. The repository typecheck wrapper could not run in this sandbox because `tsx` was denied its IPC socket; plain `tsc --noEmit` passed.

VERDICT: build with fixes