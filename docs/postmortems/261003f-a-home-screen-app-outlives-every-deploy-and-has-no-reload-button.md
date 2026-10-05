# A home-screen app outlives every deploy, and has no reload button

Up: [postmortems.md](../project/postmortems.md). The fix and its evidence are in
[261003m](../plans/261003m-a-home-screen-app-reloads-itself-when-a-page-s-code-has-moved.md); the
report is [spya-u6uba0](../user-feedback/261003_1905-changelog-errors-on-an-ipad-home-screen-app.md).

## What happened

Greg reported that `/changelog` gave an error on his iPad, opened from the home-screen icon, and
never on his laptop. Sentry had *"Part of Spideryarn didn't arrive … Reloading the page usually
fixes it. [chunk]"* on his account on 1 October and twice on the morning of the 3rd
(`SPIDERYARN-READING2-3H`), each time from a copy of the app older than the live deploy.

**Which screen he was looking at when he wrote the report is not established.** The crash nearest it
in time is a different one (`BJ`, below). This postmortem is about the `[chunk]` failure, which was
reproduced and is fixed.

## The real root cause

`/changelog`'s code is fetched when somebody goes there. A deploy replaces every hashed file, so a
copy of the app loaded before the deploy asks for a file the server no longer has; production
answers a missing file with the shell's HTML and a 200, and the browser refuses HTML as a module.

That much was known when `LazyPage.tsx` was written, and its message says so. What was not known is
**how old a copy can be, and that the reader may have no way to replace it.** The design assumed a
*tab*: short-lived, with a reload button. On 2026-08-28 the app became installable to a home screen,
and a home-screen app is the opposite on both counts — iOS suspends and resumes the same copy for
days, across four or five deploys a day, and it has no reload button and no address bar. The
message's one piece of advice could not be followed in the one place the failure was routine.

## The class: a client older than its server

Every test, every browser check and every reviewer loads the app fresh, so the client under test is
always exactly as old as the server. **No check here has ever run a copy of the client against a
newer deploy.** Anything that only goes wrong in that state — a file that moved, a response whose
shape changed, an icon table missing a key the server now sends — is invisible until a reader with a
long-lived copy finds it, and the longest-lived copy belongs to the home-screen app.

The state "old client, new server" does not exist at the moment anyone looks, so looking harder
does not find it; something has to construct it.

**Siblings found:**

- `src/web/maths.ts` fetches `temml` on demand with no recovery. Its hash was unchanged between the
  two builds compared here, so it survives most deploys by luck.
- `SPIDERYARN-READING2-BJ`, 78 seconds before the report: the whole-app `[render]` crash on a copy
  eleven hours and two deploys old. Not reproduced; same state, different failure.
  **A matching mechanism reproduced on 2026-10-05**
  ([261005d](../plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md)): the Metadata
  page looked up a stage's icon by a name the newer server sent (`relations`) and the older copy's
  table lacked. The shape has a name of its own: **a `Record<Union, …>` indexed by a value off the
  wire**. The type says every key is there, and it is, for the union that bundle was compiled with.
  The link to the Sentry events is strongly supported, not proven: neither event kept an address
  or component stack. The plan records that limit.

## Which commit introduced it

Two, and neither is wrong alone. `7116e5d7d` (2026-09-06) added on-demand routes with a message
that assumes a reloadable tab. `4eede51e5` (2026-08-28) had already made the app a home-screen app.
The second commit made the first one's assumption false before it was written; nothing connected
them.

## The fix that is right for the long term

Shipped: when on-demand code does not arrive, ask `/build.json` whether a newer build is live and
reload once if so (`src/web/stale-shell.ts`); and a Reload button on the message for when it cannot.

Right for the long term, and deferred at the time with its own queue entry: **notice the deploy
before the reader trips on it** — check on return to the foreground, and make the next navigation a
full page load. That closes the window for the whole class rather than for lazy routes alone.

**Half of that exists since 2026-10-05**
([261005d](../plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md)). The check is
built: the app asks `/build.json` when it wakes and every fifteen minutes while visible, and
remembers a different build (`src/web/stale-shell.ts` § `watchForDeploy`). One page acts on it —
`/changelog` reloads itself after checking the vetoes in `safe-to-reload.ts`. The review below found
that those vetoes did not cover pending autosaves; they do now.

**The full page load on the next navigation was not built.** GPT Sol's review of that plan showed
it is not the small change it looks like: a page load throws away things this app keeps in memory
on purpose so that they survive navigation — unsent Chat, Remember and Feedback text, an upload
still sending its bytes — and swaps an ordered save for an unordered one. "The destination is a
different page" cannot see any of those. Doing it safely needs the app to be able to answer *is it
safe to unload right now?* everywhere, and `src/web/safe-to-reload.ts` is only the start of that.
So the window for the class is narrower on one page and unchanged on the rest; whether the wider
fix is wanted is a question for Greg, in that plan.

## What would have caught it, ranked by ease against value

1. **A two-build browser check** — build A, load it, serve build B, navigate. It is what reproduced
   this in ten minutes, and it is the only check that puts a client in the state at all. Worth
   keeping as a script once the deferred work gives it a second thing to assert. Not built here:
   one assertion, already covered by the unit tests, does not earn a 20-second two-build harness in
   the suite. **Kept since 2026-10-05** as `scripts/check-two-builds.ts`, run by hand: it asserts
   the `/changelog` reload lands on the second build, and has a control that must fail.
2. **A rule for messages: advice must name a control the reader has.** *"Reload the page"* with no
   reload control is the shape; the Reload button is the fix for this instance. Cheap, and it would
   have been caught by reading the message on the iPad once.
3. **Reading Sentry for errors whose release is not the live one.** `3H` had fired on stale releases
   for three weeks. Rejected as a standing check: stale-release errors are mostly noise by design,
   and after this change the lazy-route ones stop arriving.
4. Vercel's skew protection (keep old files reachable) — rejected for now: it keeps an old client
   *working*, which is the opposite of getting it replaced, and it is a paid platform setting that
   is Greg's to choose.

## 261005d review: component lifetime is not work lifetime

Commit `0019c8c0c` added an automatic reload and excluded autosaves on the assumption that
unmounting their fields ended their work. `useAutosavedText.ts` deliberately does the opposite:
when an older save is pending, unmount retains the newest text in a callback and waits before
sending it. Navigating from an edited profile to `/changelog` removes the field's leave warning,
but can leave that callback holding the only copy of the newest words. A reload discards it.

A temporary review probe mounted the real hook, started a deferred save of `older`, edited to
`newest unsent words`, and unmounted it. The final write had not been sent, but `safeToReload()`
returned `true`; an assertion requiring `false` failed. Resolving the older save then sent the
newest text, confirming the retained work was reached. The ordinary two-build check has no edited
field and cannot see this class.

Fixed the same day, in the autosave owner: while the newest words wait behind an older save, the
hook holds the tab through `unload-guard.ts`, which is the one place every `beforeunload` in the
client now goes through and the fact `safeToReload()` reads. `tests/autosaved-text.test.tsx` went red
first. The older lazy-route reload (`reloadIfStale`) asks `safeToReload()` too, so neither automatic
reload can discard unsent work; when it is refused there, the reader gets the message and its Reload
button.

The same commit's Feedback veto counted text and images but missed audio before a transcript,
and failed audio retained for retry. The review fixed that veto after three regression cases went
red. Recording persistence is best effort, so it cannot justify unloading that work.

The icon fallback in `f87a3ca94` also needed an own-key check: `__proto__` and `constructor` returned
inherited objects/functions, while `toString` silently drew the wrong glyph. Render tests went red
for all three; `stageIcon` now accepts only the table's own entries. The countermeasure for this
lookup class is an own-key check plus a neutral fallback, with a test that asserts the glyph as
well as the absence of a crash.
