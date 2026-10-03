# A home-screen app reloads itself when a page's code has moved

Report `spya-u6uba0` (Sentry `SPIDERYARN-READING2-BK`), from Greg, 2026-10-03, about `/changelog`:

> When I open the change log page on an iPad, it gives me an error. I don't know why. It only seems
> to be on an iPad. And if I, so I'm using, I've done that thing where you share it to the home
> screen, so it's got an icon on the home screen. I don't know if that's related. I haven't tried it
> in a browser. If you need me to, I can do that, but maybe you can see the problem yourself.
>
> — Greg, 2026-10-03

Up: [plans.md](../project/plans.md). The page is [changelog.md § The page](../project/changelog.md#the-page);
the error it shows is `LazyPage.tsx` § `ChunkBoundary`, and its words are governed by
[copy.md](../project/copy.md).

## What is wrong

**The home-screen icon is related** (for the failure reproduced here; § What is and is not established has the part that is not). Nothing about `/changelog` is broken
in Safari's engine: opened fresh in WebKit with an iPad's user agent, the live build draws all 97
releases with no error.

What breaks is a copy of the app that has been open across a deploy:

```
 09:00  iPad opens the app from its icon      → the browser holds build A's code
 12:53  we deploy build B                     → build A's files are gone from the server
 19:04  Greg taps "What's new"                → build A asks for ITS changelog file,
                                                 ChangelogPage-BhbTsp2v.js
                                              → the server no longer has it, and answers
                                                 with the home page's HTML instead (200)
                                              → WebKit: "'text/html' is not a valid
                                                 JavaScript MIME type"
                                              → "Part of Spideryarn didn't arrive … [chunk]"
```

`/changelog` is one of the few pages whose code is fetched only when somebody goes there
(`/help`, `/design` and `/admin` are the others), which is why it is the one that shows this.

**Why only the iPad.** A laptop tab gets reloaded all the time. An app opened from a home-screen
icon is never reloaded: iOS puts it to sleep and wakes the same copy, for days, and we deploy four
or five times a day. And the message's own advice — *"Reloading the page usually fixes it"* — cannot
be followed there, because **a home-screen app has no reload button and no address bar.** *Try
again* asks the server for the same dead file and gets the same answer.

### The evidence

- **Reproduced**, in WebKit with an iPad user agent (as a tab and with `navigator.standalone` set),
  and in Chromium: serve the build Greg's iPad was running (`5b769459`), load it, swap the server to
  the live build (`d3f34a0f`), follow the page's own changelog link. All three show the `[chunk]`
  message; signed in and signed out alike. The server stand-in copies production's one relevant
  behaviour, checked against production: a file that is not there answers `200 text/html`.
- **Sentry agrees about the age of his copy.** Every boundary error on Greg's account in the last
  three days came from a build that was no longer the live one: `SPIDERYARN-READING2-3H` (the
  `[chunk]` failure) on 1 October and twice on 3 October at 09:12, eleven seconds apart — which is
  *Try again* being pressed and failing — on builds one and two deploys old.
- **One thing not explained.** The error recorded 78 seconds before his report,
  `SPIDERYARN-READING2-BJ`, is a different one: the whole-app `[render]` crash, React's "element type
  is invalid", on a copy eleven hours and two deploys old. The reproduction above does not produce
  it, and Sentry holds no address for it, so it cannot be tied to `/changelog`. It is the same
  family — old code still running after a deploy — and it is deferred below with its own queue
  entry rather than guessed at.

## The fix

**When a page's code fails to arrive, ask the server whether the site has been updated since this
copy was built. If it has, reload — once — instead of showing an error.** The reader sees the
loading spinner for a moment longer and then the page they asked for.

- The question is `GET /build.json`, a small static file every deploy already publishes, holding
  the commit it was built from. The running copy knows its own commit (`build-stamp.ts`). Different
  commit ⇒ this copy is old ⇒ `location.reload()`.
- **It happens inside the loader, before React hears of a failure**, so there is no flash of the
  error and nothing is reported to Sentry for what is not a fault.
- **At most one reload per newer build**, remembered in `sessionStorage`. If the reload did not
  help — the same newer commit is still being reported and the code still does not arrive — the
  reader gets the message, not a loop. If `sessionStorage` cannot be written, there is no automatic
  reload at all, for the same reason.
- **Anything else falls through to the message as now**: the server is on the same build, the check
  itself failed (offline), or there is no build stamp (dev, tests).
- **The message gets a Reload button**, because the home-screen app has no other way to do what the
  message recommends, and it stops saying *"your tab"*:

  > Part of Spideryarn didn't arrive, so this page can't be drawn. That's a fault here, not anything
  > you did — most often Spideryarn was updated while you had it open, and the piece this page
  > needed had moved. Reloading usually fixes it. [chunk]
  >
  > **Reload** · *Try again* asks for it once more without reloading. Or go back to your shelf.

Losing nothing is what makes an unasked reload acceptable here: the four lazy pages are plain pages
the reader has only just arrived at, with no draft, no scroll position and no half-typed comment.

### Where it goes

- **New `src/web/stale-shell.ts`** — pure and injectable: `serverBuildCommit(fetch)` (never throws;
  `null` for anything that is not a 40-hex commit) and `reloadIfStale(deps)` → `true` when it started
  a reload. The decision is a pure function of three values: my commit, the server's, and the commit
  this session last reloaded for.
- **`LazyPage.tsx`** — `lazy(() => load().catch(recover))`. `recover` calls `reloadIfStale`; on
  `true` it returns a promise that never settles, so Suspense keeps the spinner until the page goes;
  otherwise it rethrows the original error and everything downstream is as today. Plus the Reload
  button and the wording.
- **`copy.md`** — its sentence about `[chunk]` says *"under an open tab"*; it gains the home-screen
  case. A pointer's wording, not a rule.
- **`web-client.md` § Shared code (client)** — a line for `stale-shell.ts`, so the next lazy import
  reuses it.

### Tests, red first

`tests/stale-shell.test.ts` (the decision, table-driven: newer build → reload; same build → no;
check failed → no; no stamp → no; already reloaded for this commit → no; storage throws → no) and
`tests/lazy-page.test.tsx`:

1. **The failing one first**: loader rejects, server reports a different commit → `reload` is
   called and the `[chunk]` alert is *not* shown. Red today.
2. Same commit → the alert, and no reload.
3. Second failure after a reload for that commit → the alert, and no second reload.
4. The alert has a Reload button that reloads.
5. The existing *"issues no request at any point"* becomes *"asks the server for nothing but
   `/build.json`"*.

Then the real thing: the two-build WebKit reproduction above, re-run with the fix built into the
"old" side, has to end on the changelog rather than the error.

## The simpler option passed over

**Only add the Reload button.** One element, no network call. Passed over because it leaves the
reader looking at an error for something that is not a fault and that we can fix without asking —
and Greg's report is exactly a reader who saw that error and did not know what it meant.

## Deferred, each with its own queue entry

1. **Notice a deploy before the reader trips over it** (`qi-wxt4gtyn`, a proposal awaiting Greg). When the app comes back to the foreground,
   check `/build.json`; if a newer build is live, make the *next* in-app navigation a full page load.
   That would cover every lazy import (maths' `temml` too), and the wider family below, without even
   the spinner. Not in v1 because it changes `router.ts`'s `navigate`, which everything goes
   through, to fix what v1 already fixes for the reported page.
2. **`SPIDERYARN-READING2-BJ`** (`qi-58e7v32s`, a proposal awaiting Greg) — the `[render]` crash on an eleven-hour-old copy, not reproduced.
   Likely old client code meeting something newer; item 1 would shrink its window. Needs its own
   look.

## Decisions for Greg

None blocking. One to know about: **the app now reloads itself without asking**, in the single case
where a page's code is missing *and* the server says a newer build is live. Say if you would rather
it asked.

## Stages

- [x] Stage 1 — GPT Sol reviews this plan (`--sandbox review`): build it with changes, six findings, all taken.
- [x] Stage 2 — failing tests, then `stale-shell.ts`, `LazyPage.tsx`, docs. Gates: `npm test` on the
      touched suites, `npm run typecheck`, lint on touched files, the WebKit reproduction.
- [x] Stage 3 — GPT Sol reviews the code (`--sandbox workspace-write`); postmortem; feedback note;
      queue entries for the two deferrals; push to `dev`.

## GPT Sol's plan review, and what changed

[The review](261003m-a-home-screen-app-reloads-itself-plan-review-sol.md): *build it with changes*.
Each finding was checked against the code; all six stand.

| # | Finding | What was done |
|---|---|---|
| 1 (P1) | The evidence proves the `[chunk]` failure, not that it is "the whole of" the report: `BJ`, 78 seconds before it, is a different crash and "same family" is inference. | Agreed. This plan fixes `3H`. The note says so, asks Greg which message he saw, and `BJ` has its own queue entry. See § What is and is not established. |
| 2 (P1) | A commit is not a build: one commit redeployed yields different files. | The comparison is commit **and** build time, both already compiled into the client and published in `build.json` from one stamp (checked in a real build). "Different", not "newer": a rollback strands a copy the same way. |
| 3 (P1) | The check is asynchronous, so it can reload a page the reader has since moved to. | The address is read before the check and again after; if it changed there is no note and no reload. |
| 4 (P1) | "Never throws" is not "never hangs". | A four-second deadline, raced as well as aborted. |
| 5 (P2) | "Plain pages with no state" is false — vouchers has form fields, Help a query. | The true reason: the failure happens *before the page mounts*, so there is no state yet. Reworded below. |
| 6 (P2) | Ask for `/build.json` uncached, explicitly. | `cache: "no-store"`, asserted. |

Sol also asked for a real installed-iPad check, because WebKit with `navigator.standalone` set does
not emulate iOS putting the app to sleep and waking it. That cannot be done from the box; it is the
one thing in the note Greg is asked to do.

### What is and is not established

- **Established:** an old copy opening `/changelog` shows `[chunk]`, on any engine; this is what
  `3H` recorded on Greg's account three times; the fix removes it (WebKit, two real builds).
- **Not established:** that `[chunk]` is the message Greg was looking at when he wrote the report.
  The crash nearest it in time is `BJ`, `[render]`. "The home-screen icon is the whole of it" in
  § What is wrong is true of `3H` and unproven of `BJ`.

### Why an unasked reload loses nothing (replacing the paragraph above)

Not because these pages hold no state — `/admin/vouchers` has a form and `/help` a search box — but
because the loader fails **before the page exists**: there is no form yet to have typed into. With
finding 3 fixed, the reload can only ever replace the spinner the reader is looking at.

## GPT Sol's code review

[The review](261003m-a-home-screen-app-reloads-itself-code-review-sol.md): *ship it with the fixes
made*. Its diff was read line by line.

| # | Finding | Outcome |
|---|---|---|
| P1 | The loader waited for ever if `location.reload()` returned without replacing the document. | Fixed by Sol: the original error is released after five seconds, so the reader gets `[chunk]` and its Reload button. Test seen red by Sol. |
| P2 | The lazy-page test claimed a reload while its stub only returned `true`. | Fixed by Sol: the stub calls `reloadPage`, and the test asserts it. |
| P2 | The postmortem and two comments still said Greg certainly saw `[chunk]`. | Fixed by me: all three now say what Sentry recorded and that which screen he saw is not established. |
| P2 | `scripts/build-stamp.ts` and `vite.config.ts` called `builtAt` "informational, never asserted" — it is now half of the build identity. | Fixed by me: both comments say the client compares it and the two must be one string. |
| P3 | Any rejected lazy import is treated as possibly stale, including a bug in the page's own module. | Accepted: at worst one needless reload when a different build is live. It cannot loop and nothing mounted is lost. |

Sol could not run the full suite (its sandbox has no database) and wrote that a pre-review run was
green. **No full run had been made at that point**; the one that counts is the one below.

Full `npm test` after merging `origin/dev`, 2026-10-03 20:57–21:52 BST: 1,494 files passed, 1 skipped, exit 0.
