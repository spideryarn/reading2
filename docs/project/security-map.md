# Security map

**Start here; [security.md](security.md) is the deep dive.**

**The untrusted parties here are not other readers.** Spideryarn is a small tool, and that normally
shrinks a security problem to nothing. It doesn't, because a reader is targeted every time they point
the app at somebody else's article. "Don't open untrusted documents" was never available as a
mitigation: opening them is the product.

[security.md](security.md) counts four untrusted parties, and it is worth being able to name them
before you touch anything:

1. **The content** — a stranger's HTML, or a stranger's PDF, rendered into our own origin.
2. **The URL** — every `/api/…` path segment is attacker-controllable, and three of them were joined
   onto a filesystem path unchecked.
3. **What the model returns** — model output rendered as text is fine; model output that becomes an
   `href`, a `src` or an `id` needs an allowlist.
4. **What the model asks us to fetch** — chat picks a URL and we go and get it.

Whoever signs in is a fifth party and is *not* untrusted. **There is no allowlist** — `isAllowed()`
returns true for anybody Supabase will vouch for, which is Greg's call and an accepted risk — and
**every reader gets their own shelf**, which is a separate guarantee that had not been built when
that risk was accepted. [auth.md](auth.md) has both halves, and the contradiction between them that
stood until 2026-08-27.

**This file is the map; [security.md](security.md) is the territory** — a long deep-dive with the
payload tables, the reasoning behind every policy line, and the honest gap list. Open it when you are
changing a defence; read this one when you want to know which defence you are standing on.

## The one habit

Nearly every hole here was hidden by [silent success](../reusable/silent-success.md): the check you
would naturally run returned the answer you hoped for, because it shared an assumption with the code.
A shallow path-traversal probe that lands on the fixture article looks exactly like a refusal. So
**prove the check can fail**, with a positive control, before believing it passed.

## The docs

- **[security.md](security.md)** — the deep-dive. What Readability does *not* strip (`<img onerror>`
  survives), why the article is sanitised twice and in which two parsers, the video-embed allowlist
  and why comparing a host with `includes` reopens everything, the confirmed path traversal and the
  fixture fallback that disguised it, the PDF parsed unsandboxed — and a **known gaps** list at the
  end, which is where to look if you want work.
- **[auth.md](auth.md)** — the gate. Why auth here is about an open proxy and an open wallet rather
  than user accounts, why Supabase Auth won, the four things to know before touching it (a 401 is
  not "the session is gone"; JWKS unreachable is a 503), **whose data is whose** now the shelf is no
  longer shared, and the one test that has to exist.
- **[admin.md](admin.md)** — the one request that reads across owners, and how narrow the exception
  is: one route, one path prefix, one address. Which of its three refusals is a gate and which two
  are courtesies, why the check is on the prefix rather than the route, and what the page
  deliberately does not show.
- **[deployment.md § Who can reach it](deployment.md#who-can-reach-it)** — the app is readable by
  anybody with the address, deliberately, and it was an accident first: Vercel's protection setting
  reports itself as enabled while serving the world.
- **[chat-tools.md § Security](chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)**
  — the fence around a stranger's web page, and the claim that was wrong: a read tool can still
  *send*, because a GET's URL is a channel.

Each of these owns a defence too: [fetching.md](fetching.md) (the scheme allowlist, the address
guard, the redirect limit, the size cap — everything else borrows them),
[content-extraction.md](content-extraction.md) (what stage 2 does and does not promise),
[ingest-queue.md](ingest-queue.md) (`/add/<url>` makes us fetch on arrival, not on a click),
[logging.md](logging.md) (never log prose, never log a secret),
[block-ids.md](block-ids.md) (the `id` attribute the sanitiser must not touch).

## Where the defences physically live

An agent about to edit one of these is editing a defence, not a helper.

| | |
|---|---|
| [`src/sanitize-policy.ts`](../../src/sanitize-policy.ts) | **one policy**: DOMPurify config, embed allowlist, hooks. Node-free, so both bindings share it |
| [`src/sanitize.ts`](../../src/sanitize.ts) | the server binding, called from stage 3 in [`src/blocks.ts`](../../src/blocks.ts) — cleans the stored artefact |
| [`src/web/sanitize.ts`](../../src/web/sanitize.ts) | the browser binding, at article ingress in [`App.tsx`](../../src/web/App.tsx) — guards the render |
| [`src/routes.ts`](../../src/routes.ts) | `slugPart()` for every capture that becomes a directory name; the one `requireUser` call |
| [`src/slug.ts`](../../src/slug.ts) | what a slug may be — two rules, one per question (mint? read?) |
| [`src/auth.ts`](../../src/auth.ts) | the gate: `requireUser`, and `isAllowed` |
| [`src/store/pg.ts`](../../src/store/pg.ts) | `ownedSlug()` — keeps one reader's shelf out of another's |
| [`src/fetch.ts`](../../src/fetch.ts) | scheme allowlist, `isBlockedAddress`, redirect limit, size cap |
| [`src/ingest.ts`](../../src/ingest.ts) | `normaliseUrl` — refuses literal private and loopback hosts before queueing |
| [`src/chat-tools.ts`](../../src/chat-tools.ts) | `isSlug` on the model's slug, URL-length cap on the model's URL |
| [`src/urls.ts`](../../src/urls.ts) | `isWebUrl` — what model output must pass to become an `href` |

The tests are the specification: `tests/sanitize.test.ts`, `tests/sanitize-client.test.ts`,
`tests/routes.test.ts`, `tests/slug.test.ts`, `tests/owner-isolation.test.ts`.

---

Up: [AGENTS.md](../../AGENTS.md)
