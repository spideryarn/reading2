---
reports: spya-weuekx
ending: shipped
comment: Shipped for web articles; the empty "figure" was Box 1 of the paper, and all four boxes now import. A PDF's tables don't get the link yet (queued, qi-zbpqb2r9). This article changes only if re-imported.
---
# Figures and tables open in the original, and arXiv's boxes keep their words

Report spya-weuekx (#697, `SPIDERYARN-READING2-NW`), 2026-10-24 16:55 UTC, a suggestion, from an
admin (Greg; `feedback-reporter.ts` exit 0), on Butlin et al., *Consciousness in Artificial
Intelligence*, imported from arxiv.org/html/2308.08708, at block `spya-rme98g`. No addenda (re-read
2026-10-24).

> All figures and tables and anything else like that extracted from the original article should
> provide a subtle UI widget of some kind that enables you to go back to the original article to see
> that diagram. I say that because the one that I'm looking at doesn't seem like it's been imported
> correctly.

**Ending: shipped** on `dev`.

- **The widget.** After every figure, table and video of a web article there is now a faint ↗ icon.
  It opens the publisher's page in a new tab, aimed at that figure where the page lets us. A PDF's
  figures already had theirs.
- **Why that one looked wrong.** It was not a figure: it was **Box 1, "Determinacy, degrees,
  dimensions"**, which reached you as an empty frame. Boxes 2, 3 and 4 had the same fault, about
  1,800 words in all. arXiv draws a titled box as a picture with its words laid over it, and our
  import only knew how to take the words out of a box *without* a title bar. Now it handles both,
  and the image inside Box 3 comes too. Checked on the live page: all four boxes come out whole.

Not done here: **a PDF's tables** get no icon yet, because the import doesn't record which page each
table is on (queued as qi-zbpqb2r9). **This article is not re-imported**, because that would be a
production write; a re-import would bring the boxes back.

Plan, with both GPT Sol reviews and the production reads:
[261024w](../plans/261024w-figures-and-tables-open-in-the-original-and-a-titled-arxiv-box-keeps-its-words.md).
