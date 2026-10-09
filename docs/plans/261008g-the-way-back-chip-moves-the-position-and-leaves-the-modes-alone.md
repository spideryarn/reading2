# The way-back chip moves the position and leaves the modes alone

Reader report spya-q3dfmw (#489), 2026-10-08. Up: [plans.md](../project/plans.md). The chip is
[260906g](260906g-back-to-where-you-jumped-from.md); its stamp learned to survive a mode change in
[260916a](260916a-back-to-where-you-were-survives-a-mode-change.md).

> I like the little "back to" UI widget (see screenshot).
>
> It seems as though when I press it, it basically feels like pressing the back button, which means
> that if there are different modes active, it switches to the modes that were previously active, as
> well as changing the position. I think it would be better if it just changed the position, and so
> if I changed modes since, those modes would stay as they are currently.
>
> — Greg, 2026-10-08

## What happens today, and why

`ReturnChip` is `history.go(-stamp.depth)` and nothing else (ReturnChip.tsx). A jump stamps the entry
it pushes with where the reader stood; every later push on the same article (a mode pill, a sort)
carries the stamp one entry further back (`depth + 1`), so one press walks all the way to the origin
entry. That entry is the whole address as it was then — `?mode=`, `?thread=`, everything — so the
modes come back too. Greg's report is exactly that.

## The change

**Pressing the chip pushes the address the reader is on now, with only `?at=` changed** to the
origin (or removed, for `top` — the same spelling `originHref` already uses for a jump's
predecessor). Every other parameter is left as it is. It is `beginJump` run backwards —
`beginReturn` in keynav.ts, called by `useReadingPosition`'s `returnToOrigin`:

- **arm a return** (jump-history.ts § `ArmedReturn`) naming the `?at=` the push will carry and the
  stamp the entry should have afterwards;
- **one push through nuqs's own `setAt`** (`history: "push"`, `throttle(0)`), so a mode write
  nuqs still has queued goes out in the same push instead of being aborted; the push wrapper claims
  the arm and writes the next stamp in that same push;
- **move the page itself**, top-aligned and instant as Back's restore was, and mark the value
  synced so the restore effect does not move it again.

*Revised after GPT Sol's plan review* ([261008g-plan-review-sol.md](261008g-plan-review-sol.md)).
The first draft pushed with a raw `history.pushState` and left the move to the restore effect. F1:
a raw, unmarked push makes nuqs abort its queue, so a mode pressed a moment before the chip would be
taken back, and the copied address would be the one from before it. F2: the restore effect moves
only when `?at=` *changes*, and a reader who jumped from a section's first block and wandered inside
that section already has it in the address — the press would visibly do nothing. Each has a test
in tests/return-chip.test.tsx (written after the first draft was replaced, so never run against it).

**A push, not a replace**, by url-state.md § Position replaces history: a deliberate act pushes. The
browser's Back after a return goes to the jump's destination, which is what Back means.

### Repeated presses still walk the journeys backwards

The chip used to unwind two jumps in order — "the dropdown Greg imagined" (260906g) — because the
origin entry still carried *its* stamp. A position-only return lands on a new entry, and nothing can
read the origin entry's state without travelling to it. So the stamp carries the chain instead:

- **A jump's stamp records the journeys before it**: `{ v: 3, origin, earlier }`, where `earlier`
  is the origin list of the stamp the reader was standing on when they jumped (nearest first, capped
  at 50 so a state object cannot grow without bound).
- **Pressing the chip** pushes an entry stamped with `earlier[0]` as its origin and the rest as its
  `earlier`, or no stamp when the list is empty — so the chip then says "back to" the journey before,
  or goes away.
- **The depth goes.** It existed only to aim `history.go`. With it go `oneFurtherBack`,
  `MAX_PLAUSIBLE_DEPTH` and the eviction caveat (a position-only return never traverses history, so
  an evicted entry no longer matters). A same-article push now carries the stamp unchanged.
- **Compatibility, both directions.** We read v2 (`{ v: 2, origin, depth }`) and the legacy
  `{ from }` as an origin with no earlier journeys. An older bundle reading v3 sees a `v` it does not
  know and draws nothing — failing closed, which is what the version marker is for
  (jump-history.ts § VERSION).

### The edge: the reader may be in a band, not the prose

The origin is always a prose position: `measureOrigin` measures only the article's own rows
(`tbody tr[data-block]`), or answers `top`. A jump made from inside a band records the prose position
behind the band. So the return always lands in the prose — never inside a mode's band, and nothing
in a band is moved, scrolled or closed by it.

What matters is whether the reader can **see** that landing. On a desktop the band sits beside the
prose and the prose moves in view. On a phone an open band lies over the whole article
(`bandCovers`), and since 261008f (the session moving the chip clear of Chat's input) the section chip
can be on screen above an open band. A position-only return there would move prose nobody can see —
a press that looks like it did nothing.

So **when a band covers the prose, pressing the chip steps the band aside first** — the same
`bandAway` state a passage link in a band uses (Reader.tsx § `bandJump`, plan 260929g; the press is
`returnFromJump` there). The band stays mounted with everything in it, the prose shows at the
origin, and the "back to ⟨mode⟩" pill (`BandBackChip`) offers the band back. The mode is not
changed: `?mode=` is untouched, which is Greg's ask.

**Focus** (Sol F3): the chip that had it is replaced by the pill, so the pill takes focus, and when
the band comes back focus goes to the band's first control rather than to the document.

Sol found no other pressable state that hides the landing: modal surfaces cover the chip, and
Marginalia and desktop bands leave the prose visible.

## Files

- `src/web/jump-history.ts` — the v3 stamp, `earlier`, depth removed, legacy reads.
- `src/web/router.ts` — `stampFor` carries the stamp unchanged, chains `earlier` on a jump, and
  writes a return arm's `next`. `useJumpStamp` goes (the chip needs only the origin, as the spine
  does).
- `src/web/keynav.ts` — `beginReturn`, beside `beginJump`.
- `src/web/reader/useReadingPosition.ts` — `returnToOrigin`, beside `jumpTo`.
- `src/web/ReturnChip.tsx` — the press is an `onReturn` prop.
- `src/web/reader/Reader.tsx` — `returnFromJump`: step a covering band aside, then return.
- `docs/project/url-state.md` § The chip moves the position, not the modes; Help's
  `jumping-around.md`, which said the chip and Back "do the same" (Sol F4), and the regenerated
  Help corpus.
- Tests: `tests/return-chip.test.tsx`, `tests/jump-history.test.ts`, `tests/spine-jump-origin.test.ts`,
  `tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx`.

Disjoint from the guide-chip-phone session (261008f), which touches only CSS and two tests.

## Tests, red first

1. Return chip, jsdom: jump, change mode, press → `?mode=` is still the new one, `?at=` is the
   origin, `history.length` grew by one. Red against today's `history.go`.
2. Two jumps, a mode change between, two presses → each lands on its origin with the mode kept.
3. `top` origin → `?at=` removed, mode kept.
4. Reader with a covering band (extend `a-band-link-steps-the-band-aside-on-a-phone.test.tsx`):
   pressing the section chip steps the band aside, `?mode=` unchanged, band pill appears and takes
   focus, and focus goes into the band when it comes back. Seen red with the step-aside disabled.
6. A mode queued in nuqs when the chip is pressed still opens (Sol F1).
7. The page moves even when `?at=` already names the origin (Sol F2).
5. jump-history: v3 round trip, v2 and `{from}` read with empty `earlier`, unknown `v` → null, cap.

## The simpler option passed over

**Drop the chain:** push `?at=` and strip the stamp, so the chip vanishes after one return. Half the
diff, and the depth could stay as dead data. Passed over because walking back through several jumps
is something Greg asked for when the chip was built, and on an iOS home-screen app — how he reads —
the chip is the only Back there is. Replacing `depth` with `earlier` is about the same amount of
code as the depth arithmetic it removes.
