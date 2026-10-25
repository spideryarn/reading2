---
id: q-x9srvv
report: spya-m53cdk
status: answered
asked: 2026-10-19
title: Citation-note keys: will you make the OpenAlex and Semantic Scholar accounts, given S2's non-commercial licence?
refs: SPIDERYARN-READING2-JF · qi-nkc5gbyh · q-ny49p3 · docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md · docs/user-feedback/261017_2026-sources-land-flash-and-citation-blurbs.md
---
You said yes to both (1B and 2B). Both are built, on dev and not yet deployed, and they need two things from you, plus one decision I could not make.

1. The keys. Semantic Scholar's free licence is for non-commercial use only, and Spideryarn charges. The code uses Semantic Scholar only when its key is set and a second setting says the use is approved, so nothing happens until you decide.
   A. Make both accounts. Add OPENALEX_API_KEY now. For Semantic Scholar, request the key saying Spideryarn is a paid reading app that shows a one-sentence AI note drawn from a paper's abstract, linked back to Semantic Scholar, and ask AI2 whether that needs their expanded licence. Add SEMANTIC_SCHOLAR_API_KEY, and set SEMANTIC_SCHOLAR_COMMERCIAL_USE=approved only once they say yes. (Recommended)
   B. OpenAlex only. Skip Semantic Scholar. Less coverage: in the spike, Semantic Scholar supplied 12 of the 75 notes.
   C. Semantic Scholar's ordinary key now, and set the approval yourself, accepting the licence risk while we are a small beta.

2. The web search when you press Open in Sources on a citation with no note. I promised it would take only the work's own page, never someone else's. Code can only prove that when the page is the work's own DOI address (doi.org) or its arXiv page, so that is the rule as built. On your Butlin paper that means at most about 1 in 3 of the works with no note can get one this way. The rest have no identifier we could find, so the press stays silent and costs nothing.
   A. Keep it strict for now, and I measure how often it finds a note once it is deployed. (Recommended)
   B. Loosen it. Also accept other pages whose title is exactly the work's and that name its first author (a publisher's page, a catalogue, an author's copy), and label the note "from a page that looks like this work's, which may be someone else's description of it". More notes, but some written from a catalogue, a review or an encyclopedia page.

Details

Where the keys go, once you have them (names only; values never go in git):
- The box: add both to the .env.local that gjd-remote push-env sends (the names are already in its allowlist and in .env.example).
- Production: add the same names to Vercel's production environment. Without that, readers get nothing from them, because the notes are made on Vercel.
- Sign-up: OpenAlex at openalex.org/signup, then Settings, API key. Semantic Scholar from "Request an API key" on semanticscholar.org/product/api.

What each key buys:
- OpenAlex is free and CC0. A free key raises its daily allowance tenfold, from about 100 title searches a day for the whole box to about 1,000. With it, a cited work that Crossref cannot find by title is also searched for in OpenAlex, under the same strict rule: the title, first author and year must agree.
- Semantic Scholar holds abstracts that Crossref lacks. With it, a work we have identified but whose abstract Crossref does not hold gets its abstract from Semantic Scholar. A note from it says "From the abstract · Semantic Scholar" and links to its page, as their licence asks. Their licence also asks for their logo on public pages showing their data. I have not added the logo; that waits on AI2's answer.
- Once the keys are in, I will measure the Butlin paper's coverage again; it was 40% without them. I expect around 55%, but that is a guess until measured.

The licence, in its own words: use is limited to "legitimate, non-commercial, research and/or educational purposes", and it forbids "embedding or installing the API into products for Licensee's own commercial gain". Other uses need an expanded licence from AI2. OpenAlex has no such limit.

How the web search press works, as built. It runs only when you, the owner, press Open in Sources on a citation's card in the prose, and only for a work with no note. It never runs for visitors, and never for every work. It runs one quick web search for that work on Haiku. A page counts only if all of these hold:
- the page is one the search actually returned;
- it is the work's doi.org address or its arXiv page, for exactly that DOI or arXiv id;
- it is not the article you are reading, or a copy of it;
- each sentence quotes words that code finds in the page;
- a second Haiku call, shown only that page's text, says every sentence is supported.
The note is then kept, so a second press costs nothing. If no page passes, the row says so, and pressing again within a week does not search again. It costs about 0.8 cents and about 6 seconds a press, and there is a cap per hour and per day. Its card says it came from one web search, is not a reading of the paper, and can be wrong.

A first live try, on three cited works: one got a correct note from its doi.org page (Bryson, Robots should be slaves). One got none, because the search's text of the page was only a fragment (Nagel's bat paper). One was refused for running too long; the prompt now states the limit, and on a second try it got a correct note from its arXiv page (Chollet, On the measure of intelligence). Each took about 6 to 7 seconds and 0.8 cents.

Greg's answers, 2026-10-25, in chat, relayed in the brief for this work.

Part 1:

> I'm not going to use Semantic Scholar then because I don't want to break their terms of use.

1B: Semantic Scholar stays off; OPENALEX_API_KEY is on Vercel, not yet on the box (qi-7ttvvyjm).

Part 2:

> re q-x9srvv - I don't fully understand, but I don't think we want to be so restrictive that we only trust DOI or archive pages. I think we want to be looser.

Built (plan 261025d): a page titled as the work that names its first author also counts, labelled "may not be the work's own page". Butlin paper: 4 notes before, 14 after, all on the right work.
