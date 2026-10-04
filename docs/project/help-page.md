# The Help page

`/help` — one page, for readers, that explains what Spideryarn does and how to get the most from it.
Part of [reading-view-overview.md](reading-view-overview.md).

Greg, 2026-10-01 (SPIDERYARN-READING2-85, `spya-p2hamn`):

> Provide a Help or FAQ page for users that want to understand all of Spideryarn's features. Make
> sure it has a nice table of contents and search bar, and lots of anchor links (so we can link
> directly to places). And include it in footer.
>
> In the Help page, emphasise the kinds of things that users might not be able to figure out for
> themselves, help them build intuitions, focus on what's valuable, e.g. how should I interpret the
> visuals in the Spine?
>
> And anything else you think will help the user, and ensure that we keep this up to date.

The build, and the options passed over, are in
[261002b-help-page.md](../plans/261002b-help-page.md).

## What it is for, and what it is not

**Help is for somebody already reading.** It says how to read what is on screen — what a mark on
the spine means, when a mode is worth opening, what the AI did and did not do. Its siblings each have
a different reader:

- [`/features`](website-text.md) is the pitch, for somebody deciding whether to sign up.
- `/changelog` ([changelog.md](changelog.md)) is what changed, for somebody who already knows the
  product.
- A control's tooltip ([tooltips.md](tooltips.md)) is the one thing about that control, at the moment
  of use. Help is where the larger picture goes that a card has no room for.

**The test for every sentence: would a reader work this out alone in their first week?** If yes, it
goes. Plain words, second person, British spelling, the label the reader actually sees on screen —
never a word from the codebase (no "block", "artefact", "band"). A fact that could not be checked
against the code is left out rather than guessed.

## Where the words live

All in `src/web/help/`, as TSX — there is no Markdown renderer in the client, and a page we write
ourselves does not need one.

- [`help-anchors.ts`](../../src/web/help/help-anchors.ts) — every anchor, the `HelpAnchor` type,
  `helpHref(anchor)`, and the aliases for retired anchors.
- [`help-content.tsx`](../../src/web/help/help-content.tsx) — the sections, and the groups that say
  their order. Topics are a `Record<HelpTopic, …>`, modes a `Record<Mode, …>`.
- [`HelpPage.tsx`](../../src/web/help/HelpPage.tsx) — the page: contents, search, arrival.

**A mode's section does not restate the mode.** Its heading is `MODE_LABEL`, and its first two
paragraphs are `MODE_CATALOG`'s `description` and `how` — the same words as the dock's card and the
band's (i). Help adds only *when to use it* and *how to read it*. So fix a mode's description in the
catalog, and Help follows.

## Anchors are a promise

People will paste `/help#spine` into messages, and the code links into Help by anchor, so:

- **Every code link to a Help section goes through `helpHref`**, which takes a `HelpAnchor`, so a
  link to a section that does not exist does not compile. A hand-written `/help#…` string would
  bypass the type, so do not write one. (The page itself, with no section, is `HELP_HREF`.)
- **An anchor is never renamed or deleted.** Retire it by adding an alias in
  `HELP_ANCHOR_ALIASES` to the section that replaced it; arriving at the old one lands on the new.
  A retired mode gets its alias automatically, from `RETIRED_MODES` in src/modes.ts.
- `tests/help-page.test.tsx` § `PINNED_ANCHORS` lists every anchor ever shipped, and each must still
  be a section or an alias. Add to it; never take away.

## Keeping it current

Three things, from cheapest to dearest:

1. **The compiler.** A new mode without a Help entry is a type error, and so is a new mode missing
   from the "Which mode when" table. [mode.md § Before you call it finished](mode.md#before-you-call-it-finished)
   lists it.
2. **Whoever changes what a reader sees updates Help in the same commit**, the way they update a
   doc. [engineering-manager.md § Along the way](../reusable/engineering-manager.md#along-the-way)
   says so.
3. **The deploy step**, which catches what 2 missed: after the release notes are written, the
   Overseer reads them for anything that changes what a reader sees or can do, and brings Help up to
   date — [overseer.md § Deploying](overseer.md#deploying), step 4. It is a step, not a gate: nothing
   refuses a deploy over Help, because a mechanical "did Help change?" check would only breed edits
   made to satisfy it.

## Bringing it up to date

The brief for step 3, and for anyone else updating the page:

1. Read the entries in the pending release (`src/web/changelog-pending.json`,
   [changelog.md § The pending release](changelog.md#the-pending-release))
   — or, outside a deploy, the commits you are covering.
2. For each one a reader would notice, ask: does Help say anything that is now false? Is there
   something here a reader could not work out alone? If neither, move on — most entries need nothing.
3. Edit the section in `src/web/help/`, checking the fact against the code, not the commit message.
   A new topic gets a new id in `help-anchors.ts`, a place in a group, and a line in `PINNED_ANCHORS`.
4. `npx vitest run tests/help-page.test.tsx` and `npm run typecheck`, then commit and push to `dev`.

## The ways in

- The footer, on every page that has one ([website-text.md](website-text.md)).
- The command bar's **Help** row (⌘K / Ctrl-K, then *help*).
- The **Help** link in the dock, which opens the section for the mode you are in. **On a
  visitor's bar only** since 2026-10-04: Greg asked for it out of the bottom bar (`spya-dev7pf`),
  and a visitor has no command bar, so theirs is the one bar that keeps it —
  [261004j](../plans/261004j-bottom-bar-citations-and-glossary-one-left-and-help-leaves-the-bar.md).
- **A mode's (i)**, whose card ends in *More in Help →* to that mode's section, since
  2026-10-02 — the first `Tooltip` card the pointer can enter
  ([tooltips.md § A card the pointer can enter](tooltips.md#a-card-the-pointer-can-enter)). Not
  every panel has one: a visitor's panel for a mode that is not shared, a panel that failed, and
  Marginalia's column do not.

**Why not an (i) beside every mark.** Greg suggested more (i) icons linking into Help. The two
obvious places for a new icon have no room: the spine is 12px wide and clips, and a band's corner
already holds its (i). So the band's existing (i) carries the link instead of a second icon.
