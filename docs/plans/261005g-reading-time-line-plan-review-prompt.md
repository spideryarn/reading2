# Review request: is this diagnosis right? (read-only)

You are reviewing a diagnosis, not code. Nothing has been built and nothing should be: do not edit
any file. Read
`docs/plans/261005g-reading-time-line-waits-on-the-experimental-switch-not-on-a-timer.md` first.

The reader (Greg, the owner) reported that the reading-time line on the spine appeared "about a
minute" after the article loaded. The plan concludes there is no delay in the code: the
Experimental switch was off at load, and the line appeared when it was switched on. It therefore
ends "Awaiting Greg" with a product question rather than a fix.

**Please try to break that conclusion.** In particular:

1. Read `src/web/useReadingTime.ts`, `src/web/article/ArticlePage.tsx` (the `useReadingTime` call),
   `src/web/experimental-store.ts`, `src/web/Spine.tsx` (the `readingPaths` memo and `measure`),
   `src/web/auto-modes-setting.ts`, `src/web/useProfile.ts`, and the `/api/reader` and
   `/api/reading-time` handlers in `src/routes.ts`. Is there any path by which the switch is ON for
   the reader and yet no `GET /api/reading-time/<slug>` is sent at mount, or by which the `GET`
   answers and the chart is not drawn until something else happens (a flush, a re-measure, a
   re-render)? Is there any path by which a `PATCH /api/reader` that is NOT `{experimental:true}`
   would cause a reading-time `GET` to start within ~25 ms?
2. Is there any way the client could believe the switch is off when the server row says on (so that
   a real bug hid behind a press that merely repaired it)? Note the row is null *now*, after a
   second PATCH at 07:37:26; the plan infers on-then-off. Is off-then-off, or
   on-at-load / client-wrong, consistent with the evidence below?
3. Is the plan's "inferred step" paragraph honest about what is and is not proved?
4. Are the three options put to Greg complete and fairly described, including the privacy
   consequence (`docs/project/privacy.md` § Reading time)? Is anything missing that he would need
   to choose?

## The evidence, verbatim

Vercel runtime log, production, deployment `dpl_GXT8uNwhdti3mwjK8AzPtRkTT6Zh`, 2026-10-05 UTC. Each
line is the server's own structured log; `time` is when the response was logged and `ms` its
duration. Slug abbreviated as `<slug>` = `entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`.

```
07:22:28.971 GET  /api/article/<slug> 200 ms=219
07:24:48.640 GET  /api/reader 200 ms=11
07:24:48.658 GET  /api/article/<slug> 200 ms=184
07:24:48.907 POST /api/library/<slug>/open 204 ms=8
07:24:48.998 GET  /api/quiz/<slug> 200
07:24:49.111 GET  /api/chat/<slug> 200
07:24:49.121 GET  /api/comments/<slug> 200
07:24:49.138 GET  /api/quotes/<slug> 200
07:24:49.141 GET  /api/crossrefs/<slug> 404
07:24:49.235 GET  /api/citations/<slug> 200
07:24:49.318 GET  /api/glossary/<slug> 200
07:25:44.665 GET  /api/glossary/<slug> 200
07:25:46.653 POST /api/jobs 202  (glossary, forced)
07:25:47 … 07:26:44  GET /api/jobs 200, once a second
07:26:44.762 job done (glossary, 57.9 s); revision published
07:26:44.974 GET  /api/glossary/<slug> 200
07:26:46.994 PATCH /api/reader 200 ms=17
07:26:47.182 GET  /api/reading-time/<slug> 200 ms=179
07:27:13.012 GET  /api/chat/<slug> 200
07:27:28.605 POST /api/transcribe 200
07:27:39.339 POST /api/chat/<slug> 200
07:27:47.004 POST /api/reading-time/<slug> 204 ms=23
07:28:40.346 POST /api/reading-time/<slug> 204 ms=44
07:29:38     feedback filed from https://www.spideryarn.com/ (build f90a9a7f)
07:29:42.894 GET  /api/reading-time/<slug> 200 ms=9
07:30:42.888 POST /api/reading-time/<slug> 204 ms=12
07:36:13.758 GET  /api/reading-time/<slug> 200 ms=98
07:37:13.808 POST /api/reading-time/<slug> 204 ms=124
07:37:26.964 PATCH /api/reader 200 ms=59
```

A text search of the same log for `reading-time` from 07:00 to 07:35 returned only the lines above
(nothing before 07:26:47), and for `/api/reader` from 06:30 to 07:24:40 returned nothing; from
07:35 to 07:50 nothing for `reading-time` after 07:37:13. Request bodies are not logged.

Production, inside `begin read only`, at 10:41:03 UTC:

```
select experimental_since, updated_at from spideryarn.reader_profiles where owner_id = <Greg's id>
→ experimental_since: null, updated_at: 2026-10-05T07:37:26.946Z
```

The local reproduction (Playwright, dev server, switch on) is summarised in the plan's table.

## What to return

Findings ordered by severity, each with the file and line that supports it. Say plainly whether the
conclusion stands. End with one line: `VERDICT: approve`, `VERDICT: approve with changes` or
`VERDICT: reject`.
