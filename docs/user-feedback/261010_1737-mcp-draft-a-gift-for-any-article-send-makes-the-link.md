---
reports: spya-cwb56b
ending: shipped
comment: An agent can now draft a gift for any article on your shelf; your Send makes the private link. You chose C on q-pe52f6; who may build it is asked in q-hpwyf0.
---
# MCP: draft a gift for any article on your shelf, and Send makes the link

Admin report from Greg (`feedback-reporter.ts` exit 0), `spya-cwb56b` (#548,
`SPIDERYARN-READING2-GX`), a suggestion filed 2026-10-10 17:37 UTC from `/changelog`, build
`29220e7d`. Overseer queue item `qi-vm6y7nd4`. This session had no Sentry sign-in and did not write
the Sentry status; the next feedback sweep does.

> Improve the MCP as you see fit.
>
> For example, I want to be able to create draft gift voucher, and I want to be able to trigger this
> new author gift flow that we've been working on and, you know, make sure that it's rich. So I want
> to be able to say, okay, I found this blogger, find their email address and create a draft gift
> voucher for them for whatever you think the best essay is, and draft a, you know, suggested email
> in the private, in the comments field or something like that from ChatGPT app or wherever, like,
> and it should all just work. And think about other stuff I might want to do. So I might want to be
> able to import new articles, make them public, etc.
>
> — Greg, 2026-10-10

## What we did

The plan, its two GPT Sol reviews and every decision:
[261010r](../plans/261010r-mcp-gift-any-article-and-send-makes-the-link.md).

Most of the example already worked on `dev` (`draft_author_gift`, the notes field, import, the
remote server). It broke at one step, every time, for a freshly imported essay: the draft was
refused because the article was private with no link, and nothing on the remote server can make
one. Now:

- **`draft_author_gift` drafts any article on your shelf**, link or no link. It still never makes the
  link, so a model never confirms sharing rights for you.
- **Send on `/admin/vouchers` makes the link**, for a gift whose article has none, once you tick the
  same "I have the right to share this" box the article page has. Only a fresh Send makes it, never
  a replay, and only for the gift's own article.
- **Both MCP servers now tell the model how the gift tools fit together**: import and wait, check
  nobody has had a gift, draft with a suggested email in the notes, and send you to
  `/admin/vouchers`.

## Deferred, each queued

- **Making an article public, or handing over its private link, from a web app**: a change to a
  safety catch, so it is a question for you: `q-pe52f6`, queue item `qi-jpw55yrq`.
- **Reading an article through MCP** (`get_article`), so an agent writes the suggested email from
  Spideryarn's copy and can compare essays already on the shelf: `qi-qf6g25gq`.
- **`look_up_author` on an existing draft**, with Sol's question whether an agent's paid lookup
  should need a press of yours at all: `qi-sxcqvptg`.
