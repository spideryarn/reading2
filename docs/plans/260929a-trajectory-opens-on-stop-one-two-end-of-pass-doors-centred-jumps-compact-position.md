# Trajectory opens on its first stop, two doors at the end of a pass, centred jumps, a compact position mark

**Status:** planned, 2026-09-29. Four admin reports, batched because they touch the same mode and
files (overseer queue `qi-hmsgxajb`). Builds on
[260928a](260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md) and
[260928e](260928e-trajectory-rows-show-the-quote-words.md); the mode's doc is
[trajectory.md](../project/trajectory.md). The "Back to …" chip is
[260906g](260906g-back-to-where-you-jumped-from.md) and
[260916a](260916a-back-to-where-you-were-survives-a-mode-change.md).

## What Greg asked for

All four via the Feedback button, in production (build `cba650a3`), on `arxiv-2212-spya-u5293w`.

> When I activate Trajectory mode, it should be easier to trigger a jump to the first Step. e.g.
> press Left (even if I'm already on Step 1) should jump to the Step 1 block. Perhaps activating
> Trajectory mode should automatically jump to the first step. Yes, I think that would make sense.
> In that case, then show one of the little "Back to ..." buttons in case that wasn't what the user
> wanted (as per Glossary). P.S. make sure that that "Back to ..." functionality is documented and
> that we use that back-to widget anywhere else that might be appropriate/useful for the user.
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-4K

> In Trajectory mode, the "Go round again - More" button is confusing. I think it should perhaps be
> two separate buttons: - "Go round again", i.e. first step at this level of granularity - "More
> detail" (if there is a higher level), and then go to the first step of the next-higher-level of
> granularity
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-4N

> In the Trajectory mode (and anywhere else that a block-link triggers a jump to the appropriate
> place in the text), perhaps the linked-to block should be vertically-centred on the page so it's
> easy to see its context.
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-4M

> In Trajectory mode, I like that we now have a visual indicator of where in the article it's from.
> But that visual indicator takes up too much horizontal space, especially on a narrow screen. Can
> we make it more compact (e.g. if it was a vertical instead of horizontal line, or if it came at
> the end of the block's text/title so it didn't need dedicated space of its own, or something else
> that you think looks good (try to take a screenshot to make sure you have a sense of what things
> look like).
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-4D

## What is there today

- **Opening the mode moves nothing.** The band shows *Stop 1 of N* and rings stop 1's quote, but
  the page stays wherever the reader was. Only a pasted `?stop=` link scrolls (a one-shot token in
  `Reader.tsx`, `arrive` in `TrajectoryMode.tsx`), and it pushes no history.
- **← on stop 1 does nothing**: `stepStop` returns `null` at either end, and the key goes back to
  the browser. The band's ‹ is disabled there.
- **The door at the end of a pass is one button**, *Go round again — More ›*. It is a depth change,
  and `stopAfterDepthChange` sends it to the **first stop that is new** at the deeper pass — which
  is in the middle of the deeper route, not its start. The depth buttons in the head follow the
  same rule: pressing *More* on the last stop of *Gist* also goes round. At the end of the deepest
  pass there is no door at all.
- **Every jump lands the block's top just under the bars** (`aimAt` in `scroll.ts`, re-measured
  every frame since [postmortem 260928c](../postmortems/260928c-a-scroll-aimed-at-a-pixel-not-at-the-element.md)).
  That is every block link through `onJump` → `beginJump`, and Trajectory's `arrive`.
- **The position mark** is a `2.75rem` hairline track with a dot, at the right of every row, plus a
  `0.55rem` gap — about 53px of a band that can be 280px wide.
- **The "Back to …" chip** (`ReturnChip.tsx`) is drawn from a stamp `beginJump` writes on the
  history entry a jump pushes. Every block link in every mode already goes through `beginJump`
  (260916a's audit, re-run for this plan: the only movements that do not are ↑/↓, swipes, restoring
  `?at=`, a re-flow re-anchor, the comment dialog's ‹ ›, a `?note=` arrival, and Trajectory's own
  steps — each deliberate, and each named in its own code). The chip is documented, at length, in
  [url-state.md § The pushed entry says where you came from](../project/url-state.md) and the
  section after it, but nothing a reader-facing doc points at says so: reading-view-overview.md has
  no line for it.

## What we will build

### 1. Opening Trajectory goes to its stop, with a way back (4K)

- **When the band opens and its current stop resolves to a block, it jumps there** — through
  `onJump(block, passage)`, i.e. `beginJump`: one pushed history entry, stamped with where the
  reader was, so the **Back to …** chip appears; scrolled (and centred, § 3); the quote flashed.
  Once per opening of the band (a `useRef` one-shot in the band, not an effect on `current`, for the
  reason the deep-link token already gives: an effect would move the reader again after every step).
- **A `?stop=` deep link keeps its own arrival** (the existing token in `Reader.tsx`) and the new
  jump does not also fire. Precedence: a deep link's stop wins; otherwise the opening jump.
- **Which stop**: the one the band shows as current — stop 1 on a fresh opening. If the reader was
  on the route earlier in this visit, switched to another mode and came back, `?stop=` is still in
  the address and the band re-opens on that stop, so the jump goes *there*, not to stop 1. That is
  "take me back to my place on the route"; Greg's "the first step" is the fresh case. Named so he
  can overrule it — the other reading is a one-line change.
- **A route still being planned** jumps when it arrives, if the band is still open: that is the
  reader's first sight of stop 1, which is the point. The chip offers the way back if they had
  scrolled off meanwhile.
- **Already there** (the stop is under the reading line): `beginJump` already flashes without
  moving or pushing. No chip, which is right — nothing moved.
- **On a narrow window** the band covers the prose. The band stays open (the reader just opened it
  to see the list); the page moves behind it and the flash is held until the band steps aside, as a
  deep link's already is (flash.ts).
- **← on stop 1 goes to stop 1's block** — scrolls and flashes, as any step does. The band's ‹ is
  enabled on stop 1 too and does the same, so the keys still cannot do more than the buttons
  (its label says *Back to stop 1* there). → on the last stop is unchanged: the door is the way on.

### 2. Two doors at the end of a pass (4N)

At the end of a pass the door after the stop's block becomes a row of two buttons:

```
 …last stop's paragraph.
                                  [ ↺ Go round again ]  [ More detail › ]
                                          End of Gist — 5 stops.
```

- **Go round again** — stop 1 of **this** pass. A step (replaces `?stop=`), through `moveTo`, like
  the others. Drawn at the end of **every** pass, including the deepest, where today there is no
  door at all.
- **More detail ›** — only when there is a deeper offered depth. Changes depth (pushes, as a depth
  change does) and lands on **stop 1 of the deeper pass**, which is what Greg's words say ("the
  first step of the next-higher-level"). Stop 1 of the deeper pass is usually the same passage as
  stop 1 of this one — the passes nest — so this reads as "start again, with more stops between".
- **The line under the door** at the end of a pass says where you are (*End of Gist — 5 stops.*)
  rather than a cue: two buttons lead to two places, and one cue would be the wrong one for one of
  them. Mid-pass, *Next stop ›* and its cue are unchanged.
- **The depth buttons in the head stop going round.** Today *More* pressed on the last stop of Gist
  jumps to the first new stop; once the door names going round explicitly, that hidden special case
  would be a second rule for one word. So a depth change **keeps your place** always (deeper: the
  stop is still there; shallower: the nearest earlier stop, as now). `stopAfterDepthChange` loses
  its going-round branch; the doors decide their own landing. Not asked for — named here so Greg
  can say no.

`TrajectoryControl` changes from `door: string | null` + one `advance()` to a discriminated door
(`next` with its cue / `end` with the pass's label, its count and the deeper label or `null`) and
three verbs: `advance`, `again`, `deeper`.

### 3. A jump centres what it was sent to (4M)

- **`scrollToBlock` gains an alignment, `"top"` (today's, the default) or `"centre"`**, computed
  inside `aimAt` so it is still re-measured every frame (postmortem 260928c; the session that
  wrote that fix agreed this is where it goes).
- **Centre means**: the middle of the thing sits at the middle of the free area — the viewport
  between the sticky bars (`stickyDestination`) and the dock (`dockOffset`). **When the thing is
  taller than the free area, its top goes under the bars, as today** — centring a 900-word paragraph
  shows its middle and hides its start, which is why `scroll.ts` moved away from
  `scrollIntoView({block: "center"})` in the first place.
- **The thing is the passage when there is one**: a Trajectory stop, or a row press, is a quote,
  and `beginJump` / `arrive` already carry its mark key for the flash. The aim measures the union
  of that passage's drawn marks (`mark.hit[data-hit=…]`) when they exist, and the block's row when
  they do not — so a quote at the bottom of a long paragraph is centred even when its paragraph is
  too tall to be. Re-asked every frame, so marks drawn mid-glide are picked up.
- **Who centres**: every `beginJump` (so every block link in every mode — Greg's "anywhere else that
  a block-link triggers a jump") and every Trajectory arrival. **Who does not**: ↑ / ↓ and swipes
  (a stride reads down the page; the next paragraph belongs at the top), restoring `?at=` (Back,
  reload, a pasted link — it restores a reading position, which is a top-of-section fact), the
  re-flow re-anchor, and `scrollByScreen`.
- **The known cost, accepted for v1.** `?at=` and "where you are" are measured at the reading line
  just under the bars. A centred block's top sits below it, so for a moment the reader is "in" the
  block above. Two visible consequences, both small: when the target is near the start of its
  section, `?at=` is rewritten to the previous section once the glide settles (a reload then lands
  one section early, top-aligned), and the spine's "you are here" names the section above. Fixing
  it means teaching the position tracker that a centred arrival owns the position until the reader
  scrolls by hand — a real change to a file other features lean on, deferred until the cost is
  seen to matter. (Asked of the plan review.)

### 4. A compact position mark (4D)

- **A vertical track in the number column**, instead of a horizontal track in a column of its own.
  The row number sits at the top of the `.traj-n` column; under it, a hairline of fixed height
  (about two lines) with the dot on it — top of the line is the start of the article, bottom the
  end. The column is there already, so the mark costs **no width**, and a vertical line is the way
  the spine already draws the article. The current row's dot stays in the accent; the screen-reader
  sentence (*about 70% of the way through*) is unchanged.
- **Tried first, by screenshot, at desktop and phone widths**, against today's; if it reads badly
  the fallback is Greg's other suggestion — a small inline mark at the end of the section line.

### 5. The "Back to …" chip, documented and reused (4K's P.S.)

- **Documented**: a short section in [reading-view-overview.md](../project/reading-view-overview.md)
  saying what the chip is and when it appears, pointing at url-state.md for the mechanism (one home
  per fact). Signposting, so no approval is needed.
- **Reused where it helps**: Trajectory's opening jump (§ 1) is the one new place. The audit above
  finds no other far jump without it that should have it: the comment dialog's ‹ › deliberately
  keep the chip naming where the walk *began*, and Trajectory's own steps do the same — once the
  opening jump has stamped the entry, every later step replaces on that entry and the chip keeps
  offering the way back to where the reader was before they opened the mode.

## After the plan review

GPT Sol found four P1s ([findings](260929a-trajectory-four-suggestions-plan-review-sol.md)); each
was checked against the code and each is accepted.

- **F1 — the "known cost" in § 3 is not small, so it is fixed now, not deferred.** Everything that
  asks "where is the reader" measures at the reading line under the bars: the `?at=` spy, the next
  jump's origin (the chip), `beginJump`'s "already there", ↑ / ↓, and `whereIsBlock` /
  `isBlockOnScreen` (comment stepping). After a centred jump all of those would name the block
  *above*. So **a centred arrival owns the position until something else moves the page**: `scroll.ts`
  keeps one *arrival anchor* (the block, and the passage if any), set when a centred glide settles
  and cleared by the next movement of any kind (`cancel`, which every glide and every reader wheel
  or touch mid-glide already runs) or by a scroll event outside our own quiet window — i.e. the
  reader scrolling. While it is set, `measureRow` and `measureOrigin` answer the anchored block,
  `whereIsBlock` / `isBlockOnScreen` answer "here" for it, and `positionToWrite` names the
  anchored block's section. One module variable with a stated lifetime, read by the five places
  that ask; nothing else changes.
- **F2 — "already there" becomes passage-aware.** With a passage, the jump is skipped only when the
  anchor is that exact passage, or (with no anchor) the passage's marks are comfortably on screen.
  And a passage aim that has not found its marks yet is *provisional*: `glide` does not settle on
  its first frame for it, but takes the corrective frame, so marks drawn by the commit the click
  started are the ones centred.
- **F3 — marks are found by token**, the way `flash.ts` already does (`data-hit` is a
  space-separated list; a quote split by an `<em>` is several marks, unioned). The helper moves to
  `rows.ts` so `scroll.ts` and `flash.ts` share one spelling.
- **F4 — the opening jump is armed above the mode boundary**, in the same token `Reader.tsx` holds
  for the deep link, and consumed in one effect with it: deep link first (a stale one falls back to
  stop 1, arrived at without a push), otherwise the opening jump. It is armed when the reader
  switches *into* Trajectory by pressing something, and on a first load of a Trajectory address
  that names no `?stop=` and no `?at=` — **never by Back or Forward** (a `popstate` into
  Trajectory restores the entry, it does not jump again, which would truncate Forward).
  A direct activation therefore makes two entries — the mode, then the jump — so the first Back
  returns to where you were and stays in Trajectory, and the second leaves the mode.

## The simpler options passed over

- **4K: only make ← on stop 1 work, no automatic jump.** Greg considered it and then chose the
  jump ("Yes, I think that would make sense"). Both are built.
- **4N: relabel the one button.** It would still be one press doing two things.
- **4M: `scrollIntoView({ block: "center" })`.** Centres a 900-word paragraph on its middle, and
  aims at a pixel once instead of re-measuring — both already-fixed bugs.
- **4M: centre only in Trajectory.** Greg asked for everywhere a block link jumps, and `beginJump`
  is the one place those go, so everywhere is not more work than Trajectory alone.
- **4D: shrink the horizontal track.** Still a column of its own; a vertical mark fits in a column
  that already exists.

## Deferred

- The position tracker treating a centred arrival as the reader's position (§ 3, the known cost).
- Centring the `?note=` arrival and the comment dialog's ‹ ›, which are not block links; they keep
  their current landing.
- A "go round again at this depth" in the head, beside the stepper; the door is where the end of a
  pass is met.

## Tests

- `tests/trajectory-route.test.ts`: `stopAfterDepthChange` without the going-round branch; a new
  pure `endOfPass` / door rule for the two doors, including the deepest pass.
- `tests/scroll*.test.ts`: the centring arithmetic as a pure function (fits → centred; taller →
  top; clamped at 0 and at the bottom), and `aimAt` re-measuring a centred target mid-glide.
- The opening jump and ← on stop 1: in the band's test, if there is one that mounts it; otherwise a
  browser check.
- Browser: desktop and phone widths — opening the mode lands on stop 1 with the chip; ← on stop 1;
  both doors at the end of Gist and at Most; a block link from Glossary lands centred; screenshots
  of the old and new position mark.

## Progress

- 2026-09-29: plan written; § 4 built first (CSS and markup only).
- 2026-09-29: GPT Sol's plan review ([findings](260929a-trajectory-four-suggestions-plan-review-sol.md)),
  four P1s, all accepted — see § After the plan review.
- 2026-09-29: built (`fb21841f`). GPT Sol's code review
  ([findings](260929a-trajectory-four-suggestions-code-review-sol.md)) fixed five P1s in place, each
  with a test: a reader's scroll inside the kept quiet window was taken for the glide's own and left
  the anchor stale (now told apart by the scroll position); `abandonScroll` with nothing in flight
  dropped the anchor; an opening token could outlive a band that unmounted before its data came and
  fire after Back (each mount now claims the token); the `popstate` inference in F4 raced nuqs's
  deferred address write, so **the opening is armed in the Dock's `onMode` instead** — the one door
  a press comes through, Dock and command bar alike, which Back and Forward never call; and the
  anchor is cleared on a mode switch, a re-flow, and a vanished row.
