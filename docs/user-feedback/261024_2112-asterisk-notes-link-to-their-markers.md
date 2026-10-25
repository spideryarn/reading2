---
reports: spya-hrx8z2
ending: shipped
comment: Done. All 11 asterisk notes in your copy of The Order of Time now link both ways. It was refreshed on 25 October, and the 7 minutes of reading time moved with it.
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

**Greg's copy, refreshed.** He chose A (reply `spya-s4qkhh`, 2026-10-25). Report re-read before
this addition: no addenda. The fix was live in `a9b65cd3`. On 2026-10-25 at 14:02 UTC his article
was re-extracted (job `spya-ee4zdd`, $0.75, no chunk re-read). Exactly the four paragraphs above
got new ids, and the 11 asterisk notes link. The 401.5 seconds of reading time on them moved to
the new ids, and his 6 bookmarks were not touched. A first attempt failed before doing any work, on
a bug in the session's script; its failed job was dismissed. Plan and full record:
[261025g](../plans/261025g-refresh-the-order-of-time-for-its-asterisk-notes-and-move-greg-s-reading-time.md).
Session `fbhrx8z2-refresh-order-of-time`.
