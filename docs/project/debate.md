# Debate mode

Up: [reading-view-overview.md](reading-view-overview.md)

What the rest of the web says about this piece: replies to it, and the argument around the claims it
makes. **The only mode whose content is not in the article at all**, which is why nearly everything
the panel draws that is not a row is a disclosure.

## What it is for

> Let's add a new mode (perhaps called Critiques or Critical Reception or something along those
> lines) that gathers from the wider web about the article, e.g. reviews, critiques, etc (ideally
> from authoritative sources). Perhaps as a v1 it can reuse the machinery from the Chat (which can
> already spawn multiple search the web tool calls). It should be marked as an Experimental Feature
> for now. … e.g. cluster the points made, and/or enabling ranking by Chronology/Valence/
> Incisiveness, with a Prioritised default sub-mode that combines them with threshold UI, a bit like
> Glossary etc. Provide citation/linking, with rich tooltips (e.g. with excerpts).
>
> — Greg, 2026-09-05, in [260905f](../plans/260905f-debate-mode-what-the-web-says-about-this-piece.md)

> If no one (or few people) have written about this piece, let's just say so.
>
> — Greg, 2026-09-05, the same plan

> In Debate mode, I wonder if there's a way to somehow highlight key themes from other people and
> commentary and whatever, and key nodes, i.e. the critical papers that really responded or moved
> things forward or take a different view or whatever.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-6M), in [260930j](../plans/260930j-debate-themes-and-key-sources.md)

> So there could be a claims submode. … And then there's a section, a separate submode besides
> claims for reception or critiques or responses or something. Yeah, reception sounds about right,
> which talks about, you know, other people who have—what have they said about this?
>
> — Greg, 2026-10-03 (report `spya-caue42`), in [261003o](../plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md)

## What the reader sees

Two sub-modes, one per search, on a segmented control (`?debate=claims`; Reception is the default):

- **Reception**: what others have written about the piece itself, including work that cites it and
  says something about it. Pages that link or quote the piece come first; pages that only name it
  by title follow under a heading that says so. Nothing is hidden by default, and there is no
  identification slider any more: the old default hid the published replies and citing papers the
  search exists to find
  ([postmortem 261003h](../postmortems/261003h-debate-default-bar-hides-the-citing-papers-the-search-was-changed-to-find.md)).
  For the owner it ends with **Cited by**: the papers that cite the piece, from OpenAlex, most cited
  first, ten and then all (see [§ Cited by](#cited-by-the-papers-that-cite-the-piece) below). A
  visitor gets a Google Scholar search for who cites it instead.
- **Claims**: what has been written about the claims the piece makes. One open disclosure per
  claim, in article order, headed by the article's own words; the relevance bar belongs here.

Threads and key sources narrow whichever sub-mode is on screen. The reader cannot yet choose which
claim is checked or steer the search; that is an open question for Greg in 261003o.

Open this doc to find your way in; the plans below are still where the design and its reasoning
live.

## Cited by: the papers that cite the piece

Since 2026-10-04, in
[261004h](../plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md). It
answers "has anyone cited this?" for a paper the open web has not written about, where Reception
honestly finds nothing.

- **A list and a count, and no reading of either.** OpenAlex says which papers cite a DOI; it has no
  citing sentence, and no model is asked. The panel says so under the count. What each citer says,
  for or against, is not built.
- **Not part of the stored debate.** It is free, has its own route (`GET /api/citers/<slug>`) and
  its own cache, so it is on screen whenever the owner has Reception open: before the paid search
  has run, and on a debate stored before it existed. Nothing in it can start the search, and it
  does not change Reception's count, which stays the web search's rows.
- **The DOI is checked before it is trusted.** OpenAlex's record for the DOI must carry the
  article's whole title and one of its authors, as imported (never a reader's rename). The check
  runs on a fresh answer, on a cache hit and on a stale fallback alike, so a second article carrying
  the same DOI by mistake gets nothing.
- **Every outcome has its own sentence** (`CitersResult` in `src/types.ts`, the words in
  `src/messages.ts`): no DOI on record, not in OpenAlex, could not be confirmed, could not be
  reached (with Try again), too large to read, no citers yet, and the list. A short list says why
  it is short: the page limit (100, most cited first) and records that could not be shown are two
  different sentences.
- **Cached per DOI for 7 days**, shared by every reader of that paper: public bibliographic facts,
  with no owner and no article on the row (`src/db/schema.ts` § citation index). If OpenAlex cannot be
  reached and an older list exists, that list is shown with its own date.
- **OpenAlex's strings are text.** Titles and names are stripped of markup and bounded; a link is
  built by us from the citing paper's DOI or OpenAlex id, never taken from the answer
  ([security-map.md](security-map.md)). A citer's title is drawn in the app's face, like a source's
  title in the rows above: [fonts.md](fonts.md) leaves third-party text there.
- **What is sent**: the article's DOI and our contact address, from the server. No key.
  [privacy.md](privacy.md) has the page's sentence.

Not built, each named in the plan: a visitor's view of the list; a title search when there is no
DOI (an arXiv preprint has none on record today, so it shows the no-DOI sentence, as does an article
imported before 2026-10-04 until its owner uses Read it again); more than one page; hiding
self-citations; an API key.

## What has changed, and where each change is written up

The plan is the reference:
[260905f](../plans/260905f-debate-mode-what-the-web-says-about-this-piece.md), and for how a row
is laid out, the four orders and the relevance bar,
[260929h](../plans/260929h-debate-mode-clearer-sources-and-orders.md). Behind the switch for now; since 2026-09-29 a visitor to a public article sees a stored one, every row's address
re-judged at the boundary and a refused row withheld and counted — only running a search is the
owner's ([260929c](../plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md)).
Since 2026-09-30 a search also finds the themes its sources share and picks out the key ones,
as filters above the list ([260930j](../plans/260930j-debate-themes-and-key-sources.md)); since
2026-10-01 a visitor sees those and each row's relevance too, unless the boundary withheld a row
([261001b](../plans/261001b-public-article-visitors-see-debate-threads-relevance-citation-entry-and-cross-references.md)).
Since 2026-10-01 a source whose address carries a DOI or arXiv id (`doi.org`, `arxiv.org`, or a
publisher's `/doi/10.…` path) gets Crossref's or DataCite's authors and year, kept only when the
record's title agrees with the page's; the by-line and the date order prefer them and say where
they came from, and a visitor sees them too
([261001a](../plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md) stage 6).
Since 2026-10-02 the search for responses also looks for the work that **cites** the piece, and
every extract the search returned for a page is checked, not just the first — which had been
throwing away correctly copied replies
([261002i](../plans/261002i-debate-leads-with-who-has-cited-this-article.md),
[postmortem 261002g](../postmortems/261002g-debate-refused-quotes-from-a-later-extract-of-the-same-page.md)).
Since 2026-10-03 the panel is two sub-modes, Reception and Claims, and the identification slider
is a headed group ([261003o](../plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md);
what the evals behind it measured is
[investigation 261003g](../investigations/261003g-debate-on-a-thinly-received-paper-what-reception-finds-and-how-claims-spread.md)).
Since 2026-10-04 the owner's Reception ends with **Cited by**, the papers that cite the piece, from
OpenAlex: 261002i's stage 2, built as
[261004h](../plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md). It is
not part of the stored debate, so it is there before a search has run.

How the mode was evaluated, and what that found:
[260906b](../plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md), with the stage-0
spike that showed a web search never comes back empty in
[260905f-debate-mode-stage-0-spike-results.md](../plans/260905f-debate-mode-stage-0-spike-results.md).

## Not decided: folding Citations into Debate

Greg suggested it (spya-c2qmbg): the works a paper cites and what others say about it are two halves
of one question, and from one cited work he would like to see where it sits in the wider debate. On
2026-10-04 he deferred it:

> needs more thought. Write up somewhere, and we'll come back to it

The options, with a diagram, are in
[261004b § Part 2](../plans/261004b-citation-hover-card-offers-dig-deeper.md): keep two modes
linked by buttons; one mode with Reception, Claims and Cited works; list beside each claim the works
cited in its paragraph (no model call); or a model filing each cited work under a debate thread. The
Overseer recommended the second then the third. Open with it: the merged mode's name, and whether it
comes out from behind the experimental switch, which Debate is behind and Citations is not. The
first small step, a Dig deeper button on a citation's card, shipped. It is part of the wider wish to
declutter the bottom bar ([interface-vision.md](interface-vision.md#decluttering-the-bottom-bar)).

## Where the code is

Each module's header comment says what it owns and why; start with `src/debate.ts`'s.

- [`src/debate.ts`](../../src/debate.ts) — the pipeline step: the searches, and what is kept. Its
  header opens with the one thing to understand first.
- [`src/debate-themes.ts`](../../src/debate-themes.ts) — the third call: the themes the sources
  share, and the key sources.
- [`src/debate-synthesis.ts`](../../src/debate-synthesis.ts) — the rules a synthesis must keep, read
  on both sides of the wire.
- [`src/debate-registry.ts`](../../src/debate-registry.ts) — authors and year from Crossref or
  DataCite, for a source that carries an identifier.
- [`src/debate-journal.ts`](../../src/debate-journal.ts) — the capture journal the evaluation
  replays.
- [`src/web/DebatePanel.tsx`](../../src/web/DebatePanel.tsx) — the panel, and
  [`src/web/modes/debate/`](../../src/web/modes/debate/DebateMode.tsx) the mode controller that
  mounts it.
- [`src/web/debate-levels.ts`](../../src/web/debate-levels.ts) — Reception's two groups, and why the
  slider that used to hide the title-only one is gone.
  [`src/web/debate-order.ts`](../../src/web/debate-order.ts) — Reception's orders, Claims' grouping
  and the relevance bar. [`src/web/debate-threads.ts`](../../src/web/debate-threads.ts) — the
  threads, scoped to a sub-mode.
- [`src/scholar-search.ts`](../../src/scholar-search.ts) — the Scholar search Reception ends with;
  browser-safe, shared with Citations.
- [`src/citation-index.ts`](../../src/citation-index.ts) — Cited by: the two requests to OpenAlex,
  the parsers, the identity check and the fallbacks. Its cache is
  [`src/store/pg-citation-index.ts`](../../src/store/pg-citation-index.ts); its politeness is the
  shared limiter in [`src/bibliographic.ts`](../../src/bibliographic.ts) (`inServiceTurn`).
  [`src/citer-link.ts`](../../src/citer-link.ts) builds a citer's link, and
  [`src/web/useCiters.ts`](../../src/web/useCiters.ts) is the panel's read, which has no job.

Related: [citations.md](citations.md) shares the bibliographic lookup
([`src/bibliographic.ts`](../../src/bibliographic.ts)) and names Debate's residual risk;
[experimental-features.md](experimental-features.md) is the switch it sits behind; and
[security.md § A third untrusted party](security.md#a-third-untrusted-party-what-the-model-returns)
has the web-search evidence collector Debate added.

---

Up: [reading-view-overview.md](reading-view-overview.md)
