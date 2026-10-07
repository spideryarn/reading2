# Plan review: a home-screen app reloads itself when a page's code has moved

You are reviewing a plan before it is built. Read-only: do not edit anything.

Read, in this order:

1. `docs/plans/261003m-a-home-screen-app-reloads-itself-when-a-page-s-code-has-moved.md` — the plan.
2. `src/web/LazyPage.tsx` — the boundary it changes, and its header.
3. `src/web/build-stamp.ts`, `scripts/build-stamp.ts`, and where `dist/build.json` is written
   (`vite.config.ts`).
4. `vercel.json` — the rewrite that makes a missing asset answer `200 text/html`.
5. `tests/lazy-page.test.tsx` — the existing tests.
6. `docs/project/copy.md`, the paragraph on the three error boundaries.

The evidence behind the diagnosis, which you cannot re-run but can judge:

- Two client builds were made, `5b769459` (the build a Sentry event says the reporter's iPad was
  running) and `d3f34a0f` (live at the time). A static server that answers a missing file with
  `200 text/html`, as production does (checked with curl against production), served the old one;
  the page was loaded in Playwright WebKit with an iPad user agent; the server was switched to the
  new build; the page's own `/changelog` link was followed. Result in WebKit (tab, and with
  `navigator.standalone` true) and in Chromium: the `[chunk]` message, console error
  `'text/html' is not a valid JavaScript MIME type for module script …/ChangelogPage-BhbTsp2v.js`.
- Control: the new build opened fresh at `/changelog` in the same WebKit draws 97 releases.
- Sentry: `SPIDERYARN-READING2-3H` (boundary `lazy-route`, TypeError) for this user on 1 Oct and
  twice on 3 Oct, each on a release that was not the live one. `SPIDERYARN-READING2-BJ` (boundary
  `app`, React error from `createFiberFromTypeAndProps` under a host component) 78 seconds before the
  report, on a release two deploys old; not reproduced.

Questions I want answered, most important first:

1. **Is the conclusion right?** Does the evidence support "the page is fine; an old copy of the app
   asked for a file a deploy removed", or is there a reading of it I have explained away? In
   particular, is deferring `BJ` honest, or is it likely to be the thing the reporter actually saw,
   in which case this plan fixes the wrong error?
2. **Can the automatic reload loop, or fire when it should not?** Think about: `build.json` and
   `index.html` cached or deployed out of step; a deploy landing between the check and the reload;
   `sessionStorage` in an iOS home-screen app (is it kept across a reload? across a resume?);
   private browsing; a commit that is not 40 hex; several lazy routes failing in one session.
3. **Is `lazy(() => load().catch(recover))` with a never-settling promise sound in React 19?** Any
   interaction with the *Try again* path (a fresh lazy per attempt), with StrictMode, or with the
   boundary's `routeKey` reset.
4. **Is anything lost by reloading unasked** on `/changelog`, `/help`, `/design`, `/admin` (three
   admin sub-pages)? Any of them hold state a reload would drop?
5. **Is there a simpler design** that gives the same result, or is a piece of this plan unnecessary?
6. The named deferrals: is either one something that must not be deferred?

Answer with findings ordered by severity (P0 blocks, P1 should change the plan, P2 worth doing,
P3 note), each with the file and line it rests on, and finish with a one-line **Verdict:** —
`build it`, `build it with changes`, or `do not build`.
