---
reports: spya-hrx8z2
ending: shipped
comment: Fixed on dev: all 11 asterisk notes in The Order of Time will link. Your copy changes only after a Refresh, which moves about 7 minutes of reading time; that is the open question.
---
# Asterisk notes at the back of a book link to their markers

Report `spya-hrx8z2` (#703, admin, 2026-10-24 21:12 UTC, Sentry `SPIDERYARN-READING2-P2`), on
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug` (block `spya-eh5fwu`). From Greg
(`feedback-reporter.ts` exit 0, no addenda when re-read before this note). Session
`fbhrx8z2-asterisk-notes`.

> There are a lot of asterisks. I assume they're footnotes or endnotes of some kind. We should be
> picking them up and turning them into links and tooltips, bidirectional links, like we do with
> other footnotes and stuff.

**Shipped, on `dev`.** The book is a PDF, and its 11 `*` notes are printed at the back after the
143 numbered ones. All endnotes shared one search cursor, so the `*` notes looked only past the last
numbered marker and found nothing. They now have their own search, checked against the PDF's text
layer: the k-th printed `*` is the k-th note's, and it is found in the transcription by the word it
is glued to. One that cannot be pinned down stays unlinked rather than pointing at the wrong note.
On this book's current reading, 11 of 11 link correctly. Across all 33 production PDFs, nothing
else changes, except a wrong `*` link that today's code makes on another copy of this book. Plan:
[261025a](../plans/261025a-asterisk-and-dagger-notes-at-the-back-of-a-book-link-to-their-markers.md).

Greg's copy changes only on re-extraction, which would give four marker paragraphs new ids (about
400 seconds of his reading time). So that waits on his answer:
[q-yc2fp3](questions/q-yc2fp3.md).
