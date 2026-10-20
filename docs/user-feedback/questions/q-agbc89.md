---
id: q-agbc89
report: spya-cf30ac
status: open
asked: 2026-10-20
title: Show an article's owner to an admin on a private link, and record who opens a private link?
refs: spya-cf30ac · SPIDERYARN-READING2-KF · qi-kz4dtr4a · qi-pf9h5nps (the deferred half) · docs/plans/261020j-say-who-owns-an-article-on-its-details-page.md · docs/plans/261020j-say-who-owns-an-article-on-its-details-page-plan-review-sol.md · docs/user-feedback/261019_1729-the-details-page-says-whose-article-it-is.md · docs/project/admin.md · docs/project/privacy.md
---
Your report asked an article's details page to say who owns it. That is built: everyone now sees "You own this article" or "You don't own this article", and as an admin you also see the owner's address on another reader's public article. Two parts of your ask wait for you, because each changes a privacy rule.

1. On an article you are reading through somebody's private link, should you, as admin, see whose it is?
A. No (today). The page says the owner is not shown. /admin/articles lists the article without its title, as a short id beside its owner's address; you can match that by hand to the spya-… at the end of the article's address.
B. Yes. The page shows the owner's address. Small: about an hour. It changes the admin rule "never which articles somebody has" for any private link you hold.
Recommended: B, if you only ever open private links that people sent you on purpose. Otherwise A.

2. Should we record who opens a private link?
A. Nothing (today). Nobody, owner or admin, can see who opened it.
B. Count page loads per link. Cheap, but it counts loads, not people: one person reloading three times is three.
C. Record the signed-in accounts that open it, plus a count of signed-out opens. Tells you who, but only among people signed in. It needs a new table, a small extra call from the page, and a line on the privacy page.
Recommended: A for now, and C when someone actually needs it.

Details

What you asked, 2026-10-19 (spya-cf30ac), from the details page of an article: it was not obvious whether you owned it, or whether it belonged to the person you had set up a gift voucher for. As admin you wanted everything: owner, public or not, private link or not, and how many people, and who, had opened the private link. A non-admin should only be told whether they own it, and whether it is public or a private link.

What is built (on dev, not yet deployed): the details page's "Access & sharing" card now starts with "You own this article. Signed in as your address." On an article somebody else shared with you, the details page has an "Access" section saying "You don't own this article." The public-or-private-link line was already there, in the box near the top. As admin, on another reader's public article, you also see "Admin: it belongs to their address."

Why question 1 waits. The admin pages have a rule: they show accounts, counts and dates, but never which articles a particular reader has. /admin/articles shows another reader's private articles only as an id beside their address, with no title. A private link lets you read an article. Showing you the owner's address on that page joins the article to the person, and the person who gave you the link may not be the owner. GPT Sol's review called that a widening of the rule, so it is yours to approve. The match by hand under A exists today and is not new; B would make it automatic. Public articles are already listed by title on /admin/articles, so showing their owner changes nothing.

Why question 2 waits. Today nothing is written down when someone opens a private link, and the privacy page says so. B and C each change that, so the privacy page would change too. A link's reader is often signed out, and the page fetches the article without saying who is asking. So "who" is only knowable for people signed in, and only through a separate call. Neither option is retroactive: counting starts from the day it ships.
