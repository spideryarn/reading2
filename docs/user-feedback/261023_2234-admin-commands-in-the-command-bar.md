---
reports: spya-v88mga
ending: shipped
comment: On dev. Type "gift" in the command bar while reading your own published article: a dialog over the article drafts the author gift, nothing sent. Also "what it cost" and the /admin pages and /design, for the administrator only.
---
# Admin commands in the command bar, and an author gift without leaving the article

Report `spya-v88mga` (#683), a suggestion from Greg (`feedback-reporter.ts` exit 0, administrator's
row, no addenda when re-read before this note), filed while reading
`effective-expressiveness-spya-z8dehh`. Session `fbv88mga-admin-command-bar`.

> I was hoping to be able to somehow access it, you know, from the command bar or whatever. I guess
> this might be a bit complicated because it's something that would only be available to admins. So
> maybe that would require us to have a kind of admin-specific set of functionality that would only
> be included in the command bar for admins. Probably it would just open up the relevant page in
> /admin. But do a review of all the functionality we might want to include that's admin-specific
> and add it to the command bar. And if there's a way to do this without leaving the article, that
> would be even better.

**Shipped.** The command bar has rows of the administrator's own, which appear only when typed
(an empty bar opens on the same list as before):

- **Gift this to its author** (type `gift` or `author`) closes the bar and opens a small dialog
  over the article, so you don't leave it. With no gift yet it shows the same rights tick and
  *High-powered AI* box as the Give form and drafts the gift. With one already it says how far it
  has got (draft, sending, sent, discarded, lookup still running) and links to its card in Gift
  vouchers in a new tab. **Nothing is emailed from here**: Send stays on the Drafts card, beside the
  exact email.
- **What it cost** goes to that section of Metadata, in place.
- **Admin, Admin › Users, Feedback, Gift vouchers, Articles, Costs** and **Design reference** open
  those pages.

Left out on purpose, because each needs a choice the bar can't make: *view as a reader* (needs a
person and a reason; Users is a row), *move this article to another account* (needs a target;
Articles is a row), and Send.

They are hidden from everybody else, and from you while you *view as* a reader. The server is what
enforces it: every request behind them is under `/api/admin`, which refuses anybody who is not the
administrator, so hiding the rows is a courtesy and not the gate. The rows are never shown to the
model that picks commands from a sentence. The dialog's code is downloaded only on the first press.
In passing, two places said the author lookup makes "up to three searches"; it is five, and both
now follow the limit.

The review of which admin functions belong, the design, GPT Sol's plan and code reviews and what
changed for them are in
[261024n](../plans/261024n-admin-commands-in-the-command-bar-and-an-author-gift-without-leaving-the-article.md);
[admin.md § The command bar's admin rows](../project/admin.md#the-command-bars-admin-rows) is the
standing description.
