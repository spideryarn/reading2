---
id: q-xns4gt
report: spya-rg5kk6
status: open
asked: 2026-10-23
title: Re-point 5 bookmarks and some reading time to the re-read Order of Time's new paragraphs?
refs: q-qbfjje · spya-j4zg9m · qi-2f92byjb · qi-gw4kwnea · docs/plans/261023c-re-read-the-order-of-time-from-its-pdf-in-production.md · docs/user-feedback/261019_0755-a-line-at-the-top-of-a-pdf-chunk-is-no-longer-lost-silently.md · docs/project/block-ids.md
---
The Order of Time has been re-read for you, and the missing line, passage and notes are back. But 5 of your 7 bookmarks on it now say "no longer in this version of the article", although the paragraphs are all still there. Shall I move them, and your reading time, onto the new paragraphs?

A. Move them (recommended). Each of the 5 bookmarks goes to the paragraph that now holds its words. Two of them land on the same paragraph, because the re-read joined their two paragraphs into one, so those two become one bookmark and you end up with 6 on the book, not 7. Reading time moves the same way for 74 of the 85 places it no longer shows. Where two old paragraphs are now one, their times are added. The other 11 are mostly the stray "16", "57" note stubs that were meant to go, and they stay as they are. A one-off write to your rows only. The old ids are kept, so it can be undone. About an hour, with a review.
B. Leave them. Nothing is lost: the bookmarks are still in the database and still listed, but they show "no longer in this version of the article" and take you nowhere. The reading-time shading is missing for those 85 places.

Recommendation: A.

Details

What happened. You asked me to re-read the book (your reply to the previous question). That is done, and it worked: the line at the top of page 43, the 51-word passage on page 95, and notes 21 to 93 are all back. Five notes that said only "53" to "57" are gone, and 30 of the 40 figures are shown. It cost $0.84.

What went wrong. Every paragraph has a hidden id, and your bookmarks and reading time are attached to those ids. A re-read keeps a paragraph's id only when its words come back exactly the same, or nearly. The model read the book a little differently this time: some paragraphs gained a line (the page 43 one did, which was the point), and some were joined or split differently across pages. So 289 paragraphs got new ids and 834 kept theirs. The previous question said ids would be kept, and that was wrong. I should have measured it before running, not after.

Nothing of yours was deleted: your 7 bookmarks and your reading time are exactly as they were (checked row by row). Only where they point has gone stale. All 7 of your bookmarks are whole-paragraph bookmarks, with no quote and no note text, so moving one changes only which paragraph it points at.

The five bookmarks, and where each would go:
1. "Another configuration will be particular if the first twenty-six cards…": into a longer paragraph that holds all of it.
2. "It simply makes no sense to ask which moment in the life of your sister on Proxima b…" and
3. "'Basketball champions' refers to a team of basketball players…": both now in one paragraph.
4. "There is our past: all the events that happened before…": the same paragraph with a few more words.
5. "The structure of the cones can even be such that…": now split in two; it goes to the first part, which holds about two thirds of it.

The rule behind it is deliberate: a paragraph whose words changed gets a new id, because attaching a note to text that no longer says what you marked is worse than losing the anchor. So the general fix, keeping ids across a re-read when a paragraph only grew or was joined, is a separate decision. I have queued it as a proposal, not asked it here. Your last reading position in this browser may also have pointed at one of the changed paragraphs; if so, the book will open at the top once.
