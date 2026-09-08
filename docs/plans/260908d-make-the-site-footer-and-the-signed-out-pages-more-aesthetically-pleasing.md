# Make the site footer, and the signed-out pages, more aesthetically pleasing

Greg, 2026-09-08:

> Have a look with browser screenshots at the footer e.g. for the logged-out `/` and see if you can
> make it more aesthetically pleasing. Also look around at those other logged-out pages and try and
> improve their appeal too any way you see fit. Get input from Fable.

The footer is [`SiteFooter.tsx`](../../src/web/SiteFooter.tsx) and the pages are the nine in its
header. This is a **visual** job on furniture that already works: nothing about which links the row
carries, which pages mount it, or which link it drops is in scope — that is settled, quoted and
tested, and [website-text.md § The footer](../project/website-text.md#the-footer) owns it.

## What is actually wrong, measured

Shot with headless Chrome at 1440×900, `deviceScaleFactor: 2`, `reducedMotion: "reduce"` (which is
what turns off `.site-reveal` and `.site-tilt` so a full-page capture is not blank —
[marketing-pages.md § Screenshotting the pages themselves](../project/marketing-pages.md)). The
numbers below are computed styles read out of the live page, not guesses from a picture.

1. **Every footer link is underlined.** `LINK_CLASS` is `tw:text-ink-faint tw:hover:text-highlight`
   and there is no Tailwind preflight in this app
   ([`tailwind.css`](../../src/web/tailwind.css) § the bit of preflight we need), so the UA's
   `text-decoration: underline` stands. `SiteNav`'s link class in
   [`SiteBits.tsx`](../../src/web/SiteBits.tsx) says `tw:no-underline`, and so does every other link
   class on these pages — the `mailto:` on `/contact`, the *Back* link, the cross-references in the
   privacy policy. The footer is the only link row on the site wearing browser-default underlines,
   and five grey underlined items in a row is what makes it read as raw markup rather than as
   furniture.
2. **The rule is the wrong family.** `tw:border-t tw:border-border` resolves to `oklch(0.27 0 0)` —
   a solid grey line on a `oklch(0.145 0 0)` page. Every other edge in the marketing language is
   `--site-hairline`, white at 10% alpha ([site.css](../../src/web/styles/site.css) § the ladder).
   So the heaviest, most saturated edge on the page is the one under the least important content.
3. **The row hugs the left of a very wide rule.** On `/` and `/pricing` the footer is 1104px wide
   and holds about 370px of text against its left edge. Roughly 70% of the rule has nothing under
   it.
4. **Nothing closes the page.** No wordmark, no year, no closing line — the content stops, a rule
   appears, five small links, and then black.
5. **Dead air below the footer on the short pages.** Measured as
   `scrollHeight − footer.bottom`: `/contact` 510px, `/login` 306px at 900px tall, and both pages
   are shorter than one screen, so the footer floats in the middle of a black field. `/privacy` and
   `/changelog` carry 96px of it from a `pb-24` that stacks under the footer's own bottom margin.
6. **Two page families.** `/`, `/features` and `/pricing` are `.site` pages with the sticky
   `.site-nav` and a 1152px column. `/privacy`, `/contact`, `/changelog` and `/login` are bare
   `max-w-2xl`/`max-w-sm` columns with an `← Back` link and no nav — the shape `/pricing` had until
   2026-09-04.

Horizontal overflow is clean at 1440, 390 and 320 before the change, by
[narrow-windows.md](../project/narrow-windows.md)'s own one-line check, and must stay so after.

## The design

Fable's, adopted almost whole; the argument for each piece is Fable's and is summarised here because
a plan that only records the conclusion cannot be reviewed.

**One bar, two ends, no columns.** A single flex row, `justify-between`, at the page's own content
width. Left: the wordmark, the caller's optional sentence, a colophon. Right: the links.

- **The rule** becomes a literal translucent white rather than `tw:border-border` — the marketing
  language's own family of edge, without needing a `.site` ancestor — which matters, because this footer also
  draws on the shelf and `/profile`, and neither may become a `.site` page. It also keeps us out of
  widening the `.site, .plan-cards` token list, which both site.css and
  [marketing-pages.md](../project/marketing-pages.md) forbid widening.

  **Written as `tw:border-[rgb(255_255_255/0.16)]` and not `tw:border-white/[0.16]`**, which was the
  first draft and is what an opacity modifier is normally for. GPT Sol's finding 7, checked against
  the compiled stylesheet rather than taken on trust: v4.3.3 emits the alpha *inside* a
  `@supports (color: color-mix(…))`, and the declaration outside it is opaque white. A browser
  without `color-mix` would get a solid white rule across the foot of the page — a louder version of
  the defect the line exists to fix. The literal has no fallback to be wrong.
- **The links** take `SiteNav`'s own link class verbatim — `tw:no-underline`, `text-muted-foreground`,
  `hover:text-foreground` — so the page speaks one link language top and bottom. The ` · `
  separators go; the gap is the separator.
- **A wordmark**, extracted out of `SiteNav` into a shared `Wordmark` in `SiteBits.tsx` so the two
  cannot drift. **Plain text, not a link**: the footer's whole rule is that it never offers the page
  under the reader's feet, and a wordmark linking to `/` on `/` would break it. Not `HomeLogo`
  either — that is the animated corner mark with thirteen hover animations
  ([design-logo.md](../project/design-logo.md)), and the foot of a policy page is not where those
  belong.
- **A colophon**, `© 2026 Spideryarn · beta`. A fact rather than copy, so it does not need Greg's
  words.
- **`variant` goes.** `SPACING` existed because a one-line grey footer looked cut off under the
  marketing pages' vertical space. A footer with a wordmark and two rows has mass of its own, and
  one measure closes both kinds of page. Four callers lose a prop.
- **No motion.** The footer gets no `.site-reveal`: a reveal on the last element fires exactly when
  the reader hits the scroll stop, and the shelf must not carry a site.css class anyway. The
  reduced-motion constraint is met by omission rather than by a guard.

**The bare pages keep being bare pages**, and this is the arbitration Fable was asked for. They do
not get `SiteNav`.

**The first reason given for it was wrong, and it is recorded here rather than quietly dropped.**
Fable's lead argument, which this plan carried, was mechanical: signed in, `PrivacyPage` and
`ContactPage` render under `<HomeLogo />` (`App.tsx` 343, 374), so a `SiteNav` would stack two brand
bars on one page. GPT Sol checked it and it does not hold — signed-in `/features` (347),
`/features/public-readable-sharing` (364) and `/pricing` (388) already render exactly that
combination and have since they joined. Either that is a defect on three pages, or it is not a reason
to keep navigation off two more. Sol also separated two things this plan had run together: a
`SiteNav` does not bring the glow and the display type with it.

What is left, and what the decision now rests on:

1. **The shell is for selling.** `ContactPage.tsx` and `marketing-pages.md` both say `.site` exists
   to sell to a stranger over a long scroll. Privacy is the page a reader opens to decide whether to
   trust the pitch. `/pricing` joined because it *is* a sales page, and that argument does not
   transfer to a policy page.
2. **The new footer buys most of what joining would.** The real complaint is that those pages look
   unbranded and unfinished at the bottom, and a wordmark plus a colophon fixes that without moving
   them rooms. With `← Home` at the top and the full link row at the foot, a stranger who lands on
   `/privacy` from a search result is not stranded.
3. **It is a change of page family, not a change of appearance**, and nobody asked for it. Greg
   asked for the footer and for the pages' appeal; moving four pages into the marketing shell is the
   kind of decision [vision.md § Simpler first](../project/vision.md#simpler-first) says to hand back
   rather than inherit.

So it stays open, on better evidence than it was closed with. If Greg wants it, the honest cost is
one new `SiteNav` union member per page and a look at whether the three pages already wearing both
bars should keep doing so.

So the dead air is fixed as layout: `main` becomes `tw:flex tw:min-h-dvh tw:flex-col`, a
`tw:flex-1` spacer goes above the footer, and the `tw:pb-24` that was stacking under it goes.
`/login` is the special case — its `tw:justify-center` centred the footer along with the form, so
the form moves into its own `tw:flex-1 tw:justify-center` block, which does both jobs at once.

**Not `tw:mt-auto` on the footer**, which is what this paragraph said in the first draft and what was
built from it. See *The bug this change nearly shipped* below; a sentence prescribing it survived the
fix in two places and was caught by the code review, which is the same class of mistake one layer
up.

## And three things that are not the footer

Found while looking, cheapest first, all subtractions:

1. **`/features` ends twice.** Lines 304–315 draw an orange *← Back to the front page · Ask us
   something* row immediately above a footer that already offers Home and Contact. The second half
   of it is a `mailto:hello@spideryarn.com` — the thing Greg took out of the footer on 2026-09-06
   (*"just keep the Contact page, which already points to that — that's sufficient"*), surviving one
   page over. Delete the row.
2. **The `/pricing` sign-in panel is half-width**, `tw:max-w-2xl` directly under three full-shell
   plan cards. The landing page's equivalent panel is already full width, so removing it is
   consistency rather than a new decision.
3. **The `/pricing` FAQ strands its seventh tile** alone in a two-column grid. `tw:sm:col-span-2` on
   the last one.

## The bug this change nearly shipped, and how it was caught

Worth its own heading because the class recurs and the instrument that found it was not the obvious
one.

The footer was first written with **both `tw:mt-20` and `tw:mt-auto`** on it — the margin for air
above the rule, the `auto` to push it to the floor of a short page. They are the same CSS property.
Tailwind emits `mt-auto` later in the stylesheet regardless of which comes first in the class string,
and `auto` resolves to **zero** wherever there is no free space to absorb. So the intended 80px was
gone on `/`, `/pricing`, `/privacy`, `/changelog` and `/login`, and present on `/contact` alone —
which is the page whose screenshot was checked first and looked perfect.

**No screenshot could have caught it.** Every page rendered, every capture was valid, and a rule
sitting flush against the panel above it reads as a tight design rather than as a defect. It was
found by reading `getComputedStyle(footer).marginTop` back out of the running page —
`marginTop: "0px"`, five times — which is [silent-success.md](../reusable/silent-success.md) pointed
at one's own eyes, the shape
[marketing-pages.md § Screenshotting the pages themselves](../project/marketing-pages.md) already
warns about for these pages specifically. GPT Sol raised the same thing from the source, as its
highest finding, while the fix was being written.

The fix is that **the push belongs to the page, not to the footer**: CSS cannot spell "auto, but at
least 5rem", so the short pages carry a `tw:flex-1` spacer above the footer and the footer keeps a
plain margin. Re-measured afterwards: 80px on all six.

## What I am not doing, and why it is Greg's call

- **A pill *Sign in* in the nav.** Fable's one additive suggestion, and the strongest of them
  visually. Not taken because `SiteBits.tsx` records a *measurement* — the bar's content needs about
  331px at the 320px reflow width, and narrower padding and a smaller gap are what bought the 11px
  back. Adding a bordered pill spends that back. It could be done `sm:`-only; that is a decision
  about a measured constraint, so it is Greg's rather than mine.
- **The changelog's commit hashes**, which are three lines of hex per entry and the ugliest thing on
  any of these pages. They are there because Greg asked for them — *"we'll still include links to
  the commits for curious technical users"* ([changelog.md](../project/changelog.md)) — and they are
  already `text-xs text-ink-faint`, so the fix is not a styling oversight but a question about how
  many to show. Not mine to answer.

## The simpler option passed over

**Just adding `tw:no-underline` and swapping the rule colour** — two attributes, no new markup, and
it fixes items 1 and 2 of the six above. Passed over because it leaves the row still hugging the
left of 1104px of empty rule with nothing closing the page, which is items 3 and 4 and is most of
what makes the footer look unfinished. The two attributes are inside the larger change anyway.

**Grouped Product / Company / Legal columns**, the modern-SaaS default that would suit the 2026-09-03
posture, was Fable's rejected alternative: six links across three columns under three eyebrow
headings is furniture pretending to be a sitemap, and it would have to invent categories the product
does not have.

## What shipped, measured

Same instrument as the "before" numbers at the top — computed styles read out of the running page,
at 1440, 390 and 320, `reducedMotion: "reduce"`.

| | Before | After |
|---|---|---|
| `text-decoration` on a footer link | `underline` | `none` |
| Footer rule | `oklch(0.27 0 0)`, solid grey | `rgb(255 255 255/0.16)` |
| Air above the rule | 80px claimed, 0px on 5 of 6 pages | 80px on all **eight** signed-out routes |
| Empty page below the footer | 510px `/contact`, 306px `/login`, 96px `/privacy` and `/changelog` | 0 on every one of them |
| `scrollWidth − clientWidth` | 0 at all three widths | 0 at all three widths |
| Spacing variants | 2 (`page`, `marketing`), 4 callers passing one | 1 |

Files: `SiteFooter.tsx` (rewritten below the link list), `SiteBits.tsx` (a new `Wordmark`, which
`SiteNav` now uses too), the four callers that dropped `variant`, the four bare pages, and
`Library.tsx`, `ProfilePage.tsx` and `PublicReadableSharingPage.tsx`, each of which had its own
bottom padding stacking under the footer's.

**Eight signed-out routes, not seven**, and the eighth is the one the first sweep missed:
`/features/public-readable-sharing` mounts the footer inside a wrapper `div` rather than at the end
of `<main>`, so a probe that walked `previousElementSibling` returned nothing for it and it was
quietly absent from the "every page" row above. Found by GPT Sol's code review, finding 2; it was
also carrying a `pb-4` of its own, which is now gone. Measured directly, `main`→`footer`: 80px and 0.

`tests/site-footer.test.tsx` needed no change beyond one stale comment: it pins the links, the
dropping and the page inventory, and none of those moved. That is the right outcome for a purely
visual change — but it is also the reason the `mt-auto` bug above could not have gone red, and why
the numbers in this section were taken from a browser rather than from the suite.

**Signed in as well as signed out**, which is the half a signed-out browser cannot reach and the half
this change touches most quietly — `Library` and `ProfilePage` both lost bottom padding they were
stacking under the footer. Driven with [`scripts/browser-sign-in.ts`](../../scripts/browser-sign-in.ts)
against the shelf, `/profile`, and `/privacy`, `/contact`, `/changelog`, `/pricing` and `/features`
as a signed-in reader sees them: `marginTop: 80px`, no underline, no horizontal overflow and no dead
air on all seven.

That sweep also settles GPT Sol's finding 4 by measurement rather than by reading `App.tsx`: counting
`.logo-home, .site-nav` per page gives **two brand bars on signed-in `/pricing` and `/features`**,
one on the policy pages. The duplication the arbitration was originally justified by avoiding is
already shipping.
