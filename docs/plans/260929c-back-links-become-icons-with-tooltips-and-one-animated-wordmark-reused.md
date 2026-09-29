# Back links become icons with tooltips, and one animated wordmark, reused

Two reports from Greg on 2026-09-29, relayed by the Overseer.

> Can you change the back button text labels at the top of some pages (e.g. "<- Back to the
> article" and "<- Library") to icons with tooltips (because there's already so much text on the
> page). If you see other places where this might be helpful, consider modifying them too.
>
> — Greg, 2026-09-29 01:42Z (SPIDERYARN-READING2-50)

> The contact page has all the lovely logo+sitename animations, but the other pages don't. Can we
> please reuse the animated logo+sitename in most other pages (where it makes sense to do so).
>
> — Greg, 2026-09-29 (relayed by the Overseer)

## 1. Back links → an arrow with a tooltip

**One component, `BackLink`** (`src/web/BackLink.tsx`): a `Link` holding only `ArrowLeft`, with
`aria-label` naming where it goes and a `Tooltip` (`placement="bottom"`, `keepSide`, `TipNote`)
saying the same words. It follows tooltips.md: the tooltip is the *description* and the name is the
`aria-label` (§ Five things, 4). `Link` hands over its ref (§ Five things, 5). On touch, `Tooltip`
opens nothing, and a tap follows the link, which is what a back arrow is expected to do. The hit area
grows to 40px under `pointer: coarse`, as the shelf's masthead links already do.

**The card is one sentence, the destination** ("Back to the article"), because on an icon-only
control the destination is the one fact the reader can no longer see. That is a `TipNote`, not a
`ControlTip`: there is no unguessable second half to a back link.

Which ones:

| Where | Today | After |
|---|---|---|
| Reading view masthead (`Masthead.tsx`) | ← Library | arrow, "Back to your library" |
| Tweets page, owner (`Tweets.tsx`) | ← Back to the article | arrow |
| Tweets page, visitor (`PublicPages.tsx` § BackToArticle) | ← Back to the article | arrow |
| `/profile` | ← Back to the shelf | arrow |
| `/contact`, `/privacy`, `/changelog` | ← Home | arrow, "Back to the home page" |
| `/opensource` | ← Back | arrow, same wording as the page's destination |
| `/admin` pages (`AdminPage.tsx` § Shell) | ← Home / its label | arrow, the label as the tooltip |

**Left as words, and why:**

- **The metadata page's "← Back to the article"** — another session is changing that page's
  buttons today. `BackLink` is there for it to take up; the note says so.
- **`/features/public-readable-sharing`'s "← Shared articles"** — it names a *place* a stranger may
  never have seen, not a way back, and an arrow alone would hide where it goes.
- **`/add`'s "← Back to the shelf" at the foot of the page** and **FeatureBoundary's "Back to the
  article"** — the first is the last line of a finished task, the second a recovery action in an
  error message. In both the words are the instruction, and neither sits in a header.

## 2. One animated wordmark, everywhere it fits

**Why the other pages don't animate like `/contact`:** the Contact page draws `HomeLogo`, whose
"Spideryarn" is ten `.logo-letter` spans, so all thirteen animations can run. The marketing top bar
and every footer draw `Wordmark` (SiteBits.tsx), whose words are plain text. Since yesterday's
change it hosts the hook, but with no letters it only offers the six that move the spider. The
shelf's heading is plain text beside `ShelfSpider`, which is the same six.

**The fix is markup, not a second animation.** There is one hook (`useLogoAnimation`) and one
stylesheet (`logo-animations.css`), and both stay as they are. What is duplicated today is the
*letters*: `"Spideryarn".split("")` → `.logo-letter` spans, written out in HomeLogo, DockHome and
DesignPage. That moves to one component, `LogoLetters`, in `src/web/LogoGlyphs.tsx`, beside
`LogoMark` (the `.logo-mark > img.logo-image` pair). Callers keep **their own wrapper**, because the
wrapper is not shared on purpose: `.logo-text` is hidden below 731px and `.dock-btn-label` belongs to
the bar's fit ladder (design-logo.md § The two mount points).

- **HomeLogo** and **DockHome** switch to `LogoLetters` / `LogoMark` with byte-identical output.
  Their wrappers, classes and handlers don't change, so the reading view's bar keeps its behaviour.
  `lettersDrawn` still sees the dock's letters hidden by the ladder and still offers only mark
  animations there. That is the 260915c class of bug, and `tests/logo-animation.test.tsx` already
  pins it.
- **`Wordmark`** draws `LogoLetters` inside a plain span, then " Reading". So the top bar on `/`,
  `/features`, `/pricing`, `/features/public-readable-sharing`, `/read/public`, and every footer, get
  the full thirteen. The letters must be the only children of their wrapper, because the stagger is
  `:nth-child`.
- **The shelf's heading**: the `<h1>` draws `LogoLetters` and the host moves from the spider alone to
  the spider plus the heading, so the homepage has the full set too. It is a small edit to the header
  only; the shelf list is another session's today.
- **DesignPage** keeps its deliberate copy (its header says why) but takes `LogoLetters` for the
  letters, so the gallery and the pages can't drift.

**Pages and what they get:**

| Page | Before | After |
|---|---|---|
| `/contact`, `/privacy`, `/profile`, `/add`, `/changelog`, `/opensource`, 404, `/admin`, article loading/error screens | `HomeLogo`, full set | unchanged |
| Reading view, visitor pages with a Dock | `DockHome`, full set when the word shows | unchanged |
| `/`, `/features`, `/pricing`, `/features/public-readable-sharing`, `/read/public` top bar | spider only | full set |
| Every `SiteFooter` (landing, shelf, profile, pricing, login, …) | spider only | full set |
| The shelf's heading | spider only | full set |
| `/login`'s heading ("Spideryarn", no spider) | none | none: it is a plain heading over a sign-in form, and its footer already animates |

**The screen-reader name doesn't change**: ten adjacent letter spans with no whitespace are read as
one word, as HomeLogo already relies on. The shelf's `<h1>` keeps its text content "Spideryarn".

## Simpler options passed over

- **Drop `HomeLogo` into the other pages as-is.** It is `position: fixed` and always links to the
  library, which is wrong for a bar, a footer or the page that *is* the library.
- **A per-letter animation written for "Reading" too.** That would be a second animation vocabulary.
  The ten-letter index is fixed, so "Reading" stays plain and orange.

## Tests

- `tests/back-link.test.tsx`: `BackLink` has an `aria-label`, holds no visible text, and opens its
  card on a real hover (the tooltip-on-link shape). No page still draws `ArrowLeft` followed by
  words, except the allowlisted ones above.
- `tests/site-wordmark-mark.test.tsx` extended: the top bar, the footer and the shelf heading each
  hold ten `.logo-letter`s inside their animation host, and `lettersDrawn` is true there, so the full
  set is offered.
- The existing logo-animation and dock tests unchanged and green.

## Browser check

Sonnet, Playwright on the box. At 1440 and 390, light and dark: the back arrows (hover card,
aria-label, 40px touch target at phone width); hover animations with letters on the top bar, the
footer and the shelf heading; the reading view's bar at phone width, where the word is hidden, still
animating only the spider; overflow at 320.

## GPT Sol plan review, 2026-09-29, and what changed

Read-only, `--effort high`. It agreed the `LogoLetters` / `LogoMark` extraction is safe for the
reading view's bar: `DockHome` keeps the exact `.dock-btn-label > .logo-letter` DOM, `lettersDrawn`
queries descendants, and the fit ladder still removes their boxes, so the 260915c guard holds. Five
findings, all acted on. **This section overrides the plan above where they disagree.**

1. **The shelf heading is not size-safe** — the one I least wanted to be wrong about. The letter
   animations move by fixed pixels tuned for a 13px word (a 2px pluck, 3px sag, 8px abseil), and the
   heading is `text-3xl`. **So the shelf keeps the spider-only host**, as before, and says why in
   `ShelfSpider`'s header and design-logo.md. The bar (16px) and the footer (14px) are close enough
   to the calibration to take the set. Scaling the stylesheet to its host is the way to give the
   shelf the letters too, and it is a separate piece of work.
2. **"Reading" after the name.** Retype's cursor lives in the empty space after the `n`, which in
   `Wordmark` is one word-gap before the R. **Its cursor is switched off in `.site-wordmark-host`**
   (logo-animations.css); the typing still plays. Dawn masks its whole host, so there it fades "Spideryarn
   Reading" together, and Strain and Dawn turn the (white) letters orange for their run. Both are
   accepted as what those effects do to a whole wordmark, and both are named in design-logo.md.
   The browser check looks at Seam, whose last four letters shift 3px towards the gap.
3. **A card below the link covered the heading** (10px offset, ~35px card, 6–24px to the `<h1>`).
   **`BackLink` opens to the right.**
4. **"Home", not "Back", on `/contact`, `/privacy`, `/changelog`** was a decision of 2026-09-08
   (most arrivals there are sent, so there is no "back"), and an arrow would have undone it. **Those
   four, `/opensource` included, take a house icon with the label "Home".** The masthead's label is
   the owner's library for the owner and "Back to Spideryarn" for a visitor, who may be signed out.
   The name-then-description repeat when focus opens the card is accepted and written into
   `BackLink`'s header: a different card would have to invent a second fact.
5. **The inventory mixed routes and rendered states.** Corrected here rather than above:
   `HomeLogo` draws only signed in (signed out, `/contact`, `/privacy`, `/changelog`, `/opensource`
   and the 404 render bare), and also on `/design`, `/add/upload` and the article's not-shared and
   re-auth screens; `/`'s top bar is the signed-out landing page only.

## Browser check, and the GPT Sol code review

**Browser** (Sonnet, Playwright on the box, 1440 and 390, touch emulated): every back link at the
column's left edge with its `aria-label`, 28×28 on a mouse and 40×40 under touch, and its card to the
right. On the article the card's bottom edge meets the `<h1>`'s top without covering it; elsewhere
there is clear space. The top bar and footer now play letter animations (sag, pluck, type, seam,
register, abseil, `i`) as well as the mark ones. The Retype cursor is gone. The shelf heading has no
letters and still plays spider-only. `DockHome` at 390, with the word hidden, offered only mark
animations to a mouse and to a long press, so the 260915c guard holds. No overflow at 320, 390 or
1440. No console errors. Light and dark are identical (dark-only app). **It found one defect: Seam**
pushed "yarn" 3px into the gap before "Reading" ("Spider_yarnReading"). Now "Reading" moves with it,
re-measured at a constant 3.9px gap, with no resting layout shift.

**Code review** (`workspace-write`): the extraction is DOM-identical for HomeLogo, DockHome and
`/design`; the remaining animations behave in the `Wordmark` hosts; the sweep test is not vacuous;
the labels are true for each reader. One fix, kept: "Reading"'s transition was left active after
Seam ended, so it drifted home 300ms after "yarn" snapped back. It is now scoped to the active class,
with a test. It also corrected two stale comments. The stale `← Home` in website-text.md, which it
left thinking the doc needs approval to edit, is fixed here (that rule covers CLAUDE.md, the entry
points and `docs/reusable/` only).
