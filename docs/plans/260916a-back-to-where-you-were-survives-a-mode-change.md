# Back to where you were survives a mode change — and a rotation keeps your place

Status: **built**, 2026-09-16 — every stage, with the cross-family review of the plan
([the findings](260916a-plan-review-sol.md)) folded in before any of it was written. From Sentry `SPIDERYARN-READING2-41`, the second of the two things in
that report (the first, a reading-time indicator, is its own queue entry and its own session).

This extends [260906g](260906g-back-to-where-you-jumped-from.md), which built the return chip. It
does not rebuild any of it: the finding below is that the *shared machinery Greg asks for already
exists and is already universal*, and that two specific holes let it fall silent in exactly the two
situations he named.

## What Greg asked for

> if I switch from portrait to landscape or if I click on things, it takes me to other bits of the
> article and I sort of lose my place.
>
> And we have a kind of back to X thing. But I don't know if I always, I mean, perhaps we can also
> separately look into whether that's always showing up. So ideally we want things across modes to
> use reusable machinery so that if we build something like that back to X when you click on an
> entry in a mode, that should be true across citations and quotes and ideas and search and
> everything else that has that similar kind of ability to jump us around the article.
>
> So then the back to would work robustly and universally. And I mean, you could argue that maybe
> the back to should be sort of instead of it just showing up as a little widget, maybe there's a
> thing I can press in the bottom bar and it shows me my history as a kind of stacked vertical blah,
> blah, blah.
>
> — Greg, 2026-09-12

## The audit he asked for first: where "back to X" shows today, and where it does not

**Every mode-originated jump already goes through one function.** `jumpTo`
([`reader/useReadingPosition.ts`](../../src/web/reader/useReadingPosition.ts)) is handed down as
`onJump` to every band and panel — citations, quotes, ideas, glossary, search, timeline, structure,
debate, referee's four panels, quiz, summary, diagram, the spine, the gist columns, `BlockRef`
citations in chat, and the article's own internal links
([`internal-links.ts`](../../src/web/internal-links.ts)). There is no panel with a jump of its own:
`grep -rn "onJump("` over `src/web` finds only declarations and calls, never a second mechanism.
`jumpTo` calls `beginJump` ([`keynav.ts`](../../src/web/keynav.ts)), which measures the origin, arms
it, and makes the one push that `watchHistoryWrites` stamps.

So the universality Greg wants is **already the design**, and rebuilding it would be building a
second one.

**Four things move the reader without pushing, and all four are deliberate** — named here because
"everything goes through `beginJump`" is false as a flat sentence, and a reader of this plan should
not have to discover the exceptions by being surprised by one:

- **↑ / ↓** — `scrollToBlock` direct ([`keynav.ts`](../../src/web/keynav.ts) § `useArrowNav`).
  *"A stride you take twenty times must not cost twenty presses of Back."*
- **Swipe steps** — the same arithmetic and the same reason
  ([`swipe.ts`](../../src/web/swipe.ts)).
- **Stepping between comments** — Stage B2 of 260906g
  ([`comment-jump.ts`](../../src/web/comment-jump.ts)).
- **Arrival**: the `?at=` restore, and the once-only scroll to an arriving `?note=`
  ([`Reader.tsx`](../../src/web/reader/Reader.tsx)) — landing somewhere is not travelling there.

None of them is a mode jumping the reader across the article, which is the thing Greg's sentence is
about, and none should start pushing. GPT Sol, reviewing this plan, 2026-09-16.

That leaves the question the report actually asks: *why does it not always show up?* Two holes, both
in the shared machinery, both found by reading rather than guessed:

### Hole 1 — leaving the mode throws the chip away, and on a phone you have to leave the mode

`watchHistoryWrites` ([`router.ts`](../../src/web/router.ts)) writes
`innerPush(withStamp(state, origin), …)`, where `origin` is `null` for any push that is not itself a
jump. `withStamp(state, null)` **deletes** the stamp key. 260906g states this as a rule — *"the
reader taking the stack onwards (any push strips the stamp)"* — and it is right about a reader who
has moved on. It is wrong about a reader who has not moved at all, and `?mode=` is `history: "push"`
([`params.ts`](../../src/web/params.ts)), as are `?cols=`, `?sort=`, `?rank=`, `?deep=`, `?order=`,
`?citeby=`, `?match=`, `?diagram=`, `?referee=` and `?remember=`.

On a phone this is not an edge case, it is **the only path**. Below `MODE_MIN + MODE_PROSE_FLOOR`
the band covers the whole window — `.reader.band-covers` in
[`narrow-window.css`](../../src/web/styles/narrow-window.css), which also hides the masthead — so
the article the reader just jumped into is *behind* the panel they jumped from. To see where they
landed they press Plain. That is `setMode("plain")`, a push, and the chip is gone before they have
seen the paragraph it was offering to take them back from. Greg reads on an iOS home-screen app,
where there is also no browser Back to fall back on. This is, on the evidence, the whole of *"I
don't know if that's always showing up"*.

**And then one press of the chip is no longer one press of Back.** This is the part that makes the
fix more than a one-liner. Today the chip is `history.back()` and nothing else, which is only
correct because the origin is always the immediate predecessor. Once a stamp can ride across a
mode change, the origin is *n* entries back, and `history.back()` would land the reader on the
entry they jumped *to* — a button whose label is right and whose behaviour is off by one, which is
worse than no button. So the stamp gains a **depth**: how many entries back the origin is, `1` on
the jump itself and one more on each entry that inherits it, and the chip presses `history.go(-n)`.

#### The rule: every same-article push carries it, and the depth is right *because* of that

The first draft of this plan said the rule was **same pathname and the same `?at=`** — inherit only
when the reader has not moved. GPT Sol refused it, 2026-09-16, and was right twice over:

- **`?at=` is not a statement about where the reader is.** It names a *section*, and
  `positionToWrite` ([`position.ts`](../../src/web/position.ts)) deliberately holds it still while
  the reader moves anywhere inside that section. So "same `?at=`" and "has not moved" are simply
  different facts, and the first is not evidence of the second.
- **And the write is debounced**, so whether a genuine move had landed in the address by the time
  the reader pressed Plain would decide whether the chip survived. The same gesture, twice, with
  different answers 300ms apart. A rule that flickers is worse than either of the rules it flickers
  between.

So the rule is the simpler one, chosen explicitly rather than inferred: **a push that stays on this
article carries the stamp forward at depth + 1; a push that leaves it drops the stamp.** Nothing is
guessed about movement at all.

**That is not a compromise; it is arithmetic rather than interpretation.** The depth is a claim
about *the stack*, not about the page: a successful same-document push adds exactly one entry, so
`depth + 1` is the origin's distance whatever the push changed — mode, columns, sort, or something
added next year that this file has never heard of. The old rule needed to know what a push meant;
this one does not, which is why it cannot be wrong about a push it does not recognise.

**One ceiling it cannot reach past, and the code review would not let this plan claim otherwise.**
The count is exact only while the browser retains the origin entry. The HTML standard permits an
implementation-defined limit on same-document state entries with eviction of the oldest, and the
History API exposes neither the entries nor the index — so an evicted origin cannot be detected
locally, and a press would land elsewhere. The only fix is the parallel history 260906g refused.
This stage accepts the ceiling; the first draft of this section called the rule *provably right*,
which overstated it. GPT Sol, reviewing the built code.

A push that **leaves the article** drops it, and that is not an exception but the same statement:
the label is a section title resolved against *this* article's sections, and `history.go(-n)` from
another document is not an offer this chip is able to make.

It also makes the one remaining asymmetry go away. A replace has always preserved the stamp, so the
chip already survives the reader scrolling the length of the article. That a column toggle killed it
while a mile of scrolling did not was never a rule anybody chose; it was a consequence of the
wrapper's two branches. Now the sentence is one sentence: **the way back lives until the reader
leaves the article or dismisses it.**

**No cap.** The first draft stopped inheriting at ten, on the grounds that a single press undoing
eleven deliberate acts is no longer "back to where I was reading". GPT Sol refused that too, and the
refusal is right: at depth eleven the origin is still exactly as reachable as it was at depth one,
so a cap takes a working affordance away for a feeling, and *"robustly and universally"* is the
thing being asked for. Dismissal already exists for a return that has outlived its use, and it is
the reader's judgement rather than ours. What remains is **plausibility validation, not policy**:
a depth that is not a safe positive integer within a sane bound draws no chip, on the same reasoning
`readStamp` already applies to the block id.

#### The shape on disk, and what an older bundle makes of it

A stamp is written by the code that is running and read by whatever code is running when the entry
comes back — and those need not be the same deploy. An entry stamped at depth 2 and then reloaded
onto the **previous** bundle would be read by a `readStamp` that knows only `from`: it would ignore
the depth, draw the chip, and `history.back()` one entry, landing the reader somewhere the label
does not name. GPT Sol's first finding, and it fails *open*, which is the bad direction.

So the new stamp is a shape the old parser rejects. Under the same `spya` key — deliberately the
same, so that an old `withStamp(state, null)` still deletes it rather than carrying an unfamiliar
second key onwards for ever — the new value is `{ v: 2, origin, depth }` and carries **no `from`**.
The old parser reads `mine.from`, finds nothing, and returns `null`: no chip, which is the honest
answer from code that cannot honour it.

The other direction costs one line: a `{ from }` with no `v` is an old stamp and reads as depth 1.

### Hole 2 — a rotation reflows the article and nothing puts the reader back

Nothing in the app listens for an orientation change to hold the reader's place, and the one thing
that reacts to a reflow moves the address rather than the reader.
`useReadingPosition`'s spy effect keys on `layoutKey`, which contains `windowWidth`
([`Reader.tsx`](../../src/web/reader/Reader.tsx)), and calls `measure()` immediately when it
re-runs. So a rotation does this:

```
portrait, reading § "The middle bit"        ?at=<first block of the middle bit>
      │
      ├─ rotate: the browser keeps scrollY in PIXELS, the prose reflows to a new
      │  measure, and the pixel the reader was on is now a different paragraph
      │
      └─ layoutKey changes → measure() → positionToWrite sees a different section
         → ?at= is REWRITTEN to wherever the reflow left them
```

The reader is somewhere else, and the record of where they were has been overwritten by the thing
that noticed. No chip appears, and correctly so: nothing jumped. **The fix is not a chip.** It is to
treat a reflow as *the layout changing under a reader who is staying put*, and re-anchor the page to
the block `?at=` already names instead of letting the reflow decide what `?at=` should say.

`?at=` is section-granular ([`position.ts`](../../src/web/position.ts) § `positionToWrite` only
writes when the *section* changes), so this restores the section rather than the sentence. That is
the precision this app has, it is the precision a reload already gives, and it is enough for the
complaint: a reader who comes back to the right section has not lost their place.

It also covers a gist-column toggle, which reflows every row for the same reason and today walks the
reader down the article by however much the new measure costs. Named here rather than discovered
later: this stage changes that too, deliberately, and it is the same rule.

**And a rotation *during* a jump is the same bug one layer down.** `scrollToBlock` works out a
destination in **pixels** and hands it to `glide`, which then spends about 200ms travelling to that
number ([`scroll.ts`](../../src/web/scroll.ts)). Reflow the article mid-flight and the number is
about a layout that no longer exists, so the glide lands somewhere arbitrary and the spy writes
*that* down. The first draft of this plan made it worse rather than better, by skipping the
re-anchor whenever a glide was in flight — which is exactly when the stale number needs
overriding. GPT Sol's second finding, 2026-09-16.

The fix is one more clause on the same rule rather than new machinery in `scroll.ts`: a layout
change **abandons any glide** (`abandonScroll`, already exported for `comment-jump.ts`) and then
re-anchors instantly. There is no pixel left to be stale, and the block the reader was heading for
is the one `?at=` already names, because `jumpTo` sets the address before the glide finishes.

The one window this does not cover is the ~50ms between the tap and nuqs flushing that push, during
which `?at=` still names the *origin*: rotate inside it and the re-anchor puts the reader back where
they started rather than where they were going. Written down rather than defended away — it is a
50ms window on a gesture that takes a second, and the failure is "the jump did not happen", which is
recoverable by tapping again, rather than "you are somewhere nobody chose".

## The simpler options passed over

- **Do nothing about Hole 1 and tell the reader to press Back twice.** Rejected: on the iOS
  home-screen shell there is no Back at all, which is the whole reason the chip exists.
- **Make `?mode=` a replace, so leaving a mode does not push.** Much smaller, and wrong: it would
  take mode switching out of Back entirely, which
  [url-state.md](../project/url-state.md#position-replaces-history-deliberate-acts-push) makes a
  deliberate act, and `activation.ts` documents Back walking through mode entries as a feature.
- **Give the chip a `?from=` parameter instead of a depth.** Refused once already by 260906g, for
  reasons that still hold: it rides along in shared links and needs clearing rules of its own.
- **A one-shot handshake, armed only when leaving a covering band for Plain.** GPT Sol's narrowest
  option, and it is genuinely smaller. Passed over because it answers *this* gesture rather than the
  question: a mode added next year, or a sort toggle pressed before Plain, would be back to losing
  the chip, and the reporter's word was "universally". It is also a second thing to remember at every
  new call site, which is the shape of a rule that decays.
- **Have the chip push the origin address rather than going back.** No counting needed, but it grows
  the stack, it loses the mode and panel state the predecessor entry carries, and a second press
  would do nothing because `beginJump` refuses a jump to where you already are.
- **Re-anchor on rotation only, via `orientationchange`.** Narrower than `layoutKey`, and more
  machinery for less: a listener, a debounce and a media query, to do what re-running an effect that
  already re-runs can do. It would also leave the column toggle broken in the same way.
- **The history list behind a button in the bottom bar** — Greg's own larger idea. Named and **not
  built**, because it is not small: JavaScript cannot read the history stack
  ([260906g § the option that cannot be taken](260906g-back-to-where-you-jumped-from.md)), so a list
  means keeping a parallel stack of our own with retention rules, and that is the second history
  260906g decided against. The depth counter added here is *one number*, not a list, and does not
  bring a list any closer. Worth revisiting only if Greg presses the chip repeatedly and says he
  wants to see where it will take him first.

## Stages

Each stage is its own commit, each ends with `npm test` scoped and `npm run typecheck`, and the code
goes to GPT Sol before the push.

### Stage 1 — the failing tests — **done**

Both holes reproduced before either was fixed, so that neither fix is a change nobody watched fail.

- `tests/return-chip.test.tsx` § **a push that does not move the reader**: jump, then push a
  `?mode=` change, and the chip must still be drawn and still name the origin section. **Red**, and
  so is the `?cols=` twin.
- A new `tests/reading-position-holds-across-a-reflow.test.tsx` drives `useReadingPosition` through
  a `layoutKey` change with the rows shorter underneath it. **Red**: `?at=` moved from the section
  the reader was in to the one the reflow left them in, and nothing scrolled.

### Stage 2 — the way back survives every push that stays on the article

- [`jump-history.ts`](../../src/web/jump-history.ts): `JumpStamp = { origin: JumpOrigin; depth: number }`.
  `readStamp` returns it, parsing both shapes — `{ v: 2, origin, depth }` and the legacy `{ from }`
  at depth 1 — and returning `null` for an implausible depth. `withStamp` writes only the new shape.
- [`router.ts`](../../src/web/router.ts) `watchHistoryWrites`: when no armed jump claims the push,
  carry the current entry's stamp at `depth + 1` if `pathnameOfWrite(url) === location.pathname`;
  otherwise `null`. That is the whole condition.
- [`ReturnChip.tsx`](../../src/web/ReturnChip.tsx): `history.go(-depth)`.
- [`router.ts`](../../src/web/router.ts) gains `useJumpStamp` for the chip, and `useJumpOrigin` stays
  as the derived view [`Spine.tsx`](../../src/web/Spine.tsx) wants. **The first draft of this plan
  claimed Spine needed no change and that was false** — it and the chip read one store, and the
  store's type is moving. GPT Sol's sixth finding.
- **Two existing tests reverse**, and both are load-bearing rather than incidental:
  *"draws nothing after a cols push has taken the reader on"* asserted the behaviour this stage
  removes, and *"notices a stamp being stripped at an unchanged URL"* (F6) used such a push to make
  a stamp vanish at an unchanged address. The second keeps its whole point by being driven with
  `dismissJumpOrigin` instead, which is *exactly* a stamp disappearing at an unchanged URL, so the
  store-identity regression F6 exists to catch stays covered.

### Stage 3 — a reflow holds the reader's place

- `useReadingPosition` gains a `useLayoutEffect` — **layout**, not passive, so there is no paint at
  the wrong paragraph — holding the previous `{ layoutKey, at }`.
- It re-anchors **only when `layoutKey` changed and `at` did not**. When `at` changed too, the
  restore effect owns the move, and a Back or Forward step that changes both would otherwise be two
  movers on one page. That is the right seam, and "skip the first run" was not: the restore effect
  owns arrival, Back, Forward and pasted links, not merely the first render. GPT Sol's fourth
  finding.
- `at === null` re-anchors nothing: above the first section there is no section to hold, and it is
  where the browser's own restoration is already right.
- It calls `abandonScroll()` first, so a glide's stale pixel destination cannot finish the journey
  after the layout it was measured in has gone.

### Stage 3b — the sequences that would still be green if the arithmetic drifted

The happy-path tests above pass with several invariants broken, which is the shape
[silent-success.md](../reusable/silent-success.md) is about. So `tests/return-chip.test.tsx` gains a
§ **the depth keeps naming the origin** with the sequences GPT Sol asked for: two inherited pushes;
Back and then a push (the forward stack truncated); Forward; a second jump made from an entry that
already carries an inherited stamp, then two presses; dismissal on an intermediate entry followed by
Forward; a legacy `{ from }` stamp inherited by new code; and the plausibility boundary.

### Stage 4 — docs and the feedback note

- [url-state.md](../project/url-state.md): the stamp's new shape and the "same place, different
  view" rule, under the section that owns position.
- [260906g](260906g-back-to-where-you-jumped-from.md): a line at § When it is not there pointing
  here, since this changes a rule that file states.
- `docs/user-feedback/` note naming the ending, per
  [feedback-reports.md § Three ways a report ends](../project/feedback-reports.md).

## What the cross-family review changed

One round on the plan before anything was built —
[the findings](260916a-plan-review-sol.md), GPT Sol, 2026-09-16. Eight, all accepted, three of them
changing the design rather than tightening it:

| # | What it found | What it changed |
|---|---|---|
| 1 | An older bundle reading a new stamp draws a chip it cannot honour — it fails **open** | The stamp is a shape the old parser rejects: `{ v, origin, depth }`, no `from` |
| 2 | Skipping the re-anchor while a glide is in flight leaves the stale-pixel race *unfixed* | A layout change abandons the glide and then anchors |
| 3 | "Same `?at=`" is not "has not moved" — it is section-granular **and** debounced, so the rule would flicker | Every same-article push carries the stamp; nothing is inferred about movement |
| 4 | The restore effect owns Back and Forward too, not just the first render | The seam is `layoutKey` changed **and** `at` unchanged, in a `useLayoutEffect` |
| 5 | The depth cap removes a working affordance for a feeling | No cap; plausibility validation only |
| 6 | Spine and the chip read one store, so "Spine needs no change" is false | `useJumpStamp` for the chip, `useJumpOrigin` derived for Spine |
| 7 | The happy-path tests stay green with the arithmetic broken | Stage 3b, the sequence tests |
| 8 | "Everything goes through `beginJump`" is literally false | The four deliberate non-pushing movers are named in the audit |

The other three conclusions it was asked to attack it confirmed against the source: an unarmed push
strips the stamp today, a narrow band covers the prose and Plain is a push, and a width change
restarts the spy whose immediate `measure()` overwrites `?at=`. It also confirmed that Stage 3 alone
would not answer the missing-chip complaint.

### And the second round, on the code

[The findings](260916a-code-review-sol.md), GPT Sol, 2026-09-16, weighted higher than the first
round for the reason [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md) gives — a
plan-stage review cannot see a cache keyed on the wrong thing. Three fixes, one of them a bug this
stage did not introduce:

1. **`useJumpOrigin` redrew the rail for a number it does not use.** The identity cache was keyed on
   the whole stamp, so every mode or column push handed `Spine.tsx` a new object because the *depth*
   had changed — a 2,000-row redraw for nothing. Now an origin-only snapshot over the same store.
2. **`readStamp` fell through to the legacy shape for a *future* version marker**, so a later
   `{ v: 9, from: … }` could be read as a one-step return. Unknown versions now fail closed, which
   is the direction the whole versioning exercise exists for.
3. **An armed jump could leak, and that predates this stage.** Only `popstate` ended an arm. A bare
   `replaceState` reaching the wrapper makes nuqs run `sync()`, which resets its queue and **throws
   the jump's queued write away** — the mechanism `dismissJumpOrigin` wears the nuqs marker to avoid
   (F20, 2026-09-06). The push never came, so `isJumpArmed()` went on withholding the chip *and* the
   rail's origin mark until the next `popstate` or the next jump. Any push that does not claim the
   arm, and any replace, now ends it.

**The third was checked rather than taken.** Ending an arm on any replace is only safe if a replace
cannot land between the arm and the jump's own flush — and the case that would do it is ordinary
rather than exotic: the glossary writes `?term=` (a replace) and then calls `onJump` (a push) in one
handler, and ideas and quotes do the same with their own parameters. Three tests now drive the real
nuqs setters in both orders and a tick apart, and nuqs merges them into the single pushed flush, so
the arm meets its own write.

Writing the boundary test corrected a belief rather than confirming one: a bare replace does not
merely cost a jump its stamp, it cancels the jump's write outright — which is *why* the arm leaked
rather than merely going stale.

The fourth finding is the one with nothing to fix: § the rule above now says what it can and cannot
claim.

## Deliberately not in this plan

- **The reading-heat indicator** — the first half of report 41, and a queue entry of its own.
- **The history list in the bottom bar.** Argued above.
- **A finer origin than a block id.** 260906g's F10 already names this as a design rather than a
  patch, and nothing here needs it.
- **Anything about Tweets or Metadata remembering their own position.** Still 260906g's deferral.
