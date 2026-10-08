---
reports: spya-q3dfmw
ending: shipped
---
# The way-back chip moves the position and leaves the modes alone

Report `spya-q3dfmw` (#489), a suggestion from Greg (an admin, proven by
`scripts/feedback-reporter.ts` exit 0), filed 2026-10-08 16:25 UTC.

> I like the little "back to" UI widget (see screenshot).
>
> It seems as though when I press it, it basically feels like pressing the back button, which means
> that if there are different modes active, it switches to the modes that were previously active, as
> well as changing the position. I think it would be better if it just changed the position, and so
> if I changed modes since, those modes would stay as they are currently.

**Ending: shipped**, on `dev`. Plan:
[261008g](../plans/261008g-the-way-back-chip-moves-the-position-and-leaves-the-modes-alone.md).

- **Why it felt like Back:** it was Back — `history.go(-depth)` to the entry the jump left, and that
  entry's `?mode=` came with it.
- **Now** a press pushes today's address with only `?at=` changed, and moves the page. Modes opened
  or closed since stay as they are. Pressing again still goes back through earlier jumps.
- **The edge Greg's note asked about:** the place it returns to is always in the prose, never inside
  a mode's band. On a phone, where an open band covers the prose, the press moves the band aside so
  the landing can be seen, without closing the mode; the "↩ back to ⟨mode⟩" pill brings the band
  back.
- The browser's own Back still undoes everything, modes included; Help says so now.
- GPT Sol reviewed the plan (it caught two real defects before anything was built) and the code
  (it fixed two races). Postmortem
  [261008d](../postmortems/261008d-a-keyed-queue-replaced-the-intent-before-its-delayed-write.md).
- Not checked in Sentry: this session had no Sentry sign-in.
