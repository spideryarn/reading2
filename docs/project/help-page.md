# The Help page

`/help` — contents and short pages for readers, explaining what Spideryarn does and how to get the
most from it.
Up: [reading-view-overview.md](reading-view-overview.md)

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

All in `src/web/help/`. **Since 2026-10-07 the words are Markdown, one file per anchor, under
`src/web/help/pages/`**, and Help is a contents page at `/help` with a page for each topic, mode and
guide at `/help/<anchor>` and the questions together at `/help/questions` — plan
[261007e](../plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md).
Greg asked for it, 2026-10-06 (`spya-ucftjt`):

> the help page is really long. I wonder if it would make it more sense to break it up by modes and
> themes and stuff like that, with lots and lots of linking between. And maybe also try writing some
> documentations for example, sort of user personas or use cases. … It strikes me that actually it
> might help if the help pages themselves were .md files that get turned into web pages, and then it
> would be easier probably to feed those in to the help chatbot.

**A file is front matter and CommonMark**, and the renderer refuses anything else, so a test that
draws every file catches a slip. A topic or guide has `title`, `summary` (the line on the contents
page) and `keywords` (words a reader brings that the title does not say); a question has `title` and
`keywords`; a mode has `keywords` only. Any of them may have `related` (anchors, for *See also*). A
mode's body is up to two sections, `## When to use it` and `## Reading it`. Links are site paths
(`/help/spine`, `/pricing`), so a file reads the same on GitHub and to a model handed it raw. The only
HTML is `<kbd>`, and the only image is a picture alone in its paragraph (§ Pictures). Four tokens stand for facts kept in code — `{{experimental-modes}}`,
`{{public-shelf-label}}`, `{{whats-new-label}}` and `{{modes-table}}` — and `help-markdown.tsx` §
`expandHelpTokens` gives the plain text with them filled in, for anything that wants to read Help
rather than draw it.

The groups: Start here · Ways to read (the four guides: your first article, studying a topic,
reviewing a paper, reading in your own field) · Reading an article · The modes · Your shelf and your
account · Questions people ask. **A guide states no product fact that another Help page does not
already state**; it is a route through the pages for one kind of reader, with a link at every step.

- [`help-anchors.ts`](../../src/web/help/help-anchors.ts) — every anchor, the `HelpAnchor` type,
  `helpHref(anchor)`, the aliases for retired anchors, and what an address under `/help` shows.
- [`help-pages.ts`](../../src/web/help/help-pages.ts) — the four tables that load the files: topics
  a `Record<HelpTopic, …>`, modes a `Record<Mode, …>`, the questions and the guides.
  [`help-markdown.tsx`](../../src/web/help/help-markdown.tsx) draws a file, and
  [`help-mode-when.tsx`](../../src/web/help/help-mode-when.tsx) is the "Which mode when" table.
- [`help-content.tsx`](../../src/web/help/help-content.tsx) — the groups that say the pages' order,
  and each page's title, line and words gathered into one shape; shared bits in
  [`help-parts.tsx`](../../src/web/help/help-parts.tsx).
- [`HelpPage.tsx`](../../src/web/help/HelpPage.tsx) — what draws it: the contents page, a page,
  search, arrival.

**A mode's page does not restate the mode.** Its heading is `MODE_LABEL`, and its first two
paragraphs are `MODE_CATALOG`'s `description` and `how` — the same words as the dock's card and the
band's (i). Its file adds only *when to use it* and *how to read it*. So fix a mode's description in the
catalog, and Help follows.

## Ask about Spideryarn <a id="ask-about-spideryarn"></a>

**A box on every Help page that answers a question from the Help's own words** — in the column
beside a page, and under the search on `/help` itself. Greg asked for it in `spya-ucftjt`, 2026-10-06:

> you can ask it stuff like, This is what I'm trying to achieve, or I'm stuck, or What does this do?
> or Why is this parting that color? or whatever. What does this symbol mean? And it would be able to
> do a pretty good job of answering it. But if anything else, it would kind of know, like, Hang on,
> yeah, that's not what I'm here for.

The plan, its review and its eval: [261007k](../plans/261007k-help-chatbot.md).

- **It answers from these pages and nothing else.** Every page is copied, in contents order, into
  [`src/help-corpus.generated.json`](../../src/help-corpus.generated.json), which
  `tests/help-corpus.test.ts` rebuilds and compares, so editing a page without regenerating it is a
  red test, not a stale answer: `WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts`. The
  whole corpus is the model's system prompt ([`src/help-chat-call.ts`](../../src/help-chat-call.ts)
  § `HELP_CHAT_SYSTEM`), with a rule to link the page each answer comes from and to decline, in one
  sentence, anything that is not about using Spideryarn. `docs/project/` is not in it: it is written
  for us, names every defence, and is too big to send whole. A picture reaches the model as words,
  `(Picture: alt. Caption: caption)`, never as image markup it could copy into an answer.
- **One question at a time.** No conversation is sent back, because a history the browser writes is
  the easiest way to talk a Help-only model into being a general one (the plan's F1). A new question
  replaces the last answer. The question and the answer are neither stored nor logged; what is kept
  is that a question was asked, and when (the allowance's row), and what the call cost (the cost
  ledger, with no article).
- **The answer is a model's, so it is drawn as untrusted**: through `CitedMarkdown`'s walk
  ([`src/web/Cited.tsx`](../../src/web/Cited.tsx)) with no HTML and web links off, and a link drawn
  only when its address is exactly one of these pages or `/help`
  ([`help-answer-links.ts`](../../src/web/help/help-answer-links.ts)). Anything else is shown as the
  characters the model typed.
- **Signed in only, for now.** Every request a stranger can make today is a read, and this would be
  the first anonymous request that spends money: it would mean a door in front of the sign-in check
  and an allowance for somebody with no account. Greg has the options in the plan's § For Greg; until
  he picks, a stranger sees *Sign in to ask a question about Spideryarn* in the same place.
- **Free, with its own allowance**: no article slot, nothing off the reader's articles. Each reader
  may ask 30 an hour and 100 a day, one at a time, and a fuse across everybody stops it for the day
  at 1,300 questions (`HELP_CHAT_RATE_POLICY` in `help-chat-call.ts`), sized from the cost of a
  question with nothing cached.
- The box is [`HelpAsk.tsx`](../../src/web/help/HelpAsk.tsx); `HelpPage.tsx` holds its state, keyed
  to the signed-in reader, so an answer on `/help` survives following one of its links to a page but
  a reader switch clears it and aborts an answer still arriving.

## Pictures

Since 2026-10-07 Help has screenshots, cropped to what the passage around them describes, each
with a caption, and a few GIFs where the thing being explained is a movement — plan
[261007l](../plans/261007l-help-screenshots-and-gifs.md). Greg, 2026-10-07 (`spya-mq05ww`):

> Include lots of screenshots throughout Help, ideally cropped to highlight what's being described,
> with nice caption. Even better if some of those could be animated gifs, if that will help make it
> clearer to the reader.

**Adding or refreshing Help pictures needs no approval.** Greg, 2026-10-07, on the eight modes
still without one (`qi-hyx8fden`): *"yes. You don't need my permission for this going forwards"*.

- **In a page:** one Markdown image, alone in its paragraph, with its caption as the image's title
  in quotes — [`spine.md`](../../src/web/help/pages/spine.md) has one. The alt is for somebody who
  cannot see it; the title is the caption under it. The path is relative to the page's file
  (`../images/…` from `modes/`, `guides/` or `questions/`), so GitHub shows it too. Search reads a
  picture as its caption; anything handed the Markdown itself (`expandHelpTokens`) gets the line as
  written.
- **The file** goes in `src/web/help/pages/images/`, and **an entry** in
  [`help-images.ts`](../../src/web/help/help-images.ts): its size, what it shows, which article,
  the window, the day. That entry is how the next person retakes it. `tests/help-images.test.ts`
  holds the folder, the entries and the pages to each other, and each file to its declared size.
- **Shooting one** is [marketing-pages.md § Shooting a screenshot of the
  product](marketing-pages.md#shooting-a-screenshot-of-the-product): one idea per picture, nothing
  brighter in the frame than the thing named, nothing half-cut. Then, for Help: **only an article
  on the public shelf**, never one from anybody's own library; **cropped to the passage's subject**,
  not the whole window; shot at 2× and kept at 2× (the page draws it at half, at most 672px wide);
  `npm run screenshots:compress -- <file>`, which is pngquant. A GIF only where the motion is the point, a few seconds,
  looping, made with `scripts/frames-to-gif.ts`.

## Anchors are a promise

People will paste `/help/spine` into messages, and the code links into Help by anchor, so:

- **Every code link to a Help section goes through `helpHref`**, which takes a `HelpAnchor`, so a
  link to a page that does not exist does not compile. It returns `/help/<anchor>`, or
  `/help/questions#<id>` for a question. A hand-written `/help/…` string would bypass the type, so
  do not write one. (The page itself, with no section, is `HELP_HREF`.)
- **An anchor is never renamed or deleted.** Retire it by adding an alias in
  `HELP_ANCHOR_ALIASES` to the section that replaced it; arriving at the old one lands on the new.
  A retired mode gets its alias automatically, from `RETIRED_MODES` in src/modes.ts.
- **The addresses from before 2026-10-07 still land.** Help was one page with a section per anchor,
  so `/help#spine` is in people's messages; arriving there, the address is replaced with
  `/help/spine`, and a question's `/help#faq-…` with `/help/questions#faq-…`. Both are tested.
- `tests/help-page.test.tsx` § `PINNED_ANCHORS` lists every anchor ever shipped, and each must still
  be a section or an alias. Add to it; never take away.

## Keeping it current

Three things, from cheapest to dearest:

1. **The compiler.** A new mode without a Help file is a type error (`help-pages.ts` holds the files
   in a `Record<Mode, …>`), and so is a new mode missing from the "Which mode when" table. [mode.md § Before you call it finished](mode.md#before-you-call-it-finished)
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

The brief for the deploy's step 4, and for anyone else updating Help:

1. Read the entries in the pending release (`src/web/changelog-pending.json`,
   [changelog.md § The pending release](changelog.md#the-pending-release))
   — or, outside a deploy, the commits you are covering.
2. For each one a reader would notice, ask: does Help say anything that is now false? Is there
   something here a reader could not work out alone? **Does a picture now show something that is no
   longer true** — a control moved or renamed, a mode's band redrawn? If none of these, move on —
   most entries need nothing. A picture that is wrong is retaken from its entry in
   `help-images.ts` (§ Pictures), or deleted with its line; a new screen worth showing gets one.
3. Edit the page's file under `src/web/help/pages/`, checking the fact against the code, not the
   commit message. A new topic gets a new id in `help-anchors.ts`, a file and its import in
   `help-pages.ts`, a place in a group, and a line in `PINNED_ANCHORS`. A guide that recommends what
   changed may need its sentence too (`pages/guides/`).
4. `npx vitest run tests/help-page.test.tsx tests/help-images.test.ts` and `npm run typecheck`, then
   commit and push to `dev`.

## The ways in

- The footer, on every page that has one ([website-text.md](website-text.md)).
- The command bar's **Help** row (⌘K / Ctrl-K, then *help*).
- The **Help** link in the dock, just before Feedback, which opens the page for the mode you
  are in. **On every bar again** since 2026-10-07, an owner's and a visitor's. From 2026-10-04 it
  was on a visitor's bar only, because Greg had asked for it out of the bottom bar (`spya-dev7pf`,
  [261004j](../plans/261004j-bottom-bar-citations-and-glossary-one-left-and-help-leaves-the-bar.md))
  and a visitor has no command bar; he reversed that in `spya-ucftjt`
  ([261007e](../plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md)):

  > I think in a previous message I suggested that you hide the help icon from the bottom bar. I'm
  > second guessing that. Maybe it does make sense to keep it down there towards the bottom right.
  >
  > — Greg, 2026-10-06 (`spya-ucftjt`)
- **A mode's (i)**, whose card ends in *More in Help →* to that mode's page, since
  2026-10-02 — the first `Tooltip` card the pointer can enter
  ([tooltips.md § A card the pointer can enter](tooltips.md#a-card-the-pointer-can-enter)). Not
  every panel has one: a visitor's panel for a mode that is not shared, a panel that failed, and
  Marginalia's column do not.

**Why not an (i) beside every mark.** Greg suggested more (i) icons linking into Help. The two
obvious places for a new icon have no room: the spine is 12px wide and clips, and a band's corner
already holds its (i). So the band's existing (i) carries the link instead of a second icon.
