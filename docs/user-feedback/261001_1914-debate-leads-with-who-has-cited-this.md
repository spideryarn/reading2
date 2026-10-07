---
reports: spya-zuk4f7
ending: shipped
comment: Both stages shipped: Debate asks for work that cites the piece, and OpenAlex supplies its count and list of citing papers.
---

# Debate leads with who has cited this article

SPIDERYARN-READING2-9D · report `spya-zuk4f7` · suggestion from Greg (admin, provenance proved by
`feedback-reporter.ts`) · 2026-10-01, reading Melnikoff & Bargh 2018 in Debate.

> I find the debate mode a little bit strange. I think I was hoping it would emphasize more people
> that have cited this article. So it might be one of those things that's not very helpful, that's
> sort of more helpful for older and more famous articles. But that's what I'm really interested in.
>
> Has anyone cited this article either supporting or criticizing? I think it's helpful that debate
> mode also includes stuff like, oh, you know, are the claims corroborated? but I'd say that's
> secondary.

**Ending: shipped.** Rows about the piece already led the panel;
on a well-known paper there were almost none. Replaying what the model said showed it often found
the right replies and our checks threw them away: we checked quotes against only the first of
several extracts the search returned for a page (a bug —
[postmortem 261002g](../postmortems/261002g-debate-refused-quotes-from-a-later-extract-of-the-same-page.md)),
and its "this names the article" quote often left out the title. Stage 1 fixes both and asks the
search for work that cites the piece. Over twelve paid runs on two papers, the rows kept about the
piece went from 4 to 10, and they are the published critiques and replies.

Greg chose OpenAlex on 2026-10-04. Debate now sends the article's DOI to it and shows its count and
list of citing papers. The decision and both stages are in
[261002i](../plans/261002i-debate-leads-with-who-has-cited-this-article.md); the OpenAlex work is
recorded in [261004h](../plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md).
