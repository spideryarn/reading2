---
reports: none
ending: shipped
---
# The animated wordmark on more pages

From Greg (admin), 2026-09-29, relayed by the Overseer with no Sentry id. The time in the file name is
when this session received it.

> The contact page has all the lovely logo+sitename animations, but the other pages don't. Can we
> please reuse the animated logo+sitename in most other pages (where it makes sense to do so).

**Ending: Shipped** — on `dev`, not deployed. There is no Sentry issue to resolve.

Why it differed: the animations are one hook and one stylesheet everywhere. What decides which of
them a page can play is markup. The Contact page's corner logo spells "Spideryarn" as ten letter
spans, so it can play all thirteen. The marketing top bar and the footers spelled it as plain text,
so they could only play the six that move the spider.

What we did: the letters and the spider are now one shared component (`LogoGlyphs.tsx`), used by the
corner logo, the reading view's bar, the `/design` gallery and the "Spideryarn Reading" wordmark. So
now:

- **Gains the full set:** the top bar on the signed-out landing page, `/features`, `/pricing`,
  `/features/public-readable-sharing` and `/read/public`, and every footer (the shelf's included).
- **Already had it, unchanged:** the corner logo on the signed-in standalone pages (`/contact`,
  `/privacy`, `/profile`, `/add`, `/changelog`, `/opensource`, the 404, `/admin`, `/design`), and the
  reading view's bar, which still plays only the spider's six when a phone hides the word.
- **Deliberately not:** the shelf's big "Spideryarn" heading keeps the spider-only set. The letter
  animations move by a fixed number of pixels, tuned for a small word, and on a 30px heading they
  look like half a gesture. Making them scale with the text is the way to change that, and it is its
  own piece of work. `/login`'s plain heading also stays still; its footer animates.

Two effects behave a little differently where "Reading" follows the name. The typing effect shows no
cursor, because it would land on the R, and the fade-in effect fades the whole wordmark.

Plan: [260929c](../plans/260929c-back-links-become-icons-with-tooltips-and-one-animated-wordmark-reused.md).
