# Public read-only access: audit, and the improvements worth doing

**Started 2026-09-02.** Greg asked for an inspection of the public-readable feature — an owner marks
an article public in the sharing card, and anyone can read it and every artefact already generated,
without logging in, without changing anything and without spending anything — for edge cases, bugs,
product trade-offs and improvements, and then a plan. This is the umbrella doc that
[improve-the-codebase.md](../reusable/improve-the-codebase.md) asks for: everything found, each
finding with its evidence state, clustered and tiered, and an honest line on what is left.

> Inspect how the Public-readable approach works (i.e. where a user can mark an article as public,
> and then it's readable by anyone without logging in - but those other users can't make changes or
> incur costs). Consider edge cases, improvements, bugs, product tradeoffs, or any other
> questions/concerns/suggestions.
>
> — Greg, 2026-09-02

The feature's own plan is [260827ai-public-read-only-access.md](260827ai-public-read-only-access.md),
and this doc does not restate it. Read its decisions table and "What we are deliberately not doing"
first; nothing below re-proposes a thing that file rejected.

## References

- [260827ai-public-read-only-access.md](260827ai-public-read-only-access.md) — the plan, four stages,
  and the Progress log of what was built. Stages 1a, 1b and the first slice of 2 are built.
- [security-map.md § `/api/public/`](../project/security-map.md) — the one namespace with no gate,
  and where the allowlist lives.
- [auth.md](../project/auth.md) — the gate this feature makes a hole in.
- [260829b-hosting-the-articles-images.md](260829b-hosting-the-articles-images.md) — the storage half
  is built; the delivery half (a public asset route) is not, which is why public articles hot-link.
- [`src/public/routes.ts`](../../src/public/routes.ts), [`src/public/dto.ts`](../../src/public/dto.ts),
  [`src/public/page.ts`](../../src/public/page.ts), [`src/store/public-slug.ts`](../../src/store/public-slug.ts),
  [`src/store/pg-visibility.ts`](../../src/store/pg-visibility.ts) — the server.
- [`src/web/visitor.ts`](../../src/web/visitor.ts), [`src/web/reader-capability.ts`](../../src/web/reader-capability.ts),
  [`src/web/App.tsx`](../../src/web/App.tsx) (`findArticle`, `Reader`),
  [`src/web/AccessSharing.tsx`](../../src/web/AccessSharing.tsx) — the client.
- [260902j-public-read-only-access-audit-input-prompt.md](260902j-public-read-only-access-audit-input-prompt.md)
  and [-input-sol.md](260902j-public-read-only-access-audit-input-sol.md) — what was put to GPT Sol,
  and what came back.
- [-build-forks-prompt.md](260902j-public-read-only-build-forks-prompt.md) and
  [-build-forks-sol.md](260902j-public-read-only-build-forks-sol.md) — two things this plan had
  wrong, found while building it: the metadata route is not callerless, and C3 as written would
  have taken a world-readable article away from a signed-in reader. Both amended below.

## Scope line

**Swept:** `src/public/`, `src/store/` (the visibility and public-reader files, `owned-slug.ts`,
`find-article.ts`), `src/owner.ts`, `src/vercel.ts`, the dispatch and `parseVisibilityRequest` in
`src/routes.ts`, `src/urls.ts`, `src/db/schema.ts` and migrations 0024 and 0026, `vercel.json`,
`public/robots.txt`, `index.html`; all of `src/web/` that the visitor path can reach; every test
named `public-*`, `visitor-*`, `owner-isolation`, `access-sharing`; the plan and its nine review
docs; `docs/postmortems/`; the project docs that mention the feature.

**Run, not only read:** a black-box HTTP probe on 2026-09-02 against the local dev server and local
Supabase — one article flipped public, every public route and method, every authenticated route
unauthenticated, forged and borrowed tokens, traversal and encoding cases, enumeration timing, and
the public page served through the real Vercel handler on a throwaway port. The article was flipped
back; two rows are in the local `article_visibility_changes`.

**Excluded:** the deployed site and the production database (no Vercel credential on this box, and
not the place to probe). The `SPIDERYARN_STORE=files` 501 path. Load behaviour — nothing was run
under concurrency, so S4 below is a reading of the code, not a measurement.

**Blind to:** anything that exists only at runtime on Vercel — the header rules in `vercel.json`,
the rewrite that makes `/read/:slug` reach the handler at all. The probe found that **`npm run dev`
does not serve the public page** (every `/read/<slug>` is the default shell, 200, whether public,
private or absent), so the whole stage-2 surface is invisible to a black-box check of the dev server.

## What holds

Worth writing down so the next sweep does not redo it. Each of these was checked by reading the
code at the cited location and, where marked, by the probe.

- **No leak and no oracle.** The public article payload (209,509 bytes for the probe's article)
  carries `meta, blocks, tree, arc, glossary, ideas, tweets` and nothing about a person. The 404
  for a private slug and for an absent slug are the same sentence and, on the page, byte-identical
  HTML; medians for the two were 8.6 ms and 8.2 ms over 20 requests each. A valid owner token on a
  public route is ignored. Probed.
- **No spend.** `tests/public-imports.test.ts` proves the public import graph cannot reach a
  model-calling module, and the client mounts the paid hooks only inside `OwnedReader`, so for a
  visitor they are unreachable rather than skipped. Every authenticated route answered 401 with no
  article content. Probed.
- **The switch.** `parseVisibilityRequest` refuses extra keys, requires `rightsConfirmed` to be
  literally `true` on share and absent on unshare, and every malformed body got a 400 with a
  sentence. The write is owner-scoped, row-locked, transactional, idempotent, and a no-op transition
  cannot be logged. Probed.
- **Revocation is next-request.** `publicSlug` is a `where` on every read including the page head,
  and `Cache-Control: no-store` is set before dispatch so it covers every status. No `s-maxage`
  anywhere; no edge copy can outlive an unshare. Proved from code.
- **The static guard still counts.** `tests/owner-isolation.test.ts` greps `src/store/` for
  `eq(articles.slug`; there are exactly three live sites in all of `src/`, all sanctioned:
  `owned-slug.ts`, `public-slug.ts`, `slug-is-taken.ts`. Counted 2026-09-02.
- **No type drift.** `src/types.ts` changed five times since `dto.ts` was last touched; every
  field on the projected types is either projected or deliberately withheld. Diffed field by field.
- **Storage does not cross the login boundary.** The offline cache is keyed on user id and purged at
  sign-out; `publicFetch` never touches it. Proved from code.

## Findings

Severity and evidence state are separate columns on purpose
([improve-the-codebase.md](../reusable/improve-the-codebase.md)). *Proved* means read at the cited
location today; *probed* means reproduced by the HTTP probe; *hypothesis* means the code path reads
that way and nobody has made it happen.

### Server

| | Finding | Where | Evidence | Severity |
|---|---|---|---|---|
| S1 | **`assets` crosses the allowlist by reference.** The one field in the DTO passed through whole rather than rebuilt, one line below the comment explaining why nested objects must not be. The test fixture is typed `Assets`, not `Required<Assets>`, so a field added to `AssetEntry` reaches strangers with the suite green. Today's fields are the manifest version, `sourceHash`, `fetchedAt`, and per entry a URL, status, hash, format, content type, byte count, or a failure reason and timestamp. None is about a person. | `src/public/dto.ts:461`, `tests/public-dto.test.ts:211` | proved | medium, latent |
| S2 | **The page path runs outside `runInRequest`.** `serve()` calls `servePublicReadPage` directly; only `handleApi` opens the request box. Outside the box `currentOwnerId()` returns the environment owner rather than throwing, so the runtime tripwire security-map.md describes does not exist on `/read/:slug`. Held today only by the import-graph test. | `src/vercel.ts:309`, `src/owner.ts:240`, `tests/public-imports.test.ts:181` | proved | medium, latent |
| S3 | **Nothing consumes `assets`; every public article hot-links.** No public asset route, no caller of `assetIndex()` in `src/web/`, private bucket. A visitor's browser fetches every image and lazy embed from the publisher. `no-referrer` is both a Vercel header and a meta, so the publisher learns an IP and ordinary request metadata, and any cookies it already set, but not the Spideryarn URL. Greg accepted this on 2026-08-28. | `src/public/route-names.ts:74`, `src/assets.ts:308`, `index.html:69` | proved absence | medium, accepted |
| S4 | **No rate limit, no route-specific timeout, no response cap.** The database's own `statement_timeout` is two minutes for the application role ([database.md](../project/database.md)), which is far too loose to protect a pool; the pool is `max: 5` *per function instance*; `no-store` everywhere. One shared slug is a free, uncacheable, unbounded read of ~200KB, and a `HEAD` on the JSON route does the full read and serialisation too. Undecided in the plan since 2026-08-27. | `src/db/client.ts:67`, `src/store/public-reader.ts:399`, `src/public/routes.ts:104` | proved from code, not loaded | medium |
| S5 | **The audit table is write-only.** Migration 0026 made rows outlive a deleted article so a rights complaint could be answered; nothing in `src/` or `scripts/` reads them. | `src/store/pg-visibility.ts:118` | proved | low |
| S6 | **`OPTIONS` on the dev server answers 204 from Vite's middleware**, before our 405. Not a hole (no `Access-Control-Allow-Origin`), but a dev-only probe reports a method table production does not have. | probe | probed | info |
| S7 | **`npm run dev` cannot serve the public page.** See the scope line. Any future check of stage 2 against the dev server passes while proving nothing. | `src/vercel.ts:286` | probed | test gap |
| S8 | **The public metadata route has one caller, and it is not the client.** `loadPublicMetadata` is exported and unused; the client reads `available` off the article payload, and the comment saying the route stays for stage 2's link preview is false — previews read `loadHead`. The tests preserve a disagreement between it and the other two reads (metadata accepts a tree with no blocks). **Corrected 2026-09-02, mid-build:** the audit's ledger swept `src/`, `tests/` and `docs/` and not `scripts/`. `scripts/check-public-shell.ts` calls the route deliberately, as the independent second opinion its deployed-head check compares a `<title>` against. So the deletion has to carry that check with it — see Cluster B. GPT Sol's finding; all four audits missed the route, and the first ledger missed its one caller. | `src/web/public-api.ts:108`, `src/web/App.tsx:632`, `src/store/public-reader.ts:504`, `tests/public-reads.test.ts:246`, `scripts/check-public-shell.ts:297` | proved | deletion |
| S9 | **Vercel caps a function response at 4.5 MB** (proved: its documented limit), and `loadHead` checks the tree and blocks exist but never the payload size (proved), so it would advertise as readable an article the transport then refuses. Whether any stored article crosses the line, and what the deployed failure looks like, is the hypothesis. Not public-specific. GPT Sol's finding. | `src/store/public-reader.ts:551` | proved limit, hypothesis reach | low, unmeasured |

### Client

| | Finding | Where | Evidence | Severity |
|---|---|---|---|---|
| C1 | **A dead button on every paragraph.** The gutter's "Chat about this paragraph" renders for a visitor and the press is swallowed. The comment calls it deliberate; it contradicts "a button that can only fail is worse than no button" in the same feature. | `src/web/BlockGutter.tsx:305`, `src/web/App.tsx:2312`, `src/web/Masthead.tsx:88` | proved | medium |
| C2 | **Referee's visitor sentence uses the raw mode id.** The fail-closed fall-through passes `mode` where `ownersOnly()` expects a product noun: "referee is for whoever added this article…", in the band and the dock tooltip. The test knows referee reaches the fall-through and asserts nothing about wording. | `src/web/visitor.ts:220`, `src/messages.ts:1321`, `tests/visitor-gaps.test.ts:233` | proved | medium-low |
| C3 | **An owner whose token cannot be refreshed becomes a visitor.** `findArticle` falls back to the public route on 401 as well as 404. On their own public article they see "View only" (not the sign-up pitch, which `SharedNotice` hides while `signedIn`); on a private one, "Not shared". `useSession` still says signed in, so nothing re-asks. | `src/web/App.tsx:625`, `src/web/lib/api.ts:437` | proved from code | medium |
| C4 | **The network-trace test's mode sweeps are literal lists** omitting plain, hierarchy, outline, quotes, timeline and referee — the two newest modes have never been pressed in a visitor trace. `markedModes` derives from `MODES` so a new mode cannot be missed; the test that guards it does not. | `tests/public-network-trace.test.tsx:485`, `:806` | proved | test gap |
| C5 | **Unshare mid-session changes nothing for a visitor** until reload. No post-load fetch on the visitor path; the article is keyed on slug, not view. The plan's first open question. | `src/web/App.tsx:748` | proved | product call |
| C6 | **Sharing-card copy.** `SHARING_UNKNOWN` says "reload the page" for a state that is permanent on the files store; `CopyLink` fails silently without `navigator.clipboard`. | `src/messages.ts:1518`, `src/web/AccessSharing.tsx:418` | proved | low |
| C7 | **A second definition of "visitor".** The masthead reads `onRenamed === undefined` rather than the capability. Correct today because `OwnedArticle` always passes it. | `src/web/Masthead.tsx:167`, `:248` | proved | low, latent |

### The trap ahead of stage 3

`comments`, `chat_threads`, `chat_messages`, `search_runs` and `glossary_lookups` carry an `owner_id`
that is written and never read; isolation rests on the invariant that a child's owner equals its
article's owner, which nothing enforces. The moment two readers share one `article_id`, those
tables leak into each other. Any "save this to my shelf" — including the bookmark-table interim the
original review suggested — has to be built so it cannot become that. Named here, sized as a Tier 3
job, not started.

## Decisions

Four questions went to Greg on 2026-09-02 with GPT Sol's recommendation attached to each. His answers,
and where they differ from the recommendation:

| Question | Sol recommended | Greg decided |
|---|---|---|
| Images: the manifest nobody reads, and the hot-linking | Stop sending `assets` to visitors; defer the route | **Build the public asset route now** — the delivery half of [260829b](260829b-hosting-the-articles-images.md), stages C, D and E |
| Indexing: stage 2 slice 2 | Delete it | **Delete it.** The marketing surface is link previews and word of mouth, not search |
| Rate limiting | Vercel WAF, log mode first | **Vercel WAF, log mode first.** Configured in the dashboard, by Greg — this box has no Vercel credential |
| Later additions | Badge yes, save-to-shelf yes, unlisted no | **Badge and save-to-shelf.** Not unlisted |

Sol's other calls, adopted without a question because they are engineering rather than product:

- **Delete the public metadata API.** `GET /api/public/metadata/:slug` has no production caller —
  the client learned which artefacts exist from the article payload on 2026-08-28, and the comment
  saying the route stays "for stage 2's link preview" is false: previews read `loadHead`. Deleting it
  also deletes a disagreement the tests currently preserve, where metadata accepts a tree with no
  blocks and article and head refuse one. The public metadata *page* is unaffected; it renders from
  the article. The best deletion-test result of the audit, and all four audits missed it.
- **C3: fall back to the public route only on 404, and a final 401 becomes its own state.** A 401
  after the one refresh is, in `apiFetch`'s own words, not proof the session is gone, so no
  automatic sign-out. But the existing error path is a logo and a `<pre>` with no action, and a
  link to `/login` would bounce a signed-in reader straight back to the shelf (`App.tsx`'s login
  route does that on purpose). So `ArticleAccess` gains a `reauth-required` member with a
  user-initiated sign-in-again action. Sol's plan review, which blocked on this.

  **Amended 2026-09-02, mid-build** ([-build-forks-sol.md](260902j-public-read-only-build-forks-sol.md)).
  `findArticle` only asks the owned route when there is a session, so the 401 arm also catches a
  *signed-in reader on somebody else's public article* whose own token has died — the feature's own
  likeliest first real user. Refusing them a world-readable article because of an unrelated broken
  session couples two independent things, and a 401 says nothing at all about the public
  entitlement. So the state is decided by **both** answers:

  | owned | public | what the reader gets |
  |---|---|---|
  | 404 | 200 | the shared article, as today |
  | 401 | 200 | the shared article, **and a notice that the session could not be confirmed**, with *Continue signed out* |
  | 401 | 404 | `reauth-required`, with *Sign in again* |

  Owner capabilities mount in neither 401 case. This is better for the owner too: the C3 complaint
  was that the reclassification was **silent**, and the owner of a public article now keeps reading
  it while being told why it went read-only, rather than being locked out of their own piece.

  **Both actions are `supabase.auth.signOut({ scope: "local" })` followed by a reload of the same
  address, and the labels differ because the outcome does.** Signed out at `/read/:slug` the app
  does not show sign-in — it goes straight back through `ArticlePage` (`src/web/App.tsx:301`). So on
  a shared article the reload returns the reader to the shared article as an ordinary visitor,
  which is *Continue signed out*; on an unshared one it reaches `LandingPage`, which draws the
  sign-in controls itself and keeps the address, so signing in lands them back here — which is
  *Sign in again*. Calling the first one "sign in again" would be a button that does not do what it
  says. Sol's correction; verified against `LandingPage.tsx` and `auth-return.ts`.
- **C7 is not a bug.** `onRenamed` *is* a capability — a function the owner has and a visitor does
  not — and a second `visitor` prop beside it would be two facts that can disagree. Leave it.
- **S5: no reader for the audit table.** SQL when a complaint arrives; a script only if that
  repeats.
- **C5, revocation: do nothing.** New requests stop at once; bytes already downloaded cannot be
  recalled, and a focus-time re-check is cosmetic rather than authorisation. Recorded as decided;
  the open question in the feature plan closes.
- **C6: defer.** Both copy problems are real and below the bar while the files store is
  transitional.

## Tiers and clusters

Scored on effort, value and risk as [improve-the-codebase.md](../reusable/improve-the-codebase.md)
asks; value and ease pick the order, risk can veto. Nothing in Tier 0 — the probe tripped over no
live defect.

### Tier 0 — reachable defects a visitor or an owner can see. Stage 1.

**Cluster A: the client edges.** Effort small, value real (visible to every visitor), risk none.
Sol's plan review moved C1 to C3 up from Tier 1: they are reachable UI defects, not cleanup, and C4
travels with them as their defence. **Stage 1 on its own**, built after the `reauth-required` state
is designed, and reviewed on its own.

- C1 — do not render the gutter chat button for a visitor. Red test first: the network-trace suite
  asserts the button is absent for the visitor arm.
- C2 — `referee: "Referee"` in `COSTS`, and a wording assertion in `tests/visitor-gaps.test.ts` that
  the fall-through can no longer be reached by a live mode (the test currently knows it is).
- C3 — `findArticle` stops treating a 401 as a 404. It asks the public route either way and lets
  **both** answers decide, per the table under Decisions: 401 + public 200 is the shared article
  with a session-unconfirmed notice and *Continue signed out*; 401 + public 404 is a new
  `{ kind: "reauth-required" }` with *Sign in again*. Red tests: a 401 over a public article
  renders the notice and no owner request; a 401 over a private one renders the sign-in-again
  action and neither the public fallback nor `View only`.
- C4 — both sweeps in `tests/public-network-trace.test.tsx` driven from `MODES` and from the rendered
  radio buttons, so the newest mode is pressed without anybody remembering to add it.

### Tier 1 — cheap, mechanical, evidence in hand. Stage 2.

**Cluster B: the server deletions and the one-line defence.** Effort small, value is fewer parts,
risk low. A separate stage from A, so that a broad deletion, a request-scope change and a doc
correction are reviewed apart from client state work.

- Delete the public metadata route. **The ledger, counted 2026-09-02** — every file naming
  `PublicMetadata`, `loadMetadata`, `loadPublicMetadata`, `publicMetadata` or `public/metadata`,
  excluding `PublicMetadataPage`, which is the `/read/:slug/metadata` UI and stays:

  | File | Refs | What |
  |---|---|---|
  | `src/store/public-reader.ts` | 9 | `loadMetadata`, its interface line, comments |
  | `tests/public-visibility-pg.test.ts` | 8 | HTTP and store cases |
  | `scripts/check-public-shell.ts` | 8 | **the route's one real caller** — see below |
  | `tests/public-client-fetch.test.ts` | 7 | loader and client-path cases |
  | `tests/public-network-trace.test.tsx` | 4 | fixture, mock, comments |
  | `src/web/public-api.ts` | 4 | `loadPublicMetadata` |
  | `src/public/dto.ts` | 4 | the `publicMetadata` builder |
  | `src/web/PublicPages.tsx` | 3 | comments only |
  | `src/public-types.ts` | 3 | the type |
  | `tests/public-dto.test.ts` | 2 | |
  | `src/web/public-artefacts.ts` | 2 | stale route explanation |
  | `src/web/App.tsx` | 2 | the false "stays for stage 2" comment |
  | `tests/visitor-gaps.test.ts`, `tests/public-reads.test.ts`, `src/web/reader-capability.ts`, `src/types.ts`, `src/public/routes.ts` | 1 each | `READS.metadata`, the no-blocks disagreement, comments |

  **Seventeen files, sixty-one references** — corrected 2026-09-02 mid-build, when the seventeenth
  turned up. The first ledger swept `src/`, `tests/` and `docs/` and not `scripts/`, so it missed
  the only thing that actually calls the route: `scripts/check-public-shell.ts`, the hand-run curl
  verification of a deployed `/read/:slug`. It fetches `GET /api/public/metadata/:slug` on purpose,
  as *"an independent, already-public source of truth for the article's title — assembled by the
  same server, but not by the same code path that composes the head, so agreement between them
  means something"*. Deleting the route blind would have downgraded that check to the weak
  "not the bare default" version it was written to replace — which is
  [silent-success.md](../reusable/silent-success.md) exactly.

  **So the stage repoints it at `GET /api/public/article/:slug` and reads `meta.title`.** Sol's
  call, and it checked the independence properly rather than taking my word for it
  ([-build-forks-sol.md](260902j-public-read-only-build-forks-sol.md)): all three reads share
  `publicCurrentRevisionQuery`, so none of them can catch a bug in that; beyond it, **metadata and
  head share the same `PUBLIC_HEADING_TITLE` SQL expression** (`src/store/public-reader.ts:289`,
  `:337`) while `loadArticle` derives its heading title from the sanitised blocks
  (`headingTitleOf(blocks)`, `:485`). The article route is therefore *more* independent of the head
  than the route being deleted, not less. It also makes the check stronger for free: it now proves
  the article the head advertises can actually be delivered, which is Cluster G's worry
  (`loadHead` advertises without measuring). The blank-title downgrade path survives, because `??`
  preserves `""`.

  `PUBLIC_ROUTE_NAMES` becomes one entry and the closed-room guards stay;
  `tests/public-dispatch.test.ts` is inventory-driven and shrinks by itself — confirm it still
  fails for a semantically wrong remaining route. Four places in
  [260827ai](260827ai-public-read-only-access.md) that describe the route get a superseded note.
  Historical review docs stay as they were. The rewrite in `check-public-shell.ts` is wider than
  eight lines, because `judgeTitleAgainstMetadata` and its self-test cases are named after the
  route (`:313`, `:666`, `:848`).
- S2 — `runInRequest` around `servePublicReadPage` in `src/vercel.ts`, there and not in
  `public/page.ts` so the public import graph stays closed. Test: a public page handler that reaches
  for `currentOwnerId()` throws rather than answering as the environment owner. Fix the sentence in
  security-map.md that claims the tripwire already covers the page path.
- Delete the false comment in `public-reader.ts` that says the manifest prevents hot-linking, and
  replace it with a pointer to Cluster D, where it will become true.
- Delete stage 2 slice 2 from [260827ai](260827ai-public-read-only-access.md), with the date and
  the reason, and close its first open question (C5) and its rate-limit question (Cluster C).

### Tier 1, outside the code

**Cluster C: the WAF.** Greg's, in the Vercel dashboard: a rate limit on `/read/*` and
`/api/public/*`, keyed on IP, in log mode first. The plan cannot pick the threshold — there is no
traffic to measure against — so the ask is: log mode, look at the numbers after a week of any real
sharing, then enforce. Record what was set in
[deployment.md](../project/deployment.md). Sol's reasons for the platform over an in-process
counter: it runs before the function and the pool, and an IP map does not survive serverless
instances.

### Tier 2 — the extractions worth doing, each its own job

**Cluster D: images from us, not from the publisher.** Greg's call, against Sol's. Stages C, D and
E of [260829b](260829b-hosting-the-articles-images.md), in that order, as its build order says
(steps 7 to 10). That plan already has the authorisation right — exact manifest membership, current
`publicSlug`, `no-store`, sniffed `Content-Type` with `nosniff`, and the browser pass with a
positive-control image because "zero requests to the publisher" also passes when no image loads.
What this audit adds, and Sol's plan review blocked until it was said:

- **Stage C does not fit the dispatcher as it stands.** `PublicRouteName` captures one slug,
  every reader is `(slug) => Promise<unknown>`, and `send` always writes JSON
  (`src/public/route-names.ts:44`, `src/public/routes.ts:148`, `:104`). An asset route needs a slug
  *and* an asset identity, and a binary body with a truthful `HEAD`. The stage must generalise the
  one inventory rather than add a second ad-hoc dispatcher: a route declares its captures and its
  own responder, and the three sweeps — every route refuses every non-read method, the whole surface
  spends nothing, the client's paths agree with the server's — keep driving off `PUBLIC_ROUTE_NAMES`.
  Design that seam first, in the stage's own plan, and show the sweeps still fail when broken.
- **The DTO rebuild belongs with stage D**, whose client consumes the manifest, not with the binary
  route. Its fixture covers `Required<Assets>`, `Required<StoredAsset>` **and the failed arm of the
  union** — the pair alone would let a future optional field on a failed entry cross. Until D lands
  the pass-through stays, and that is benign: nothing in a manifest today is about a person.
- **What it closes, said accurately:** stored images stop going to the publisher. Entries that are
  missing, failed, unsupported (SVG) or timed out keep hot-linking by that plan's design.

Effort: a real job, three stages, each reviewed. Value: the thing the manifest was built for.
Risk: the ten traps that plan lists, every one silent.

**Cluster E: the badge.** Effort small, value modest, risk none. Visibility is already in the row
`listArticlesQuery` selects; the work is `LibraryEntry.visibility`, the projection, and a small
marker on the card and in the table. A badge, not a filter, until there is volume.

### Tier 3 — named and sized, not started

**Cluster F: save-to-shelf.** The stage 3 interim: `saved_public_articles(owner_id, article_id)`,
meaning only "keep this link" — a read-only card on the shelf that always re-checks `publicSlug`
and grants no ownership and no mutation. Safe on its own. **What it must not become** is the first
step of putting two readers' comments on one `article_id`: the child tables' `owner_id` is written
and never read, and that invariant breaks the moment it is shared. Comments and chat for a saved
article wait for the real stage 3 schema — `shelf_entries`, children keyed by shelf entry or held by
a composite owner/article foreign key. Its own plan, and the one place a schema redesign is
mandatory. Four things that plan must require, from Sol's review, so a bookmark cannot become the
trap by accident:

- a unique identity on `(owner_id, article_id)` with foreign keys both ways;
- every save, list and open query owner-scoped, with the article resolved through `publicSlug`;
- a discriminated `owned | saved-public` shelf DTO, so a saved card cannot mount `OwnedArticle`, an
  owner route, a mutation or a private hook;
- no child table ever references the bookmark.

And one decision to make on purpose rather than inherit: when the owner unshares, does a bookmark
hide and reappear on reshare, or is it deleted? Either works; accidental behaviour does not.

**Cluster G: the oversize article** — an unmeasured validation task rather than a rearchitecture.
Vercel caps a function response at 4.5 MB. The probe's article
was 210 KB; a book-length PDF might not be, and `loadHead` would advertise as readable a payload the
transport then refuses. Not public-specific — the owner's route has the same ceiling — and not to be
guessed at: reproduce on a deployment first, then choose between streaming the payload and refusing
to share it cleanly.

### Rejected on this pass

Recorded so the next sweep does not re-propose them.

- **A generic deep-copy helper for the projection.** The point of `dto.ts` is that every key is
  typed by hand; "safely copy nested objects" is the denylist by another name, rejected in the
  plan's first review.
- **Stop sending `assets` to visitors.** Sol's recommendation; Greg chose to build the consumer
  instead.
- **An in-process per-IP counter.** Wrong persistence boundary on serverless.
- **`s-maxage` with purge-on-unshare.** Couples the visibility write to cache invalidation and
  weakens revocation; the plan said `no-store` until revocation is designed, and nothing has changed.
- **Revocation polling or a focus listener.** Cannot recall delivered bytes; lifecycle machinery for
  a cosmetic result.
- **A public-specific database role or pool.** Until the WAF and a measurement show a need.
- **An admin reader for `article_visibility_changes`.** SQL when needed.
- **A `visitor` prop on the masthead.** The callback already is the capability.
- **Unlisted links.** Not pulled forward. The copy on the sharing card should say plainly that the
  URL is public and not secret; capability tokens only if real users ask to send privately.
- **Indexing.** Deleted, not deferred.

## One level up

The approach is sound, and it is the one GPT Sol endorsed after returning BLOCKED on the first
draft: a second predicate rather than a wider one, a hardwired public reader, a closed namespace
dispatched before the gate, narrow SQL projections, allowlist DTOs, and a capability union on the
client so the paid hooks are unreachable rather than skipped. Four audits and a live probe found no
path by which a stranger reaches owner data or spends money. The deviations are local: one route
nobody calls, one field nobody reads, one page path outside the request box, and four client edges
where a *control* rather than a *fetch* was gated by something other than the capability.

The one structural piece of work is not this feature's. It is the multi-reader ownership model that
stage 3 needs, and it is a redesign of the child tables, not of public reading.

## Progress

- 2026-09-02 — four audits, a live probe, Sol's input, Greg's four decisions, this doc. Nothing
  built.
- 2026-09-02 — **stage 1a built: C1, C2, C4.** The gutter's chat button is no longer drawn for a
  visitor — `onChatAbout` is optional through `TableView` into `BlockGutter`, so the callback *is*
  the capability and there is no boolean beside it to disagree; `App.tsx`'s `if (!owner) return;`
  is gone with it. `referee: "Referee"` joins `COSTS`, and all thirteen modes are now accounted for,
  so no live mode reaches the fail-closed fall-through — a sweep over `MODES` asserts that by the
  one thing the fall-through cannot fake, the bare mode id in the sentence. Both mode sweeps in
  `tests/public-network-trace.test.tsx` are driven from `MODES` and from the dock's own radios, with
  a total `BAND_SAYS` table so a mode that renders nothing cannot pass a request-counting check.
  Six modes had never been pressed in a visitor trace; **pressing them revealed nothing** — every
  one stays inside `/api/public/` and draws what it should.

  Two things worth keeping. `exactOptionalPropertyTypes` refuses the `onChatAbout?(id): void`
  shorthand for a prop a caller sets to `undefined` on purpose, so it is written out as
  `((id: BlockId) => void) | undefined`, with the reason on the prop. And the new dock sweep was
  **flaky on arrival and looked exactly like the bug it hunts**: nuqs pushes `?mode=` on a throttle,
  so reading `location.search` straight after a click recorded the previous mode and reported
  Hierarchy as a dead button, about one run in two. The press is now asserted on `aria-checked`,
  which is React state and lands with the click, and the URL is polled to a deadline. Three clean
  runs, and both assertions mutation-tested.
- 2026-09-02 — Sol's plan review ([-review-sol.md](260902j-public-read-only-access-audit-review-sol.md))
  returned **BLOCKED** on three things, all folded in above: C3 needed a `reauth-required` state
  rather than the existing error page, Cluster D's stage C needed the dispatcher seam named, and the
  metadata deletion needed a counted ledger. It also corrected S1, S3, S4 and S9's wording, split
  Clusters A and B into two stages with A promoted to Tier 0, and added Cluster F's four
  requirements. Every claim it made was checked against the tree before it was adopted. Ready to
  build, stage 1 first.
- 2026-09-02 — **S2 built**, pulled out of Cluster B and landed early because it touches nothing the
  client work is in. `runInRequest` around `servePublicReadPage` in `src/vercel.ts`, and
  `tests/public-page-request-scope.test.ts` is the guard: it drives the real `handler` at
  `/read/:slug` with the page stubbed by a spy that asks `currentOwnerId()` on the caller's behalf.
  **Red first, and the red was the finding** — `inRequest()` was `false`, so the page ran outside
  any box and the tripwire the security map describes did not exist there. The wrap is in the
  transport rather than in `src/public/page.ts`, which would have pulled `src/owner.ts` into the
  import graph `tests/public-imports.test.ts` keeps closed. `security-map.md`'s tripwire bullet now
  says out loud that a scope has to be open for it to be true, and that one was not.

  One thing the test needed, and it is worth knowing before writing another like it: reaching
  `handler` means importing `src/vercel.ts`, which pulls the whole of `src/routes.ts` behind it —
  about eight seconds cold on this box, against vitest's five-second default. The first run
  "failed" as a timeout that looked nothing like the bug.
