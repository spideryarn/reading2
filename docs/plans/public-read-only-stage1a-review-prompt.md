# Review request: the built code for stage 1a of public read-only access

You are reviewing **code that has just been written**, not a plan. Weight this review higher than a
plan-stage one: a plan review cannot find a handler that writes one field and rejects the request.

Spideryarn is TypeScript + ESM, React on the client, Drizzle ORM over Supabase Postgres, deployed to
Vercel. You have already given input on this feature twice, and both times it was adopted whole.

## Read, in this order

1. `docs/plans/public-read-only-access.md` — the plan. Its eight decisions are Greg's and settled.
2. `docs/plans/public-read-only-stage1-input-sol.md` — **your own design input from this morning.**
   The code below was written against it. Where the code departs from what you specified, I want you
   to judge whether the departure is better or worse, not to insist on your version.
3. `docs/reusable/silent-success.md` — the house rule. Most of this repo's bugs were something
   reporting success while doing nothing, with the obvious check agreeing because it shared an
   assumption with the code.
4. `docs/project/auth.md` § Whose data is it, and `docs/project/security-map.md`.

## The scope under review

Everything in the diff listed at the end of this file. This is the **server half of slice 1a**: the
migration, the visibility endpoint, `publicSlug`, the public reader, the public dispatcher, the DTO
projections, the `VerifiedUser` brand and the `serveApi` split, and the tests.

**Out of scope, deliberately, and not findings:** any client/React work; public endpoints for
glossary, summaries, ideas or tweets; link previews; `X-Robots-Tag`; canonical tags; caching beyond
`no-store`; rate limiting. Those are later slices and the plan says so.

## Two departures from your input, which I endorsed — tell me if I was wrong

1. **The public dispatcher is not handed `IncomingMessage`.** Your answer 2 sketched one shared
   envelope carrying `req` for both halves. The implementation gives the public half `{res, path,
   method}` only, so "the public routes ignore `Authorization`" has no way to be expressed rather
   than being a rule someone must remember. Is anything lost that I have not seen?
2. **`Allow` is set on the response, not attached to the thrown error**, because `serveApi`'s catch
   reads only `status` and `message`. Correct?

## What I want from you

Findings as a numbered list, each with a severity — **blocker / should-fix / consider** — and a
concrete change. Cite file and line. If the work is wrong in its bones, say so first and plainly.

Go hard at these in particular:

1. **Can anything reach an owner-filtered read, or a paid call, through `/api/public/`?** Trace it
   rather than trusting the tests. The runtime tripwire is that `currentOwnerId()` throws; tell me
   where that tripwire would not fire.
2. **Is the projection genuinely an allowlist?** Name any field that can reach a stranger that
   should not — including through a nested object, an array element, an error message, a log line,
   or a field added to an internal type next month.
3. **Is the `VerifiedUser` brand real or decorative?** Can it be forged, bypassed, or satisfied by
   an object that never went through `requireUser`? Is the runtime assert positioned where it
   actually runs?
4. **Is the `serveApi` split a real boundary or a cosmetic one?** Specifically: is there any path
   into the authenticated `if` chain that does not pass the gate, and does the single catch/finally
   still log and map both halves correctly?
5. **The migration and the visibility endpoint.** Fail-closed on every path? Transactional? What
   happens on a concurrent double-publish, on an already-in-state request, on a re-extraction, on a
   deleted article? Does the audit table record what an audit needs?
6. **The tests: which of them would pass against broken code?** This is the question I care about
   most. For each test, tell me the mutation to the source that it would *not* catch. Name any test
   that is asserting on a mock rather than on behaviour, or that shares an assumption with the code
   it checks.
7. **Anything the plan or my brief did not think of.**

## The diff under review

The tree contains several other agents' work in flight. **Review only these nineteen files**, at the
state they are in at commit `4bbed5d`. Anything you find outside this list is not this review's
business.

```
git diff --stat f6d5d98~1..4bbed5d -- \
  drizzle/0024_article_visibility.sql src/db/schema.ts src/auth.ts src/routes.ts \
  src/public-types.ts src/public/dto.ts src/public/routes.ts \
  src/store/public-slug.ts src/store/public-reader.ts src/store/pg-visibility.ts \
  src/store/contracts.ts src/store/index.ts src/store/owned-slug.ts \
  tests/public-dto.test.ts tests/public-imports.test.ts tests/public-reads.test.ts \
  tests/public-dispatch.test.ts tests/public-visibility-pg.test.ts tests/owner-isolation.test.ts
```

     drizzle/0024_article_visibility.sql |  35 ++
     src/auth.ts                         |  75 ++++-
     src/db/schema.ts                    | 114 ++++++-
     src/public-types.ts                 | 142 ++++++++
     src/public/dto.ts                   | 218 ++++++++++++
     src/public/routes.ts                | 230 +++++++++++++
     src/routes.ts                       | 475 +++++++++++++++++++--------
     src/store/contracts.ts              |  47 +++
     src/store/index.ts                  |  41 +++
     src/store/owned-slug.ts             |  14 +-
     src/store/pg-visibility.ts          | 110 +++++++
     src/store/public-reader.ts          | 358 ++++++++++++++++++++
     src/store/public-slug.ts            |  42 +++
     tests/owner-isolation.test.ts       |  86 ++++-
     tests/public-dispatch.test.ts       | 340 +++++++++++++++++++
     tests/public-dto.test.ts            | 351 ++++++++++++++++++++
     tests/public-imports.test.ts        | 196 +++++++++++
     tests/public-reads.test.ts          | 147 +++++++++
     tests/public-visibility-pg.test.ts  | 638 ++++++++++++++++++++++++++++++++++++
     19 files changed, 3509 insertions(+), 150 deletions(-)

**One thing about the history that will look wrong.** `src/routes.ts` is a shared file in a tree
several agents edit with no branches. Another agent's error-monitoring work was written *against*
this dispatcher split and could not compile without it, so they committed the file — carrying 338
lines of this work under their message, `89cd255`. Nothing was rewritten and nothing was lost. Do not
spend findings on commit boundaries; review the code as it stands.

## The state of the tree, measured by me

- `npm run typecheck`: **0 errors** across all three projects. The one complaint is a stray
  `rename-preview.tsx` belonging to no project — another agent's file, predating this work.
- `npm test`: 4532 of 4540 pass. The eight failures are in `tests/chat-error-scope.test.ts` (an
  untracked file belonging to another agent's in-flight React work) and `tests/store-jobs-parity.test.ts`
  (failing before this work started). I checked both against this slice and neither touches it.
- All seven of this slice's test files pass.
