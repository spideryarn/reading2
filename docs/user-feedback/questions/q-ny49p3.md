---
id: q-ny49p3
report: spya-m53cdk
status: answered
asked: 2026-10-18
title: Citation notes: also web-search the one citation I clicked, and get free Semantic Scholar and OpenAlex keys?
refs: SPIDERYARN-READING2-JF · qi-e94mtfjx · docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md · docs/investigations/261017c-citation-blurbs-cost-and-quality.md · docs/user-feedback/261017_2026-sources-land-flash-and-citation-blurbs.md · docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md
acted: spya-dzhqj8
---
Two questions about the short note now shown under each cited work in Sources › Bibliography.

What is built (on dev, not deployed): when a Bibliography is made, each cited work's abstract is looked up in public catalogues (Crossref, and DataCite, which holds arXiv's abstracts), and Haiku 5.5 writes one or two sentences from that abstract alone. Code checks that each sentence quotes the abstract, and a second Haiku call checks each sentence is supported by it, or no note is shown. On the shipped code: about 1.6 cents for a 70-work article, 74 of 75 sentences supported, none about the wrong work. Your Butlin paper gets notes on 28 of its 70 works (40%); a coding-benchmarks paper 64%; an essay whose references are descriptions, not titles, none.

The other way, one web search per work, cost about 30 cents an article in the spike, and 17% of its sentences said more than the page did (names, numbers, affiliations from the model's memory). One of its notes was written from the article that cites the work.

1. When you press Open in Sources on a citation that has no note, should we also run a quick web search for that one work?
   A. No. Say nothing, and leave Ask in chat as the way to dig. Costs nothing, and never puts an unchecked sentence on screen. (Recommended)
   B. Yes, for the clicked work only. It would take only the work's own page, never someone else's, and require a quote the code finds in the page. About 0.8 cents and 6 seconds a press. Even with those checks, expect roughly 1 sentence in 6 to say more than the page does.

2. Should I get free API keys for Semantic Scholar and OpenAlex? They would be accounts in your name; I cannot make them.
   A. Not now. Stay on Crossref and DataCite, which need no key, at the coverage above. Books and older papers mostly get no note.
   B. Yes. Semantic Scholar holds abstracts Crossref lacks: in the spike it supplied 12 of the 75 notes. I would expect your Butlin paper to go from 40% to somewhere around 55%, which I would measure before claiming. OpenAlex could then also be searched by title. You would create the two accounts and add the keys to the box; I would add them to the env setup and the code. (Recommended)

Details

Your report (2026-10-17): on a citation's hover card, Open in Sources opened Sources but did not show which work it meant. The list had little room. Sources is not that helpful, and Ask in chat is heavy and slow for a quick look. You suggested a web search plus a two-sentence blurb per source, asked what that would cost for every citation, and suggested Haiku 5.5.

What else is done: Open in Sources now centres the work in the list and flashes it. The "we have read none of these works" line moved into the band's (i). The threshold's note is one line instead of two.

The note on a row is in the AI's font, with a quiet "From the abstract · Crossref" under it. Hovering or tapping that says what the note is: an AI's, written from the abstract alone, a quick look-up in a public catalogue, not a web search and not a reading of the paper, so it can be wrong; and it shows the words of the abstract each sentence was checked against. The same note shows on the citation's hover card in the prose, to visitors on a shared link, and to chat. Ask in chat stays for a real look.

Why no note for many works: many works have no DOI or arXiv id, so we can only search by title, and we accept a title match only when the first author and year agree. For an uploaded file (which may be a confidential manuscript) we do not search by title at all, only by identifier. Books, chapters and web pages rarely have an abstract in these catalogues.

Why no key means less: without a key, Semantic Scholar refused most requests (rate limits), and OpenAlex's free daily search allowance for the box ran out on the day of the spike. So v1 leaves Semantic Scholar out, and asks OpenAlex only by exact DOI.

Greg's reply, 2026-10-18 (spya-dzhqj8, in the Feedback dialog):

> 1B / 2B

Acted on by the feedback sweep, 2026-10-19 (queue item qi-nkc5gbyh), plan 261018o. 1B: Open in Sources on a citation with no note now runs one web search for that work, owner only, and keeps a note only from the work's own doi.org or arXiv page, quoted and checked by a second call. 2B: Semantic Scholar (abstracts) and OpenAlex (title search) are built, each off until its key is set; Semantic Scholar also needs an approval setting, because its free licence is non-commercial. The follow-ups (making the accounts, the licence, and whether to loosen the web search) are a new question, q-x9srvv.
