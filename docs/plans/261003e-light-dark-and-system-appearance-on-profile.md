# Light, Dark and System appearance, chosen on /profile

Report `spya-nv5bzx` (suggestion, from Greg, 2026-09-05), Overseer queue item `qi-eay7j8xc`:

> Allow me to switch between Light, Dark, and System modes (in my Profile page).

## Goal, context

Today the app is **dark only**, by Greg's own call on 2026-08-24
([web-client.md § Dark mode](../project/web-client.md#appearance-light-dark-and-system)). This reverses that at his request.
The same section already says what shape a light mode should take if it ever came back:

> the shape of the change is a `[data-theme]` attribute on `:root` and a second block of the same
> variable names — not a `prefers-color-scheme` media query, which would give the reader no way to
> override it.

That is the shape here. Build the simplest version that works end to end, and name what is deferred.

## What we found before planning

- Colour is already mostly tokenised: `styles/tokens.css` (brand + shadcn surface names),
  `styles/colourscales.css` (categorical, sequential, diverging scales), and
  `src/web/styles/tokens.css` (the semantic layer: `--ink-soft`, `--surface-raised`,
  `--highlight-wash`, `--depth-*`, …).
- **About 190 hard-coded colours** remain across 34 component stylesheets (`site.css` 27,
  `logo-animations.css` 14, `mode-band.css` 13, `search.css` 10, then a long tail). Many are
  `rgb(0 0 0 / x)` shadows, which are fine on both grounds; many are `white` used to *lift* a colour on
  a dark page, which inverts on a light one.
- TSX has almost none: Google's brand marks (fixed by Google), the Google sign-in button (fixed by
  Google's guidelines), two Tailwind shadow arbitraries, the footer's `rgb(255 255 255 / 0.16)` rule,
  `PlanCards`' inset highlight, `ViewportProbe` (a debug overlay).
- `@custom-variant dark (&)` in `src/web/tailwind.css` makes every shadcn `dark:` rule always apply.
- `index.html` declares `<meta name="color-scheme" content="dark">` and `theme-color #0a0a0a` so the
  canvas is dark before CSS loads.
- No Content-Security-Policy on the app (only on the fleet dashboard), so an inline head script is
  allowed.

## Key decisions

1. **The preference lives in `localStorage`, per device — not on the reader's profile row.**
   Appearance must be known *before first paint* or the page flashes the wrong colour; a server value
   arrives after `GET /api/reader`, i.e. after paint. `localStorage` is synchronous and readable from
   an inline `<head>` script. It also works the same for a signed-out reader who has set it on this
   device. The shelf's hidden-columns preference already lives in `localStorage` for the same kind of
   reason. *Passed over:* a nullable column on `readerProfiles` (as Experimental features does) — it
   would follow the reader across devices, but needs a migration, a store pair, a route field, and
   still a local cache to avoid the flash. Deferred, see below.
2. **Three values: `"system" | "light" | "dark"`. Unset means `dark`.** Nobody's page changes until
   they choose. *Passed over:* defaulting to System, which would silently turn the app white for every
   reader whose OS is in light mode, on day one of a light palette nobody has lived with. One constant
   (`DEFAULT_APPEARANCE`) to flip later.
3. **The resolved theme is written to `<html data-theme="light|dark">`**, always (never absent), by
   an inline script in `index.html`'s `<head>` before the stylesheet, and kept up to date by
   `src/web/appearance.ts` afterwards. CSS keys on `:root[data-theme="light"]` only; `:root` stays the
   dark palette, so no-JS / a script that failed still gets today's page. The two `<meta>` tags are
   updated in the same function.
4. **System follows the OS live**: a `matchMedia("(prefers-color-scheme: dark)")` change listener,
   installed once at app start. A `storage` event re-applies, so a second tab follows.
5. **One source of truth for the resolve logic.** The inline script and `appearance.ts` both need it.
   The inline script is the *only* copy of the before-paint logic; `appearance.ts` holds the same few
   lines, and a test runs the inline script out of `index.html` against a fake `localStorage` /
   `matchMedia` and checks it agrees with `resolveTheme()` on every case. (A build step that injected
   one into the other is more machinery than eight lines deserve.)
6. **Light values live beside their dark ones**, in a `:root[data-theme="light"]` block at the end of
   each of the three token files. Same variable names, so nothing downstream rewires.
7. **The literal sweep: every hard-coded colour in a component stylesheet either becomes a token or
   is proven theme-neutral.** Rules:
   - `rgb(0 0 0 / x)` shadows: keep (shadows are dark on both grounds), perhaps lighter in light mode
     via a `--shadow-strength` only if a screenshot says so.
   - `white` / `black` used to lift or sink a colour in a `color-mix`: replace with two new tokens,
     `--toward-ink` (white on dark, black on light) and `--toward-page` (the reverse).
   - A literal surface/text grey: replace with the nearest existing token; add a token only if none
     fits.
   - Text *on* an orange or coloured fill: `--primary-foreground`.
8. **A light palette with the same intent, not an inversion.** Page `oklch(0.985 0 0)`-ish rather than
   pure white; ink `oklch(0.2 0 0)`; panels slightly *darker* than the page (on a light ground, a
   panel recedes); the orange unchanged as a *fill*, but `--highlight-ink` (orange used as text)
   darkens (`color-mix(in oklab, orange 70%, black)`) because `#DB8A45` on white is ~2.6:1. The
   categorical scale's light values go back towards their published Okabe–Ito originals, which the
   file already names; the extended categories and the depth ramp get darker equivalents; sequential
   scales are checked at their call sites (heat/viridis/diverging are each used in one or two places).
9. **`@custom-variant dark`** becomes
   `(&:where(:root:not([data-theme="light"]), :root:not([data-theme="light"]) *))` so shadcn's `dark:`
   branch applies in dark and its base branch in light — what shadcn was written for.
10. **The control**: an "Appearance" section on `/profile` with three radio buttons (System, Light,
    Dark), applied immediately on change, no Save button. Under it one line: "Saved on this device."

## Deferred (named, not built)

- **Cross-device sync** (a profile column). Today: set it on each device.
- **A control anywhere but /profile** (the Dock, the signed-out pages). Signed-out pages still *obey*
  a device's saved choice; they just offer no picker.
- **The fleet dashboard** (`tools/fleet/`) — a separate app with its own palette; dark only still.
- **Pictures with colour baked in**: model-painted Illustrated images, and screenshots on the
  marketing/changelog pages, stay as made. Diagram and Sketch are drawn by our CSS and do follow.
- **Light-tuned favicon / app icon**. The wordmark itself follows `--wordmark-ink`.
- **The `/design` page** shows the tokens live, so it follows; its prose describing the dark palette
  is updated only where it is now false.

## Stages

### Stage 1 — the machinery and the control (no light palette yet beyond a rough first cut)

- `src/web/appearance.ts`: `Appearance` type, `DEFAULT_APPEARANCE`, `readAppearance()` (guarded
  `localStorage`), `resolveTheme(pref, systemPrefersDark)`, `applyTheme()` (sets `data-theme` + both
  metas), `setAppearance(pref)`, `startAppearance()` (matchMedia + storage listeners), and a
  `useAppearance()` hook for the profile control.
- `index.html`: inline head script before the stylesheet; `<html data-theme="dark">` static default;
  `color-scheme` meta becomes `dark` by default and is rewritten by the script.
- `main.tsx`: call `startAppearance()`.
- `/profile`: the Appearance section.
- `tailwind.css`: the `dark` variant.
- Tests: `resolveTheme` table; the inline-script-agrees test; the profile control writes and applies.

### Stage 2 — the light palette and the literal sweep

- Light blocks in the three token files; `--toward-ink` / `--toward-page`.
- Sweep the ~190 literals by the rules in decision 7.
- A test: **every colour custom property set in a dark `:root` block of the three token files is also
  set in the light block**, or is on a short, commented allowlist of theme-neutral values (the brand
  orange, `--radius`, fonts). This is what stops a token added next month from being dark-only by
  accident.
- A test: no component stylesheet under `src/web/styles/` uses bare `white` / `black` / `#fff` /
  `#000` in a colour position outside an allowlist with reasons.
- Browser check (Sonnet subagent, Playwright on the box) at 1280 and 390, both themes: landing,
  shelf, profile, the reading view in Plain, Structure, Glossary, Search, Debate, Diagram, Chat; and
  System following an emulated OS change. Ask for contrast problems, invisible text, and anything
  still dark in light mode.

### Stage 3 — docs and bookkeeping

- `web-client.md § Dark mode` → "Appearance: Light, Dark and System", with Greg's 2026-09-05 words
  beside his 2026-08-24 ones; `design-css-overview.md`; the head comments of the three token files;
  `colour-scales.md` where it says "dark ground, unconditionally"; `reader-profile.md` mentions the
  section; `privacy.md` if it lists what `localStorage` holds.
- The feedback note, `feedback-endings.ts`, `overseer-queue.ts done`.

## Done looks like

Greg picks Light on /profile and every page he can reach is legible and recognisably Spideryarn;
reload shows no dark flash; System follows his Mac's appearance switch without a reload; nobody who
has not chosen sees any change.

## Plan review (GPT Sol, 2026-10-03) and what changed

[261003e-light-dark-and-system-plan-review-sol.md](261003e-light-dark-and-system-plan-review-sol.md):
no P0; architecture confirmed (localStorage + dark default; the `@custom-variant` compiles correctly
under Tailwind 4.3.3 with `tw:` and `@layer app`; Vite keeps the inline script ahead of the module; no
CSP anywhere). Every finding accepted:

1. bfcache: `pageshow` with `persisted` re-reads storage and the OS; `storage` with `key === null`
   (a `clear()`) too. Built.
2. `color-scheme: light` in the light CSS block, not only in the meta. Built; pinned by the palette
   test.
3. **Light definitions for the diverging scales (`--div-*`, `--div-rg-*`) and the hue ring
   (`--hue-*`)**, with their own ordering and contrast invariants, as well as the categorical and
   sequential ones.
4. **`tests/colour-scales.test.ts` and `tests/hit-colours.test.ts` parse the dark and light blocks
   separately**, each against its own ground, rather than assuming one declaration per token.
5. **The sweep and its guard cover TS/TSX class strings too**, and numeric white/black
   (`rgb(255 …)`, `#fff`, `#ffffff`), with reasoned allowlists (shadows, masks, backdrops, Google's
   marks, the debug probe). Browser matrix adds pricing, contact, login, privacy and changelog.
6. The parity test is described as what it is — a tripwire for a forgotten name — and is joined by a
   short contrast assertion on the core pairs in each theme (ink on page, faint ink on page, ink on
   panel, `--highlight-ink` on page).
7. `/design` remeasures on the **resolved** theme (a `useTheme()` alongside `useAppearance()`).
8. `setAppearance` reports whether it saved; the control says "Couldn't save on this device" when
   storage refused.
9. Feedback diagnostics carry the stored choice and the resolved theme beside the OS preference.
10. **Deferred:** the installed iPhone app's status bar is `black-translucent`, i.e. white clock text
    drawn over the page. Over a light page that is pale-on-pale. It cannot be fixed by swapping the
    meta at runtime (iOS reads it at install/launch), and nobody here can check it from the box.
    Named in web-client.md as a known gap.
