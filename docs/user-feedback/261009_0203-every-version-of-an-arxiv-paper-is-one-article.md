---
reports: spya-n50aft
ending: shipped
comment: Every version of an arXiv paper is now one article, and the shelf you already have matches too. The cost: pasting v2 while you hold v1 gives you v1.
---
# Every version of an arXiv paper is one article

Report `spya-n50aft`, from Greg (an admin; `scripts/feedback-reporter.ts` exited 0), filed
2026-10-09 02:03 UTC; session `fbn50aft-arxiv-dedupe`. No Sentry sign-in in this session, so the
next feedback sweep marks the Sentry issue.

> I added: https://www.spideryarn.com/add/https%3A%2F%2Farxiv.org%2Fabs%2F2609.01481 which created
> `arxiv-2609-01481-spya-jytq2h` … But we already had `arxiv-2609-01481v1-spya-sjatfv`. Why didn't
> the add/import process notice that we already had the article? If it won't introduce tooooo much
> complexity, let's try and make our deduplication more robust and notice this kind of thing in
> future.

**Ending: Shipped**, on `dev`. Plan
[261009d](../plans/261009d-every-version-of-an-arxiv-paper-is-one-article.md).

**Why it happened.** It was a decision. On 2026-10-05
([261005l](../plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md))
every *shape* of an arXiv link became one article (abs/pdf/html, http/https, `www.`,
`export.arxiv.org`, arXiv's DOI, Hugging Face and alphaXiv pages, tracking parameters). The
version was deliberately left in the key, so `2609.01481` and `2609.01481v1` were two articles.

**What happens now.** "Do we already have this?" ignores the version. The version still decides
what is fetched and what the slug looks like. The check runs over every stored article each time,
so **the articles already on the shelf match too**, with no migration. Eleven Google, Marketo and
Omeda tracking parameters that never carry content (`_gl`, `_ga`, `gclsrc`, `gad_source`,
`gad_campaignid`, `srsltid`, `gbraid`, `wbraid`, `mkt_tok`, `oly_anon_id`, `oly_enc_id`) are now
ignored as well. Nothing else looked both missing
and safe.

**The trade-off, Greg.** A reader holding v1 who pastes a v2 link is told they already have it.
Refresh re-reads v1 too, so reading v2 means deleting v1 first. (An article imported from a
plain link refreshes to the latest.) Telling versions apart (a plain
link matches any version, but v1 and v2 differ, or "a newer version exists — import it?") needs
either two matching rules instead of one key or a fetch to learn the latest version. That was not
worth it for a case nobody has hit yet. The plan has the table.

**The duplicate is still in production.** `arxiv-2609-01481v1-spya-sjatfv` and
`arxiv-2609-01481-spya-jytq2h` are both there, untouched. Delete whichever you don't want. Until
then, a third paste comes back to whichever of the two the lookup meets first.
