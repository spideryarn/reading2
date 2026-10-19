Read-only plan review. Do not edit files.

Review the plan docs/plans/261019b-ipad-selection-chip-sits-near-the-words-and-a-finger-is-known-from-touchstart.md against the code it changes: src/web/TouchSelectionChip.tsx, src/web/styles/annotations.css (§ .touch-select-chip), tests/touch-selection-chip.test.tsx, and the prior plan docs/plans/261018c-touch-selection-chip-docks-away-from-the-ios-callout.md.

Context: Greg reported no "Highlight or comment" chip on a real iPad. Emulation cannot reproduce. The plan takes two cheap fixes for the two surviving candidates. Judge:
1. Is the diagnosis honest and are the two candidates the right ones? Anything you would add?
2. The CSS `max(edge offset, calc(var(--chip-room) - 5rem - var(--control-h-lg)))`: is the arithmetic right for both edges (fixed element, layout viewport, innerHeight measured in JS)? Any case where the chip lands over the words, off screen, or under the top bar or Dock? What about a selection taller than the screen, or `room` in jsdom (no geometry)?
3. touchstart/touchend/touchcancel as finger signals: event order relative to pointerdown on iOS WebKit, hybrids, Pencil, Magic Keyboard trackpad, any way this makes a mouse selection show the chip, or breaks the existing rules (a press on the chip itself, the grace logic, hide on a new touch)?
4. Is 5rem a sensible clearance for the iOS selection menu plus handle? 
5. Anything simpler that would do as well.

Reply with a verdict (approve / changes needed) and numbered findings, each with file:line and the concrete fix.
