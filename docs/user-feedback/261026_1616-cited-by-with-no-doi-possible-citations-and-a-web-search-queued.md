---
reports: spya-vx23nt
ending: shipped
comment: With no DOI, Sources now lists Possible citations: free, papers whose text matched the title (Experimental features; ~4 in 5 really cite it). Your web search with a model judging each page is designed, waiting on the AI key's 1 Nov reset.
---
# Cited by with no DOI: Possible citations now, the web search queued

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-26 09:51 UTC, a suggestion filed from
`/read/index-spya-wq3rud?mode=sources`. Sentry SPIDERYARN-READING2-PC (#713). Session
`fbvx23nt-cited-by-web-search`. No addenda when re-read before acting and before this note.

> "We had no DOI for this piece, and searching OpenAlex by its title found no record we could be
> sure is this one, so we cannot list who cites it."
>
> This seems a little bit defeatist. I mean, I understand that it's much easier to tell who cites it
> with OpenAlex, but I feel like it should be possible to do a web search based on author names or
> something with Google Scholar, or I don't know, that would, you would then have to hand to an LLM
> to interpret, that would give us an indication of who cites it, even if that means, yeah, so we
> perhaps we hand excerpts of the potentially citing articles that we found in the web search to an
> LLM to say is this a citation of this article or whatever, and then, yeah, I just feel like it
> should be possible to do this, that as well, the slower and slightly more expensive way, with a
> web search.

**Ending: Shipped**, on `dev`, with the paid half queued as
[`qi-zwrwsjz8`](../project/overseer-queue.md). Plan
[261026f](../plans/261026f-cited-by-when-there-is-no-doi-from-the-full-text-and-a-web-search.md);
measurement
[261026a](../investigations/261026a-cited-by-with-no-doi-full-text-and-web-search-recall-and-cost.md).

**Said plainly first: what shipped is not quite what you asked for.** You asked for a web search
with a model judging each page. Before building that, the research found a free source that answers
most of it: OpenAlex's full-text search, which lists research papers whose text matches the title.
That is what is on screen now. Your web search, which is the only way to find **blog posts and web
pages** that cite a piece, is designed in the plan's Stage 3 and could not be measured today,
because the box's OpenRouter key is spent until 2026-11-01. A prompt is not shipped unmeasured, so
it is the queue entry.

**What you will see** (with Experimental features on). Where the sentence above was, in *Papers
that cite it* and in Reception's *Cited by*:

```
We have no DOI or sure OpenAlex record for this piece, so there is no citation list.
Instead, a search of research papers' text:
│ Possible citations   25 of 129                                  newest first
│ Research papers whose text matched a search for this piece's title. Most will
│ refer to it; we have not checked each one.
│   <paper title> ↗
│   <authors · venue · year>
│   …                                                        Show all 25
│ See all 129 at OpenAlex, a free index of research papers ↗
│ This finds research papers only. Blog posts and web pages that cite it are not here.
```

For your piece, 129 papers; for Weng's *LLM Powered Autonomous Agents*, 278; for Graham's *Do
Things that Don't Scale*, 31 — against nothing before.

**Why behind the switch.** Of every row the panel would show across the test pieces, 143 of 175
readable ones (82%) cite the piece; the top five, 94%. That is short of the 95% a list shown to
everyone should meet, so it is labelled *Possible*, never *Cited by*, never counted, and kept
experimental. With the switch off, the title is not sent to the full-text search at all.

**What it will not do.** A title too short or plain to search by (*Simulators*, *Feature
Visualization*) keeps the plain sentence, and one whose words were common in papers before the piece
existed gets a sentence saying so instead of a list, because a search cannot tell a citation from
the phrase. Uploads never send their title. Google Scholar is not used
(its terms forbid automated queries) and nor is Semantic Scholar (you declined it).

**Costs.** The list is free and runs when Sources opens. Stage 3 will be a press, owner only,
estimated at a few cents (one Haiku call with Exa, at most two searches, a spend fuse in code); if
it measures well above $0.30 a press it comes back to you as a question.

**Worth knowing, not done here.**

- Production's `.env.prod` has no `OPENALEX_API_KEY` (Vercel's environment was not checked). The
  list works without one, on OpenAlex's shared polite allowance, but a key gives it its own.
- On a phone, the *Search the literature* paragraph in *Where it sits* pushes *Papers that cite it*
  below the fold, and the three paid buttons there would read better named by their outcome. Both
  belong to plans 261025h and 261026g, whose sessions are working there today.

Reviews: GPT Sol on the design, the plan (seven P1s, all taken) and the code of both stages (two P1s
in Stage 1, one in Stage 2, all fixed); Opus on the design; four persona reviews; a browser check
on desktop and phone.
