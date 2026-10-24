# A web page with no date tag gets its publication date from its dateline or its address

A suggestion from Greg (admin: `feedback-reporter.ts` exits 0), 2026-10-23, on
`2025-11-02-what-if-you-dont-need-mcp-spya-ssvya4`, build db758ed8. Report #692:

> Why doesn't this show an estimated publication date? You know, as part of the import process, I
> thought we had an LLM that does this kind of thing, and it should be obvious from the publication
> slug in the URL, for example, what the publication date is. So that should be part of our import
> process.
>
> — Greg, 2026-10-23 (`spya-gapqbt`)

And a minute later, the addendum:

> Hmm, hang on. So there does look to be some kind of collapsed title and publication details thing
> at the top of the article, which I hadn't seen. I can't really tell what that is or where it's
> coming from, and it has an image inside it. But it does seem to have some kind of date. So I was
> expecting the date, though, to be more prominently at the top with the other metadata. So maybe
> this is partly just a UI issue. I'm not really sure what's happening.
>
> — Greg, 2026-10-23 (`spya-hdxhsx`)

## What is actually happening

The cause is mostly in the import. The UI part is smaller.

- **The masthead already prints the date when there is one** (*Published 2 Nov 2025*, plan
  [261015c](261015c-why-you-are-reading-higher-in-metadata-and-the-publication-date-in-the-masthead.md)).
  It printed nothing because nothing was stored. In production, this article's current revision has
  `published_at` and `published_year` both null (read 2026-10-24, inside `begin read only`).
- **Stage 2 reads a web page's date only from markup**: Readability's `publishedTime`, which comes
  from `article:published_time` or JSON-LD `datePublished` (`src/extract.ts` §
  `publicationDate`). This page (mariozechner.at) has neither. Its only dates are the visible line
  `<p class="text-xs italic">2025-11-02</p>` under its `<h1>`, and the address
  `/posts/2025-11-02-what-if-you-dont-need-mcp/`. The slug starts with `2025-11-02` only because
  the slug is made from the address.
- **No model estimates a web page's date.** Greg remembered one. The only things that fill a missing
  date are the Crossref/DataCite lookup on the article's own DOI (plan 261004a) and, for a minimal
  paper, the `metadata` step. A blog post has no DOI.
- **The fold Greg found is the `matter` step** ([front-and-back-matter.md](../project/front-and-back-matter.md)).
  It stored one stretch for this article, kinds `title` + `dates`, covering two blocks: the
  `2025-11-02` line and the header figure (caption *"One chonky MCP server"*). So the stub says
  title and publication details, but the title is not in it, because the masthead already draws
  the title. And it has folded away the article's own picture.

## As built, after the plan review

GPT Sol's review ([plan review](261024a-a-web-page-with-no-date-tag-gets-its-publication-date-from-its-dateline-or-its-address-plan-review-sol.md))
said *rework*. What changed, finding by finding:

1. **The address no longer competes with the registry** (blocker, partly taken). Sol was right
   that a weak address guess, written into `meta` at stage 2, would stop an agreeing Crossref day
   from ever being written (`withRegistryFacts` fills only an absent `publishedAt`). Sol also
   proposed dropping the address altogether. I kept it, because Greg asked for it by name (*"it
   should be obvious from the publication slug in the URL"*). Stage 2 now hands the address's day
   back beside `meta`, as `ExtractResult.addressDay`, and the `extract` step applies it
   (`withAddressDay`) **after** the registry, only when the article has no day and no year.
   *Estimated* labelling, with a separate provenance field, would be new state and a new UI word.
   That is left as a choice Greg can ask for, not built.
2. **The dateline is read only under a real heading, and only as a whole line** (taken). It is
   read only when the opening starts at the page's `<h1>` (`openingHeading`, which shares
   `readOpening`'s bounds, so the two cannot disagree). It is not read on a headless page, whose
   opening is the top of the body. The heading record itself, captions, lists, tables and later
   headings do not count. An ordinary opening record counts only when it is *all* date, with at
   most `Published` / `Posted on` before it. `Conference | November 2, 2025` and
   `Ada Lovelace · March 14, 2024 · 8 min read` are refused. The second is a real miss, accepted
   for now.
3. **The clock** (answered, not changed). `runExtract` takes one `new Date()` and uses it for both
   `fetchedAt` and the future check, so the two cannot disagree within a run. That `fetchedAt`
   moves with every re-extraction is existing, deliberate behaviour (the step's comment: *"the
   fetch date should follow"*). The ceiling is the calendar day in UTC+14 at that instant: the
   first place a new day can truthfully be today. A later day is refused and may be accepted after
   that day begins. The unit tests pass a fixed clock.
4. **The fold's figure** (taken): queue item `qi-jpj7mmhv`. It names the regression test, the
   three-set eval and the `MATTER_PROMPT_VERSION` bump, without which stored stretches keep
   folding it. **Until it lands, this article's header image stays folded with its dateline.**
5. **The controls** (taken): see § Tests, as built.

## What the plan first proposed: two more places to find the date, no model

When the page has no date tag, stage 2 tries two more sources, in this order:

1. **The page's own dateline.** These are the text records just under the article's `<h1>`, which
   extract already reads (`pageOpening`, src/front-matter-authors.ts). We look at the first few
   after the heading. A record counts when one of its segments, split on `·`, `•` or `|`, is
   nothing but a date. An optional `Published`, `Posted`, `Published on` or `Posted on` may come
   first. The record must be short (≤ 12 words) and must not say *updated*, *modified*,
   *edited* or *revised*. Accepted forms: `2025-11-02`, `2 November 2025`, `November 2, 2025`,
   `Nov 2, 2025`, `2nd Nov 2025`. These are English month names, read by our own code into an
   ISO day, so no `Date.parse` and no server timezone.
2. **The address.** A path segment `/2025/11/02/` (three numeric segments in a row), or a whole
   `2025-11-02` segment / conventional `2025-11-02-slug`. Percent escapes inside a segment are
   decoded first. The query string and fragment are never read.

Both give a calendar day, `YYYY-MM-DD`, and nothing else. A day goes through `realIsoDay`
(src/bibliographic.ts), which checks that the day exists and the year is plausible. It must also
be no later than the calendar day at the fetch instant in UTC+14, the earliest place a new day
begins: a future day is refused, not clamped. A day both refuse is no date, as today. **The page's
markup still wins** whenever it has a date, so no article that has a date
today gets a different one. The dateline goes before the address because it is what the author
wrote on the page. An address can be a site's filing scheme, or the day a draft was started.

These are claims, like the meta tag. `Meta.publishedAt` already says *"the publisher's claim,
verbatim, not a verified fact"*, and its comment gains one sentence naming the two new sources.

### Why not a model

Greg guessed there was a model for this. A free, deterministic read covers the case he reported,
and the common blog shapes (Jekyll/Hugo/WordPress addresses, a dateline under the title). It needs
no new step, no cost and no stage-ownership change, and it cannot invent a date. The model version
is the alternative I passed over: one cheap call over the opening, as `frontMatterAuthors` does for
affiliations. It would read *"Posted last Tuesday"* and foreign month names, and it would add a
paid call to every undated import, plus a prompt to evaluate. Worth building only if undated
imports turn out to be common after this. Not built.

### What changes for articles already imported

Nothing until one is re-read (the owner's *Read this again*), as with 261004a. No backfill. This
article gets *Published 2 Nov 2025* when Greg re-reads it. A backfill would be a production write,
so it is Greg's call, and is not asked for here.

### Freshness

Among generated pipeline artefacts, `publishedAt` is in Timeline's fingerprint only
(`datedArticleFingerprint`, src/source-hash.ts), by design. So a re-read that now finds a date marks
Timeline, and no other paid generated mode, out of date. Sources › Not cited separately includes the
article's year in its OpenAlex search fingerprint (`relatedWorkInputOf`, src/related-work.ts), so a
kept search says its query changed until the reader presses Search again; that is a free registry
request, not an automatic model rerun. Both need the year as a filter or frame.

## The fold, and the question of whether to ask Greg anything

- **The header image was folded because a four-word caption passes `furniture`** in
  `src/matter.ts`'s evidence check: ≤ `FURNITURE_MAX_WORDS` words, no sentence words, in a
  `title`/`authors`/`dates` stretch. That rule was written for short lines of text. A captioned
  `media` block is the article's own picture, not paperwork. That makes it a check bug, not a
  product choice. **But [front-and-back-matter.md](../project/front-and-back-matter.md) requires
  any change to a check to be re-run on all three eval sets**, and those corpora were never kept:
  they lived in a session's scratch directory, and the investigation says so. Rebuilding them is
  52 local imports and a fresh round of gold labels, which is a job of its own. So it goes in the
  Overseer's queue with this evidence, and is not done here.
- **Is there a UI question for Greg?** Not as a choice he has to make first. Once the date is
  stored, it is "more prominently at the top with the other metadata", which is what he asked for.
  The fold's ⓘ already says what it is. When the queued fix lands, this article's stub disappears
  (the stretch fails its check and is dropped whole), and the dateline shows as an ordinary line
  under the masthead. Nothing here adds complexity he did not ask for. **No question file.**

## Tests, as built

- `tests/page-date.test.ts`: both readers and `withAddressDay`. It covers the accepted forms, every
  refusal named above (a date-shaped title, a line with anything else on it, a headless opening
  with the headed control beside it, too far down, an impossible, pre-1990 or future day, the
  query string, fragment, a non-delimited date-shaped word and an arXiv id), the UTC+14 boundary,
  percent-encoded segments and a terminal `/YYYY/MM/DD`, and that an address day never replaces a
  day or sits beside a year.
- `tests/publication-date.test.ts`, through `runExtract` on the reported page's own markup: the
  dateline is taken, and no address day is offered beside it. With no dateline, the address
  comes back beside `meta`, not in it. The dateline beats a disagreeing address, and the markup
  beats both. A page with no `<h1>` and a date-only figure caption each give nothing. The undated
  control still has no key at all.
- `tests/article-registry-pipeline.test.ts`, through the real `extract` step: the address fills
  the day when the registry is unavailable. It loses to an agreeing registry's day, and to its
  year without sitting beside it. An undated address gives nothing.
- **Seen red.** The `runExtract` cases with the dateline wiring disabled (3 failed), and the
  pipeline case with `withAddressDay` handed `undefined` (1 failed). The downloaded page itself,
  through `runExtract`, gives `2025-11-02`.

## The code review

GPT Sol ([code review](261024a-a-web-page-with-no-date-tag-gets-its-publication-date-from-its-dateline-or-its-address-code-review-sol.md))
said *approve with changes*, and fixed four things in place. I read each fix and reran the gates:

1. **A date-shaped title or caption was read as the dateline.** The `<h1>` record itself is now
   skipped, and only a record cut at `p`, `div`, `header`, `section` or `article` can be a
   dateline. Captions, list items, table cells and later headings cannot. The element is held in a
   `WeakMap` beside the records (`openingRecordElement`), so the records the authors and title
   models see are unchanged. A record with no element known is let through, as before.
2. **The future ceiling** is now the calendar day at UTC+14, not UTC plus a day.
3. **The address** decodes percent escapes, and needs a whole `YYYY-MM-DD` segment or
   `YYYY-MM-DD-slug`, so `2024-03-14th-anniversary` is not a date.
4. **Freshness**: Sources › Not cited also reads the year (above), and that was missing.

One wider finding, not fixed and accepted: **once the address's day is stored, nothing records
where it came from**, so `backfill-registry-facts` (which fills only an article with no date at
all) will not later swap it for a registry day. A re-read, or the `metadata` step, still replaces
it. A blog post at a dated address rarely has a DOI. Fixing this needs a provenance column, which
is the same new state as an *Estimated* label, so the two would be built together if Greg asks for
either.

## Tests, as first proposed

- `tests/page-date.test.ts` (new): the dateline reader, on the forms above. The negatives: an
  *Updated …* line; a long sentence containing a date; a date after the first few records; a
  date-shaped record that is not a real day (`2025-02-30`). The address reader: `/2025/11/02/`,
  `/posts/2025-11-02-slug/`, a year-only `/2025/`, a date in the query string (ignored), a future
  day (refused), an implausible year.
- `tests/publication-date.test.ts` gains cases through `runExtract`. An undated page with a
  dateline under its `<h1>` gets that day. An undated page at a dated address gets the address's
  day. A page with both a meta date and a different dateline keeps the meta date. The existing
  `UNDATED` page, at an undated address with no dateline, still states nothing (no key), so the
  no-frame path stays covered.
- The real page: a fixture made from the mariozechner.at markup's head and opening (title, dateline,
  figure, two paragraphs), run through `runExtract`. It must come back as `2025-11-02`.

## Not doing

- No model, no backfill, no change to the masthead or the fold UI.
- No `<time datetime>` reading. `pageOpening` keeps text, not attributes, and a `<time>` in a
  page's body is as often a comment's or a sidebar's as the article's. Add it if a real page needs
  it.
