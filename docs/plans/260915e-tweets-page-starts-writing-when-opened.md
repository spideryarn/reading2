# The Tweets page starts writing when it is opened

> The Tweets mode should automatically start generating (if it hasn't already generated) when opened
> (without having to click a button to kick it off)
>
> — Greg, 2026-09-12 (Sentry SPIDERYARN-READING2-3J, on `temporal-context-reinstatement-spya-dhqkf9`,
> build `d358f773`)

## What was already there

This rule has been in the code since 2026-09-06 —
[260906b](260906b-opening-a-mode-starts-it-generating.md) § Stage 2, commit `037de8f7` — and the
build Greg was on contains it. What it covers is a **press**:

- the Dock's **Tweets** link arms an activation token on `Link.onNavigate`
  ([Dock.tsx](../../src/web/Dock.tsx), [activation.ts](../../src/web/activation.ts) §
  `armActivationForTweets`);
- the command bar's Tweets row arms the same token on Enter
  ([CommandBar.tsx](../../src/web/CommandBar.tsx));
- [Tweets.tsx](../../src/web/Tweets.tsx) calls `useAutoRun(slug, "tweets", …)`, which spends the
  token once the thread GET says there is nothing, capped at one automatic attempt per
  `(slug, target)` per tab session by `jobEngine.beginAutoAttempt`.

What it deliberately does **not** cover is an arrival with no press: a reload of
`/read/<slug>/tweets`, a pasted or bookmarked link, a Back or Forward step, or a second visit in the
same tab after the one automatic attempt has been spent. All of those draw *"Nobody has written a
thread for this one yet."* and a **Write the thread** button — which is exactly what Greg describes.
Shelf restores cannot land there: [last-view.ts](../../src/web/last-view.ts) restores the query
string, never the path.

## The gap in the evidence

260906b promised *"`tests/tweets-page.test.ts` grows a mount-vs-press pair"*. It never landed.
[pressing-a-chip-arms-it.test.tsx](../../tests/pressing-a-chip-arms-it.test.tsx) proves the bar
**arms** a token; nothing proved the page **spends** it. So the press could have been minted and
dropped on the way through the router with every test green.

[tests/tweets-press-starts-it.test.tsx](../../tests/tweets-press-starts-it.test.tsx) is that pair:
the real `Dock`, `Link`, `navigate()`, `useRoute` and `Tweets` under `<StrictMode>`, with only the
network and the job queue posed. Green on `dev` as it stands; **red** with the `useAutoRun` call
removed from Tweets.tsx (watched, 2026-09-15: *expected [] to have a length of 1 but got +0*).

## Decision: arriving at the page is the intent

**The Tweets page writes the thread on any owner arrival that finds none**, not only on a press.
Still one automatic attempt per `(slug, "tweets")` per page load, still the unforced request, still
through the server's own queue — authentication, ownership, de-duplication of an identical active
request, global concurrency — none of which this touches.

**There is no per-owner spend cap on this, and there never was.** `POST /api/jobs {slug, steps}` is
a re-run, deliberately outside `withIngestSlot`: the slot protects new ingests only
([billing.md](../project/billing.md)). So this change bypasses no defence and changes none — but it
does make a paid re-run happen without a press, which makes the missing cap more worth deciding.
**That is Greg's call and is not built here**; it is in the feedback note. (GPT Sol, plan review
P1-2: the first draft of this paragraph claimed the owner's slots bounded it. They do not.)

A browser pass on the dev server, 2026-09-15, confirmed the old behaviour live: pressing Tweets in
the Dock (1400px and 390px) and taking the command bar's Tweets row each posted one `tweets` job; 21
direct loads of `/read/<slug>/tweets` posted none. Nothing was broken — the button Greg met is what
every arrival without a press got. At 390px the Tweets link sits past the right edge of the bar,
reachable only by scrolling it, which makes *not* arriving by the press the likelier way in on a
phone.

Why this is not the mistake [activation.ts](../../src/web/activation.ts) § Why a mount is not a
click warns against. That argument is about **`?mode=`, which is query state**: it survives leaving
the mode, is pushed into history on every change, and is carried by `withMode` links from other
pages — so a band mounting says nothing about what the reader just did. `/read/<slug>/tweets` is a
**path**. The ways an owner lands on it are pressing the Dock or command-bar link, a URL they typed
or bookmarked, a reload of a page they were on, and Back or Forward onto a page they chose to visit.
None of those is state carried along by accident, and Greg has now said *"when opened"* twice
(2026-09-06 and 2026-09-12), the second time on a build where the press already worked.

**Arbitration.** Fable, asked to choose between keeping press-only and extending it, chose extending,
and named the strongest argument against — which is below, not hidden.

### What it costs, said out loud

- It **reverses 2026-08-25's "a button, not an effect"** for this page, and it makes a page load
  spend: Back onto the thread page in a tab that has never tried, or a reload after a failure, now
  starts a job without a press. Bounded — one per article per tab session, the owner's own article
  only, the owner's slots — and a reload after a failure is arguably the retry Greg wants.
- It is the **second** place in the reading view a paid call happens on arrival. The first is
  Diagram's Force, Drift and Trail embeddings (activation.ts § The three geometries arm nothing).
- The Tweets page stops being like the modes, which stay press-only. That is the point: the modes'
  reason does not apply to a path.

### Every way the page now spends without a press (GPT Sol's audit, P1-1)

The path argument is not a proof that every mount is a fresh choice, and the plan should not claim
it is. These are the arrivals that start a run with nobody having chosen Tweets in that navigation,
and they are **accepted**, on the strength of Greg's *"when opened"*:

- **Back or Forward onto the page in a page load that has not tried** — after a full reload of
  another page, or in a restored tab. A full reload is a new JS realm, so `jobEngine`'s
  `autoAttempts` starts empty; a bfcache restore keeps the old page and its set, and spends nothing.
  In the *same* page load, Back onto the thread page is refused, because reaching that history
  entry meant mounting the page, which already tried.
- **A sign-in that keeps the address** — a signed-out reader on `/read/<slug>/tweets` signs in and
  the owner's page mounts. `jobEngine`'s teardown clears the attempts on a reader change.

Each is one run per article per page load, on the owner's own article. Not exposures, per the same
audit: the shelf and `last-view.ts` (the query string only, never the path), the metadata page,
App/router redirects (none lead to Tweets), prefetch (there is none), ordinary re-renders, and admin
views (none mount `ArticlePage`).

If Greg would rather Back and sign-in did not spend, the way back to press-only is one line in
Tweets.tsx and re-arming two links; the note says so.

### What stays out

- A read that **failed** starts nothing by itself. It is read again **once** per slug per mount, as
  `useAutoRun` did (Sol, P1-3): if that answers *none*, the run starts; if it fails again, the page
  shows its error sentence and stops. A second failure is not a loop.
- A visitor: `Tweets` mounts only under the owner's arm of `OwnedArticle` (the private
  `/api/article/:slug` answered 200), exactly as before. `VisitorTweetsPage` is untouched.

## The implementation — fewer parts than before

A mount *is* the intent now, so the activation token carries nothing for this page. In
[Tweets.tsx](../../src/web/Tweets.tsx) the `useAutoRun` call becomes `useAutoRunOnArrival`, a
second, smaller export beside it in [useAutoRun.ts](../../src/web/useAutoRun.ts) — beside rather
than inline, because that file's point is that the rules about spending live in one place:

- **`beginAutoAttempt`** records before it answers, synchronously, so `<StrictMode>`'s double
  effect is refused. A failed job leaves the status at `none` and the effect's dependencies
  unchanged, so it does not even re-run (Sol, P2-5: the plan's first draft imagined a
  `none → loading → none` it does not do); the attempt is spent and the button is there.
- **A failed read is read again once** per slug per mount, guarded by a ref so `<StrictMode>`
  asks once (Sol, P1-3).
- **The callbacks are held in refs**, `useAutoRun`'s own pattern, so the effect's dependencies are
  honest and the lint rule is satisfied (Sol, P2-4).
- **`write(false)`**, the unforced verb. It collapses in `enqueueOrGet` with an identical active
  unforced request — **not** with every Tweets job on the article: a forced rewrite already queued
  from another tab has a different `work_key`, so the two queue one after the other, and the later
  unforced step skips if the first left a current thread (Sol, P2-7).
- **It relies on `OwnedArticle` being keyed by slug** (ArticlePage.tsx), which it is; an unkeyed
  page moving from A to B would start B before B's read settled. Said in the hook's docblock.

Then the arming for Tweets is dead, and goes rather than lingering as a token nothing will ever
spend:

- `onNavigate` on the Dock's Tweets `DockLink`, and `DockLink`'s pass-through of it;
- the command bar's Tweets row's `onNavigate`, the field on `command-match.ts`'s command type, and
  CommandBar's call of it;
- `Link`'s `onNavigate` prop — its one caller was this;
- `armActivationForTweets` in activation.ts.

`"tweets"` stays in `AutoRunTarget`, because `beginAutoAttempt` is keyed on it.

Prose that counts or describes the Tweets press is corrected where it stands: the headers of
activation.ts, useAutoRun.ts and auto-run-targets.ts, Tweets.tsx § `Empty`, Dock.tsx beside the
link, and [260906b](260906b-opening-a-mode-starts-it-generating.md)'s Tweets row, which gets a
pointer here.

### Evidence

- [tests/tweets-press-starts-it.test.tsx](../../tests/tweets-press-starts-it.test.tsx) becomes the
  arrival test: a pasted link to an article with no thread posts **exactly one** unforced `tweets`
  job under `<StrictMode>` — red on today's code, which is the failing test for this report; a
  press from the bar still posts one, not two; a thread already there posts nothing; a second
  arrival in the same tab after the attempt posts nothing and leaves the button; and a failed job
  does not loop.
- The Tweets cases in tests/pressing-a-chip-arms-it.test.tsx and tests/command-bar.test.tsx that
  assert a token is armed go — they pin the mechanism being removed. Whether the command bar still
  marks the row as `generates` is unchanged and stays asserted.

## The simpler option passed over

Leaving the arming in place and adding the mount rule beside it: two ways to start one run, one of
which mints tokens that nothing claims. Fewer parts is the simpler design here, not the larger diff.

## Review record

_(GPT Sol, plan and code — to follow)_
