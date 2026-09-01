Verdict: the routing change itself is sound, but I would not commit the test and postmortem as written. Several central claims are false, including the claim that the rename is a durable guard.

## Blocking findings

1. The rename is not a compile-time guard.

`ApiRequest` still exposes the full `IncomingMessage`, including `req.url` ([routes.ts](/home/greg/code/spideryarn2/src/routes.ts:5208)). The chat handler already uses that escape hatch directly ([routes.ts](/home/greg/code/spideryarn2/src/routes.ts:5896)).

This class can return through any of these compiling changes:

- `.exec(req.url ?? "")`
- `const url = rawUrl; pattern.exec(url)`
- `pattern.test(rawUrl)` or `rawUrl.match(pattern)`
- reintroducing an `url` field
- matching in a helper or another file
- matching against the outer `url` inside `serveApi`

The source guard catches only three exact spellings involving `rawUrl` in one file ([test](/home/greg/code/spideryarn2/tests/the-query-string-does-not-decide-the-route.test.ts:94)). It misses the escape hatch already in production code. The postmortem’s “only guard here that cannot itself go stale” claim is therefore wrong ([postmortem](/home/greg/code/spideryarn2/docs/postmortems/260901a-the-route-the-query-string-hid.md:110)).

I would delete the source-reading test. Comment stripping does not repair the fundamental problem: it still tests spelling, not routing behavior. If this needs a permanent structural guard, route matching must be encapsulated behind an API that receives only `path`, or enforced by a real lint rule with a deliberate positive control.

2. The new test does not prove the summaries branch ran.

Both branches return `{ threads: [] }` for the absent slug used by the test. Removing the `summary` conditional entirely would leave the named “reaches the summaries branch” case green ([test](/home/greg/code/spideryarn2/tests/the-query-string-does-not-decide-the-route.test.ts:67)).

It does prove the important narrower fact: a query-bearing chat URL no longer reaches the dispatcher’s catch-all. That is real evidence, not theatre. But it needs a stored non-empty thread and an assertion that the response is a `ThreadSummary` without transcript messages to prove the branch.

The postmortem also says “Both halves had tests” ([postmortem](/home/greg/code/spideryarn2/docs/postmortems/260901a-the-route-the-query-string-hid.md:66)). I searched the tests at `94d0651` and the current tree: before this new test, there was no test of `?summary=1`, `summarise`, or a summary response at all. `chat-anchor-route.test.ts` tested POST/cancel behavior, not this GET branch.

3. The postmortem misidentifies the durable technical cause.

The matcher is the direct cause. The larger cause is that one dispatcher exposed two untyped strings, used chronological convention instead of one matching seam, and had no client-to-handler test.

The history is:

- `bf5a91e`, 2026-08-25: introduced the latent `url`/`path` split.
- `f862af5`, 2026-08-26 10:30 +0300: added shelf and library-search query parameters and moved the whole library route family to `path`. This is when “No route reads a query string today” first became false.
- `94d0651`, 2026-08-26 21:55 +0300: introduced the structurally unreachable summaries branch.
- `a16b5ea`, 2026-08-27 00:02 +0300: introduced the reader-visible caller.

Therefore these postmortem claims are wrong:

- The stale comment did not first become false with the summaries work.
- The three query routes were not “each moved to `path` one at a time”; shelf and search landed together, and all four library-family selectors were generalised together ([postmortem](/home/greg/code/spideryarn2/docs/postmortems/260901a-the-route-the-query-string-hid.md:55)).
- `envelope({path: url})` made direct-dispatch tests unrealistic, but it did not hide an existing summary test. No such test existed. `handleApi` tests could always provide the real query-bearing `req.url`, as the new test now does.

The newer process-level cause—diagnosed, parked in a plan, never queued—is supported by the two cited plan documents and is worth keeping.

4. The postmortem is already repeating the stale-present-tense mistake.

The clearest instance is the new comment claiming that “three routes genuinely read a query string” ([routes.ts](/home/greg/code/spideryarn2/src/routes.ts:5195)). There are four route families: shelf, library search, reader, and chat. Chat is omitted only because it bypasses `rawUrl` and reads `req.url`.

Another stale claim says `serveAuthenticatedApi` was moved and is “otherwise unchanged,” with the route declarations still the same text and order ([routes.ts](/home/greg/code/spideryarn2/src/routes.ts:5219)). That was a historical fact at the moment of extraction; it is plainly false now.

The admin comment “only route in it today” is not the same defect: the namespace gate is structurally above every handler and matches the whole path prefix. A future admin route remains gated whether the comment is updated or not.

5. The scoped diff is not actually scoped.

It includes the unrelated `refereeClaims` route and surrounding referee comment edits ([diff](/home/greg/code/spideryarn2/docs/plans/260901e-the-query-string-that-hid-a-route.diff:257)). It also contains stale links to a nonexistent `260901e` postmortem while the live source names `260901a`.

Regenerate it before using it as review or commit evidence.

## Is changing every matcher safe?

Yes, with one explicit semantic choice: unknown query parameters are now ignored by another 32 regex routes and two exact-equality routes, including write and paid endpoints.

I found no route contract, comment, test, or history showing that a query string was intentionally an automatic rejection filter. If strict query allowlisting is wanted, it needs a central validator; accidental failure of an anchored regex is not that policy.

Specific boundaries checked:

- The admin namespace was already matched against `path`; non-admin `/api/admin/users?x=1` remains 403. Only an authorised admin changes from accidental 404 to the intended handler.
- Public dispatch was already entirely path-based ([public/routes.ts](/home/greg/code/spideryarn2/src/public/routes.ts:135), [public/routes.ts](/home/greg/code/spideryarn2/src/public/routes.ts:306)). This change does not alter the public/authenticated split.
- `originalUrl` deliberately preserves non-rewrite query parameters when reconstructing the Vercel URL ([vercel.ts](/home/greg/code/spideryarn2/src/vercel.ts:132), [vercel.ts](/home/greg/code/spideryarn2/src/vercel.ts:254)). It correctly delivered the broken URL before and will correctly deliver the repaired one now.

## Actual reader impact and duration

The write-up understates and overstates different parts.

What broke for an owner reopening an article:

- Existing selection marks disappeared.
- Existing per-paragraph conversation counts disappeared.
- Their hover/open affordances disappeared.
- A `?thread=` link outside chat mode could fail to open the floating conversation, because the overlay requires the fetched summary to prove the thread is a chat ([App.tsx](/home/greg/code/spideryarn2/src/web/App.tsx:1555)).

What did not remain broken throughout a mounted page:

- A newly created conversation is inserted locally, so its mark and count can appear until reload.

“Every reader” is too broad. `useChatAnchors` is mounted only for `OwnedReader`; public visitors do not issue this authenticated request.

The branch was indeed never true in production code: its enclosing matcher required a raw URL without `?`, while the condition required `?summary=1`. I found no alternative production caller or historical test that could reach it.

The reader-visible incident began at `a16b5ea`, 2026-08-27 00:02:41 +0300. The repair is still uncommitted, `main` is 35 commits ahead of `origin/main`, and `origin/main` still contains the broken code. On repository evidence, production has therefore been broken for more than five days and remains broken until deployment. “Fixed on 2026-09-01” currently means “written in this working tree,” not fixed for readers.

There was also more than one trace: `apiFetch` logged the 404 in the browser, and the server’s `finally` logged every catch-all 404 at warn level ([routes.ts](/home/greg/code/spideryarn2/src/routes.ts:4969), [routes.ts](/home/greg/code/spideryarn2/src/routes.ts:6241)).

## Other query-bearing clients

I found five call sites across four route families:

- `useChatAnchors`: chat summaries—broken.
- `useLibrarySearch`: `?q=`—already path-based.
- `useShelf`: `?archived=1`—not listed in the request; already path-based.
- `useProfile`: optional `?slug=`—not listed; already path-based.
- `ProfilePanel`: `?slug=`—already path-based.

## Checks performed

I inspected the live files, scoped diff, both cited historical plans, introducing commits, all route matchers, admin/public dispatch, Vercel restoration, and all internal web API query-string call sites. An independent history audit reached the same conclusions.

Direct TypeScript checks passed for the root and web projects. The tests project has three unrelated existing errors. I could not rerun Vitest because this review sandbox is read-only and Vitest aborts while creating `node_modules/.vite-temp`; I have not represented the supplied green test run as one I executed.