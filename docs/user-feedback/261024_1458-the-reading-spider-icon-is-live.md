---
reports: spya-krx3dz
ending: shipped
---
# The reading-spider icon is live

Report `spya-krx3dz` (#694, SPIDERYARN-READING2-NS), a suggestion from Greg filed on `/changelog`
(`feedback-reporter.ts` exit 0, no addenda when re-read before this note). Session
`fbkrx3dz-app-icon-note`.

> I've been working with Codex on a new version of the app icon. I don't know if it's ready yet,
> but hopefully it'll go out in the next deploy or the one after

**Shipped, and already in production.** The eight-limbed reading spider
([261024a](../plans/261024a-eight-limbed-reading-spider-brand-assets.md), its
[limb refinement](../plans/261024a-reading-spider-limb-refinement.md), and the repeatable update
process in [261024o](../plans/261024o-a-repeatable-main-icon-update-and-tiny-size-review.md))
went out in deploy `dpl_8cfeUip2yTU6pZrXyQ6G5emCa5T8` at `e7be80a9`, on 2026-10-24.

- **The changelog entry** ("Spideryarn has a new mark: a reading spider", in that deploy's notes
  in `src/web/changelog-versions.ndjson`) is accurate against the commits and `main-icon.md`, and
  reads plainly. It is left as it is, because the file is append-only.
- **What was left undone was a live browser check.** None of the three plans could run one,
  because the Mac had no browser tool. That check has now been run against production, and
  everything passed: the header mark, the hover animation and reduced motion, every icon, the
  manifest and the social card, with byte-identical files and no console errors. It is written up
  in [the browser-review record](../plans/261024a-eight-limbed-reading-spider-browser-review.md).
- **Still open, and only you can do it:** how the home-screen icon looks on a real phone or iPad.
  An icon already installed may keep the old picture until it is removed and added again.
  [main-icon.md](../project/main-icon.md) says what to record when you check.
