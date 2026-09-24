# 260924c — iPad: the first tap on the rail shows the card

Overseer queue item `qi-9d85r384`, authorised by Greg. Found while building
[260915b](260915b-shelf-actions-reachable-on-touch.md) and left there under
[§ Wider, and not fixed here](260915b-shelf-actions-reachable-on-touch.md#wider-and-not-fixed-here).

## What is wrong

On an iPad the first tap on a band of the spine (the left-hand rail) jumps the article, when it
should open the band's card and leave the jump to a second tap. touch.md calls that card *"the only
reason the rail is usable by finger at all"*: the bands are proportional, most are a few pixels
tall, and the card is the only thing that says what you are about to press.

The cause is one line. [`Spine.tsx`](../../src/web/Spine.tsx) decides finger-or-not on the band's
`onClick` from the click's own field:

```ts
const touch = (e.nativeEvent as PointerEvent).pointerType === "touch";
```

On iOS 18.2 and later a finger's click reports `pointerType` `mouse` —
[WebKit bug 282988](https://bugs.webkit.org/show_bug.cgi?id=282988), still open — while the same
gesture's `pointerdown` reports `touch`. So on an iPad `touch` is always false, `bandPress` answers
`jump`, and reveal-then-commit never runs. Desktop Chrome, which is what the browser checks drive,
labels the click correctly, which is why nothing caught it.

## The three readers of `pointerType` off a click

260915b named three. Traced here:

1. **The spine** — broken as above. Fixed in this plan.
2. **The link and glossary card** ([`useHoverCard.ts`](../../src/web/useHoverCard.ts) § `clickPress`)
   — **already correct; no change.** 260915a (commit `09bd217c`) handles exactly this case: when
   the click says `mouse`, it looks for a fresh press recorded at `pointerdown` as `touch`/`pen`
   and, unless the last `pointerdown` really was a mouse, takes the press's type instead, and drops
   the pointer id (the mislabelled click carries the mouse's) so it matches by order. The tests
   already exist: `tests/link-tap-escapes.test.tsx` § "a WebKit touch click mislabeled as mouse still
   reveals" and "a second tap whose click is mislabeled as mouse, with the mouse's id, still
   commits". A term inside a link takes the same click path (the inner term wins `closest`), and
   since this plan has its own mislabelled-click test ("…and does the same when both of its clicks
   are mislabelled as mouse"). A bare glossary term's *outcome* does not depend on the click's type:
   it is decided at `pointerup`, whose type iOS reports correctly, and the click after it is
   swallowed by time and position (`swallowed`). (`clicked` does call `clickPress` first, which
   consumes a record, but nothing it returns changes a bare term's result.)
3. **The block permalink** ([`BlockGutter.tsx`](../../src/web/BlockGutter.tsx) § `onCopy`) —
   **harmless; no change.** It reads the type only to tell a pointer (copy) from a keyboard or
   assistive technology (`""` → navigate). `mouse` and `touch` take the same branch, so a finger
   read as a mouse still copies, which is what a finger should do.

## The fix

Take the pointer type from the `pointerdown` of the same gesture — the shape of 260915a, and of the
shelf's "⋯" (`ShelfEntry.tsx` § `fingerPress`) — and still decide at the click, which is the
platform's verdict that this was a tap rather than the start of a scroll.

*Revised after the plan review (F1, F2 below); this is what was built.*

- The rail's `<aside>` keeps a short **queue of presses** in a ref, one pushed per `pointerdown`
  (bubbled from any band, so a click touch adjustment moves onto a neighbouring band still finds its
  press): `{ type, armed }`, where `armed` is the band whose card was open when that press began.
  A reliably labelled touch or pen click takes a same-type, same-id record. A click labelled
  `mouse` uses whichever of touch and mouse lifted most recently; if that was touch, it takes the
  oldest released touch record, which is the iPad fallback. A pointer still held down cannot have
  clicked yet. That keeps a mouse press from stealing a finger's delayed click on a hybrid, and a
  held finger from stealing the mouse's click in return. `pointercancel` drops its own, and each
  `pointerdown` forgets presses older than 2 s. A queue rather than one slot because clicks may
  arrive grouped after several lifts, in order — the reason useHoverCard has one. Keeping pointer
  types separate also stops an unclicked pen or mouse press lending its first-click behaviour to a
  later finger.
- The band's `onClick` asks a pure function, exported beside `bandPress` and tested beside it:

  ```ts
  export function bandClick(click: string | undefined, detail: number,
                            press: RailPress | null, armed: string | null, id: string): "reveal" | "jump"
  ```

  - A keyboard's click (`pointerType ""`, or none with `detail < 1`) jumps and takes no record.
  - With a record, its type says whether this was a finger. **With none, it is taken for a finger**
    (bar a click that says `pen`): a real mouse always leaves one on the rail, so a pointer click
    without one is a finger that landed beside the 12px rail, or a click after a cancel. It may
    reveal; it may not jump blind.
  - A finger follows `bandPress` (unchanged), and additionally **jumps only if its own press began
    with this band's card open** — so a first click's reveal cannot become a grouped second click's
    permission.

**Known and accepted:** a finger that lands on the rail and lifts off it with neither a click nor a
cancel leaves a record for up to 2 s; the next finger tap in that window can then take one more tap
to commit. It never jumps early, which is the direction that matters.

**Not changed, and worth knowing:** a second tap that lands *beside* the rail re-reveals rather than
committing, because its `pointerdown` outside the band is an outside press and `useDismiss` closes
the card before the click. That was already so on any touch device.

**Pen stays as it is.** `bandPress` takes only `touch`, so a Pencil still jumps on the first press;
touch.md § An Apple Pencil counts as a finger records that as known and deliberately unfixed until
someone has an iPad in front of it. This change keeps that line exactly where it was (a `pen`
`pointerdown` gives `pen`, not `touch`).

## Simpler options passed over

- **A media query** (`(hover: none)` / `any-pointer: coarse`) instead of a per-press type. That was
  `bandPress`'s *first* version and GPT Sol had it replaced on 2026-08-27: it describes the device,
  not the press, so both hybrids (touchscreen laptop, iPad with a mouse) get it backwards.
- **Decide at `pointerdown`** — reveal when a finger goes down. No ref, no click-time reading. But a
  scroll that starts on the rail would open a card on the way past; the click is the tap verdict.
- **One shared helper for all three sites.** The other two carry more than a type — useHoverCard a
  per-press queue with the card open at that press, the "⋯" whether the menu was open — so routing
  them through one helper adds parts rather than removing them. The helper here is a pure function
  in `Spine.tsx` next to `bandPress`; if a fourth site appears it can move to a module then.

## Stages

One stage.

1. Red first: in `tests/spine-hover.test.tsx` (which drives the real `<Spine>`), a finger's
   `pointerdown` (`touch`) followed by a click that says `mouse` must open the card and not jump; a
   second such tap on the same band must jump; a real mouse (`pointerdown` `mouse`, click `mouse`)
   still jumps on the first click; a keyboard click (`pointerType ""`) after a stray finger
   `pointerdown` still jumps. Plus the pure function's table in `tests/spine-tap.test.ts`. Watch the
   first two go red on current code.
2. The fix in `Spine.tsx`; green; mutate (read the click's own type again) and watch red.
3. touch.md: the spine's line gains the iPad fact; 260915b § Wider gets a dated line saying which of
   the three were fixed and where.

## Done means

The four cases above green in jsdom, red against the old line; typecheck clean; touch.md says what
the rail does on an iPad and why. Not done here: a real iPad check — the box has none, and desktop
Chrome labels the click correctly, so a browser pass would pass against the old code too.

## What landed (2026-09-24)

- `src/web/Spine.tsx`: `bandClick` (pure), `takeRailPress` (matches a click to its queued press),
  the `<aside>`'s `pointerdown`/`pointerup`/`pointercancel` handlers, and the band's `onClick`.
- Tests: `tests/spine-hover.test.tsx` (the real rail, 20+ new cases incl. grouped clicks, touch
  adjustment from beside the rail, cancel, stale press, hybrid interleavings, mouse after hover and
  focus), `tests/spine-tap.test.ts` (the `bandClick` table), `tests/link-tap-escapes.test.tsx` (a
  term inside a link with both clicks mislabelled — passes on the old code; it is F3's evidence, not
  a regression test for this stage).
- Red → green: the four iPad cases went red on the old line (first tap jumped). Mutations each
  caught: reading the click's own type (14 red), dropping the open-at-press check, the cancel, the
  2 s prune, the "no record reveals" rule.
- `useHoverCard.ts` and `BlockGutter.tsx` unchanged, as traced above.

## Review ledger

Plan review (Sol, read-only, `-plan-review-sol.md`): refused as written.

- **F1 (P1) — taken.** One slot lost ordering and the open-at-press snapshot; grouped or cancelled
  clicks could jump blind. Rebuilt as a press queue carrying `armed`, and a click without a press
  may reveal but never jump.
- **F2 (P2) — taken.** A finger beside the rail, moved onto a band by touch adjustment, leaves no
  press on the rail; it now reveals. Tested with a pointerdown on the table and the click on a band.
- **F3 (P2) — taken.** Added the mislabelled-click test for a term inside a link, and reworded the
  bare-term claim to "outcome does not depend on the click's type".

Code review (Sol, write-capable, `-code-review-sol.md`): approved after its own fixes.

- **F1 (P1, again) — taken.** A no-record click could still jump if the card was already open; now
  it never jumps (bar pen). Sol's tests went red first.
- **F4 (P1) — taken.** Pure FIFO could let an unclicked mouse/pen press lend its behaviour to a
  finger, or one pointer steal another's click on a hybrid. `takeRailPress` now matches a reliable
  touch/pen click by type and id, and resolves a `mouse`-labelled click by whichever of touch and
  mouse lifted most recently (a press still held down cannot have clicked). This is more machinery
  than the plan wanted; kept because each rule has a test that goes red without it and the cases
  are real on touchscreen laptops. If it proves wrong on hardware, the fall-back is the plan-review
  version (FIFO), which is safe in the "never jumps blind" direction.
- Sol's `npm run typecheck` failed in its sandbox (tsx socket EPERM); re-run here: exit 0.
