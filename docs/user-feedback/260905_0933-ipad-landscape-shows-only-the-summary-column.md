---
reports: spya-gnvstb
ending: shipped
---
# A landscape iPad showed only the Summary column, not the text

`spya-gnvstb`, 2026-09-05 09:33Z, from Greg (admin). It never got a note, so the Earlier tab showed it
as not shipped. The words below were read from its row in production on 2026-10-01.

> It's only showing the Summary column, not the Text, in iPad landdcape

**Ending: Shipped**, and deployed since.

The likely cause is the one found a week later: the reading view laid itself out from the *zoomed*
width on iPad Safari, so it could lay out for a much narrower window than the real one. Since
`2a1b7594` it lays out for the layout width instead
([260912_0808](260912_0808-structure-columns-after-an-ipad-rotation.md),
[260912b](../plans/260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md)).

Checked on 2026-10-01 at `e85ef1d8`, in Playwright on Chrome set up as an iPad (touch, an iPad user
agent, 2× pixels), with `?mode=summary` on a local article. At 1180×820, 1366×1024 and 1024×768 the
Summary column (400px) and the prose (553–733px) were both on screen. A rotation from 820×1180 to
1180×820 re-laid both out. This was not a real iPad, so the zoom-then-rotate case that 260912b
diagnosed on the device itself was not re-run. If it comes back, reopen this one.
