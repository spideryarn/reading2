---
reports: spya-mxntdt
ending: shipped
---
# Citations: a link to a cited work that is already an article here

SPIDERYARN-READING2-5R (`spya-mxntdt`), a suggestion from Greg (admin, verified by
`scripts/feedback-reporter.ts`, exit 0), sent from Citations mode on `9689-full-spya-m43th2`
(build `6d09e3cc`). The time in the file name is when this session picked the report up; it had no
Sentry access, and the report text came in the brief.

> In Citations mode, we should also do a check to see if any of the cited-items are already present
> as articles in Spideryarn (on the user's shelf or in public articles), and if so, provide a special
> link to them.

It follows [5G](260929_1835-citations-say-whether-we-read-the-paper.md) and
[5Q](260930_0125-citations-investigate-one-work.md), both already on `dev` when this started, so it
was built on top of them and touches neither's ground.

**Ending: Shipped.** On `dev`, not deployed. Resolve 5R; the next feedback sweep does the Sentry
status write.

What we did:

- A row whose cited work is already an article you can open gets a line under its title:
  **In your library** or **On the public shelf**, linking to it here. The tooltip says which article
  and how it was matched — the same DOI, arXiv id, address, or title. A title match also names the
  matched article on the row, so you can check it is the same work.
- **It never shows another reader's private article, or that one exists.** Only your own articles
  and public ones are ever looked at, and of somebody else's public article only what its public
  page already shows.
- The row still says we have not read the cited work: having a copy here is not the same as having
  read it.

Not done yet (in the plan's deferred list): the same link on the hover card in the prose, for a
visitor to a public article, for archived articles, and using the copy here as the text *Look it
up* / *Investigate* read instead of a search extract.

The plan is [260930b](../plans/260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md).
