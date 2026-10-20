---
reports: spya-p5x9wy
ending: awaiting
comment: Planned, not built: charging one slot per 100 pages changes the slot quota, which is a defence, so it is three questions for you first (the charge, High-powered on long PDFs, and the price per 100 pages).
---
# Longer documents, up to 400 pages, at one slot per 100 pages

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

**Awaiting Greg**: question [q-x8gdr3](questions/q-x8gdr3.md). The slot quota is a defence
([security-map.md](../project/security-map.md)), so the change was planned and reviewed, and nothing
was built. The page count is only known a few seconds into an import, so the plan reprices the
reservation there, before transcription, fenced on the job's claim. GPT Sol's plan review found ten
gaps, all taken. The 400-page cap waits on measuring the article response size (`qi-sbytr395`).
Plan: [261020b](../plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md).
