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
