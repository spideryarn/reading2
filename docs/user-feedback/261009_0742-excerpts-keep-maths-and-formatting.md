---
reports: spya-pqae7m
ending: shipped
comment: Quotes in Skim, and the article's words wherever a mode shows them, now draw formulas as maths and keep italics, bold and sub/superscripts, as the paragraph does. Links show as plain words there.
---
# A quote in Skim showed raw LaTeX — and every other excerpt lost its formatting

Report `spya-pqae7m`, from Greg (an admin; `scripts/feedback-reporter.ts` exited 0), filed
2026-10-09 07:42 UTC, on *Attention Is All You Need* in Skim; session
`fbpqae7m-excerpt-formatting`. No Sentry sign-in in this session, so the next feedback sweep marks
the Sentry issue.

> I saw a quote in skim mode that referred to some LaTeX formulae that was just showing the
> unrendered LaTeX. It should be obviously showing the rendered LaTeX.
>
> I wonder if there's anything else that we should also be doing (is other formatting or rendering
> etc), whether maybe if the quote had italics or bold or something like that, that we should also be
> preserving that in skim mode.
>
> And consider whether there are other modes where we need to also handle this. I don't know. Quotes
> mode itself, or glossary, or anywhere else where we're excerpting text, we want to preserve the
> formatting. Perhaps do this with some kind of reusable excerpt machinery?

**Ending: Shipped**, on `dev`. Plan
[261009k](../plans/261009k-excerpts-keep-maths-and-formatting.md).

**Why it happened.** A stored quote is a slice of the block's plain text, which holds a formula as
its TeX source and has lost every `<em>`. Every mode drew that string. The paragraph itself is drawn
from the block's html, with its maths turned into MathML as the article loads, so the two
disagreed.

**What changed.** One shared piece, `<Excerpt>` (src/web/Excerpt.tsx, src/web/excerpt-html.ts),
finds the words in the block's own markup, keeps inline formatting (italic, bold, sub/superscript,
code), draws the maths with the same renderer the paragraph used, and puts the result back through
the article's sanitiser. It is used at 33 places: Skim, Quotes, Ideas, Timeline, Search, FAQ,
Claims, Criteria, Mirror, Debate, Glossary, Citations, Illustrated, Marginalia, the hover cards
behind every passage chip, the Dock, the comment, annotate and chat dialogs, and the info page.
Links become plain words, and a displayed equation sits in the line. A few short phrases stay plain
on purpose; the plan lists them.

**Checked** in a browser on a local copy of BERT: 10 of its 39 quotes carry maths, and every one
drew as maths in Quotes and Skim, with no `\(` anywhere on the page.
