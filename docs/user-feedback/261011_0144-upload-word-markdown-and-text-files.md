---
reports: spya-qxh28e
ending: shipped
comment: Word (.docx), Markdown and text uploads are in. Still queued: pictures from Word files, and .odt/.rtf/.epub/.doc/.tex.
---

# Upload Word, Markdown and text files

Report `spya-qxh28e` (#563, `SPIDERYARN-READING2-HC`), from Greg — an admin's, proven by
`feedback-reporter.ts` (exit 0). Queue item `qi-ff2bfwq3`.

> We want to allow the user to be able to upload articles in a wider range of formats, e.g. .txt,
> .markdown and other text files, and also ideally Word documents if not too complex.
>
> see third-party-library-selection.md
>
> — Greg, via Feedback, 2026-10-11 01:44 UTC

**Shipped** on `dev`. The **File** button and drop target now take Word (`.docx`), Markdown
(`.md`, `.markdown`) and plain text (`.txt`, `.text`, `.rst`, `.org`) as well as PDF and HTML.
Each is turned into a web page as it arrives (mammoth for Word, micromark for Markdown) and read
like an uploaded web page from then on. The reader's original file is kept beside it. The plan,
the library choice and both GPT Sol reviews are in
[261011j](../plans/261011j-upload-text-markdown-and-word-files.md).

**Before it works in production**, the deploy needs the storage bucket to accept the two new
upload types: `npx tsx scripts/check-buckets.ts --prod --apply`. `npm run deploy` refuses until
that has run. Until then PDF and HTML uploads are unaffected.

**Left for later, each with its own queue entry:** pictures in a Word document (`qi-bqezp8b6`);
`.odt`, `.rtf`, `.epub`, old `.doc` and `.tex` (`qi-nhzrk7v3`); maths in Markdown
(`qi-wrvxk8p2`); export and diagnostics carrying the original file (`qi-5pthxgvh`); and running
document parsers in a worker with a timeout (`qi-ymdddydy`).
