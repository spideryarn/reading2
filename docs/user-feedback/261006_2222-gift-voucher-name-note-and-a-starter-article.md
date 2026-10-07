---
reports: spya-vc6pnm
ending: shipped
---
# Gift vouchers: their name, a note, and a starter article

Report `spya-vc6pnm` (SPIDERYARN-READING2-ED), a suggestion, from Greg (admin, proved by
`feedback-reporter.ts` exit 0 on the production row), filed 2026-10-06 22:22 UTC from an article
page. The words are from that row, as the Overseer relayed them:

> As part of building up awareness of Spideryarn, I want to try sending out to a whole bunch of friends initially, and then potentially people I know less well that I think would appreciate it. So we have the machinery for sharing links, great, or creating links that only people who have that link can read the article. Okay, so we can use that. We also have the machinery for creating gift vouchers. Okay, super. And I think those can even have private notes, I guess. What I kind of want to be able to do is build up a big list of, you know, ideas of people I know or people I've read online I think would appreciate it that I can potentially contact. I think maybe what I might do, at least for some of them, it would be send them a note from my own personal email address first, especially if they know me, and then, you know, something from their Spideryarn gift voucher. Okay, so one thing is it would be nice, perhaps, to be able to add a starter link as part of the gift voucher, optionally. So if there's a particular paper that I think they will like, and to be able to optionally mark that as a shareable link, not a public one, but a shareable one. I don't know if that's the right term, but one that only people with that link can open. Anyway, so can we expand the admin gift vouchers interface to allow adding a URL and/or maybe a Spideryarn... ID or something like that. That would probably be easier. Maybe if I just import the thing first and then, yeah. So make it easy for me to choose something to share with them so that potentially the gift voucher would say something like, Dear so-and-so. So maybe it needs a name field as well. Dear so-and-so, you know, some kind of note from me. You know, I thought you'd really appreciate this because I read your article and, you know, I thought you'd get a kick out of some of the things that we're doing here. And then, by the way, here's what that article looks like, and here's a gift voucher for 20 more or however many if you want to redeem them. So that's the intent. Use your best judgment about how to make that happen and make it easy for me.

**Ending: Shipped**, on `dev`, the part that edits no security defence. Plan
[261007f](../plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md).

- **Built: *Their name*.** A new optional box on `/admin/vouchers`. With a name, the gift email
  opens *Dear Ada,* above the note to them. Without one the email is what it was. The note to
  them was already there (since 2026-10-02).
- **Not built, a question for Greg: the starter article.** The private link exists, but an email
  that carries it keeps the link's key in a second place of ours and at our mail provider, and
  where that key may go is a listed defence. Four options in the plan; recommended is to build
  it, with the voucher keeping only which article. Queue entry `qi-zqkjnadh`.
- **Not built, a question for Greg: the big list of people.** A voucher sends its email and
  becomes claimable the moment it is made, so it cannot hold people who are only candidates.
  Three options in the plan. Queue entry `qi-dajb32q7`.

**The questions for Greg are now files**, `docs/user-feedback/questions/q-t2vhv6.md` (the starter
article) and `docs/user-feedback/questions/q-avh98t.md` (the list of people), moved there from
`awaiting-approval.md` on 2026-10-07. He sees them in the Feedback dialog and replies there
([feedback-reports.md § Asking Greg a question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)).
