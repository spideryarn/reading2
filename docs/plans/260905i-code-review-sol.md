Verdict: approve under your rubric. I found no P0/P1 and no reader-route regression. The split is real today, but the durable guard has two false-green cases worth closing before commit because that guard is the main justification for landing a 1.5% reduction.

### Findings

**F4 remains — P2 — established: the graph guard can still pass while the boundary is false**

(a) I demonstrated two false greens without changing the tree:

- Injecting this into eager `App.tsx` left all five graph tests green:

```ts
const modules = import.meta.glob("./AdminPage.tsx", { eager: true });
```

Vite expands that to an eager import, but `edgeAt()` recognizes only import/export declarations and `import()`. The repo’s existing `client-imports.test.ts` already documents this exact Vite construct.

- Adding a new `review-admin-chart.ts`, importing it statically from both `App.tsx` and `AdminPage.tsx`, also left all five tests green. The generated closure contained the new eager admin module, but the assertion checks only the fixed six-file `ROUTE_PRIVATE` list. This contradicts the claim that “the next thing added” cannot enter startup unnoticed in [performance.md](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/docs/project/performance.md:1103).

(b) Make two small changes:

1. Fail closed on any `import.meta.glob*` encountered in the eager closure until the walker explicitly models its eager/lazy options and expands its patterns.
2. Walk the static closures of `AdminPage.tsx` and `DesignPage.tsx`, intersect them with the eager closure, and compare that intersection against an explicit allowlist of intentionally shared reader dependencies. A new dependency appearing in both closures then requires a reviewed allowlist change.

The current six-file assertion can remain as a readable positive statement.

---

**F9 — P2 — established: `routeKey` does not always clear a rejected lazy payload**

(a) A throwaway jsdom harness rendered one shared loader under `routeKey="design"`, rejected its first call, then rendered the same loader under `routeKey="admin:home"`. Result:

```json
{"calls":1,"text":"… [chunk] …"}
```

The boundary remounted, but [LazyPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/src/web/LazyPage.tsx:163) reused the rejected lazy type because `routeKey` is absent from the memo dependencies.

All four current routes use distinct loader identities, so today’s route orders work. This is an abstraction-level hole rather than current user-visible behavior.

(b) Exact change:

```ts
  }, [load, routeKey, attempt]);
```

Add the shared-loader route-change case to `lazy-page.test.tsx`. The `attempt` counter may continue across routes; it becomes harmless once `routeKey` rebuilds the lazy payload.

For network-fetch failures, retrying the dynamic import is meaningful: the HTML module-fetch algorithm removes a failed fetch from the module map, permitting another fetch. [WHATWG HTML module fetching](https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script)

---

**F10 — P2 — established: the graph test requires a writable checkout**

(a) The requested direct command failed before collecting any tests:

```text
EROFS: read-only file system, open '.../logs/eager-client-graph.txt'
Test Files 1 failed
tests/eager-client-graph.test.ts (0 test)
```

After redirecting only that diagnostic write to `/tmp`, the unchanged assertions passed 5/5. The unconditional write is at [eager-client-graph.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/tests/eager-client-graph.test.ts:270).

(b) Make report generation opt-in:

```ts
const output = process.env.SPIDERYARN_EAGER_GRAPH_OUTPUT;
if (output) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${[...closure.files].map(rel).sort().join("\n")}\n`);
}
```

Ordinary test runs then remain read-only; measurement runs can request an artifact explicitly.

---

**F8 remains — P3 — established: several “in everybody’s bundle” claims remain**

(a) False present-tense wording remains in:

- [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/src/web/App.tsx:511), twice
- [router.ts](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/src/web/router.ts:272)
- [admin-only-routes.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/tests/admin-only-routes.test.tsx:11)
- [admin.md](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/docs/project/admin.md:35), twice
- [design-css-overview.md](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/docs/project/design-css-overview.md:638)
- [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes/src/routes.ts:6754)

Also change App’s “not in the reader’s bundle” at line 299 to “not in the reader’s initial download.”

(b) Exact replacement concept for those passages:

> The components are absent from the initial reader download, but their chunks are public assets served to anyone who requests them. Hiding the route or link therefore remains a courtesy, not authorisation; the server’s `/api/admin/*` refusal is still the only gate.

Historical plans and user-feedback records should retain their original wording.

### Checks and suspicions

- Current eager closure: 264 files; none of the six named route-private modules appears.
- `tests/lazy-page.test.tsx`: 6/6 passed.
- `tests/eager-client-graph.test.ts`: assertions 5/5 passed after redirecting its diagnostic write.
- `git diff --check` passed on the submitted modified paths.
- The two new shared chunks do not break Sentry ordering: `boot.tsx` initializes monitoring before importing `main`, and failures in its static dependencies reject that import. In-tab offline navigation is unchanged because those static chunks must already have loaded before React starts.
- Pre-importing the two pages in `admin-only-routes.test.tsx` does not mask a bad named-export adapter; the real loaders still execute and the heading/`[chunk]` assertions distinguish the result. It deliberately does not test cold transformation or network loading.
- The 1.5% result is still defensible to land as an architectural boundary, not as a demonstrated speed improvement. F4 should be tightened so that justification is actually durable.

`performance.md` became modified while this live review was running; I reviewed its new boundary claim where relevant above. No repository source or documentation file was changed by me, and all temporary harness files were removed.