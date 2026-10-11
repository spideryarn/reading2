---
reports: spya-wqvxjv
ending: shipped
comment: A draft gift now has its own address for the agent to open; a private gift article becomes the recipient's when they sign in; /admin/articles moves any article. Titles of other readers' articles stay hidden there.
---
# Author gifts: a link to the draft, the article passing to its recipient, and /admin/articles

Admin report from Greg (`feedback-reporter.ts` exit 0), `spya-wqvxjv` (#550,
`SPIDERYARN-READING2-GZ`), a suggestion filed 2026-10-11 01:06 UTC from `/admin/vouchers`, build
`00081085`. Overseer queue item `qi-nv3v2p2n`. No addenda. This session had no Sentry sign-in and did
not write the Sentry status; the next feedback sweep does.

> Can we create & return a URL for a draft author gift, that the harness can open in a browser for me?
>
> Also, it when the recipient of the gift voucher with an associated article signs in, we actually
> want to transfer ownership to the private link that we've sent them, so that they then own that
> article and can use chat and everything else fully.
>
> And more generally, we want a /admin/articles page, which includes a way for me to transfer
> ownership of an article from one user to another. I realise there are a bunch of potential
> complexities here. Like, what happens if I'd filled out though why you're reading this for the
> article? Use your judgement and just pick whatever is going to be good for the user but avoids too
> much complexity. Check it works with tests and/or browser automation.
>
> — Greg, 2026-10-11

## What we did

The plan, GPT Sol's plan review (rejected revision 1), Opus's arbitration, the code review and every
decision: [261011n](../plans/261011n-author-gift-link-and-article-ownership-transfer.md).

- **The draft's own address.** `draft_author_gift` answers `review: …/admin/vouchers?gift=<id>`,
  and `list_author_gifts` gives each gift a `url`; the page opens on that card, highlighted.
- **On sign-in, the article becomes theirs.** When the recipient claims the voucher (on their shelf,
  or on opening the private link while signed in), its article moves to their account and the page
  reloads as their own article. It moves by itself only when it is private, the starter of no other
  voucher, and carries none of your own notes or chats; otherwise the voucher is claimed as before
  and the card says to move it on `/admin/articles`.
- **`/admin/articles`** lists every article and moves one to another account, after showing what
  will be deleted.
- **Your example, "why you're reading this"**: reset on a move, with your rename and archive. Your
  comments, chats, quiz answers and searches on it are deleted, so the new owner never reads them.
  The article is made private and its old link stops working; the new owner can share it again.
  What you were charged for it stays yours and stops moving with their choices.
- **Titles of other readers' articles are not shown** on `/admin/articles`, keeping admin.md's line
  that which articles a reader has stays in their session; your own and public ones are. Say if you
  want every title shown: it is a one-line change.

Deferred, with its own queue entry: `qi-3recafqm`, closing a narrow race in which a write of the old
owner's already in flight as a transfer commits lands on the new owner's article.
