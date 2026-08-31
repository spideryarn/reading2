# Input request: how to build stage 2 of public read-only access — the link looks like something

**Design input before any code is written.** Not a review. Spideryarn is TypeScript + ESM, React on
the client, Drizzle ORM over Supabase Postgres, one serverless function on Vercel.

You have advised on this feature five times and every finding was adopted or checked and answered.
**Stage 1 shipped on 2026-08-28**: a stranger can read a shared article, its glossary, summaries,
ideas and tweet thread, through a closed `/api/public/` namespace with allowlist DTOs.

## Read first

- `docs/plans/260827ai-public-read-only-access.md`, and **§ Stage 2 — the link looks like something** in
  particular. That section is your own list from 2026-08-27, adopted whole. This prompt asks how to
  build it, not whether.
- `vercel.json` — the two rewrites, and the site-wide `headers` block.
- `src/vercel.ts` — `handler`, `serve`, `originalUrl`, and the `/api/health` short-circuit that is
  the existing precedent for a path handled before `handleApi`.
- `vite.api.config.ts` — how the function is compiled, and its `define` block, which compiles the
  build stamp in as constants rather than reading the environment at request time.
- `vite.config.ts` — the client build and the `spideryarn-build-stamp` plugin.
- `index.html` — the shell as written; `dist/index.html` is the same file with Vite's hashed
  `<script>` injected.
- `src/public/dto.ts`, `src/public-types.ts`, `src/store/public-reader.ts` — what a public read can
  see today.
- `src/urls.ts` — `isWebUrl`, `hostOf`, and the unexported `hasCredentials`.
- `src/extract.ts` and `src/pdf-read.ts` — the two private, near-identical `escapeHtml` copies.
- `docs/project/security-map.md` — the four untrusted parties. The extracted content and the model's
  output are two of them, and a `<head>` is a new sink for both.
- `docs/reusable/silent-success.md`.

## What is being built

**Every shared link currently previews as nothing.** `/((?!api/).*)` rewrites everything to a static
`index.html` whose `<title>` is the bare word *Spideryarn*, and `src/web/page-title.ts` sets the real
title after React mounts. A crawler and an unfurler both read the first response and neither runs our
JavaScript.

So: `/read/:slug` served by the function, with the head filled in from the database — `<title>`,
`<meta name="description">`, `og:*`, `twitter:card`, `<link rel="canonical">` — **serving the real
built shell with the hashed asset references Vite produced**, and a per-request `X-Robots-Tag`.

Not in scope: forking or multi-reader articles (stage 3), variants or metered AI (stage 4), caching
of any kind, and any body HTML. *"The function must not become a second renderer."*

## What I want from you

Concrete and opinionated, numbered to match. Assume the reader is an Opus subagent who will build
exactly what you specify and has none of this conversation.

1. **How does the function get the built shell?** This is the one thing the plan does not settle.
   `vercel.json`'s `functions` block includes only `certs/**`, so `dist/index.html` is not obviously
   on the function's filesystem at runtime, and settling that needs a deployment.

   **My proposal, which I want you to attack or confirm:** don't rely on the filesystem at all.
   `vercel.json`'s build command is `npm run build && npx vite build --config vite.api.config.ts` —
   the client build finishes before the API build starts, so the API build can *read* `dist/index.html`
   and compile it in as a `define` constant, exactly as `vite.api.config.ts` already does for the
   build stamp. No `includeFiles`, no runtime file access, no deployment needed to know whether it
   worked, and it cannot go stale because it is read from the real build output every time.

   What breaks about that? Local dev has no `dist/` — what should the constant be then, and how does
   `/read/:slug` behave in dev, where Vite's own middleware already serves the shell? And what is the
   check that proves the compiled-in shell matches the deployed one rather than a stale build?

2. **Where does the route hook in?** `serve()` in `src/vercel.ts` special-cases `/api/health` before
   `handleApi`, and that is the existing precedent. But a `/read/:slug` request only reaches the
   function at all if `vercel.json` gets a rewrite ahead of the SPA catch-all. Give me both halves:
   the exact rewrite entry and where in the array, and the exact branch in `serve()`. Does it go
   through the `__spy_path` mechanism `originalUrl()` already decodes, or does it need its own?

3. **The site-wide `noindex` is a header rule, not a rewrite, so it fires on `/read/:slug` whatever
   the function does.** The plan says `X-Robots-Tag` becomes dynamic, decided per request. How, given
   a static `headers` block that Vercel applies independently? Narrow the `source` so `/read/` is
   excluded and let the function own it entirely? And how do I prove on a real deployment that there
   is exactly one `X-Robots-Tag` on the response rather than two disagreeing ones — which is the
   failure mode where a private article gets an `index` header appended after a `noindex`?

4. **What goes in the head, field by field**, and where each comes from. Two specific questions:

   - **Description: root gist or `excerpt`?** The plan says the root gist. But `PublicMeta.excerpt`
     is Readability's own one-or-two sentences from the page, which is the conventional
     meta-description source, and a gist is written for the granularity-zoom UI rather than for a
     preview card. Which, and why? Is the answer different for `og:description` than for
     `<meta name="description">`?
   - **Canonical.** The original article URL is `meta.url` — `final_url`, after redirects — and it is
     deliberately **not** in the public DTO today because it can carry credentials or signed query
     parameters. Stage 2 needs it. What is the exact policy: `isWebUrl` plus a credentials check plus
     what else? Strip the query string entirely? And does the canonical go in the public DTO (so the
     client can show it too) or only in the head?

   Also: is there an `og:image` at all in stage 2, given we have no image to serve and the article's
   own lead image is a third-party URL we would be vouching for?

5. **A private slug must get the default head**, and its title must not leak through a meta tag. That
   is the 404-not-403 rule in a place nobody thinks to look. What does the function actually serve
   for a slug that is private, does not exist, or is malformed — the unmodified shell with a 200, or
   something else? Bear in mind the SPA behind it renders `LandingPage` for a stranger, so the status
   code and the body have to agree with what React will do a moment later.

6. **Escaping.** There are two private `escapeHtml` copies, one escaping five characters and one
   four, neither exported. Do I extract a shared one, and if so where does it live and which
   character set? And: escaping is necessary but is it sufficient here — what about a title
   containing `</title>`, a newline, a very long string, or a right-to-left override? Name the checks
   and the mutation that makes each one red.

7. **How do I test any of this without a deployment?** The head is assembled by a pure function, so
   that part is easy. What I do not know how to check locally is the rewrite ordering, the header
   collision, and whether the compiled-in shell is the deployed shell. Which of those genuinely
   require a deploy, and for each, what is the smallest deployed check — a curl against a preview URL
   asserting what, exactly?

8. **`localStorage` reader state for anonymous visitors** is also stage 2 in the plan — scroll
   position, zoom depth, which panel was open, so a returning visitor lands where they were. Is that
   the same slice or a separate one? The known trap is that under vitest + jsdom, Node's own
   `localStorage` shadows jsdom's and reads as `undefined`, so a `try`/`catch` around it passes every
   test while storing nothing. What is the positive control that makes that visible?

9. **Cut lines.** You recut stage 1 from horizontal to vertical and you were right. Is stage 2 one
   slice or several, and what is the first independently shippable one?

10. **What am I not asking about that will bite?** Your call. Bots that do run JavaScript, the
    `Referrer-Policy: no-referrer` already set site-wide and whether it affects unfurlers, `Vary`,
    response size, the `%2F` slug case that is deliberately allowed through, what happens when an
    owner unshares an article that Slack has already unfurled.

## House rules that constrain the answer

- **A check nobody has watched fail is not evidence.** Every check you propose needs a positive
  control — the specific mutation that must make it red. Say the mutation, not "test it".
- **Allowlists, never denylists.**
- **Refuse rather than default.**
- **No public path spends money and none ever has an owner.**
- **Reader-facing strings live in `src/messages.ts`** and follow `docs/project/copy.md`.
- **`curl` returning 200 with the right `<title>` is not evidence the page works** — it did that for
  an entire afternoon while the site was blank. `docs/project/auth.md` records it.

Answer in markdown, numbered to match. Be direct about anything above that is factually wrong about
the code — that is worth more to me than agreement.
