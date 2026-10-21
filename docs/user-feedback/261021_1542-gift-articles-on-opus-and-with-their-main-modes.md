---
reports: spya-s902kr
ending: shipped
comment: Every gift's article now gets its main modes made, and the Give form has a High-powered AI box (on by default). It uses Opus for what is still to be made; whether it should also redo what Sonnet already made is my question to you.
---
# A gift's article gets its main modes, and High-powered AI if you tick it

An admin report from Greg (`feedback-reporter.ts` exit 0), filed from `/admin/vouchers` on build
`804e055b`. No addenda.

> Provide an option for me to set author-gift/starter articles to be imported with high-powered AI.
>
> Oh, and by default, any articles that we share as part of this should automatically get their
> main modes generated as well.
>
> — Greg, 2026-10-21 15:42 UTC (`spya-s902kr`, #668)

**Ending: Shipped**, to `dev`, not deployed. The plan, with both GPT Sol reviews and the costs:
[261021j](../plans/261021j-gift-articles-on-opus-and-with-their-main-modes.md).

- **Main modes, by default.** A new author gift (Give form, *For the author…*, MCP's
  `draft_author_gift`) and a new voucher with a starter now queue the article's main modes, the same
  list an import makes, in the transaction that makes the gift. This ignores your own *Generate
  the main modes* setting. A mode already made is skipped at no cost.
- **High-powered AI.** The Give form has a tick box, on by default. Each draft card says whether its
  article is on and has a *Switch on* button. MCP's `draft_author_gift` takes `high_power`, off by
  default. Each one switches the article to Opus before the modes are queued, so whatever is still
  to be made is made on Opus.
- **Not done, and asked:** redoing the modes Sonnet already made. That is the literal "imported with
  high-powered AI" for an article already on your shelf. It costs about $1.50 a gift and needs
  Glossary and Quotes to replace rather than add. Question `q-trk64h`.
