# The mode bar's order and groups, a switch that looks like one, bigger gutter icons, Diagram behind the switch, and the grey line explained

Five admin reports from Greg about the reading view's chrome, batched because they touch the same two
places: the bottom bar's mode list (with the Experimental switch at its end) and the column of icons
beside each paragraph. Overseer queue `qi-yq3cm5y9` (4E, 4F, 4A), `qi-w7pz76zk` (4R), `qi-kga43a9m`
(4S). All from Greg, verified admin, so this builds them — simplest version first, the rest named
under § Deferred ([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)).

4B (remove Hierarchy mode) touches the same list and is a separate session; nothing here moves or
removes Hierarchy.

## What Greg asked

> Move Citations further right, next to Debate and Reviewer. Move Timeline further right. Move
> Trajectory one further left, before Quotes. Move Chat right, just before Recall. Move FAQ and Search
> a little bit further left. Add subtle vertical separator lines between groups of related modes.
>
> — Greg, SPIDERYARN-READING2-4E

> Can you make the Experimental mode icon/tooltip more visibly a toggle somehow.
>
> — Greg, SPIDERYARN-READING2-4F

> Next to a block there are icons for Permalink, Comment, Question, etc. Can you make them a bit
> bigger.
>
> — Greg, SPIDERYARN-READING2-4A

> Move all of Diagram mode into the "Experimental features". It's just not good enough yet.
>
> — Greg, SPIDERYARN-READING2-4R

> Some of the blocks seem to have a vertical grey line to their left. I can't figure out what that
> means! I assume it's deliberate. How can we make it discoverable for the user what it means? At the
> least, a tooltip? Or something else when the block is activated by a click?
>
> — Greg, SPIDERYARN-READING2-4S

"Reviewer" is Referee and "Recall" is Remember — Greg's words for them, not their labels.

## 1. The order (4E)

Today, left to right (`MODES_UI` in `src/web/Dock.tsx`):

```
Plain  Hierarchy Structure Summary Quotes Trajectory Glossary Ideas Timeline Citations FAQ Search
       Referee Diagram Chat Debate Remember
```

Proposed, `|` marking a separator:

```
Plain | Hierarchy Structure Summary Diagram | Trajectory Quotes FAQ Search | Glossary Ideas Timeline
      | Referee Citations Debate | Chat Remember
```

Each of Greg's moves, checked against it:

| Asked | Where it lands |
|---|---|
| Citations further right, next to Debate and Reviewer | between Referee and Debate |
| Timeline further right | last of Glossary · Ideas · Timeline, three places further right |
| Trajectory one further left, before Quotes | immediately before Quotes |
| Chat right, just before Recall | immediately before Remember |
| FAQ and Search a little further left | straight after Quotes, before Glossary and Ideas |

**A decision, stated for Greg:** FAQ and Search go *past Glossary and Ideas*. Moving Timeline and
Citations right would already move them left by index, so the words do not force this — GPT Sol was
right that the first draft's "otherwise redundant" overstated it. It is a grouping choice: Trajectory,
Quotes, FAQ and Search are all the article's own passages, and that run reads better together.

**Diagram moves too, and Greg did not ask for that.** Left where it is, it would sit between Referee
and Debate for anyone with the switch on, splitting the group Greg just made. It goes in just after
Summary — after rather than before, so Summary keeps its place (GPT Sol) — which its own row comment
already argued for (*"the same move Summary makes — the article restated —
with a picture instead of prose"*). It is behind the switch from now (§ 4), so a default reader never
sees it anyway.

**The groups**, and the reason for each — so the next mode knows which to join:

1. **Plain** — the way out of a mode, alone.
2. **Hierarchy · Structure · Summary · Diagram** — the article's shape, restated.
3. **Trajectory · Quotes · FAQ · Search** — the article's own passages: a walk through its quotes,
   the quotes, questions answered by passages, and finding passages.
4. **Glossary · Ideas · Timeline** — one dimension of the piece pulled out.
5. **Referee · Citations · Debate** — reading it critically and against other work.
6. **Chat · Remember** — you and the article talking.

A default reader (switch off, so Hierarchy, Diagram, FAQ, Timeline, Referee, Citations, Debate and
Remember hidden) sees `Plain | Structure Summary | Trajectory Quotes Search | Glossary Ideas | Chat`.
A group with nothing visible draws no separator.

### How the separator is drawn

A `group` on each `MODES_UI` row (a string union, required on every row, so mode eighteen has to
choose one). The first *visible* button of each group gets a `dock-group-start` class, worked out
from the already-filtered list, so hidden modes never leave a stray line.

The segment already draws a hairline between **every** button. The simplest reading of "subtle
separator lines between groups" in a row that is all hairlines is: **drop the hairlines inside a
group, keep them between groups.** No new element, no width change (a 1px border becomes no border
inside groups, so the row gets a few px narrower), nothing for `fitSignature` to learn — the group boundaries are a function of the
visible set it already carries. The selected button's fill still marks which one is on.

The loose links on the metadata and tweets pages get the same class and a hairline, so both arms of
the bar group the same way.

*Simpler option passed over:* a literal `<span>` divider between groups. It would sit inside a
`role="radiogroup"` as a non-radio child, add width the fit ladder has to measure, and duplicate
what the border already does.

## 2. The switch looks like a switch (4F)

The button is a flask, the word *Experimental*, and an `aria-pressed` frame when on — which reads as
another mode button. Two changes:

- **A small drawn switch inside the button** — a pill track with a knob, knob left when off, right and
  in `--highlight` when on. Pure CSS on a `span`, `aria-hidden` (the state is already `aria-pressed`
  plus the `sr-only` description). It stays at every fit rung, since it is the thing that says
  "toggle" when the label is gone, and is drawn in every state so the width never jumps.
  **Where the knob sits is its own table (`SWITCH_LOOK`), not the frame's "unlit when broken" rule**
  — GPT Sol's finding: after a failed save the store has restored the real value and `aria-pressed`
  reports it, so the knob shows it; `stale` shows the cached value muted; and `waiting` and
  `load-failed`, where nothing has been read, draw the knob centred on a dashed track rather than a
  false "off".
- **The tooltip says what a press does.** The `ready` state sentence gains *"Press to turn it
  on/off."* — Dock only; the `/profile` checkbox copy is untouched.

## 3. Bigger gutter icons (4A)

The glyphs are `size={12}` inside 24px targets (`BlockGutter.tsx`). They go to **15**. The slot stays
24px, so nothing about how many icons a row fits, the container queries, or the one-line paragraph
height moves. One shared constant rather than six literals.

## 4. Diagram behind the switch (4R)

The three edits [new-mode.md § Moving a mode in or out of the switch](../project/new-mode.md#moving-a-mode-in-or-out-of-the-switch)
names: `experimental: true` in `MODE_CATALOG`, `diagram` in `BEHIND_THE_SWITCH`, and a row with the
reason in [experimental-features.md](../project/experimental-features.md). Plus the comments that say
Diagram is in everybody's bar (Dock.tsx header and row, the test header), and the Features page
caption gains the same "one of the Experimental Features" sentence Hierarchy's has.

The picture chips' own gate (`KIND_UI`) stays as it is: once in the mode, a switched-on reader still
sees all five. `?mode=diagram` keeps working for everybody, by the rule the switch always had.

## 5. The grey line (4S)

**It is reading time** — gutter.css § reading time: a 2px hairline down the gutter's text-side
edge, darker where the reader has spent longer. Owner only, behind the experimental switch, which is
why Greg sees it and has never been told what it is. It is a `::after` with `pointer-events: none`,
so nothing can be hovered.

The simplest discoverable version: **a native tooltip on the line.** The pseudo-element becomes a real
`span.blk-read`, the gutter's **last** child (the column picks its visible controls with
`:nth-child` from the front), with a `title` — *"Reading time: this line gets darker the longer you
spend reading here. Only you see it."* The hover strip lies **wholly in the gap between the column and
the prose** (`--blk-gutter-x`, about 5.6px), with the 2px line drawn back at the column's edge where it
always was and `pointer-events: none`. The first draft centred an 8px strip on the line, which put 5px
of it over every control's click target — GPT Sol's high-severity finding. Its width is `--read`
times the gap, clamped, so on an unread row (and for anyone without the switch, where `--read` is
never set) it is zero wide and cannot be hovered at all. No
re-render: `--read` still arrives through the one generated style element, and the `title` text is
static. Native `title` because every other control in this column uses it, and BlockGutter.tsx
explains why a Floating UI tooltip per row is refused.

## Deferred

- **Anything on touch for the grey line.** A `title` does not show on a tap. Greg's second idea,
  something shown when the block is activated by a click, is the touch answer and is a bigger design
  question (where it goes, and how it avoids adding noise to every tap); it waits for him to see the
  tooltip.
- **A legend or first-run hint for reading time.** Same reason.
- **Keyboard and screen readers for the grey line.** The strip is `aria-hidden` and not focusable,
  on purpose — one more tab stop per paragraph would be worse than the problem. A single legend or
  explanation elsewhere is the follow-up (GPT Sol).
- **A stale sentence in security-map.md**, left for Greg because this session may not edit that doc:
  § the experimental-features switch still says *"Diagram is in every reader's bar since 2026-09-04"*.
  It is a description, not a defence, and nothing about the defence changes — the switch was never a
  gate, visitor `POLICY` for Diagram stays `available`, and the server gates are untouched.
- **Greg re-ordering within groups.** The order is one array; if the reading of "a little further
  left" is wrong, it is a one-line move.

## Checks

- `tests/dock-experimental-modes.test.tsx` goes red on the flag alone and green with `BEHIND_THE_SWITCH`
  updated; `tests/diagram-kind-gating.test.tsx`'s "Diagram is in the default bar" becomes "hidden, and
  kept while you are in it". The order and the runs are written out by hand in
  `tests/dock-mode-order.test.ts` (not `public-network-trace`, which sorts on purpose).
- `tests/block-gutter.test.tsx`: every glyph 15px; the control order filters out `blk-read`, and a
  new test pins it last with its `title`.
- `tests/dock-experimental-switch.test.tsx`: the knob for all six states, including a failed save
  restored to on.
- A new test that the first visible button of each group, and only those, carries `dock-group-start`,
  with the switch on and off.
- The reading-time strip: a test that `gutterCss` output still drives `--read`, and that the span is
  in the gutter with its `title`.
- Browser pass (Sonnet subagent, Playwright on the box) at desktop and phone widths: separators visible
  and subtle, the switch reads as a switch on and off, gutter icons larger and not overlapping, the
  hairline's tooltip appears on hover.

## Reviews

- **Plan**, GPT Sol, 2026-09-29: [260929c-sol-plan-review.md](260929c-sol-plan-review.md) (prompt
  beside it). Verdict "revise before building"; six of seven findings taken — the strip's click
  overlap, three existing tests, the knob's own state table, stale Diagram sentences in five places,
  the FAQ/Search wording, and Summary before Diagram. The seventh, the old `--rule` for the segment's
  line, was tried and measured invisible in the browser (oklch 0.27 on a 0.26 bar), so the line is
  `--rule-strong`, the frame's own colour.
- **Browser**, Sonnet subagent on Playwright, 2026-09-29, 1440 and 390 wide: order and lines right with
  the switch on and off, Diagram gone when off; the drawn switch reads as one both ways; glyphs 15px in
  24px slots with no overlap; the hairline strip lies right of the column (5.6px wide on read rows, 0
  on others), shows its title, and a click 2px inside each icon's right edge still reaches the icon.
