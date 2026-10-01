---
reports: spya-emvua7
ending: shipped
---
# Citations say whether we read the cited paper, and quote it when we saw some of it

SPIDERYARN-READING2-5G (`spya-emvua7`), from Greg (admin), dictated through the Feedback dialog. The
time in the file name is when this session picked the report up. The report text came in the brief,
because this session had no Sentry access.

> Okay, so when in citations mode, like the questions that we might want to ask, what were they? You
> said something like, how well does it support what it's being footnoted to support? Yep. And
> generally, what were they doing in that paper? Yeah, okay. So you might need a web research to
> actually read the paper itself, ideally. And if you can't do that, then you should be really clear
> that you couldn't. But if you can, then you should ideally, you know, in the tool tip or whatever,
> include quotes or something that suggests that whether the paper does say what the cited paper
> says what this paper says. be really careful to be clear about whether you could get the actual
> paper, so that we can be sure you're not hallucinating

Greg clarified the same afternoon, through the Overseer: *"re 5G I was specifically thinking about
Citations mode. I was basically thinking of ways to tweak that prompt/UI"*.

**Ending: Shipped.** It is on `dev` (c2d63f06) and not deployed. Resolve 5G; the next feedback sweep
does the Sentry status write.

What we did:

- Every row in Citations mode, and every citation's hover card, now says what we have read of the
  work. Usually that is *"We have not read this work, only the article that cites it."* The sentence
  about the work is labelled *what the article uses it for*, so it no longer reads as a description
  of the paper.
- *Find it* is now **Look it up**, offered on every row. Its one web search also reads the search
  engine's extract of the matching page, which is usually the abstract. The AI says whether that
  extract supports what the article uses the work for, and what the work does, with short quotes.
  **Every quote shown was found by code in that extract.** A verdict without a quote is downgraded
  to *the extract doesn't show this — the full work may*. There is never a flat "does not support".
  The row says exactly what was read: the extract, its size and the site it came from. It says it
  was not the paper itself.
- A link the article gave never changes, and a stale reading is never shown.

Not done: reading the full paper. That needs new fetching machinery. It is written up as a proposed
later stage in the plan, for Greg to decide.

Plan: [260929g](../plans/260929g-check-a-cited-paper-supports-the-claim.md).

## Follow-up, 2026-10-01: Citations reads the paper itself

Greg answered the open call, relayed by the Overseer: *"Oh, Citations definitely needs to read the
paper! Especially the References/Bibliography section. Otherwise it's useless!"* **Shipped** on
`dev`, not deployed.

- **Investigate now reads the cited paper itself** when it can: the row's own DOI or arXiv link, or
  the page the quick check matched. Only a PDF's text is counted as the paper. Code must confirm
  it is this work (the title at the top of page one, plus its identifier or first author), and a DOI
  whose registry title disagrees with the article's is refused before anything is fetched.
- **The row says what was read**, dated: *we read the paper itself: a PDF from arxiv.org, 9,000
  words…*, or why we could not (the publisher turned us away, only an abstract page, we could not
  confirm it was this work).
- **Up to three passages from the paper**, each found by code in the text the AI was shown, with
  the page number. The streamed answer still may not quote. Any words shown as the paper's are the
  paper's own characters.
- **The article's own reference list** was already read for HTML and for numbered PDF lists (6J and
  6K). Now a DOI or arXiv id in a PDF's entry becomes the row's link, which is what lets the paper be
  reached from a PDF article.

Real runs on twelve works: four papers read (every arXiv row whose identity was clear). nature.com and
Wiley turn us away. Three gwern-style rows titled only *Santoro et al 2016* are left unconfirmed on
purpose, because an author and a year cannot catch a mistyped identifier. About 22¢ a press.
Citations as database rows was weighed with GPT Sol and Opus and deferred; the plan says why and
what it would take.

Plan: [261001a](../plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md).
Commits 229d363b, 6b2afb28, 5bfff263, bed811d5.
