# A Help page: contents, search, anchors, in the footer, kept current on every deploy

Feedback SPIDERYARN-READING2-85 (`spya-p2hamn`), from Greg (admin), 2026-10-01, Overseer queue item
`qi-6fkmwvvc`:

> Provide a Help or FAQ page for users that want to understand all of Spideryarn's features. Make
> sure it has a nice table of contents and search bar, and lots of anchor links (so we can link
> directly to places). And include it in footer.
>
> Add a docs/projects/ .md for it, and add a process step when deploying (after Changelog) to make
> sure this Help page has been updated accordingly. And signpost to that doc from new-mode.md ,
> engineering-manager.md , etc.
>
> In the Help page, emphasise the kinds of things that users might not be able to figure out for
> themselves, help them build intuitions, focus on what's valuable, e.g. how should I interpret the
> visuals in the Spine?
>
> While we're at it, perhaps add more (i) icons (with tooltips), and they can link to the relevant
> place in Help.
>
> And anything else you think will help the user, and ensure that we keep this up to date.

The Overseer's lead: *simplest first: one static page, built from content in the repo, no model at
runtime*; and the Commands session (fb8d, queued next) may want to search this page, so anchors must
be stable.

## What there is today

- **`/features`** (FeaturesPage.tsx) is the pitch, mode by mode with screenshots, for somebody
  deciding whether to sign up. It says what each thing *is*, not how to read it. Help is the page for
  somebody already reading; the two link to each other and do not overlap much.
- **Every band has an (i)** (BandAbout.tsx), whose card is the mode's two `MODE_CATALOG` sentences.
  Cards are `pointer-events: none` (tooltip.css), so nothing inside one can be clicked.
- **The spine** (Spine.tsx, spine-marks.ts) draws seven kinds of mark — parts, the part you are in,
  section ticks, reading-time heat (owner, experimental), the jumped-from mark, the coloured match
  lanes, the viewport window — and nothing on screen says what any of them means except a hover
  card per part. This is Greg's example, and the strongest case for the page.
- **`PageContents` + `page-search.ts`** (Metadata) already do a contents list with a search box,
  synonyms, stems, prefix match and reveal-and-flash. The synonym table is Metadata's own words.
- **Shortcuts** live only in docs/project/keyboard.md and in tooltip prose. There is no `?` overlay.
- The **mode list** is `MODES` in src/modes.ts (18), with its words in `MODE_CATALOG`.

## The design

### One static page, its words in TSX, typed anchors

`/help`, reachable signed in and signed out (like `/privacy` and `/changelog`: a page somebody is
*sent* to), lazily loaded (it is long), drawn in the plain-prose style of Privacy/Changelog rather
than the marketing shell — it is a page to read, not a pitch. `SiteFooter` gets the link.

The words are in `src/web/help/`, as TSX, not Markdown — there is no Markdown renderer in the client
and adding one for a page we write ourselves is a dependency for nothing:

- `help-sections.tsx` — the general sections, as `Record<HelpTopic, HelpSection>` keyed by a const
  list of ids, plus an ordered list of groups that says the page order.
- `help-modes.tsx` — **`Record<Mode, HelpSection>`**, one section per mode. Adding a mode to `MODES`
  without a Help section is then a type error: the compiler is the "keep it up to date" check for the
  commonest change, and mode.md's *Before you call it finished* table gains that row for free.
- `help-anchors.ts` — `type HelpAnchor = HelpTopic | \`mode-${Mode}\``, and
  `helpHref(anchor: HelpAnchor): string`. Every link into Help in the code goes through it, so a
  link to a section that does not exist does not compile.

A `HelpSection` is `{ title, keywords, body: ReactNode }`. Anchors are the ids, which are kebab-case,
short, and **never renamed** once shipped (the help-page doc says so, and a test pins the list's
current members so a rename is a visible diff of the test, not a silent 404 for every old link).

**Considered and passed over:** a Markdown file under docs/ rendered at build time (needs a renderer
and a build step; no type link from code to anchor); a generated page from the feature docs (those
are written for agents, not readers); a model at runtime (the brief says no).

### Contents, search, anchors

- **Reuse `PageContents`** for the contents list and search box, the Metadata machinery, with two
  small generalisations: `searchSections` and `PageContents` take an optional synonym table (Help
  passes its own; Metadata's stays the default and its tests keep passing), and an opt-in
  `fragmentLinks` mode in which a contents row is an ordinary `<a href="#id">` whose click still
  reveals and flashes but lets the browser update the address — the Changelog lesson (GPT Sol, 260930:
  a prevented click loses reload, Back and Cmd-click). If bending `PageContents` turns out to need
  more than that, write the Help page's own list and say why, as ChangelogPage.tsx did.
- **Search reads titles and keywords**, not body text, as on Metadata (page-search.ts says why).
  Each section's `keywords` are written for the words a reader brings ("heat", "thick line",
  "coloured marks", "phone", "price"). Body text is reachable by the browser's own find.
- **Every heading carries a `#` link** to itself (visible on hover/focus, always on touch), so
  anyone can copy a link to a place — "lots of anchor links".
- **Arriving at `/help#spine`** scrolls to and flashes that section once the lazy page has mounted
  (the browser's own fragment scroll fires before the content exists).
- **Groups** give the contents list its shape: Start here · Reading an article · The modes · Your
  shelf and your account · Questions people ask.

### What the page says

The test of every paragraph: *would a reader work this out alone in their first week?* If yes, cut
it. The emphasis Greg asked for is intuitions — what a mark means, when a mode is worth opening,
what the AI did and did not do. Plain words, second person, short sections, one picture-free page.

Sections (ids in brackets):

- **Start here**: what Spideryarn is for — reading more deeply, not a summary in place of the piece
  (`what-it-is-for`); adding an article — a link, a PDF, what can go wrong and what to do
  (`adding-articles`); the reading view's three parts — spine, prose, band (`the-reading-view`).
- **Reading an article**: how to read the spine, mark by mark (`spine`); jumping and getting back
  (`jumping-around`); the gutter beside each paragraph — ask, comment, bookmark (`gutter`); links to
  a passage you can send (`linking-to-a-passage`); keyboard shortcuts, from keyboard.md
  (`keyboard`); phones and tablets (`touch`); the AI's words, and how to tell them from the
  author's (`ai-words`); waiting for a mode, and what it costs (`waiting-and-cost`).
- **The modes**: a short "which mode when" table (`modes`), then one section per mode
  (`mode-<id>`, from `Record<Mode, …>`), each saying what it is for, when it earns its place, and
  the one thing about reading it that is not obvious.
- **Your shelf and your account**: the shelf and its topics (`shelf`); sharing and the public shelf
  (`sharing`); comments and notes (`comments`); reader profile (`reader-profile`); experimental
  features (`experimental-features`); plans and the free allowance (`plans`); your data, export,
  privacy (`your-data`); telling us something — the Feedback button (`feedback`).
- **Questions people ask**: a handful of FAQ entries drawn from docs/user-feedback/ — the things
  readers have actually been confused by (`faq-…` ids).

Every product fact is checked against the code, not the feature doc alone; a fact the writer could
not confirm is left out rather than guessed.

### More (i) icons, linking into Help

The constraint: a card cannot contain a link (pointer-events), and making hover cards interactive is
an open accessibility question (open-questions.md Q10). So **the (i) is itself the link**, or a
link sits beside the thing it explains. A new `HelpLink` component: Lucide `Info` (not
`CircleHelp`, which the gutter uses, nor FAQ's or Quiz's question marks), a `Link` to
`helpHref(anchor)`, and a `ControlTip` card saying what Help will tell you there. v1 places:

1. **The spine** — one `HelpLink` to `#spine`, where it fits without crowding (top or foot of the
   rail; the implementer measures, desktop and 390px).
2. **Every band** — one change in `ModeSurface`'s corner beside the existing (i): a small "Help"
   link to `#mode-<id>`. Alternative if two icons crowd the corner: the band's card stays as is and
   its last line names the Help section, with the link reachable from the command bar. Decided in
   stage 2 by looking at it.
3. **A "Help" row in the command bar** (CommandBar.tsx, `kind: "page"`), reached by *help*, *faq*,
   *how do I*; Feedback keeps its own row, ranked second for *help*.
4. **Help in the reader's menus** wherever Changelog/Privacy already sit in the signed-in chrome.

Deferred: an (i) on every chip and control (tooltips.md already gives them cards); interactive cards
with links inside (Q10).

### Keeping it current

1. **The compiler**, for modes (`Record<Mode, …>`), and for every link into Help (`HelpAnchor`).
2. **A test** that every anchor is unique, every group lists only real topics, and the anchor list
   is the pinned set (a rename shows up as a changed test).
3. **A deploy step**, after the release notes: overseer.md § Deploying gets a step between
   *Write the release notes first* and `npm run deploy` — read the notes just written; for each
   entry that changes what a reader sees or can do, check Help covers it, and update
   `src/web/help/` if not (a small commit to dev, then deploy as usual). It is a step, not a gate:
   the deploy does not refuse without it. changelog.md § Running it points at it.
4. **Signposts**: docs/project/help-page.md (new, owned by reading-view-overview.md) says what the
   page is for, the anchor rule, the voice, and how to update it; mode.md's checklist,
   engineering-manager.md § Along the way, and CLAUDE.md's line under reading-view-overview point at
   it. Greg named new-mode.md, which does not exist; mode.md is the mode checklist.

## Stages

1. **The page.** Route (router.ts, App.tsx both branches, page-title.ts, ADMIN_ONLY), the lazy
   page, footer link and its tests, `src/web/help/` with all sections written, `PageContents`/
   `page-search` generalisations, fragment arrival, heading `#` links, the tests above. Content is
   drafted by Opus subagents in parallel by group, each from the feature docs **and** the code, then
   edited into one voice. Browser check, desktop and 390px. Sol code review.
2. **The ways in.** `HelpLink`, the spine and band placements, the command-bar row, the menu entry,
   their tests. Browser check. Sol code review.
3. **Keeping it current.** help-page.md, the deploy step, the signposts, the user-feedback note,
   feedback-endings, queue done.

## Done looks like

`/help` opens signed in and out, with a contents list and a search box that finds "heat" → the spine
section; `/help#mode-skim` lands on and flashes Skim; the footer, the command bar, the spine and every
band reach it; adding a mode without a Help section fails typecheck; the deploy runbook has the step.

## After GPT Sol's plan review (2026-10-02) — this section overrides the design above

Review: [261002b-help-page-plan-review-sol.md](261002b-help-page-plan-review-sol.md). All eight
findings accepted; each was checked against the code.

- **R1 — not `PageContents`.** It is a flat DOM-scanned list, sized for Metadata's margin, and
  hidden entirely below `lg` (search box included). Help gets its own small `HelpContents`, drawn
  from the typed group list: grouped, sticky in a left column at `lg`, in-flow and collapsible above
  the content on narrow screens, search box always visible. Only `searchSections` is reused, given an
  optional synonym table (Metadata's stays the default).
- **R2 — anchors are append-only.** Modes get retired and renamed (`hierarchy`, `outline`,
  `trajectory` already were), so `#mode-x` cannot depend on `MODES` alone. `help-anchors.ts` keeps
  `HELP_ANCHOR_ALIASES: Record<string, HelpAnchor>` — a retired anchor maps to its successor, and
  arriving at it lands on the successor. The test pins the set of every anchor ever shipped: each must
  be a live section or an alias.
- **R3 — one owner for fragments.** Every same-page link (contents rows, search results, heading `#`
  links) is a plain `<a href="#id">`, never `Link` (which cancels native navigation) and never a
  `reveal()` that scrolls as well. `HelpPage` owns arrival: on mount and on `hashchange`, resolve the
  id (through the aliases), wait until the section exists, scroll it into view, flash it once.
  Tested: direct load, search Enter, Back/Forward, ordinary click.
- **R4 — the deploy step loops.** A Help commit after the notes is an uncovered commit, and the
  changelog gate rightly refuses it. So: `changelog:prepare` → read the notes for Help implications →
  if Help needs it, update, commit, push → run `changelog:prepare` again → deploy. Non-gating; no
  mechanical "Help changed" gate, which would only breed meaningless edits.
- **R5 — no new icon in the spine or the band corner.** The spine is 12px wide and clips; the band
  corner already holds its (i). Instead **one labelled Help link in the Dock**, for owners and
  visitors, contextual: the current mode's section, or `#the-reading-view` in Plain. The band (i)
  cards stay unclickable (open-questions.md Q10); interactive cards with links are deferred to that
  question. This is a smaller answer to "more (i) icons" than Greg's words, and the summary says so.
- **R6 — content corrections** handed to the integrator: the spine's current-section fill;
  Marginalia is a right-hand column beside the band, so "three parts" is wrong; the gutter has a
  permalink, Chat, a `…` on narrow screens and owner/visitor differences; reruns of a mode do not use
  up allowance, while adding articles and High-powered AI can (billing.md).
- **R7 — mode sections do not restate `MODE_CATALOG`.** Each mode section renders the label from
  `MODE_LABEL` and the description and how from `MODE_CATALOG`, then Help's own fields:
  `whenToUse` and `reading` (how to read what it shows). `Record<Mode, HelpModeExtra>` keeps the
  exhaustiveness.
- **R8 — the ways in, as an inventory**: footer, command bar, the Dock link. No new menu, no
  `SiteNav` change.

## What landed (2026-10-02)

- **1a** `4aeb29585` — the route (signed in and out, lazy), footer link, `src/web/help/` skeleton,
  grouped contents (sticky at `lg`, a `<details>` below), search through `searchSections` with Help's
  own synonym table, typed anchors with aliases generated from `RETIRED_MODES`, arrival on mount and
  `hashchange`. The scroll-settle-flash moved out of `PageContents` into `flash.ts §
  scrollToAndFlash`, shared by Metadata and Help.
- **1b** `0845ef0d5` — ~12.8k words, drafted by four Opus subagents from the docs and the code, merged
  into one voice and split into `help-topics.tsx`, `help-modes.tsx`, `help-faq.tsx` behind
  `help-content.tsx`. One file per plan above became four; the typed `Record`s are as planned.
  Diagram's `MODE_CATALOG.how` corrected to "about a minute" (it said "minutes"; the panel's
  `SKETCH_WAIT` says a minute).
- **2 + docs** `fd2796578` — the Dock's Help link (`LifeBuoy`, after the experimental switch, its word
  dropping with the bar's other words on narrow windows), the command bar's Help row, and the docs:
  help-page.md, overseer.md § Deploying step 4, and the signposts.
- **Code review** `575fd4176` — GPT Sol ([261002b-help-page-code-review-sol.md](261002b-help-page-code-review-sol.md)),
  write-capable: one owner for a fragment click (C1), nine reader-facing sentences corrected against
  the code (C3), search fixes (C2), named `#` links (C4), `PINNED_ANCHORS` both ways (C5). C6 (doc
  wording) applied. **C7 is reported, not fixed — outside this change**: a visitor sees the owner's
  public notes in the margin under a tooltip that says *"Your note"* (BlockGutter.tsx ~:589).
- **Browser check** (Playwright, signed out, 1440 and 390): layout, sticky contents, phone width with
  no sideways scroll, the table, search and Enter, the `#` links all pass. One bug: on a cold first
  visit `/help#mode-skim` overshot by ~800px — fixed in the next commit.
- **Fix** `9b60c6141` — the overshoot: the scroll was aimed while Geist was loading, the text above
  reflowed, and smooth scroll kept its old destination. `scrollToAndFlash` now re-aims for two seconds
  on font loads and resizes, and stops at the reader's first input. 20/20 cold runs land. Postmortem
  [261002b](../postmortems/261002b-a-scroll-aimed-before-the-fonts-arrive-lands-where-the-text-was.md).
- **Round 2** — GPT Sol on the two fixes no second pass had seen (round 1's own C1, and the overshoot
  fix): no findings ([261002b-help-page-code-review-2-sol.md](261002b-help-page-code-review-2-sol.md)).
- **Second browser check** (signed in, an owned article; and a visitor): the Help link sits after
  Experimental and costs no mode labels at 1440 or 1280; at 390 the bar scrolls and Help is reachable;
  from Glossary it lands on and flashes `#mode-glossary`, Back restores the mode and query string;
  Plain goes to `#the-reading-view`; the command bar ranks Help above Feedback for "help"; nothing
  rewrites the address after arriving; a visitor has the link; three cold loads of `#mode-skim` land.

### Deferred

- **An (i) whose card links on into Help** — waits on open-questions.md Q10 (interactive cards).
- **Searching body text**, and landing on the matching line rather than the section heading.
- **C7**, the margin's *"Your note"* tooltip shown to a visitor over the owner's public note — a
  separate fix, outside this change.
