Code review (write-capable: fix what you find inside this change, report anything wider) of a small CSS fix in /var/tmp/spideryarn-worktrees/chat-phone-guide-chip.

Bug: at phone width (390px), when the mode band covers the article (`.reader.band-covers .mode-band`), the way-back chip (`.return-chip`, drawn by src/web/ReturnChip.tsx or src/web/BandBackChip.tsx; positioned in src/web/styles/dock.css § `.return-chip`, with `--return-chip-h` set by `:root:has(.return-chip)`) sat over the band's last row — in Chat, the composer's input box.

Fix: `padding-bottom: var(--return-chip-h)` on `.reader.band-covers .mode-band` in src/web/styles/narrow-window.css. Plan: docs/plans/261008f-the-way-back-chip-covers-chat-s-input-on-a-phone.md. Test: tests/the-way-back-chip-clears-a-covering-band-in-chrome.test.ts (red before, green after; run `npx vitest run <file>`).

Please check:
1. Does any other rule override padding on the covering band (specificity, per-mode `.mode-band` rules, `:where()` guards in narrow-window.css/shell.css) so the padding is lost in some mode? Check each mode's top-level band children, e.g. modes whose root inside .mode-band does not shrink (min-height, fixed heights) and would overflow into the padding.
2. The geometry: the chip's bottom is `--dock-space + --hint-h + 0.75rem`; the band's bottom is `max(--dock-bottom, --safe-bottom) + --hint-now`. Under band-covers a guard forces --dock-bottom/--hint-now to the resting values. Is padding of exactly --return-chip-h enough in every state (iOS keyboard via --kb-inset, install hint, safe-area)? Note the chip doesn't move with --kb-inset.
3. The herald (`.reader.band-covers .mode-herald-slot` in mode-band.css, and `footRoom` in src/web/ModeHerald.tsx) — does the herald now double-count or misplace? Fix the comment there if it is now stale.
4. Is the test honest (would it pass for nothing)?
5. Anything the plan doc says that is wrong.

Diff:
diff --git a/src/web/styles/narrow-window.css b/src/web/styles/narrow-window.css
index bb43b65d0..2a37ef2bb 100644
--- a/src/web/styles/narrow-window.css
+++ b/src/web/styles/narrow-window.css
@@ -338,6 +338,16 @@
   right: var(--safe-right);
   width: auto;
   border-right: none;
+  /* **And the way-back chip's room at its foot.** The chip (dock.css § the way
+     back) stands at the band's right edge plus a gutter, which is the window's
+     left edge here: it lay over the band's last row, and in Chat that row is
+     the composer — at 390px it hid the start of the input box (plan 261008f).
+     `--return-chip-h` is 0 with no chip, so this costs nothing otherwise, and
+     it is the chip's whole room, gap below included, so the foot ends where the
+     chip begins. Padding rather than a raised `bottom`, so the strip under the
+     foot is the band's ground and not the article showing through.
+     tests/the-way-back-chip-clears-a-covering-band-in-chrome.test.ts. */
+  padding-bottom: var(--return-chip-h);
 }
 
 /* **And the article's masthead goes while a mode is open.**
