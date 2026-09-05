# A brain icon for Remember mode

**[SPIDERYARN-READING2-25](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-25)** · reported
2026-09-05 20:50 UTC · *shipped*

## What Greg said

> For the Remember mode button, use a brain icon

## What changed

`MODES_UI` in [`src/web/Dock.tsx`](../../src/web/Dock.tsx) — `icon: Speech` → `icon: Brain`. One line
and a comment saying why, which is the part worth keeping:

**`Speech` was the mode's *method*; `Brain` is its *subject*.** Remember mode works by the reader
talking — so `Speech` was not arbitrary, it was the dictation. But what the mode is *for* is what the
reader retained, and that is what the bar should name. The button beside it is Chat, which is also
talking, so a speech bubble was doing double duty in a row of eighteen icons.

Lucide has exactly one `Brain`, nothing else in the bar uses it, and it inherits the house defaults
(16px, `strokeWidth={1.75}`) from the `<LucideProvider>` like every other icon —
[icons.md](../project/icons.md).

## Not done, deliberately

No test. Nothing pins any other mode's icon either, and a test asserting `Brain` would fail the next
time somebody has a better idea — which is the wrong kind of red. The thing worth protecting is that
*every* mode has an icon at all, and the `MODES_UI`/`MODES` exhaustiveness check in the same file
already does that at compile time.
