/**
 * The wordmark in the very top-left of the window, and the way home.
 *
 * Greg, 2026-08-26:
 *
 * > Get rid of "Home". Instead, add a Spideryarn logo in the very top-left of
 * > the window that takes us Home.
 *
 * Two things in one move, and both are improvements on what they replace. The
 * bottom bar's `Home` button was a word competing for space with eight other
 * words in a bar whose job is *this article*; the way out of a document is not
 * one of the things the document can be. And the app's name had nowhere to
 * live — it was tucked in the drawer header (Dock.tsx), visible only while a
 * panel that is shut nearly all the time was open. The top-left corner is where
 * every site on the web has kept both for twenty years, so it costs the reader
 * nothing to learn.
 *
 * ## Why the corner is free, and what holds it free now
 *
 * The corner was chosen because on the reading view the rectangle from (0,0) to
 * (`--spine-w`, `--bar-h`) is genuinely empty at every scroll position, for a
 * structural reason rather than a lucky one: the spine is `position: fixed`
 * starting at `top: var(--bar-h)`, and the masthead and controls bar are both
 * inset by `left: calc(var(--spine-w) + var(--mode-w))`. Nothing is ever
 * painted there. shell.css § shell.
 *
 * **That argument no longer applies to this component, and the mechanism it
 * described is gone.** Both of those bars are on the reading view, and the
 * reading view stopped drawing this component on 2026-09-06 (see below). What
 * holds the corner clear on the pages that *do* still draw it is much simpler:
 * they have no sticky bars at all, so there is nothing for a fixed corner to
 * land on top of.
 *
 * **Their top spacing is each page's own business and there is no shared
 * number**, which is worth saying because an earlier draft of this paragraph
 * claimed one. `ProfilePage`, `PrivacyPage` and `ContactPage` happen to start
 * their `<main>` at `calc(3.5rem + var(--safe-top))`; the component's other
 * callers each lay themselves out differently. The 3.5rem is also not
 * `2.5rem + --bar-h` —
 * `--bar-h` is 2.75rem, and the extra over the ordinary 2.5 is 1rem. It is a
 * page's chosen clearance, not a derived quantity. GPT Sol, T3.
 *
 * The history is worth keeping, because it is why this is a corner rather than
 * a row. `--spine-w` was not a constant: layout.ts dropped the spine in outline
 * mode and whenever the reader hid the prose (`?text=0`, at any width), and
 * `?spine=0` is the reader's own hand on the rail (docs/project/url-state.md).
 * At `--spine-w: 0` the corner belonged to the two bars again, so both of them
 * reserved it, with one expression written twice:
 *
 *     padding-left: max(1.5rem, calc(var(--logo-w) + 1.5rem - var(--spine-w) - var(--mode-w)))
 *
 * — the logo's reach into a bar positioned at `--spine-w + --mode-w`, plus the
 * ordinary gutter, floored so that a mode band's own width made the case cost
 * nothing. It worked, and it cost 148px of left gutter and 144px of right on
 * every reading view whether or not the reader had hidden anything. Both terms
 * came out with this component, stage 2 of
 * docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md,
 * and **`--logo-w` is now the width of this button and nothing else**
 * (src/web/styles/tokens.css § tokens). If a corner control is ever put back on a page with a
 * sticky bar, this is the mechanism to put back with it.
 *
 * ## Where it is not rendered
 *
 * The library, because that *is* home — a link to the page you are on is a
 * dead control, and the shelf already names the app in its `<h1>`. App.tsx
 * makes that choice, so this component never has to know which route it is on.
 * The shelf draws the spider beside that heading itself (Library.tsx, from
 * 2026-09-08): it wanted the glyph, which is decoration, and not the link.
 *
 * **And, since 2026-09-06, none of the pages that mount a `Dock`.** The
 * article, its metadata page (and tweets page until 2026-09-29), and the three visitor stand-ins in
 * PublicPages.tsx draw `DockHome` in the bottom bar instead — same glyph, same
 * word, same colour, different corner. Greg's call: the reading view is the one
 * page whose whole job is a column of prose, and the only one where a permanent
 * strip of chrome sits between the reader and it. The cost he accepted with it
 * is that the way home *moves* as you navigate, from the top-left corner of the
 * shelf to the bottom-left of an article.
 * docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md.
 *
 * **The pages that keep this component** are the shelf-adjacent ones (`/add`,
 * `/profile`, `/contact`, `/privacy`, the 404 and the admin pages). `ArticlePage`
 * also keeps it on its error page and delegates it to its no-`Dock` stand-ins:
 * `OwnerNotShared`, `StillBeingAddedVisitor`, `ReauthRequiredPage` and
 * `UnreadPaperPage`. Loading dropped it on 2026-10-09, because its spinner is
 * the wordmark (plan 261009b). None of them has a masthead or a controls bar;
 * that is why the paragraph above had to be rewritten rather than merely
 * narrowed. `ArticlePage`'s final branch is where it stopped being drawn.
 *
 * **Nor, since 2026-09-29, the four pages that draw the marketing top bar**
 * (`SiteNav`) signed in — `/features`, `/features/public-readable-sharing`,
 * `/pricing` and `/read/public`. That bar's wordmark gained the spider and its
 * own animation host that day, and this fixed copy sat on top of it: two
 * branded home controls and two spiders in one corner. The bar owns that
 * control there.
 * tests/dock-corner-controls.test.tsx mounts all four routes and pins it from
 * the rendered page rather than from App.tsx's source shape.
 *
 * ## The hover animations
 *
 * The class names are the original app's, which is what made 2026-09-07 cheap:
 * `useLogoAnimation` puts one more class on this link and
 * src/web/styles/logo-animations.css keys its keyframes off `.logo-letter` and
 * `.logo-image`, both of which are already here. `DockHome` spreads the same
 * hook, so the two copies of the wordmark cannot drift into two behaviours.
 * docs/project/design-logo.md.
 */
import { cn } from "@/lib/utils";

import { Link } from "./Link.js";
import { LogoLetters, LogoMark } from "./LogoGlyphs.js";
import { libraryHomeTitle } from "./library-home-title.js";
import { useLogoAnimation } from "./logo-animation.js";
import { LIBRARY_HREF } from "./router.js";

/**
 * **What the tooltip says, and why it is not a version number.**
 *
 * Greg asked for one here, 2026-09-07. `buildDescription` is where the answer
 * to that is written out — the short version is that the running build cannot
 * honestly know its own release number, and its sha is the fact it does know.
 * So the tooltip carries the destination first, which is what a tooltip on a
 * link is for, and the build second.
 *
 * **The destination survives when the build is unknown**, which is every test
 * and every `npm run dev`: a tooltip is not the place to say *"unknown"*.
 */
export function HomeLogo() {
  const anim = useLogoAnimation();
  return (
    <Link
      href={LIBRARY_HREF}
      className={cn("logo", "logo-home", anim.className)}
      /* Two lines rather than an em dash chain: the second is for the one
         reader in a hundred who wants to know which copy they have, and it
         should not push the sentence that matters onto a second line by
         itself. `title` renders a newline as a newline.

         **The tooltip and the hover animation both live on this element, and
         they met at a merge.** They do not interact — one is an attribute the
         browser reads, the other a class and a set of pointer handlers — but
         both are about what happens when a reader points at the wordmark, so if
         one of them ever has to give way it should be a decision rather than a
         collision. docs/project/design-logo.md is the animation's. */
      title={libraryHomeTitle()}
      {...anim.handlers}
    >
      {/* `alt=""` and not "Spideryarn": the wordmark beside it already says the
          name, and a screen reader reading it twice is how a decorative image
          becomes noise. The link's own text is the accessible name. */}
      <LogoMark />
      {/* `.logo-text` is this copy's own wrapper — it is what the 731px query
          hides — and the letters inside it are the shared ones
          (LogoGlyphs.tsx). */}
      <span className="logo-text">
        <LogoLetters />
      </span>
    </Link>
  );
}
