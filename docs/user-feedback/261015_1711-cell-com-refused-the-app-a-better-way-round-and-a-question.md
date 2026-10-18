---
reports: spya-x5e966, spya-tqsw3u
ending: shipped
comment: A refused paper link now imports Europe PMC's free full text instead; your cell.com link comes in this way. Otherwise the Save for Spideryarn bookmarklet saves the page to upload, and it keeps its address.
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

**Ending: Shipped**, 2026-10-18, on `dev` and not yet deployed, after Greg answered
[q-emrf2p](questions/q-emrf2p.md) (and before it [q-fp8tqr](questions/q-fp8tqr.md)). Nothing is
left deferred: the one open item is Greg trying the bookmarklet on a walled page once it is live,
which is a trial, not unbuilt work.

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

**After Greg's reply** (`spya-wm83gt`, 2026-10-17, to q-fp8tqr: *"A and/or B as you see fit. Look
for a way that's clean and good for the user."*), queue item `qi-q62g96s9`, plan
[261017b](../plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md):

- **Measured A** ([investigation 261017a](../investigations/261017a-which-refused-paper-links-have-a-free-copy-the-server-can-read.md)):
  of 37 sample links from walled publishers, 29 refused us, and Europe PMC's API recovered 6.
  Building it edits the fetch defence, so it is asked again, in q-emrf2p.
- **Built B** as a bookmarklet that saves the page as rendered to a `.html` file for the Upload
  control on the failed add page, rather than a window handoff, which these sites' opener policy
  can silently break. Seen working end to end on PLOS through a local server.
- **Fixed on the way**: IEEE's AWS WAF and Springer and JSTOR's "Client Challenge" pages are now
  refused as bot checks (`[jb-bot-check]`, with the Upload button), not as too little text.
- **Asked** (q-emrf2p): build A; and let a saved page keep its address, which is an upload-path
  change.

**After Greg's reply** (`spya-qy8mgg`, 2026-10-18, to q-emrf2p: *"try Europe PMC first and then
fall back to the bookmarklet … As for number two, Yes, keep the address."*), queue item
`qi-pfnjyj6d`, plan
[261018j](../plans/261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md):

- **Built A**: a refused paper address (a DOI in the path, or an Elsevier PII looked up in
  Crossref) is looked up in Europe PMC, and its open-access JATS is converted to a web page and
  imported, through a new fixed door in the fetch guard. Seen on a local server: the cell.com link
  imports with its authors, date, headings and three figures, linked to its Europe PMC page, and
  pasting it again finds it; a closed paper ends with the refusal and the bookmarklet as before.
- **Kept the address**: the bookmarklet writes the page's address into the file; the upload records
  it as *Saved from &lt;host&gt;*, a link that is never fetched, and pasting it again finds the copy.
