Verdict: reject the plan as written. F1 and F2 establish user-visible failures; F3 contradicts the authoritative brief. The corrections are small, and after them I support building this tranche.

### Findings

**F1 — P1 — established: the proposed `React.lazy` calls cannot render these modules**

(a) The plan says `lazy(() => import(…))` ([plan line 129](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/docs/plans/260905i-lazy-load-admin-and-design-routes.md:129)), but `AdminPage.tsx` exports three named components and `DesignPage.tsx` exports one named component—neither has a default export. React 19 reads `module.default`; direct `/admin` and `/design` visits would reach the error surface rather than their pages. This is explicit in the installed React implementation ([react.development.js](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/node_modules/react/cjs/react.development.js:498)).

(b) Replace that step with stable, module-scope named-export adapters:

```ts
const loadAdminHome = () =>
  import("./AdminPage.js").then((m) => ({ default: m.AdminHome }));
const loadAdminUsers = () =>
  import("./AdminPage.js").then((m) => ({ default: m.AdminUsersPage }));
const loadAdminFeedback = () =>
  import("./AdminPage.js").then((m) => ({ default: m.AdminFeedbackPage }));
const loadDesign = () =>
  import("./DesignPage.js").then((m) => ({ default: m.DesignPage }));
```

Test all four route variants: `/admin`, `/admin/users`, `/admin/feedback`, and `/design`.

---

**F2 — P1 — established: remounting a rejected lazy element does not retry its loader**

(a) React stores the rejected promise/error on the lazy component’s payload and subsequently throws that same result ([react.development.js](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/node_modules/react/cjs/react.development.js:460)). A `key` that merely remounts the same lazy component type therefore leaves “Try again” permanently broken. A failed boundary can also remain broken when navigating between two lazy routes unless route identity resets it.

(b) Replace “Retry re-mounts the lazy element only” with:

> `LazyPage` accepts a stable loader and route key. Each attempt constructs a fresh lazy component type, and the error boundary is keyed by both route and attempt. Retry must invoke the loader again; changing lazy routes must clear an earlier route’s failure.

For example:

```tsx
function LazyPage({ load, routeKey }: { load: Loader; routeKey: string }) {
  const [attempt, setAttempt] = useState(0);
  const Page = useMemo(() => lazy(load), [load, attempt]);

  return (
    <ChunkBoundary
      key={`${routeKey}:${attempt}`}
      onRetry={() => setAttempt((n) => n + 1)}
    >
      <Suspense fallback={<Loading />}>
        <Page />
      </Suspense>
    </ChunkBoundary>
  );
}
```

The test must reject the first loader call, resolve the second, assert two calls, and assert the real page appears. Also test that changing `routeKey` clears a rejection.

---

**F3 — P1 — established: the plan substitutes a source graph for the required emitted graph**

(a) The authority requires an **emitted import graph** ([brief line 621](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/docs/plans/260905e-main-app-architecture-review.md:621)). Stage 1 instead records a textual graph from `main.tsx` ([plan line 101](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/docs/plans/260905i-lazy-load-admin-and-design-routes.md:101)). The later instruction to check that the main chunk “no longer names” the pages is not well-defined: the main chunk normally still contains their dynamic chunk filenames.

(b) Record both forms:

> Build with a Vite manifest and persist a manifest-derived emitted graph containing every chunk’s `imports` and `dynamicImports`. Treat `boot → main` as unconditional startup, follow only static edges from `main`, and prove that Admin/Design appear only behind dynamic edges. Record the requested asset set alongside it. Keep the source-graph test as the durable guard.

Replace “emits them as their own chunks” with “emits one or more lazy chunks”; exact chunk count and coalescing are bundler choices.

---

**F4 — P2 — reasoned: the source graph test is underspecified and can pass falsely**

(a) A regex modeled on `cold-start-lazy-imports.test.ts` is parsing emitted ESM, not TypeScript source. A source walker that misses `export … from`, `@/` aliases, `.js`→`.ts/.tsx` resolution, or the actual `boot.tsx` entry can report the pages unreachable while an eager edge remains. As written, it also asserts only the two page files, despite the plan already identifying six route-private modules.

(b) Specify an AST-based, fail-closed test:

- Parse `ImportDeclaration`, `ExportNamedDeclaration`, and `ExportAllDeclaration`.
- Ignore type-only imports/exports.
- Resolve relative imports, `@/`, `.js`-suffixed TS imports, and directory indexes.
- Fail on unresolved local specifiers.
- Union the static closures of `boot.tsx` and `main.tsx`; do not traverse ordinary `import()` calls.
- Include positive controls such as `monitoring.ts` and `App.tsx`.
- Assert all six named private modules are absent, not only the two pages.

My AST census found no second current eager edge after simulating the intended three removals.

---

**F5 — P2 — reasoned: the timing comparison can flatter the change**

(a) Three baseline runs before implementation and three after, on a shared box, are not paired. Host load, API latency, or accidentally serving the wrong `dist` can create a favorable delta larger than this change. Local preview can measure parse/evaluation cost, but its near-zero transport distance cannot establish the network-latency benefit of removing 11.4 kB gzip. A naturally fast local chunk may also never leave a loading frame visible long enough to inspect.

(b) Replace the measurement steps with:

> Preserve baseline and after builds in separate output directories, serve both simultaneously, verify each `build.json`/asset hash before every run, and alternate paired A/B runs. Initial gzip JS bytes and the absence of Admin/Design requests are the primary acceptance evidence. Report time-to-readable-prose as descriptive—“no detectable change” is valid. If a sensitivity number is wanted, repeat under one fixed, disclosed network/CPU throttle and label it synthetic. Delay each lazy chunk deterministically when checking the loading frame.

The stated cache-based no-go example is impossible with cache disabled. Since the plan already accepts 11.4 kB gzip as meaningful, say that the decision is “go” now rather than retaining a nominal decision branch.

---

**F6 — P2 — established: `admin-sort.ts` is unnecessary and contradicts “small existing home”**

(a) The brief says to use a small existing home ([brief line 624](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/docs/plans/260905e-main-app-architecture-review.md:624)). `params.ts` already consumes the value directly in `adminByParam`, while `admin-columns.tsx` does not use it except to export it. Once the old import is removed, placing it in `params.ts` creates no cycle.

(b) Replace lines 87–90 with:

> Move `ADMIN_DEFAULT_BY` beside `adminByParam` in `params.ts` and export it there. `AdminPage.tsx` imports it through its existing `params.ts` import. Remove the declaration from `admin-columns.tsx`; that module needs no replacement import. Move or shorten its explanatory comment accordingly. No new module is needed.

---

**F7 — P2 — reasoned: the local boundary may make chunk failures invisible operationally**

(a) The nearest error boundary catches a rejected lazy import, so the outer `AppBoundary` will not report it. The plan specifies reader copy but not `captureClientFailure` or the diagnostic ring buffer. A reader sees `[chunk]`, while Sentry and submitted diagnostics may show nothing.

(b) Add:

> `LazyPage`’s boundary reports through `captureClientFailure(error, { boundary: "lazy-route" })` and records a message-free `client-error` entry, matching `AppBoundary`. Never render or log `error.message`.

Test that a rejection reports once and that retry does not report or invoke generation work unless the retry also fails.

---

**F8 — P3 — established: several authoritative comments become false**

(a) `admin.md`, `router.ts`, `App.tsx`, and `admin-only-routes.test.tsx` repeatedly say Admin and Design are in every signed-in reader’s downloaded bundle. The plan updates only `web-client.md` and `performance.md`.

(b) Add a documentation step updating those statements. Preserve the real security rule:

> The client split changes startup cost, not authorization. `/api/admin/*` remains server-gated; `/design` reads no private data; and a hidden link or unloaded component is not a security boundary.

Because `admin.md`’s wording carries a security rule, follow the important-doc before/after approval process.

### Answers to the stated suspicions

- **2.5%:** build it. The current byte saving is small, but an enforced route boundary prevents future admin dependencies from silently entering reader startup. Call it an architectural guard, not a demonstrated speed improvement.
- **Second eager edge:** none found at the stated base. Removing `App`’s two page imports and `params.ts`’s `admin-columns` import removes all six named private modules from the eager source closure.
- **Graph test:** source is suitable only with the AST/resolution controls in F4; emitted-manifest and request evidence remain necessary.
- **Time-to-readable-prose:** local preview may expose parse/evaluation savings but cannot represent real transfer latency. Bytes/request-set are the acceptance result; TTR may honestly be “no detectable change.”

No repository file was changed by me. During the review, an unrelated untracked `scripts/client-eager-graph.ts` appeared in the shared worktree; it was not part of the candidate described in the prompt.