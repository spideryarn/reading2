---
id: q-x8gdr3
report: spya-p5x9wy
status: open
asked: 2026-10-20
title: Long PDFs up to 400 pages at one slot per 100 pages: may I change the slot quota this way?
refs: SPIDERYARN-READING2-M4 · qi-ajxrg7a4 · qi-sbytr395 · docs/plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md · docs/plans/261020b-longer-documents-up-to-400-pages-plan-review-sol.md · docs/user-feedback/261019_2024-longer-documents-up-to-400-pages.md
---
You asked for PDFs up to 400 pages, each 100 pages counting as one article slot, with a warning during import. The slot count is one of our listed defences, so I planned it and stopped before building. Three answers would let me build it.

1. May I change how slots are charged, as below?
A. Yes (recommended). The import reserves one slot as now. A few seconds in, once the PDF has been opened and its pages counted, and before any money is spent on transcribing it, the charge is raised to one slot per 100 pages (rounded up). If those slots are not there, the import stops at that point with a sentence like "This PDF is 250 pages, which counts as 3 articles, and your account has 2 left." Otherwise the card shows "This PDF is 150 pages, so it uses 2 of your articles" and carries on. A public long article costs half of its slots, as any public article does.
B. No: keep 250 pages and one slot.

2. Should High-powered AI on a long PDF cost its slots again (a 300-page PDF: 3 more), or one more, as today?
A. Its slots again (recommended): it matches your rule that High-powered doubles the processing cost.
B. One more, as today: simpler, but a 400-page High-powered import costs us about twice as much again for one slot.

3. Is one slot per 100 pages the price you want, knowing it does not cover the cost?
A. Yes, 100 pages (recommended for now): a Reader slot is worth $0.50, and 100 pages of a long document costs us about $1.30 to import. Still better than today, where 250 pages costs about $3.30 for one slot.
B. One slot per 50 pages: roughly breaks even, but a 400-page book would use 8 of a Reader's 20.

Details

Your report (2026-10-19 evening): "allow import of longer articles... up to 400 pages... each 100 pages counts as 1 article... a user with 2 articles left... would not be able to import a 250-page article... warn the user during the import process... don't block."

Why it waits for you. The slot count is what stops a script on a free account from running up a large model bill, so changes to it are planned and asked, not built by an unattended run. Nothing has been built.

Why the charge happens a few seconds into the import. When a reader presses Add, nobody knows how many pages the PDF has: a pasted link has not been downloaded yet, and an uploaded file has not been opened. The first step of the import is where the pages are counted today (that is where the 250-page cap is applied), and it runs before the expensive transcription. So the extra slots are charged there. "Don't block" is kept for the warning: a reader with enough slots is just told; a reader without enough is stopped, as in your 250-page example.

What GPT Sol's review changed. It found real gaps in my first plan and I took all ten: the charge has to be tied to the job so a restarted import step cannot undo it; "Read this" on a bulk-imported paper skips that first step, so the page count is stored and reused; the profile keeps saying "1 article added, using 2 of your 3" rather than "2 articles added"; the sharing offer and the admin page count slots correctly; the warning is saved on the job so it does not vanish; and imports already in progress at the deploy are charged one slot (a handful at most).

Will 400 pages work? Estimated from the 250-page book we measured: about 15 minutes and $5.30 to import. The real risk is size: a dense 400-page paper might make an article too big for the server to send (the 4.5 MB limit), and then it would not open. So the first step of the build is to import two real 400-page PDFs locally (about $10 to 15). If the dense one is too big, the cap goes only as high as what loads, and I will tell you the number.

Not included, named in the plan: a page-count warning before upload, in the browser; length pricing for web pages and Word files; pricing the modes by length.

Answer "1A 2A 3A" to build it as planned.
