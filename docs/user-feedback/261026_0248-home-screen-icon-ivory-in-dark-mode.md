---
reports: spya-shpsvx
ending: awaiting
comment: It is the home-screen icon. iOS gives a website's home-screen icon no dark version, so one background has to serve both modes: dark for everyone, or keep ivory? Question q-q5da5a.
---
# The home-screen icon is ivory in dark mode

Report `spya-shpsvx` (#710, SPIDERYARN-READING2-P9), a problem from Greg on `/` from his iPhone
(`feedback-reporter.ts` exit 0, no addenda when re-read before this note). Session
`fbshpsvx-icon-dark-mode-iphone`.

> I'm in dark mode on my iPhone, and for some reason the new Spideryarn icon still has a white background.

**Awaiting Greg.** The white is almost certainly the home-screen tile, `apple-touch-icon.png`,
the only icon we ship opaque (ivory, by design); the favicons and the in-page mark are transparent,
checked on the files. That is inferred, not confirmed on his phone, and the question asks him to
say if he meant somewhere else. iOS documents no dark variant for a web clip, so the background is
a product choice: question `q-q5da5a`, offering dark for everyone (recommended), the mode at the
moment the clip is added, or ivory as now. Sol reviewed the research and the question
([its findings](../plans/261026e-home-screen-icon-dark-mode-review-sol.md)).

- **The research and its sources** are in
  [main-icon.md § Dark mode on an iPhone](../project/main-icon.md#dark-mode-on-an-iphone).
- **No cached old paths to clear.** No icon file has been renamed or deleted under `public/`, and
  production serves them with `max-age=0, must-revalidate` and an etag. What caches is iOS's
  snapshot of an installed clip, which changes only when the clip is removed and re-added.
- **Built: nothing yet.** The same tile is the Android icon and the logo in the (dark) emails
  (`src/email-frame.ts`), so a choice of dark changes those too unless split. The backgrounds are
  the `background` column of `BRAND_OUTPUTS` in
  [generate-brand-assets.ts](../../scripts/generate-brand-assets.ts), then `npm run brand:update`
  and `brand:check`, and a `?v=` on the `apple-touch-icon` link in `index.html` for Safari's own
  caches.
