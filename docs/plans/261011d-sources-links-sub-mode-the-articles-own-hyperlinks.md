# Sources › Links — the article's own hyperlinks, as a sub-mode

Up: [sources.md](../project/sources.md) · report `spya-s5mzkd` (SPIDERYARN-READING2-GV), queue item
`qi-85fzjzm8`

## The ask

Greg, through the Feedback button, on
`lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz?mode=sources`, 2026-10-10:

> Maybe sources should have a submode for external links as well, or perhaps include those in the
> bibliography somehow.

The brief: *pick the simpler that reads well and say why in the plan.*

## What we build

A fourth chip in Sources, **Links**, second in the row:

```
 ┌ Bibliography 42 │ Links 61 │ Reception 3 │ Claims 8 ┐                 (i)
 │
 │  Integrated information theory              philpapers.org · PhilPapers TONIIT
 │     linked in 3 paragraphs: ¶ ¶ ¶                          In Bibliography
 │  "a recent survey"                          arxiv.org · arXiv 2308.08708
 │     linked in ¶
 │  Wikipedia: Panpsychism                     en.wikipedia.org
 │  …
```

One row per **distinct destination** the article links to, in the order a reader first meets it:

- **the author's own words for it** (the link text; where the article links one address under
  several phrases, the first, with the others listed after it, quietly)
- **where it goes**, read off the href by `describeLink` ([`link-preview.ts`](../../src/web/link-preview.ts)):
  host, a file kind (`PDF`), the scholarly id the path carries (`arXiv 2308.08708`), and the full
  address in the title's tooltip. The title is the link, out to a new tab, `noreferrer noopener`,
  as everything outbound is ([links.md § Every link that leaves the app opens a new
  tab](../project/links.md#every-link-that-leaves-the-app-opens-a-new-tab)).
- **where the article links it**: how many paragraphs, with jumps to the first five (the same
  `BlockRef` Bibliography's *first cited* uses), then *and N more*.
- **In Bibliography**, when Bibliography holds a work whose address is this one: a press that opens
  that work's row (Reader's `openBibliographyWork`, which already exists for Claims' *Cited in this
  paragraph*). This is the "or perhaps include those in the bibliography somehow" half, done as a
  join rather than a merge.

The chip's number is the count of rows. **No model call, no fetch, no stored artefact, no job, no
step**: the list is computed in the browser from the blocks the prose already draws. So it costs
nothing, is there the moment the article is, draws the same list for an owner and a visitor once
the mode is open (a visitor's mode still opens only on a stored list, § Passed over), and a press
on the Links chip arms nothing.

Out of the list: in-article anchors and footnote markers (they go nowhere outside the piece), links
around an image with no words, the article's own address written the long way round, and anything
that is not `http(s)` — exactly what `articleLinks` already excludes for chat's `article_links`
tool (below).

## Why a sub-mode and not a fold into Bibliography

Both were offered. The sub-mode is simpler and reads better:

- **Bibliography is a list of works, and a list with a promise.** It is one model call's reading of
  *what this piece cites*, each row a work with authors, year, scores, a registry record, *Ask in
  chat*, and the one safety property that every address on a row came from the article and was
  found by code ([bibliography.md § The one safety
  property](../project/bibliography.md#the-one-safety-property)). Most hyperlinks are not works:
  a Wikipedia page, a homepage, a news story, the magazine's own back catalogue. Folding them in
  either gives those rows the shape of a citation they are not, or makes Bibliography two kinds of
  row with two sets of rules.
- **The overlap is already handled where it is real.** A hyperlink that *is* a cited work is
  already a Bibliography row (`linkFrom: "article"`: the article's own anchor whose text is the
  title). A fold would have to de-duplicate those against the raw list, and decide what a row is
  when the two disagree. The join (*In Bibliography* on a Links row) shows the overlap without
  merging two lists that are made in different ways.
- **A derived fold is possible, and worse.** An "other links" section appended under Bibliography
  in the browser would need no model or migration (GPT Sol's F1 corrected the first draft here).
  But it would be hidden while no Bibliography exists, look empty under a list with no works, and
  still mix two kinds of row in one list.
- **The bar's frame still fits.** Sources is *"What this piece cites, and what others say about
  it"*; a hyperlink is the plainest kind of citing, and Links sits next to Bibliography in the
  "cites" half.

What the sub-mode costs is a fourth chip, and the places a sub-mode has to be told about (below),
all of them compiler-checked tables except the help text and the docs.

## Reused, and the one thing deliberately not reused

**The obvious reuse is not taken, because it sits under a defence.** `articleLinks` in
[`src/chat-tools.ts`](../../src/chat-tools.ts) is the existing, reviewed reading of "the links in
this article" (three GPT Sol corrections in its comments), and the first draft of this plan moved
it into a shared module with the parser injected. But it is also **the scope check of
`/api/link-preview`**: [`src/link-previews.ts`](../../src/link-previews.ts) fetches a stranger's
page only when the article's own `articleLinks` contain the URL
([security-map.md § Where the defences physically live](../project/security-map.md)). A
behaviour-preserving move is still an edit to the code a defence runs, and that is not this
session's to make. So `chat-tools.ts` and `link-previews.ts` are untouched, and the browser has its
own parse.

**Why a second parse is acceptable here.** The comment on `articleLinks` warns against a second
parse *for an allowlist*, where disagreeing about what counts as a link would be a hole. This one
decides only what a list draws; the worst a disagreement can do is a row too many or too few. It is
kept to the same rules by importing the same pieces rather than re-deriving them — `isWebUrl` and
`sameTarget` from [`src/urls.ts`](../../src/urls.ts), and `describeLink` from
[`link-preview.ts`](../../src/web/link-preview.ts) — and by tests that run the same fixtures
through both and expect the same set of external addresses. Merging the two into one module is
written up for Greg as a follow-up (it needs
a reviewer's eye on the defence, not just mine).

**The rows**: [`src/web/outbound-links.ts`](../../src/web/outbound-links.ts),
`outboundLinks(blocks, sourceUrl)`. For each block with an `<a`, parse its html into an inert
`<template>` (whose content is never connected, so a `<base>` in a block reaches nothing — the
reason the server chose one too), take every `a[href]` with words of its own, resolve the href as
`destinationOf` does (absolute `isWebUrl`, else against `sourceUrl`; a `#…` href or the article's
own address by `sameTarget` is not external), group by address, union phrases and block ids in
article order, attach `describeLink`. `sourceUrl` is `meta.url` (absent for an upload). Memoised on
the blocks array in `SourcesMode`.

**The bibliography join** is `sameTarget(link.url, work.url)` for every work whose `linkFrom` is
not a Scholar search, so a fragment or a percent-encoding difference does not hide the match.
`sameTarget` is allowed to over-match (its comment), which here only means showing *In
Bibliography* on a row whose address differs by a fragment: acceptable.

## Where it is wired

Each of these is a table or a switch the compiler will name once `SOURCES_VIEWS` grows:

- `params.ts` § `SOURCES_VIEWS` gains `links` after `bibliography`; `ReceptionAndClaimsView`
  excludes it as well.
- `sub-modes.ts` § `SOURCES_SUB_MODES`: label *Links*, description *"Where this piece links to: every
  web address in its text, in the order you meet it"*, aliases *links*, *hyperlinks*, *external
  links*, *outbound links*, *urls*. (No other mode or sub-mode claims these today; checked in
  `mode-catalog.ts`.)
- `activation.ts` § `activationForSources` returns `null` for `links` (nothing to arm), and its
  callers take `null` as the Diagram ones already do — the chip and the command-bar row arm
  nothing.
- `sources-counts.ts` gains the links count; `SourcesMode.tsx` § `countOf` and `VIEW_HOW`
  (*"Read off the article's own markup in your browser: no model, no search, nothing fetched. Only
  links with words of their own are listed."*).
- `SourcesBand` / `VisitorSourcesBand` take `blocks` and `sourceUrl` and draw a new
  **`LinksPanel`** for `view === "links"`, with the shared chip row as its `head`, one
  `ModeSurface` with `mode="sources"` as the other two panels have, and Bibliography's works
  (owner: the read already mounted; visitor: the payload's) for the join.
- `item-focus.ts`, `thread-source.ts`, `rerun-commands.ts`, `Dock.tsx`, `auto-modes.ts`: whatever
  the compiler asks for. Links has no focus, no chat origin, no re-run and no auto-run.
- Help: `/help/mode-sources`'s text names the fourth sub-mode
  ([help-page.md](../project/help-page.md)).
- Docs: [sources.md](../project/sources.md) gains § Links (and its band diagram the fourth chip);
  [links.md](../project/links.md) a line pointing at it; [bibliography.md](../project/bibliography.md)
  a line on the *In Bibliography* join.

## Passed over

- **The fold into Bibliography** — above.
- **A hover card on each row** like the prose's link card (Wikipedia summary, server preview,
  *Add to Spideryarn*). It would reuse `ProseHoverCard`'s async half, which fetches through our
  server on hover ([links.md § What our own server can reach](../project/links.md#what-our-own-server-can-reach)).
  Not needed for v1, and it is the one way this feature could reach the network; the row says what
  the href says and nothing more. The server's fetch defence is untouched.
- **Opening Sources for a visitor because the article has links.** A visitor's mode opens on any one
  of the three stored artefacts (visitor.ts § `POLICY`, `any-artefact`); a public article with
  links and none of the three still shows the not-built gap. Teaching the policy about blocks is a
  wider change than this report asks for; noted in sources.md § Visitors.
- **Orders and a filter** (by host, by count, internal vs leaving the publication). Article order
  is what a reader expects of a list of links, and the rows already show the host. Add one when a
  long list shows it is needed.
- **A PDF's links.** A PDF-ingested article has none (links.md § What is actually in an article):
  stage 2 renders prose, not hyperlinks. When the list is empty and `meta.source === "pdf"`, the
  sub-mode says *"This piece has no web links in its text. An article read from a PDF never does."*;
  otherwise it uses the neutral *"This piece has no web links in its text"*. The addresses
  a PDF prints in its reference list are Bibliography's to find, and already are.

## Stages

1. `outboundLinks`, the fourth view in every table, `LinksPanel`, the join, the help text, the docs.
   Tests: `outboundLinks` (grouping, ordering, self-link, `mailto:`, image-only, footnote marker,
   one URL under two phrases, a relative href against `sourceUrl`); the chip count and its
   accessible name; the panel's empty states; the join; `?sources=links` round-trips and an unknown
   value still reads as Bibliography; a Links press arms nothing.
2. Browser check in a Sonnet subagent on the box (Playwright), on an article with links and one
   from a PDF, at 1440 and 390 wide.

GPT Sol reviews the plan before building, and the code before the push.

## Plan review (GPT Sol), and what changed

[261011d-sources-links-sub-mode-plan-review-sol.md](261011d-sources-links-sub-mode-plan-review-sol.md),
verdict *build with the fixes above*. The review read the first draft, which still moved
`articleLinks` into a shared module; that was dropped before building, for the defence reason above.

1. **P2, the fold's cost was overstated.** Taken: § Why a sub-mode says a derived fold needs no
   model, and why it is still worse.
2. **P1, `sameTarget` misses the commonest overlap**, because Bibliography rewrites a publisher's
   DOI page to `doi.org` and an arXiv PDF to `/abs/`. Taken: `workAt` matches by address, then by
   paper (DOI lower-cased, arXiv id without its version, both read by `describeLink`), for works
   linked by `doi` or `arxiv`. Tests for both shapes. `"anchor"` corrected to `"article"`.
3. **P2, the parity claim was loose.** Taken in part: the two differences are written in
   outbound-links.ts's header, phrases are clipped at 80 as chat's are, and the parity test covers
   the rules meant to match. **Not taken: `carriesCredential` instead of `hasCredentials`.** It
   refuses `?key=`, `?code=` and `?share=` on purpose, for a shared cache; here it would hide a link
   the prose beside the list already shows, so the list would silently miss rows with no gain in
   exposure. The network trace is taken: `?mode=sources&sources=links` joins the visitor sweep in
   tests/public-network-trace.test.tsx, which asserts no request but public GETs.
4. **P2, visitors do not get it unless a stored list opens the mode.** True, and left: changing the
   visitor policy changes what every public article shows, wider than this report. The plan's
   claim is corrected and sources.md § Visitors says so.
5. **P1, a missing `meta.url` is not "a PDF".** Taken: the owner's empty sentence reads
   `meta.source === "pdf"`; otherwise, and always for a visitor, the neutral *This piece has no web
   links in its text.*
6. **P2, copy and enumerating tests.** Taken: the catalog's `how`, the help page and its corpus.
   `SHARED_LINK_CARRIES` is left: it lists the reading aids made for the piece, and its links are
   part of the piece. The enumerating tests are updated where the suite asked.
7. **P2, wording and bounds.** Taken: *linked in N paragraphs*, at most three other phrases then
   *and N more*, and the chip's spoken count is *addresses*.
