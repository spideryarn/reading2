---
reports: spya-w7t24d
ending: shipped
---
# Debate mode says what each source is, and the list has orders

SPIDERYARN-READING2-5P (`spya-w7t24d`), from Greg (admin), filed on
`/read/pnas-202123432-spya-rekvg9?mode=debate`. The time in the file name is when the report was
dispatched to this session; the report text came in the brief.

> In Debate mode, make it clearer what the paper title/authors being referenced is. (You can see it
> with a tooltip on the (i) button, but we want that to be more prominent somehow. Perhaps show
> default-truncated with a button to expand?
>
> And add some UI to filter at the top of Debate mode (take inspiration from Glossary), e.g.
> chronological order; positivity, relevance, and a prioritised mode (default) with thresholding.
> Use your judgment.
>
> And more generally, there's something about the way the information is presented for the various
> papers in Debate mode that is confusing. Take screenshots, and/or as other agents (prompted to
> pretend to be different personas or a product manager) to look for ways to make the presentation
> clearer & more useful.

**Ending: Shipped** — on `dev`, not deployed. Resolve 5P; the next feedback sweep does the Sentry
status write. Two follow-ups rest with you, below.

What changed:

- **Each row leads with the page's title**, in full ink and linking out, clamped to two lines. The
  site goes underneath it. A `more` button opens the full title and quotation, the AI's paragraph,
  the address and the extract note. It replaces the ⓘ hover card, so it now works by tap and
  keyboard too.
- **The AI's reading is one line near the top** (*"AI · bears directly · corroborates · 👍
  Supportive"*), not a box at the bottom. The *ON WHAT IT CLAIMS* pill is gone. The quotation is
  clamped, and a row is about half its old height.
- **An order bar, as Glossary has one:**
  - **prioritised** (the default): rows about the piece first, then how directly the AI judged each
    page bears on its claim;
  - **by claim**: sources grouped under the article's own sentence they answer, in the order the
    piece makes them;
  - **stance**: critical first;
  - **date**: built but dormant (see below).

  An order is offered only when it would change the list.
- **Thresholding.** Prioritised has a relevance bar over the claim rows (*bears loosely / partly /
  directly*). It starts at "hide nothing", because the judgment is new and unevaluated. The existing
  identification bar still governs rows about the piece.
- **Your article needs a re-run** from Metadata to get *prioritised*. Its stored debate predates the
  relevance judgment, so it opens in *by claim*.

How it was decided: screenshots of your article, then three Opus personas — a PhD student, a
sceptical senior researcher and a product manager. All three said the same things: lead with the
work, move the verdict up, group by claim, and make rows shorter. The plan, the shots and their
reports are in [260929h](../plans/260929h-debate-mode-clearer-sources-and-orders.md).

**Authors and year are not shown yet, and that is the first follow-up.** The search was asked for
them and checked against the page. They verified on one row in eleven, because the text the search
engine hands back is a passage from the middle of the page, not its head. Showing the model's
unchecked guess at who wrote a paper felt wrong. The fix is a bibliographic lookup: DOI or arXiv id
from the address, else an OpenAlex title search. That is a new outside service, so it is your call.
The byline and the date order are built and waiting for it. See plan § Deferred.

**Second follow-up: visitors.** The relevance judgment does not reach a visitor, because the public
DTO is a security defence and this run did not edit it. A visitor gets the new row layout and the
*by claim* and *stance* orders.

Short of the plan's own target: a phone screen shows about two and a half rows, not three.

Measured: ten paid eval runs, about $2.35, plus one real re-run (~$0.25). Two GPT Sol reviews, of
the plan and of the code; the code reviewer fixed eight findings.

## Follow-up, 2026-10-01: visitors

**Visitors now get the relevance judgement**, so *prioritised* and its bar work for them as they do for you. The authors-and-year decision (a lookup service) is still yours and stays in awaiting-approval.md. Greg approved widening the public DTO (a listed defence), relayed by the Overseer. Shipped in `6c1b2cd2`, with GPT Sol's code-review fixes in `7431f0fd`. Plan: [261001b](../plans/261001b-public-article-visitors-see-debate-threads-relevance-citation-entry-and-cross-references.md).
