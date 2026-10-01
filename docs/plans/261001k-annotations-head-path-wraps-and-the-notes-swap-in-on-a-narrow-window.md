# Annotations: the head's path wraps, and the notes swap in on a narrow window

Two of Greg's suggestions (admin, `feedback-reporter.ts` exit 0 on both), Overseer queue item
`qi-aytxwf8h`, both filed 2026-10-01 on build `7aaead6d` from
`/read/what-if-we-had-bigger-brains-imagining-minds-beyond-ours`:

> Annotations mode has a rail at the top telling you where you are in the doc - the text is
> truncated too much
>
> — Greg, SPIDERYARN-READING2-7M (`spya-dn3mjt`)

> It would be great to be able to have Annotations mode (in the right-hand-column) *as well as*
> another mode in the left-hand-column.
>
> In other words, Annotations mode can be activated/deactivated independently of whatever other
> modes are active or not in the left-hand-column.
>
> But it's more complicated, because if I'm on a narrow screen, probably we can't show both left and
> right, so probably whichever has been activated most recently trumps/swaps out the other. Or
> something along those lines.
>
> And also consider how it should work on mobile.
>
> Use screenshots, spikes etc.
>
> If implementing this is going to create a lot of complexity, look for a simple, clean approach.
>
> — Greg, SPIDERYARN-READING2-7P (`spya-dp63rf`)

## What was already there

**Most of 7P landed 85 minutes after Greg filed it**: commit `eb76050d`,
[261001i](261001i-annotations-column-beside-a-band-mode.md). Annotations is a switch of its own,
`?margin=1`, independent of the left band; both are drawn together from 900px. Below that, **the
band wins** — whichever was pressed last.

That is half of Greg's rule. The other half is missing, and it is the half he would hit first:

```
 800px, Glossary open, press Annotations
   today:  nothing visible changes; a line at the foot says "the notes need a wider
           window, or the panel closed". The button now shows pressed. Press it again,
           wanting the notes, and it turns them OFF.
   Greg:   the notes were switched on most recently, so they win: the band closes.
```

## 7P: the notes swap in when pressed

One rule, in a pure function (`annotationsPress`, beside the layout it reads):

| State when Annotations is pressed | Result |
|---|---|
| notes off, no band, or both fit | notes on (as today) |
| notes off, band open, both do not fit, notes alone fit | notes on **and the band closes** (`?mode=plain`) |
| notes on and showing | notes off (as today) |
| notes on but hidden behind a band that won, notes alone fit | **the band closes**; the notes stay on |
| notes alone do not fit (a phone) | toggles as today; see Mobile |

Pressing a band while the notes are on already does the other half: the band wins and `?margin=1`
stays, so widening the window brings both back. That is unchanged.

The foot line between 700 and 899px is reworded to say the way back is now the button:
*"The notes need a wider window — press Annotations to swap them in for the panel."*

"Most recent" is the last press, not a recorded timestamp. On arrival from a link with both on, or
after narrowing a window that had both, there was no press to compare, and the band wins as it does
today — the reader is in the middle of something interactive there. Passed over: storing which side
was switched on last (a third piece of URL or session state to keep consistent with the two that
exist, for the one case of a window resized across 900px).

### Below the notes' own width: unchanged, and why

The notes need 600px past the rail even alone (`MODE_PROSE_FLOOR` + `MARG_MIN`; **612px with the
rail**). Below that there is nothing to swap in: pressing Annotations under a band turns the switch
on without closing the band — closing the reader's Glossary to show a line saying the notes need a
wider window would be worse than doing nothing. With no band, the line says so, as it does today.
That covers every phone held upright. **Between 612 and 699px** (a phone on its side, a small
tablet split) the band covers the prose and the notes do fit alone, so the press swaps there too.

Putting the notes inline on a phone was passed over in
[261001d](261001d-annotations-mode-marginalia-in-a-right-hand-column.md) (it mixes the machine's
voice into the author's sequence). **Deferred, named:** the head alone on a phone (the path and the
arc, no notes) — cheap, but a second face for the mode, and worth Greg trying the desktop version
first.

### What the swap costs

**Closing a band is not stepping it aside.** `?mode=plain` unmounts the band, so a half-typed Chat
question or Quiz answer in it is lost, where a band that steps aside (`bandAway`) keeps its state.
Accepted for v1: pressing another band or Plain loses the same draft today, and nothing in the
reader keeps a band's draft across a band change. Keeping the band mounted while the notes win
would be a third layout state ("band away for the notes"), which is the complexity Greg asked us to
look past.

**The metadata page is an arrival, not a press.** Its Dock and command bar follow links
(`modeLinkHref`) that keep whatever band the reader came from; at 800px, choosing Annotations there
arrives with both, and the band wins. "Most recent press" is a rule of the reading view.

## 7M: the path wraps

The head's path is the part and the section you are in, joined with ` › ` on **one line**,
`nowrap` with an ellipsis, in a column 200–288px wide. A part title of thirty characters leaves the
section a word or two. The arc sentence below it is already cut at three lines with the whole in a
card, so the path is what Greg means by "where you are".

The fix: the two titles on **lines of their own** — the part above, small caps, faint; the section
below it — each allowed to wrap, cut at **two lines each** (the full title on hover), so the path is
at most four lines and the head, with the arc's three, at most seven. No ellipsis at ordinary
lengths. The cost is a head one or two lines taller, still sitting above the notes with its fade.

Passed over: a hover card for the full path, as the arc has — it would keep the truncation Greg
objected to and add a press to read it.

## Tests, red first

- `tests/annotations-press.test.ts`: `annotationsPress`, the table above row by row; `notesFit` at
  its thresholds (611/612 with the rail, 599/600 without, 899/900 beside a band, 650 under a
  covering band).
- The page (`every-mode-draws-its-surface.test.tsx` § the notes beside a band): at 800px with
  Glossary open, pressing Annotations closes the band and draws the notes; with the notes hidden
  behind a band, pressing it brings them back rather than turning them off; at 1024 the band stays;
  at 390 the band stays; and the whole sequence Glossary → Annotations → Glossary → Annotations →
  off, one history entry per press. The two swap tests were seen red against `eb76050d`'s handler;
  the one-entry assertion was seen red against two separate writes.
- `tests/annotations-head-path.test.tsx`: each title its own element, the ` › ` kept for a screen
  reader only. Written after the markup, so not seen red; against the old one-line `<p>` it finds no
  steps.

## GPT Sol's plan review, and what changed

[261001k-annotations-swap-plan-review-sol.md](261001k-annotations-swap-plan-review-sol.md), on
[its prompt](261001k-annotations-swap-plan-review-prompt.md). Verdict **build with fixes**, no P0.
The build had started while it ran; every finding was taken into it.

| | Finding | Taken? |
|---|---|---|
| P1 | the fits must be hypothetical, with tested thresholds; "a phone" is wrong as a device rule (612–699 swaps) | **Yes**: `notesFit` in press.ts, tested at each threshold; the section above reworded |
| P1 | closing a band loses a half-typed Chat or Quiz draft, which stepping aside would keep | **Accepted and written down** above: a band change loses it today too |
| P2 | the metadata page's links arrive with both, so the band wins there | **Named** above as an arrival |
| P2 | three lines per title plus the arc allows a nine-line head | **Yes**: two lines per title, full title on hover |
| P2 | pin the sequence and the history | **Yes**: one combined write (`setModeAndMargin`, the setter the old-link rewrite already used), and the sequence test |

## The browser check

A Sonnet subagent drove the build in Playwright on the box (`wisdom-spya-vkvttk`, 7 parts, 18
sections). Screenshots: [261001k-shots/](261001k-shots/). It ran before the two-line clamp; the
tallest path it met was two lines a title, inside the clamp.

| Width | What | Result |
|---|---|---|
| 1600 | `?margin=1` | part and section on lines of their own; head 112px, 130px with a two-line part |
| 1100 | Glossary + notes | both drawn; path 72px (two lines each), head 147px |
| 800 | Glossary, press Annotations | `?margin=1`, band gone, notes drawn; Glossary back hides them with the new line; Annotations again swaps back |
| 390 | Glossary, press Annotations | band stays; `?mode=glossary&margin=1`; no notes |

No horizontal overflow, no page errors. At 390 the button shows pressed with nothing visible
changed — the switch is on and waits for room; the cost of not closing a band for nothing.

## Stages

1. Plan, GPT Sol plan review. **Done.**
2. Build both, tests red first; gates. **Done.**
3. Browser check. **Done.**
4. GPT Sol code review (write-capable); docs (`narrow-windows.md`, `reading-view-overview.md`); the
   feedback note.
