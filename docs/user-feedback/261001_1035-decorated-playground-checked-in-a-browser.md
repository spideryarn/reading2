---
reports: spya-ptyszp
ending: shipped
---
# Decorated playground: checked in a browser, six defects fixed

Report spya-ptyszp (Sentry SPIDERYARN-READING2-8B) came from Greg, who is admin, on 2026-10-01. It
reached us as Overseer queue item qi-34246zwk.

> Have a look at decorated.html in a browser, and check that everything is still working correctly,
> inspect for errors, test the keyboard shortcuts if you can, take screenshots, etc. Fix any issues.

**Shipped.** Checked with Playwright against system Chrome, at 1440×900 and at 390×844 with touch.
There were no console errors from our code at either width. Six defects were found and fixed:

1. Copying several paragraphs carried our rhetorical-role labels into the clipboard. `verify.mjs`
   now checks the copy handler's strip list in the built page, and that check has a control.
2. A held `s` or `x` stuck on if the window lost focus.
3. Ctrl/Cmd combinations fired the shortcuts, and caps lock did not work.
4. On a phone, the "all on" preset widened the page. Prose was clipped and the **layers** button went
   off-screen.
5. On a phone, the prose ran to the screen edge.
6. On a phone, cards were wider than the screen.

The reasoning, the measurements and the deferred items (a touch way to *hold* x-ray and skim; a
`build.mjs` that rebuilds from the database) are in the plan,
[261001l](../plans/261001l-decorated-playground-checked-in-a-browser-and-its-shortcuts-fixed.md).
