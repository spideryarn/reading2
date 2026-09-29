# The spider beside the wordmark, Beta to the right, and no tagline on the shelf

Two reports from Greg on 2026-09-29, production build `cba650a3`. Notes:
[4W](../user-feedback/260929_0240-no-tagline-on-the-shelf.md) and
[4X](../user-feedback/260929_0240-spider-beside-the-wordmark-and-beta-on-the-right.md).

> On logged-in Homepage, I'm not sure I like the tagline:
> - Perhaps get rid of "Pick a piece" from the tagline? In fact, let's change "Read deeply, at
>   whatever level of detail you need. Pick a piece." to "Read deeply & efficiently". Or maybe
>   actually just remove the tagline from the logged-in Homepage.
>
> — Greg, 2026-09-29 (SPIDERYARN-READING2-4W)

> On the logged-out landing page, include the Spideryarn logo next to "Spideryarn Reading" (in the
> top left, and bottom-left). And same for logged-in footer.
> And move the "Beta" to the right-hand-side of the Header (just before "Features") so it's a bit
> less prominent.
>
> — Greg, 2026-09-29 (SPIDERYARN-READING2-4X)

## What changes

**1. The shelf's tagline goes** (`Library.tsx`, the `<p>` under the header). His last thought was
removal, so that is what we do, unless the header looks wrong without it — in which case the fallback
is his other wording, "Read deeply & efficiently". An assumption he can overturn in one line. The
sign-in page's similar sentence ("…Sign in to get to your shelf.") is not the shelf and is left.

**2. The spider joins the wordmark, in one place.** `Wordmark` in `SiteBits.tsx` is the only thing
that draws "Spideryarn Reading", and both the marketing top bar (`SiteNav`) and every footer
(`SiteFooter`, which the signed-in shelf, `/profile` and the rest also mount) use it. So the spider
goes *inside* `Wordmark` — one edit reaches the landing page's top-left, its bottom-left, and the
signed-in footer, and nothing can carry the words without the mark. The component's header said
"no logo mark" on purpose; Greg's report is what changes that, and the comment says so.

The markup is the same `.logo-mark > img.logo-image` the other three copies use (HomeLogo, DockHome,
ShelfSpider), because that is what `styles/logo-animations.css` keys off.

**Animations: on, and one host per copy.** Greg, 2026-09-12: they should play *"wherever the logo is
present"*. `Wordmark` stays non-interactive; the caller owns the hook, as the file already says the
caller owns the link:

- **Top bar**: `useLogoAnimation()` spread on the existing home `Link`, as `HomeLogo` does — hover
  plays, a long press plays without navigating, a tap goes home.
- **Footer**: a non-link span around `Wordmark` with `useLogoAnimation({ tap: true })`, as
  `ShelfSpider` does — nothing else happens on a tap there, so a tap may ask for one.

Only the mark-only animations can play, since `Wordmark` has no `.logo-letter` spans; that is the
behaviour `ShelfSpider` already has and is deliberate (logo-animation.ts § pickLogoAnimation).

**Not doubled**: each copy has exactly one hook. A signed-in `/features` or `/pricing` already draws
the fixed corner `HomeLogo` *and* the top bar; that pairing predates this, and the browser check
looks at it.

**3. Beta moves right**: out of the home link, to the first item of the right-hand cluster, so it
sits just before Features on the landing page (just before Home on the pages whose first link is
Home). Same pill, same `hidden sm:inline` — at phone width there is no Beta at all, as today.

## Simpler options passed over

- **Spider in the callers rather than in `Wordmark`** — three edits and a way to draw the words
  without the mark. Rejected: the component exists to stop exactly that drift.
- **Lift `ShelfSpider` out of Library.tsx into a shared component** — tidier, but the shelf file is
  being edited by another session today, and the footer does not want a spider-only host anyway.
- **Mount `HomeLogo` in the nav** — it is `position: fixed` and links to the library, neither of
  which the bar wants.

## Risk

Phone width: the left of the bar gains ~26px. `SiteNav`'s comment records the 320px reflow budget as
already tight (~331px of content before its padding was trimmed). Measure `scrollWidth -
clientWidth` at 320 and 390 (narrow-windows.md); if it overflows, shrink the gap or the mark below
`sm` rather than hiding it.

## Tests

`tests/site-wordmark-mark.test.tsx`, written red first: the top bar's home link contains the logo
image; Beta is not inside the home link and sits in the right-hand cluster; the footer contains the
logo image and the animation host; the shelf no longer renders "Pick a piece".

## Bookkeeping

Browser check (Sonnet subagent, Playwright on the box): landing and signed-in shelf, 1440 and 390,
light and dark, plus 320 for overflow. Two notes under `docs/user-feedback/`, ending *Shipped*.

## GPT Sol plan review, 2026-09-29

Read-only, `--effort high`. The plumbing held: with no `.logo-letter` the six `reach: "mark"`
animations are the ones offered, none needs a `.logo` ancestor, and `Link` forwards pointer handlers
and still navigates. Four findings, all taken:

1. **Two spiders on four signed-in pages** — the one I would least have wanted to be wrong about,
   and the plan named two of the four as a thing to "look at". `App.tsx` mounted the fixed corner
   `HomeLogo` (z-index 60) over pages whose own `SiteNav` (z-index 40) now carries the spider:
   `/features`, `/features/public-readable-sharing`, `/pricing`, `/read/public`. **Fixed by removing
   `HomeLogo` from those four** — the bar is already the way home there — and pinned by a source
   check in the new test, seen red against the pre-change `App.tsx` (four offenders).
2. **320px overflow predicted at 1–2px**, from the bar's own recorded budget. Measured in the
   browser check rather than argued; § Phone width below.
3. **`size-[1.25em]` squashed a non-square PNG.** Now `w-[1.25em] h-auto`.
4. **The test had no shelf-tagline assertion.** Left out on purpose: mounting `Library` for one
   removed `<p>` costs a database-shaped fixture, and the browser check looks at it directly.

## Phone width, measured

Browser check, Playwright on the box, after every change above: `scrollWidth - clientWidth` is **0**
on the document, on `nav.site-nav` and on the `footer`, at 320 and 390, on signed-out `/`,
`/features` and `/pricing`. The bar stays one 56px row. So Sol's predicted 1–2px did not happen, and
no below-`sm` reduction was needed. Signed in at `/features`: one spider in the top-left at 1440 and
390 (20×21, not squashed). Hover puts `spya-anim spya-<id>` on exactly one host at a time. Light and
dark are identical (the app is dark-only).

**Not ours, seen in passing:** signed in at 390 on `/features`, the fixed top-right Feedback trigger
sits over the bar's `Home` link. Neither element changed here — the corner trigger and the bar's
right-hand link were both there before — so it is left for its own report rather than fixed inside
this one.

## GPT Sol code review, 2026-09-29

`--sandbox workspace-write`, fixing inside the stage. Three fixes, all read and kept:

- **The corner logo's tooltip went with it** — *"Spideryarn — back to the library"* plus the build
  stamp Greg asked for on 2026-09-07. It now lives in `library-home-title.ts`, shared by `HomeLogo`
  and, signed in only, the bar's wordmark. Signed out the bar has no title, since there is no
  library behind it.
- **My App.tsx source regex was the weaker check** — it read JSX co-location, not what renders, and
  missed `/features/public-readable-sharing` in the route walk. Replaced by rendering all four routes
  signed in and signed out, plus `/profile` signed out, which falls back to the landing page, in
  `tests/dock-corner-controls.test.tsx`.
- Stale comments in `App.tsx`, `PricingPage.tsx`, `HomeLogo.tsx` and `web-client.md`.

**Left, and not ours:** on pages that are not `/`, the bar carries both the wordmark link and a text
*Home* link, so "one way home" is true of the *branded* control only. That predates this change and
is a navigation decision rather than a bug, so the tests now say "branded home control".
