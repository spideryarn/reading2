# Minimum text and touch-target sizes on a phone

Report spya-y4yhnp (SPIDERYARN-READING2-N0), Greg on an iPhone, 2026-10-20:

> The new investigate chat is fine. I like the way it cites all of its sources, but the font is too
> small and they're too close together for an iPhone. And indeed, I think I had the same problem
> with, in the chat thread, or chat list of threads, the icons are too small. So can you just
> generally look for any, make, you know, make a minimum size, especially on an iPhone, but maybe in
> general, and make a minimal update to our sort of design system documentation to avoid this problem
> going forwards.
>
> — Greg, 2026-10-20 (`spya-y4yhnp`)

## What is short, measured

A Sonnet browser pass at 390 × 844, DPR 3, touch, iPhone UA, on a real Investigate thread
(local). The root was 15.36px. Scripts and screenshots were in the session scratchpad.

| What | Class | Now |
|---|---|---|
| passage-id chip in an answer | `.cite-chips .block-ref` (0.72em) | **11.1px** text, 13px tall |
| the host after a web link | `.cited-link-host` (0.78em) | **12.0px** |
| "Back to your question in Investigate" | `.chat-origin-back` (0.78rem) | **12.5px** |
| *Bring into this chat* | `.bring-in` (0.8rem) | **12.8px**, 22.8px tall, 0px below the link above |
| "From the web" rows | `.chat-sources li` | 20px tall, **0–1.2px apart** |
| the list's filter chips | `.chat-from-btn` (0.81rem) | **13.0px**, 26.8px tall |
| every chat icon: new chat, copy, delete, rename | `.chat-icon` | **22.4 × 22.4**, a 12–14px glyph |
| the thread row's source icon | `.chat-thread-source` | **20 × 24.8**, a 12px glyph |
| "Latest" | `.chat-to-bottom` | 26.4px tall |

The id chip's base is worse everywhere else: `.block-ref` is 0.58rem (about 9px) wherever an id is
drawn bare. The band text roles `--type-meta` (0.78rem) and `--type-label` (0.77rem) come to about
12px on that phone.

## The rule

On a touch screen, **no text under 13px**, and **nothing to press under 40 × 40px**. A target can
reach 40px by being drawn that size, or with a `.tap-target` halo where its neighbours leave room.
Where they don't, the row grows. Desktop is unchanged: Greg said "especially on an iPhone, but
maybe in general", so the simpler and less disruptive half is taken first.

- **13px.** Apple's floor is 11pt and its smallest recommended style is 12–13. Greg called a 12px
  host too small, so 12 is not the floor.
- **40px.** This is the house finger floor already, kept rather than raised. The close cross's halo,
  `.tap-target`, the order rows and Skim's steppers (44) all use it, so a single number stays one
  number. Apple says 44pt. The dock is 44, and the steppers stay 44.
- **Both under `any-pointer: coarse`.** The draft put targets on `pointer: coarse`, as the dock
  is. Building it showed the controls nearest to these already use `any-pointer`, so the floors
  follow them (§ Plan review, below).

### The mechanism, and the simpler one passed over

**A token, `--text-min`, read as `font-size: max(var(--text-min), <the old value>)`.** It is 0px by
default and 13px under `any-pointer: coarse`, in tokens.css. So a font size that is already bigger
is untouched, a reader's larger text size still wins, and desktop computes exactly what it did.

Passed over: **a flat `font-size: 13px` per class under the media query.** It needs one rule per
context, because `.quiz-reply .cite-chips .block-ref` outranks `.block-ref`. Every new context would
need its own override in a second file, and it would shrink anything that a reader's text size had
grown past 13. The token keeps the floor next to the value it floors.

Also passed over: **raising the root size on a phone.** That would change every measurement on the
page, including the prose, which Greg sizes himself on /profile.

## Stages

**Stage 1: the mechanism, the chat band, and the shared chips.** This is what Greg pointed at,
plus the things every mode shares.

- tokens.css: `--text-min`; the six `--type-*` roles floored.
- `.block-ref` (prose.css), `.cite-chips .block-ref` (mode-band.css), `.gloss-where .block-ref`
  (footnotes.css), `.quiz-reply .cite-chips .block-ref` (quiz.css): floored. Then check that
  tap-target.css's 1.3rem-tall chip halo still clears a 13px chip and that chips on adjacent lines
  still don't overlap. Its arithmetic assumed 0.58rem type.
- `.cited-link-host`, `.chat-origin-back`, `.bring-in`, `.chat-from-btn`: floored.
- Under `pointer: coarse`, in mode-band.css: `.chat-icon` is 40 × 40 with an 18px glyph;
  `.chat-thread-source` and its lead slot are 40 wide with an 18px glyph; `.chat-from-btn`,
  `.chat-to-bottom` and `.bring-in-button` are at least 40 tall; each "From the web" row is at
  least 40 tall, with room between a wrapped link and its button.
- The rule goes into typography.md (text), controls.md (the table, targets), and a line in
  phone-and-touch.md's policy list.

**Stage 2: the other modes.** A second browser pass at the same viewport, in every mode band and
on /read and /profile. It lists the visible text under 13px and the targets under 40px, and floors
whatever it finds with the same token and the same coarse rules. Diagram, Sketch and Illustrated
are excluded on purpose. Their type is part of a fixed composition (typography.md § Text roles in
a band leaves them out for the same reason), and a model-drawn SVG label is not chrome.

**A guard: `tests/minimum-text-size.test.ts`.** It scans `src/web/styles/*.css` for `font-size`
literals under 13px-equivalent (rem or em under 0.8125, px under 13) that do not go through
`var(--text-min)`. It holds each file to a baseline count that may only fall. New small text fails
until it takes the floor or is added to the baseline with a reason. em is relative, so the guard
over-reports, which is the safe direction. It does not see Tailwind utility classes in TSX
(`tw:text-xs` is 12px). That gap is written down here and in typography.md rather than closed.

## Done looks like

- Stage 1: at 390 with touch, the browser pass finds nothing under 13px in the chat band, and no
  chat control under 40px other than those the rule exempts. A desktop-width pass computes the same
  sizes as before. typecheck, `npm test`, and a Sol code review.
- Stage 2: the same in every other band, bar the named exceptions.

## Not doing

- Floors on desktop. Greg may want them later ("maybe in general"). It is one token value, and
  the note says so.
- The thread row's rename and delete icons, which are invisible under a finger (`opacity: 0` until
  hover or focus-within). They are sized here, but whether a phone needs them visible is a
  different question.
- Inline web links in prose (`.cited-link`). These are prose links, about 23px apart line to line,
  and an inline link that wraps cannot take a halo (tap-target.css). Their host label gets the text
  floor.

## Plan review (GPT Sol, 2026-10-21)

[Prompt](261021c-minimum-text-and-touch-target-sizes-on-a-phone-plan-review-prompt.md),
[answer](261021c-minimum-text-and-touch-target-sizes-on-a-phone-plan-review-sol.md). Exit 0 and
five findings, all taken:

- **R1 (P1) Size the pressed thing, not its row.** The source icon and the filter chips get
  `min-width` as well as `min-height`. The "From the web" link itself is the 40px box
  (`inline-flex`), not only its `<li>`.
- **R2 (P1) A fixed 13px stops a reader's text size from growing the smallest text.** A 0.58rem id
  is 12.8px even at the largest root, so it would have sat at 13px through every setting. So
  `--text-min` under a finger is now `max(13px, 0.8125rem)`.
- **R3 (P2) Tailwind escapes the floor and the guard.** `tw:text-xs` has 273 call sites. They are
  floored in one line instead, by redefining `--text-xs` in `tailwind.css`'s `@theme inline`; the
  built CSS reads `.tw\:text-xs{font-size:max(var(--text-min), .75rem)}`. Arbitrary
  `tw:text-[…]` sizes join the guard.
- **R4 (P2) A per-file count can go green over a swap, and 0.8125rem misses 0.83rem at a 15.36px
  root.** The guard is now an exact baseline of `file › selector › value` (and the TSX arbitrary
  sizes), tight in both directions. Its threshold is 0.85rem/em, and it reads the `font:`
  shorthand as well. Its remaining blind spot is an `em` that looks big but sits in a small
  parent. That is written in the test's header, and the computed sweep is the check for it.
- **R5 (P2) Passage ids are the exception to 40 × 40.** This was already true by design
  (tap-target.css). It is now said in controls.md: ids get the text floor and keep their bounded
  halo.

**Pointer query, settled.** Both floors use `any-pointer: coarse`. That matches the controls
nearest to these (Chat's steppers, Summary's view buttons, the close cross, `.tap-target`). The
bottom dock keeps its `pointer: coarse`, for touch.md's reason. Sol raised no objection.

## What landed

**Stage 1, the chat band.** It is as the stages above say, with R1 and R2 folded in.

**Stage 2, the other modes.** A second Sonnet pass at 390 swept every band except Chat and the
three drawings, plus the prose and its cards, the dock, the bars, the shelf, `/read/public` and
`/profile`. With stage 1 in, it still found about 25 rules under 13px: footnote numbers, Skim's
numbers and cue, Structure's numbers, the hover card's text, `/profile`'s section labels, the dock's
badge, Quotes' "yours", FAQ's ids. Each of those is a literal font size that never went through the
floor.

- **Text.** Every literal `font-size` under 13px-equivalent (px under 13, rem/em under 0.85) in
  `src/web/styles/*.css` now reads `max(var(--text-min), <it>)`: 307 declarations in 32 sheets,
  rewritten mechanically by a script that skips comments. The exceptions are `diagram*.css`,
  `design-page.css` and `logo-animations.css`. No `font-size: 0` was among them. Desktop is
  unchanged, because the token is 0px there. Chat's `font:` shorthand and the 15 arbitrary
  `tw:text-[…]` sizes in TSX were floored by hand (`tw:text-[length:max(var(--text-min),…)]`; the
  `length:` hint keeps Tailwind from reading `max()` as a colour). Each was checked in the built CSS.
- **Targets.** These are floored where the fix is local and cannot crowd a neighbour:
  - the prose hover card's ways out and actions (`.prose-card-link`, `-open`, `-act`,
    `-cite-check`), from 30px, and *Ask about this* from 12 × 25;
  - footnote markers in the prose get a 28 × 40 halo. It is 28 wide because two markers can sit
    side by side. (The sweep's 9 × 24 turned out to be an author's own anchor, not a marker.
    The verification pass found `[n]` markers 21–35px wide and about a line tall, so the real
    gain is the 40px of height. A tap 9px above or below now opens the note.)
  - Chat's composer row (Send, Dictate, Live and its arrow), from 36 to 40, as one rule so the
    four still agree.

### Deferred: the rest of the targets

These are designed controls with a recorded size or a crowded layout, so they need the layout
reconsidered rather than a floor. Each is queued as one Overseer item (see the note):

- **The gutter's icons**, 24 × 24 at a 32px pitch, flush to the right edge. touch.md § The
  gutter owns their spacing, and Greg has asked about it twice.
- **The top bar's 28px icons** (privacy, archive, edit title) 8px apart, with `origin-link` and
  `counts-toggle` about 20px tall.
- **32px buttons everywhere**: a mode's run button, the empty-state buttons, `band-about`. The
  question is shadcn `size="sm"` under a finger, one decision for all of them.
- **The shelf's 28px chips**, its 24px tag buttons and the 18px "opened … ago".
- **Skim's place button** (19 × 32, absolutely positioned), Quiz's native radio (13 × 13) and
  share pie (24), and `/profile`'s Dictate (24 × 26).
- The dock at 39px, a pixel under the floor, is left alone.
- `band-about`, the ⓘ at the head of every band, 32 × 32: one of the 32px family above.
- The hover card's title link (`.prose-card-name`, 23 tall) and a footnote card's source links
  (20 tall): links in a card's text, which a 40px box would push apart.

Inline prose links stay exempt. They are the author's words, a line apart, and a link that wraps
cannot take a halo.

## Code review (GPT Sol, round 1)

[Prompt](261021c-minimum-text-and-touch-target-sizes-on-a-phone-code-review-prompt.md),
[answer](261021c-minimum-text-and-touch-target-sizes-on-a-phone-code-review-sol.md). Exit 0, with
three findings, all fixed by the reviewer and read before committing:

- **C1 (P1)** type-roles still expected Skim's two named exceptions bare.
- **C2 (P1)** `.chat-step`'s later `2.5rem` undercut the 40px chat-icon floor: 38.4px at the
  measured root, 30px at a 12px root. It is now `max(40px, 2.5rem)`, with a cascade test in
  `tap-target.test.tsx`.
- **C3 (P2)** The guard was green for `calc(0.72rem)`, functional Tailwind sizes, and
  `min(var(--text-min), …)`. Only the `max(var(--text-min), …)` form passes now.

Sol found no problem with the footnote halo, the chat header at 40px, or long source links.

## Code review (GPT Sol, round 2)

[Prompt](261021c-minimum-text-and-touch-target-sizes-on-a-phone-code-review-2-prompt.md),
[answer](261021c-minimum-text-and-touch-target-sizes-on-a-phone-code-review-2-sol.md). It was
narrow: the composer's 40px row, `.rcp-view-count`, the two chat-test edits and the 261021b merge.
Exit 0, with one finding, fixed by the reviewer:

- **D1 (P2)** the send button's state matrix allowed the coarse composer selector on the strength
  of a "size only" comment that nothing checked. A test now pins that rule to `width` and `height`
  inside `any-pointer: coarse`, and tap-target.test.tsx pins the composer's four controls.

## Verification at 390 and 1440 (Sonnet browser pass)

- **iPhone.** No text under 13px on the chat list, an Investigate answer, the prose, the hover
  cards, the dock, Structure, Quotes, FAQ, Skim, Sources and `/profile`, bar one:
  `.rcp-view-count`, `0.9em` of an already-floored parent, at 12.1px. That is the guard's named
  blind spot, and it is now floored too. Every chat and hover-card control in scope is 40px. The
  composer row was 36 and is now 40. Screenshots of each surface showed no clipping, overlap,
  badge overflow or wrapped header. A long chat title ellipsises with the 40px icons on one row.
- **Desktop.** Every measured computed size and box is identical to before, so the floor is
  invisible with a mouse.
- **Footnote markers.** A real touch 9px above or below `[1]` opens its note; a touch 60px away
  opens nothing.
