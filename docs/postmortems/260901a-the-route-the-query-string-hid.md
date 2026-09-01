# The route the query string hid

`GET /api/chat/<slug>?summary=1` — the reading view's only request for *which
conversations are anchored to which passage* — has never once been answered. It
404s, on every article an owner opens, since **2026-08-27 00:02**. The handler for
it was written, commented and shipped; the matcher above it could not reach it.

**It was found on day one and repaired on day five, and that gap is the part
worth reading.** The cause was correctly diagnosed, in writing, with the right
fix named, on 2026-08-28 — and then sat there.

> **Still broken in production as this is written.** The repair below is in the
> working tree; `origin/main` — which is what Vercel serves — still carries
> `.exec(url)`, and `main` is 36 commits ahead of it. "Fixed 2026-09-01" means
> fixed for whoever runs this checkout. Readers get it at the next deploy.

## What a reader lost

For an owner reopening an article that had conversations in it:

- the marks in the margin beside passages somebody had asked about, gone;
- the per-paragraph conversation counts, and the hover and click that go with
  them, gone;
- a `?thread=` link outside chat mode could fail to open the floating
  conversation at all, because the overlay is gated on the fetched summary
  proving the thread is a chat ([`App.tsx`](../../src/web/App.tsx) § overlay).

Two things it did **not** break. A conversation started in the current page is
inserted into the list locally, so its own mark appears and survives until
reload. And public visitors were unaffected: `useChatAnchors` is mounted only for
`OwnedReader`, and the request is authenticated.

## What the code said, and what it did

`serveApi` computed two strings per request and handed both down:

```ts
const url = req.url ?? "";              // "/api/chat/my-article?summary=1"
const path = url.split("?")[0] ?? url;  // "/api/chat/my-article"
```

and the dispatcher matched on the first:

```ts
const chat = /^\/api\/chat\/([\w.%-]+)$/.exec(url);
```

Every route pattern in that file is `$`-anchored, and every slug class —
`[\w.%-]+` — excludes `?`. So a query string does not mis-route a request. It
stops it matching **anything**, and it falls through to the catch-all:

```
{"error": "No API route for GET /api/chat/my-article?summary=1"}
```

Thirty-two matchers were on `url`; five later ones were on `path`.

## The technical cause

The direct cause is the matcher. The durable one is that a single dispatcher held
**two interchangeable-looking strings, no seam that decided which one routing
used, and no test that ran a client's real URL from request to handler**. Which
of the two a route got was decided by when it was written.

`path` arrived on 2026-08-25 (`bf5a91e`) for logging, not routing: `logRequest`
must not write a `?token=…` into a message string, where redaction — which
matches key paths, never text — cannot reach it. Good reason, still true. The
comment beside it said:

> The routes below still match against `url` itself; nothing here changes what is
> served. … **No route reads a query string today**, so this costs nothing.

Both sentences were true when written, and the second was a claim about the world
that nothing was watching. It stopped being true the next morning:

| | |
|---|---|
| `bf5a91e` | 2026-08-25 | the two strings, and the comment |
| `f862af5` | 2026-08-26 10:30 | the shelf and library search take `?archived=1` and `?q=`, and the whole library route family moves to `path` — **the comment is false from here** |
| `94d0651` | 2026-08-26 21:55 | the `?summary=1` branch, structurally unreachable the moment it lands |
| `a16b5ea` | 2026-08-27 00:02 | the caller in `useChatAnchors`, and a reader-visible bug |

An earlier draft of this file said the three query-taking routes were "each moved
to `path` one at a time, by whoever hit the wall". That is wrong, and GPT Sol
checked it: shelf and search landed together and the family was generalised in one
commit. What actually happened is narrower and worse — the generalisation stopped
at the edge of the routes that commit touched, and nothing carried it across the
file or wrote down the rule.

Both halves of the summaries feature were written, and **neither had a test**. An
earlier draft claimed both did; there was no test of `?summary=1`, of `summarise`,
or of a summary response anywhere in the tree until this one.
`chat-anchor-route.test.ts` covers the POST. And `envelope()` in
`tests/public-dispatch.test.ts` built its request as `{ url, path: url }`, so in
the suites that call the dispatcher directly the two strings were the same string
and the distinction production turns on did not exist. That did not hide an
existing test — it meant a realistic one could not be written there.

## The real cause: it was diagnosed, parked, and never queued

This is not a bug that hid. Its trail:

| | |
|---|---|
| 2026-08-27 | A browser pass notes *"a persistent 404 on `/api/chat/<slug>?summary=1` on every chat panel load … worth somebody's attention and is not this feature's"* — [260827aj](../plans/260827aj-chat-follow-links.md) |
| 2026-08-28 | A second browser pass diagnoses it completely: the `$` anchor, the stale comment, and the fix — *"match `chat` — and, on the same argument, everything beside it — against `path`"* — [260828bb](../plans/260828bb-chat-anchors-and-drafts.md) § 1 |
| 2026-09-01 | Repaired in this tree |

The 2026-08-28 write-up says plainly why it stopped there:

> Neither is fixed here. `src/routes.ts` and `src/web/App.tsx` both had
> uncommitted work from other sessions in them at the time, and a fix committed
> from here would have swept it up. … Written down instead, with the evidence, so
> whoever owns those files next can land it in one sitting.

**That judgment was correct and the outcome was still four more days.** The gap is
not carelessness; it is that *"written down so whoever owns those files next can
land it"* has no mechanism behind it. `docs/plans/` is a record, not a queue.
Nothing reads it looking for work, nothing surfaces a parked fix when someone next
opens the file it is about, and the agent who eventually opened `src/routes.ts`
was here for an unrelated rename and found this by reading the code. The write-up
turned up afterwards, in a grep for `summary=1`.

The shared-tree rule that stopped the fix is a good rule, written after a private
index recipe silently reverted six hours of other people's work. The answer is not
to loosen it. The answer is that **a diagnosed, unfixed, user-facing bug needs to
be recorded where the next person will trip over it** — for this one, a comment
beside the stale sentence in `src/routes.ts`, which is the line somebody had to
read anyway.

There was more than one trace, too, and both were machine-readable. `apiFetch`
logged the 404 in the browser console, and the server's own `finally` logged every
catch-all 404 at **warn** level, on every article open, in dev and in production.
Nothing watches either.

## The fix

The narrow fix is one character: `exec(url)` → `exec(path)`. That is not the fix
that was made, because it leaves the trap for the next route.

**`ApiRequest` now carries three fields with three jobs.** `path` is what every
route matches on. `query` is a `URLSearchParams`, parsed once, and is how the four
route families that take parameters read them. `rawUrl` is for the 404 message.

The rename from `url` to `rawUrl` is **a speed bump, not a wall**, and an earlier
draft of this file called it "the only guard here that cannot go stale", which is
wrong. GPT Sol listed the ways the class walks back in through a compiler that is
perfectly happy: `.exec(req.url ?? "")` — `req` is right there, and the chat
handler was doing exactly that — or aliasing `rawUrl`, or matching in a helper.

What actually shrinks the class is `query`. Before it, a handler that wanted a
parameter had to get hold of a URL and parse it, and three did; now nothing below
the dispatcher has a reason to hold a URL string at all, so there is no live
example for the next handler to copy. That is a smaller claim than a compile-time
guarantee and it is the true one.

A source-reading test that grepped the dispatcher for matchers on `rawUrl` was
written and then deleted on Sol's advice: it tested spelling rather than routing,
and missed the `req.url` escape hatch that was in production code at the time.
This repo has already had one source-text guard satisfied by a comment
(`b95443b`); a second was not worth having.

## The test, and what makes it evidence

`tests/the-query-string-does-not-decide-the-route.test.ts` asks for the same chat
list twice, with and without `?summary=1`, against a conversation really written
to the store — so the query string is the only difference between the two
requests, and the answers must differ in exactly the way the handler claims: the
summary has `turns: 1` and **no** `messages`.

Both failure modes were provoked and watched to go red:

| what was broken | what failed |
|---|---|
| the matcher put back on `rawUrl` | both query-carrying cases, on `No API route for` |
| the matcher left correct, the `?summary=1` branch deleted | the summary case, on the transcript coming back |

The second is there because of Sol's finding: an earlier version of this test used
an absent slug, where both branches answer `{ threads: [] }`, so deleting the
branch outright would have left it green. A test that cannot fail for the reason
it names is not evidence.

## What would have caught it

**For the bug:** a request harness that derives `path` and `query` the way
`serveApi` does instead of taking them as parameters. The one line `path: url` in
`envelope()` is where realistic tests became impossible to write there; it now
splits on `?`. The 2026-08-28 write-up got there first, in one line: *"a route
test that asks for the URL the client actually sends."*

**For the four days:** nothing in this repo, and that is the finding. The cheap
remedy is to leave the note **in the code**, at the line that is wrong, whenever
you diagnose a bug you have decided not to fix.

## Where it was, and where it went

| | |
|---|---|
| Introduced | `bf5a91e` 2026-08-25 (the two strings); reader-visible from `a16b5ea` 2026-08-27 00:02 |
| First seen | 2026-08-27, in a browser console; diagnosed 2026-08-28 |
| Repaired | 2026-09-01, in `src/routes.ts` and `tests/public-dispatch.test.ts` |
| Test | `tests/the-query-string-does-not-decide-the-route.test.ts` |
| Reviewed by | GPT-5.6 Sol, 2026-09-01 — [the review](../plans/260901e-the-query-string-that-hid-a-route-review-sol.md) |
| Reaches readers | at the next deploy, and not before |

One deliberate semantic change, named here because it was a choice rather than a
consequence: **an unrecognised query parameter is now ignored by every route**,
including writes. It was never a policy that a stray `?x=1` should be refused —
that was an accident of an anchored regex — and nothing in the file, its tests or
its history treated it as one. If strict parameter checking is ever wanted it
needs a validator, not a routing side effect.

Not changed: `originalUrl` in [`src/vercel.ts`](../../src/vercel.ts), which
deliberately preserves non-rewrite parameters when it reconstructs the URL behind
a Vercel rewrite. It delivered the broken URL faithfully and will deliver the
repaired one.

**Still open**, and deliberately not fixed here: the second bug in
[260828bb](../plans/260828bb-chat-anchors-and-drafts.md) § 2 — "also ask the AI
about it" saves the comment and never asks, while the chat band is open. That one
is a product decision about what the reader should see, and it wants Greg.
