# The title follows the prose below 1600px with the Marginalia column on

Queue item **qi-kfmr6j93**, handed over by the Overseer on 2026-10-06 under Greg's standing rule for
the queue (2026-10-04): *"If you're confident, address all of the Q-queue-yeses"*.

## The bug

With the Marginalia column on and no band, in a window from about 1000 to 1400px, the article's
title sits 55–105px right of the first line of prose. Found by the wide-chat-card session
(`f1805548d`) and left alone there because that session's brief said nothing below 1600px may
change. Screenshots: `output/wide-chat-card/extra-narrow-w1200.png`, `…-w1300.png`.

## The cause

The prose table is centred (`.reader.text-alone table.zoom { margin-inline: auto }`) in `.reader`'s
content box, and `fitMargin` (`src/web/layout.ts`) narrows that box from the right by
`--marg-reserve` when the column does not fit beside centred prose — its rule 2. So the prose sits
`margReserve / 2` left of the window's centre.

The masthead is a full-width bar, and its inner box is centred in it
(`narrow-window.css` § `.reader.text-alone .masthead-inner`). Nothing told it about the reserve
until `f1805548d` added `--marg-title-reserve` to the bar's right padding — and gated it on
`windowWidth >= PROSE_SHIFT_FROM` (1600), to honour "nothing below 1600 changes". Below 1600 the
variable is 0, so the title stays centred in the whole bar while the prose is centred in a narrower
box. At 1200 with a 16px root and the rail on, `margReserve` is 196, so the title is 98px right.

The class: **one box moved and the box that is meant to line up with it was not told** — the same
class narrow-window.css § the title over the column records twice already. The mechanism that
tells it now exists; the gate is what keeps it switched off.

## The fix

Drop the gate. `margTitleReserve(fit)` returns `fit.margReserve` whenever `fit.alone`, and 0 beside
a band (where the title has its own rule, which already subtracts `--marg-reserve`). The
`windowWidth` parameter goes, and the call in `Reader.tsx` with it. No CSS rule changes.

Simpler option passed over: none simpler exists. The alternative — a second threshold ("from
1000px") — would add a number to keep in step with `fitMargin`'s own arithmetic, when "wherever the
prose was pushed" is already exactly `margReserve`.

## What else it changes, and why that is right

The column first appears at a fitted page width of 600px with the rail off, or 612px with it on,
and can reserve room from there, not only from 1000. So
the bar's right padding also grows on an iPad and on a wide phone with the column on:

- **About 600–1000px.** The plan first said the title's left edge would not move here and only
  its wrap width would. **That was wrong** (GPT Sol, plan review F1): the inner box's `65ch` cap
  can already bind in this range, so the title was being centred, and was misplaced, here too. The
  browser agrees: 65px right of the prose at 768 and 98px at 834 before, 1.6px after. So the bug
  reaches down to an iPad, not only to 1000px, and the same change fixes it. At 612 with the
  measured 16px root and rail on, the left edge does not move (0 before and after); the title
  wraps in the reduced space clear of the notes column. This is not a guarantee for other
  roots: with smaller type the title's cap can already bind at 612, so its left edge moves too.
- **Below 600px.** No column, `margReserve` 0, nothing changes.
- **1600px and up.** Unchanged; the gate was already open.
- **Beside a band.** Unchanged; `fit.alone` is false.

## Stages

One stage.

1. Red test first: `tests/layout-margin.test.ts` asserts `margTitleReserve(fit) === fit.margReserve`
   across the whole sweep with no band, and 0 beside a band and with the column off. Seen red
   (`expected +0 to be 200` at 600px) before the fix.
2. The fix, and the comments and `docs/project/marginalia.md` lines that described the gate.
3. Browser check, Playwright on the box, by a Sonnet subagent: title's left edge against the first
   line of prose's left edge, column on, at 390, 612, 768, 834, 1000, 1200, 1400, 1600 — before
   (`--marg-title-reserve` forced to 0 below 1600) and after. Also column off at 1200, and a band
   plus the column at 1400, to show those did not move.
4. `npm test`, `npm run typecheck`, GPT Sol code review, commit, push to `dev`.

Done means: the title's left edge is within the pre-existing residual (about 10px, the 9.7px
measured for 261003c) of the prose's at 1000, 1200 and 1400; nothing is worse at the other widths.

## Results

**GPT Sol, plan review** ([261006c-plan-review-sol.md](261006c-plan-review-sol.md)): `VERDICT: build`,
one P2 (F1, above), accepted and written into the section above.

**Browser**, Playwright with system Chrome on the box, `/read/openai-huggingface`, 16px root, rail on.
The number is the title text's left edge minus the first line of prose's. "Before" is the old
behaviour in these cases, reproduced by forcing `--marg-title-reserve` to `0px` below 1600 and
reading it back. The script uses viewport width for that cutoff; the old code used fitted page
width (after scrollbar and horizontal safe-area insets). This simulation does not establish the
old behaviour where those widths straddle 1600.
Script: `output/qi-kfmr6j93/measure.mjs` (not committed; `output/` is ignored).

| | width | before | after | `--marg-reserve` |
|---|---|---|---|---|
| column on | 390 | 0 | 0 | 0 (no column) |
| column on | 612 | 0 | 0 | 200 |
| column on | 768 | 64.7 | 1.6 | 212 |
| column on | 834 | 97.7 | 1.6 | 278 |
| column on | 1000 | 146.2 | 2.2 | 288 |
| column on | 1024 | 146.2 | 2.2 | 288 |
| column on | 1200 | 107.7 | 9.7 | 196 |
| column on | 1400 | 9.7 | 9.7 | 0 |
| column on | 1600 | 9.7 | 9.7 | 200 |
| column off | 768 | 2.2 | 2.2 | 0 |
| column off | 1200 | 9.7 | 9.7 | 0 |
| band + column | 1400 | 2.2 | 2.2 | 288, title reserve 0 |
| band + column | 1600 | 1.6 | 1.6 | 288, title reserve 0 |

The 9.7px left at 1200 is the residual every centred layout here has, column off included
(narrow-window.css records it for 261003c). No sideways scroll anywhere. Touch contexts at 390–834
gave the same numbers. At 612 and 768 the title now wraps to two lines in the reduced space; before,
at 768, the notes column's first box lay over the byline row and its *Fold all* control, and after
it does not. The larger offsets than the queue item's 55–105px are a different article and root;
the cause is the same.

Not checked: the masthead's controls were looked at, not pressed; the screenshots were dark theme.

**Code review, 2026-10-06:** the 612px unchanged-left-edge claim is scoped above to the measured
root and rail. The title and prose do not have identical wrap widths: at 612px and a 16px root,
the masthead inner box has 369.6px, while the prose has 350.4px, before the title row's own
controls take space. These follow the different padding rules in `shell.css` and
`narrow-window.css`; matching their widths exactly is outside this stage.
