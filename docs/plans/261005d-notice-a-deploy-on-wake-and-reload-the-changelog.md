# Notice a deploy when the app wakes, and refresh "What's new" when there is something new

Up: [plans.md](../project/plans.md). This is the wider fix deferred from
[261003m](261003m-a-home-screen-app-reloads-itself-when-a-page-s-code-has-moved.md) (queue item
`qi-wxt4gtyn`), with a second report folded in by the Overseer. The class is named in the postmortem
[261003f](../postmortems/261003f-a-home-screen-app-outlives-every-deploy-and-has-no-reload-button.md):
**a client older than its server.**

Authorised by Greg, 2026-10-04, on the Overseer's list of small queued fixes:

> If you're confident, address all of the Q-queue-yeses
>
> — Greg, 2026-10-04

And report `spya-ym9dum`, from Greg, 2026-10-04, from `/changelog#release-126`:

> Could you set this page to somehow poll every 15 minutes or so, and if there's a new version, then
> refresh the page.
>
> — Greg, 2026-10-04

**Read § After GPT Sol's plan review first.** It reduced this plan: part 2 below (a full page load
on the next navigation) is **not built**, and parts 1 and 3 changed. The sections in between are the
plan as first written, kept so the reasoning for the reduction can be followed.

## What is wrong

A copy of the app opened from a home-screen icon is never reloaded: iOS puts it to sleep and wakes
the same copy for days, across four or five deploys a day. 261003m fixed the one failure it could
reproduce (a page whose code is fetched on demand, and has moved, now reloads itself). Everything
else an old copy can trip on is still there:

- maths' `temml` import, fetched on demand with no recovery;
- old client code meeting data from a newer server (the suspected shape of the unexplained
  `[render]` crash, `SPIDERYARN-READING2-BJ`, queue item `qi-58e7v32s`, looked at beside this plan);
- and the plainest one, which is Greg's second report: `/changelog` is compiled into the bundle, so
  an old copy shows an old list and nothing ever tells it there is a newer one.

## The change, in three parts

All three ask one question that already exists: `serverBuild()` in `src/web/stale-shell.ts`, which
reads `/build.json` (a static file every deploy publishes) and compares it to the build compiled
into this copy.

### 1. A watcher: is a different build live?

New in `stale-shell.ts`: `watchForDeploy()`, installed once from `main.tsx`.

- Asks `/build.json` **when the page becomes visible** (`visibilitychange`, and `pageshow` for a
  page restored from the back-forward cache) and **every 15 minutes while it is visible**. Never
  while hidden.
- If the answer is a different build, it remembers that in a module variable (`differentBuildLive()`
  → the build's identity or `null`) and tells subscribers (`onDeployNoticed(listener)`). Once it
  knows, it stops asking: the answer cannot become "no" again for this copy.
- Off a build (dev, tests: no stamp) it does nothing at all, as `reloadIfStale` already does.
- At most one request in flight; a failed or slow check is "don't know" and changes nothing.

### 2. The next move to a different page is a real page load

`navigate()` in `src/web/router.ts`: when the watcher has noticed a different build **and the
destination's path differs from the current one**, it calls `location.assign(href)` instead of
`history.pushState`. The reader sees an ordinary page load and arrives on the new build.

```
 old copy, build A                         server now serves build B
 ─────────────────                         ─────────────────────────
 wake from sleep ──── GET /build.json ───▶ "B"            (watcher remembers: B is live)
 reader reads on, nothing changes
 reader taps a link to another page
   navigate("/read/x")  ── path differs ─▶ location.assign  ──▶ fresh load of B at /read/x
```

Deliberately **not** a full load:

- **A navigation that stays on the same path** — a mode change, `?at=`, *Run again* on Metadata. It
  is the same page, and a reload there would throw away what the reader has open.
- **`replace: true` navigations** — these are redirects the app makes for itself mid-render, not a
  reader moving. (To check in the code: whether any `replace` call crosses a path and would be
  better as a load. If none do, the rule is simply "push, different path".)
- **When the browser says it is offline** (`navigator.onLine === false`, the one direction that
  value can be trusted — `useOnline.ts`). The app has no service worker, so a full load offline is a
  browser error page, in an app with no back button; in-tab navigation between cached articles
  works offline today and must go on working.
- **Back and Forward.** Those are the browser's own and do not go through `navigate()`.

It cannot loop: a load happens only when the reader navigates, and the loaded copy is the new build.
If the load somehow lands on the old build again (a cached shell), the next wake notices again and
the next navigation loads again — one load per reader navigation, never a blink.

What the reader loses on that one navigation is whatever in-memory state survives an ordinary
in-app navigation: almost nothing, since a different path is a different page. Scroll position on a
later Back is the one thing to check in the browser.

### 3. "What's new" reloads itself when there is something new

`ChangelogPage` subscribes to the watcher. When a different build is noticed **while the reader is
on `/changelog`** it reloads the page, through the same once-per-build note `reloadIfStale` keeps in
`sessionStorage`, so a shell and a `build.json` that disagree cannot make it blink.

That is Greg's request as written: the 15-minute timer is part 1's, and so is the check on wake,
which matters more on an iPad because a sleeping app's timers do not run. The address (and so
`#release-126`) survives the reload. Which releases the reader had opened by hand does not; that is
the cost of what was asked for, and it is small.

No other page reloads itself. An unasked reload under an article somebody is reading is not
something anyone asked for.

## The simpler options passed over

- **Only part 3** (a timer on the changelog page). Answers the second report and leaves the class
  open. The watcher it needs is most of part 2 already.
- **Reload any page the moment a deploy is noticed.** Fewer parts, and it takes the page away from
  a reader mid-sentence, several times a day. Rejected.
- **A "new version, tap to reload" banner.** A new thing on screen four or five times a day, to
  solve something the reader should not have to know about. Not in v1; easy to add on the same
  watcher if Greg wants it.

## Tests, red first

- `tests/stale-shell.test.ts` — the watcher, with everything injected (fetch, a fake document's
  visibility, a fake timer): asks on becoming visible; asks every 15 minutes while visible and not
  while hidden; remembers a different build and tells subscribers once; stops asking once it knows;
  same build / failed check / no stamp → nothing.
- `tests/router.test.ts` (or a new file beside it) — **the failing one first**: with a different
  build noticed, `navigate("/changelog")` from `/` calls the injected page-load and writes no history
  entry. Then: same path, different query → `pushState` as now; `replace` → as now; offline → as
  now; nothing noticed → as now.
- `tests/changelog-page.test.tsx` — a noticed deploy reloads the page once; a second notice for the
  same build does not.
- **The two-build browser check, kept as a script**: `scripts/check-two-builds.ts`. Builds the tree
  twice (one commit built twice is two builds — different build time, different hashed files, which
  is exactly why `buildIdentity` includes the time), serves the first, loads it in Playwright
  WebKit with an iPad user agent, swaps the server to the second, then asserts: (a) after a
  visibility change, clicking a link to another page is a full load that lands on build two; (b) an
  open `/changelog` reloads itself onto build two; (c) with the watcher's answer withheld, 261003m's
  lazy-route reload still works. Run by hand and before a change to this area; it takes two builds,
  so it is not in `npm test`. The postmortem said this script was worth keeping once it had a
  second thing to assert, and now it has.

## Docs

`web-client.md` § Shared code (client) (the `stale-shell.ts` line), `changelog.md` § The page,
`help-page.md` if `/help` says anything about updates, the postmortem's "deferred" paragraph, and
the feedback notes: a new one for `spya-ym9dum`, and a line in `261003_1905` saying `qi-wxt4gtyn` is
built.

## Stages

- [ ] 1 — GPT Sol reviews this plan (read-only).
- [ ] 2 — failing tests, then the watcher, `navigate()`, the changelog subscription, the script,
      docs. Gates: touched suites, `npm run typecheck`, lint on touched files, the two-build script.
- [ ] 3 — GPT Sol code review (write-capable), browser check at desktop, iPad and phone widths,
      full `npm test`, feedback note, push to `dev`.

## Decisions for Greg

None blocking. Two to know about, both reversible in a line:

- **A link to another page is occasionally a full page load** (a brief white flash instead of an
  instant swap), only on the first navigation after a deploy landed while the app was open.
- **"What's new" reloads itself without asking** when a new build is live. That is what was asked
  for; no other page does.

(Superseded by the section below: the first of these is not built.)

## After GPT Sol's plan review: what is built, and what is not

[The review](261005d-notice-a-deploy-on-wake-plan-review-sol.md): *build it with changes*, and its
recommendation was to **reduce**: build the watcher and the changelog refresh, postpone the full
page load on navigation. Each finding was checked against the code. Taken.

**Why part 2 is not built.** The plan said a full load on a navigation to a different path loses
"almost nothing". That is false, and the three ways it is false are all work a reader did:

- **Unsent Chat and Remember text** is kept in a module `Map` on purpose, so it survives going to
  Metadata and back (`src/web/chat-draft.ts`). A page load empties it. So is a **Feedback report
  being written**: the dialog is mounted once for the whole signed-in app so that its draft
  survives navigation (`FeedbackButton.tsx` § `FeedbackHost`).
- **An upload in flight.** Adding a PDF navigates to `/add/upload/<id>` *while the bytes are still
  going* (`UploadPicker.tsx`, `uploadEngine.ts`), and a batch keeps its waiting files in memory. The
  rule would have turned the ordinary act of adding a file into an unload mid-transfer.
- **Save ordering.** An in-app navigation waits for an older save before sending the newest text
  (`useAutosavedText.ts`); a page unload sends at once, so the older save can land last and win.

A "different path" test cannot see any of these. Doing it properly means the app being able to
answer *is it safe to unload right now?* across at least five subsystems, and that is a piece of
machinery `navigate()` does not have today. What part 2 would buy is a narrower window for a crash
class that has produced one bug in a month (fixed below), on top of a lazy-route recovery that
already works. Not worth a P0's worth of risk in the function everything goes through. It goes back
to Greg as a question rather than being forced.

### What is built

**1. The watcher**, as in part 1, with the review's corrections:

- It records *a different build was seen* and **keeps checking** while the page is visible. "Once it
  knows, it stops" was wrong: a reload can land on the old shell again, and a later deploy would
  then never be noticed (F5).
- A subscriber gets the current answer when it subscribes, not only future changes: the notice can
  arrive while `/changelog`'s code is still loading (F9).
- Every check starts only when the document is visible, including from `pageshow`, which also fires
  on first load and for background pages; the timer is cancelled while hidden and rearmed after a
  failed check; one request in flight (F9).
- **Only on a production build** (`import.meta.env.PROD`), not "when there is a stamp": the dev
  server defines the stamp too (F7). In dev there is also no `/build.json`, so it was harmless, but
  the gate should say what it means.

**3. "What's new" reloads itself**, when a different build is seen while the reader is on
`/changelog` and the page is visible, **and nothing would be lost**. New: one function,
`safeToReload()`, that says no when

- the reader is not connected (`offline.ts`'s `connected`, as well as `navigator.onLine`) (F4);
- any Chat or Remember draft is held, or the Feedback dialog holds text or a screenshot (F1);
- an upload or a batch is in flight (F2).

A refused reload is simply tried again at the next check. (This paragraph first said pending
autosaves cannot exist on `/changelog`. They can; see the code review below, F12.) `safeToReload()` is the start of what part 2 would need, and is written to be
added to.

**The loop guard remembers every build it has reloaded for**, not just the last (F6). Sol's probe:
with the shell stuck on A and `/build.json` alternating B, C, B, the single-value note allowed a
reload every time. The note becomes a short list in `sessionStorage`; `reloadIfStale` (the
lazy-route recovery) shares it. A build already reloaded for is never reloaded for again in that
session, by either caller.

### Tests

As listed above for the watcher and the changelog, minus the router cases, plus one that can go red
for each refusal: a held draft, a Feedback draft, an upload in flight, `connected: false` with
`navigator.onLine` true, a notice that arrives before the subscriber, a notice then hidden, and
alternating B/C answers across a recreated document (F10).

**The two-build script** (F11) asserts that the two builds' identities differ, that the page that
ends up running reports **build two's compiled-in stamp** (not merely that the URL is right), and
that with the reload switched off the assertion fails. Its lazy-route case goes: that recovery has
its own tests and its own check in 261003m.

## The unexplained `[render]` crash, found (`qi-58e7v32s`)

`SPIDERYARN-READING2-BJ`, and a twin found while looking, `-CB` (2026-10-04 11:18 UTC, same account,
same stack, release `62ad6980`).

**Cause.** The Metadata page draws one row per pipeline stage the server reports, with an icon
looked up by the stage's name: `STAGE_ICONS[step]` in `src/web/Metadata.tsx` § `StageRow`. The deploy
of `d3f34a0f` (3 October, 18:37 BST) added a stage, `relations`. Every copy of the app built before
it had no icon for that name, got `undefined`, and React refused it as an element type, which takes
the whole app to the `[render]` screen. The section the rows live in is mounted even while shut, so
opening Metadata on any article was enough.

**How sure.** The mechanism is reproduced: `tests/metadata-unknown-stage.test.tsx` was red with
React's exact message (*"Element type is invalid … Check the render method of `Chip`"*) and is green
with the fix. That it is what Sentry recorded is strongly supported, not proven: both events are on
builds from before `relations`, both after the deploy that added it, none before it; the stack is
React mounting a single child of a host element, which is what `Chip` is. Sentry holds no address
and no component stack for either, so it cannot be tied to the Metadata page directly, and which
screen Greg was looking at when he wrote `spya-u6uba0` is still not established.

**Fix.** `stageIcon(step)`: a stage this copy has never heard of gets a neutral glyph. The server
already sends the row's label, so the row is complete. One other lookup of the same table
(`RerunRow`) takes its key from the client's own list and cannot miss.

**The class** is the postmortem's: *a client older than its server*. The particular shape, worth a
name of its own: **a `Record<Union, …>` indexed by a value off the wire**. The type promises every
key is present, and it is, for the union this bundle was compiled with.

## Stages (as built)

- [x] 1 — GPT Sol's plan review: build it with changes; reduced as above.
- [x] 2 — the `[render]` crash: failing test, fix. `f87a3ca94`.
- [x] 3 — the watcher, `safeToReload()`, the changelog refresh, the shared loop guard, the script,
      docs: `0019c8c0c`. GPT Sol's code review and what followed are below.

## GPT Sol's code review

[The review](261005d-notice-a-deploy-on-wake-code-review-sol.md) of `f87a3ca94` and `0019c8c0c`:
*do not ship*, on one finding it was not allowed to fix (F12). Its diff was read line by line, and
each finding checked.

| # | Finding | Outcome |
|---|---|---|
| F12 (P0) | A box that unmounts with newer words behind an unanswered save keeps the only copy of them in a callback; the field's leave warning is gone, so `safeToReload()` said yes. | Fixed by me, red first (`tests/autosaved-text.test.tsx`): that wait now holds the tab through `unload-guard.ts`, for the reason `unsaved`, which is a veto. `ProfileBox.tsx` § `useUnsavedWarning` moved behind the same guard, so every `beforeunload` in the client is one counted fact. |
| F13 (P0) | The Feedback veto missed audio: recording, transcribing, or failed and kept for retry. | Fixed by Sol, three tests red first. |
| F14 (P1) | The watcher's requests did not update the connectivity fact, in either direction. | Fixed by Sol: a successful check says connected, a transport failure says not; a deadline abort says neither. |
| F15 (P1) | The hook read the address in an effect, which can run after the reader has moved, and would have adopted the new page as the one to reload. | Fixed by Sol; I changed its literal `/changelog` to `parseRoute(...).kind === "changelog"` so the trailing-slash spelling counts. |
| F16 (P1) | `__proto__`, `constructor` and `toString` as stage names got past the icon fallback. | Fixed by Sol: own keys only. |
| F17 (P2) | The page tests supplied their own `safe`, so the real wiring was untested. | Fixed by Sol: four cases through the real check; I added a fifth for `unsaved`. |
| F18 (P0) | The older lazy-route reload (`reloadIfStale`, 261003m) never asked whether a reload was safe: a Chat draft on an article was lost when a lazy page's code had moved. Older than this plan. | Fixed by me, red first (`tests/stale-shell.test.ts`): it asks `safeToReload()`; refused, the reader gets the `[chunk]` message and its Reload button, and the one reload is not spent. |
| F19 (P1) | `?by=constructor` on the shelf: `id in natural` accepts inherited names, and the shelf then calls what it finds. | Fixed by me, red first (`tests/table-sort.test.ts`): own keys only. |
| F20 (P2) | Six other tables indexed by a value off the wire (`SourceScanNotice`, `MirrorPanel`, `CriteriaPanel`, `MarginaliaColumn`, `ProfilePage`, `useGptLive`). No wrong behaviour with today's server. | **Not fixed.** Listed in the review with lines; reported to the Overseer as a follow-up, since each wants its own decision about what an unknown value should draw. |

F12 and F18 were fixed after the review's snapshot, so each gets a narrow check of the fix (below),
as engineering-manager.md asks. Discovery is closed.

**The two-build check**, `npx tsx scripts/check-two-builds.ts`, run by the implementing agent on
`0019c8c0c`: PASS (the open `/changelog` reloaded and the running client was build two), and with
`--control` (`/build.json` still answering build one) every assertion failed, as it must.

**Browser check**, Sonnet, Playwright and system Chrome, desktop 1440, iPad 1024 and phone 390:
`/changelog` signed in and out loads, opens and closes a release, asks `/build.json` zero times in
dev and does not reload on a faked hide-and-show; the Metadata page draws an intercepted unknown
stage as a row with the dashed circle, aligned with the others. One signed-out run on a cold dev
server lost its `window` marker at two widths and did not on a re-run; with zero `/build.json`
requests it cannot have been this code.

## Decisions for Greg (as built)

One question, in the debrief: whether the wider fix is wanted at all, and in which form. One thing
to know about: **"What's new" reloads itself without asking** when a new build is live and nothing
unsent would be lost. That is what was asked for; no other page does.
