# Giving people their own writing, in Spideryarn

Make a Spideryarn version of something a person wrote, send it to them privately, and ask what it
gets wrong. Two experiments use this, and an admin tool is being built to make it cheap.

Up: [marketing-overview.md](marketing-overview.md) · [vision.md](vision.md)

## First experiment: five old contacts, their own papers — *trying, from 2026-10-09*

Greg sends five grad-school contacts a private link to their own most recent paper in Spideryarn,
with a short personal note asking what it gets wrong, and calls them where he can. They are warm,
they will answer honestly, and they are the best judges of whether it got their argument right.
Each reply is a user interview, and it tests the author-gift idea below on friendly ground first.
Greg, 2026-10-09: *"That's a good idea for the first experiment. I might try and actually talk to
them on the phone at the same time."* He will pick the five and draft the notes from a
knowledge-work harness, through Spideryarn's MCP server ([mcp.md](mcp.md)).

## Authors: a gift, not a republication — *idea, to run as an experiment*

> I was hoping is I would start to create public articles or at least private links for articles,
> perhaps for somewhat famous authors and bloggers who might be flattered or think that Spideryarn
> actually is a better presentation that will help readers understand their stuff. … It's just a
> hypothesis. Perhaps they'll resent it. I think our SEO stance probably might reassure them.
> Obviously we want to be ethical, so if they don't want it, we'll take it down. Maybe that's why I
> thought the private links was a more careful way to proceed.
>
> — Greg, 2026-10-09

- **Send a private link and ask first.** "I made this of your essay; only you have the link; would
  you like it public?" reads as a gift. Finding your essay already republished does not.
- **What is already true reassures the author.** A shared article is `noindex` and points back to
  the original page, and there is a takedown promise.
  [public-readable-sharing.md](public-readable-sharing.md) is the single home for those claims.
  Quote it rather than restating it.
- **The risk is accuracy.** The author is the one reader certain to notice if the AI gets their
  argument slightly wrong. Greg reads each page before sending it.
- **Greg's doubt is the thing to test:** writers want readers on their own platform. A cheap first
  test is ten academics and ten bloggers, private links only, counting replies and how warm they
  are. Since 2026-10-09 the aim is a conversation more than permission: bloggers are the people
  most likely to say yes to a Zoom call.

## A tool to make this cheap

Greg, 2026-10-09:

> For admins in the add page when the article is being imported, perhaps we could add a button or
> something that says this is potentially going to be for marketing to the author, and then that
> would automatically switch on the higher capability AI processing and make a private link and
> perhaps do a web search to try and figure out who the author is and see if we can find an email
> address for them.
>
> And if so, can we create a draft gift voucher? … So it would create a gift voucher that's ready
> and populated but hasn't been sent. … And so then it would be easy for me to then say, okay,
> great, I'm gonna click send on the gift voucher. Perhaps draft a separate email from myself.
> There's already a private link populated in the gift voucher.

Most of the parts already existed: High-powered AI for one article
([high-powered-ai.md](high-powered-ai.md)), private links
([public-readable-sharing.md § A private link](public-readable-sharing.md#a-private-link-the-same-republishing-to-fewer-people)),
and gift vouchers that can carry a starter article by private link
([billing.md § Gift vouchers](billing.md#gift-vouchers-extra-free-articles-given-by-email)).
What was new is a voucher that is saved but not yet sent, the author-and-address lookup, and one
button that does all of it. **Built on 2026-10-10**, as Greg asked the day before: *For the author…*
on the add page, and *Author gifts* on `/admin/vouchers`, where each draft waits with its notes
until Greg presses *Send* — nothing is emailed automatically. How it works is
[admin.md § Author gifts](admin.md#author-gifts-a-draft-voucher-for-an-articles-author); the plan,
its reviews and every decision are
[261010c](../plans/261010c-author-gift-draft-voucher-from-the-add-page.md).
