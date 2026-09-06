# Lazy-load Admin and Design, and prove the boundary holds

Item **A4** of [the main-app architecture review](260905e-main-app-architecture-review.md), stage
*Cut secondary-route startup cost*. Worktree `a4-lazy-secondary-routes`, branched from
`6eecb377f24d92446086a006d5b3103daae40aef` (origin/dev, 2026-09-05).

## What this is for

`src/web/App.tsx` statically imports every page, so the administrator's table and the `/design`
gallery are in the module graph a reader downloads to read one article. A4 asks for one narrow
tranche: **Admin and Design behind `React.lazy`**, with a local loading surface, a local error
surface and a way back to reading — and nothing else moved.

The review names two traps and this plan is built around them.

1. **Moving an import while another eager import remains changes nothing.** The build already
   demonstrates it: `[INEFFECTIVE_DYNAMIC_IMPORT] src/web/lib/supabase.ts is dynamically imported by
   src/web/PublicChrome.tsx but also statically imported by …`. So the acceptance evidence is the
   emitted graph and the actually-requested chunks, never the diff.
2. **The reader, the shelf and the mode code stay eager.** Cached JSON cannot make an unloaded chunk
   execute, and [`tests/offline-remount.test.tsx`](../../tests/offline-remount.test.tsx) protects
   opening cached mode data after a remount. A bundle reduction bought by breaking first activation
   offline is not a win.

And it names the outcome that is allowed: **stop and close the stage as deferred, with the evidence,
if there is no meaningful gain.**

## What is already measured

Run in this worktree at the baseline SHA above, on the Hetzner box, `npm run build` (Vite 8 /
rolldown). These are emitted sizes, not a network trace; the trace is Stage 1.

| Build | `main-*.js` | `index-*.js` (entry) | JS gzip total |
|---|---:|---:|---:|
| Baseline | 1,490.90 kB (gzip 449.14) | 21.50 kB (gzip 8.38) | **457.52 kB** |
| Admin + Design **deleted** (stub spike) | 1,451.82 kB (gzip 438.40) | 19.35 kB (gzip 7.74) | **446.14 kB** |
| **Every** secondary route deleted (stub spike) | 1,364.22 kB (gzip 413.53) | 17.94 kB (gzip 7.23) | **420.76 kB** |

The spikes replace the page components with `() => null` and rebuild; deletion is the **ceiling** a
loading boundary can reach, because a lazy chunk is still emitted and is still fetched by anyone who
visits the route.

So the honest headline before a line is written:

- **Admin + Design is worth at most 39 kB raw / 11.4 kB gzip — 2.5% of initial JS.**
- Every secondary route together (Landing, Features, Pricing, Contact, Privacy, Public shelf,
  Not-found, Add, Profile, Admin, Design) is worth at most 130 kB raw / 36.8 kB gzip — 8%.
- The other 92% is the reader, the shelf and the modes, which this tranche must not touch.

That second row is recorded because it is the thing a future tranche needs and nobody has measured
before: **the whole secondary-route surface is 8%.** Anyone hoping route splitting will halve this
bundle should read that number first.

### The emitted graph, before

`npx vite build --manifest --outDir logs/a4-dist-before --emptyOutDir`, then the chunk graph out of
`.vite/manifest.json`. The whole client is **three chunks**:

| Chunk | Entry? | Static `imports` | `dynamicImports` |
|---|---|---|---|
| `index.html` → `assets/index-*.js` | entry | — | `src/web/main.tsx` |
| `src/web/main.tsx` → `assets/main-*.js` | dynamic entry | `index.html` | `src/web/lib/supabase.ts` |
| `src/web/lib/supabase.ts` → `assets/supabase-*.js` | dynamic entry | `src/web/main.tsx` | — |

The third is the 0.06 kB husk the build warns about: `PublicChrome.tsx` imports it dynamically, six
other modules import it statically, so the chunk exists and contains nothing. **That is the shape of
a loading boundary that does not work**, sitting in the build output as a worked example, and it is
why the acceptance evidence here is the manifest rather than the diff.

After the change, `src/web/AdminPage.tsx` and `src/web/DesignPage.tsx` must appear as dynamic entries
reached by a dynamic edge from `main.tsx`, and in no chunk's static `imports`.

### The source closure, before

Measured with an AST walk of the static import graph: **268 files** eagerly reachable from
`src/web/main.tsx`, one dynamic edge (`PublicChrome.tsx → lib/supabase.js`), 17 bare packages.
`src/web/boot.tsx` reaches six files statically and `main.js` dynamically, exactly as its own header
claims. All six route-private modules are in the closure today, plus `src/admin.ts` — which **must
stay**, because `App.tsx` and `Library.tsx` both call `isAdmin` to decide what a reader may see.

### The network trace, before

`scripts/measure-startup.ts` (new, and Stage 3 runs the identical command) against the production
build under `npx vite preview --port 4291`, Chrome via CDP, cache cleared and disabled per run, wire
bytes from `Network.loadingFinished.encodedDataLength` rather than from `ls`. Time-to-readable-prose
is defined in the script's header and printed with every result: the first **frame** on which a prose
block has non-empty text, with a `MutationObserver` lower bound reported beside it and a hard failure
if the probe saw no frames or no prose.

| Entry point | JS requests | Initial JS, wire | TTRP / TTFT median (min–max) | FCP |
|---|---:|---:|---:|---:|
| `/` signed out | 2 | **454,911 B** | TTFT 371 (344–458) | 452 |
| `/` signed in (shelf) | 2 | **454,911 B** | TTFT 672 (540–832) | 720 |
| `/read/scaling-hypothesis` (Plain, 186 rows) | 2 | **454,911 B** | **TTRP 2,735 (2,505–5,376)** | 620 |
| `/design` | 2 | **454,911 B** | TTFT 758 (719–880) | 816 |
| `/admin` | 2 | **454,911 B** | TTFT 580 (543–653) | 604 |

**Two numbers out of that table decide how Stage 3 is allowed to report.**

The **bytes have a noise floor of exactly zero**: 24 runs, five entry points, two auth states, two
batches hours apart — `454,911 B` every single time. A 2.5% change in that is a clean, repeatable,
deterministic signal. It is a structural assertion wearing a number, which is why it works.

The **times cannot see this change at all**, and it is not close. A second batch on unchanged code,
with the box's load average at 115, moved the reader route's median TTRP from **2,735 ms to
10,784 ms**. On loopback the whole 445 kB transfers in 137–242 ms, so 2.5% of it is four to six
milliseconds — three orders of magnitude under the noise, and the box only produced 5–15 frames a
second, so a frame-based timestamp is quantised at 70–200 ms before any of that. **Stage 3 reports
time-to-readable-prose as "unchanged within noise" and quotes that 2,505–10,984 ms spread**, so that
nobody later mistakes the silence for a null result. Manufacturing a time improvement here would
take a throttled synthetic profile answering a different question than A4 asked.

Two things the measurement turned up that the next person needs:

- **`/read/constitution` is not readable on this box.** Signed in as the seeded
  `dev-admin@spideryarn.local` it answers *"This document isn't shared"*. The fixture is
  `/read/scaling-hypothesis` — public, Gwern, 12,646 words, 186 rows — and **Stage 3 must use the
  same slug or its numbers are not comparable.**
- **`vite preview` gzips on GET but not on HEAD.** `curl -I` reports `Content-Length: 1490905` and no
  `Content-Encoding`; the GET delivers 445,506 bytes. Trusting the HEAD would have reported raw
  sizes as wire sizes. The script records and prints `content-encoding` per response so the mistake
  cannot be made silently.

### One thing the walk turned up that the plan had wrong

The *shortest* eager chain to
`admin-columns.tsx` runs `main → App → AdminPage → admin-columns`, not through `params.ts` at all.
So lazy-loading `AdminPage` alone makes the shortest chain disappear while `params.ts` quietly goes
on holding the module in — the plan's own trap, one level down from the build warning. Both edges
have to go, and a failure message that named only the shortest chain would have hidden it.

### The decision, made before building

2.5% is small. It is not zero, the change is about sixty lines, and two things make it worth doing
rather than deferring:

- **It is the boundary, not the bytes.** Right now nothing stops the next admin feature — a chart
  library, a CSV writer — landing in every reader's download, and nobody would notice; the only
  symptom is a number nobody is looking at ([silent-success.md](../reusable/silent-success.md)).
  Stage 2 ends with a **test that walks the eager graph from `main.tsx`** and fails if `AdminPage` or
  `DesignPage` is reachable, which is the durable half of the work.
- **The review's later tranches depend on the mechanism working.** A4 says explicitly: *"Avoid
  vendor/manual chunk configuration until import boundaries work and the build graph shows a
  remaining reason for it."* This is that step.

What this plan will **not** do is call this a performance win. The report says whatever the
measurement says — which turned out to be 1.35%, see § What it actually came to — and
[performance.md](../project/performance.md) gets the number, the ceiling and the 8% context.

If Stage 1's trace shows the gain is smaller than the emitted-size ceiling suggests — for instance if
`main-*.js` is already served from cache on every measured navigation — the plan is to close the
stage as deferred and land only the measurement and the doc. That is a real branch, not a formality.

**Sol's plan review agrees, and put it better than the paragraph above:** *"build it. The current
byte saving is small, but an enforced route boundary prevents future admin dependencies from
silently entering reader startup. Call it an architectural guard, not a demonstrated speed
improvement."* Its F5 also closed the no-go branch — the example I gave for stopping (the chunk
already being in the reader's HTTP cache) is impossible in a measurement taken with the cache
disabled. **The decision is go**, and the obligation that remains is honest reporting, not a
conditional.

## The one shared import that would make this a no-op

[`src/web/params.ts`](../../src/web/params.ts) — eager, imported by the reader — does:

```ts
import { ADMIN_DEFAULT_BY } from "./admin-columns.js";
```

`admin-columns.tsx` is 497 lines of administrator table columns. So lazy-loading `AdminPage.tsx`
alone would move the page and leave its columns behind: **exactly the trap**, and the reason Stage 1
records the graph before and after rather than trusting the edit.

`ADMIN_DEFAULT_BY` is `["signedUp"]`. **It moves into `params.ts`, beside `adminByParam`, and no new
module is created** — Sol's F6, and it is right: `admin-columns.tsx` declares the constant and never
uses it, `params.ts` consumes it directly, and `AdminPage.tsx` (the only other consumer) already
imports `params.js`. Once `params.ts` stops importing `admin-columns.tsx` there is no cycle to
avoid, so the new module this plan first proposed was a part with nothing to do. `admin-columns.tsx`
loses the declaration and gains no import; its `ADMIN_CHIP_ORDER` comment, which explains itself by
reference to the constant, moves or shortens with it.

`src/admin.ts` § `isAdmin` stays eager: `App.tsx` and `Library.tsx` both call it to decide what a
reader may see, and that is a decision the reader route makes.
`@tanstack/react-table` and `lib/DataTable.tsx` also stay eager — the **shelf** uses them.

## Stages

### Stage 1 — Baseline: two graphs and a paired network trace

- [x] Record emitted asset sizes for the baseline build (done, table above).
- [ ] Record the **emitted** import graph — `npx vite build --manifest`, then the chunk graph from
      `dist/.vite/manifest.json`: every chunk's `imports` (static) and `dynamicImports`. `boot → main`
      is unconditional startup; follow only static edges from `main`. This is the form A4 asks for,
      and it is not the same as a source graph (Sol F3). No permanent `vite.config.ts` change — the
      flag is passed on the command line for the measurement runs.
- [ ] Record the **source** eager closure as well, because the manifest cannot see inside a chunk:
      it can prove `AdminPage.tsx` became a dynamic entry, but not that `admin-columns.tsx` left the
      main chunk. Confirm all six route-private modules are eagerly reachable today —
      `AdminPage.tsx`, `DesignPage.tsx`, `admin-columns.tsx`, `AdminFeedbackList.tsx`,
      `useAdminFeedback.ts`, `useAdminUsers.ts`.
- [ ] Serve the production build with `npx vite preview` (which mounts the same `/api` middleware —
      `vite.config.ts` § `configurePreviewServer`) and take a **network trace** with Playwright on
      this box for: signed-out landing, signed-in shelf, Plain reader on one fixture article, and
      direct `/admin` and `/design`.
- [ ] For each: **initial requested JS** (transfer bytes, cache disabled) and, for the reader route,
      **time-to-readable-prose** with a stated definition and a nonzero prose-block count so a
      zero-work run cannot report 0 ms. Median and spread over at least three runs.

Done looks like: a manifest-derived emitted graph, a source closure, and a numbers table in this doc.

### Stage 2 — The boundary

- [ ] Move `ADMIN_DEFAULT_BY` into `params.ts` beside `adminByParam` (Sol F6). `AdminPage.tsx` takes
      it from its existing `params.js` import; `admin-columns.tsx` loses the declaration and gains
      no import. No new module.
- [ ] Four **module-scope** loaders in `App.tsx`, because neither page has a default export and
      `React.lazy` reads `module.default` (Sol F1) — a `lazy(() => import("./AdminPage.js"))` would
      send every `/admin` visit to the error surface:

      ```ts
      const loadAdminHome = () => import("./AdminPage.js").then((m) => ({ default: m.AdminHome }));
      ```

      …and the same for `AdminUsersPage`, `AdminFeedbackPage`, `DesignPage`. Module scope, so each
      loader has a stable identity for the memo below.
- [ ] New file `src/web/LazyPage.tsx`, taking a **loader and a route key**, not children:

      ```tsx
      const Page = useMemo(() => lazy(load), [load, attempt]);
      ```

      wrapped in an error boundary keyed `${routeKey}:${attempt}`. **A rejected `React.lazy` caches
      its rejection and re-throws it forever, so a retry that merely remounts the same lazy type is
      permanently broken** (Sol F2, citing React's own payload handling) — each attempt must build a
      fresh lazy type, and changing route must clear the previous route's failure.
- [ ] The failure surface follows [copy.md](../project/copy.md): what happened, whose fault it is,
      what to do next, and a bracketed `[chunk]` last for tests to pin — beside the code that raises
      it, as `[render]` and `[boot]` already are. Never render `error.message`. It offers **Try
      again** and a way back to the shelf, and it says that reloading usually fixes it — which is
      **true and load-bearing**: the commonest cause of a chunk failing in production is a deploy
      replacing the hashed assets under an open tab, and re-requesting the same dead URL cannot fix
      that.
- [ ] Report it: `captureClientFailure(error, { boundary: "lazy-route" })` and a message-free
      `recordLog({ kind: "client-error", … })`, matching `AppBoundary.tsx`. Sol F7 — the nearest
      boundary swallows the throw, so without this the reader sees `[chunk]` and Sentry sees nothing.
- [ ] Wrap only the `design` and `admin` branches of `SignedIn`. The diff stays inside those two
      branches; three other agents are editing `App.tsx` this hour.
- [ ] `useSession`/`useJobSession` are called at the top of `App`, above every route return, so the
      session services are already above the fallback. Assert it with a test rather than by reading.
- [ ] New test `tests/eager-client-graph.test.ts`, and it is the durable deliverable of this stage.
      **AST, not a regex** — this repo has already had that argument and written it down in the
      header of [`tests/helpers/ts-ast.ts`](../../tests/helpers/ts-ast.ts): two earlier checks began
      as character scans and were wrong in both directions, and the dangerous direction is a scan
      that goes quiet. Use its `parseSource`/`walkAst`. `@babel/parser` is already a direct dev
      dependency, so this adds none. The test must: union the static closures of `boot.tsx` and
      `main.tsx`; ignore type-only imports and exports; follow `export … from`; resolve `@/`,
      `.js`→`.ts`/`.tsx` and directory indexes; **fail on an unresolved local specifier**; not follow
      `import()`; assert **all six** route-private modules are absent; and carry **positive
      controls** — `monitoring.ts`, `App.tsx`, `Library.tsx`, `lib/supabase.ts` must be present, and
      the closure size must be plausible — so that a walker which has quietly stopped walking goes
      red instead of green. On failure it prints the shortest eager chain that still holds the module
      in. **Watch it go red first** against the unmodified `App.tsx`.
- [ ] New test for the failure surface: reject the loader on the first call and resolve it on the
      second; assert the escape rendered, that **Try again** called the loader a second time, that
      the real page then appeared, that changing `routeKey` clears an earlier rejection, and that no
      generation request was issued. A stubbed loader, not a real chunk.
- [ ] Test all four route variants render: `/admin`, `/admin/users`, `/admin/feedback`, `/design`.
- [ ] Rebuild with `--manifest`. Admin and Design must appear only behind **dynamic** edges from
      `main`; one lazy chunk or several is the bundler's choice, not an assertion. Check no new
      `INEFFECTIVE_DYNAMIC_IMPORT` line names them.
- [ ] Run [`tests/offline-remount.test.tsx`](../../tests/offline-remount.test.tsx) and
      `tests/api-fetch-offline.test.ts` green, and check in-tab shelf → cached article navigation in
      a browser.

Done looks like: a red-then-green graph test, a retry that actually retries, an escape that reports,
and offline unchanged.

### Stage 3 — Measure again, write it down, land it

- [ ] **Paired A/B, not before-then-after** (Sol F5). Keep the baseline `dist` in one directory and
      the new one in another, serve both at once, verify each build's asset hashes before every run,
      and alternate runs. On a box a dozen agents share, three runs before and three runs after are
      not comparable and could invent a delta larger than the change.
- [ ] The acceptance evidence is **initial requested JS in transfer bytes** and **the absence of any
      Admin/Design request on the reader route**. Time-to-readable-prose is reported descriptively;
      *"no detectable change"* is a valid and expected result on a local preview server, where the
      transport distance is near zero and 11.4 kB of gzip cannot show up as latency.
- [ ] Confirm direct `/admin` and `/design` work in a browser, including the loading frame — delay
      the chunk deterministically to see it, rather than hoping to catch it.
- [ ] Signpost [web-client.md](../project/web-client.md): a row for `LazyPage.tsx` and the rule that
      secondary routes load on demand while reader, shelf and mode code do not.
- [ ] **Correct the six places that say this code is in every reader's bundle** (Sol F8) — the two
      comments in [`App.tsx`](../../src/web/App.tsx) § `SignedIn`, three in
      [`router.ts`](../../src/web/router.ts), the header of
      [`tests/admin-only-routes.test.tsx`](../../tests/admin-only-routes.test.tsx), and three in
      [admin.md](../project/admin.md). **Keep the security rule they carry exactly as it is:** the
      split changes startup cost, not authorisation. `/api/admin/*` is still gated by the server,
      `/design` still reads no private data, and an unloaded chunk is not a boundary — the address
      still answers 200 and the code still arrives for anyone who asks for it.
- [ ] Append to [performance.md](../project/performance.md). **Append; do not restructure** — that
      file is shared with the A7 job this hour.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` on touched files, `npm run check`.
- [ ] Tick only this stage's boxes in
      [the review](260905e-main-app-architecture-review.md#stage-cut-secondary-route-startup-cost).

## What it actually came to

Built, measured, and the number is smaller than the plan predicted. **6,141 wire bytes, 1.35%**, not
the 11.4 kB / 2.5% the deletion spike suggested. The write-up lives in
[performance.md § Startup, 2026-09-05](../project/performance.md); the short version:

| Route | before | after | Δ |
|---|---:|---:|---:|
| `/` signed out, `/` shelf, `/read/scaling-hypothesis` | 2 requests, 454,911 B | 4 requests, 448,770 B | **−6,141 B (−1.35%)** |
| `/design` | 2 requests, 454,911 B | 5 requests, 455,470 B | +559 B |
| `/admin` | 2 requests, 454,911 B | 5 requests, 455,246 B | +335 B |

Byte-identical across every run, and the signed-out and signed-in figures were taken twice on two
revisions of the harness and came back to the byte. Time-to-readable-prose is **unchanged within
noise** and reported descriptively only: the same unchanged baseline build measured 2,735 ms in one
batch and 10,784 ms in another, spread 2,505–10,984 ms, against a change worth four to six
milliseconds of loopback transfer.

**Why the number fell short of the ceiling, and it is worth understanding rather than filing.** The
split gave rolldown new splitting points, so what `main` shares with the two lazy chunks was hoisted
into two **new shared chunks** — `supabase-*` (54.76 kB gzip) and `useNow-*` (50.74 kB gzip) — which
`main` then imports **statically**. The trace shows all three issued within a millisecond of each
other, so they are startup requests, not lazy ones. Raw bytes fell 33,231 and only 6,141 survived
gzip, because four chunks compress against four dictionaries. **A deletion spike never pays the
split's compression cost, so it will always over-predict.** Anyone starting a later tranche from an
emitted-size table should expect the same shortfall.

Two incidental results:

- The `[INEFFECTIVE_DYNAMIC_IMPORT] src/web/lib/supabase.ts` warning is **gone**. The 61-byte husk
  has become a real 210 kB shared chunk, because the two lazy chunks finally gave rolldown somewhere
  to hoist it to. That is a shape change nobody asked for; it is also, unmeasured, probably good —
  the Supabase SDK is now separately cacheable across a deploy that only touches reader code.
- The lazy chunks are issued about 400 ms *after* the eager four, i.e. after the app has booted and
  resolved the route. That is the shape a real boundary produces, and it was checked rather than
  assumed: with the chunk deliberately held back six seconds by CDP interception, `/admin` and
  `/design` both still rendered their real page and no run's text contained `[chunk]`.

### What was not proved

**Nobody has seen the loading spinner.** `Loading()` is icon-only — `role="status"`,
`aria-label="Loading"`, no text — so a text probe cannot see it, and a `role="status"` probe turned
out useless because something in the app chrome carries one on every page including `/` and the
reader. The six-second delayed run proves the fallback *works* (six seconds with no page component
mounted, no error, then the real page), but the frame itself was never looked at. Worth a real
screenshot next time somebody is in a browser here.

## Out of scope, deliberately

- **Profile, Add, and the marketing pages.** A4 says Admin and Design; the 8% row above is the
  evidence a later tranche would start from, not permission to take it now.
- **Mode/panel splitting.** A4: keep it eager in this tranche.
- **Vendor or manual chunk configuration**, a service worker, a PWA migration. A4 forbids all three
  until import boundaries work.
- **`src/web/lib/offline-store.ts` and `src/web/lib/api.ts`** — rewritten hours ago by A0.
- `activation.ts`, `Dock.tsx`, `TableView.tsx`, `annotate.ts`, `src/converse.ts`, and restructuring
  `styles.css` — other jobs own those this hour.

## The simpler option this passed over

**Do nothing and close the stage as deferred** on the 2.5% ceiling alone, without building.
Rejected because the ceiling is a fact about *today's* Admin and Design, not about the next thing
somebody adds to them, and because the durable deliverable here is the graph test — which cannot be
written without the boundary it asserts. If Stage 1's trace undercuts the emitted-size estimate,
this option is taken after all.

## Reviews and overrules

GPT Sol reviews the plan before Stage 2 and the code at the end of every stage; two rounds, then
settled here in writing.

### Round 1 — the plan. [The review verbatim](260905i-plan-review-sol.md)

Verdict: **reject as written**, then support after the corrections. Every finding was checked here
rather than taken on trust; all eight are accepted, none overruled. Where they landed:

| ID | Finding | Disposition |
|---|---|---|
| F1 | P1. `lazy(() => import(…))` cannot render these modules — neither page has a default export, so every `/admin` and `/design` visit would reach the error surface | **Accepted.** Verified: `grep 'export default'` finds nothing in either file. Four named-export loaders, Stage 2 |
| F2 | P1. A rejected `React.lazy` caches the rejection, so a retry that remounts the same lazy type is permanently broken | **Accepted.** Each attempt builds a fresh lazy type; boundary keyed by route **and** attempt. Stage 2 |
| F3 | P1. The plan substituted a source graph for the **emitted** graph A4 requires; and "the main chunk no longer names them" is not well defined, since it still names their chunk filenames | **Accepted.** `vite build --manifest` for the emitted graph, source closure kept as the durable guard. Both are in Stage 1 now |
| F4 | P2. The source-graph test was underspecified and could pass falsely | **Accepted, and strengthened past what it asked.** AST via the repo's existing `tests/helpers/ts-ast.ts`, plus positive controls so a walker that stops walking goes red |
| F5 | P2. Three runs before and three after, unpaired, on a shared box, can invent a delta | **Accepted.** Paired A/B against two preserved builds; bytes are the acceptance number, TTRP is descriptive |
| F6 | P2. `admin-sort.ts` is an unnecessary new module; `params.ts` is the home, and there is no cycle once its old import goes | **Accepted.** Verified: `admin-columns.tsx` declares the constant and never uses it |
| F7 | P2. The local boundary would swallow chunk failures — reader sees `[chunk]`, Sentry sees nothing | **Accepted.** `captureClientFailure` + a message-free ring-buffer entry, matching `AppBoundary.tsx` |
| F8 | P3. Six comments and three doc passages say this code is in every reader's bundle, and become false | **Accepted.** Stage 3, with the security rule they carry preserved word for word |

One thing Sol did **not** ask for was done anyway: its F4 said an AST-based test, and the first
implementation of the walker had already arrived as 657 lines of hand-rolled scanning. That is the
exact approach `tests/helpers/ts-ast.ts` was written to replace, and its header records why — so the
walker was rewritten on the shared parser and the script deleted rather than kept alongside.

### Round 2 — the code. [The review verbatim](260905i-code-review-sol.md)

Verdict: **approve** — no P0, no P1, no reader-route regression. Four findings, all accepted, none
overruled. Two of them were established with a harness Sol built and ran rather than by reading,
which is the half of a review worth the most.

| ID | Finding | Disposition |
|---|---|---|
| **F4** *remains* | P2. The guard still had two false greens. `import.meta.glob("./AdminPage.tsx", { eager: true })` in `App.tsx` left all five tests green — Vite expands that to eager imports and the walker recognised only import/export declarations and `import()`. And a *new* admin module imported eagerly by both `App.tsx` and `AdminPage.tsx` also passed, because the assertion checked a fixed six-file list. **The second one contradicted the claim in `performance.md` that "the next thing added" cannot get in unnoticed — which is the entire justification for landing 1.35%** | **Accepted, both.** `import.meta.glob` now fails the walk loudly rather than being walked past. The fixed list is joined by a check on what the two lazy pages share with the eager closure |
| **F9** | P2. `routeKey` was missing from the memo's dependencies, so a *shared* loader rejected under one route kept re-throwing that rejection under the next — the boundary remounts, React's cached rejection does not. All four routes pass distinct loaders today, so it was an abstraction hole rather than a live bug | **Accepted.** `[load, routeKey, attempt]`, plus a test that fails without it — checked by reverting the one-word fix and watching it go red |
| **F10** | P2. The test wrote its diagnostic dump unconditionally, so on a read-only checkout it was `EROFS … 0 test`. Sol hit this in its own sandbox: **the guard could not run for the reader most likely to attack it** | **Accepted.** The dump is opt-in behind `SPIDERYARN_EAGER_GRAPH_OUTPUT` |
| **F8** *remains* | P3. Five more "in everybody's bundle" claims survived the first sweep — twice in `App.tsx`, once in `router.ts`, once in `tests/admin-only-routes.test.tsx`, twice in `admin.md`, once in `src/routes.ts`, once in `design-css-overview.md` | **Accepted.** All corrected except `design-css-overview.md`, which is one of the seven entry-point docs and so needs Greg's approval before its wording changes — the before/after is in the handover rather than applied |

Sol's own checks worth keeping: the two new shared chunks do **not** break Sentry's startup ordering
(`boot.tsx` initialises monitoring before importing `main`, and a failure in `main`'s static
dependencies rejects that import into the existing `catch`); in-tab offline navigation is unchanged,
because those static chunks must already have loaded before React starts at all; and pre-importing
the two pages in `admin-only-routes.test.tsx` does not mask a bad named-export adapter, since the
real loaders still run.
