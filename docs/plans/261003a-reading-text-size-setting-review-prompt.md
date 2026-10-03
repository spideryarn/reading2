You are reviewing a PLAN (not code) in the Spideryarn repo, read-only. The plan is docs/plans/261003a-reading-text-size-setting.md. Read it, then check its claims against the code: styles/tokens.css (--reading-size, --rhythm, --block-pad, .reading-column), src/web/styles/prose.css, src/web/styles/gutter.css, src/web/styles/narrow-window.css, src/web/styles/quiz.css, src/web/styles/footnotes.css, src/web/layout.ts (PROSE_ALONE_MAX_REM, proseAloneMaxPx and every consumer of rootFontPx), src/web/main.tsx, src/web/SettingsSection.tsx, src/web/ProfilePage.tsx, src/web/experimental-store.ts, and anything in src/web that measures prose geometry in JS (spine, marginalia, gutter, reading-time, scroll restore by ?at=).

The owner's bar: build only if it is one stored setting and one root variable the prose already follows, with nothing re-aligned by hand; otherwise stop and ask. Low priority feature.

Answer, concisely, with file:line evidence:
1. Is the bar actually met? Hunt specifically for anything that reads the prose font size or line height in JS, or a hard-coded px/rem constant standing in for --reading-size (e.g. 17px, 1.0625rem, 23.8, line-height 1.6 assumptions, values cached once at mount, missing ResizeObservers) that would silently go wrong at 15 or 21px. Name each one.
2. Prose only vs whole interface: agree or disagree, and why.
3. Per device (localStorage, applied before createRoot) vs per account (a column on reader_profiles): agree or disagree. Is the "jump after ?at= scroll restore" argument real in this codebase?
4. Any simpler design that meets the same need.
5. Any P0/P1 problems with the pieces or tests as listed.
Do not edit any files.
