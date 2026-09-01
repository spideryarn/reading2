# Review this fix: a query string made a route disappear

You are reviewing **code that is written but not committed**, plus its postmortem. Be adversarial.
The previous review you gave on this repo ("do not build this plan as written") was right on every
blocking point, so do not soften.

Repo: `/home/greg/code/spideryarn2`. Read whatever you need; the working tree has the change in it.

## The bug

`src/routes.ts` computes two strings per request and hands both to the dispatcher:

```ts
const url = req.url ?? "";              // "/api/chat/my-article?summary=1"
const path = url.split("?")[0] ?? url;  // "/api/chat/my-article"
```

Thirty-two route matchers ran `.exec(url)`; five later ones ran `.exec(path)`. Every pattern is
`$`-anchored and every slug class is `[\w.%-]+`, which excludes `?`. So
`GET /api/chat/<slug>?summary=1` — issued by `src/web/useChatAnchors.ts` on every article open, to
learn which conversations are anchored to which passage — matched nothing and fell through to the
catch-all 404. Its handler (`if (url.searchParams.get("summary") === "1")`) was unreachable from the
day it shipped. The client swallows the error on purpose, so nothing surfaced.

## What was changed

- `ApiRequest.url` is renamed to `rawUrl`. Every route matcher now runs against `path`. The three
  places that genuinely read a query string (`?archived=1` shelf, `?slug=` reader, `?q=` search) and
  the 404 message use `rawUrl`. The intent is that `.exec(url)` stops compiling.
- `envelope()` in `tests/public-dispatch.test.ts` built `{ url, path: url }`, so the two were always
  the same string in tests and the distinction production turns on could not exist. It now derives
  `path` by splitting on `?`.
- New `tests/the-query-string-does-not-decide-the-route.test.ts`.
- New `docs/postmortems/260901a-the-route-the-query-string-hid.md`.

## Files to read

- `docs/postmortems/260901a-the-route-the-query-string-hid.md` — the write-up under review.
- `tests/the-query-string-does-not-decide-the-route.test.ts` — the new test.
- `src/routes.ts` — `serveApi` and `serveAuthenticatedApi`.
- A scoped diff was supplied here at review time and has **not** been kept: it was filtered by
  keyword out of a working tree that several agents write to, Sol found it had let an unrelated
  referee route through, and it went stale within the hour as the fix was reworked in response to
  this review. The reviewed state is the tree as it stood at 12:00 on 2026-09-01; what changed
  afterwards is listed in the postmortem, which names each of Sol's findings and what it did to
  them.

## Evidence

Before the change, the new test failed on exactly the two cases that carry a query string:

```
AssertionError: expected 'No API route for GET /api/chat/no-such-article-the-query-string-test?summary=1'
  not to match /^No API route for/
```

The sibling case without a query string passed at the same time, which is what isolates the query
string as the only difference. After the change all four pass, `npm run typecheck` adds no error
(the four it produced in `public-dispatch.test.ts` were the point and are fixed), and 13
route-adjacent suites — `public-dispatch`, `chat-route`, `chat-anchor-route`, `web-api`,
`chat-write-paths`, `feedback-route`, `quiz-mark-route`, `chat-spoken-route`,
`chat-live-ticket-route`, `shelf`, `embedding-route-failures`, `remember-route`,
`public-network-trace` — are green, 191 tests. The full suite has ~22 failing files, none of them
route-related and all of them failing before this change too, in a tree several agents are writing
to.

## What I want from you

1. **Is switching all 32 matchers from `rawUrl` to `path` safe?** Argue the other side. Is there any
   route that *should* refuse a request carrying a query string, or any handler that was relying on
   the old behaviour as an accidental filter? Consider the admin namespace check, the public
   namespace split in `src/public/routes.ts`, and `originalUrl` in `src/vercel.ts` which reassembles
   the query after a Vercel rewrite.
2. **Is the rename actually a guard, or does it just look like one?** Name the ways somebody
   reintroduces this class in six weeks despite it.
3. **Is the new test evidence or theatre?** In particular the source-reading backstop — this repo has
   already had a source-text guard satisfied by a comment (`b95443b`). Should it exist at all?
4. **What else in this file has the same shape** — a decision written down as a fact about the
   present tense, guarding a distinction that no test can see? Go and look; do not speculate.
5. **Is the postmortem's root cause right?** It names the comment *"No route reads a query string
   today"* and the test envelope's `path: url`, not the matcher itself. Push back if that is
   self-serving or if it misses a bigger cause.
6. **What did this actually break for a reader, and for how long?** Verify the dates and the claim
   that the summaries branch was never once reached. If any other client sends a query string to an
   API route, say so — I found three (`useChatAnchors`, `useLibrarySearch`, `ProfilePanel`) and two
   were already on `path`.
7. **Anything the fix or the write-up is confidently wrong about.**

Say which parts you actually checked. A review that returned nothing looks exactly like one that
found nothing.
