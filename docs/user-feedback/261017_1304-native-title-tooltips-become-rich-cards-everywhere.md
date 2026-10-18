---
reports: spya-q04h98
ending: shipped
---

# The browser's grey tooltips become our card, everywhere, and a test keeps them out

Report `spya-q04h98` (#589, `SPIDERYARN-READING2-JA`), from Greg (an admin), filed 2026-10-17
13:04 UTC, build `614e42c5`. A suggestion.

> Look for anywhere we're using regular tooltips (e.g. when hovering over the search name), and
> replace with rich tooltips / see tooltips.md / And how can we ensure this going forwards?

**Ending: Shipped**, on `dev`. Plan
[261017g](../plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md);
commits `34c48075b` (the card) and `ab7c2a321` (the sweep and the test).

**Every hover our code draws is now our card.** There were about 190 native `title` tooltips in the
app (168 plain ones, six in spreads, twenty passed through our own components, two SVG `<title>`s),
including the search name Greg named. They now use `data-tip`. One page-wide card draws them all,
with the same delays, look and keyboard behaviour as the rest. Where a `title` had been an
element's only name, it now has an `aria-label` as well, so a screen reader still hears it. Search's
find button keeps its tip while the search is not ready yet. Before, the button was disabled, and a
disabled button shows nothing.

**Going forwards:** `tests/no-native-title-tooltips.test.ts` reads every `.tsx` file in `src/web`
and fails on a new `title` tooltip. Our `Button`, `Link` and `SourceLink` no longer accept `title`
at all. [tooltips.md](../project/tooltips.md) says what to write instead. Two native ones are allowed,
each with its reason: an iframe's `title`, which is its name rather than a tooltip, and the cost
chart when it is saved as a standalone file, where there is no app to draw a card.

**Articles' own `title` attributes**, an author's hover text on a link or an abbreviation, still
showed the grey box in the prose. Changing that meant changing the sanitiser, a security defence, so
it went to Greg as [q-z2c269](questions/q-z2c269.md). He chose C on 2026-10-18 (`spya-y0xzwm`), and
it shipped in plan
[261018n](../plans/261018n-an-article-s-own-title-attributes-shown-in-our-card-marked-as-the-author-s.md):
the words now appear in our card, marked as the article's.
