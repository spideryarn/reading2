# A `:has()` anchored above the article walks the whole document on every change

Found from `spya-bewb4q` (Greg, 2026-10-29: Send shows nothing for a couple of seconds on an old
iPad) and measured in
[261029a](../investigations/261029a-feedback-dialog-cost-on-a-long-article-measured-at-six-times-throttle.md).
Fixed in [261029k](../plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md).

## What happened

Typing one character in the Feedback box took 1.0–1.4 s to paint, and pressing Send took ≈1.4 s to
show *Sending*, at 6× CPU throttle on an 87k-node book. Only 0–10 elements were restyled per
keystroke. The time was selector matching: about fifteen rules of the form `:root:has(.x)` or
`:root:not(:has(:where(.reader) > .controls))`, each re-checked after the keystroke, each check a
walk of every node in the document. Deleting every `:has()` rule took a keystroke to 0.4–0.6 s.

## The root cause

`:has()` is the one selector whose cost depends on what is *below* its subject, not on the element
being matched. Put its subject at `:root` and its argument behind a descendant combinator, and "is
there a `.return-chip` anywhere?" is answered by searching the page — and the engine asks again
after any DOM change it cannot rule out, which in practice is most of them (here, the textarea's own
shadow-DOM placeholder). On a reading app the page *is* the article, so the cost is the article's
size times the number of such rules, paid on every keystroke, every streamed chat token, every
marginal note drawn.

Why it was written that way is the more useful half. Each rule was the right local call: CSS that
reads the DOM needs no state plumbing, cannot drift from what is rendered, and the comments around
these rules are careful about specificity and about forgery by an article's own markup. Nobody wrote
"walk the document"; they wrote "if there is a bar". **The cost was invisible at the scale anyone
tested at** — a short article on a fast laptop — and appears only as the product of two things that
are each fine alone: a high anchor and a big page.

## The class

**A selector whose cost scales with the page, on an app whose page scales with the content.**
`:has()` with a high subject is the clear instance; a rightmost `*` or `:where(…)` that every
element has to be tested against is its milder cousin (it costs on each full restyle, not each
change).

## Introduced

`676c93716` (2026-08-27, *"On a phone every line was cut in half…"*) added the first `:root:has(`;
`9911eabd2` (2026-09-08, *"The bar with nothing in it stops being drawn…"*) added
`:root:not(:has(:where(.reader) > .controls))`, which measured as the single most expensive rule.
Some fifteen followed, each copying the shape of the last.

## The right long-term fix

What the page is showing is state the app already has. **Say it from that state** — an attribute on
`<html>`, set by the component that renders the thing — and keep `:has()` for a question about an
element's own children, behind a `>`. That is what 261029k does, with the flags in a closed type so
a misspelt one is a compile error. It also ends the forgery worry those comments manage by
scoping: markup cannot set a flag.

## What would have caught the class, ranked by ease against value

1. **A test that fails on a `:has(` whose subject is `:root`, `html`, `body` or `.reader` and whose
   argument does not begin with `>`** — the rule as a check, over the same stylesheet text the
   suite already reads. Being done (261029k stage 1.4).
2. **A line in design-css-overview.md** saying why: the next person reaching for `:root:has()`
   meets the reason where they look for how the CSS is organised. Being done.
3. **Test performance on the longest article on a throttled CPU**, not on whatever is open. A habit
   for anything that touches the reading view's chrome; the investigation's harness is the shape.
   Cheap once; not automated.
4. A performance budget in CI (keystroke → paint on a fixture book). Rejected for now: a shared box
   gives ±30% noise, so a budget would be either flaky or too loose to catch a 3× regression late.
