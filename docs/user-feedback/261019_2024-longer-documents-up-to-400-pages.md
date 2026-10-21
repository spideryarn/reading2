---
reports: spya-p5x9wy
ending: shipped
comment: Shipped: a long PDF costs one article per 50 pages, charged before any transcription, with a warning on import. The cap stays 250 pages for now, because a 400-page maths book failed to import. Raising it to 400 is queued.
---
# Longer documents, up to 400 pages, at one slot per 50 pages

Report `spya-p5x9wy` (#639, SPIDERYARN-READING2-M4), a suggestion, from Greg (`feedback-reporter.ts`
exit 0, no addenda when re-read before this note). Queue item `qi-ajxrg7a4`.

> I think we need to allow import of longer articles. Let's go up to 400 pages. But let's have a rule
> that each 100 pages counts as 1 article (in terms of the user's allotted number of articles). In
> other words, if I'm a user with 2 articles left, and I upload a 150-page article, it uses up both
> those article-slots.
>
> That user would not be able to import a 250-page article, because that would need 3 slots.
>
> Probably it should warn the user during the import process that multiple slots are being used for
> long articles. But don't block - just let them know during the import process.

**Shipped**, after Greg answered question [q-x8gdr3](questions/q-x8gdr3.md) on 2026-10-20 (1A, 2A,
and 50 pages a slot rather than 100). A PDF costs one slot per 50 pages, rounded up. The charge is
raised in stage 1 once the pages are counted, before any transcription is paid for, under the
billing → job → ingest-row lock order. High-powered AI charges the article's slots again, and a free
Rebuild may not turn a short article into a long one. The import shows the warning and does not block.
GPT Sol reviewed the plan three times and the code once. The review found a P0 (High-powered AI
switched on during an import charged one slot), and its fix is in.

**The cap stays 250 pages for now (1–5 slots), not 400.** The measurement
([261020e](../investigations/261020e-four-hundred-page-imports-measured.md)) found that an ordinary
400-page book imports, but a 400-page maths book does not. The ledger already allows 8 slots.
Raising the cap waits on the extract fixes queued in
[overseer-queue.md](../project/overseer-queue.md) (and `qi-sbytr395`).
Plan: [261020b](../plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md).
