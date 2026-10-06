# The other seven artefact reads answer "none yet" as `200 null`

Queue item `qi-4t3hmw7c`, handed over by the Overseer on 2026-10-06. One stage, one commit. Owner:
the session in worktree `qi-4t3hmw7c-none-yet-rest`. Indexed under
[plans.md](../project/plans.md) by file name.

It finishes what
[261006g](261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md) started and left as a
question. That plan moved three reads (quiz, crossrefs, citations) from "404 means not made yet" to
"`200 null` when the request carries `x-spideryarn-none-yet-as-null`". Seven others still use the
404, so the codebase has two conventions for one fact, and the next person to add a read will copy
whichever they happen to open. On an article with nothing made, a page load also still prints a red
404 for each of the seven it asks for (Glossary and Quotes on every owner view, four more with
Marginalia on, Simple in its Summary view).

## What changes

The seven reads: **simple, ideas, faq, timeline, debate, glossary, quotes**. Each gets the same
three edits the first three got, and nothing new is invented.

- **Loader** (`src/store/pg.ts` § `loadSimpleSummary`, `loadIdeas`, `loadFaq`, `loadTimeline`,
  `loadDebate`, `loadGlossary`, `loadQuotes`). The "article is there, artefact is not" throw
  becomes `new ArtefactNotMadeYet(message)` with the message it has today. The class carries
  `status: 404`, so every other caller of these loaders (chat tools, term lookup, Skim, Search, the
  public reader, jobs) sees exactly what it saw. `notFound(slug)` for a missing article is not
  touched. **The fact that moves is "no usable artefact", exactly as each loader tests it today**
  (Sol F1): `loadFaq` also counts a document without a `questions` array, `loadSimpleSummary` a
  legacy `simple/1` or otherwise unusable one, and `loadDebate` one that fails `isDebateDocument`,
  each in the same throw as plain absence. Those predicates stay as they are and the whole throw
  becomes the typed error, so every band shows what it shows now. A valid but empty FAQ, timeline
  or debate is an artefact, not "none".
- **Route** (`src/routes.ts`, the seven `GET /api/<name>/:slug` handlers). Each wraps its read in
  `orNullWhenNotMadeYet({ req, res }, …)` and returns when that answers. Where the read is already
  inside `withProfileChanged`, the helper goes around the outside, as quiz has it. This also puts
  `Cache-Control: private, no-store` on these seven answers, which is the helper's existing
  behaviour and is right for the same reason: the body now depends on a request header.
- **Hook** (`src/web/useSimple.ts`, `useIdeas.ts`, `useFaq.ts`, `useTimeline.ts`, `useDebate.ts`,
  `useGlossary.ts`, `useQuotes.ts`). The read sends the header, and "none" is `res.status === 404`
  **or** a body that is exactly `null`. The 404 branch stays, for a new client against an old
  server during a deploy. Compare with `=== null`, never truthiness, and check the reply has its
  artefact before publishing any of it; a wrong-shaped reply throws a plain `Error`, so the reader
  gets `PAGE_FAULT` as `tests/read-error-matrix.test.tsx` expects. Both lessons are from 261006g's
  review ([postmortem](../postmortems/261006k-a-null-sentinel-is-widened-by-a-truthiness-check.md)).
  A hook that has more than one read of its URL (a `…Read` half and a full half) changes every one.
- **Offline cache** (`src/web/lib/api.ts` § `NONE_YET_AS_NULL`). The pattern that stops a `null`
  being saved grows from three names to ten. Without this a saved `null` would be replayed offline
  to a tab opened before the deploy, which never asked for one.
- **Words.** The comments and docs that say "three reads" (`NONE_YET_AS_NULL_HEADER` in
  `src/types.ts`, `orNullWhenNotMadeYet`, `ArtefactNotMadeYet`, `api.ts`,
  `docs/project/web-client.md`) are brought up to date: these ten reads share the opt-in
  convention. Tweets, relations, Skim, Sketch and Arc still answer a plain 404 (Sol F3) and are
  named there as the ones not moved.

## What does not change

- Without the header, all seven still answer 404 for "not made yet". The reason is the one 261006g
  gave: a tab left open across the deploy reads `loaded.ideas.…` off the body and would show an
  error where its button was.
- "No such article" is a 404 with or without the header.
- Nothing a reader sees. Every band shows what it showed.
- Other artefact reads not on the queue item's list (arc, sketch, tweets, and so on) are not
  touched. If the builder finds the same 404 convention on others, that is a line in the debrief.

## The simpler option passed over

Answering `200 null` to everyone, with no header. Passed over for the old-tab reason above; it is
what the header is deleted in favour of once there is a client-version boundary.

A table-driven version (one list of artefact names generating routes, the offline pattern and the
tests) was also passed over. The ten handlers differ in what surrounds the read, and a list that
generates three of the four places leaves the fourth to be forgotten. A test that fails when a name
is in one place and not another does the same job with no new machinery, and is in the list below.

## Done looks like

- **Red first**, for each of the seven: with the header, an article with that artefact not made
  answers `200`, body `null`, `private, no-store`; without the header, 404; an unknown slug with the
  header, 404. Extend `tests/none-yet-is-not-a-404-route.test.ts` and
  `tests/none-yet-catch-boundary.test.ts` rather than starting new files.
- Red first, for each hook: it sends the header; it reads `null` as "none"; it still reads a 404 as
  "none"; `false`, `0` and `""` are not "none"; a reply without its artefact does not replace one
  already on screen. Extend `tests/none-yet-is-not-a-404-hooks.test.tsx`.
- Red first: a `null` from each of the seven URLs is not written to the offline cache
  (`tests/api-fetch-offline.test.ts`).
- One test that the set of routes wrapped in `orNullWhenNotMadeYet` and the set the offline pattern
  matches are the same ten.
- `npm test` on the touched files, `npm run typecheck`, lint on touched files; then the full suite.
- Tests also cover (Sol F1): a legacy Simple, a malformed FAQ and a malformed debate answer
  `200 null` with the header; a valid empty FAQ, timeline and debate answer their document.
- Browser, by a Sonnet subagent, at 1440 / 820 / 390: an owner's article with nothing made, each
  view opened by URL (so nothing is started by a click), Marginalia on, Summary open for Simple.
  **The observed request set must include all ten URLs** before "no 4xx" counts (Sol F2); each band
  shows its "nothing yet" state and button; an article that has them made still shows them.

## Reviews

GPT Sol on this plan before building (read-only), and on the code after (write-capable).

**Plan review, 2026-10-06** — [the answer](261006h-none-yet-rest-plan-review-sol.md), of commit
`f66c0cb2c`. Verdict: build it; no P0 or P1. All three findings accepted and folded in above: F1
(three loaders fold "unusable" into the same throw as "absent" — move the throw whole), F2 (a clean
network log proves nothing unless all ten requests were seen), F3 ("one convention" overstated:
five other artefact reads keep the 404).
