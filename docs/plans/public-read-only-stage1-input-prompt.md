# Input request: how to build stage 1 of public read-only access

You are being asked for **design input before any code is written**, not a review of code. Spideryarn
is TypeScript + ESM, React on the client, Drizzle ORM over Supabase Postgres, deployed to Vercel.

You reviewed the plan for this feature yesterday and returned BLOCKED. The plan was rewritten against
your findings and every one of them was adopted. Read it first:

- `docs/plans/public-read-only-access.md` — **the plan**. Assume its eight decisions are settled;
  Greg made them and they are not up for relitigation.
- `docs/plans/public-read-only-access-review-sol.md` — your own previous review, for context on what
  has already been decided and why.
- `docs/project/auth.md` — the gate, § Whose data is it.
- `docs/project/security-map.md` — the four untrusted parties and where each defence lives.
- `src/routes.ts` — `handleApi` / `serveApi`, the admin prefix check, the one `requireUser` call, the
  `if` chain, `slugPart()`.
- `src/owner.ts` — the request-scoped owner, and why `currentOwnerId()` throws.
- `src/store/owned-slug.ts` and `src/store/pg.ts` — **note: `ownedSlug` moved out of `pg.ts` into
  `src/store/owned-slug.ts` on 2026-08-28**, after the plan was written, to close an import cycle.
  The plan is stale on that point. `pg.ts` re-exports it.
- `tests/owner-isolation.test.ts` — the static guard, which now exempts *two* files by name.
- `src/api.ts` — `loadArticle`, `articleMetadata`, `titleFor`.
- `src/store/contracts.ts` — the store interfaces.
- `src/web/App.tsx` — the whole client gate is one line.
- `docs/reusable/silent-success.md` — the house rule about checks that pass while doing nothing.

## What is being built now

Stage 1 only: *"send someone a link"*. No link previews, no indexing, no forking, no variants, no AI
for visitors. The intended split is two shippable slices:

- **1a — server.** The migration (`visibility`, `public_at`), an owner-only visibility endpoint,
  `publicSlug()`, the `/api/public/` namespace with its own dispatcher, the allowlist DTO
  projections for six read endpoints, `no-store`, `Referrer-Policy`, and the tests.
- **1b — client.** The two-step fetch (owned first when there is a session, public on 404), the
  capability seam that replaces "a `readOnly` prop", the read-only bar, the marked-not-hidden
  controls, the Access & Sharing card in Metadata, and a browser network-trace acceptance test.

## What I want from you

Concrete, opinionated answers. Where you would do it differently, say what and why. Where the plan
is already right, say so briefly and move on — I do not need it restated.

1. **Is 1a / 1b the right split, and is 1a independently safe to ship?** 1a with no client work means
   a live `/api/public/` namespace and a visibility switch with no UI to set it. Is there a smaller
   first slice that is independently valuable and lower-risk, or a different cut line entirely?
   Specifically: should the DTO projections and the route namespace land in one piece of work, or
   should the namespace land serving one endpoint (`article`) and grow?

2. **How do I actually get a structural boundary out of `serveApi`?** The plan promises
   `servePublicApi()` split from `serveAuthenticatedApi()`, so that the second is *callable only
   after `requireUser`* and a test can prove it. `serveApi` is one long function with a shared `try`,
   a shared `catch`, a shared `finally`, and a hundred-odd `if` branches over closed-over regex
   matches. Give me the **minimal-diff refactor** that produces a real boundary rather than a
   cosmetic one — what is the function signature, what does the authenticated half take as its first
   argument such that it cannot be called without a verified user, and what exactly does the test
   assert? A branded type? A required non-optional `user` parameter? Say which and why.

3. **Where does the public read code live so that it cannot import the writers?** The plan says a
   public read module that does not import `glossary.ts` / `summarise.ts` / the gateway. But
   `src/api.ts` imports the writers, and the public handlers need the same store reads. Do I need a
   parallel `src/public/read.ts` that talks to the store directly and duplicates some of `api.ts`, or
   should `api.ts` be split into `api-read.ts` / `api-write.ts` first? Duplication risks the two
   drifting; splitting risks a large diff through a 3000-line surface. Which, and what is the test
   that keeps it honest?

4. **`publicSlug()` — where, and what shape?** Given `ownedSlug` now lives in `src/store/owned-slug.ts`
   with `pg.ts` re-exporting it, and given the static guard exempts both files by name. Should
   `publicSlug` sit beside it in `owned-slug.ts` (and does that file then need renaming, which is a
   repo-wide hunt), or in its own file with the guard extended to three exemptions? And: is there a
   way to make the *type system* stop an ownerless request reaching an owner-filtered query, rather
   than relying on `currentOwnerId()` throwing at runtime?

5. **The store reads on the public path.** `pgArticleReader.loadArticle` runs `ownedSlug`. Do the
   public handlers get their own reader implementing the same contract, a parameterised predicate
   passed in, or something else? Name the risk in each. I am particularly worried about a shared
   helper that takes a predicate and is one careless call site away from being handed the wrong one.

6. **The visibility endpoint.** You said it should not be a field on `PATCH /api/library/:slug`.
   What method, what path, what body, what response? Idempotency, and what it does when the article
   is already in the requested state. Does the append-only visibility-change log land in 1a or is it
   deferrable, and if deferred what is the cheap thing that keeps the history?

7. **The smallest test set that would actually catch the real failure.** The plan has a
   thirteen-row table. If I could only write five of them for 1a, which five, and what is the
   positive control for each? I would rather have five tests that have each been watched to fail than
   thirteen that have not.

8. **What in this list is going to take three times as long as it looks?** Name the specific thing.

9. **Anything the plan still has wrong or has not thought of** — including anything that has changed
   in the repo since the plan was written yesterday.

Answer as a numbered list matching the questions above. Be concrete: name files, name functions, and
give the signature you would write. If you think the whole slicing is wrong, say that first and
plainly.
