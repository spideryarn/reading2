# A test blurred away the condition it existed to test

Caught in review, cost nothing, and would have shipped a defect **with a green test standing over
it** that said the defect was fixed. That combination is why it is worth a file: the next instance
will not be about focus, and the mechanism that hid it is not specific to focus at all.

## What happened

Stage 3 of
[260906f](../plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md) made
one Escape press close one surface instead of two. The
[escape inventory](../plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md)
calls its **pair 3** — an open annotation plus a prose hover card — *"the cheapest path to the loss,
and it needs no click"*: the reader selects a passage, starts typing a note, **hovers** a glossary
term, and presses Escape to dismiss the card. Before the stage, that one press discarded the
half-typed annotation.

The stage made `useHoverCard` call `stopPropagation()` on the `document` bubble phase, which is ahead
of the `window` bubble listener the annotation uses. A test mounted both, pressed Escape, and
asserted the card closed and the draft survived. It passed.

It passed because of one line in its own helper:

```ts
/* Out of the box before the press, which is what a reader who has just clicked
   a comment mark or a hover card has done. */
(box as HTMLTextAreaElement).blur();
```

`AnnotateDialog` focuses its textarea on mount, and **hovering moves no focus**. So in life the
press landed on the textarea's own React `onKeyDown`, which is tier T1 — React's root container is a
*descendant* of `document`, so on the bubble path it runs **before** the hover card — and that
handler clears a non-empty draft and stops the event. The words were still destroyed, the card was
still left standing, and nothing anywhere went red.

The comment is the tell. It says *"clicked a comment mark **or a hover card**"*, and a hover card
opened by hovering was never clicked. One clause of a sentence carried the whole mistake.

## The real root cause

Not the `blur()`. The `blur()` was written to reach a state the test needed, and it does.

The cause is that **the helper was shared across pairs that reach their state by different routes.**
Pairs 1, 2 and 4–6 are all reached by a *click* — a comment mark, a gutter button — and for those
the blur is exactly right, because clicking really does move the focus. Pair 3 was added to the same
loop because it looked like the same shape: two surfaces, one press, assert one closes. The one thing
that distinguishes it — that it needs no click, which is *why the inventory singles it out* — is
precisely the thing the shared helper overwrote.

Ask why once more and it stops being about this test: the harness encoded **a state** where the
scenario specified **a route to that state**, and a route is not recoverable from its destination.

## The class: *a fixture that arranges away the condition under test*

Say it in a sentence: **the test reached the right state by a means the scenario does not use, and
the means was the thing under test.**

It is a sibling of the class this plan has now produced three times — an assertion satisfied by
something other than the behaviour — but it is a distinct mechanism and deserves its own name. The
others were assertions that matched the wrong text ([F31 on stage
2](../plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md): a test that
passed on a comment the same commit had added; and, in stage 3, a wiring check satisfied by a
commented-out copy of the prop). This one is upstream of the assertion: **the assertion was correct
and the world it was asked about was not the one under test.** No amount of strengthening the
`expect` would have found it.

It is also the exact inverse of the usual advice. "Set the test up in the state you care about" is
sound; it fails when *arriving* in that state is the behaviour.

## Which commit introduced it

The test never reached `dev`. It was written during stage 3 and the defect was found by GPT Sol's
first review of the built code, before the stage was committed —
[the review](../plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md)
§ *Two amendments*, its P1. The fix and the honest test are in the same commit as the stage,
`3f2b37ad`. **Nothing was ever broken in production by this**; what would have shipped is a fix that
did not fix pair 3, with a test asserting it did.

## The fix

**Shipped, and it is also the right one:** `useHoverCard`'s listener moved to `document` **capture**,
which runs outside-in and is therefore ahead of every React handler as well as of the two bubble
tiers below it. That is the correct order rather than a lucky one — the card is `z-index: 100`, the
topmost thing on screen, and the plan's Q1 says the surface the reader sees in front owns the press.

The tempting cheaper fix — teach the textarea to decline when a card is open — is worse twice over:
it needs the card's state lifted somewhere the textarea can read it, which is the global signal
[§ A6](../plans/260905e-main-app-architecture-review.md) forbids, and it would have to be repeated
in every text box in the reader.

The test now presses **in the textarea with no blur**, and a second test requires that with *no* card
open the textarea's own two-stage Escape still clears the box — because a capture listener that
stopped every press would take that away and the first test would not notice.

## What would have caught the class

Ranked by cost against value.

1. **Watch the new test fail against the old code — and read *why* it failed.** Cheap, and it is
   already the rule ([CLAUDE.md](../../CLAUDE.md) § *Reproduce a bug with a failing test*). It was
   not followed here: the test was written after the mechanism, so it was green from birth. When the
   honest version was finally run against the bubble-phase code it failed instantly, with the message
   `the card is still up, so the press went to the box instead` — which is the whole defect, stated
   by the test, for free. **This alone was sufficient.** Adopted, and it is the general lesson.
2. **Make a shared fixture refuse to serve a case it was not written for.** Medium cost, real value.
   The helper could take the route as an argument — `openedBy: "click" | "hover"` — so that adding a
   pair forces the author to say how the reader gets there. Not adopted yet, because with two routes
   and one exception the naming does more work than the parameter; **the moment there is a third,
   do it.**
3. **A comment naming the route is not a countermeasure.** Rejected, and worth saying because it
   looks like one. There *was* a comment, and it was wrong in a way nothing could check — it is the
   artefact that carried the bug rather than the thing that would have caught it.
4. **Assert the precondition instead of arranging it.** Rejected as a general rule, tempting as it
   is. `expect(document.activeElement).toBe(box)` would have caught this one, but a test that
   asserts every ambient fact it depends on stops being readable, and the facts it forgets to assert
   are exactly the ones it was going to get wrong. Use it where a precondition is *surprising* —
   which "hovering does not move focus" genuinely is, so it would have been justified here.

## The one sentence

**When the route to a state is the behaviour, a fixture that jumps to the state tests nothing** —
and it will pass, which is worse than failing.
