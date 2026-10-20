---
reports: spya-cf30ac
ending: shipped
comment: The details page now says "You own this article" (and which account) or "You don't own this article". As admin you also see who owns another reader's public article. Private-link owners and who opened a link wait on q-agbc89.
---
# The details page says whose article it is

`spya-cf30ac` (#622, suggestion, `SPIDERYARN-READING2-KF`), from Greg (admin; `feedback-reporter.ts`
exit 0 on the production row), 2026-10-19 17:29 UTC, from
`/read/tinbergen1963onethology-spya-ks84se/metadata`. Overseer queue item `qi-kz4dtr4a`.
Addenda: none.

> It doesn't seem obvious who owns an article, so I'm lost track of whether this is an article that
> I own or whether it's an article that somebody else owned when I set up a gift voucher for them.
> Maybe it could be under the sharing section.
>
> I'm an admin, so I want all of the details that we have, e.g. Who owns it? Whether it's public?
> Whether there's a private link for it? How many people and who have opened the private link? Etc.
>
> But for a non-admin user, it should only tell them if they're the owner, or if it's public, or if
> it's a private link, etc.

**Ending: Shipped**, on `dev`, with a deferred half queued. Plan
[261020j](../plans/261020j-say-who-owns-an-article-on-its-details-page.md), both GPT Sol reviews
beside it.

- The owner's *Access & sharing* card opens with **You own this article. Signed in as …**. Public
  and private-link state were already its two switches.
- A signed-in visitor's details page has an **Access** section: **You don't own this article.**
  The public-or-private-link line was already in its banner. Nothing is claimed to a signed-out
  reader or an unconfirmed session, either of whom may be the owner.
- **As admin**, on another reader's **public** article, the same section adds *Admin: it belongs
  to <address>*, read from the existing `/admin/articles` list.
- **Not built, and asked** ([q-agbc89](questions/q-agbc89.md), queue item `qi-pf9h5nps`): the owner
  of an article you read through a **private link** (GPT Sol's plan review showed that widens the
  admin privacy rule, so the page says it is not shown), and **who opened a private link**, which
  nothing records today and which is a new field stored about readers.
- The Tinbergen article itself was not looked up in production; once this is deployed, its details
  page answers it.
