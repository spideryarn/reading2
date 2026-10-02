# A nicer typeface for AI-written text than Courier

**Question** (Greg, 2026-10-01, SPIDERYARN-READING2-7N):

> But Courier is really ugly. Do some web research on a more attractive font that would still
> indicate that it's somehow machine/AI-generated - Courier is good in that respect because it looks
> typewriter-y, but it's just a bit too unattractive.

**Decision: IBM Plex Mono**, taken in
[261002b](../plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md) and recorded in
[fonts.md](../project/fonts.md). It is still a true monospace, so it still reads as machine-made,
with a real x-height and stroke where Courier has hairlines. **Runner-up: iA Writer Quattro.** It
reads best as paragraphs, but it barely looks monospaced, which is the signal Greg liked.

**The evidence that decided it** was the specimens rather than the metrics below. Each specimen sets
the same author paragraph, AI summary, reader question and AI reply in every candidate, in dark,
light and phone widths:
[dark](../plans/261002b-specimen-dark.png), [dark 2](../plans/261002b-specimen-dark-2.png),
[light](../plans/261002b-specimen-light.png), [light 2](../plans/261002b-specimen-light-2.png),
[phone](../plans/261002b-specimen-phone.png). Shot 2026-10-02 with Playwright from the Fontsource
woff2 files; every face was confirmed `loaded` in `document.fonts`.

**Dead ends:**
- **Recursive.** Fontsource's default import is the proportional sans. To be monospaced it needs
  `mono.css` (73 KB) and `font-variation-settings: "MONO" 1`, and the specimen without that setting
  rendered proportional.
- **Spline Sans Mono** reads as a code listing.
- **Red Hat Mono** is faint on a dark ground.
- **Xanh Mono** has no bold, and as a serif it blurs into the author's face.
- **Geist Mono** would blur "the app" and "the AI", since the chrome is Geist.

What follows is the research as the subagent wrote it, on 2026-10-02.

## How this was checked

- **Packages.** Each package's `latest` was read from `registry.npmjs.org`. Every one listed below is
  at **5.3.0**. Axes, weights and licence come from `api.fontsource.org/v1/fonts/<id>` and
  `/v1/variable/<id>`.
- **Family names.** The registered `font-family` string was read from each package's actual CSS on
  jsDelivr. Every CSS path quoted in §3 returned HTTP 200.
- **Measurements.** x-height and character width were measured from the Fontsource latin-400 woff2
  files with fontTools. The script is `scratchpad/metrics.py`. x-height is the height of the "x"
  glyph's bounding box, in em.
  - "avgW" is the average advance width over a sample English sentence, in em.
  - "cpl" means characters per line in a 600px column at 16px.
- **Reference faces.**

| reference | x-height | avgW | cpl |
|---|---|---|---|
| Source Serif 4 | 0.49 | 0.49 | 76 |
| Geist | 0.53 | 0.48 | 78 |
| Arimo (the Arial metric clone) | 0.53 | 0.46 | 82 |

The current repo imports are in `src/web/tailwind.css` lines 56-70. Courier Prime is imported as
static 400/700 plus italics. Geist and Source Serif are imported as `@fontsource-variable/.../wght.css`
(or `opsz.css`). The snippets in §3 follow that convention: all subsets are imported, and each
subset's `unicode-range` means the browser downloads only the latin one.

### Why Courier looks bad, so we know what to fix

- **Low x-height (0.45).** Body text looks small and grey.
- **Thin, even, monoline strokes.** Courier was designed for a typewriter ribbon striking paper, and
  without that it looks anaemic on a screen.
- **Commentators agree.** Butterick calls Courier "one of the worst" monospaced fonts, and says of
  body text: "there are no good reasons to use monospaced fonts. So don't." That is a warning about
  the *genre*, not only about Courier. Any monospace face costs some reading ease.
- **Width is the same across the field.** Almost every monospace face, Courier included, is 0.60
  em per character, about 62 cpl in 600px. Against Source Serif's 76, that is roughly 20% more
  horizontal space. None of the candidates below is meaningfully *worse* than Courier on width,
  except Martian Mono (0.70) and Azeret Mono (0.65).

What the AI voice wants:

- something that reads as **typed or machine-set**, which means monospace or near-monospace;
- a **normal-or-larger x-height**;
- **warmer, more designed letterforms**;
- ideally **variable weight**, so dark mode's 450 works.

## 1. Shortlist

### Baseline: Courier Prime

- **Package:** `@fontsource/courier-prime` 5.3.0. Static, 400/700 plus italic. OFL-1.1.
- **Metrics:** x-height 0.451, 0.60 em per character, about 63 cpl.
- **Machine-made?** Maximally: it is the typewriter archetype.
- **Drawbacks:**
  - small x-height and thin strokes, which make it look grey and old;
  - no 450 weight, so `font-weight: 450` falls back to 400.

### A. IBM Plex Mono (top pick)

- **Package:** `@fontsource/ibm-plex-mono` 5.3.0. Static only: weights 100-700 plus italics. There
  is **no** `@fontsource-variable/ibm-plex-mono`. OFL-1.1.
- **Metrics:**
  - x-height 0.516, a clear step up from Courier's 0.451;
  - 0.60 em per character, about 62 cpl, the same as Courier.
- **Why it reads as machine-made.** Its design is explicitly "man and machine". It borrows from the
  IBM logotype and historical typewriter faces. The italic is modelled on the **IBM Selectric's
  Italic 12**. The slab serifs on i, l and r keep a typewriter echo.
- **Why it is nicer than Courier.**
  - Real stroke weight, square-ish counters and a higher x-height.
  - Reviewers call it "humane and readable at small sizes, with a steady rhythm that holds up over
    long sessions", and call its italic "absolutely gorgeous".
  - It is the base that iA chose to build its writing fonts on (see B).
- **Drawbacks.**
  - **Not variable on Fontsource.** For dark mode, import the static 500 as well. CSS's
    weight-matching rule sends `font-weight: 450` to **500** when 500 exists, otherwise to 400. So
    you get a 400→500 step, a slightly bigger thickening than the 450 you have now.
  - Still a pure monospace, so "m" and "w" look cramped in running text.
  - It is a recognisable IBM/Carbon brand face.
- **Sources:**
  - https://mikeabbink.com/typefaces/ibm-plex-mono/
  - https://typographica.org/typeface-reviews/ibm-plex/
  - https://en.wikipedia.org/wiki/IBM_Plex
  - https://fontsource.org/fonts/ibm-plex-mono

### B. iA Writer Quattro, or Duo (runner-up; the best for paragraphs)

- **Packages:** `@fontsource/ia-writer-quattro` 5.3.0 and `@fontsource/ia-writer-duo` 5.3.0. Both are
  static 400/700 plus italic. OFL-1.1 (derived from IBM Plex Mono). `@fontsource/ia-writer-mono`
  5.3.0 also exists.
- **Metrics.** x-height 0.516 (Plex's). Quattro averages 0.553 em, about **68 cpl**. Duo averages
  0.613 em, about 61 cpl.
- **How the widths work.** iA's "duospace" fonts start from IBM Plex Mono.
  - **Duo** gives m, M, w and W 1.5× width and keeps everything else monospace.
  - **Quattro** allows four widths: ½, ¾, 1 and 1½.
  - iA changed "g" to single-storey.
- **Why it reads as machine-made.** iA's own case is that monospace looks like "work in progress"
  and that it "slows readers down". The rhythm stays visibly typewritten. Blake Watson: "you still
  retain the typewriter aesthetic with a bit more legibility … the readability of a proportional
  font with the rough draft feel of a monospaced one."
- **Why it is nicer than Courier.** It has all of Plex's quality, and it fixes the cramped m/w that
  is the main ugliness of monospace in paragraphs. Quattro is also the narrowest option here that
  still looks typed (68 cpl against Courier's 63).
- **Drawbacks.**
  - **Static 400/700 only.** `font-weight: 450` falls back to 400, so dark-mode thickening is lost
    unless you accept faux-bold or drop it for this face.
  - Quattro is close enough to proportional that, at a glance, *some* readers may not register it as
    "monospace". Duo keeps the signal stronger, at about 61 cpl.
  - The fonts are strongly associated with the iA Writer app, though under OFL that is a matter of
    taste, not licence.
- **Sources:**
  - https://ia.net/topics/in-search-of-the-perfect-writing-font
  - https://blakewatson.com/journal/almost-monospaced-the-perfect-fonts-for-writing/
  - https://github.com/iaolo/iA-Fonts
  - https://fontsource.org/fonts/ia-writer-quattro

### C. Recursive Mono, Linear or Casual (most flexible; variable)

- **Package:** `@fontsource-variable/recursive` 5.3.0. OFL-1.1. Static `@fontsource/recursive` also
  exists, but it is the **Sans**: MONO=0.
- **Axes:**
  - wght 300-1000;
  - MONO 0-1, default **0, which is proportional**;
  - CASL 0-1;
  - slnt −15 to 0;
  - CRSV.
- **Metrics:** x-height 0.532. At MONO=1 it is 0.60 em per character, about 62 cpl.
- **Why it reads as machine-made.** It was made for code and data apps. Mono Linear is crisp and
  engineered. Mono Casual is drawn from single-stroke sign-painting brushwork, which reads as
  friendly-machine, a bit like a handwritten terminal.
- **Unique to Recursive: a dial between monospace and proportional.** MONO can be set between 0 and
  1. A value of about 0.5–0.7 is *semi-proportional*, the same idea as iA Duo, but tunable and
  weight-variable. Its proportional sans (MONO=0) averages 0.518 em, about 72 cpl, so semi-mono
  lands somewhere around 65-68 cpl.
- **Why it is nicer than Courier.**
  - Warm, open, well-spaced forms and a large x-height.
  - A true 450 weight.
  - CASL lets you give the AI voice a hint of personality without becoming a novelty face.
- **The trap: Fontsource's default file is the wrong one.** `index.css`/`wght.css` contain **only**
  the wght axis, so the face is pinned to MONO=0 and renders as a *proportional sans*. You must
  import a file that carries MONO, and then set `font-variation-settings`. File options, latin woff2
  size:
  - `mono.css` — wght + MONO, 73 KB. Gives Mono Linear.
  - `full.css` — all five axes, **305 KB**. Needed for Mono Casual.

  For comparison, Plex Mono 400 is 15 KB.
- **Other drawbacks.**
  - Heavier download.
  - Busier personality than Plex.
  - `font-variation-settings` does not inherit and combine nicely with `font-weight`. Set MONO and
    CASL on the AI-voice class, and keep using `font-weight` for wght.
- **Sources:**
  - https://www.recursive.design/
  - https://github.com/arrowtype/recursive
  - https://fontsource.org/fonts/recursive

### D. Spline Sans Mono (variable; a calm grotesque)

- **Package:** `@fontsource-variable/spline-sans-mono` 5.3.0. wght 300-700 plus ital. OFL-1.1.
- **Metrics:** x-height 0.545, 0.60 em per character, about 62 cpl.
- **Why it reads as machine-made.** A "monospaced grotesque" made for UI, checkout and programming,
  with a "cool and restrained tone". It looks like a modern terminal, not a typewriter.
- **Why it is nicer than Courier.** Solid colour on the page, a big x-height, real italics and full
  variable weight, so 450 works.
- **Drawbacks.**
  - Less of the *typewriter* nostalgia Greg liked.
  - Its grotesque skeleton sits closer to Geist than Plex's slab-ish one does. Probably still
    distinct enough, but check side by side.
  - The "thorn" details only show at large sizes, so it is neutral at body size.
- **Sources:**
  - https://github.com/SorkinType/SplineSansMono
  - https://fonts.google.com/specimen/Spline+Sans+Mono

### E. Red Hat Mono (variable; a friendly geometric)

- **Package:** `@fontsource-variable/red-hat-mono` 5.3.0. wght 300-700 plus ital. OFL-1.1.
- **Metrics:** x-height 0.488, 0.60 em per character, about 62 cpl.
- **Why it reads as machine-made.** A plain coding monospace, open and rounded.
- **Why it is nicer than Courier.** Even colour, friendly round forms, real variable weight and italic.
  The latin woff2 is 22 KB.
- **Drawbacks.**
  - Its x-height is the lowest of the "modern" group.
  - Less character than Plex or Recursive.
  - A safe pick that does not delight.
- **Source:** https://fontsource.org/fonts/red-hat-mono

### F. Xanh Mono (wildcard: a serif monospace, the most "elegant typewriter")

- **Package:** `@fontsource/xanh-mono` 5.3.0. **Static 400 only**, plus italic. OFL-1.1.
- **Metrics:** x-height 0.54, and **narrow: 0.50 em per character, about 75 cpl**, matching Source
  Serif's line length.
- **Why it reads as machine-made.** It is monospaced, with pronounced editorial serifs. It is the
  nearest thing here to "a beautiful typewriter".
- **Why it is nicer than Courier.** It has contrast and real serif modelling, not Courier's monoline
  skeleton. It looks deliberate and literary.
- **Drawbacks.**
  - **No bold at all.** Bold in a summary would be faux-bold, and there is no 450.
  - Its serifs put it in the same broad family as the author's Source Serif 4. That may blur
    "author" and "AI" just as Geist Mono would blur "app" and "AI".
  - Quirky letterforms, which some will find too stylised for long paragraphs.
- **Sources:**
  - https://fonts.google.com/specimen/Xanh+Mono
  - https://typogram.co/font-discovery/how-to-use-xahn-mono-font

### Considered and not shortlisted

Each of these exists on Fontsource at 5.3.0 unless the note says otherwise.

- **JetBrains Mono** (variable, wght 100-800).
  - Excellent for code, but its tall, narrow-looking x-height (0.55) and coding ligatures read as
    "IDE", not "typed".
  - Very close in mood to Geist Mono.
- **Commit Mono** (static 200-700).
  - Deliberately "neutral"/anonymous.
  - Its "smart kerning" (contextual alternates) is the selling point. The Fontsource build's
    behaviour for that was not verified.
- **Atkinson Hyperlegible Mono** (variable, wght 200-800). The most legible, with B/8 and 1/l/I
  disambiguation, but **wide**: 0.632 em, about 59 cpl. The look is a little clinical.
  - A good accessibility fallback if one is wanted.
- **Martian Mono** (variable, wght + **wdth** 75-112.5). x-height 0.60, but 0.70 em per character,
  about **54 cpl**. Too wide at its default width.
  - The wdth axis could condense it, but that is an extra knob to get right.
- **Azeret Mono**: 0.65 em, wide.
- **Space Mono**: retro-futurist 1960s display flavour, quirky at body size, static 400/700.
- **DM Mono**: static 300/400/500 only, so no 700.
  - Amusingly, it was commissioned by DeepMind.
- **Sometype Mono** (variable, wght 400-700).
  - Slightly narrow at 0.58 em, about 65 cpl.
  - Low x-height (0.47).
- **Reddit Mono** (variable, wght 200-900).
  - 0.562 em, about 67 cpl, a nice width.
  - Generic.
- **Victor Mono**: the cursive italic is a gimmick for prose.
- **Fira Mono / Fira Code**: a Mozilla UI flavour, and Code's ligatures are wrong here.
- **Cutive Mono**: a Courier-like typewriter, with an even smaller x-height (0.378). Worse.
- **Special Elite**: a distressed typewriter look. A display face, Apache-2.0.
- **Sono** (variable, wght + MONO, default MONO=1). A pleasant rounded alternative to Recursive.
- **Intel One Mono**, **Monaspace Argon/Neon**, **Chivo Mono**: all exist. None beats Plex for this
  brief.
- **Geist Mono: I agree with leaving it out.** It shares Geist's skeleton, so the AI voice would look
  like the UI in fixed-width. The point of the experiment is that each voice is unmistakable.
- **Opinion pieces** recommending Inconsolata and Source Code Pro for prose: both exist on
  Fontsource, but both are a code-editor look rather than typed-document.
  - https://madegooddesigns.com/best-monospace-fonts/
  - https://practicaltypography.com/monospaced-fonts.html (Butterick's genre warning)

## 2. Recommendation

**Top: IBM Plex Mono.**

- It is the closest to what Greg liked about Courier: typewriter lineage, the Selectric italic and
  slab-ish serifs.
- It fixes what he disliked: a higher x-height, real stroke weight and humane forms.
- It is tiny (15 KB per style).
- It is clearly distinct from Geist (UI), Source Serif (author) and Arial (reader).
- Import 400, 500 and 700 plus italics, so dark mode's 450 resolves to 500.

**Runner-up: iA Writer Duo.** If paragraph comfort matters more than a pure monospace signal, use Duo,
or Quattro for narrower columns.

- It is literally IBM Plex Mono with the cramped m/w fixed. It was designed for exactly this:
  monospace feel, prose readability.
- The cost is no intermediate weight, so dark mode's 450 falls to 400.
- Choosing between the two: Duo keeps the mono signal, Quattro gains about 10% line length.

**Honourable mention: Recursive Mono.** Pick this if you want one variable file that can be *tuned*:

- semi-proportional (MONO ≈ 0.6);
- a touch of Casual for warmth;
- a true 450.

It is the most capable option, but it costs 73-305 KB and needs `font-variation-settings`. Fontsource's
default import silently gives you the proportional sans, not the mono.

**Suggestion:** put Plex Mono and iA Writer Duo side by side on `/design` with a real summary and a
chat reply, in both themes, at 16px. The difference is easier to see than to describe.

## 3. CSS imports and family names

Each snippet below follows the repo's `tailwind.css` convention.

### Courier Prime (current)

```css
@import "@fontsource/courier-prime/400.css";
@import "@fontsource/courier-prime/400-italic.css";
@import "@fontsource/courier-prime/700.css";
@import "@fontsource/courier-prime/700-italic.css";
/* font-family: "Courier Prime" */
```

### A. IBM Plex Mono

The 500 weight is there so dark mode's 450 maps to 500.

```css
@import "@fontsource/ibm-plex-mono/400.css";
@import "@fontsource/ibm-plex-mono/400-italic.css";
@import "@fontsource/ibm-plex-mono/500.css";
@import "@fontsource/ibm-plex-mono/500-italic.css";
@import "@fontsource/ibm-plex-mono/700.css";
@import "@fontsource/ibm-plex-mono/700-italic.css";
/* font-family: "IBM Plex Mono" */
```

### B. iA Writer Duo (or Quattro: swap `duo` for `quattro`)

```css
@import "@fontsource/ia-writer-duo/400.css";
@import "@fontsource/ia-writer-duo/400-italic.css";
@import "@fontsource/ia-writer-duo/700.css";
@import "@fontsource/ia-writer-duo/700-italic.css";
/* font-family: "iA Writer Duo"   (Quattro: "iA Writer Quattro") */
```

### C. Recursive

**Mono Linear (wght + MONO).** There is no italic file, and `slnt` is only in `full.css`.

```css
@import "@fontsource-variable/recursive/mono.css";
/* font-family: "Recursive Variable";
   font-variation-settings: "MONO" 1;    (0.5–0.7 for semi-proportional) */
```

**Mono Casual (all axes; 305 KB latin).** Use this instead of the import above.

```css
@import "@fontsource-variable/recursive/full.css";
/* font-variation-settings: "MONO" 1, "CASL" 0.5; */
```

### D. Spline Sans Mono

```css
@import "@fontsource-variable/spline-sans-mono/wght.css";
@import "@fontsource-variable/spline-sans-mono/wght-italic.css";
/* font-family: "Spline Sans Mono Variable" */
```

### E. Red Hat Mono

```css
@import "@fontsource-variable/red-hat-mono/wght.css";
@import "@fontsource-variable/red-hat-mono/wght-italic.css";
/* font-family: "Red Hat Mono Variable" */
```

### F. Xanh Mono

```css
@import "@fontsource/xanh-mono/400.css";
@import "@fontsource/xanh-mono/400-italic.css";
/* font-family: "Xanh Mono"   (no 700: bold would be synthesised) */
```

### Others, if wanted

- `@fontsource-variable/atkinson-hyperlegible-mono/wght.css`, registered as
  "Atkinson Hyperlegible Mono Variable"
- `@fontsource-variable/sometype-mono/wght.css`, registered as "Sometype Mono Variable"
- `@fontsource/commit-mono/{400,700}.css`, registered as "Commit Mono"

Add the npm package to `package.json` in each case. For example, `npm i @fontsource/ibm-plex-mono`.
