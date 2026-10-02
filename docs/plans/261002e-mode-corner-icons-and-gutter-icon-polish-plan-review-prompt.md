You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only: do not edit anything.

The plan: docs/plans/261002e-mode-corner-icons-and-gutter-icon-polish.md. Read it, then check it against the real code:
- src/web/ModeSurface.tsx, src/web/BandAbout.tsx, src/web/WrittenForYou.tsx, src/web/ProfilePanel.tsx
- src/web/styles/mode-band.css (§ the band's (i), `--band-about-room`), src/web/styles/profile.css (.prof-badge), src/web/styles/narrow-window.css (the pointer: coarse block that sizes .prof-badge.icon-only)
- the WrittenForYou call sites: src/web/modes/summary/SummaryMode.tsx, GlossaryPanel.tsx, QuotesPanel.tsx, IdeasPanel.tsx, Tweets.tsx, and SketchView.tsx / DiagramPanel.tsx
- src/web/BlockGutter.tsx, src/web/styles/gutter.css (the container-query thresholds, the hover/reveal rules), src/web/BlockLinkCard.tsx (the delegated card), src/web/Tooltip.tsx (ControlTip)
- tests/every-mode-draws-its-surface.test.tsx, tests/block-gutter.test.tsx, tests/gutter-target-size.test.ts, tests/mode-surface-changes-no-markup.test.tsx

Give numbered findings with severity (P0-P3), file:line, and a concrete fix:
1. Anything in the plan that is wrong about the code as it is.
2. Risks: the out-of-flow corner growing to two buttons (does every mode's top row really clear via --band-about-room? Search's zero-slack fit? Outline's measuring copies?); the profile panel's popover anchoring when its trigger moves into an absolutely positioned corner; tab order; WrittenForYou renders null when not written, so how should the band decide has-profile without reserving room for an absent badge?
3. The gutter: the delegated card for buttons that also act on click (show-on-focus, a stale card after the permalink copy, aria-describedby on a button that already has aria-label); removing `title`: does anything depend on it (tests, accessibility)? The row-gap and the new thresholds: is the arithmetic right, including the one-slot `@container not (...)` block and the open "…" panel?
4. Simpler alternatives I missed.
End with a verdict: build as planned / revise then build / rethink.
