# A keyed queue replaced the intent before its delayed write

The first implementation of [261008g](../plans/261008g-the-way-back-chip-moves-the-position-and-leaves-the-modes-alone.md)
could put an undone journey back into the return chip, or fail to advance the journey after an
immediate scroll. Both defects were caught in code review before the change was committed; nothing
reached a reader.

## What happened

A return arms the history stamp it wants, queues `setAt(origin)` in nuqs, and moves the page at once.
The history entry is written later. nuqs keeps one pending value per query key, so another `at` write
before that flush replaces the return's target.

Two ordinary sequences exposed the same mistaken assumption:

- a new jump replaced the queued return, but its stamp was built from the pre-return
  `history.state`, duplicating the journey just undone;
- on an older Safari, nuqs may hold a batch for 320ms while the position spy waits 300ms, so an
  immediate scroll can replace the return target before the pushed batch lands. Exact target
  matching then refused the return arm and carried the old stamp unchanged.

The red tests received `{ origin: B, earlier: [B, A] }` where the return-then-jump sequence required
`{ origin: B, earlier: [A] }`, and kept `{ origin: B, earlier: [A] }` where the retargeted return
required `{ origin: A, earlier: [] }`.

## The class: a keyed queue replaced the intent before its delayed write

The code treated a queued value as the identity of the act that first queued it. In a coalescing
queue those are different facts: the value may be replaced while the eventual write still combines
options and intent from the whole batch. Reading committed state at flush time was also not enough,
because the page had already performed an uncommitted return.

The bug was introduced in the uncommitted implementation of plan 261008g, so there is no introducing
commit. The earlier jump handshake had exact target matching for a sound reason; extending that
predicate to returns without modelling replacement is where the class entered.

## Why nothing went red

The queued-mode test covered two different keys, `mode` and `at`; nuqs merges those without replacing
either. The same-value test checked the movement and the hidden chip, so an arm that stayed unclaimed
could satisfy it for the wrong reason. Neither test put two values through nuqs's one `at` slot before
the flush. The plan review named both the queue and the scroll race, but the implementation tests
covered only the happy form of coalescence.

## What would have caught it, ranked by ease against value

1. **Drive two same-key intents through the real queue before one flush** — done in
   [`return-chip.test.tsx`](../../tests/return-chip.test.tsx). The tests were observed red before the
   fixes and pin both replacement sequences.
2. **Assert the committed stamp and arm state, not only the URL or the chip's absence** — done for
   the same-value return. A hidden chip is ambiguous while an arm is pending.
3. **Replace the module arm with a general transaction queue** — rejected. nuqs deliberately emits
   one write for the batch, so a parallel queue would have to duplicate its coalescing rules and
   would be more likely to drift than the small transition carried by the winning arm.

## The long-term fix

The shipped fix should compose the logical transitions represented by the one eventual write.
`armJump` therefore carries the journey left by a pending return as its base, including an explicit
`null`, and the wrapper uses that base instead of stale committed state. A jump or return may accept a
changed target only on the same marked nuqs write, from the same address and pathname; raw pushes
retain exact matching. The transition remains beside the arm rather than becoming a second history.

## The thing I would tell myself

I knew nuqs used a map keyed by parameter name, but I tested coalescing as “two keys become one
write.” The dangerous case was the other meaning of a map: two intentions for one key become one
value, and the last value does not erase the earlier act that already moved the page.
