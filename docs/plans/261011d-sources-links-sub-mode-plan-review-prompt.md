# Plan review: Sources › Links (261011d)

You are reviewing a plan in the Spideryarn repo (this working tree). Read-only: do not edit files.

Read first: `docs/plans/261011d-sources-links-sub-mode-the-articles-own-hyperlinks.md` (the plan),
then `docs/project/sources.md`, `docs/project/bibliography.md` § The one safety property,
`docs/project/links.md` (especially § What our own server can reach), `docs/project/mode.md`
(the sub-mode checklist), `docs/project/security-map.md`.

Code to check the plan against: `src/chat-tools.ts` (`articleLinks`, `destinationOf`, `linkFrom`),
`src/urls.ts`, `src/web/link-preview.ts` (`describeLink`), `src/web/modes/sources/SourcesMode.tsx`,
`src/web/params.ts` (`SOURCES_VIEWS`), `src/web/sub-modes.ts`, `src/web/activation.ts`,
`src/web/sources-counts.ts`, `src/web/reader/Reader.tsx` (the `case "sources"` band and
`openBibliographyWork`), `src/web/visitor.ts`, `src/mode-catalog.ts`.

The user's request (Greg, the product owner): "Maybe sources should have a submode for external
links as well, or perhaps include those in the bibliography somehow." The brief was to pick the
simpler that reads well.

Please judge:
1. Is a sub-mode really simpler and better than folding into Bibliography? Any third option that is
   simpler still?
2. Is moving `articleLinks` into a shared, DOM-parser-injected module sound for both the server
   (jsdom) and browser? Anything in it that is server-only or would behave differently in a browser
   `<template>` (e.g. relative URL resolution, `isWebUrl`, `sameTarget`)?
3. Security: a visitor's page renders a stranger's article. Does listing those hrefs in a panel add
   any exposure the prose's own links don't already have? Is anything about our server fetching
   widened (it must not be)?
4. Every place a new Sources sub-mode must be told about — what does the plan miss? (Command bar,
   last-view, help, the visitor band, chip accessible names, `?sources=` parser, focus handling,
   tests that enumerate sub-modes, `ModeBoundary` tables, `subModeViews`.)
5. The bibliography join via `sameTarget`: correct and cheap? Any trap (e.g. a work's url being a
   Scholar search, a DOI URL vs a doi.org link in the prose)?
6. Anything in the row design, empty states, or ordering that will read badly.

Output: a numbered list of findings, each with severity (P1 must-fix before building / P2 should /
P3 nit), the evidence (file:line), and a concrete fix. End with a one-line VERDICT: "build as
planned", "build with the fixes above", or "rethink".
