---
reports: spya-duh4w3
ending: shipped
---

# Authors and affiliations folded away by default

A suggestion from Greg (admin; `feedback-reporter.ts` exit 0 on the production row), 2026-10-06
22:16 UTC, on `2608-13566v1-spya-yurten`, `?summary=fuller&stop=spya-gs7srt&at=spya-rksbq3`.
Sentry SPIDERYARN-READING2-EC. Queue item `qi-e5cj927m`.

> A lot of articles start with a list of authors and maybe acknowledgements and a bunch of other
> stuff that's not super interesting. I wonder if there's a way that we can identify them as such
> and default collapse them so that you kind of jump straight into the article itself when you
> first open it. And more generally, I feel like often the author names and affiliations and
> whatnot are not really imported that well. So you have permission to look read-only through the
> production database and sample from a whole bunch of the articles. Maybe even just look at the
> first few hundred words or whatever. And I think you'll often discover, you can take
> screenshots, that the formatting is a bit screwed up. Now, some of that we fixed, but we didn't
> go back and re-import the old articles. Okay, but even for newer ones, and you can try a few
> sample ones from the web if it helps, I think you'll often see that, you know, the line breaks
> aren't right, the affiliations aren't quite right. I mean, maybe we even have a special
> affiliations tooltip type because that would be clean. I don't know, maybe that's overkill. But
> just given that the author names are one of the first things that show up, and not just them
> but related stuff, let's try and both clean it up in terms of visual presentation. And also, I
> think we have some kind of author import process that creates them as first-class
> representations. I mean, in an ideal world, you'd be able to see all the papers by a given
> author. I think right now when I click on an author... Name, it basically takes me to the
> logged-in homepage for a search by that name, which is okay, but it would be cooler to be able
> to do a kind of proper search for that, you know, as an object rather than a string match. That
> might be overkill, and actually it's probably out of scope for now. Maybe it's a separate task.
> I think what's most important, though, is just the author inputs and tidying up the
> presentation so that you can see the article because they're default collapsed.

**Shipped**, the afternoon-sized version, in
[261007d](../plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md).

- **Folded by default.** The blocks under the title that are authors, affiliations and contact
  lines start folded away, so the page opens on the article. *Show authors and details* on the
  masthead opens them, and so does a link or a search hit that lands on one. It works on the
  articles already imported, because it is a rule in the reading view and changes no data, and
  on new imports, whose page no longer starts with a title heading. On
  production today it folds 22 of 49 articles, 45 blocks, each read in full: none is the article's
  own prose. It leaves a byline showing wherever it is not sure, which is 9 articles.
- **Imports.** All 49 production articles and 19 live arXiv pages were sampled. The reader of
  arXiv's HTML author block already existed (two days old); it now takes three more shapes and
  gets 12 of 19 pages right, none wrong. Affiliations are not read off those pages: the obvious
  rule was measured wrong on 7 of 19 with no sign of it.
- **The affiliations tooltip exists** (260929d): hover an author's name in the masthead, wherever
  the article has a structured author list. That is 9 of 49 today, which is the real gap.
- **Acknowledgements** are at the end of every article sampled, never the start, so nothing was
  built for them.

**Decided against the reviewer, yours to overturn** (plan § The plan review, F9): the byline rows
fold even where the masthead has no clean author list. On the article this was filed from the
masthead still shows the first of twelve authors with `Affiliation: …` glued on, and the full
list is now one press away. Re-importing it fixes the masthead; that is a write to production
and was not made.

**Deferred, each queued for Greg:**

- `qi-xymdbpa3`: authors as first-class objects, with a page of an author's papers. Noted, not
  built, as the report says.
- `qi-qchvsn9k`: re-extract the existing articles so their mastheads get clean authors (the same
  sweep as `qi-tjb2xjmj`).
- `qi-fddb7wb8`: mark front matter at import, so models and exports skip it too, and so keywords,
  mid-body dates and the bylines the rule leaves showing are covered.
