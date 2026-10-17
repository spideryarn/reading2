---
id: q-emrf2p
report: spya-x5e966
repeats: spya-tqsw3u
status: open
asked: 2026-10-17
title: A site that refuses us: build the free-copy lookup, and let a saved page keep its address?
refs: qi-q62g96s9 · q-fp8tqr · spya-wm83gt · SPIDERYARN-READING2-J0 · SPIDERYARN-READING2-J2 · docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md · docs/investigations/261017a-which-refused-paper-links-have-a-free-copy-the-server-can-read.md · docs/user-feedback/261015_1711-cell-com-refused-the-app-a-better-way-round-and-a-question.md
---
Short version: you said "A and/or B as you see fit". B is built: a "Save for Spideryarn" bookmarklet. On a page that turns us away, you click it, it saves the page you are looking at as a web page file, and you upload that file with the Upload button that now sits under the failure message. It works on any page you can see, papers or not, and costs nothing to read (a PDF costs a model call). A is measured but not built, because building it means changing the part of the server that guards what we fetch, which I may not change without you. Two questions:

1. Build A, the automatic free copy?
A. Yes. When a site refuses us and the link is a paper, we look it up and, if Europe PMC holds a free full text, import that instead, with no step by you. Costs: a change to the fetch guard to allow one more fixed address (Europe PMC's), and a converter from the journals' XML format to a web page. About a day. Gives: on 37 sample links from walled journals, 29 refused us, and 6 of those 29 came back in full this way, all life sciences or psychology. Nothing for a closed paper, a news site or a blog.
B. Not now (recommended). The bookmarklet already gets every one of the 29, at the cost of two clicks. Revisit if readers hit refused papers often; production has had one refusal so far, yours.

2. Let a saved page keep the address it came from?
A. Yes (recommended). The bookmarklet writes the page's address into the file, and the upload records it as the article's address. Today an uploaded file has none, so the article has no link back to the source, no Refresh, and pasting the same link later makes a second copy. Costs: a change to the upload path, which is also a guarded part, so it needs your yes; small, an afternoon. Gives up: the address comes from a file, so it is a claim, not something we fetched; we would show it as a link and never fetch it.
B. No. Saved pages stay without an address.

And one thing to try, not to decide: once this is deployed, please drag Save for Spideryarn to your bookmarks bar from a failed add page, open the cell.com article, click it, and upload the file. The box cannot get past cell.com's check to try it for real.

Details

What you asked, 15 October: the cell.com article https://www.cell.com/fulltext/S1364-6613(15)00180-1 was refused ("The site refused to give this app the page"), though your browser got in after a human check. On 17 October you replied to the earlier question: "A and/or B as you see fit. Look for a way that's clean and good for the user."

The measurement. Production keeps only recent import jobs, and yours is the only refusal in them, so I could not sample twenty real readers' links. Instead a sample of 37 real articles from 20 publishers that wall automated readers (Cell, Elsevier, Wiley, Taylor and Francis, SAGE, PNAS, Science, Oxford, ACS, IEEE, JSTOR, Springer, the Lancet, NEJM, JAMA, BMJ, and others), about half open access. 29 refused our server. For each, I asked the catalogues whether a free copy exists and whether our server could actually read it. Only Europe PMC's programming interface could, for 6. Another 8 are free somewhere else (a university repository, for example), not tried. 15 had no free copy that the catalogue knew of. The sample leans to the life sciences, where Europe PMC is strongest, so 6 in 29 is not what a typical reader would see.

Why B became a file you upload, not a page sent straight to us. The first idea was a bookmarklet that opens a Spideryarn window and hands the page to it. These publishers' pages send a security setting that, at least on their check pages, cuts the link between the two windows, and the page is then lost with no error. A file saved by the bookmarklet needs no link and makes no request, so no site setting can stop it. It saves the page as your browser shows it, after the site's own scripts have run. It removes scripts, hidden and password fields and what you typed into boxes, but anything else personal on the page, such as your name in the site's menu, comes too; Help says so. The saved file is kept for you alone; the article made from it is what you share, if you share it.

What else was fixed on the way. Three of the 29 sites (IEEE, Springer and JSTOR) answered with a bot check we did not recognise, so the message wrongly said the page had too little text. They are now recognised, and the message and the Upload button appear as for cell.com.

What I tried, and what I could not. A browser on the server saved PLOS and Nature articles with the bookmarklet, and the PLOS file uploaded on a failed add page came in as the article in about 15 seconds, with its headings, authors and in-page links right. Not tried: a real walled page (the box cannot pass the human check), whether pictures from a walled site come through (they may not, since our server fetches them and the site refuses it), and Safari and Firefox.

What would decide them. Question 1: how often refused papers come up for readers, and whether two clicks is a burden worth a day's work. Question 2: whether you want saved pages to behave like added links (source link, Refresh, no duplicates).
