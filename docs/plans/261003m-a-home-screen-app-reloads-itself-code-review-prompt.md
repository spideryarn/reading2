# Code review: an old copy of the app reloads itself when a page's code has moved

You reviewed the plan for this earlier today; this is the code built from it. You may edit: fix what
you find inside this change's own files, with a test seen red for each fix, and report anything
wider for me to decide. Do not commit. Do not touch `vercel.json`, `infra/`, `.env.local` or
anything under `docs/project/security-map.md`'s defences.

Read:

1. `docs/plans/261003m-a-home-screen-app-reloads-itself-when-a-page-s-code-has-moved.md` — the plan,
   including the section recording your six plan-review findings and what was done about each.
2. `docs/plans/261003m-a-home-screen-app-reloads-itself-code-review.diff` — the scoped diff
   (commit `65db02d69`, `src/`, `tests/`, `docs/project/`).
3. The files themselves: `src/web/stale-shell.ts`, `src/web/LazyPage.tsx`,
   `tests/stale-shell.test.ts`, `tests/lazy-page.test.tsx`.
4. `docs/plans/261003m-a-home-screen-app-reloads-itself-two-build-check.ts.txt` — the Playwright
   WebKit script that produced the browser evidence below.
5. `src/web/build-stamp.ts`, `scripts/build-stamp.ts`, `vite.config.ts` (the `define` block and
   `generateBundle`), `vercel.json`.

Evidence, with how each number was produced:

- Unit: `npx vitest run tests/stale-shell.test.ts tests/lazy-page.test.tsx` — 35 pass. Before the
  fix existed, three of the new lazy-page tests were red. The three guards added after your plan
  review (address unchanged, deadline, commit+builtAt identity) were each removed with `sed` and
  seven tests went red, then restored.
- `npm run typecheck` clean; `biome lint` clean on the four files; `tests/doc-links.test.ts` and
  `tests/eager-client-graph.test.ts` pass.
- Browser, Playwright WebKit, iPad user agent, signed in against local Supabase, `/api` proxied to a
  dev server, static files from a switchable directory that answers a missing file with
  `200 text/html` as production does:
  - Unfixed build `5b769459`, then switch to build `d3f34a0f`, follow the changelog link → `[chunk]`.
  - Same with the fix compiled into the old side → the changelog page, 97 releases, still signed in.
  - Fix compiled in, "new" side = same commit with a different `builtAt` and the changelog chunk
    deleted (a reload cannot help) → exactly one reload, then `[chunk]` with the Reload button; no
    loop.

What I want checked, most important first:

1. **Is the conclusion I am about to tell Greg correct?** The note
   (`docs/user-feedback/261003_1905-changelog-errors-on-an-ipad-home-screen-app.md`) says the
   reported error was the stale-copy `[chunk]` failure, that it is fixed on `dev`, and that a second
   crash (`SPIDERYARN-READING2-BJ`) is unexplained and queued separately. Its ending is `shipped`.
   Say plainly if that overclaims.
2. **Can `reloadIfStale` reload when it should not, loop, or hang?** Trace it, do not read the
   comments: the build-identity comparison against what `vite.config.ts` really emits and what
   `buildTime()` really returns in a production bundle (are they byte-identical strings?); the
   `sessionStorage` guard across a reload; the address check; the deadline; what happens when
   `/build.json` is served by the SPA rewrite.
3. **`LazyPage.tsx`**: the `load().catch(orReloadIfStale)` wrapper and the never-settling promise —
   any path where the reader is left on a spinner for ever without a reload actually happening
   (for instance `location.reload()` being a no-op or throwing)? Any change to *Try again* or to the
   `routeKey` reset?
4. **Do the tests test the thing?** Look for an assertion that passes for the wrong reason — the
   `vi.mock` of `stale-shell.js` in the lazy-page suite in particular — and for a branch with no
   test.
5. Wording of the message (`docs/project/copy.md` rules), and the Reload button's accessibility.
6. Anything in the diff that is more than it needs to be.

Answer with findings ordered by severity (P0 blocks, P1 should change, P2 worth doing, P3 note),
each with file and line, **say for each whether you fixed it**, list every file you changed, and
finish with a one-line **Verdict:** — `ship it`, `ship it with the fixes made`, or `do not ship`.
