---
id: q-qbfjje
report: spya-rg5kk6
status: open
asked: 2026-10-23
title: Re-read The Order of Time from its PDF, to put back the missing line, passage and notes?
refs: SPIDERYARN-READING2-K5 · addendum spya-zdp62y · qi-h9gv4pf8 · qi-vq9rwkyy · docs/plans/261023b-endnotes-typed-as-references-are-kept-as-notes.md · docs/plans/261022h-a-line-at-the-top-of-a-chunk-is-not-lost-at-the-seam.md · docs/user-feedback/261019_0755-a-line-at-the-top-of-a-pdf-chunk-is-no-longer-lost-silently.md
---
Your copy of The Order of Time is missing three things, and fixing them means re-reading the book from its PDF. Shall I leave that to you, once the fix is deployed?

A. After the next deploy, click Refresh from source on the book's row on your shelf (recommended). It reads all 36 chunks of the PDF again, about the cost of a fresh import, well under a dollar. It should put back the line at the top of page 43, a 51-word passage on page 95, and notes 21 to 93. Block ids are kept, so your comments and reading position stay.
B. Refresh now, before the deploy. The page 43 and page 95 checks are already live, so those two should come back. The notes depend on the model labelling them correctly this time, and last time it did not.
C. Leave the book as it is.

Recommendation: A.

Details

What you asked. On 19 October you reported that a paragraph in The Order of Time was cut off. On 22 October you added: "Any news on this? Inspect in production, see if you can figure out whether there's something about the import that needs fixing/improving."

What was already done. The cut paragraph lost its last line, "realized that it was impossible to do so exactly.", at the top of page 43. That fix went live on 23 October: a chunk of pages that should open with the end of the previous page's sentence, and does not, is now read again.

What the inspection found, comparing the published book with the PDF's own text, page by page:
1. Page 43, the line above.
2. Page 95, a 51-word passage beginning "It is the law announced by Clausius (ΔS ≥ 0) and deciphered by Boltzmann". The model skipped it mid-page. The existing quality check already catches this on a fresh read.
3. Notes 21 to 93, about 4,000 words, were missing. The model labelled them as bibliography entries, which the import transcribes and then hides. That is a bug in the import, and it is fixed on dev (not yet deployed). Five notes that said only "53" to "57" are gone too.
Nothing else in the body text is missing.

Why a Refresh now re-reads the whole book. The earlier note said to delete one stored reading in production and then Refresh. That is no longer needed. The book was read on 4 October with an older model and prompt, and both are part of the key a stored reading is found by, so a Refresh finds none of them and reads everything again. Checked: today's code finds 0 of the 36 chunks; the code as it was on 4 October finds 33. Nothing in production needs deleting.

Why after the deploy. The notes fix is in how the book is assembled from the model's reading. A Refresh before the deploy assembles with the old code, so notes 21 to 93 come back only if the model happens to label them right.

The same Refresh also serves a queued check on this book's uncaptioned figures (qi-vq9rwkyy).
