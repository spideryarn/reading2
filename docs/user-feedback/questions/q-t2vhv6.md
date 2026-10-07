---
id: q-t2vhv6
report: spya-vc6pnm
status: open
asked: 2026-10-06
title: May a gift voucher's email carry a starter article by private link?
refs: SPIDERYARN-READING2-ED · qi-zqkjnadh · docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md § Q-starter: may the voucher email carry a private link? · docs/user-feedback/261006_2222-gift-voucher-name-note-and-a-starter-article.md
---
Background. Your report about gift vouchers shipped as Their name on the voucher form, so the voucher email now opens "Dear so-and-so,". This is one of the two halves left for you. You want the voucher email to say "here is that article in Spideryarn", with a link only that person can open. The private link you approved on 2026-10-05 is that kind of link. The question is only whether the app may put one into an email for you.

A private link ends in a key of 22 random characters. Anybody who has the address with the key on it can read the article; nobody else can. Because the key is the whole lock, the app is strict about where it goes. Today we keep it in one column on the article's own row and nowhere else in our database, and it is deliberately kept out of our request log, Sentry, feedback reports, the export and the page's preview tags. Where the key may go is a listed security defence, so nothing was built.

A. The email carries the private link. On the voucher page you pick one of your own articles; if it has no private link, the form makes one after the same rights tick-box the sharing card asks for. If the article is public, the plain public address is used and no key is involved. The voucher keeps only which article, never the key; the key is read once when the email is queued and written into that one email, and the voucher page tells you when the link in a sent email no longer opens. Costs: the key is newly kept in one more place of ours, the table that keeps each voucher email exactly as sent, and in two that are not ours: Resend, our mail provider, which logs what it sent, and the recipient's inbox, which is the point. Anyone they forward it to can read the article, as with any private link. Gives up the rule that our database holds the key in one column only. One to two days.

B. Only a public article can be the starter. The same picker, listing only your public articles, and the email links to the ordinary public address. No key goes anywhere new and no security rule changes. Costs: the article has to be public, which means listed on the public shelf, and you said "not a public one". A little under a day.

C. Nothing built: paste the link into the note yourself. It works today. Not recommended, because it spreads the key further than A: it is then also in the voucher's own row for good and in every load of the voucher list, as well as the kept email, Resend and the inbox. Nothing would tell you when the link stopped working, and the link is plain text rather than a button.

D. Nothing built: send the link from your own email. You said you might write to some people from your own address first. The private link can go in that message and the voucher email stays as it is. The key then touches nothing of ours that it does not touch today.

What would decide it: if you expect to send more than a handful of these, A, which is the thing you asked for. Its risk is modest, because the article is yours, the link can be turned off, and you would be mailing the same link from your own address anyway. D if you would rather watch how the first few go before adding anything. B only if keeping the key in one column matters more to you than the article staying unlisted.

Recommended: A. Until then, D rather than pasting the link into the note.
