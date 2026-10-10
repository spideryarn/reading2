---
reports: spya-axbxr8
ending: shipped
comment: Thirteen more wordmark animations, on dev and not yet deployed: seven for the spider, six for the letters, picked from about fifty ideas from four directions, GPT Sol's among them. Twelve also play on the article loading screen.
---
# More wordmark animations for the article loading screen

Report `spya-axbxr8` (#539), [SPIDERYARN-READING2-GM](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-GM/),
a suggestion from Greg (admin, proven by `scripts/feedback-reporter.ts` exit 0), filed 2026-10-09
23:56 UTC from `https://www.spideryarn.com/`.

> Logo animations that we have, that we show when loading an article are really fun. Let's generate
> a bunch more. Perhaps try prompting the agents from a couple of different directions and also get
> some input from GPT-Sol. Take into account the vision.md and the different modes and, you know,
> what we're trying to do here, and then really have fun with it.

**Ending: shipped**, on `dev`, not deployed. Plan:
[261010p](../plans/261010p-more-logo-animations.md).

## What we did

Four longlists, each from a different direction as asked: the reading modes, the vision, the spider
and motion craft (three Claude subagents), and wildcards and letterforms from GPT Sol. About fifty
ideas, shortlisted as a set against the fourteen already there, so the range is what the reader
meets ([design-logo.md § Thirteen more](../project/design-logo.md#thirteen-more)).

- **The spider:** Hop, Asterisk, Magnifier, Pacing, Line by Line, Played Dead, Semaphore (a foreleg
  waves: the mark's first limb).
- **The letters:** In Quotes, It Clicks, The Shed, Cross-reference, Three Readings (Skim's three
  passes), Set in TeX.

Twelve join the loading screen's two tracks. Played Dead is hover-only: on an empty loading page a
grey spider on its back reads as an error. All thirteen rest at the plain wordmark under reduced
motion.

Sol reviewed the plan (two loader-timing blockers, both fixed before building) and the code (four
fixes, approved). A browser check in three rounds measured every new one in the corner, the dock,
the shelf, the marketing bar and the loader, and found the cross-reference arc touching the `r`s,
the opening quote touching the spider, a seam at Semaphore's joints, and the magnifier's spider
poking out of the lens. All fixed; the faint remains of Semaphore's seam are accepted and noted in
the stylesheet. The plan has the detail, and the near-misses for a next round.
