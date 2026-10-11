---
reports: spya-xv3q97
ending: shipped
comment: Ask in chat on a cited work now quotes the sentences where the article cites it, and asks first what point the article uses the work to make and whether the work supports that, then for the outside background.
---
# Ask in chat about a citation starts from the article

Report `spya-xv3q97` (#574), SPIDERYARN-READING2-HR, Greg (admin, provenance proved by
`feedback-reporter.ts`), 2026-10-11 09:32 UTC, a suggestion, filed from a chat started on a cited
work in `rhizome-1000-plateaus-introduction-lambert-says-spya-jc9azw`:

> When we ask in chat, for example, for this citation, I think I was hoping for a bit more about how
> it relates to the article, what the article is trying to say with it, and then whether it's
> justified, as well as all of this external stuff.

**Shipped**, to `dev`. *Ask in chat* on a Bibliography row, or on a cited work's hover card in the
prose, used to send the work's title and *"What does it say, and does the article use it fairly?"*.
That led with the work, and the model was not told where the article cites it. Now:

- **The sentences that cite it go with the question**, quoted from the article, up to three.
- **The question is in Greg's order**: what point the article uses the work to make, whether the
  work supports that (saying so when it cannot check the work itself), and then anything else about
  the work that helps with the article.

Measured before and after on nine works across three articles, with a blind judge: on *what the
article uses the work for*, the new question won 7–1 against a control that split 2–2. On *is that
use justified* there was no difference beyond noise, and the outside material still comes, after.
Older chats keep the question they were asked.

**Not done here:**

- Checking the claim against the cited work's own text is `qi-sq25xqqf`, already running as
  *does the cited work say that?*.
- A work cited only through a footnote gets the new question but no citing sentence:
  `qi-qt5aasgd`.

The plan, both GPT Sol reviews and the eval:
[261011ab](../plans/261011ab-ask-in-chat-about-a-citation-leads-with-how-the-article-uses-it.md).
