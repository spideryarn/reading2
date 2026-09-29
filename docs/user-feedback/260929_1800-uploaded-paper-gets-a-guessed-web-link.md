# An uploaded paper gets a guessed link back to the web, with a question mark

SPIDERYARN-READING2-5H (report `spya-wsz0q4`), from Greg (admin). The time in the file name is
roughly when this session received it; it could not read Sentry for First Seen.

> If someone uploads a paper, maybe as part of the import process, we should do a quick Google to try
> and find the canonical link for that paper and then add it, maybe with a question mark somehow to
> say that we've guessed at where the original URL was from. And if we can't find it for sure, if
> we're not, we don't find an exact match, then don't, don't link.

**Ending: Shipped** — on `dev`, not deployed. Resolve 5H (the next feedback sweep does the Sentry
status write).

What we did — [260929g](../plans/260929g-canonical-link-for-an-uploaded-paper.md) has the reasoning,
the reviews and the eval:

- The first time the owner opens an uploaded article, one web search runs in the background (the
  same search Citations' *Find it* uses). A found page is shown after *uploaded* in the masthead and
  on the Metadata page, dimmer than a real address, ending in **?**, with a tip saying it is our
  guess.
- **Code, not the model, decides it is the same paper**: the exact title, the first author, and
  either the page's DOI/arXiv id printed in the upload or the same opening text. Otherwise nothing
  is linked. Eval on 7 real uploaded papers: 3 links, all right, none wrong; 3 missed because the
  publisher's page refused us.
- Assumptions (the simplest version): it runs when the article is first opened rather than inside
  the import; owner-only; no retry button.
