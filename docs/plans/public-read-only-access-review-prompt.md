# Review request: public read-only access

You are reviewing a **plan**, before any code is written, for the Spideryarn repo (TypeScript + ESM,
React on the client, Drizzle ORM over Supabase Postgres, deployed to Vercel). Spideryarn is an
AI-assisted reading app: you paste a URL, a pipeline extracts the article and generates a tree,
summaries, a glossary, "ideas" and a tweet thread over it, and you read the article at whatever
level of detail you want.

**The plan is `docs/plans/public-read-only-access.md`.** Read it first.

Today the app refuses every anonymous API request and every signed-in reader sees only their own
articles. The plan adds a per-document "world-readable" switch so that a person with **no account**
can open a link and read the article plus whatever AI output has already been generated for it —
and can spend no money doing so.

## Read these, in this order

- `docs/project/auth.md` — the gate, and especially **§ Whose data is it**. Everything built on
  2026-08-27 was about making sure no signed-in reader can reach another's data; this plan
  deliberately opens a path that reads a row the requester does not own, for a requester who is not
  anybody.
- `src/auth.ts` — `requireUser`, `isAllowed`, and the `Verifier` seam.
- `src/owner.ts` — the request-scoped owner in `AsyncLocalStorage`, and why `currentOwnerId()`
  throws rather than falling back to the environment.
- `src/routes.ts` — `handleApi` / `serveApi`, roughly lines 2600–2800: where `requireUser` sits
  inside the `try`, the `setRequestOwner(user.id)` line under it, the `/api/admin/` prefix check
  above the route table, and how the ~40 routes are matched (some on `path`, some on `url`, i.e.
  some see the query string and some do not).
- `src/store/pg.ts` — `ownedSlug()`, `slugIsTaken()`, `ownedByReader()`, and the comments on each.
- `tests/owner-isolation.test.ts` — the test asserting no file under `src/store/` writes
  `eq(articles.slug, …)` outside `pg.ts`.
- `drizzle/0000_initial_schema.sql` and the later `drizzle/*.sql` — the `articles` table, the
  `articles_slug_unique` constraint, and the JSONB artefact columns on `article_revisions`
  (`tree`, `arc`, `tweets`, plus `glossary`, `summary` from 0002 and `ideas` from 0013).
- `src/web/App.tsx` around line 120–200 — the client's single signed-out gate.
- `vercel.json` — the site-wide `X-Robots-Tag: noindex, nofollow` and the SPA rewrite.
- `docs/reusable/silent-success.md` — the house rule about checks that pass while doing nothing.
- `docs/project/reader-profile.md` — `profileHash`, and how a reader's private profile shapes
  generated artefacts.

## Context you should trust rather than re-derive

Established by reading the code today, 2026-08-27:

- Every AI artefact that is *about the article* is a JSONB column on `article_revisions`. Everything
  that is *about the reader* has its own table keyed by `article_id` (`comments`, `chat_threads`,
  `chat_messages`, `search_runs`, `glossary_lookups`) or is a column on `articles` (`purpose`).
- `articles.slug` is **globally unique across all owners**. One row per slug. `slugIsTaken()` exists
  so `beginRevision` can refuse a second owner by name.
- `article_revisions.status` already takes the value `'published'`, meaning *the pipeline finished*.
- Every route that spends money at a model provider is a POST. Every GET is a pure read of something
  a pipeline step already wrote. (`POST /api/similar/:slug` carries a long comment saying this was
  made a POST precisely so that crawlers and prefetchers cannot pay for it.)
- There is no RLS. Authorisation is entirely in the queries.
- There is no spend limit of any kind. `docs/project/auth.md` § What is not done says so.

## Decisions already made by the owner — do not relitigate, but do tell me if one is dangerous

1. A public visitor sees the **full article prose**, not a scaffold.
2. A public link should be a **marketing surface** (link previews, indexable pages), not a private
   one-to-one handoff.
3. **Zero AI spend** for logged-out visitors now; a small metered budget is a later stage.
4. Storing default-prompt *and* personalised variants of an artefact side by side is a **long-term
   goal, not v1**.
5. A public visitor sees **none** of the owner's comments, chats or searches.
6. The public page says **nothing about the owner**.
7. `<link rel="canonical">` points at **the original article**.
8. The switch is **off by default, per document, ticked by hand**, behind a confirmation.

## What I want from you

Be concrete and sceptical. Cite `file.ts:line`. Rank findings, and lead with anything that is a
blocker.

1. **The seam.** The plan proposes a `/api/public/` prefix matched *above* `requireUser`, with its
   own closed list of GET handlers, a second predicate `publicSlug(slug)` living beside `ownedSlug`
   in `pg.ts`, and **no owner ever set** on the request (so `currentOwnerId()` keeps throwing).
   The rejected alternative was resolving the slug to its owner and calling `setRequestOwner` so
   every existing handler could be reused. Is the chosen shape right? What specifically goes wrong
   with a prefix check here — case, `//api/public`, percent-encoding, a trailing `?` when a route
   matches on `url` rather than `path`, `handleApi` being reachable by a path that does not start
   with `/api/`, path traversal in the slug capture (`slugPart` exists for this and there was a
   confirmed traversal here once)?

2. **What leaks that I have not listed.** The plan says the public payload must carry no personal
   field and proposes a key denylist over the serialised JSON. Go and look at what
   `GET /api/article/:slug`, `/api/metadata/:slug`, `/api/summary/:slug`, `/api/glossary/:slug`,
   `/api/ideas/:slug` and `/api/tweets/:slug` actually return today (`src/api.ts` and friends). Name
   every field that would leak something about the owner or about their reading if those responses
   were served verbatim to a stranger. I expect at least: `purpose`, `profileChanged`/`profileHash`,
   anything job- or upload-related, anything with an owner id in it. What else? Is a denylist the
   wrong shape — should it be an allowlist projection instead?

3. **Fail-open modes.** Every realistic bug here opens the gate rather than closing it. Where are
   they? Consider: the public prefix check running before the `try` (the admin check's own history
   is instructive), a public route that falls through into the main route table, `visibility`
   defaulting wrong in a migration, a `NULL` visibility comparing as neither public nor private, the
   Drizzle query builder dropping an `and()` clause, the client's plain `fetch` being replaced with
   `apiFetch` by a well-meaning refactor so the anonymous path stops being exercised.

4. **The tests.** The plan's § How we prove it lists six checks, each with a control that proves it
   can fail. Are they the right six? What is missing? In particular I want the "every route not on
   the public list refuses an anonymous request" test to be **enumerated from the route table** so a
   route added next month is covered without anybody remembering — is that actually achievable
   given how `serveApi` matches routes, or is it wishful?

5. **Stage 1 vs the rest.** Is stage 1 as described genuinely shippable and coherent on its own?
   Is anything in stage 2, 3 or 4 in fact a prerequisite that I have mis-sequenced? I am
   particularly unsure whether the global `X-Robots-Tag: noindex` staying on in stage 1 is right,
   and whether the stage-2 server-rendered head is a bigger job than the plan implies given
   `vercel.json`'s current rewrites.

6. **The slug-uniqueness question.** Stage 3 proposes splitting `articles` into the work and a
   `shelf_entries` relationship table. Is that the right long-term shape? Is there a cheaper move
   that unblocks "sign up and this doc lands on your shelf" without that migration? Is anything in
   stages 1–2 going to make stage 3 harder than it needs to be?

7. **The variant table.** Stage 4 proposes `revision_artefacts (revision_id, kind, profile_hash) → jsonb`
   replacing the six JSONB columns. Does that work given how `existingFor` and `profileIsStale`
   behave in `src/glossary.ts` and `src/profile.ts`? What breaks?

8. **Anything I have not thought of.** Abuse and rate limiting on unauthenticated GETs; caching a
   response that could become private a second later; the `Vary` header; whether a public document
   being switched off should invalidate a CDN cache and how; referer leakage; whether serving a
   third party's full article text from our origin creates a problem the plan has not named.

Do not write code. Do not edit any file. Answer in prose with a ranked findings list.
