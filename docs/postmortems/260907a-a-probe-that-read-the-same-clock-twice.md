# A probe that read the same clock twice

A geometry instrument built to decide whether A8 was worth doing changed the behaviour of the page it
was measuring. It never reached `dev` — GPT Sol found it reviewing Stage 1 as F14, and reproduced it
before anybody ran the harness again. It is written up because the cost is not the trigger: the same
hands will do this again somewhere nothing is watching.

## What happened

`src/web/scroll.ts § watchBarVisibility`'s `apply` runs on every scroll frame on a small device. It
suppresses the hide-on-scroll bar for the length of a jump the app itself started, so that chrome
never answers to our own scrolling:

```ts
const t0 = parentGeometryClock();      // performance.now(), when the probe is on
if (performance.now() < quietUntil) {  // …and again, for the decision
```

Two reads of a monotonically advancing value, where the code assumes one. With the probe **off**,
`parentGeometryClock()` returns a sentinel without touching the clock, and the comparison gets the
frame's first clock read. With the probe **on**, the comparison gets the *second* — a little later,
and at the boundary the other side of it.

Sol's reproduction: `quietUntil` 250, successive clock values 249 then 251. Counting off, the frame is
inside the quiet window and leaves the bar alone. Counting on, the same frame is outside it, hides the
bar, and **writes to `documentElement.dataset` in the middle of a gesture** — in the one file whose
instrumentation exists to establish whether writes between reads are forcing layout.

So the instrument could produce a write that only exists when the instrument is running, and then
charge itself for it.

## The real root cause

Not the duplicated call. The module had already reasoned about this exact hazard and written the
conclusion down — `geometry-cost.ts`:

> **Nothing here patches `getBoundingClientRect` or any other DOM accessor**, and it must not start: a
> patched accessor is a probe that changes the behaviour of the thing it measures.

That is the right requirement stated as the wrong kind of rule. **It prohibits a mechanism, so the
mechanism was avoided and the property went unchecked.** No accessor was patched; the probe changed
behaviour anyway, through a shared value nobody had classified as shared. `performance.now()` reads
like a free observation, and it is not: a site that compares it against a deadline is *deciding* out
of it, which makes every extra read a change to that decision's inputs.

A prohibition can be satisfied. A property has to be tested — [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md).

## The class, named

***Two reads of one moving value, where the code assumes one*** — and its instrumented variant, where
the probe supplies the second read.

The instrumented variant deserves its own sentence, because it inverts the usual defence. Ordinarily a
probe is safe if it only *reads*. Here reading was the whole harm: the resource was a position in a
monotonic sequence, and consuming one is not observation.

**This job had already fixed the uninstrumented form of the same class, twice, in the same file set.**
Stage 2 of A8 hoisted `stickyOffset()` from two calls a frame to one in `App.tsx`, and `innerHeight`
from two to one in `useColumnContext.ts`. Those were safe to hoist precisely because nothing wrote
between the reads, so the two agreed. The clock never agrees with itself. Stage 1 introduced the
dangerous form of the class into `scroll.ts` in the same week Stage 2 removed the harmless form from
two files either side of it, and nobody — me included — noticed they were the same shape.

## Which commit introduced it

`914f59c4`, "A8 stage 1: measure the geometry reads, and the verdict is optimise", on
`worktree-a8-shared-geometry`. Found by `git log -S "const t0 = parentGeometryClock();" -- src/web/scroll.ts`.
Never merged to `dev`, never deployed, so no reader ever saw it. What it *did* corrupt is the Stage 1
measurement itself: `barVisibility`'s write count was taken from a page that only exists while the
probe is running.

## The fix

Shipped and long-term are the same here, which is not always true.

`geometry-cost.ts` gains `parentGeometryClockFrom(now)` — the parent's start time taken from a clock
value the site has *already* read — and `apply` reads `performance.now()` exactly once at the top of
the frame, using that one value for both the quiet-window comparison and the timer. The saving is not
the call. It is that there is now only one clock value in the frame, and therefore only one page the
measurement can be describing.

The wrong long-term fix, considered and rejected: making the probe read the clock *after* the
decision. That removes this instance and leaves the class, because the next site's decision might come
second.

## What would have caught it, ranked by ease against value

1. **A paired off/on assertion on behaviour, not on counters** — the same gesture, the same scripted
   clock, the probe off and then on, and the resulting page state required to be identical.
   [tests/probe-does-not-change-the-page.test.ts](../../tests/probe-does-not-change-the-page.test.ts).
   Done. It fails on the old code and passes on the new, and it carries two controls — the bar *does*
   hide once the window passes, and *doesn't* inside it — so it cannot pass by never running the
   listener, which is the way this kind of test usually dies.
2. **State the rule as a property instead of a prohibition.** "The probe must not change what the page
   does" replaces "the probe must not patch accessors", and the second becomes an example of the
   first. Costs one comment edit; would have prevented this instance, because the question "does this
   change behaviour?" has a different answer from "did I patch anything?". Done, in
   `parentGeometryClockFrom`'s docstring.
3. **Treat a clock read like a DOM read when instrumenting** — read once per frame, pass it down.
   `parentGeometryClockFrom` exists to make the correct pattern the convenient one, which is the only
   version of this rule that survives contact with a hurry.
4. A lint rule banning `performance.now()` in any file importing `geometry-cost.js` — **rejected**. It
   targets the mechanism again, exactly the mistake above; `glide` legitimately reads the clock in the
   same file for animation progress, so the rule would be wrong on its first encounter.
5. Compile-time removal of the probe in production builds — **rejected** as heavyweight *and*
   ineffective: the configuration that matters is the one where the probe is **on**, since that is the
   configuration every measurement is taken in.

## See also

- [260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md](../plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md)
  § "Review ledger — round 2" — F14 and the other four P1s from the same review.
- [silent-success.md](../reusable/silent-success.md) — the paired control the test above uses.
- [performance.md](../project/performance.md) — what the instrument was built to answer.
