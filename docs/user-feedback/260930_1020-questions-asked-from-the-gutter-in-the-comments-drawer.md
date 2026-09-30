---
reports: spya-q59jex
ending: shipped
---
# A question asked from the gutter is in the Comments drawer

[SPIDERYARN-READING2-6W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6W), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from Trajectory mode on
`pmc13013618-spya-uekgh6` with the Comments drawer open. The time in the file name is when this
session picked the report up. It had no Sentry access and the report text came in the brief. The
header above was added by the feedback sweep on 2026-09-30, from the issue's `report_id` tag.

> I just asked a question, but with clicking the sort of question mark icon in the vertical gutter
> next to a block, and I got a good answer, and that was great. And then I clicked the X in the top
> right to close it. I was expecting, therefore, that to show up when I clicked on the comments, but
> it seemed like my question had disappeared, and I couldn't remember which block it was, so I
> couldn't check to see whether it was still there. I think if I ask a question, I expect that to
> show up in the comments so that I can find it again or find the answer again. Perhaps somehow
> flagged as a question rather than a comment, but still there.

**Ending: Shipped.** On `dev`, not deployed. Resolve 6W; the next feedback sweep does the Sentry
status write.

**It was never lost, only hard to find.** The "?" saves a chat about the whole paragraph, not a
comment. The X only closes it, and the answer is stored. But the Comments drawer listed comments
only, and a chat about a whole paragraph leaves no mark in the text.

What we did:

- **The Comments drawer now lists the questions you asked beside your comments**, in the order they
  come in the article. Each has a **Question** label and the paragraph's opening, or the words you
  selected. This covers both the "?" and *Chat about this* on a selection. Pressing one opens that
  conversation and scrolls the paragraph into view. From Remember mode it switches to Chat.
- The count on the Comments button counts questions too.
- There is no answer preview on a question's row. The preview isn't kept up to date, so a question
  you had just asked would have said *thinking…* under the answer you had just read.

Plan and both GPT Sol reviews:
[260930f-gutter-questions-listed-in-the-comments-drawer.md](../plans/260930f-gutter-questions-listed-in-the-comments-drawer.md).

**Not done:** the arrows in a comment's dialog still skip questions. Chat mode's list still titles
every "?" conversation *Help me understand.* A question's row has no answer preview.
