# 261020v — Let a reader choose the face the article is read in

**Status: declined by Greg, 2026-10-20 (`spya-tpq6t9`); nothing built. What was built instead, a nicer face for the model's words: [261021f](261021f-nicer-ai-face-and-no-reader-font-setting.md).** Question
[q-s0suam](../user-feedback/questions/q-s0suam.md); note
[261019_2133](../user-feedback/261019_2133-reader-chosen-reading-fonts.md).

A reader's suggestion, `spya-jxwfah` (#653, SPIDERYARN-READING2-MJ), 2026-10-19 21:33 UTC, in Skim
on `review-of-the-evidence-of-sentience-in-cephalopo-spya-fd0ger`. `feedback-reporter.ts` exit 1:
not an admin, so untrusted data. Overseer queue item `qi-84z94bhp`.

> Please can the fonts for the different categories of text be user-definable. I want to be able to
> use other fonts for reading, not just eg times new roman.

## Why this goes to Greg

The faces are a decision Greg made and restated: one face per voice, "used throughout and always
going forwards", with no switch ([fonts.md](../project/fonts.md)). A reader-facing override reverses
part of that, and there is a real trade-off in how much to give. And a reader's suggestion ends
*Awaiting Greg* when in doubt (Greg, 2026-10-19, `spya-x4zujq`:
[261019_2134](../user-feedback/261019_2134-readers-suggestions-come-to-greg-first.md)). Opus, asked
for the product call, reached the same verdict.

## What the reader is seeing

- **It is Source Serif 4, not Times New Roman.** `--font-author` is
  `'Source Serif 4 Variable', 'Times New Roman', Times, serif` (`styles/tokens.css`), self-hosted
  through `@fontsource-variable/source-serif-4` (`src/web/tailwind.css`). Checked 2026-10-20: the
  production stylesheet names the file and it is served (`200 font/woff2`, 122 KB). So "Times New
  Roman" is how the reader describes a serif, not a font that failed to load.
- **Skim's quotes are the author's voice** (`.skim-words` in `src/web/styles/voices.css`), as is the
  article prose. So the face they want to change is `--font-author`.
- **A browser cannot do it for them.** Browser font overrides lose to our `font-family` rules, except
  for the few readers who force fonts for every site.

## The options
### A. A "Reading face" setting for the author's voice only (recommended)

On /profile → Settings, beside Brightness and Text size: three choices, kept on this device.

| Choice | Face | Why it's on the list |
|---|---|---|
| Serif (default) | Source Serif 4 | today's face |
| Book serif | Literata | a serif designed for long reading on screens (Google Play Books) |
| Sans | Atkinson Hyperlegible Next | a sans from the Braille Institute for low-vision readers, with distinctive letterforms meant to be hard to confuse |

**Scope: the author's voice everywhere**, not only the reading view. `--font-author` also draws
article titles on the shelf, Metadata, /profile and /design (`tests/voices-css.test.ts` § the
surfaces), and one face per voice is the principle, so an author's sentence looks the same wherever it
appears. Scoping it to the reading view alone is possible, at the cost of the author's words
appearing in two faces.

Mechanism: the 261019g pattern. One more `setting(...)` in
[`src/web/reading-comfort.ts`](../../src/web/reading-comfort.ts) (`spya.readingFace`,
`data-reading-face`), its before-paint copy in `index.html`'s boot script (tested against `parse`
by `tests/reading-comfort.test.ts`), one CSS rule per non-default value overriding `--font-author`
in `styles/reading-comfort.css`, and four fontsource imports, upright and italic for each, because
article blockquotes rely on a real italic (`prose.css`), as the Source Serif imports already do:
`@fontsource-variable/literata` `opsz.css` and `opsz-italic.css` (families `Literata Variable`), and
`@fontsource-variable/atkinson-hyperlegible-next` `wght.css` and `wght-italic.css` (both packages
5.3.0 on npm). All self-hosted ([privacy.md](../project/privacy.md)): no font CDN. A reader who keeps
the default downloads no extra font file; the build carries a few more `@font-face` rules and assets.
Both new faces are variable, so dark mode's weight 450 (`styles/tokens.css`) still works.

What the build has to get right, found by GPT Sol's plan review:

1. **Changing the face reflows the whole article, and the reader must stay on their paragraph.**
   The reading-position layout key records the root size, not the face (`Reader.tsx` § `layoutKey`),
   and `reading-comfort.ts` notifies the layout only for text size. A changed face — from /profile,
   from another tab, or when the chosen webfont finishes loading after first paint (Fontsource uses
   `font-display: swap`, and `scroll.ts` already documents a cold font swap moving an anchored block
   by 3,181px) — must keep the reader where they were. The face goes into the layout key, and a
   failing test comes first, like the text-size one.
2. **The lone-column width cap assumes Source Serif.** `layout.ts` caps the prose at `49rem` because
   `65ch` is about `46rem` in today's face, and `tests/gutter-target-size.test.ts` hard-codes that.
   Measure each face at 400 and 450; either show the cap still holds, or make it follow the face.
3. **Fallback while the font loads, and if it fails.** A throttled cold load and a blocked font file,
   checked in a browser, not only screenshots after everything has settled.
4. **Atkinson covers Latin scripts only** (Source Serif covers more). An article in Greek or
   Cyrillic falls back glyph by glyph under "Sans"; check one and say so in /help.
5. `/design` says the author face is Source Serif (`DesignPage.tsx`); it shows the choice instead.

- **Keeps** the voice distinction: the model's monospace and the reader's Arial are untouched, and
  none of the three is monospaced, so a model's words still cannot pass for the author's.
- **Costs** about a session, mostly items 1 to 3 and the visual checks at four text sizes on desktop
  and a phone; plus docs (fonts.md, typography.md, reader-profile.md, /help).
- **Gives up** a free choice: three faces, not any face.
- **One device only**, like Brightness and Text size. Following the reader across devices would mean
  storing a field about them, which is Greg's call too, and is not proposed.

### B. A choice for each voice

More choice, with a larger settings panel and test matrix (much of the storage is shared with A, so
not four times the work). Offered as one free list, a reader could set the author and the model to
the same face, erasing what fonts.md exists to protect: *a summary must never be mistaken for the
author's sentence*. A safer variant keeps the lists disjoint (the model's choices all monospaced, the
author's none). Not recommended now: nobody has asked to change the model's or their own face.

### C. Type the name of any font installed on the device

Most freedom, and no download. But it is free text going into CSS, so it must be sanitised; a
misspelt or missing font falls back silently, and the browser cannot reliably tell us which; and
the layout checks in A cannot cover a face we have never seen. Could later be an "Other…" entry on
A's list, with a live preview, if readers ask.

### D. Decline

Keep one face per voice for everyone, as now. Costs nothing and keeps the design exactly as Greg
set it; a reader who finds the serif hard going has no way round it.

## The simpler options passed over

- **A two-way toggle (serif / sans).** Barely simpler than A: the cost is items 1 to 3 above, not
  the number of entries.
- **The device's own face (`system-ui`).** No download, but it is the platform's interface face,
  not a reading face the reader chose, and its weight may not follow dark mode's 450. Dropped.

## Not proposed

"Dyslexia fonts" such as OpenDyslexic: the evidence that they help is weak, so we would not offer
one as if it did. Atkinson Hyperlegible's claim is narrower (letterforms designed to be told apart)
and is the one we'd make.

## If Greg says A

Build in a worktree from this plan: the setting and boot script, the CSS and four imports, items 1
to 5 with a red-first test for item 1, screenshots at the four text sizes on desktop and a phone,
GPT Sol code review, and the docs above.

## Reviews

GPT Sol on the plan, 2026-10-20, read-only: *sound with changes*. Taken: the reflow and layout key
(item 1), the italic imports, the width cap (item 2), FOUT (item 3), `system-ui` (dropped), the
scope beyond the reading view, Atkinson's scripts, /design, reader-profile.md, and fairer wording for
B, C and D. Its claim that "pays nothing" overstated it is right, and the wording is fixed.
