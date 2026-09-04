The touch fix is correct, but I would add one mouse/pen regression test before calling the change fully protected. There is also a conditional non-hovering-pen gap.

## Findings

1. **Medium — the new tests do not protect the mouse/pen behavior the listener exists for.**

   Both delayed assertions exercise only `pointerType: "touch"` ([tests/hover-card-touch.test.tsx:246](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/tests/hover-card-touch.test.tsx:246)). These production mutations leave all 26 tests green:

   - Delete the `pointerleave` listener.
   - Make `leave` return unconditionally.
   - Change the guard to accept only mouse, accidentally excluding pen.

   All would break the behavior described at [src/web/useHoverCard.ts:629](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:629). Add fake-timer cases proving that a document `pointerleave` with `pointerType: "mouse"` and `"pen"`:

   - cancels a pending 320ms open; and
   - closes an already-open card after 220ms.

2. **Conditional medium — a non-hovering pen still follows the broken shape.**

   The hook treats every pen as hover-capable: `over` accepts it ([src/web/useHoverCard.ts:405](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:405)), while the tap path rejects it at [line 477](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:477) and [line 537](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:537). The new `leave` then closes it at [line 651](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:651).

   That is correct for a hover-capable stylus leaving the window. But Pointer Events bases the post-`pointerup` `pointerout`/`pointerleave` sequence on whether the **device supports hover**, not on whether `pointerType` is `"touch"`; a contact-only pen can therefore reproduce the same problem. [The W3C specification states both rules explicitly.](https://www.w3.org/TR/pointerevents/#the-pointerup-event)

   If “pen” deliberately means hover-capable pen only, the current guard is sensible. If Apple Pencil/contact-stylus use is included in “otherwise click to show,” support remains incomplete. That scope question is the speculative part.

3. **Low — the test is honest about this regression, but overclaims full event fidelity.**

   Dispatching a non-bubbling `pointerleave` directly at `document` is faithful for the document listener and the measured Chrome behavior ([tests/hover-card-touch.test.tsx:83](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/tests/hover-card-touch.test.tsx:83)). `pointerleave` genuinely does not bubble.

   However:

   - `tap()` still omits the touch `pointerover` before `pointerdown`, despite calling itself “the whole gesture” ([lines 88–100](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/tests/hover-card-touch.test.tsx:88)).
   - It places `pointerout`/`pointerleave` before compatibility `mouseup`; the W3C’s typical activation sequence puts `mouseup` first. This does not affect the reproduced bug.
   - The synthetic `pointerleave` is `cancelable: true` through the shared helper ([line 49](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/tests/hover-card-touch.test.tsx:49)); the real event is non-cancelable. Again, the handler does not depend on this.
   - The claim that Chrome was checked “on a real phone” ([lines 67–72](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/tests/hover-card-touch.test.tsx:67)) contradicts the recorded evidence that this was touch emulation, not a physical phone ([postmortem:124–134](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/docs/postmortems/260903g-the-touch-card-closed-itself-on-every-tap.md:124)). The plan has the same contradiction at [lines 64–65](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/docs/plans/260903l-glossary-underlines-in-every-mode-and-the-touch-card-that-closed-itself.md:64) versus [lines 95–101](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/docs/plans/260903l-glossary-underlines-in-every-mode-and-the-touch-card-that-closed-itself.md:95).

   I would describe `tap()` as “the sequence relevant to this hook,” not an exact iOS sequence.

## Other-listener audit

No other listener has the same ordinary-lift/close hole:

- `pointerover` explicitly rejects touch at [useHoverCard.ts:418](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:418).
- `pointercancel` at [line 514](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:514) only clears an in-progress press; it cannot close an open card or arm a timer. It will also clear a concurrent touch press if an unrelated mouse/pen pointer is cancelled, but that is a speculative hybrid-input edge, not this bug.
- `contextmenu` at [line 530](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:530) closes only when `byTouchRef` says the card was touch-opened. That is the intentional long-press rollback.
- `scroll`/`resize` dismissal is explicitly gated by `byTouchRef` at [lines 593–603](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:593), and the tests exercise both at [tests/hover-card-touch.test.tsx:486](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/tests/hover-card-touch.test.tsx:486).
- `swallowed` at [lines 613–627](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:613) is intentionally consuming touch-generated mouse compatibility events. It is armed only after a valid touch tap, and any subsequent pointer press clears it at [line 476](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:476).
- `focusin` has its touch-origin guard at [lines 683–689](/home/greg/code/spideryarn2/.claude/worktrees/glossary-touch-card/src/web/useHoverCard.ts:683). It is semantically sound, although the touch suite does not directly test that guard.
- There is no `pointerout` listener elsewhere closing this card, and `useHoverCard` has only the one production customer in `ProseHoverCard`.

The mouse case is unchanged: both mouse and pen pass through the new guard and call the existing delayed `close()`.

The implementation comments are substantially over-built: roughly forty lines across `over` and `leave` repeat material now held in the plan, postmortem, glossary doc, and touch doc. That is not a functional risk, but a short invariant plus the postmortem link would be easier to maintain.

Verification: focused suite 26/26 passed, both changed code/test files passed Biome, direct full typechecking passed all three TypeScript projects, and doc-link tests passed.