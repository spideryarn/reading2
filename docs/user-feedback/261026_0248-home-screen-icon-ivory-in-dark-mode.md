---
reports: spya-shpsvx
ending: shipped
comment: The home-screen icon now follows your phone's mode when added: charcoal in dark, cream in light, charcoal when unsure. After the next deploy, remove the icon and re-add it from Safari's Share menu to see it.
---
# The home-screen icon is ivory in dark mode

Report `spya-shpsvx` (#710, SPIDERYARN-READING2-P9), a problem from Greg on `/` from his iPhone
(`feedback-reporter.ts` exit 0, no addenda when re-read before this note). Session
`fbshpsvx-icon-dark-mode-iphone`.

> I'm in dark mode on my iPhone, and for some reason the new Spideryarn icon still has a white background.

**Shipped** on `dev` (out with the next deploy), after Greg answered `q-q5da5a`
(`spya-e50wvz`): *"Maybe we can try and offer a switch between light and dark mode, but if in
doubt, default to dark mode for the icon"*. The touch icon is charcoal by default and an inline
script swaps in a cream one when the phone is in light mode; the Android icons and the email logo,
which cannot follow a mode, are charcoal —
[261026i](../plans/261026i-home-screen-icon-follows-the-phone-mode-dark-by-default.md). Not checked
on a real phone: Greg's remove-and-re-add is the test, in both modes. The white he saw was
inferred to be the home-screen tile from the files and he did not say otherwise.

The first pass (below) asked rather than built; Sol reviewed it
([its findings](../plans/261026e-home-screen-icon-dark-mode-review-sol.md)).

- **The research and its sources** are in
  [main-icon.md § Dark mode on an iPhone](../project/main-icon.md#dark-mode-on-an-iphone).
- **No cached old paths to clear.** No icon file has been renamed or deleted under `public/`, and
  production serves them with `max-age=0, must-revalidate` and an etag. What caches is iOS's
  snapshot of an installed clip, which changes only when the clip is removed and re-added.
- **Built, second pass**: the `background` column of `BRAND_OUTPUTS` in
  [generate-brand-assets.ts](../../scripts/generate-brand-assets.ts) (touch and Android tiles
  charcoal, a new cream `apple-touch-icon-light.png`), `touch-icon-boot` and a `?v=2` in
  `index.html`, `tests/touch-icon.test.ts`. The emails name the same file, so their logo turned
  charcoal with no change of their own.
