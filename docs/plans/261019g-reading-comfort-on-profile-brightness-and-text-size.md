# 261019g — Reading comfort on /profile: a brightness setting and a text size

Two admin reports from Greg, 2026-10-18, on a portrait iPad in its home-screen app, batched as Overseer
queue item `qi-7f32x9h3` (note: [261018_2348-dimmer-dark-mode-and-a-text-size-setting.md](../user-feedback/261018_2348-dimmer-dark-mode-and-a-text-size-setting.md)).

> I'm in a dark bedroom, reading on my iPad, and I'm in dark mode for Spideryarn. But even so, it's
> not quite as dark as I would like. The text is still quite bright, even with the brightness
> setting down as low as it will go. So I wonder if it would be possible to have a brightness
> setting, which probably doesn't really need many, many gradations, so that I can make the
> background darker and the text slightly darker as well, to enable the iPad, in effect, to show
> less light even than its own brightness setting allows.
>
> — Greg, 2026-10-18 (`spya-q645m0`)

> I would like to be able to increase the size of the text. […] I've done the thing on the iPad
> where you can share it to the home screen […] But I can't seem to figure out how to change the
> text size in the browser. […] If I had to guess, I suppose I would imagine that we'd want to
> change all of the text sizes accordingly, that we'd have some kind of global baseline or default
> or whatever, and everything is sized relative to that. […] it's not worth enormous amounts of
> implementational complexity, especially not if it's going to create bugs or make things hard to
> maintain. If you do see a way forward that isn't too complex and that you do think is the best of
> all worlds, then proceed using screenshots and making sure to document accordingly, so that going
> forwards, future modes and UI changes naturally do the right thing.
>
> As we were saying just a moment ago, for the brightness setting, I think because this isn't
> article specific, the setting for it should live in the user profile rather than in the article
> metadata.
>
> — Greg, 2026-10-18 (`spya-ast8cu`)

## What changed since "not now"

A text-size setting was declined on 2026-10-08 ([q-wux4k7](../user-feedback/questions/q-wux4k7.md),
plan [261003a](261003a-reading-text-size-setting.md)) because browser zoom covers it. Greg's new
fact: a home-screen web app on iOS has no browser zoom and no Safari "aA" menu. So the reason for
"not now" is gone for exactly the device he reads on.

261003a's decisive finding was that **only the prose follows `--reading-size`**; headings, captions
and footnotes are fixed `rem`, so scaling `--reading-size` alone inverts the hierarchy. That finding
is about scaling *one variable*. It does not apply to the design below, which scales the root.

## Text size: scale the root font-size, and let `rem` do the rest

**The design is one rule.** A `data-text-size` attribute on `<html>`, set before first paint, and

```css
:root[data-text-size="large"]   { font-size: 112.5%; }  /* 18px at a 16px default */
:root[data-text-size="larger"]  { font-size: 125%;   }  /* 20px */
:root[data-text-size="largest"] { font-size: 137.5%; }  /* 22px */
```

Default sets nothing. Percentages, not px, so a reader's own browser default still compounds under it.

Why this is small rather than a project, measured in the tree today:

- **The app is already written in `rem`.** In the finished tree, 503 `font-size` declarations use
  `rem`; the only fixed px sizes are the three Diagram force-graph labels at
  `diagram.css:280-282` (plus the deliberate `max(1rem, 16px)` iOS focus-zoom floor).
  Headings, captions, footnotes, mode-band text roles (`--type-item` and friends), controls
  (`--control-h: 2.25rem`) and `--reading-size` itself are all `rem`, so all of them move together
  and the hierarchy is kept exactly — the 261003a problem does not arise.
- **The JS layout already follows the root.** `layout.ts`'s type-sized widths
  (`PROSE_ALONE_MAX_REM`, `WIDE_IDEAL_REM`, Structure's columns, `MARG_GAP_REM`) are multiplied by
  `rootFontPx`, read live from `getComputedStyle(document.documentElement).fontSize`
  (`reader/measure.ts` § `useRootFontPx`), because a reader whose *browser* default is 20px already
  gets exactly this. Its comment already names "a settings change" as a thing that moves it.
- **The app is already tested at a non-16px root.** `/design` has a "larger root" switch that sets
  `<html>` to 20px (`DesignPage.tsx` § `bigRoot`), and `controls.md` notes the close cross is in px
  "because the app supports a 12px root".

So this is the same thing a reader with a larger browser default gets, which the app already
supports, behind a control. In Greg's case — Plain on a portrait iPad — the measure is
`clamp(45ch, 90vw, 65ch)` in the prose's own font, so the line widens into the empty margins he
described, up to the `PROSE_ALONE_MAX_REM` cap, which grows with the root too.

**Everything scales, not just the article — which is Greg's guess, and the better choice here.**
Reading apps (Kindle, Books, Readwise) scale the content only; but their chrome is native and
follows the OS's own text size. Ours is web, and in a home-screen app nothing else will scale it.
And scaling the root needs no second scale, so a future mode does the right thing by using `rem` —
the house idiom already — rather than by remembering to opt in.

**What the web research found** (a Sonnet subagent, 2026-10-19, asked at Greg's suggestion). WCAG
1.4.4 counts an on-page control that enlarges *all* text (technique G178) as one way to meet it,
and lists percent and `em` font sizes as sufficient techniques
([Understanding 1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)). `rem` in a
media query resolves against the browser's initial size, not the CSS root (confirmed, see below). It
could not confirm what Kindle, Readwise and the rest do in their web versions, or any iOS-standalone
quirk; the device check below is what answers those.

What does *not* scale, by design or by accident:

- **CSS media queries.** `rem`/`em` in a media query mean the *initial* font size, never the
  root's, and ours are in px anyway. So breakpoints stay put; at a larger size the JS layout gives
  up columns sooner (its ideals are in rem), which is the right direction.
- **The three fixed px font sizes**, Lucide icons (sized in px at the call site), and the deliberate px
  rows in controls.md. Icons beside bigger text look a little small; tolerable, and the same as a
  reader with a 20px browser default sees today.
- **A live change while an article is open.** The control lives on `/profile`, where none is
  mounted, so the next article mounts at the new size. A change from another tab arrives by the
  `storage` event; after applying it we dispatch one `resize` so `useRootFontPx` re-reads — the
  hook's own comment calls `resize` the cheapest thing that notices.

A guard so it stays true: a test that no stylesheet under `src/web/styles/` or `styles/` declares a
`font-size` or `font` shorthand in px outside an exact allowlist with reasons. That is the "future
modes naturally do the right thing" Greg asked for, and it fails on the day someone writes
`font-size: 13px` — including in the one stylesheet that has allowed declarations already.

## Brightness: one dimming layer over everything

**The design is one pseudo-element.** A `data-brightness` attribute on `<html>`, set before first
paint, and

```css
:root[data-brightness]::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  background: rgb(0 0 0 / var(--dim));
}
:root[data-brightness="dim"]     { --dim: 0.2; }  /* 80% of the encoded value */
:root[data-brightness="dimmer"]  { --dim: 0.35; } /* 65% */
:root[data-brightness="dimmest"] { --dim: 0.5; }  /* 50% */
```

Black at alpha *a* over a pixel scales its encoded value by 1 − *a*: the page, the ink,
highlights, pictures, the model-painted Illustrated images, everything — which is what "show less
light than its own brightness setting allows" means. *(Corrected after review: through sRGB's
gamma that leaves about (1 − a)^2.2 of the light, not 1 − a, and contrast falls rather than holding
— the levels were recalibrated to 0.2 / 0.35 / 0.5; see § Plan review.)*

**Passed over: a third palette** (a `data-theme="dim"` with darker values of every token). It is
what "darker background and slightly darker text" literally describes, but the dark page is already
`#0a0a0a`, nearly black, so the light that matters is the ink's, and a palette would mean a third
value for every colour token and every categorical scale — 261003e needed a test just to keep two
in step. It would also leave pictures at full brightness. The overlay needs no tokens, and every
future colour follows it for free.

**Passed over: `filter: brightness()` on the root.** Same effect, but a filter makes the element a
containing block for `position: fixed` (the root is exempt in the spec, not reliably in every
engine), and it re-filters the whole page on every scroll frame. An overlay is one composited layer.

Two places the layer cannot reach, and what covers them:

- **Top-layer dialogs** (`showModal()`: the Lightbox, Feedback, Command Bar, purpose prompt, Sketch
  and Illustrated) draw above any `z-index`. `:root[data-brightness] dialog[open]` gets
  `filter: brightness(calc(1 - var(--dim)))`; the already-dark `::backdrop` is left alone. A filter
  makes the dialog a containing block for fixed descendants, so the current inventory was checked:
  every dialog is itself the viewport overlay. Feedback's fixed Toast is its one fixed descendant;
  it stays in the same corner relative to that same box (and follows the measured visual viewport
  on iOS). A future fixed descendant needs this rule rechecked.
- **The browser's own furniture** (the status bar, the scrollbar) is outside the page. Nothing to do.

It works in Light as well as Dark — same rule, no theme check — which is simpler and not wrong.

## Where it lives, and why not on the profile row

Greg: *"the setting for it should live in the user profile rather than in the article metadata."*
Both controls go in `/profile`'s **Settings** card under Appearance, as two more rows of native
radios like `AppearanceSetting.tsx`.

Stored **per device, in `localStorage`**, like Appearance, and not as a `reader_profiles` column:

- **Both must be known before first paint.** A brightness that arrives with `GET /api/reader`
  is a full-brightness flash in a dark bedroom on every page load — the very thing being fixed.
  A text size that arrives late re-lays the page under the reader after `?at=` has placed them.
- **Both are facts about the screen, not the person.** Dimmest on the iPad in bed and full on the
  desk is the point; synced, one would overwrite the other.
- **No migration, no route field, no store.** The same reason Appearance is per device
  ([261003e § Key decisions 1](261003e-light-dark-and-system-appearance-on-profile.md#key-decisions)).

## The pieces

1. **`src/web/reading-comfort.ts`** — the two settings: values, keys (`spya.brightness`,
   `spya.text-size`), guarded reads and writes, `setComfort()` (sets or removes the two attributes),
   a `storage` listener started from `main.tsx` beside `startAppearance()`, and the generic
   `useComfort()` hook with the same "couldn't save" state Appearance has.
   *Not* folded into `appearance.ts`: that file is about the theme, and these are not.
2. **`index.html`** — the inline `appearance-boot` script also sets the two attributes. One script,
   because one head script is enough and each `<script>` is a parse; the test lifts it as today.
3. **`src/web/styles/reading-comfort.css`** — the overlay, the dialog filters and the three root
   sizes, imported with the other app styles.
4. **`src/web/ReadingComfortSettings.tsx`** — two radio rows, Brightness (Full · Dim · Dimmer ·
   Dimmest) and Text size (Default · Large · Larger · Largest), applied on change, one "Saved on
   this device" line; rendered in `ProfilePage.tsx`'s Settings card after `AppearanceSetting`, and
   the section's search keywords gain *brightness, dim, night, text size, font, bigger*.
5. **Tests, red first** — `tests/reading-comfort.test.ts`: parse (unknown and throwing storage read
   as the default), the inline script agrees with the module for every stored value (the
   `appearance.test.ts` pattern), the control writes and applies; and the px `font-size` guard.
6. **Docs** — `typography.md` gains *§ The reader's text size scales the root* (the rule for future
   code: size type in `rem`; px only on the allowlist, with a reason); `design-css-overview.md`
   one line; `web-client.md § Appearance` a paragraph and a pointer for brightness;
   `reader-profile.md` the two rows; the `/help` page's settings text if it lists them; the
   `ProfilePage.tsx` header line that still says typography settings were rejected.

## Browser check (Sonnet subagent, Playwright on the box)

At 820×1180 (Greg's portrait iPad) and 390×844, Dark: Plain and Glossary at each text size, with
before/after screenshots kept under `docs/plans/261019g-shot-*.png`. Ask for: no horizontal scroll,
hierarchy intact (h2 > h3 > body), gutter icons on their lines, the band giving up columns cleanly,
the masthead and controls bar not overlapping. Brightness: a pixel read of the page and of body ink
at each level (expect encoded pixels ≈ 80/65/50%, or emitted light ≈ 60/38/22%), taps still reach
links and buttons through the layer, and the Lightbox open under Dimmest is dimmed too.

## Done looks like

Greg, on the iPad home-screen app, opens /profile, picks Dimmest and Larger; every page after that,
including the first paint of the next launch, is dimmer and bigger, and the article fills the margins
he pointed at.

## The simpler options passed over

- **Text size: body text only** (261003a's option A) — inverted hierarchy, rejected there.
- **Text size: the article's type scale only** (261003a's B) — about ten rules rewritten as ratios,
  and every future mode has to choose which scale it is on. More work than the root, and it leaves
  the chrome small on the one device where nothing else can enlarge it.
- **Brightness: Greg turns on iOS's own "Reduce White Point"** (Settings → Accessibility → Display),
  which dims below the slider for every app. Worth telling him either way — it is free and works now
  — but it is system-wide, buried, and he asked for it in Spideryarn.

## Plan review (GPT Sol, 2026-10-19) and what changed

[261019g-plan-review-sol.md](261019g-plan-review-sol.md), `--sandbox review`, effort high: no P0,
**build with changes**. Each finding checked against the code; all accepted:

1. **P1 — a text-size change rewraps every paragraph under an unchanged `layoutKey`**
   (`Reader.tsx`), so `useReadingPosition` would take it for "nothing moved". Confirmed: the key had
   widths only. `rootFontPx` is in it now, with a red-first test.
2. **P1 — "contrast keeps its ratio" was false.** Confirmed by arithmetic: alpha scales encoded
   values, light goes as their 2.2 power, and WCAG adds 0.05. The levels were recalibrated from
   0.3 / 0.5 / 0.65 (which would have left 46 / 22 / 10% of the light and body contrast 2.8:1 at
   Dimmest) to **0.2 / 0.35 / 0.5: about 60 / 38 / 22% of the light, body ink 11.5 / 7.7 / 4.8:1,
   muted ink 4.0 / 3.0 / 2.2:1** — every step keeps body text past 4.5. The numbers are in the
   stylesheet's comment.
3. **P1 — `layout.ts`'s screen thresholds stay px**, so at Largest the prose floor holds fewer
   characters. Accepted for v1 and written into typography.md; the layout and rotation sweeps gained
   18 and 22px roots; the browser check adds 700px and Marginalia.
4. **P1 — print, and a real iPad.** A print rule turns the layer and the dialog filter off. A real
   installed-iPad pass is not something the box can do; it is Greg's, after deploy, and the note says
   so.
5. **P2 — the px guard reads stylesheets only.** True; the claim in typography.md is narrowed to say
   so rather than widened to TSX, where the px sizes are SVG and chart labels.
6. **P2 — the dialog inventory missed the command bar and Sketch**, both `showModal()`, both covered
   by the generic `dialog[open]` rule. The `::backdrop` filter was dropped: the backdrop is already
   dark and `lightbox.css` records why custom properties do not reliably reach it. The overlay was
   also shrunk from `inset: -50vh -50vw` to `inset: 0`, since a fixed box already covers an iOS
   overscroll.
7. **P2 — `/design`'s 20px root switch** overrides the setting while on; its comment now says it is a
   diagnostic, not a preview. **Feedback diagnostics** now record `brightness` and `textSize`. Help
   updated and the corpus regenerated. `pageshow`/bfcache and failed-write handling were already
   copied from Appearance.

It confirmed per-device `localStorage`, and that the signed-out pages keep the boot script
(`build-site-pages.ts` replaces only the managed head region).

## Browser evidence (2026-10-19, Playwright on the box, Dark, article `scaling-hypothesis`)

A Sonnet subagent, then one measurement of my own. No horizontal page scroll in any case. The root
is 16 / 18 / 20 / 22px across the four sizes.

**Greg's case, Plain at 820px**: the prose grows into the margins he pointed at.

| Size | Body | Prose width | Margin left / right |
|---|---|---|---|
| Default | 17px | 573 | 123 / 124 |
| Large | 19.1px | 632 | 93 / 95 |
| Larger | 21.3px | 696 | 60 / 64 |
| Largest | 23.4px | 729 | 43 / 48 |

- **Hierarchy scales together**: h2 20 → 27.5px, h3 17 → 23.4px (h3 equals body at every size, as
  it already does at the default).
- **Glossary at 820**: the band keeps ~320px and the prose narrows 462 → 448px. **At 700px, Largest**:
  prose 332px beside the band, which is cramped but does not overflow — the screen thresholds in
  § Plan review 3.
- **Marginalia at 820, Largest**: the subagent reported the notes clipped at the edge. Measured: the
  note boxes sit at 556–820px at all four sizes, their contents end at 809–812px, and the "…" it saw
  is the folded note's own ellipsis. Not a regression.
- **A phone at Largest**: the Dock shows fewer of its buttons and scrolls sideways for the rest,
  which it is built to do (`dock.css` § `overflow-x: auto`). Accepted.
- **Brightness**: the layer reads `rgba(0,0,0,0.2 / 0.35 / 0.5)`; sampled pixels of ink (245 →
  196 / 159 / 122) and page both scale by 0.80 / 0.65 / 0.50, as designed. At Dimmest a click on
  "Show counts" and on a Dock button both went through. The Feedback dialog computes
  `filter: brightness(0.5)` and is visibly dimmed. The image Lightbox was not opened.
- **/profile**: the two rows sit under Appearance in Settings and apply at once.

Screenshots: [820 Plain, Default](261019g-shot-820-plain-default.png) ·
[820 Plain, Largest](261019g-shot-820-plain-largest.png) ·
[390 Plain, Largest](261019g-shot-390-plain-largest.png) ·
[700 Glossary, Largest](261019g-shot-700-glossary-largest.png) ·
[820 Marginalia, Largest](261019g-shot-820-marginalia-largest.png) ·
[820 Plain, Dimmest](261019g-shot-820-plain-dimmest.png) ·
[Feedback dialog, Dimmest](261019g-shot-820-feedback-dialog-dimmest.png) ·
[/profile's rows](261019g-shot-820-profile-rows.png).

**Not checkable here**: the installed iPad app itself — first paint from a cold launch, the status
bar and home-indicator edges, an overscroll bounce. That pass is Greg's, after the deploy.
