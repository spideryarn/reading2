# Structure mode on a landscape iPad, and a rotation that breaks the render

[SPIDERYARN-READING2-33](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-33) (2026-09-12
08:08 UTC, `kind=suggestion`) and
[SPIDERYARN-READING2-34](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-34) (08:10 UTC,
`kind=problem`), from an admin, on an iPad in production, build `607b57a0`, on
`entropy-24-00930-spya-bmvfyb` in Structure mode. One bug, one note; both issues end the same way.

> On this landscape iPad I think there's room to show two columns in Structure mode

> Ah weird. It IS now showing two columns in Structure mode on iPad in landscape mode (even though it
> wasn't before). This is great now. Somehow switching between portrait and landscape often messes up
> the rendering

**Ending: Shipped** — on `dev`, not deployed. Resolve both -33 and -34.

What we did: the reading view laid itself out from `window.innerWidth`, which on iPad Safari is the
*zoomed* (visual) width. A zoom survives a rotation, and zooming back out fires no window `resize`,
so a zoomed-in rotation laid out for a window about two-thirds the real size until something else
resized it. It now lays out for the layout width, and `?probe=1` records rotations so a trace off the
iPad can confirm it. [260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md](../plans/260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md);
the postmortem is
[260912b-a-layout-read-from-a-number-that-means-a-different-viewport-on-ios.md](../postmortems/260912b-a-layout-read-from-a-number-that-means-a-different-viewport-on-ios.md).
