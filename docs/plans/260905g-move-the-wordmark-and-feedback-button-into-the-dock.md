# Move the wordmark and the Feedback button into the Dock

**Status: stage 1 built 2026-09-06; stages 2 and 3 not started.** Written 2026-09-05 as the successor to stage 4 of
[260905d](260905d-declutter-the-reading-view-top-bars.md), which was abandoned once measuring showed
it could not deliver what it promised.

## Why this exists

Greg asked for the reading view's chrome to collapse to one top bar and one bottom bar:

> The top bars are really crowded and confusing. […] In short, we'd like to get to the point where
> there's a single top bar and a single bottom bar, along with the nice way that we already
> hide/reveal those when scrolling on mobile. And that everything we're showing is useful and
> understandable.
>
> — Greg, 2026-09-05

[260905d](260905d-declutter-the-reading-view-top-bars.md) emptied the sticky `.controls` bar and
then set out to stop rendering it where it was empty. That last step turned out not to be
available, and the reason is the whole premise of this plan.

**The controls bar is not only a bar. It is the thing that holds two fixed controls off the
article.** `.logo-home` (the wordmark, the way home) and `.fb-button` sit `position: fixed` in the
top corners at `top: var(--safe-top); height: var(--bar-h); z-index: 60`, on every page. They do not
reserve their own space: **the bars reserve it for them**, through padding, and
[`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) § The bars have to reserve the space says so
and prices it at about 120px of right-hand gutter held open on every page, including ones with no
button in them.

So removing the bar does not remove a bar. It removes the floor two controls are standing on, and
the article scrolls up behind a wordmark and a button that have no background of their own
(`.fb-button` is explicitly `background: none`).

Fable arbitrated stage 4 against that, 2026-09-05, and worked out where the 44px would actually have
landed:

| | |
|---|---|
| phones | the bar already leaves on scroll — nothing to gain |
| Hierarchy | the bar stays, it has the pills — nothing to gain |
| band modes | `.mode-band` is `top: var(--bar-bottom)`; remove the bar and you either leave a hole above the band or pad it back — nothing to gain |
| Plain, above ~1080px | 44px of page background: **the only real win** |
| Plain, 732–1080px | the centred column reaches the left edge, so the wordmark's 136px lands on the top line of prose — **worse than before** |

And one cost nobody had priced: `commentError` puts the bar *back*, so a comment-transport hiccup
would slide the spine, the band and every sticky gist 44px in a 180ms animation. **A layout that
jumps on an error path is worse than a strip that is always there.**

Greg's call, given all of that: don't patch it — move the corners.

## What this does

The wordmark and the Feedback button leave the top corners and live in the **Dock**, the bottom bar
that already names the mode and is already the way out of one. Then:

- the top of the reading view is genuinely free, and `.controls` can stop being rendered where it is
  empty with nothing left behind to hold up
- the ~120px right-hand gutter reservation goes, on every page in the app
- the [spine-under-the-wordmark bug](../postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md)
  dissolves rather than being fixed: there is nothing left in that corner to be under
- "one top bar and one bottom bar" becomes true in the plain sense of the words, rather than true if
  you agree not to count the masthead

## What was open, and what it was settled as

This was a sketch when it was written. Everything below is now decided; the one question that
was Greg's is marked as his.

- ~~**Which pages.**~~ **Decided by Greg, 2026-09-06: the reading view only. Every other page keeps
  its top corners exactly as they are.** The two controls move into the Dock where there is a Dock,
  and nowhere else — no page grows one to receive them.

  The reasoning is that the reading view is the only place the 44px is expensive: it is the one page
  whose whole job is a column of prose you scroll through, and the only one where a permanent strip
  of chrome sits between the reader and it. The library and the profile are pages of cards and
  fields, where a top bar is ordinary furniture and costs nothing anybody notices.

  **The cost Greg accepted, stated rather than discovered later:** the wordmark moves as you
  navigate. Going from the library into an article, the way home slides from the top-left corner to
  the bottom-left. That is a real inconsistency and it is the price of the 44px. Two things make it
  survivable and both are honoured below: the Dock is *already* where a reader looks to leave the
  thing they are in, since it is how you leave a mode; and the wordmark keeps its identity across
  the move — same glyph, same word, same colour.

  **"Where there is a Dock" is three pages, not one**, and that is the operative reading of Greg's
  answer rather than a widening of it. The article, its metadata page and its tweets page all mount
  `Dock` and are one click from each other; leaving the corners on two of the three would put the
  wordmark top-left and bottom-left on pages a reader flips between in a tighter loop than
  library → article. The rule is *the Dock takes them where there is a Dock*, which is exactly what
  Greg's answer says.

- **What the Dock can afford: the ladder answers it, and gains one rung to answer it well.** The
  words `Spideryarn` and `Feedback` are marked `dock-btn-label`, the same class every other button's
  word carries, so the fit ladder decides when the brand is affordable rather than a second
  mechanism. The glyph never goes.

  **My first answer was "no new rung", and Fable was right that it was the wrong economy** — see
  below. So a new rung goes in above the old rung 1, dropping only the app cluster's words, and the
  rungs renumber.

  **Measured before anything was built**, 2026-09-06, by binary search on the viewport width at
  which each rung stops fitting — `scrollWidth` at a wide viewport cannot answer this, because it is
  clamped to `clientWidth` and a rung that fits reports only "fits" (`dock-fit.ts` § the one
  measurement). Signed in, on the reading view, above the 731px breakpoint:

  | modes drawn | rung 0 needs | rung 1 needs | rung 2 needs |
  |---|---|---|---|
  | 9 — the default reader | 1206px | 815px | ≤ 740px |
  | 14 — experimental features on | 1647px | 992px | ≤ 740px |

  **This corrects Fable's premise while confirming its conclusion**, and the difference is worth
  writing down. Fable argued that a 1440 laptop would shed fourteen mode words to keep two app-level
  ones. It would not: with fourteen modes the bar is *already* past rung 0 at 1440 today, because
  rung 0 wants 1647. Where the new rung actually earns its place is the **default** reader, whose
  rung 0 need is 1206 and would go to roughly 1420 with both words added — so 1280 and 1366, two of
  the commonest laptop widths, would drop a rung they hold today. That is the band the new rung
  protects, and it is a better argument than the one that was offered.

- **The way home is not a mode**, and the markup says so three ways: it is outside the
  `role="radiogroup"` that `DockModes` draws, it is a `Link` rather than an `aria-checked` button,
  and it never takes `.dock-btn.on`. It also does not take `aria-current="page"` the way `DockLink`
  does, because it is not a link to the page you are on — it is the way off it.

- **The Dock hides on scroll, and the way home goes with it.** That is the right answer rather than
  a cost to mitigate: the corner controls *not* joining the hide is precisely the live bug in
  [the postmortem](../postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md),
  where the wordmark stays fixed over the top 44px of the spine on a phone that has scrolled the
  bars away. Both controls now travel with a bar, and any upward scroll brings them back.

- **`--bar-h` keeps both its consumers, because they still exist elsewhere.** `.logo-home` and
  `.fb-button` are unchanged on the library, the profile, `/privacy`, the landing pages and the
  article's loading and error screens. What goes is the *reservation* the reading view was holding
  for them, which is a different thing in a different place — see stage 2.

- **The reservation comes out in the same run**, as stage 2, and it is the visible half of this
  work: ~136px of left gutter and ~120px of right gutter given back to the article's own title.

## The one thing this makes worse, stated

**The Feedback button stops being always-visible on a phone.** At the last rung on a 390px screen the
row already overflows and scrolls (measured 2026-09-06 with fourteen modes: `scrollWidth` 647
against `clientWidth` 390 — it was 617 with thirteen);
Feedback sits at the right-hand end of it, so a reader has to drag the bar to reach it, where today
it is fixed in the corner. The wordmark does not have this problem — it is at the left-hand end,
which is where the scroll starts.

Taken anyway, because the alternative is keeping one fixed control in the corner of the reading
view, which is the thing this plan exists to stop, and because the button is chrome offering to take
a complaint rather than something a reader is reaching for mid-sentence. Recorded here so that if
bug reports from phones fall off, this is the first place to look.

## What Fable changed, 2026-09-06

Asked for a product judgment on placement, on whether a wordmark back in the Dock's left end
contradicts Greg's own removal of `Home` from that slot, and on the phone regression. It agreed with
the shape and changed four things.

**The 2026-08-26 argument is answered, but not by the distinction I reached for.** I had said a
wordmark is a different kind of thing from a `Home` button. Fable called that half invented — it is
still a link out of the article, in the slot Greg emptied. What has actually changed is the bar:

> "The way out of a document is not one of the things the document can be" is answered by being
> outside the `role="radiogroup"` frame … the bar had only one kind of button then and has three
> now, and the segment frame is what says "these are the things the document can be".

So the honest version, and the one written into the code comments: the corner is being abolished, so
the *better place* that took the way home off this bar no longer exists; the bar has since grown a
precedent for app-level chrome (the experimental switch, "the only button in the bar that is about
the app"); and the segment's hairline frame now keeps the modes and the exits visibly apart.
`MODES_UI`'s comment says Plain is first "because it is the way out" — it becomes first *among the
modes*.

**A rung is added, and "no new rung" was the wrong economy.** Rung 0 goes from ~1416px to roughly
1600, and 1440×900 is the width this stylesheet is most often looked at. Shedding all fourteen mode
words to keep `Spideryarn` and `Feedback` is backwards: those two words pay least. So there is a new
rung *above* the current rung 1 that hides only the app cluster's labels, and the numbering shifts:

| rung | what it drops | was |
|---|---|---|
| 0 | nothing | unchanged |
| 1 | the wordmark's and Feedback's words | **new** |
| 2 | the mode labels (all but `keepLabel`) | rung 1 |
| 3 | every label | rung 2 |

`dock-fit.ts` says a new rung is one entry in `DOCK_FIT_CLASSES` and one rule in the stylesheet, and
that is true — but the renumbering is a rename, so it gets a rename's sweep.

**The wordmark keeps the orange and must not get the button's hover wash.** In this bar `--highlight`
means hovered or selected, so the risk of reading as a fourteenth mode is colour rather than
position. Two things keep it apart, and both are cheap: the on-state is orange text on an orange
*wash* with an inset top border, and the wordmark gets neither; and its glyph is an image rather
than a lucide icon, so it is already a different species. Hence `.dock-home` rather than `.dock-btn`
— inheriting `.dock-btn:hover { background: var(--panel) }` is the thing that would make it look
like a mode. If a screenshot at rung 2 still reads as fourteen glyphs, the fix is a hairline
`border-right`, not a divider element.

**And four things the plan had not noticed:**

1. **Stage 1 as written does not work.** `FeedbackButton`'s trigger is `.fb-button`, which is
   `position: fixed; top: var(--safe-top); right: var(--safe-right)`. Dropped into the bar it paints
   in the top-right corner exactly as it does now — and a "one Feedback trigger per route" test
   passes while the bar is visibly wrong, which is this codebase's own favourite failure. The dialog
   is the reusable half; the trigger needs its own dock shape, its label under the ladder rather
   than under the 731px query, and `placement="top"` on its tooltip, since `bottom` would put the
   card under the bar.
2. **`fitSignature` must learn whether Feedback is drawn.** It is signed-in only, so the row is one
   button wider for an owner than for a visitor, and `dock-fit.ts` is explicit that a width change
   the `content` string cannot see leaves the bar on a stale rung.
3. **The z-order decision reverses, silently.** Both corner controls sit at z-index 60, *below* the
   drawer's dim at 92, deliberately: while the drawer is open, leaving the page is not one of the
   things being offered. The bar is 96 and stays operable by design. Moving them in flips that. The
   flip is acceptable — Metadata is already a link out and already lives there — but two CSS
   comments now assert the opposite rule and have to be corrected in the same change.
4. **The coarse-pointer rule grows the loose buttons** so they share a tablet's bar. Decide whether
   `.dock-home` grows with them, or it is the one item huddled at the left end.

And the drawer header's comment — "two wordmarks on screen at once is one too many, and the one in
the corner is the one that is always there" — now points at a corner that no longer exists on this
page. The conclusion survives; the reason has to be rewritten to point at the bar below it.

**The one thing Fable asked for that could not be got:** evidence on how much feedback comes from
phones, which would be the thing to change its mind about the regression. There is no `feedback`
table reachable from this box (reports go to Sentry with a row alongside; the Supabase connection
here does not see it). Recorded as not-checked rather than as checked-and-fine.

## What GPT Sol changed, 2026-09-06 — round one on the plan

**DO NOT BUILD YET**, on seven findings. Every one checked against the code before being accepted;
all seven were right, and three of them change the design rather than the wording.

**G1 (P0) — one dialog, mounted once, or drafts die.** The plan said the Dock renders
`FeedbackButton`. That component owns the `open` state *and* mounts `FeedbackDialog`, whose own
header says it "is mounted for the whole life of the page". Put it inside a `Dock` and it unmounts
whenever the Dock does — loading → ready, article → metadata → tweets — taking a half-written report,
its attached screenshot and an in-flight send with it.

So `FeedbackButton` splits. A **host** stays mounted at the signed-in `App` level, holds the `open`
state and the dialog, and offers `open()` through a context; a **trigger** is placed where the page
wants it, in the corner or in the bar, and does nothing but call it. Nothing about the dialog
changes. Not a portal: the Dock's slot does not exist on the render that would need it, so a portal
costs a second render and hands `useDockFit` a bar with the button missing to measure.

**G2 (P1) — `VisitorDock` mounts for a signed-out stranger.** `PublicPages.tsx` draws a Dock on a
shared link whether or not anybody is signed in, and `FeedbackButton` has no gate of its own — the
rule is one line in `App.tsx`, which is exactly the arrangement `FeedbackButton.tsx` § Who sees it
describes and is proud of. Rendered unconditionally in the bar, a stranger gets a trigger whose
`POST` can only answer 401. The gate is `experimental.signedIn`, which the bar already carries and
which Dock.tsx § the `experimental` prop already explains is the right spelling. And the test must
assert **a signed-out shared page has none**, not merely "at most one" — Sol's point is that an
at-most-one count passes with one wrong button.

**G3 (P1) — `commentError` is not `loadFailed`, and stage 3 was wrong about it.** `useComments.ts`
says it out loud, beside the flag: *"`error` carries any transport failure, including a retry or a
delete that failed long after the list arrived, and it is cleared when one succeeds. This one is
about the one fetch that fills the list, and nothing else ever sets it."* And `Questions` draws
`loadFailed` only when the list is empty. So deleting the bar's chip on the grounds that the drawer
already knows would silence every refused write — including an optimistic delete whose row has
already gone from the reader's screen.

**The chip moves rather than going.** The Comments button in the bar takes an error state: the
`.dock-count` position shows a mark instead of a number, and the message goes into the button's
`title` and its accessible name. It is the control the failure is about, it is early enough in the
row to survive the phone's scroll, and it changes the bar's width by about a digit — which goes into
`fitSignature`, for the reason G-below gives.

**G4 (P1) — three more copies of the reservation.** `PublicPages.tsx` has the same
`calc(3.5rem + var(--safe-top))` at three `main` elements (lines 96, 265, 363), for the same corner
wordmark, and `ArticlePage` takes that wordmark away from them too. Stage 2 covers all five, not the
two owner-side ones the plan named.

**G5 (P1) — `--masthead-pad-l` and `--masthead-pad-r` are not private.** § plain, centred reads both
of them to undo the masthead's asymmetry and land the title on the prose's own left edge. Delete
them and the whole `margin-left` becomes invalid, which is not an error — it is a wide band-mode
title silently back on the wrong axis. **So the tokens stay and only their values change**, to the
ordinary gutter. That is smaller than what the plan proposed, and the downstream expression
simplifies on its own once the two sides are equal.

**G6 (P1) — there are fourteen modes, not thirteen.** Counted: `MODES_UI` has fourteen rows, five of
them experimental (Debate is the fifth). The plan's "announces as a radiogroup of thirteen" done
condition would fail before this work started, or invite somebody to make it pass by deleting a live
mode. It asserts against the visible-mode set instead. The rung estimates in this plan are stale for
the same reason and are being remeasured rather than reasoned about.

**G7 (P1) — Feedback does not compose with the ladder at all**, which is Fable's item 1 in more
detail: its text is `.fb-button-text`, its button is not `.dock-btn`, and it keeps
`width: var(--feedback-w)`. Every rung selector is written against `.dock-btn` / `.dock-btn-label`,
so above 731px Feedback would sit in the bar as a 7.5rem labelled exception and could make a
last-rung bar scroll where it would otherwise have fitted. The dock trigger takes the bar's own
classes and is content-sized. Sol asks for an overflow check between 732 and 900px specifically.

**And three things Sol checked and cleared**, which is worth recording because two of them were my
own doubts: a modal `<dialog>` in the top layer resolves against the viewport regardless of the
bar's `transform` and `overflow-x`, so the dialog is safe inside `.dock`; the tooltip is already
portalled to `<body>`; and `stickyOffset()` already returns `safeTop` when `.controls` is absent, so
stage 3 needs nothing there. The wordmark's rung selectors compose as intended.

## Stages

**Stage 1 — the Dock takes the two corners.** `Dock.tsx` grows a `DockHome` at the left-hand end,
before the modes, and a `DockFeedback` at the right-hand end, after the experimental switch and
before `.dock-tail`. **Both are new dock-shaped triggers, not the corner components moved** —
`.logo-home` and `.fb-button` are `position: fixed` in a corner, and a component that carries its
own position cannot be re-homed by being rendered somewhere else. `FeedbackDialog` is the reusable
half and is reused unchanged; the trigger is new, wears `dock-btn`, puts its label under the ladder
rather than under the 731px query, and opens its tooltip upwards. **`FeedbackButton` splits into a
host and a trigger** (G1): the host stays mounted at the signed-in `App` level with the dialog and
the `open` state, and hands `open()` down through a context, so no draft can be destroyed by a Dock
unmounting. The bar's trigger is gated on `experimental.signedIn` (G2), because `VisitorDock` draws
a bar for a signed-out stranger. The three pages that mount a `Dock` stop drawing the corner pair:
`ArticlePage`'s final branch loses its `<HomeLogo />`, and `App`'s single `<FeedbackButton />` stops
covering the `read` route — with the four branches of `ArticlePage` that have **no** Dock (loading,
error, not-shared, reauth-required) each drawing the corner button themselves, so nothing that has
it today loses it.

Done when: every route draws exactly one way home and at most one Feedback trigger, asserted by a
test that walks the routes rather than by reading — **and a signed-out shared page draws none at
all**, asserted separately, because an at-most-one count passes with one wrong button; the modes
still announce as a radiogroup of the visible-mode set rather than of a literal count;
`fitSignature` sees whether Feedback is drawn; and the feedback dialog still opens and
still centres on the viewport from inside a transformed, `overflow-x: auto` bar (a browser check,
not a reasoned one — `.dock` carries a `transform`, which would capture a `position: fixed`
descendant if the top layer did not escape it).

### What stage 1 actually cost, measured

Re-measured the same way after the change, same article and same box, 2026-09-06:

| modes drawn | rung 0 | rung 1 | rung 2 | rung 3 |
|---|---|---|---|---|
| 9 — the default reader | 1397px | 1263px | 872px | ≤ 740px |
| 14 — experimental on | 1838px | 1702px | 1048px | ≤ 740px |

Two words cost rung 0 about **190px** — close to the ~1420 predicted for the default reader — and the
new rung needs 1263, so **1280 and 1366 keep every mode label** and give up only `Spideryarn` and
`Feedback`. That is the band the rung was added for, and it holds. The mode rung moved ~57px
(815→872, 992→1048), which is the two extra glyphs; the last rung did not move, because it is the
floor and the floor is the phone. Observed in Chrome: rung 0 at 1600 and 1440, rung 1 at 1366, 1300
and 1280, rung 2 at 1024 and 900, rung 3 at 800 and 760 with no overflow (Sol's 732–900 check), and
at 390 the row scrolls at `scrollWidth` 542 against 390.

The dialog check the stage asked for passed: opened from `.dock-feedback` at 1440×900 it is
`:modal`, its backdrop is the whole viewport and its panel is centred on it (448 + 544 = 992 in a
1440 window), so neither `.dock`'s `transform` nor its `overflow-x: auto` captures it.

**One thing found while building it, and it is worth knowing before stage 3.** `Dock` was at Biome's
cognitive-complexity ceiling already; one more `&&` in its markup put it over, so the Feedback gate
lives in a two-line `DockFeedback` component rather than inline. The next conditional added to that
function will hit the same wall.

**And one thing the tests could not see.** `FeedbackTrigger` renders nothing when it finds no
`FeedbackHost` above it, and a signed-out reader has none — so G2's `experimental.signedIn` gate and
the missing host agree on every page the router can produce, and deleting the gate left the whole
route walk green. The gate has its own test now, mounting `Dock` inside a host with the bar told
nobody is signed in, which is an arrangement the router never produces. Worth remembering as a shape
rather than as an incident: a belt-and-braces pair where the braces are invisible to the test is one
brace.

**The phone bug is already gone, two stages earlier than the plan expected.** Stage 3's done
condition claimed it, on the reasoning that nothing would be left fixed in that corner once
`.controls` stopped being drawn. It did not need `.controls` at all: at 390×844, scrolled until
`data-bars="hidden"`, `elementFromPoint(6, 10)` now returns `button.spine-hit` where it returned
`a.logo logo-home` the same morning. The rail's top 44px is pressable. What was actually covering it
was the wordmark, and the wordmark has left —
[the postmortem](../postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md).

### What the review of the built code found

GPT Sol, round one on the code, returned **DO NOT LAND** on one P1 and three P3s; all four accepted
and fixed, and round two returned **LAND** with no findings.

**S1 (P1) — the bar could sit on a stale rung after any mode switch.** `fitSignature` recorded which
modes are *drawn* but not which one is *on*, and § the bar's fit ladder gives the open mode its word
back at rung 2 (since 2026-09-05). So Plain → Summary draws one more label with the signature
unchanged: same visible set, same count, nothing to re-measure on, and the bar keeps a rung chosen
for a narrower row. Pre-existing rather than introduced here, and found because this stage was in
that code. The active mode is a term now, with a test proven red by mutation.

**And the fix's own guard was dead, which the test is what proved.** Sol asked for the mode "when
segmented"; the guard was written, and then the test defending it could not be made to fail —
`shape` is `"links"` exactly when `mode` is absent, in every arrangement the four mount sites
produce, so both spellings return the same string for every bar that exists. The branch went rather
than the test being contorted into an unreachable arrangement to justify it. Sol confirmed on the
second pass, and added the reason that settles it rather than merely permits it: if the loose links
ever gain an `.on` state, the term wanted is `mode ?? modeInSearch(search)` on *both* shapes, and a
`shape === "seg"` guard would be the thing in the way.

The three P3s were a rung comment naming the wrong rung's survivors, "five pages that mount a Dock"
where it is three routes in an owner's and a visitor's shape, and the Dock's button taxonomy, which
went from four kinds to five when a modal opener joined it.

**Stage 2 — the reservations come out.** `.masthead` and `.controls` drop the reservation from their
`padding-left` / `padding-right`, along with the narrow-window rules that give the same two terms
back after a shorthand ate them. **`--masthead-pad-l` and `--masthead-pad-r` survive with new
values** rather than being deleted, because § plain, centred reads both (G5). Five `main` elements
drop the `3.5rem + var(--safe-top)` of top padding they hold for a wordmark that is no longer above
them: `Metadata.tsx`, `Tweets.tsx`, and the three in `PublicPages.tsx` (G4). `--logo-w` and `--feedback-w` stay, with their comments rewritten to say they now
size two controls and reserve space on the pages that still have them.

**The baseline, measured 2026-09-06** so the change has something to be compared against. The
masthead holds `padding-left: 148px` and `padding-right: 144px` at every width above 731px, and the
article's title lands to the right of the prose it is the title of:

| width | title's left edge | prose's left edge | out by |
|---|---|---|---|
| 1440 | 368 | 322 | 46px |
| 1200 | 248 | 202 | 46px |
| 1024 | 160 | 114 | 46px |
| 800 | 160 | 12 | **148px** |

The 46px is the reservation minus what the centred-column rule gives back; the 148px is what happens
below the width at which that rule's term clamps to zero, which is the band the abandoned stage 4
called "worse than before". At 1440 in Plain the whole misalignment is invisible unless you measure
it, which is why nobody had.

Done when: the article's title starts at the ordinary gutter and lines up with its own prose at
every width; nothing on the five Dock pages reserves space for a corner control; screenshots at
1440, 1024, 800 and 390 show the title using the room.

**Stage 3 — the top bar stops being drawn when it has nothing in it.** This is stage 4 of
[260905d](260905d-declutter-the-reading-view-top-bars.md), which was abandoned because the bar was
holding two controls up. It is not any more. `.controls` renders only when it has content —
which, `inMode` being `mode !== "hierarchy"`, means Hierarchy for the granularity pills and a
visitor's read-only chip — and `--bar-bottom` falls to `var(--safe-top)` where it does not.

The `commentError` chip leaves the bar rather than being what puts it back — **but not by being
deleted, which is what an earlier draft of this stage said and what Sol refused (G3).** It is not a
duplicate of the drawer's `loadFailed`: that flag is about the one fetch that fills the list and is
only drawn when the list is empty, while `error` carries every refused write, retry and delete.
Removing it would silence a failed delete whose row has already left the reader's screen.

So it moves onto the Comments button in the bar, which is the control the failure is about: the
count's position takes a mark instead of a number, and the sentence becomes the button's `title` and
part of its accessible name. **That is what removes the 44px jump on an error path**, which was the
last argument against stage 4, rather than a tidy-up — and it costs the row about a digit, which
`fitSignature` has to see.

Done when: Plain mode above 1080px has no chrome above the prose but the masthead; a comment
transport failure moves nothing; and the phone bug in the postmortem is gone because there is
nothing left fixed in that corner. **That bug was re-confirmed live on 2026-09-06** before any of
this was built — at 390×844, scrolled until `data-bars="hidden"`, `elementFromPoint(6, 10)` returns
`a.logo logo-home` while the spine's top edge is at y=40. The 44px of rail under the wordmark is
still unreachable.

## The simpler options passed over

- **Give the two corners their own backgrounds and drop the bar anyway.** Two lines of CSS, and it
  buys 44px in one mode above one width while making 732–1080px worse and leaving the gutter
  reservation in place. Rejected on the table above.
- **Keep the empty strip and do nothing.** Fable's actual recommendation, and defensible: the strip
  reads as a seam rather than as a control, and Greg's "everything we're showing is useful" is about
  words, of which there are none left. Rejected by Greg in favour of doing it properly.
- **Fix the mobile spine bug on its own** — the corners joining the hide-on-scroll, a handful of CSS
  lines. Written up in the postmortem and still available if this plan stalls; it is strictly smaller
  and strictly less good.

## See also

- [260905d](260905d-declutter-the-reading-view-top-bars.md) — the declutter this came out of, stages
  1, 2, 3 and 5 of which have landed
- [the postmortem](../postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md) —
  the live bug this would dissolve, with the measurement
- [`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) and
  [`HomeLogo.tsx`](../../src/web/HomeLogo.tsx) — the two comments that explain the reservation and
  price it
- [reading-view-overview.md](../project/reading-view-overview.md), [web-client.md](../project/web-client.md)
