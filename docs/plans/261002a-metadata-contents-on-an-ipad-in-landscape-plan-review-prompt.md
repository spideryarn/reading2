Review the plan docs/plans/261002a-metadata-contents-on-an-ipad-in-landscape.md (read-only review).

Read src/web/PageContents.tsx (the nav's className and the comment near "Fixed, in the margin"), src/web/Metadata.tsx around `<main className="metadata-page ...">` (~line 768), and anything else fixed-positioned on the Metadata page (the Dock, toasts, anything pinned left or right) that could collide at 1024–1280px widths.

Check:
- the arithmetic (border-box is global, src/web/styles/tokens.css);
- the Tailwind v4 arbitrary-value syntax with the `tw:` prefix for `margin-left: max(12rem, calc((100% - 48rem) / 2))`, and whether `100%` in a margin refers to what the plan assumes;
- safe-area insets (the installed app on an iPad);
- whether anything else relies on `main` being centred (a band, a sticky bar, the dock's alignment);
- whether a simpler or better design exists.

List findings by severity with file:line, then a verdict.
