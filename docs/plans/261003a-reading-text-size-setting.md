# 261003a — A reading text size setting on /profile

Feedback spya-nnr8ha ([note](../user-feedback/261002_2036-a-reading-text-size-setting.md)) (Greg, admin, 2026-10-02 20:36 UTC, on
`/read/entropy-26-00481-…?mode=debate`):

> In the user profile section, maybe allow them to set whether the font should be small, default,
> or large, or very large.
>
> — Greg, 2026-10-02

and, relayed by the Overseer the same evening:

> The font-size one is low priority. If it's going to add complexity, then let's discuss first.
>
> — Greg, 2026-10-02 ~22:00

So the bar is set before the design: **build only if it is one stored setting and one root
variable that the prose already follows, with nothing re-aligned by hand.** Anything more — the
gutter, spine or marginalia re-measuring, per-component overrides, a migration beyond one column —
stops here and goes back to Greg as a question.

## What already exists

The article's type is one custom property. `styles/tokens.css` sets `--reading-size: 1.0625rem`
(17px) on `:root`; `--rhythm` is `--reading-size × 1.4` and `--block-pad` is a quarter of that, and
every vertical gap in the reading column is a multiple of `--block-pad`
([typography.md § Vertical rhythm](../project/typography.md)). The gutter cell
(`styles/gutter.css`), the masthead over the column (`styles/narrow-window.css`) and Quiz's prose
box (`styles/quiz.css`) all set `font-size: var(--reading-size)` themselves so their `ch` and their
first-line offsets track the prose's. The measure is `clamp(45ch, 90vw, var(--reading-measure))`,
and `ch` is in the element's own font, so it scales too.

**An earlier "no" to this, and whose it was.** `ProfilePage.tsx`'s header lists typography settings
as considered and rejected — *"a reader who wants bigger text has a browser zoom"*. That sentence is
an agent's, from the 2026-08-25 notes on the previous app
([original-version/typography.md](../project/original-version/typography.md)), not Greg's. His
report supersedes it; the header changes with this work.

## The design

**One setting, four values, one variable.** `small | default | large | x-large` maps to
`--reading-size` = 15 / 17 / 19 / 21px, written as rem (`0.9375 / 1.0625 / 1.1875 / 1.3125rem`) so a
browser's own default size still scales underneath it. The app sets the property on
`document.documentElement` and nothing else; every rule that follows the prose today follows it.

**Prose only, not the interface.** The controls have one fixed height
([controls.md](../project/controls.md)) and the chrome is per-rule `rem`, deliberately off the
reading scale ([typography.md § Scoped to the reading column on
purpose](../project/typography.md)). Scaling the whole interface is what browser zoom already does,
and it does it better than we would. What the reader asked about is the text they read.

**The measure is left to the existing clamp, and that is a choice, not an omission.** `.prose`'s
`clamp(45ch, 90vw, var(--reading-measure))` is in the prose's own `ch`, so it scales with the type
by itself — the spike below measured it. The one place it cannot is the **lone column** (Plain, or
any mode with the band shut), whose width cap is computed in JS: `PROSE_ALONE_MAX_REM = 49` in
`src/web/layout.ts`, ≈ 65ch at 17px plus pads. By arithmetic, at 21px 65ch wants ≈ 57rem, so the
cap binds and the line comes out near 53ch; at 19px near 59ch. 59 is inside the 55–70 band the
measure was chosen from and 53 just under it; larger type meaning fewer words per line is what it means in every
reader. Teaching `layout.ts` the scale would keep 65ch there too, but it is exactly the
"re-measuring" the bar rules out, so it is not in v1; the build's browser check measures it rather
than trusting this paragraph. At 15px the column has slack and the prose centres in it, as it
already does whenever the cell is wider than the measure.

**Stored per device, in `localStorage`, read before the first render.** This is the trade-off worth
naming, because the brief leaned the other way:

| | per device (`localStorage`) | per account (a column on `reader_profiles`) |
|---|---|---|
| Storage | one key | one nullable column + migration |
| Server | nothing | a third arm on `PATCH /api/reader`, a field on `GET` |
| Client | read synchronously in `main.tsx` before `createRoot` | a store like `experimental-store.ts`: three states, account switches, offline copies |
| First paint | already the right size | 17px, then a jump when `GET /api/reader` answers |
| Signed out | works | nothing to read; default |
| Follows you to another device | no | yes |

The jump in the right-hand column is the deciding row. The reading view restores the reader's place
from `?at=` on load; a font change after that moves every block below the top of the window, so the
reader lands somewhere else, and the gutter, spine and marginalia all lay out twice. Avoiding it per
account means blocking the first render on a network request. Per device has none of that, and a
reader's text size is arguably a fact about the screen anyway — 21px on a phone in bed and 17px on a
desktop is a reasonable thing to want. The /profile row says *"on this device"* so nobody expects it
to follow them.

Per account remains a clean later step if readers ask for it: the same key becomes a column, and
the `localStorage` copy becomes the no-flash cache in front of it.

## The pieces

1. `src/web/reading-size.ts` — the four values, `readReadingSize()` / `writeReadingSize()` (guarded
   `localStorage`, an unknown stored value reads as `default`), and `applyReadingSize()` which sets
   or removes the property on `document.documentElement`. `default` **removes** the inline property
   rather than writing 17px, so `tokens.css` stays the one place the default lives.
2. `src/web/main.tsx` — `applyReadingSize(readReadingSize())` before `createRoot`.
3. `src/web/SettingsSection.tsx` — a four-way segmented control, "Text size (on this device)",
   applying immediately as well as saving.
4. Docs: a short section in [typography.md](../project/typography.md) (the one variable a reader
   may override, and why chrome is out), the `ProfilePage.tsx` header, and the feedback note.

Tests, red first: the mapping and the guarded read (`tests/reading-size.test.ts`, unknown and
throwing storage both read as default); a test that every `--reading-size` value is a rem length
and that `default` matches the token in `styles/tokens.css`, so the copy cannot drift.

## Browser evidence

A spike on 2026-10-03, before any code: Playwright against the local dev server,
`/read/fowler-phrenology` in Marginalia and in Glossary (band open), at 390, 1024 and 1440px, with
`--reading-size` overridden on `document.documentElement` and nothing else — once before the first
render, once live after load. Every number was the same both ways.

- **Gutter icons** — icon centre minus first-line centre, 32 paragraphs per case: +3.7px at 15px,
  +2.2px at 17px, −1.3px at 21px. Within 4px throughout. Headings are a fixed 24px, so theirs do not
  move.
- **Marginalia notes** — note top minus first-line top: −6.3 / −6.9 / −9.3px. The column's x and
  width are unchanged; the notes are absolute inside their row, so they follow it.
- **The spine** — its parts are shares of the text, so unchanged; the viewport marker re-measured
  the new page height within 0.8s with no scroll.
- **The measure** — no horizontal scroll and nothing clipped anywhere. The real line holds at about
  74 characters at desktop widths at every size (the `65ch` clamp is in the prose's own font, so it
  scales with it); it shortens only where the cell is already narrow: 31 characters at 390px and
  21px, 68 on an iPad at 21px in Marginalia.

Not checked in the spike: footnotes, Quiz's prose box, 19px, a second article, and a live change
while scrolled mid-article. The build's browser check covers the first three.

So the prose's followers follow. Nothing is re-aligned by hand, which is the bar.

## GPT Sol's review, and why this stopped here

**Status: not built. Awaiting Greg** — the bar was not met, and his instruction for that case was
to stop after the plan and ask. Review 2026-10-03, `--sandbox review`, effort high. Its findings,
each checked against the code:

1. **The rest of the article's type does not follow `--reading-size`; it is fixed `rem`.** Headings
   (`prose.css:433-437`: h1 24px, h2 20px, h3 17px, h4 16px), figure captions (`:656`), caption
   blocks (`:859`), the dimmed "opaque" blocks (`:841`) and footnote bodies (`footnotes.css:77`).
   So at *large* (19px) a paragraph is bigger than an h3; at *very large* (21px) it is bigger than
   an h2. The spike measured the paragraphs and nothing else, which is why it looked clean.
   **Confirmed.** This is the decisive one: fixing it means re-expressing about ten rules as
   ratios of the body size, and re-checking the gutter on heading rows, whose offsets are tuned to
   those fixed sizes — the per-component work the bar rules out.
2. **`PROSE_ALONE_MAX_REM` reaches further than "the lone column".** `proseAloneMaxPx` is used for
   Plain, Marginalia, band-plus-Marginalia and the band's own room (`layout.ts:546, 562, 610, 658,
   843, 888`). Larger type does not change the root font, so the layout hands the band room the
   prose could have used and the line shortens. Not broken, but not "nothing else".
3. **My "53ch is inside 55–70" was wrong** — 53 is below it. Corrected in the section above.
4. **No re-anchoring on a live change** (`Reader.tsx:579`'s `layoutKey` does not include it). Minor
   in practice: the setting is changed on `/profile`, where no article is mounted.
5. Agreed: prose only, not the interface; per device, applied before `createRoot`
   (`main.tsx:217`). Its caveat: a per-account version could avoid the jump with an account-keyed
   local cache, so "per account means blocking the first render" overstated it.

Sol's own recommendation was the same as Greg's rule: stop for agreement on the narrower scope.

## The question for Greg

What it would take, in three sizes:

- **A. Body text only, as reviewed** — one setting on this device, one variable, ~half a day. Costs:
  headings stop looking like headings at the larger sizes (a paragraph bigger than its h3, or its
  h2), captions and footnotes stay small. *Not recommended*: it ships a visibly inverted hierarchy.
- **B. The article's whole type scale follows one base** — the same setting, plus headings,
  captions and footnotes rewritten as `calc(var(--reading-size) × ratio)` (same sizes at default,
  about ten rules), and a browser pass over the gutter on heading rows. About a day, mostly checking.
  It also leaves the CSS better: the article's type becomes one scale with one dial.
- **C. Not now** — readers keep browser zoom (Cmd/Ctrl +), which scales everything and already
  works; perhaps one line on `/help` saying so.

Recommended: **B if it is wanted soon, otherwise C** — A is the version that looks cheap and isn't.

## What this does not do

- No keyboard shortcut (the brief says none is needed).
- No scaling of the chrome, the mode band's own text, or the controls.
- No per-account sync.
- `PROSE_ALONE_MAX_REM` is untouched. Where that cap is what binds — the article alone in a narrow
  window — the line at the two larger sizes is shorter than 65ch; elsewhere the clamp scales with
  the type.

## The simpler option passed over

Doing nothing and pointing readers at browser zoom — the earlier decision. It scales the chrome
and the controls too, and on a phone pinch-zoom makes the article scroll sideways. The setting is
small enough that the simpler option no longer buys much.
