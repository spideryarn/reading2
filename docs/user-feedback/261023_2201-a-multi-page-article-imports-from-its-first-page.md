---
reports: spya-qkyukr
ending: shipped
comment: Pasting superdark's front page now imports all four pages as one article (344 blocks, not the 2,246-character abstract). Haiku judges every web page, ~$0.0005 each; nobody is asked.
---

# A multi-page article imports from its first page

Report `spya-qkyukr` (#676), from Greg (an admin), filed 2026-10-23 22:01 UTC on the homepage,
build `db758ed8`. A suggestion.

> I would like to be able to import this article just by feeding it the front page and trusting that
> the LLM will do the right thing. … I suspect that Haiku looking at it might be cheap enough to
> justify that for every single HTML page. … so long as it costs only, you know, I mean, ideally less
> than a cent, but a few cents would be fine, I'd conceivably be willing to just do this for every
> single HTML article … Although most users aren't going to really understand that, so it doesn't
> seem there's much point in asking the user. So yeah, I think we should just try and do the right
> thing by the user.

**Ending: Shipped**, on `dev`. Plan
[261024p](../plans/261024p-a-multi-page-article-imports-from-its-first-page.md), measurement
[261024c](../investigations/261024c-multi-page-articles-readability-and-a-cheap-judge.md), GPT
Sol's reviews of the plan and the code beside the plan.

**What it does.** Every fetched web page gets one Haiku 5.5 call, about $0.0005 and two seconds,
asking whether the page is only part of its piece and which of its own links carry the rest. The
model answers with ids of ours for links on the page, never addresses. When it says yes, the pages
are fetched (same site, through the usual guarded fetch, at most 20 and 30 MB), each stored as its
own source, and stage 2 reads each with Readability and joins them, each chapter under its own
heading. Nobody is asked, as you said. Any failure imports page 1 alone, exactly as before.

**superdark, imported on the local stack**: 4 pages, 344 blocks, 43,042 words (before: the
2,246-character abstract); the judge cost $0.0002. Read in a browser: abstract, then Chapters I, II
and III in order under their own headings, contents links landing in their own chapter, Structure
showing the four in order.

**How well it judges.** 32 real pages (9 that must be followed, 15 that must not, 8 borderlines):
right on every decision over three runs, and every page picked on 25 of 27 runs of the pieces that
continue. On 13 pages gathered after the prompt was frozen: it never followed a page it should not
have, but missed 5 of 18 continuations. A miss leaves the reader with page 1, which is today's
import.

**What it does not do, decided rather than asked:**

- **A chain of pages.** Only page 1's links are read. A piece whose front page links only to its
  next page comes in partial, and one held-out landing page (keepthefuturehuman.ai) had two teaser
  chapters joined to it. Queued as `qi-5532t2dr` (a proposal: yours to authorise).
- **Forum threads** are not followed: their later pages are replies, which Spideryarn leaves out on
  every page already.
- **Repeated boxes** (Tom's Hardware's author bio on every page) stay: dropping text because it
  repeats could drop a refrain.
- **One slot**, as any web page is, whatever its length.
- **Model-written extraction JavaScript**: not built. Every page found was server-rendered, and
  running code a stranger's page steered is a security change of another order.
- **A shared host** (medium.com, sites.google.com): a hostile page there could have another
  author's page joined to it. Logged as risk [R32](../project/security-risks.md#r32), proposed
  rather than built against.

This covers the multi-page case. The wider idea in the report — a model noticing that Readability
failed on a single page in some other way — was not built; nothing in this work's corpus needed
it.
