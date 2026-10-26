# A fix on one caller of a shared bar leaves the others broken

Report `spya-tfsjvq` (Greg, 2026-10-25): on an iPhone the signed-out landing page's wordmark and
*Sign in* were drawn under the status bar. Plan and evidence:
[261026a-signed-out-nav-below-the-clock-on-an-iphone.md](../plans/261026a-signed-out-nav-below-the-clock-on-an-iphone.md).

## The root cause

`SiteNav` renders one bar, `.site-nav`, sticky at `top: 0`, for seven kinds of page. `index.html`
asks for `viewport-fit=cover`, so wherever iOS draws a status bar over the page, every piece of
fixed or sticky chrome has to add `--safe-top`. When 261007h's review found that the new signed-out
**document** pages put the bar under the clock, the fix was written against the selector of the
page under review, `.site-document-nav > .site-nav`, not against the bar. The six pages that render
`SiteNav` without that wrapper (landing, Features, Pricing, Sign in, the public shelf, the
public-sharing page) kept a bar with no inset.

Why it survived: the inset is `0px` on every machine we develop on, so the six pages and the fixed
one looked identical in every screenshot; and `scripts/safe-area-check.ts`, the one check that
forces the inset, only ever opened the reading view.

## The class

**A fix on one caller of a shared component**: a defect that lives in the shared piece is found
through one of its callers, and the fix is scoped by that caller's selector (or prop, or route),
so the other callers keep it. The review that found it was reviewing that caller, which is why the
narrow fix read as complete.

## Which commit introduced it

- `f3b8861d4` (2026-09-03, "Redesign the signed-out marketing pages") made `.site-nav` sticky at
  `top: 0` with no inset.
- `32be0fb09` (2026-10-07, 261007h, GPT Sol's review fix C1) added the inset for the document
  shell only. That is the commit whose scope is the lesson: the comment it wrote, *"The new
  signed-out document shell replaces an inset-aware way home"*, is about the page it was fixing.

## The fix

Shipped and right for the long term: `padding-top: var(--safe-top)` moves to `.site-nav` itself
(`styles/site.css`), the wrapper's rule is deleted, and the bar is correct on every caller by
construction. `DocumentPage`'s own arithmetic (its floor and anchor offsets) is about its own layout
and stays.

## What would have caught it, ranked by ease against value

1. **When a fix lands on a selector like `.wrapper > .shared`, ask whether the defect is in
   `.shared`.** A one-line habit; it would have caught this at review time, because the defect (a
   sticky bar at `top: 0` under `viewport-fit=cover`) had nothing to do with the wrapper.
2. **`safe-area-check.ts --site`**, done: it forces a 59px inset and fails unless every link in the
   bar starts below it, on all seven kinds of signed-out page. It failed 6 of 7 before the fix, and
   fails 7 of 7 under `--break`.
3. **`tests/site-nav-safe-area.test.ts`**, done: cheap, red before the fix, and pins the rule to
   the bar rather than a wrapper.
4. A lint that every `position: sticky | fixed` with `top: 0` in the stylesheets also names
   `--safe-top`: rejected for now. Several such rules are correct without it (a bar below another
   bar, a band inside a scroller), so the lint needs an allow-list that would be as easy to get
   wrong as the rule it checks.
