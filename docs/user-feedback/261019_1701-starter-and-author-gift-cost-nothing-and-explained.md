---
reports: spya-np36qf, spya-vuw2hy
ending: shipped
comment: Checked: a gift's starter article never uses the recipient's free articles (production agrees), and a test now holds it. /admin/vouchers now opens by saying what a voucher, a starter article and an author gift each are.
---
# A gift's starter article costs its recipient nothing, and `/admin/vouchers` says how the two kinds differ

Two admin reports from Greg (`feedback-reporter.ts` exit 0 on both), filed from `/admin/vouchers`
on build `cb956387`, batched as Overseer queue item `qi-wg9a9np8`:

> double-check that starter/gift articles don't come out of their 3 free allotted articles - if
> it's a gift, it shouldn't cost them
>
> — Greg, 2026-10-19 17:01 UTC (`spya-np36qf`, #617, SPIDERYARN-READING2-K9)

> explain the difference between starter article and author gifts more clearly - I'm confused!
>
> — Greg, 2026-10-19 17:02 UTC (`spya-vuw2hy`, #618, SPIDERYARN-READING2-KA)

**Ending: Shipped**, to `dev`, not deployed. Plan, with both GPT Sol reviews:
[261019i](../plans/261019i-starter-article-and-author-gift-cost-nothing-and-explained.md).

- **#617: it does not cost them, and never has.** A free article is used up only by an article the
  reader adds themselves. You added the starter, so its charge is yours. When they sign in and it
  moves to their account, your charge stays with you and nothing is charged to them. When it can't
  move (it is public, or has your notes on it), they read your copy by its link, which charges
  nobody. An author gift is the same voucher once sent. Production agrees: the one claimed voucher
  with a starter moved its article to the recipient, who has no charge on it. Nothing was broken,
  so the only change is a test that would catch it if a later change broke it. I watched it fail
  against a deliberately broken version first.
- **Two later charges, as for any article**, and left alone because changing them changes what a
  free article is: if they switch on High-powered AI for it, or import a copy of their own of one
  that stayed yours, that is charged as usual. Say if you want either to be free.
- **#618: the page now explains.** Three short paragraphs at the top of `/admin/vouchers`: a
  *voucher* adds free articles; it may name a *starter article*, one of yours that their email
  links, which uses none of their allowance; an *author gift* is a voucher drafted for one of your
  articles' authors, with that article as its starter, and once Send succeeds it is an ordinary
  voucher in the list. The Author gifts section says the same in one line. So they are not two
  kinds of gift but one, and a shortcut to it.

This session had no Sentry sign-in step of its own and did not write the Sentry status; the next
feedback sweep does.
