# A scroll aimed before the fonts arrive lands where the text was

**What happened.** The new `/help` page (plan
[261002b](../plans/261002b-help-page.md)) scrolls to the section named in its address. On a reader's
first visit, `/help#mode-skim` left the heading about 880px above the window; on every later visit it
landed exactly. Caught by the stage's Playwright check before it shipped, with a fresh browser
context per run; never seen by a reader.

**The real cause, measured.** The page asked for the scroll while `document.fonts.status` was still
`"loading"`. The heading was then at 16,863px. About half a second later Geist arrived, the text above
reflowed shorter, and the heading moved to 15,903px — but Chrome's smooth scroll keeps the
destination it computed when it started, so it carried on to the old place. With the fonts cached
there is no reflow, which is why only a first visit missed. Not the lazy chunk's CSS, not images, not
`history.scrollRestoration`: each was ruled out on the timeline.

**The class: a position computed before layout has settled.** Any code that turns "go to X" into a
pixel position — `scrollIntoView`, a smooth scroll, a measured offset — is answering against the
layout of that moment. A page that is still receiving fonts, images or a lazy chunk will move under
the answer, and a smooth scroll cannot notice. It hides in development because the developer's
browser has everything cached; it shows on exactly the visit that matters, the first one, from a
link somebody sent.

**Introduced by** `4aeb29585` (stage 1a), which reused the reveal-and-flash from the Metadata page.
Metadata never showed it because its reveals come from a click, long after the fonts are in.

**The fix that is right for the long term.** `flash.ts § scrollToAndFlash` keeps the target aligned
for two seconds after the scroll is asked for — asking again when a font finishes loading or the page
resizes — and stops the moment the reader wheels, presses a key or touches, so it never fights them.
Shared code, so Metadata and anything else arriving by anchor get it.

**What would catch the class.** A browser check that loads every deep link **from a fresh context
with the cache off**, not a warm tab — the stage's own check found it that way, and the repro script
is the shape to copy. Unit tests cannot see it: jsdom has no fonts and no layout.
