---
reports: spya-rgh26u
ending: shipped
comment: With Marginalia on, the prose now moves left at every window width so the chat card gets the room. At your size the card went from 282px to 517px. Nothing changes beside a band.
---
# The chat card in the margin gets the room left of the prose

Admin report from Greg (`feedback-reporter.ts` exit 0, no addenda), #675, Sentry
`SPIDERYARN-READING2-N7`, suggestion, filed with a screenshot (*The Order of Time*, dark, Larger
text):

> Look at the ratio of the columns here for the Marginalia mode, especially when there's a chat
> involved. There's plenty of space, and yet, you know, the chat in the right is all crammed into a
> tiny, tiny gap and isn't wide enough to really read, and the margins are unhelpful. So I just feel
> like there's got to be a better way to arrange things. Take screenshots and see what you can do to
> improve things.
>
> — Greg, 2026-10-23

**Shipped** on `dev`:
[261024l](../plans/261024l-the-chat-card-in-the-margin-gets-the-room-left-of-the-prose-at-every-width.md).

**What was wrong.** His screenshot matches a window of about 1512px at a 20px root. There, about
315px of empty page sat left of the prose and the chat card got 282px. The prose moved left for the
card only from a 1600px window, by at most 100px (his choice B of 2026-10-06; the numbers were
ours), so at his size nothing moved.

**What changed.** With the Marginalia column on and no band, the prose now moves left at every
width, as far as the card can use (up to 576px), keeping 4rem of page on its left, or half the room
that was there if that is less. Its width is unchanged, the 42rem cap included. It moves whether or
not a chat is open, so the paragraph being asked about never slides sideways when you ask. The
100px jump at 1600px is gone too.

Measured in the browser, before → after: at his size the card is 282 → 517px (its answer text 224
→ 459px), and the composer fits on one row again; at 1280px with Default text it is 260 → 480; at
1440px with Larger text it was not a card at all (a docked panel), and is now a 445px card. The
plan has the full table and the screenshots.

**Not changed.** With no chat open the page now sits left of centre, with room right of the notes,
whose lines stay capped at 24rem. Beside a band the card is unchanged, because the band has the
left of the page. The roughly 170px between the end of a line and the notes is the 42rem cap's
slack (his decision of 2026-10-23) plus the gutter icons, and stays.
