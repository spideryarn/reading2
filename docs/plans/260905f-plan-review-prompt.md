# Review prompt — plan for the external link panel

You are reviewing a **plan, before any code is written**, for the Spideryarn repo you are sitting in.

Repo root is the worktree you are in; branch `worktree-external-link-panel`, forked from `dev`. No
code for this feature exists yet — the only new file is the plan itself.

## What to read

1. **`docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md`** — the plan under review.
2. `docs/project/links.md` — the existing hover card over hyperlinks. Sections that matter most:
   *What a browser can and cannot reach*, *The two things somebody can tell us*, *What is
   deliberately not built yet*, *Every link that leaves the app opens a new tab*.
3. `docs/research/260827a-link-previews.md` — the survey this plan is executing the last item of.
4. `src/web/ProseHoverCard.tsx` (`ExternalBody`, the foot, the `lookUpLinks` / `WithLinkFacts` seam),
   `src/web/link-facts.ts`, `src/web/link-preview.ts`, `src/web/useHoverCard.ts`.
5. `src/chat-tools.ts` § `readWebPage` — the mandated worked example for safe fetching.
6. `src/fetch.ts` § `fetchDocument`, `isBlockedAddress`, `parseTarget`, `pinnedAgent`.
7. `src/billing/admission.ts` (`withIngestSlot`), and `docs/project/billing.md` § *Which requests
   spend a slot*.
8. `src/db/schema.ts` — especially `checkpoints` (and the long comment above it about why it is
   article-scoped rather than globally content-addressed) and `glossaryLookups`.
9. `src/models.ts` — `Tier`, `QUICK_MODEL_OPENROUTER`, `TASK_TIER`, and the comment block about Luna's
   reasoning floor and `max_completion_tokens`.
10. `src/explain.ts` — the precedent for a model call in a request handler.
11. `AGENTS.md` (root; `CLAUDE.md` is a symlink to it) — the working agreements this plan must obey.

## What the feature is

Hovering an external hyperlink in article prose opens a card. This job adds:

- **Stage 1** — an "Add to Spideryarn" button in the card foot that ingests that URL onto the
  reader's shelf via the existing `POST /api/jobs {url}`, with progress shown in the card.
- **Stage 2** — a new authenticated `GET /api/link-preview?url=` that fetches the destination
  server-side (reusing `fetchDocument`), extracts title/description/first paragraph/word count, and
  caches it in a new **globally URL-keyed, ownerless** table.
- **Stage 3** — a GPT-5.6-Luna summary of the destination *relative to the article the reader is
  currently reading*, with the reader's profile as background, cached per `(owner, article, urlKey)`.

## Severity scale — use exactly these, and put an ID on every finding

- **P0** — will break production, lose or expose reader data, or spend money without bound.
- **P1** — a real defect or a design decision that will be expensive to reverse once built.
- **P2** — worth fixing, not blocking.
- **P3** — taste.

Format each finding as `[P1-3] <short title>` — a stable id per finding, so a second round can refer
to it. State the file and the specific claim. If you cannot substantiate a finding from the tree, say
so rather than asserting it.

**Do not change any file.** This is a read-only review. You may run a test file to check a claim.

## What I most want your judgement on

These are my own suspicions, listed last deliberately — please form your own view first and do not
treat this list as the scope.

1. **The two-cache split.** The plan argues a global URL-keyed table for the fetch and a
   per-(owner, article, url) table for the summary. `src/db/schema.ts`'s comment above `checkpoints`
   makes the opposite argument for that table — that a global row adds cross-reader sharing needing
   "its own argument about what a cache hit tells a stranger". Is the plan's § *Where the sharing
   stops* an adequate answer, or is there a disclosure I have not thought of? Is two tables right, or
   is there a way to do this with one without conflating the two lifetimes?
2. **Cost and abuse.** The fetch and the model call both fire on an open hover card (320ms of pointer
   rest), for any of ~70 links in an essay. There is **no inbound rate limiter anywhere in this
   codebase**. Is a per-reader limiter on cache misses sufficient, and what exactly should it be
   keyed on and sized at? Is there an unbounded-spend path I have missed — particularly around
   negative caching, redirects that land on a different `urlKey` than the one requested, or a URL
   that varies infinitely (query strings, fragments) and so never hits the cache?
3. **Not streaming the Luna call.** `AGENTS.md` says "Stream any model call a person is waiting on."
   The plan deliberately does not, for stated reasons. Is that defensible, or should stage 3 stream
   from the start?
4. **Stage 1's slot spend.** One press of a button in a hover card spends a metered ingest slot; a
   free-tier reader has three for life. `withIngestSlot` already guards `POST /api/jobs {url}`, so
   the wall is inherited. Is there anything about putting this front door in a *hover card* — which
   closes on pointer-out and is re-drawn constantly — that makes an accidental or double spend more
   likely than the Add box does? Note `billing.md` records a known-and-accepted double-click
   double-reserve.
5. **The card's lifecycle.** `ProseHoverCard` is torn down on pointer-out and by a `MutationObserver`
   when the prose re-renders. The plan says job progress must be read from the tab-level `jobEngine`
   singleton and never held in the card. Is that sufficient, and are there other bits of state in
   stages 2 and 3 that would be silently lost by that teardown?
6. **The owner gate.** Stages 1–3 must all sit behind the `lookUpLinks` / `WithLinkFacts` /
   `NO_LINK_FACTS` seam so a visitor on a public shelf gets none of it. Does that seam actually cover
   what I think it covers, and is there a path to the new route that bypasses it?
7. **Anything the plan asserts that the tree contradicts.** I built this plan partly from subagent
   reports. Check the load-bearing factual claims — particularly that `useJobs().add(url)` works from
   the reading view without navigation, that `shelf` in `link-facts.ts` is never refreshed, that no
   existing task is on the quick tier, and that `fetchDocument` + `readWebPage` really do cover the
   SSRF surface a new URL-taking endpoint opens.
