---
reports: spya-x5e966, spya-tqsw3u
ending: awaiting
comment: A refused import now says to use the page's Download PDF, and the add page has an Upload button right under it. Finding a free copy, or taking the page from your browser, is a question for you (q-fp8tqr).
---
# cell.com refused the app: a better way round now, and a question about the bigger fixes

`spya-x5e966` (#580, Sentry SPIDERYARN-READING2-J0), a problem from Greg (admin;
`feedback-reporter.ts` exit 0 on the production row), filed 2026-10-15 17:11 UTC from
`/add/https%3A%2F%2Fwww.cell.com%2Ffulltext%2FS1364-6613(15)00180-1`. With it, `spya-tqsw3u`
(#581, SPIDERYARN-READING2-J2), a shorter repeat filed 20:34 UTC from the same article once it
was on his shelf. Queue item `qi-pm65t8nq`. No addenda on either. Plan and reviews:
[261015a](../plans/261015a-a-site-that-refuses-the-app-a-better-way-round-and-the-bigger-options-for-greg.md);
research:
[261015a](../research/261015a-getting-a-page-behind-a-bot-check-extensions-bookmarklets-open-access-copies.md).

> I was trying to download:
>
> https://www.cell.com/fulltext/S1364-6613(15)00180-1
>
> `The site refused to give this app the page. Sites that turn away automated readers answer this
> way, and this one will most likely answer the same again. If the page opens in your browser,
> save it as a PDF and upload the file. [fetch-refused]`
>
> I can see it in my browser (though there was a check of some kind to verify that I'm human, so I
> had a suspicion this might happen). What can we do to solve this for users going forwards? A
> browser extension? Something else?
>
> Use Sonnet to search the web for ideas/best practices/etc.

(#581 says the same, without the bot-check sentence and the Sonnet line.)

**Ending: Awaiting Greg**, on [q-fp8tqr](questions/q-fp8tqr.md), with the small part shipped on
`dev` and not deployed.

What we did:

- **Research** (a Sonnet subagent on the web, probes from the box). cell.com, its PDF, PubMed
  Central and Europe PMC's site all turn our server away; the article is CC BY open access, and
  the only copy the server can read is Europe PMC's JATS XML API. The tools that get past these
  walls (Readwise Reader, Zotero, Instapaper's bookmarklet) all take the page from the reader's
  own browser.
- **Built**: the `[fetch-refused]` and `[jb-bot-check]` sentences now say to use the page's
  Download PDF, or save it as a PDF, and upload that; and the add page shows a one-file upload
  control under any failed import whose sentence says to upload.
- **Asked**: whether to measure and then build an automatic open-access copy, a bookmarklet, or an
  extension.
