---
reports: spya-p52ccp
ending: shipped
---
# One white wordmark everywhere

Report spya-p52ccp, a suggestion from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit
0), filed 2026-10-02T10:12Z from `https://www.spideryarn.com/`. It never reached Sentry
([261002b](../postmortems/261002b-a-pipeline-whose-only-consumer-reads-the-lossy-copy.md)), so
there is no Sentry issue to resolve.

> Sometimes the Spideryarn logo has white text, and sometimes it has orange text. I think probably
> the white text is better. Investigate, take screenshots, use your judgment, standardise (perhaps as
> a reusable flexible component), and include & build on & improve the animations.

**Ending: Shipped.** On `dev`, not deployed.

## What we did

The name was orange in the corner (`/profile`, `/contact`, admin…) and the reading view's bottom
bar, white everywhere else, and set in four weights (400–700). Now one rule on the shared letters
(`.logo-letter`, which only `LogoLetters` draws) gives every copy the same white, Geist 600 and
tracking; size stays each host's. Two animations, Strain and Dawn, had the old orange baked into
their rest frames and snapped on every white copy. They now return to white and warm to the
spider's orange in between. A fourteenth animation, *Dew on the Thread*, runs a bead of orange
along the white word, on hover and in the article's loading spinner. A single `<Wordmark>` React
component for all six hosts was weighed and deferred. The reasons are in
[the plan](../plans/261002e-one-white-wordmark-everywhere-and-its-animations-made-colour-aware.md),
along with the before and after measurements and GPT Sol's two reviews.
