---
reports: spya-pcz6a3
ending: shipped
---
# The Metadata page should show the publication date, and the journal

A suggestion from Greg, filed from the Metadata page of the Entropy paper and relayed by the
Overseer as an admin's report.

> It would be great if the metadata page also somehow figured out and listed the publication date.
> And perhaps journal etc
>
> — Greg, 2026-10-03 (`spya-pcz6a3`)

## What we did

Plan, reviews and the browser check:
[261004a](../plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md).
What is built is in
[content-extraction.md § The journal and the publication day, from a registry](../project/content-extraction.md#the-journal-and-the-publication-day-from-a-registry).

- **A new import asks Crossref about the article's own DOI.** The DOI is found without a model: on
  a PDF's first two pages, in a web page's `citation_doi` or address, or as a minimal paper's
  `metadata` step read it.
- **The answer is kept only when the registry's title and one author agree with the article's.** A
  first page also prints the DOIs of the works it cites.
- **The Metadata page prints the journal and "Published 31 May 2024" under the title.** A web
  page's own date is printed the same way; it was stored already and shown nowhere on that page.
- **A PDF now has a publication date**, so the Shelf's Published sort
  ([the sibling report](261003_1724-shelf-sort-by-publication-date.md)) has something to sort.
- Checked against the real registries: the paper this report was filed from comes back as
  *Entropy*, 31 May 2024, and a cited work's DOI placed first is refused.

## What Greg should know

- **Nothing already in production changed.** No backfill, as asked. An article gets these facts
  when it is imported, or when its owner reads it again.
- **A year alone is not shown.** Three of eight real papers probed (Neuron 2011, Psychological
  Review 1995, an arXiv preprint) have a registry record with a year or a month and no day. They
  get their journal and no date.
- **A visitor's Metadata page shows neither.** The journal is owner-facing only, like the DOI.

The four deferred parts (the year, the backfill, the visitor's page, the publisher's name) are
queue entry `qi-pm7mj4ke`, waiting on Greg.
