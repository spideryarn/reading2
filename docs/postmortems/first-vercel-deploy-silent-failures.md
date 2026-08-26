# The first Vercel deploy: five failures, none of which said anything

2026-08-26. Getting Spideryarn onto Vercel for the first time took four
iterations, and the striking thing is not that things were wrong. It is that
**every one of them reported success.** Four broke the deployment — each
producing a green build, a "Ready" status, and a site broken in a way no log we
write mentions — and a fifth, in the client, turned the resulting failure into a
message about JavaScript syntax.

This is one file rather than five because the bugs are unrelated and the lesson
is not. It is [silent-success.md](../reusable/silent-success.md) five times in one
afternoon, on a platform where the usual instinct — read the logs — returns
nothing.

## What happened

The first deployment built cleanly and served a working homepage. Every API
request returned `500 FUNCTION_INVOCATION_FAILED`. `vercel logs` showed no
runtime output at all, on either the deployment stream or the API. The build log
said `Build Completed`.

Four distinct causes, found in this order, each hidden behind the one before it —
and then a fifth, which decided what any of it looked like to a reader.

## 1. The build compiled TypeScript it could not compile, then said it was fine

**Cause.** Vercel's Node builder discovers TypeScript in the project and uses it
to compile anything under `api/`. This repo is on **TypeScript 7**, whose
compiler that builder cannot drive. The build log said, in full:

```
Using TypeScript 7.0.2 (local user-provided)
Using the TypeScript 7.0.2 compiler executable for transpilation.
error TS2688: Cannot find type definition file for 'node'.
```

and then finished with `Build Completed` and uploaded a 3.7MB function.

**Why it was written that way.** Nothing was written that way. The default
behaviour of the platform is to compile `api/*.ts`, and the default behaviour of
this repo is to be on TypeScript 7. Neither is wrong; the combination is, and
neither side is in a position to notice.

It is also not the first time. [linting.md](../project/linting.md) records that
TypeScript 7 removed the API **ESLint** needed, which is why this project uses
Biome. The same release removed the one Vercel's builder needs. That is the
generalisable fact: *TypeScript 7 broke tool integrations, plural*, and any tool
that says "using your TypeScript" is a candidate.

**The fix that is right for the long term** is not to make the builder work. It
is to stop asking it to: `api/` now contains one hand-written `.js` file, and the
handler is compiled by [vite.api.config.ts](../../vite.api.config.ts) — the same
tool that compiles the client, on a version we control. There is no TypeScript
under `api/` for the builder to find and no version of it to disagree with.

**What would have caught it earlier.** Reading the build log rather than the
build *status*. `vercel inspect --logs` prints it; the word `error` was in there
from the first attempt, twenty minutes before it was read. A build that prints
`error` and exits 0 is a lie, but it is a legible one.

## 2. `[...path]` is not a catch-all, and looks exactly like one

**Cause.** The adapter was `api/[...path].ts`, on the assumption that Vercel's
filesystem routing honours the `...` spread the way Next.js does. It does not.
**Every bracketed filename is one segment**, compiled to roughly `^/api/([^/]+)$`.
Measured on the real deployment:

```
/api/library         -> reached the function
/api/health          -> reached the function
/api/article/writes  -> 404 NOT_FOUND, from the platform
/api/jobs/abc/retry  -> 404 NOT_FOUND, from the platform
```

Two further details made it worse. The generated route **appended its capture to
the query string** — `sawUrl` came back as `/api/health?...path=health` — and
several routes in [`src/routes.ts`](../../src/routes.ts) match against the full
`req.url` rather than the stripped path. So even the routes that arrived were one
refactor away from 404ing, for a reason nobody would find.

**Why it was written that way.** Because the filename reads like documentation.
`[...path]` is a widely-recognised Next.js idiom and the assumption that it
travels to plain `api/` functions is the kind that never gets checked, because
checking it feels like checking that `+` adds.

**How it was caught.** GPT Sol, in review, before the deployment demonstrated it —
by reading Vercel's own `detect-builders.ts` rather than its documentation. The
finding was then confirmed against the live deployment rather than taken on
trust, which is how the query-string half turned up too.

**The fix.** An explicit rewrite in [vercel.json](../../vercel.json) carrying the
real path in `__spy_path`, and `originalUrl` in
[`src/vercel.ts`](../../src/vercel.ts) reassembling `req.url` before anything
routes on it. That puts a client-influenceable string in front of the router, so
[`tests/vercel-url.test.ts`](../../tests/vercel-url.test.ts) pins the two cases
that matter: a **second** `__spy_path` supplied by the caller is refused rather
than resolved, and the capture is decoded **exactly once**.

That decode has a small lesson of its own. The first version deliberately kept
the value raw, reasoning that `%` is legal in the slug patterns and decoding
would corrupt them. That was backwards — Vercel encodes exactly once, so decoding
is its inverse and a literal `%` arrives as `%25` — and keeping it raw made every
multi-segment route answer `No API route for /api/jobs%2Fabc%2Fretry`, which
reads like our bug and is not. **A guess about someone else's encoding is worth
one measurement.**

## 3. The runtime has `require(ESM)` turned off, and no laptop can reproduce it

**Cause.** `jsdom` → `html-encoding-sniffer` (CommonJS) → `@exodus/bytes` (ESM).
The deployed function threw `ERR_REQUIRE_ESM` on load.

The interesting part is the negative result. That require **works** on Node 22,
24 and 26 — all three tested locally, including the same 24.x the function
reports. So the difference is in Vercel's runtime rather than in the code or the
Node version, and **nothing that runs on this laptop will ever reproduce it.**
`NODE_OPTIONS=--experimental-require-module` restores it.

Two fixes were tried and rejected first, and both are worth recording because
they look right. Bundling `html-encoding-sniffer` did nothing, because `jsdom`
resolves its own copy from `node_modules` at runtime — the chain has to be broken
where it starts, not where it ends. Bundling `jsdom` itself failed outright with
`ERR_AMBIGUOUS_MODULE_SYNTAX`, which the config file had already predicted in a
comment.

**What made it findable.** [`api/index.js`](../../api/index.js) imports the
compiled handler **inside** the request handler, in a `try`, rather than at
module level. A module-level import that throws takes the function down before
any of our code runs, and the platform answers `FUNCTION_INVOCATION_FAILED` with
the reason nowhere — not the build log, not `vercel logs`, not the API. Moving
the import inside cost one `await` on a cold start and turned three hours of
guessing into one stack trace. **On a platform whose failure mode is an opaque
500, the first thing to build is the thing that makes failures speak.**

## 4. The protection was on, reported itself on, and left the site public

**Cause.** Vercel Authentication was enabled with
`deploymentType: "prod_deployment_urls_and_all_previews"`, the only value the Pro
plan accepts. The API accepted it and reported it back. But Vercel counts
`<project>.vercel.app` as a **production domain**, not a production deployment
URL, and production domains cannot be SSO-protected on Pro at all. So
`spideryarn.vercel.app` served the entire app — including the button that spends
`ANTHROPIC_API_KEY` — to anybody, for about twenty minutes, with the protection
switched on.

It was caught by `curl`ing the site expecting a redirect and getting `200` with
the real HTML. The setting was never going to admit it.

**The fix** was to remove the domain, so the only URLs that exist are the ones
the protection does cover. The real fix is
[the beta gate](../plans/deploy-and-repo-move.md#the-beta-gate).

**The lesson**, which is the same as the other three: *a control that reports
itself as enabled has told you about its configuration, not about its effect.*
The only question worth asking is what an unauthenticated request actually gets.

## What it looked like from the outside, which was its own bug

While all of the above was true, a browser session was sent to look at the site
and reported what the homepage actually said:

```
Unexpected token 'A', "A server e"... is not valid JSON
```

with **nothing in the console**. `"A server e…"` is the first ten characters of
Vercel's plain-text 500, and `The page c…` — which `/read/<slug>` showed — is its
404. So a reader hitting a completely dead backend was shown a JavaScript
parser's complaint about the first character of an error page, and whoever went
looking in devtools found an empty console.

The cause was a fifth instance of the same habit, in the client this time.
Twelve call sites had each written:

```ts
const body = await r.json();
if (!r.ok) throw new Error(body.error ?? r.statusText);
```

which parses **before** it checks. That second line is careful, correct, and
unreachable whenever the failing reply is not JSON — which is exactly when a
reader most needs it. The error handling was not missing. It had been written and
then placed where it could never run.

Fixed in [`src/web/lib/api.ts`](../../src/web/lib/api.ts): read the text once,
then decide; never put a response body in a user-facing message; log every
failure once. [web-client.md § Reading an API
response](../project/web-client.md#reading-an-api-response) has the reasoning,
[`tests/web-api.test.ts`](../../tests/web-api.test.ts) pins it with the real
bodies.

**The general form is worth naming**, because it is not the same as a missing
check: *error handling that runs after the thing that fails*. It is invisible in
review — the code reads as thorough — and it only shows up when the error path is
actually taken.

## What to change about how we work

- **Ask what the artefact does, never what the tool said.** Four green statuses,
  four broken deployments. The check that worked every time was the cheap one:
  fetch the URL and look.
- **Build the diagnostic before the feature, when failures are opaque.** Two of
  these four were invisible until `/api/health` and the in-handler `try` existed.
  Both took minutes to write and each paid for itself immediately. `/api/health`
  is now deliberately hard to please — anything in `warnings` makes it 503 —
  because its previous version returned 200 for the wrong store, unverified TLS,
  and an empty database.
- **A cross-family review before deploying, not after.** GPT Sol found #2 by
  reading Vercel's source, and also found the `pg`-discards-your-`ssl`-object trap
  that has not bitten us yet. That review cost one command. See
  [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md).
- **Write down the negative results.** "Bundling jsdom does not work" and
  "require(ESM) works on 22, 24 and 26 locally" are both facts that would
  otherwise be rediscovered the expensive way.

## Should anything be re-architected?

**Not yet, and here is the specific thing to watch.** The function currently
loads `jsdom`, `@mozilla/readability` and the whole ingest pipeline because
[`src/routes.ts`](../../src/routes.ts) imports them statically — and
[`src/sanitize.ts`](../../src/sanitize.ts) builds a `JSDOM` at module load, so
they cannot simply be made lazy. None of it can run on Vercel anyway: those are
write-side stages that need a durable disk. Cause #3 is entirely a consequence of
carrying that weight.

When the ingest queue moves to Postgres
([postgres-migration.md](../plans/postgres-migration.md) step 9), the read path
and the write path should stop sharing one bundle. Until then, `NODE_OPTIONS` is
a one-line workaround for a dependency the deployed function never calls, and
that is the honest description of it.

## See also

- [deployment.md](../project/deployment.md) — what is deployed and how
- [silent-success.md](../reusable/silent-success.md) — the pattern, and a dozen
  other instances of it
- [linting.md](../project/linting.md) — the other tool TypeScript 7 broke
- [database.md § Roles](../project/database.md#roles) — the part that has not
  been done yet
