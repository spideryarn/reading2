# Bring the signed-out home page, /features and /design up to date

Two admin requests, batched as Overseer queue item `qi-gmgjenh5`:

> Update the non-logged-in homepage and Features pages
>
> — Greg, 2026-10-01, SPIDERYARN-READING2-86 (report spya-mbyuf6)

> Update /design
>
> — Greg, 2026-10-01, SPIDERYARN-READING2-89 (report spya-zadvdv)

Both pages were last rewritten on 2026-09-03. Since then about eight modes have shipped, two have
been retired, and several have gone behind the Experimental switch. Two read-only audits on
2026-10-02, checked against the code rather than the docs, found what follows.

## What is wrong now

### `/` and `/features` (`LandingPage.tsx`, `FeaturesPage.tsx`, `shots.ts`)

1. **A false privacy claim, and the worst item on the list.** `/features` § The library says a public
   article's *"own comments, chats and searches stay yours"*, and the landing tile says *"Your own
   notes stay yours."* The privacy policy (`PrivacyPage.tsx`, the paragraph about making an article
   public) says the opposite: a stranger reading a public article *"also get[s] your comments and
   your searches"*, and only chats and the profile stay private. The privacy page is right:
   `src/public/dto.ts` builds `comments: publicComments(…)` and `searches: publicSearches(…)` into
   every public article. The two marketing sentences are left over from before comments were
   shared. (The header comment of `src/web/shared-inventory.ts` still lists "the owner's comments and
   notes" among what is withheld. It is a stale comment, not a behaviour, and is outside this plan;
   it is flagged to Greg in the note.)
2. **The lead picture is of a mode that no longer exists.** The hero and `/features` § Orient both
   show `outline.png`, captioned *Outline*. Outline became Structure's narrow face on 2026-09-10, and
   Hierarchy, whose gist columns the shot also echoes, was retired on 2026-09-29.
3. **Experimental modes are presented as if every reader has them.** `MODE_CATALOG` marks Referee,
   Diagram, Remember (with Quiz), Timeline, Debate, Citations, FAQ and Marginalia `experimental: true`.
   Only the Diagram caption on `/features` says so. The landing tiles for Remember, Timeline, Diagrams
   and peer reviewers say nothing.
4. **Missing modes.** Structure, Skim and Tweets are main modes that every reader has, and none of
   them appears. Debate, Citations, FAQ and Marginalia are missing too. So are three things that are
   not modes: cross-references, the reading-time marks on the spine, and maths rendered from TeX.
5. **Smaller facts.** *"a dozen at a time"* for Quiz: `MAX_QUESTIONS` is 20 since 2026-09-30. *"the
   outline, gists, glossary…"* as what a public article shares: gists went from Summary on 2026-10-01,
   and the list should follow the privacy page.
6. **Pictures.** All twelve are from 2026-09-03, so the band chrome in every one is older than the
   (i), the herald and the regrouped bar. Most still show the right *content*; `outline.png` does not.

### `/design` (`DesignPage.tsx`)

There is no rule saying what must appear on it. The overview calls it *"every token, face, weight,
button variant, toggle state and icon size on one page"*, and its header says to render the real
thing, never a description of it.

1. **Wrong text on the page now:**
   - *Marks in the prose* begins *"The four things that can be drawn over the author's words"* and
     does not mention citations, which have their own specimens just below.
   - *Icons* says *"`LoaderCircle`, not `LoaderCircle`"*, a typo for the icon it rejected.
   - Two notes cite *"design-css-overview.md § Controls"*. No such section exists; it is
     `controls.md § The numbers`.
   - *Toggles* calls `PILL` *"the granularity pills"*, from a feature that is gone.
2. **Missing, and used on every article:**
   - the `Tooltip` (the one component whose whole look is ours);
   - the band's (i) (`BandAbout`, shipped 2026-10-01 on every mode);
   - the cross-reference mark (`mark.xref`, 2026-09-30).

## What we will do — simplest version first

### Stage 1 — make every sentence on `/` and `/features` true, and make the next drift a red test

**Copy rule, unchanged** ([positioning.md § Whose words](../project/positioning.md#whose-words)):
every new sentence is Greg's dated words (rephrased to the reader, as the existing captions are), a
product fact checked against the code, or a short `[tissue]` line. No marketing sentence is drafted
from nothing. The source comment goes beside each one, as now.

- **Fix the privacy contradiction** on both pages so it says what `PrivacyPage.tsx` says: comments
  and searches go with a public article; chats and the profile do not.
- **The experimental marker comes from the code, not from the caption.** `Tile`, `Portrait` and
  `Showcase` in `SiteBits.tsx` take an optional `mode`. When it is given, the component draws a small
  *Experimental* tag if, and only if, `MODE_CATALOG[mode].experimental` is true. One `[tissue]`
  sentence, placed once near the top of `/features`, says what that means: *signed-in readers turn
  these on from the bar or their profile*. That sentence is lifted from the Diagram caption, whose
  own copy then goes.
  - **Simpler option passed over:** typing "(experimental)" into each caption. It goes stale the
    first time a mode leaves the switch, which has already happened three times (Structure, Skim,
    Tweets).
- **Structure replaces Outline** in `/features` § Orient. Its caption comes from Greg's Structure
  quotes (2026-09-08 and 2026-10-01: the parts and their sections, Fisheye by default, Expanded
  showing everything). The landing tile list gains Structure.
- **Add the missing modes to `/features`** as `Tile`s in the group each belongs to:
  - Orient: Structure and Skim;
  - Annotate: Citations and Marginalia;
  - Interrogate: FAQ and Debate;
  - a short *Elsewhere* row, after the shelf group, for Tweets, plus cross-references and maths
    (both for everyone). **Reading time is left out**: it is gated on `experimental.on` in
    `ArticlePage.tsx`, and it is not a mode, so the tag cannot mark it. Sol, plan review #1.

  Each tile carries the mode's `mode` prop and a sentence from Greg's request for it, rephrased to
  the reader, with the source in a comment. FAQ's caption comes from Greg's own words in
  `faq.md` (questions rated for how difficult and how central, in a prioritised order). It does not
  use `MODE_CATALOG.description`, which was agent-written and is not a product fact. Sol, plan review
  #5.
- **Landing:**
  - fix the privacy tile and add `mode` to its existing tiles, so the experimental ones are tagged;
  - swap the Diagrams tile for Structure and add Skim. Greg, 2026-09-29: *"I'm increasingly thinking
    of the trajectory mode as one of the main modes"*;
  - Quiz goes from a dozen to twenty.
  - **No other new tiles.** The landing page is the pitch, and `/features` is where the whole list
    belongs.
- **Tests, written first and seen red:**
  - `tests/features-page-modes.test.tsx` renders `/features` and asserts that every `Mode` in
    `MODES` is named by some tile's `mode`, and that the Experimental tag appears exactly on the modes
    `MODE_CATALOG` marks. It is red today: Structure, Skim, Tweets, Debate, Citations, FAQ and
    Marginalia are missing.
    It works from an explicit visible-title → mode map: the badge is checked on each rendered
    occurrence, and duplicates are removed only for the coverage check (Sol #8).
  - A landing test asserts that Structure and Skim tiles exist (red today), and that the number word
    in *"N more ways in"* equals the tiles under it. The count half alone would be green today, so it
    is a regression guard, not a red-first test (Sol #7).
  - A test asserts that both pages name comments and searches as going with a public article, **and**
    that neither still carries *"stay yours"* about comments or searches (Sol #8).

### Stage 2 — a true lead picture, and one new one

- **Retake the hero as Structure** (`structure.png`, 2160×1350). It is drawn on the landing hero and
  in `/features` § Orient, follows [marketing-pages.md](../project/marketing-pages.md)'s one-shot
  rule, and is taken on an article other than the Feynman and Seth pieces. `outline.png` is deleted.
- **Add a Skim shot** (landscape) for `/features` § Orient, because Greg calls it a main mode.
- `shots.ts` sizes and alt text are updated, and `tests/landing-assets.test.ts` stays green.
- **Retake every landscape shot, because each one is false, not just dated** (Sol #2, checked by
  eye). Their mode bar shows *Hierarchy* and *Outline*, and `search-meaning.png` carries a `toc/3`
  debug pill. The set is `glossary-card`, `search-meaning`, `ask-in-place`, `referee-criteria` and
  `library`. **`diagram.png` is retaken as Sketch**: it shows four diagram tabs where the code has
  five, and it prints a model id.
- **Kept:** the band-only portraits (`ideas`, `quotes`, `remember`, `quiz`, `search-meaning-panel`)
  show no bar, and their content is still true.
- **Deferred, named:** new shots of Tweets, Citations, FAQ, Debate and Marginalia, since tiles carry
  those for now; and retaking the kept portraits for newer chrome.

### Stage 3 — `/design`

- Fix the four wrong pieces of text above.
- Add specimens, each rendered by the real component:
  - a `Tooltip` under *Icons*;
  - the band's (i), by rendering one specimen band through `ModeSurface`, which supplies `has-about`
    and its padding. A bare `BandAbout` would not (Sol #6);
  - `cmt`, `chat` and `xref` marks, so that *Marks in the prose* covers every `MarkKind` in
    `annotate.ts`. They go through the existing `SPECIMEN_MARKS` / `SPECIMEN_OUT` and their drift
    test in `tests/annotate.test.ts`, never by importing `annotateHtml` into the lazy page (Sol #4,
    #6);
  - the two switches readers do see — High-powered AI and Experimental — under *Toggles*, since the
    overview promises every toggle state (Sol #3).
- **Deferred, named:**
  - a Controls section (the 28/32/36 heights, sliders, segmented switches);
  - the dock buttons;
  - hover cards, score bars and toasts;
  - the reading-time and Marginalia specimens;
  - voices applied to a passage under *Faces*.

  The audit ranked these, and each is a section of its own. The page is admin-only, so Greg is its
  only reader, and he can say which he wants next.

## Docs that move with it

- [website-text.md § The features page](../project/website-text.md#the-features-page) and
  § The landing page: the experimental tag, the new tiles, and the privacy contradiction fixed.
- [marketing-pages.md § The pieces](../project/marketing-pages.md#the-pieces): `SiteBits` reads
  `MODE_CATALOG`.
- The `shots.ts` header: what was retaken, and when.

## Not in scope

Rewriting any existing sentence for voice; the strapline; the ten unanswered interview questions;
`/pricing`.

## Log

- 2026-10-02 — audits done; plan written.
- 2026-10-02 — GPT Sol plan review ([261002b-homepage-plan-review-sol.md](261002b-homepage-plan-review-sol.md)): no P0,
  four P1, four P2. All accepted; #2 was checked by looking at `search-meaning.png`, whose bar shows
  Hierarchy and Outline. The changes are marked *Sol #n* above.
- 2026-10-02: stages 1 and 3 built in parallel, with tests red first; stage 2's shots were taken,
  and every one was looked at before it went in. Referee and ask were retaken once: a title image
  in frame, a half-cut sentence, and a panel covering the prose.
- 2026-10-02: browser check of `/` and `/features` at 1440 and 390, and of `/design` at 1440: all
  pass. No console errors, and /design sent no writes. One cosmetic nit is left: in a three-up row,
  an untagged tile's title sits about 27px above its tagged neighbours.
- 2026-10-02: GPT Sol code review ([261002b-homepage-code-review-sol.md](261002b-homepage-code-review-sol.md)) found
  no P0, one P1 and two P2s, and fixed them in place:
  - the P1: the Tweets tile promised more than the code does;
  - the two P2s: the experimental-tag and privacy tests are now directional, and found by visible
    title.

  Its Tweets wording was then made plainer, keeping its correction.
