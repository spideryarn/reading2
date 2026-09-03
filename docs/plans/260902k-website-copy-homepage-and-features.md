# The homepage and a features page, in Greg's words

## Goal, context

Rewrite the signed-out landing page and add a `/features` page, both written as if Spideryarn
Reading is in beta and taking payments, using Greg's own sentences wherever one exists and marking
everything else as connective tissue. Screenshots of every mode, taken from real articles.

The brief and the decisions are in
[260902k-spideryarn-reading-intent-brief.md](../research/260902k-spideryarn-reading-intent-brief.md)
and [positioning.md](../project/positioning.md). The interview that supplied the words is
[260902k-spideryarn-reading-interview-guide.md](../research/260902k-spideryarn-reading-interview-guide.md)
— four of fourteen questions answered on 2026-09-03 before Greg stopped:

> ok, make a note of all the other questions you have. i'm not going to answer any more now. do you
> have enough to update the Homepage and/or provide a Product/Features page (ideally with
> screenshots you've taken from sample articles)?
>
> — Greg, 2026-09-03

Decisions he made for this piece of work, same day: the lead shot is my call (*"Use your judgment.
I think the Semantic Search/Highlighting is also pretty neat. I can't decide."*); **Beta copy with
an honest strip** — all copy reads as beta and paid, one strip says sign-up opens soon and takes an
email, deleted the day sign-up opens; pricing from
[260902i-stripe-payments-and-subscription-tiers.md](260902i-stripe-payments-and-subscription-tiers.md):
Free 3 articles for life, Reader $10/£8/€9 a month for 20, Researcher $50/£40/€45 for 150, and
reading never gated.

## What the simpler option was, and why not

**Simpler: rewrite the landing page only, no features page, reuse the four existing screenshots.**
Passed over because Greg asked for a features page with fresh screenshots, and because the existing
four were chosen when zoom was "the whole idea"; he said on 2026-09-03 that it *"isn't necessarily
the only/main/core thing any more."*

**Also simpler: an email-capture backend for the strip.** Not built. The strip's email is a
`mailto:` to `CONTACT_EMAIL` with a subject line, which needs no table, no endpoint and no spam
handling, and which is thrown away the day sign-up opens.

## The lead shot — my call

The glossary card leads. Greg's own image of the product (2026-09-03) is *"a dog-eared copy of a
book where a clever friend has highlighted the best bits and scribbled in the margins"*, and the
glossary card is the scribble in the margin. The Outline (fisheye) is second, because it is what
he named first when asked. Search by meaning is third, because he called it *"pretty neat"* and
it is the shot that shows the spine painting. Zoom columns are still on the page, lower.

## Stages

1. **Screenshots.** A Sonnet subagent, Playwright against system Chrome, headless, writing PNGs to
   disk — not the Chrome extension, which returns images to the model rather than files. Twelve
   shots on the Anil Seth essay and one paper. Then `pngquant --quality 65-92` and a downscale to
   about twice the drawn width, per the landing page's own rule.
2. **Pages.** `src/web/shots.ts` holds every screenshot's file, size and alt text in one record,
   read by both pages and by the assets test. `SiteBits.tsx` holds the figure, heading and
   feature-row components both pages share. `LandingPage.tsx` rewritten; `FeaturesPage.tsx` new at
   `/features`, reachable signed out and signed in like `/privacy`. Router, page title and App
   wiring; tests for the route, the title and the assets.
3. **Docs and review.** `website-text.md` gains the features page and the beta strip; a GPT Sol
   review of the copy against the brief (does every sentence trace to Greg, or is it marked?) and
   of the diff.

## Provenance rule for the copy

Every sentence on either page is one of three things: **Greg's words** (verbatim or lightly
punctuated — the source and date are in a comment beside it), **a product fact** checked against
the code (a mode name, a price, a count), or **connective tissue**, kept to the minimum and marked in
the file header as the part the next interview replaces. No agent-written line is presented as his.

## Out of scope, flagged

- The privacy page says "alpha" in five places. It is a policy with its own review process
  ([privacy.md](../project/privacy.md)); the word should change to "beta" when the beta is real,
  not in a marketing commit.
- The strip's email capture is `mailto:`; a waitlist table is a later decision.
- Ten interview questions remain unanswered; the features page uses Greg's older quotes from the
  feature docs for those modes.
