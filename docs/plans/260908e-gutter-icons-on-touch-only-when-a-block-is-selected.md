# The gutter waits to be asked on a finger too

Status as of 2026-09-08: **reviewed, not yet built.** GPT Sol's plan review returned three P0s and changed the design materially — read § What the plan review changed before § What gets built, which is superseded in three places and marked where.

From [SPIDERYARN-READING2-2G](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2G),
2026-09-07 17:42 UTC, `build_commit=c0fb04a4`:

> On a touch device, only show the icons to the left of the blocks in the vertical gutter when I
> select a block.

Sent from
`https://www.spideryarn.com/read/after-work-we-ll-have-each-other-spya-rqztkp?mode=structure&at=spya-x9qg4p`.
The reporter is the administrator and the article's owner, so every gutter control was drawn for
him — a visitor gets neither the chat door nor the "?".

## References

- [gutter.css](../../src/web/styles/gutter.css) § the gutter — the whole column, and every decision
  in it argued in place. § the paragraph's door and § one press for help are the two controls with
  rules of their own.
- [`BlockGutter.tsx`](../../src/web/BlockGutter.tsx) — the render order, which *is* the priority
  order since 2026-09-05.
- [`TableView.tsx`](../../src/web/TableView.tsx) ~574, ~1222, ~1387 — `hoveredRow`, the only thing
  in the app that marks one row as the row you are on, and `tr.row-active` is what it paints.
- [prose.css](../../src/web/styles/prose.css):122 — what `row-active` looks like.
- [touch.md](../project/touch.md) — what a touch device may assume here.
- [260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md](260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md)
  — the arrangement this sits on top of, three days old.
- [260908a-glossary-order-button-not-clickable-on-touch.md](260908a-glossary-order-button-not-clickable-on-touch.md)
  § The class — the sibling report from the same batch, which named the shared cause.

## The class, and what the sibling already established

The sibling session was asked whether "a control unreachable on touch" is a shared cause across this
batch, and it named one:

> This app was designed against a pointer, and touch affordances have only ever been added where
> somebody complained. […] **no rule says what a control owes a finger, so each control owes it
> nothing until a report arrives.**

It also listed this report as an instance, described as *"gutter icons revealed on `:hover`, so
never revealed on a finger"*. **That description is wrong, and the correction is the whole shape of
this job.** The gutter already had its touch rule — `@media (hover: none)` at gutter.css:601, added
2026-09-04 for exactly that reason. The bug is not that a finger reveals nothing; it is that a finger
reveals *everything, permanently*, because the rule that gave touch its affordances back had no
gate to give them. Greg is not asking for a control he cannot reach. He is asking for the margin
back.

So this belongs to the sibling's class from the other end: the pointer grammar has a gate
(`:hover`) and the finger grammar was given the same controls with no gate at all.

## What the gutter is, and the sentence the touch rule made false

[`BlockGutter.tsx`](../../src/web/BlockGutter.tsx):19–21 states the grammar the column runs on:

> **at rest the gutter shows *state*, on hover it shows *affordances*.** On an article you have
> never marked it is empty all the way down until the pointer lands on a row.

Two things in the column are *state* — facts about the paragraph:

- `.blk-cmt`, the bookmark in `--highlight` at `opacity: 0.75`, drawn only where the reader has
  made a note, with a count where there is more than one;
- `.block-chat.has`, the chip in `--chat-mark` at `opacity: 1`, drawn only where conversations
  exist. It is the *only* evidence a whole-block conversation exists — unlike a note, which is
  painted twice, that anchor draws no mark in the prose (gutter.css § the paragraph's door).

Four are *affordances* — buttons: `.blk-permalink`, `.block-chat` without conversations, `.blk-help`
(the "?"), and `.blk-more` (the "…"). Outside any query they are `opacity: 0; pointer-events: none`,
and `tr:hover` or `:focus-visible` brings them back.

**`@media (hover: none)` at gutter.css:601 hands all four back unconditionally, at 0.653.** It was
written on 2026-09-04 for a good reason — a finger produces no `tr:hover`, so the chat door was shut
on exactly the device Greg reads on — and it fixed that by removing the gate rather than by
replacing it. The result is the second half of the sentence above being false on touch: on an article
you have never marked, the margin carries three or four glyphs on **every row, all the way down**.
That is what Greg is looking at, and asking for back.

## The decision Fable was asked to arbitrate

The brief for this job named the real question: some gutter marks are controls the reader reaches
for, and some are indicators that a block *has* something, and hiding an indicator until you select
the block hides the information it exists to give. Fable was given both readings and asked to pick,
rather than to confirm.

**Its call: hide the four affordances, keep both state marks**, and its argument is Greg's own words
rather than the stylesheet's convenience:

> What Greg sees on the iPad today is not "icons where he has done things", it is link + chat + "?"
> (or a "…") at 0.653 on **every row of the article** […] The clutter reading fails on his own words:
> "when I select a block" describes a reveal, and a bookmark that only shows once you have selected
> the block is a bookmark that tells you nothing — it would also reverse his 2026-09-05 call to
> promote the mark.

It added the argument that settles the chip independently: a note is painted twice and the chip is
painted once, so hiding the chip is a strictly larger loss than hiding the bookmark would be. And it
named the boundary explicitly — if what is actually bothering Greg is clutter on a *heavily-noted*
article, that is a different change (fold or dim the marks), and he should say so rather than have it
guessed into this one.

**"Select" is `tr.row-active`**, the class `hoveredRow` already paints
([`TableView.tsx`](../../src/web/TableView.tsx):574, 1387; [prose.css](../../src/web/styles/prose.css):122
calls it *"this is the row you are on"*). Two candidates were refused:

- **the `at=` reading cursor** — it is moved by the arrow keys, by gist entries, by the spine and by
  deep links, so every keypress would open a gutter somewhere and every tap would write history; and
  a tap on the prose does not set it, so it does not even match the gesture Greg named;
- **a third notion of "the current row"**, beside hover and `at`.

**And it is set explicitly, not inherited from an emulated `mouseenter`.** One
`onClick={() => setHoveredRow(row)}` on the `<tr>`: `click` fires for a tap and not for a scroll
drag, and it is deterministic on every engine — including the one this box cannot run.
[touch.md](../project/touch.md) records that the compatibility-mouse path is exactly where this app
has been bitten before (*"a lift fires the hover events too"*, and 24 synthetic tests green through
it), so leaning on iOS's sticky `:hover` would be a fix that works by a quirk the harness cannot
exercise — the silent-success shape, and this stylesheet has shipped it twice.

## Discoverability, which is the cost being accepted

An iPad reader who has never tapped a paragraph now sees an empty margin. That is accepted, and the
reason it is cheap here is that **the tap that reveals the column is a tap they were making anyway**,
and it already has visible feedback: `tr.row-active td.text` paints `--panel`, so the icons appear
*inside* a wash that says the row is selected. That is more than a pointer device offers, where
nothing announces that a row is hoverable at all.

The real price is that chat and the "?" become two taps instead of one, and three on a one-line
paragraph (tap, "…", "?"). That is what was asked for. No first-visit hint is being built.

**One narrow loss, named rather than found later.** On a one-line paragraph the container query
gives the gutter a single slot, which the "…" takes even when there is a note
([260905c](260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md) argues why). So on touch,
an **orphaned** note — one whose quoted words were edited away, and which therefore paints nothing in
the prose — on a one-line paragraph is now invisible until the row is tapped, where today it shows
as a "…". That is the same case 260905c already recorded as living only behind the dot; this makes it
live behind a tap as well. Not worth exempting `.blk-more`: doing so would leave a "…" on every
short row down the article, which is most of what Greg is seeing.

## Reproduction

Chromium through Playwright, `hasTouch: true, isMobile: true`, signed in as the article's owner, on
the same article Greg sent the report from — with `matchMedia` checked rather than assumed, so
`(hover: none)`, `(any-hover: none)` and `(pointer: coarse)` all match.

**It reproduces immediately and it is not subtle.** At both 390×844 and 820×1180 every paragraph in
the article carries its full complement of gutter glyphs at `opacity: 0.653`, with the container
query deciding only *how many*: a wrapped paragraph shows the permalink, the chat door and the "?",
a one-line paragraph and every heading show the "…". There is no row in the article whose margin is
empty. On the 820-wide shot — the iPad case — the column of glyphs runs unbroken from the masthead
to the foot of the screen, three deep beside every full paragraph.

Counted rather than eyeballed, on one screenful:

| viewport | rows on screen | gutter icons painted |
|---|---|---|
| 390×844 | 6 | **14** |
| 820×1180 | 14 | **23** |

Every one of them at `opacity: 0.653`. The container query is doing its job — a short row draws only
the "…", a full paragraph draws all four — so what is on screen is the *minimum* the current rules
allow, not a layout accident.

Screenshots and the per-icon table are in the session scratchpad (`fb2g-390x844-prose.png`,
`fb2g-820x1180-prose.png`, `fb2g-q1-results.json`).

### The three things the reproduction had to settle before the design was safe

1. **A tap sets `tr.row-active`, immediately, and it persists.** Already true at the 50ms check, still
   true after a second and after a 300px wheel scroll — **a scroll does not clear it** — and tapping
   another paragraph moves it. So the state Greg's "select a block" needs already exists and already
   behaves the way a selection should.
2. **`tr:hover` also sticks to the tapped row**, and to *only* that row
   (`document.querySelectorAll('tr:hover').length === 1`, the row tapped). This is what the plan
   depends on when it declines to put `tr:hover` behind `@media (hover: hover)` as the sibling change
   did: the two reveals point at the same row, so they agree rather than compete, and where both
   match the touch rule wins on source order. **Measured, not reasoned** — it is the one claim here
   that a desktop harness could not have supported.
3. **The "…" panel is fully usable by finger.** Tapping it sets `data-open`, the column unfolds over
   the rows below, and a tap on a control inside the unfolded panel reaches its handler.

### The measurement trap that nearly produced a wrong answer

The first run mixed a real mouse `.click()` (for sign-in and navigation) with `.touchscreen.tap()`
for the test itself, and Chromium tracks those as two separate pointer devices. The mouse pointer
stayed parked at its last coordinate, and **every layout change re-hit-tested it**, firing
`mouseenter` and overwriting `row-active` with a row nobody had touched — reproducibly, the same
wrong row three times, whatever was tapped. Redoing the whole flow with `.tap()` alone removed it.

Worth recording because of which way it fails: it makes a tap look like it *does not* set the row,
which is an argument for building something more complicated than is needed. A real touch-only
device has no second pointer and cannot exhibit it. Another one for
[silent-success.md](../reusable/silent-success.md)'s family — a harness artefact that reads as a
product fact.

That is the whole diagnosis. Unlike its sibling 2J, this report needed no theory: the rule that
causes it is one block of CSS, it was added deliberately three days ago, and what it is missing is a
gate rather than a fix.

## What gets built

> **Superseded in three places by § What the plan review changed, at the foot of this doc**: the
> `tr.row-active` prefix becomes `:where(tr.row-active)` and the three restatement rules and the
> `.failed` addition go with it; `0.653` becomes a number to be measured against `--panel`; and the
> `<tr>` handler gains an explicit surface, an exclusion list and a `detail !== 0` guard. What is
> below is kept as written because the review is easier to follow against it.


**One `onClick` and three CSS rules**, all three of them inside the `@media (hover: none)` block that
already exists. Nothing outside that query changes, so a pointer device is untouched by construction.

### `TableView.tsx`

```diff
   onMouseEnter={() => setHoveredRow(row)}
+  onClick={() => setHoveredRow(row)}
```

Unconditional rather than gated on a coarse pointer, because on a mouse it is a no-op — `mouseenter`
has already set the same value before any click can happen — and a media query in JavaScript to
express that would be a second place for the two paths to drift apart.

### `gutter.css` § the touch reveal

```css
@media (hover: none) {
  tr.row-active .blk-permalink,
  tr.row-active .block-chat,
  tr.row-active .blk-help,
  tr.row-active .blk-more { opacity: 0.653; pointer-events: auto; }

  tr.row-active .block-chat.has { opacity: 1; }

  tr.row-active .blk-gutter[data-open] > * { opacity: 1; }
}
```

and one selector added to a rule outside the query, `tr.row-active .blk-permalink.failed`, for the
reason the third table row below gives.

The rest state needs no rule: it is the file's own unconditional
`.blk-permalink, .block-chat, .blk-help, .blk-more { opacity: 0; pointer-events: none; }`, which
until now the touch block was overriding on every row.

**0.653 is kept rather than raised to the 1 that hover gives.** It stops being *required* the moment
these controls are no longer permanently visible — WCAG 2.2's 1.4.11 was what pinned it — but the
other half of its argument survives untouched: 0.653 is the point where the affordances are
compliant *and* the reader's own bookmark still leads the column, and 0.868 is where that inverts.
The block's long comment about why not 4.5:1 is still true and stays; what changes is one sentence of
its premise.

### The two rules that exist only because of specificity, and would be invisible without them

Both were found by reading weights rather than by looking at a page, which is the only way either
could be found — each is a wrong *opacity*, not a missing element. That is this stylesheet's
recorded failure mode: `.blk-permalink.failed` shipped dimmed to 0.6 on 2026-08-31 for exactly this
reason.

The new four-selector rule is (0,2,1), which is deliberately the same weight as the
`tr:hover .blk-permalink, …` reveal it mirrors. Three rules in the file are below that and would be
silently overridden by it:

| what it would lose | its weight | what would go wrong |
|---|---|---|
| `.block-chat.has` | (0,2,0) | **the blue state chip dims to 0.653 on the selected row** — state drawn as an affordance, on the one row the reader is on |
| `.blk-gutter[data-open] > *` | (0,2,0) | **the open "…" panel draws at 0.653.** It is only ever open on the selected row, so this is not a corner case, it is the normal path |
| `.blk-permalink.failed` | (0,2,0) | **a copy that failed is drawn dimmed** — and this is the *same bug this file already fixed once*: gutter.css:527–537 carries GPT Sol's finding of 2026-08-31, where `tr:hover .blk-permalink { opacity: 0.6 }` beat the alert, so the rule was written twice, bare and `tr:hover`-prefixed. A third row state needs a third form |

The first two are restated at (0,3,1) inside the query. The third is one selector added to the
existing `.failed` rule, where its twin already lives — not a fourth rule in the media block, because
the alert must win on a pointer device too and the rule that owns it is outside the query.

**All three were found by reading weights, and none of them could have been found any other way**:
each is a wrong *opacity* on an element that is present and correct. That is the sentence gutter.css
already has in it about the first one.

### A duplicate found on the way

gutter.css:506–512 lists `tr:hover .blk-permalink`, `tr:hover .block-chat` and `tr:hover .blk-help`
**twice each**, in one selector list. It is inert — a selector repeated in its own list changes
nothing — and it has the shape of a merge that kept both sides of a list it did not conflict on. The
three duplicates go, because the next person to read that list to count what is in it should be able
to trust the count. Nothing else about the rule changes.

**One thing is deliberately left dimmer, rather than given a fourth rule.** A `:focus-visible`
control on the *selected* row draws at 0.653 rather than 1, because `tr.row-active .blk-help`
(0,2,1) beats `.blk-help:focus-visible` (0,2,0). On every other row focus still wins and draws at 1,
which is the case that matters — a keyboard reader tabbing through an article is not tapping rows.
The focused control also carries `outline: 1px solid var(--highlight)`, so it is not identified by
its opacity. A rule to buy back 0.347 of alpha on a control that is already ringed is accretion.

### What is NOT changed, and why each was considered

- **`tr:hover` is not put behind `@media (hover: hover)`**, which is the remedy the sibling report
  applied to `glossary.css` and `quotes.css` this morning. It is not needed here: on iOS the sticky
  hover lands on the row that was last tapped, which is the same row `row-active` is on, so the two
  reveals agree; and where they both match, the touch rule wins on source order and the row draws at
  0.653 either way. Splitting a heavily-argued selector list to guard against a quirk that agrees
  with us is churn. **Checked in a browser rather than reasoned** — § Reproduction below.
- **The query stays `(hover: none)` rather than becoming `(any-pointer: coarse)`.** There is a real
  gap there: an iPad with a Magic Keyboard reports `hover: hover`, so this whole block — today's and
  tomorrow's — never applies to it, and a finger on that machine reveals nothing at all. It is
  pre-existing, the sibling report left the same question open as Greg's call for its own size rule,
  and **this report is itself evidence that Greg's device matches `(hover: none)`**: he is
  complaining that he sees too many icons, which only happens where the block applies. Named in
  § What is still open.
- **`.blk-cmt` is not touched at all.** It is not in the query today and is not being put into it.

## The tripwires

Two suites already cover this ground and both would stay green through the change, which is the
reason to touch them rather than to add a third file.

**[`tests/gutter-target-size.test.ts`](../../tests/gutter-target-size.test.ts)** has a `touchBlock()`
helper that finds the `@media (hover: none)` block by counting braces and asserts against its body.
Two of its assertions become true-but-no-longer-what-they-say:

- *"exists at all on a device with no hover, and can be pressed there"* checks `.blk-help` is in the
  block with `pointer-events: auto` and an opacity between 0 and 1. All three still hold after the
  change, because `tr.row-active .blk-help` is still a `.blk-help` rule in that block — so **the
  test cannot tell a permanent reveal from a conditional one**, and would have shipped either. It is
  rewritten to say the new truth: every selector in the block is gated on `.row-active`, and there is
  a control the gate can be reached by.
- *"leaves the reader's marks alone on a touch device"* checks the block declares no `color`. It
  gains the opacity half: nothing in the block may dim `.block-chat.has` — the exact trap the third
  table row above names, and one a `color`-only check walks straight past.

Both are text scans and say so, in the shape the file already insists on: they can tell you a
declaration is written and out-weighs what it races, never that a finger reveals a button.

**A new case in [`tests/block-gutter.test.tsx`](../../tests/block-gutter.test.tsx)**, or beside it,
for the `onClick`: a click on the row sets the row active. That one is a real render, so it can fail
for the right reason.

**And a browser measurement**, which on this change's record is the check that actually finds things:
the count of visible gutter icons per screenful at a touch viewport, before and after, and the same
count after a tap.

## The simpler option this passed over

**Deleting the `@media (hover: none)` block outright** and letting iOS's sticky `:hover` do the work.
It is one line shorter than what is being built and it would probably work on Greg's iPad. It is
refused because it would work *by a platform quirk this box cannot exercise* — no WebKit here, and
Chromium's emulated hover is not the same behaviour — so the check that says it works would be a
check that could never have gone red. That is [silent-success.md](../reusable/silent-success.md)'s
whole subject, and gutter.css has shipped two hover-only affordances that a desktop harness passed.

## What the plan review changed

GPT Sol reviewed the plan before anything was built
(`scripts/run-codex.ts --model gpt-5.6-sol --effort high`; prompt and answer in the session
scratchpad as `fb2g-sol-plan-prompt.md` / `fb2g-sol-plan-answer.md`, exit 0). Its verdict was **do not
build this as written**, and it was right on every P0. The diagnosis and the state-versus-affordance
framing survive; the mechanism does not.

### P0 — 0.653 stops being compliant on exactly the row it now lives on

The plan said 0.653 is kept because it is the compliant setting. **On a selected row that is false,
and this file already knew it.** gutter.css:584 records the second of its two deliberate shortfalls:
0.653 measures **2.77:1** over a tinted row, and `tr.row-active td.text` paints `--panel`
([prose.css](../../src/web/styles/prose.css):122). Today that is a corner case — a row you happen to
be hovering. After this change **the selected row is the only place an affordance is ever visible**,
so the change converts a documented local shortfall into the normal path, and then calls it
compliant. 1.4.11 does not stop applying because a control is revealed on selection rather than
permanently.

I had read that comment and not connected it to the row I was about to make the only lit one.

**So the opacity is a measurement, not an inheritance**: measure the rendered pixels against the
selected row's own `--panel` and take the value that reaches 3:1 there. `--panel` resolves through
`--sidebar`, which is not written anywhere in `src/`, so this is a browser measurement rather than an
arithmetic one. The old number's *other* half still holds and still bounds the answer from above —
the reader's bookmark must go on leading the column, and 0.868 over `--page` is where that inverts.

### P0 — the reveal must not depend on sticky `:hover`

The reproduction showed sticky `tr:hover` landing on the tapped row and I concluded the two gates
agree. **That was tested for an ordinary tap only.** On a *handled* tap — a glossary term, an
external link, a footnote marker — the click is swallowed at document capture
([`useHoverCard.ts`](../../src/web/useHoverCard.ts):602,
[`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx):350), so the selection handler never runs
while sticky hover still lands. The gutter then opens at full strength on a row nothing selected —
the gate defeated by the mechanism the plan chose to lean on.

So `tr:hover` goes behind `@media (hover: hover)`, which is what the sibling change did to
`glossary.css` and `quotes.css` this morning. The plan's argument for not doing this is withdrawn:
it rested on an agreement that only holds for the taps I happened to measure.

### P0 — `<tr>` makes the selection policy an accident of propagation

Sol walked every kind of tap and the outcomes do not form a rule: plain prose selects; an internal
link selects the row it is leaving and then jumps away from it (stale); a zoom button selects before
opening the lightbox; a gist cell selects and jumps; a glossary term, external link or footnote
selects *nothing* because the click never arrives; a gutter control selects nothing because it calls
`stopPropagation()`. Some of those are right and some are wrong, and which is which is decided by
event plumbing rather than by a decision.

**Selection gets an explicit surface and an explicit exclusion list** — non-interactive content
inside `td.text`, with links, marks, the zoom control, gutter controls and gist cells named as not
selecting. Written as policy, it can be tested; written as propagation, it can only be discovered.

### P1 — `:where()` deletes the whole exception ladder

The specificity table was right as far as it went and **incomplete**: the four `:focus-visible`
reveals (gutter.css:513) and the permalink's own hover/focus rule (:524) are also (0,2,0) and also
lose, so "three rules are below that" was false. More usefully, Sol named the shape problem — five
corrective restatements is the design telling you something — and the fix:

> consider a low-specificity touch reveal using `:where(tr.row-active)`. Then `.has`, `[data-open]`,
> `.failed`, and `:focus-visible` can win naturally instead of being copied into an exception ladder.

`:where()` contributes nothing, so `:where(tr.row-active) .blk-permalink` is **(0,1,0)** — the same
weight as the base rule it must beat, and it beats it on source order alone, while losing to every
(0,2,0) rule that should win. **Three restatement rules and the `.failed` addition all disappear**,
and with them the deliberate `:focus-visible` regression (§ P2.8), which no longer exists to be
argued about. This is strictly better than what the plan proposed and it is Sol's, not mine.

### P1 — two claims that were simply wrong

- **"A failed copy is one of only two state marks that stay."** `.blk-permalink.failed` sets
  `opacity: 1` at (0,2,0), so under `:where()` it correctly wins — meaning a copy that fails on row A
  after the reader has tapped row B **reappears on the unselected row A** for its 1.5 s, at
  `pointer-events: none`. That is a *third* transient state the plan did not account for. Kept rather
  than suppressed — telling the reader their copy failed is the whole point of that rule, and a
  non-interactive alert on the row it belongs to is where it belongs — but it is named now instead of
  being found later.
- **"The `onClick` is a no-op on a pointer device."** False for a click that no pointer produced: a
  keyboard or assistive-technology activation fires `click` with no preceding `mouseenter`, so the
  handler would set `row-active`, paint the wash and move `activeChain`
  ([`TableView.tsx`](../../src/web/TableView.tsx):650) on input that never touched the row. Guarded on
  `detail !== 0`, which is what distinguishes a real pointer click from a synthesised one, so that the
  claim becomes true rather than being quietly dropped.

### P2 — the discoverability argument was overstated, and is rewritten as a cost

Fable's *"the tap that reveals the column is a tap they were making anyway"* is unsupported:
[touch.md](../project/touch.md):16 has prose touch as ordinary scrolling, not as tapping. The
`--panel` wash confirms a tap after it happens; it cannot teach a reader that untapped prose is
hiding anything. Sol accepts shipping without a hint **because the administrator asked for this
specific behaviour** — which is the right reason — but it is an accepted cost, not a solved one, and
§ Discoverability is corrected to say so. The browser run sharpened the price: the permalink, the
chat door and the "?" have **no route anywhere in the app except that gutter icon**, so this is
two taps instead of one with no fallback.

### What was held rather than taken

**Staying in `(hover: none)` rather than moving to `(any-pointer: coarse)`.** Sol's semantic point is
right — an interaction rule should ask whether a coarse pointer exists, not which one is primary —
but it also says the swap is not one token: on a hybrid, mouse hover and a persisted touch selection
need separate state, and `hoveredRow` is already carrying two meanings once a click can write it.
That is a bigger change than this report, so the conclusion is **narrowed** instead: this fixes the
device Greg reported from, and § What is still open says a Magic Keyboard iPad is untouched by it.
