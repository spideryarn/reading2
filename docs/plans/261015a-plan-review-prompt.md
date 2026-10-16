You are reviewing a plan in the Spideryarn repo (read CLAUDE.md first). Read-only review; do not edit files.

Plan: docs/plans/261015a-a-site-that-refuses-the-app-a-better-way-round-and-the-bigger-options-for-greg.md

Context to read: docs/project/fetching.md (esp. § A paper source, § Addresses we won't dial, § The user-agent question), docs/project/ingest-queue.md § The add page and § The failures Retry is not offered under, src/messages.ts (FETCH_FAILED, FETCH_DECLINED, FETCH_INCOMPLETE, FETCH_PAPER_MISSING, documentIsABotCheck, codeOfMessage), src/web/AddPage.tsx (the failed-job rendering around JobCard), src/web/UploadPicker.tsx, src/web/uploadEngine.ts, docs/project/security-map.md.

Review:
1. Part 1: is the "Upload a file" control on the failed add page right — the predicate (an explicit SUGGESTS_UPLOAD code set read off job.error with codeOfMessage, only for job.url imports), reusing UploadPicker on /add/<url> (LIMITS_ID single-mount assumption, the shelf's transfer row showing on this page, the drop target, batch picks of several files, quota), and anything that would make it wrong or confusing. Is there a simpler or better shape?
2. The sentence change: is "download the PDF the site offers, or save the page as a PDF or an HTML file, and upload it" good advice for a reader (Safari's default webarchive, Chrome's MHTML 'single file', etc.)? Does copy.md's rule set allow it?
3. Part 2: are options A/B/C framed fairly and is anything important missing (e.g. a cheaper middle option, the security implications of the bookmarklet's cross-site POST, of fetching a registry-chosen address)? Is the not-recommended scraping option right?
Give numbered findings with severity (high/medium/low) and a final verdict line: "VERDICT: approve" / "VERDICT: approve with changes" / "VERDICT: rework".
