---
reports: spya-cf30ac
ending: shipped
comment: The details page says "You own this article" or "You don't own this article". As admin you also see whose it is on a public or private-link article, and since 21 October who opened its private link.
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
- **Asked, then built** ([q-agbc89](questions/q-agbc89.md), queue item `qi-pf9h5nps`). The owner of
  an article read through a **private link** widened the admin privacy rule, and **who opened a
  private link** was a new record about readers, so both were put to Greg. He chose both
  (reply `spya-xug3kf`, 2026-10-20 21:41 UTC):

  > As an admin, I want to be able to see anything. Because after all, I've got access to the
  > database anyway. And it may be useful for debugging. And yes, I'm interested to know and store
  > which users open which articles.

  Built on `dev` by plan
  [261021d](../plans/261021d-admin-sees-a-private-link-s-owner-and-who-opened-it.md), with both GPT
  Sol reviews beside it. As admin, the details page says whose the article is on a private link too,
  asked with the link's key, so only for an article you can already open. And from 21 October 2026
  a private link's opens are recorded: the signed-in accounts (first and last time, how many
  times) and a rough count of signed-out opens. Only the administrator sees them, on the details
  page; owners are not shown. The privacy page and Help say so. The signed-out count can be inflated
  by anybody holding the link, throttled; a request limit is risk R31, proposed.
- The Tinbergen article itself was not looked up in production; once this is deployed, its details
  page answers it.
