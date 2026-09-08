# Exact time and duration on the metadata page's step rows

Report `SPIDERYARN-READING2-2K`, 2026-09-07 19:17 UTC, from Greg (`ADMIN_USER_ID_PROD`), so
[feedback-reports.md § Who sent it](../project/feedback-reports.md) says build it, simplest version
first, without stopping to ask whether it is worth doing.

> In the Metadata page in what we did to it, can you make sure it has a tooltip for exactly when it
> happened, rather than only showing the human-readable version? And also, how long it took.
>
> — Greg, 2026-09-07

"What we did to it" is the list of pipeline steps on `/read/<slug>/metadata` — one `StageRow` per
entry in `STEP_ORDER`, each drawn from a `revision_step_runs` row
([Metadata.tsx](../../src/web/Metadata.tsx), [pg.ts § `articleMetadata`](../../src/store/pg.ts)).

## Two asks, and only one of them is missing

**The exact time is already there, and has been since 2026-08-27.** `Wrote` wraps the
"ran 3 days ago" text in a `Tooltip` whose card is `exactly(when)` — `dateStyle: "full"`,
`timeStyle: "long"`, so date, seconds and zone — plus a sentence saying what the stamp is a stamp
of. The trigger is a `<button>` with a dotted underline, so it is keyboard-reachable too.

So the first half of the report is **verify, don't build**. § What we checked records what the page
actually does today; if it is right, the honest answer to Greg is "it is there, here is where."

**How long it took is genuinely missing, and it is missing from the wire, not from the database.**
`revision_step_runs` has had `started_at` since the column was added — `beginStepRun` writes it and
`finishStepRun` writes `finished_at` onto the same row, keyed `(revision_id, step_name)`, so the two
stamps always describe the same run. `StageState` carries only `ranAt` (`finished_at`), because a
[cross-model review](../../src/store/pg.ts) deliberately refused a `started_at` **fallback** for
`ranAt` — that ruling is about which stamp answers *when did this run*, and says nothing against
carrying the start as its own field.

**No new column.** One field on `StageState`, one line in `articleMetadata`, and the duration is
subtraction on the client.

## The shape

### `startedAt` on the wire, not `tookMs`

The server sends the two facts it has and the client does the arithmetic, for the same reason
`ranAt` is an ISO stamp rather than "3 days ago": a duration computed on the server is a derived
number that nothing can check against the stamps beside it, and this is the page whose whole job is
to report facts rather than verdicts (the docstring at the top of `Metadata.tsx`).

It also keeps the null cases honest and separate. `startedAt: null` with a `ranAt` set means *we
know when it finished and not when it began* — which is what every row written by `recordStepRun`
without a start looks like, and what a pre-`started_at` row looks like. The client draws no duration
there rather than a zero.

### Where the duration goes: in the card, not on the row

The row's second line is already `output/<slug>.html · ran 3 days ago`, sixteen times over. A third
term on every one of them buys a number most readers never want, on the densest part of the page.
The card is where this page already puts precision, and it is what Greg asked for.

So the card becomes:

```
Sun, 7 September 2026 at 19:04:11 GMT+1 · took 8.4s
When this stage last finished.
```

`weight(bytes)` keeps its place on that first line where there is a `bytes` (there never is, in
Postgres — it is the filesystem's answer and the filesystem store is gone; the field is kept because
`ranAt`'s sentence still branches on it).

### Clamped at zero, and dropped when it is absurd

`finished_at < started_at` is two clocks disagreeing, not a fact about the article — the same thing
`timeAgo` clamps a future stamp for. A negative interval draws nothing rather than "took -3s".

### There was already a `howLong`, and now there is one

`src/web/Tweets.tsx` has exported `howLong(ms)` since 2026-08-26 — same name, same job, shown under
a tweet thread. **A second copy was written here before anybody looked**, which is the *"two ways to
do one thing"* CLAUDE.md warns about, and it was found by noticing the name in a passing test log
rather than by looking for it. Both are now one function in
[`src/web/relative-time.ts`](../../src/web/relative-time.ts), which is where `timeAgo` and `exactly`
already live: that file says *when*, and now also *how long*.

The two versions disagreed in exactly two places, and the merge kept both behaviours:

- **Milliseconds below a second.** The Tweets copy said `0.5s`; a step row needs `500ms`, because
  the difference between 30ms and 900ms is the difference between a copied row and a real read. No
  thread has ever been fast enough for that branch, so nothing on the Tweets page moves.
- **`an unknown time` for a non-finite or negative input.** That is *why* the Tweets copy exists —
  the original asked the SDK for its own timings, got empty values, and rendered `0ms`, which reads
  as *instant* rather than *we don't know*. The metadata card never reaches it, because `tookFor`
  declines first; a card saying "took an unknown time" beside a timestamp it is sure of would read
  as doubt about the whole line.

The Tweets copy also had the `60.0s` boundary bug, fixed by the move. Its five existing cases in
`tests/tweets-page.test.ts` pass unchanged and stayed there, because they are that page's
requirements on the function.

`tookFor` stays in `Metadata.tsx`: deciding **whether there is anything to say** is about this
page's pair of stamps, and formatting a number is not.

### Format

- under a second — `640ms`
- under a minute — `8.4s`
- otherwise — `3m 12s`

One helper beside `weight` in `Metadata.tsx`, pure, and tested directly. **Every boundary is decided
on the rounded number**, which is where the three wrong answers come from: `1000ms`, `60.0s`, and
`3m 60s` from a 239.6s run whose minutes were floored before its seconds were rounded up. The last
of those was a real bug in the first draft.

No space before `ms`, unlike SI and unlike `weight`'s `4 KB`, because the card is 22rem and the line
already carries a full date with a timezone: seen in a browser wrapping as `16` above and `ms`
below. `8.4s` and `1m 47s` have no space either.

## Touch: no second way in, and why

A tooltip is unreachable by hover on an iPad, and [touch.md](../project/touch.md) lists the four
places that pay for that with reveal-then-commit. **This one is not becoming a fifth**, for two
reasons:

1. **It is already reachable.** `Wrote`'s tooltip is uncontrolled, so `Tooltip.tsx` leaves
   `mouseOnly: false` — `useHover`'s touch handling is on. A tap on the trigger produces the
   synthesised `mouseenter` that opens the card, and nothing takes it away, because this trigger is
   a `<button>` with **no click behaviour**: there is no commit for a reveal to race. The four
   reveal-then-commit surfaces all exist because the tap that opened the card was also the tap that
   did something. **Measured in a touch context rather than reasoned from the spec** — § What we
   checked, including the one run that said the opposite and why it was wrong.
2. **The cost of being wrong is a fact, not a function.** If a finger cannot open it, what is lost
   is a timestamp to the second on an operational page. Nothing on this page is unreachable without
   it, and nothing else on it changes state.

## Stages

**One stage.** It is a field, a subtraction and a string.

1. `startedAt` on `StageState` (`src/types.ts`) and in `articleMetadata` (`src/store/pg.ts`);
   `tookFor` in `Metadata.tsx` over the shared `howLong` in `relative-time.ts`; tests for the
   formatter, for the card carrying the duration, and for every way the duration declines. Green
   `npm test` and `npm run typecheck`, GPT Sol on the built code, land on `dev`.

## The simpler option passed over

**Do nothing but reply "the tooltip is already there."** Half the report is satisfied by that, and
it is the cheapest possible ending. Rejected because the other half — how long it took — is the
half that is not there, is asked for plainly, and costs one field.

**Show the duration inline on the row instead.** Cheaper to discover, no hover, works on touch by
construction. Rejected on density: sixteen rows already carrying a path, a state pill and a relative
time, and Greg asked for a tooltip. If it turns out to be the number he actually reads, moving it
out of the card later is one line.

## What we checked

Signed in as `dev-admin@spideryarn.local` against a local dev server, Playwright + system Chrome on
the box ([browser-testing-playwright.md](../project/browser-testing-playwright.md)), on
`/read/fowler-phrenology/metadata`, 2026-09-08.

**Where the section actually is.** `What we did to it` is **inside the shut `Technical details`
disclosure** — the first probe found zero step rows on the page because it never opened it. That is
by design (Greg, 2026-09-03: *"the less important stuff less visible"*), and it is worth writing down
here because it is the likeliest reason the existing card went unfound: the row is two clicks from
the top of the page, and a hover is only discoverable once you are looking at it.

**The exact-time card exists and says the right thing.** Hovering the first row's trigger:

```
trigger text: ran 4 days ago
cards open after hover: 1
card text: >> Thursday, September 3, 2026 at 1:20:51 PM GMT+1When this stage last finished. <<
```

Ten such triggers on that article, one per step that has run. So the first half of the report needs
no build — it needs the duration beside it, and this doc reported back to Greg.

**A finger opens it.** In a `hasTouch: true, isMobile: true` context at 834×1194, tapping the trigger
opens the card and it **stays open** — polled every 100ms for two seconds after the tap, twice over,
both times `max cards seen = 1, still open after 2s = 1`. The event stream the trigger receives on a
tap is `pointerover(touch) … touchstart … pointerleave(touch), touchend, mouseover, mouseenter,
mousedown, focus, mouseup, click(touch)`, which is the synthesised `mouseenter` the ruling above
predicted, and there is no click behaviour to take the card away again.

**One measurement to distrust, and why.** An earlier probe reported `cards open after TAP: 0`,
reproducibly — because that script opened the disclosure with `click()` rather than `tap()`, leaving
a virtual **mouse** resting on the page before the finger arrived. A real touch device has no mouse
to leave anywhere, so the tap-only probe is the faithful one. Recorded rather than quietly dropped:
the contaminated run is exactly the shape of evidence that would have had us build a
reveal-then-commit nobody needed.

## The plan review, and the one finding we overruled

GPT Sol, `gpt-5.6-sol`, high effort, on the plan before anything was built. Verdict: *build with
these changes*. Three findings; two taken, one overruled on evidence.

**P1-1, the touch ruling — overruled, because it was measured and the finding was reasoned.** Sol
argued that `mouseOnly: false` lets Floating UI *react* to touch but does not make the card persist:
*"The touch sequence includes `mouseenter`, then `mouseleave`, then `click`; `mouseleave` closes the
uncontrolled tooltip before the no-op click"*, citing the repo's own comment in `Tooltip.tsx` and the
Pointer Events spec, and asking for a press-open controlled tooltip instead.

That is the right reading of the comment and the wrong prediction about this trigger. The comment
describes the **controlled** spine case, where hover-close also cleared `armed`. What Chromium
actually sends a plain `<button>` on a tap, captured on the element itself:

```
pointerover(touch) pointerenter(touch) pointerdown(touch) touchstart
pointerup(touch) pointerout(touch) pointerleave(touch) touchend
mouseover mouseenter mousedown focus mouseup click(touch)
```

`pointerleave` comes before the compatibility mouse events; **`mouseleave` does not come at all**,
and the element stays hovered until the next tap lands elsewhere. The card opened and was still open
two seconds later, twice over. Sol's own note that *"the button has no other action"* is the reason
the sticky hover is harmless here.

So no controlled tooltip, no fifth reveal-then-commit surface. **What we could not check is a real
iPad** — the box has Chromium and no device — and Chromium's touch emulation is not Safari. The
retreat if it is wrong is the one Sol wrote: controlled state plus a press handler, one component,
and nothing else on the page depends on it.

**P2-1, the tests stop short of the store seam — taken.** The jsdom cards would be just as green if
`articleMetadata` read the wrong column. `tests/store-carry-forward.test.ts` now asserts, against
Postgres, that the page is handed the stored `started_at` and `finished_at` of one run and that
`beginDraftIn` carries the pair unchanged. It goes red if `startedAt` is mapped to `finishedAt`
(checked). Its `step()` helper now writes the two stamps 8.4s apart rather than both `new Date()`,
without which a column swap is invisible.

**P2-2, boundaries and malformed input — taken**, and it is what turned up `3m 60s`. Every case is
its own test.

## What landed

One stage, as planned.

- `StageState.startedAt` in [`src/types.ts`](../../src/types.ts), with the note on why it is not the
  `started_at` fallback `ranAt` refuses, and why the pair cannot describe two different runs.
- `articleMetadata` in [`src/store/pg.ts`](../../src/store/pg.ts) sends it.
- [`Metadata.tsx`](../../src/web/Metadata.tsx): `tookFor`, exported for its own test, and
  `· took 8.4s` on the card's first line.
- [`relative-time.ts`](../../src/web/relative-time.ts): `howLong`, one copy where there were two —
  § There was already a `howLong`. `Tweets.tsx` and `tests/tweets-page.test.ts` import it now.
- [`tests/metadata-step-timing.test.tsx`](../../tests/metadata-step-timing.test.tsx) — 14 cases: the
  card, the three declines, and every formatter boundary. Watched red before it was green, by
  disabling the one line that writes the duration.
- The step-run assertion in `tests/store-carry-forward.test.ts` described above.
- Two existing `StageState` fixtures gained the field.

**Seen working on real rows**, signed in against a local dev server, all ten step rows of
`fowler-phrenology`:

```
blocks     … · took 92ms
quotes     … · took 14.2s
ideas      … · took 1m 47s
timeline   … · took 1m 49s
```

Which is the argument for having built it: the two model steps that cost two minutes each are now
visible as such, and they did not look any different from the 92ms ones yesterday.

## The code review

GPT Sol again, on the built tree including the `howLong` merge. **No P0, P1 or P2** — three P3s, all
prose, all taken:

- The feedback note said *shipped* before the change was on `dev`. True when written; it is on `dev`
  now.
- **"Two disclosures deep" was wrong**, in the note and in the test's docstring. There is one
  disclosure — `Technical details` — and `What we did to it` is an ordinary `h3` inside it
  (`SubHeading`, which is deliberately not a nested `Section`). The phrase was borrowed from a
  comment in `Metadata.tsx` that counts the subheading as a second disclosure; that comment is
  loose, and repeating it made it wrong. The point survives the correction and so does the argument
  built on it.
- The Stages list still named `formatDuration`, from the version before the merge.

What it checked and did not find, which is the useful half: no `1000ms`, `60.0s` or `Nm 60s` path;
`an unknown time` unreachable from the card; `startedAt` off the right column with both stamps
preserved by the fenced write and the carry-forward; no production `StageState` constructor missed;
no unnamed change to the Tweets page. It also went through the tests asking which would pass with
the feature absent — the fixtures, the Tweets cases and the pure formatter cases all would, and it
named the positive card test and the store test as what closes each gap. That was the question worth
asking of this change, and it is the reason the store test exists.

## What we did not do

**Nothing moved out of `Technical details`.** § What we checked says why that section is the likeliest
reason the existing card went unfound, and the same thing has already happened once on this page —
the re-run placeholder sat in it for three days and was then asked for as a new feature
([260907d](260907d-re-run-any-generated-mode-from-the-metadata-page.md)). Whether the machinery
should be less buried is a product call about the page's order, not part of this report, so it is
written down in the user-feedback note and left for Greg.

**The section's own summary line — `6 of 16 stages · last wrote 2 days ago` — has no card.** It is a
relative time with no exact stamp behind it, shown whether the section is open or shut, so it is
arguably the same ask one level up. Left alone: it is a *derived* stamp (the newest across sixteen
rows), so the sentence it would need is not the sentence the rows use, and the report named the rows.
