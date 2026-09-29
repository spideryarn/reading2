You are GPT Sol, reviewing a short plan before it is built. Read-only: do not edit files.

Plan: docs/plans/260929g-on-a-phone-a-band-link-closes-the-band.md. Check it against
src/web/reader/Reader.tsx (`bandAway`, `bandStepsAside`, `bandOverProse`, `bandBack`, `modeBand()`,
where `jumpTo` is passed to bands and to non-bands, the ReturnChip render, the Dock's `onMode`),
src/web/ReturnChip.tsx, src/web/reader/useReadingPosition.ts (`jumpTo`), src/web/keynav.ts
(`beginJump`), src/web/flash.ts (the held flash), src/web/styles/narrow-window.css (§ a band that
has stepped aside), src/web/styles/dock.css (`--return-chip-h`), src/web/modes/trajectory/ and
TrajectoryPanel.tsx (the existing step-aside), and docs/project/narrow-windows.md / touch.md.

What I would least like to be wrong about:
1. That every in-band passage jump really goes through the `onJump` Reader passes inside
   `modeBand()` — and that nothing outside a band gets the new wrapper.
2. The `popstate` → band back rule: can it fire when it should not (a nuqs replace, the band's own
   `?stop=`/`?term=` writes, the return chip, Trajectory's own step-aside), or loop with the jump's
   own push? Is it worth having at all?
3. Hiding the section ReturnChip while the band pill shows: does anything rely on it then?
4. Anything about the held flash, reading-time counting (`proseOnScreen`), focus (a keyboard or
   screen-reader user's focus is inside a band that just went `display:none`), or the herald.

Say if a simpler shape gets most of the value. Output: numbered findings with severity
(must-fix / should-fix / nit), file:line evidence, the change you propose; end with a one-line
verdict.
