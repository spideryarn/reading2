# One binary-response writer, and the policies left where they were

Status, 2026-09-11: **built** — cluster H of
[260908f-prioritised-spideryarn-codebase-improvements.md](260908f-prioritised-spideryarn-codebase-improvements.md#h-share-binary-response-mechanics-keep-policies-with-callers),
its one stage. Dispatched by the Overseer (queue item `qi-y78j2e46`) after the route-table
migration finished at `a70e4529`.

## What it was for

Six routes answer with bytes rather than JSON, and each wrote the same four things by hand —
status 200, `X-Content-Type-Options: nosniff`, a `Content-Length` and the body — beside the things
that genuinely differ. The audit counted six `nosniff` set-sites and warned they were **not six
identical contracts**. The job was to share the mechanics and leave every policy with its caller,
and to stop if the shared writer came out with more branching than it removed.

| Route (where it is now) | Policy that stays with the caller |
|---|---|
| `sendSource`, src/routes.ts | owner PDF read; `inline` disposition; **no** `Cache-Control` |
| `sendPlate`, src/routes.ts | owner + Illustrated artefact; hash and extension match; `private, max-age=31536000, immutable` |
| `sendArticleAsset`, src/routes.ts | owner + assets manifest; sniffed MIME; the same private immutable |
| `sendExport`, src/routes.ts | owner-filtered bundle; 413 over the cap; `attachment`; `private, no-store` |
| admin screenshot row in `AUTH_ROUTES`, src/routes.ts | admin gate; `isUuid`/`isSpideryarnId`; PNG literal; `private, no-store` |
| `sendBytes`, src/public/routes.ts | public read upstream; the namespace's `no-store`; **GET and HEAD** |

## What was built

[`src/binary-response.ts`](../../src/binary-response.ts), a leaf importing only a type, because
`src/public/routes.ts` may not reach `src/routes.ts` (tests/public-imports.test.ts). It takes the
resolved bytes and a content type, and writes status 200, `Content-Type`, `nosniff`, the byte
`Content-Length` and the body — straight-line, no conditional. Each caller sets its own disposition
and cache policy with its own `res.setHeader` line just before calling it, beside the comment that
says why, so a policy set-site is still in the caller that owns the policy. The writer runs last, so
a caller that set a mechanism header by mistake is overwritten rather than obeyed.

**HEAD is a second export, `sendBinaryHead`, not a flag.** A `head: boolean` would put the choice at
all six call sites; as a separate function, only the one file that imports it can answer a HEAD, and
`src/routes.ts` imports `sendBinary` alone. The authenticated dispatcher has no HEAD anyway
(`AuthRouteMethod`), and the tests below now say so for each route.

**Branching.** None in the writer. The one HEAD conditional that existed, in `sendBytes`, is still
there and still the only one. So the helper added no branching and removed none, and in exchange six
copies of the four mechanism lines became one — which is what cleared the plan's bar for extracting
rather than keeping the six writers.

**Census after:** one `X-Content-Type-Options` set-site under `src/` (was six), one
`Content-Length` from bytes for all six routes.

**What was passed over:**

- *Keeping the six writers and adding only the stronger tests*, which the plan allows as an ending.
  It lost because the writer came out branch-free, and a seventh binary route written against it
  cannot forget `nosniff` or count characters.
- *A `policy` object of the two optional headers*, enumerated into `setHeader` — the first version
  built here. GPT Sol's review showed it was neither closed nor branch-free: TypeScript checks excess
  keys only on a fresh literal, so a policy object built elsewhere could carry `Content-Type` past it,
  or a key whose value is `undefined` and makes Node throw; and the loop was a branch. Plain
  `setHeader` at the caller has neither problem and keeps the policy visibly in the caller.

## Characterisation, before any move

Each route's response is now pinned **through its route** as three separate claims — the **whole**
header object with `toEqual` (so a header that appears is as red as one that changes), a
`Content-Length` measured off a fixture with a multibyte tail (a 24-byte PNG header decodes to
exactly as many characters as it has bytes, so the old fixtures could not tell the two counts
apart; `tests/helpers/binary-response.ts`), and HEAD. All were green against the unchanged writers
first.

| Suite | Added |
|---|---|
| tests/source-route.test.ts | exact headers with no `Cache-Control`; byte length; `inline` under its name; HEAD 404 without reading the document |
| tests/illustrated-route.test.ts | exact headers with the private immutable; byte length (PNG plate given a multibyte tail); no disposition; HEAD 404 |
| tests/asset-route.test.ts | both routes' exact headers (owner immutable, stranger `no-store`); byte length on both; no disposition; **public HEAD = GET's headers, length included, empty body**; owner HEAD 404 |
| tests/export-route.test.ts | exact headers with `private, no-store` and `attachment`; byte length via the bundle seam; HEAD 404 without building the bundle |
| tests/admin-feedback-screenshot-route.test.ts (new) | the route's first success test: exact headers with `private, no-store`; byte length; no disposition; HEAD 404; missing 404 as JSON; non-admin 403 and bad id 400, both before the store is asked |

Missing and unauthorised cases for the other four were already covered in their suites and are
unchanged. The first version compared a picked set of five header names; Sol pointed out an added
`Content-Encoding: gzip` would have stayed green under it, so the suites compare the whole object and
M11 below proves it.

## Mutation controls, after the move

Each applied alone, the named suites run, the file restored. Run on the final shape, after the
review's fixes.

| # | Mutation | Result |
|---|---|---|
| M1 | plate's cache policy `private` → `public` | illustrated-route red: 1 (the exact-headers case) |
| M2 | export's `Cache-Control` removed | export-route red: 1 |
| M3 | public route given the owner's year-long immutable | asset-route red: 2 |
| M4 | screenshot's `no-store` → immutable | screenshot route red: 1 |
| M5 | `sendBinaryHead` writes the body | asset-route red: 1 (public HEAD) |
| M6 | public HEAD routed to `sendBinary` | asset-route red: 1 |
| M7 | `Content-Length` counts UTF-8 characters | all five suites red: 16 |
| M8 | the writer sets `Cache-Control: no-store` itself | all five suites red: 6 |
| M9 | `nosniff` removed from the writer | all five suites red: 11 |
| M10 | authenticated dispatcher matches HEAD to GET rows | all five suites red: 5 (every authenticated HEAD case) |
| M11 | the writer adds `Content-Encoding: gzip` | all five suites red: 6 |

M1–M4 and M8 are the plan's "a changed cache policy is rejected"; M5 and M6 its "a HEAD with a body
is rejected"; M10 is the guard on "never enable HEAD on an authenticated route".

## Checks

Focused: the five suites above plus tests/public-dispatch.test.ts and tests/public-imports.test.ts.
`npm run typecheck` exit 0. Biome lint clean on every touched file (two pre-existing complexity
infos in src/routes.ts, elsewhere).

Full `npm test` on the final code: 7 files red of 1,095. Two were this stage's and are fixed: a
doc-links anchor in this file, and **tests/source-store.test.ts**, a source-text guard whose
"the regex captured `sendSource`" sentinel was the literal `res.statusCode = 200` — moved into the
writer, so the sentinel is now `sendBinary(res, {`. The focused list had missed it because it reads
`src/routes.ts` as text rather than driving the route. Re-run alone, both green. The other five are
not this change: `cold-start-lazy-imports` and `pdf-bundle-trace` want `npm run build` in a fresh
worktree; three fleet suites start a built fleet child; `dock-experimental-modes` and
`small-screen-banner` pass alone (contention).

## Review

One findings-only GPT Sol review (`gpt-5.6-sol`, high, `--sandbox review`) of the scoped diff, the
new files and the mutation output, per the Overseer's rationing. It was a genuine nested run, not a
self-review. Three findings, all accepted and fixed:

- **P2, the policy object was not closed and the loop was a branch** — fixed by removing it; callers
  `setHeader` their own policy (above).
- **P2, the exact-set oracle ignored unexpected headers** — fixed by comparing the whole header
  object; M11 added to prove it.
- **P3, `sendPlate`'s docstring called it "the only binary route besides `sendSource`"** — stale
  since before this stage; corrected.

The fixes were not re-reviewed, per the one-review ration; the eleven mutations above were re-run on
the fixed code instead.
