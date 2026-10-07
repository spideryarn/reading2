# Help back in the bar, and Help as Markdown pages by mode and theme, with reader guides

Up: [plans.md](../project/plans.md)

Part 1 of 3 of Greg's report `spya-ucftjt` (Sentry SPIDERYARN-READING2-E9), filed 2026-10-06 22:08
UTC from the reading view. Queue entry `qi-pvded3hd`. The other two parts are separate entries with
their own sessions: `qi-e6ksaejb` (a signed-out Help chatbot) and `qi-gjvvvc6n` (a guide agent on
opening an article). Nothing here builds either.

The words of the report that this part covers:

> I think in a previous message I suggested that you hide the help icon from the bottom bar. I'm
> second guessing that. Maybe it does make sense to keep it down there towards the bottom right. And
> I think as a larger point, the help page is really long. I wonder if it would make it more sense to
> break it up by modes and themes and stuff like that, with lots and lots of linking between. And
> maybe also try writing some documentations for example, sort of user personas or use cases. So if
> you're a reviewer, or if you're a beginner, or, you know, trying to learn a new topic, you know, a
> student, something like that. Or if you're an expert who's blah blah blah. … And that way the help
> page could sort of have a nice table of contents that'd be nicely structured so you could navigate
> around it as a user. … It strikes me that actually it might help if the help pages themselves were
> .md files that get turned into web pages, and then it would be easier probably to feed those in to
> the help chatbot.
>
> — Greg, 2026-10-06, `spya-ucftjt`

Prior-work check, 2026-10-07: nothing on `origin/dev` (at `67a6b9cb8`), in `docs/plans/` or in
`docs/user-feedback/` does any of this. `gjd-remote ls` shows this session
(`fbucftjt-help-pages-and-help-icon`) and the chatbot's, which has not started. The earlier request
this one reverses is [261004j](261004j-bottom-bar-citations-and-glossary-one-left-and-help-leaves-the-bar.md).

## What a reader gets

1. **Help is back in the bottom bar for everybody**, where it was before 2026-10-04: at the right
   end, just before Feedback, opening the Help page for the mode you are in.
2. **Help is many short pages, not one long one.** `/help` becomes a contents page. Each topic
   (the spine, the keyboard, sharing…) and each mode has a page of its own at `/help/<name>`. The
   questions stay together on one page. Every page has the same contents list and search box
   beside it, links to the pages before and after it, and a *See also* list.
3. **Four new pages for kinds of reader**: your first article, studying a topic, reviewing a paper,
   and reading in your own field.
4. **Every link anybody already has keeps working.** `/help#spine` lands on `/help/spine`.

## The shape

```
before                                 after

/help            one page, 46          /help                     contents: groups, a line on each page
  #spine         sections, all         /help/spine               one topic
  #keyboard      on screen             /help/keyboard
  #mode-glossary                       /help/mode-glossary       one mode
  #faq-…                               /help/questions#faq-…     the questions, together
                                       /help/first-article       four new guides
                                       /help/for-students
                                       /help/for-reviewers
                                       /help/for-experts

src/web/help/help-topics.tsx  ─┐       src/web/help/pages/spine.md, keyboard.md, …
src/web/help/help-modes.tsx   ─┼─►     src/web/help/pages/modes/glossary.md, …
src/web/help/help-faq.tsx     ─┘       src/web/help/pages/questions/faq-….md
                                       src/web/help/pages/guides/for-reviewers.md, …
```

### One file per anchor, and an anchor is still the unit

`HelpAnchor` stays the vocabulary: a topic id, `mode-<id>`, a `faq-…` id, and now a guide id. Each
has exactly one `.md` file. `helpHref(anchor)` stays the only way code builds a link, and what it
returns changes:

| anchor | `helpHref` returns |
|---|---|
| a topic, `spine` | `/help/spine` |
| a mode, `mode-glossary` | `/help/mode-glossary` |
| a question, `faq-older-profile` | `/help/questions#faq-older-profile` |
| a guide, `for-reviewers` | `/help/for-reviewers` |

So every caller (the bar, the command bar's Help row, a mode's (i), the quotes card) follows
without an edit, and a link to a page that does not exist still does not compile.

### The Markdown, and how it becomes a page

A file is front matter and CommonMark:

```
---
title: Reading the spine
summary: The strip down the left edge is a map of the whole article. What its marks mean.
keywords: heat thick line darker rail sidebar minimap
related: jumping-around, mode-structure
---

The spine is the thin strip down the left edge …  See [jumping around](/help/jumping-around).
Press <kbd>Enter</kbd> …
```

- `title`, `summary` and `keywords` are required for a topic, a question and a guide. A mode's file
  has no `title` or `summary`: its heading is `MODE_LABEL` and its first two paragraphs and its
  line on the contents page are `MODE_CATALOG`'s, as today, so a mode is still not restated. Its
  body is two sections, `## When to use it` and `## Reading it`, either of which may be left out.
- **Links are site paths**, `/help/spine`, `/pricing`, so the file reads correctly on GitHub and to
  a model that is handed it raw. A test walks every link in every file: a `/help/…` link must name
  a live page (not an alias), and any other path must be one the router knows.
- **`<kbd>…</kbd>` is the one piece of HTML allowed.** Any other HTML node fails the test.
- **Four tokens stand for facts that live in code**, so they cannot go stale: `{{experimental-modes}}`
  (the names of the experimental modes), `{{public-shelf-label}}`, `{{whats-new-label}}`, and, alone
  in a paragraph, `{{modes-table}}` (the *Which mode when* table, still drawn from `MODE_WHEN`, a
  `Record<Mode, …>` that stays in TypeScript). An unknown token fails the test. One exported
  function expands the three text tokens in a file's raw text, for the chatbot part to use.
- **Parsed in the browser by `mdast-util-from-markdown`**, which the client already ships for chat
  (`Cited.tsx`), and walked into React by a small renderer of Help's own. No HTML is ever built, so
  there is nothing to sanitise, and the files are ours in any case.
- **Loaded with Vite's `?raw`**, as the changelog's data is, into four tables in one TypeScript
  file: `Record<HelpTopic, string>`, `Record<Mode, string>`, `Record<FaqId, string>`,
  `Record<HelpGuide, string>`. That keeps today's cheapest guard: **a new mode with no Help file is
  a type error.** All of it stays inside the lazily loaded Help chunk.

### Routing and old links

- `router.ts`: `/help/<one segment>` parses to `{ kind: "help", page: "<segment>" }`; `/help` to
  `{ kind: "help" }`. The router does not judge the segment, so it imports none of Help. Signed-out
  reachable, as `/help` is.
- The Help page resolves the segment: a live page draws; an alias (`mode-trajectory`,
  `mode-remember`) replaces the address with its successor's; a `faq-…` id replaces it with
  `/help/questions#faq-…`; anything else draws *There is no Help page at this address* above the
  contents.
- `/help#spine`, the address people already have: on arriving at `/help` with a fragment that
  resolves, the address is replaced with `helpHref` of it. A replace, so Back does not revisit the
  old name. `PINNED_ANCHORS` keeps its job: every anchor ever shipped must still resolve to a page.
- Moving between Help pages is the router's ordinary `navigate`, which scrolls to the top. The
  scroll-and-flash arrival stays for fragments on the questions page.
- The tab's title is the page's title, then Help, then the app's name. `/help` itself keeps the
  title `site-pages.ts` pre-renders.

### The pages

- **`/help`, the contents.** The opening line, the search box, then every group with each page's
  title and its `summary` line. Groups: Start here · Ways to read (the four guides) · Reading an
  article · The modes · Your shelf and your account · Questions people ask.
- **A page.** The contents list and search box in the left column (folded above the page on a narrow
  window, as now), the page's words, then *See also* (from `related`) and previous / next within
  the group. A mode's page also links to *Which mode when*.
- **Search** is what it is today: titles and keywords, with Help's synonym table. A result is a
  link to its page. Searching the bodies is not built: nobody asked, and it can be added to the
  Markdown later without changing a file.

### The four guides

New words, so the rule for them is strict: **a guide states no product fact that an existing Help
page does not already state.** It is a route through the pages for one kind of reader, with a link
at every step, and where a mode it recommends is experimental it says so and links to how to turn
that on.

| page | for | leans on |
|---|---|---|
| `first-article`, *Your first article* | somebody new to Spideryarn (Greg's "beginner") | adding, the reading view, the spine, Summary, Chat, Glossary |
| `for-students`, *Studying a topic* | "trying to learn a new topic … a student" | Glossary, Structure, Skim, Ideas, comments, Learn |
| `for-reviewers`, *Reviewing a paper* | "if you're a reviewer" | Referee, Citations, Ideas, Debate, comments, Search |
| `for-experts`, *Reading in your own field* | "an expert who's…" | Skim, Search, Citations, Debate, reader profile |

These are a first draft of published copy. Greg asked for them, so they ship, and the note says
they are his to rewrite.

## Stages

**S1. Help back in the bar.** `DockHelp` loses its visitor gate and its comment gains Greg's new
words. The tests that say an owner's bar has no Help flip, red first. The Help sentence that lists
the ways in, and `help-page.md § The ways in`, say so. Small enough to do by hand.

**S2. The Markdown machinery, and the move.** In this order, so that the old page is the oracle
for the new one:

1. The renderer, the front matter reader, the file tables, with the files produced by converting
   each section of the three `.tsx` files. Nothing reworded.
2. **An equivalence test, while both exist**: for every anchor, the old body rendered to text and
   the new file rendered to text are equal after collapsing white space, and the set of link
   targets is the same once the old `#x` is mapped through `helpHref`. Red on a deliberately
   altered file first. Its output goes in this doc; the test goes when the `.tsx` words go.
3. The router arm, the pages, the contents page, the redirects, the title. `help-topics.tsx`,
   `help-modes.tsx` (bar `MODE_WHEN` and the table) and `help-faq.tsx` are deleted.
4. `tests/help-page.test.tsx` reworked: what it holds about anchors and search stays; what it held
   about one page becomes about pages, redirects and links.

**S3. The guides and the cross-links.** The four guide files, `related` on every page, checked by
the link test. Docs: `help-page.md` rewritten to match (where the words live, how to add a page,
the brief for the deploy step), `mode.md`'s paragraph on Help's tables, `reading-view-overview.md`'s
line if it needs it.

**S4. Review, browser, land.** GPT Sol on the code, fixing. A Sonnet subagent with Playwright:
owner's bar has Help at the right end; `/help` lists the groups; a topic page, a mode page, a
guide and the questions page; `/help#spine` and `/help#mode-trajectory` land right; search; 390px.
Full suite once, typecheck, lint on touched files. Push. The note, `feedback-endings.ts`, the
queue.

## The deploy step still holds

[help-page.md § Keeping it current](../project/help-page.md#keeping-it-current) has three guards:

1. **The compiler**: kept, by the four `Record` tables above. A new mode needs a key, a key needs
   an import, an import needs a file (a missing file fails the build and the test, not `tsc`).
2. **Whoever changes what a reader sees updates Help**: unchanged, and easier, since it is prose
   in a `.md` file.
3. **The Overseer's step 4 at deploy** ([overseer.md § Deploying](../project/overseer.md#deploying)):
   it points at `help-page.md § Bringing it up to date`, which is rewritten to name the `.md` files
   and keeps the same two commands (`npx vitest run tests/help-page.test.tsx`, `npm run typecheck`).
   `overseer.md` names no file under `src/web/help/`, so it needs no edit.

## What was passed over

- **The simpler option: split the routes and leave the words in TSX**, with only the guides in
  Markdown. About half the work. Passed over because Greg asked for Markdown and the chatbot part
  reads these files; and because the cost of moving turned out small when measured: across 2,100
  lines the words use under a dozen links to other pages, two labels, one computed list and one table from
  code, and otherwise only `p`, `ul`, `strong`, `em`, `code` and `kbd`.
- **Compiling Markdown to HTML at build time** with a full Markdown library. A new dependency and a
  generated file, to avoid a renderer of about 150 lines over a parser we already ship.
- **One page per group** (five long pages). Still long: the modes page alone would be 17 sections.
- **A page per question.** Eight pages of one paragraph each.

## Deferred, each with a queue entry before the note says shipped

- **Search engines listing the pages under `/help/`.** Today `/help` is one of the eight pages a
  search engine may list (`src/site-pages.ts`); every other address gets `noindex` from
  `vercel.json`. After this, `/help` is still listed but is a contents page, and `/help/spine` is
  served by the app shell with `noindex`. Listing them means an entry per page in `site-pages.ts`,
  `vercel.json`, `robots.txt` and the deploy check, which the Overseer's deploy depends on. It is
  its own piece of work. **This is a small step backwards for search until it is done**, and the
  note tells Greg so.

## Questions for Greg

None blocking.

## Reviews

(to come)
