---
reports: spya-vbeyse
ending: shipped
---
# Referee mode buries its actions under warnings

From Greg (the row is an admin's, per `feedback-unswept.ts --show spya-vbeyse`), relayed by the
Overseer, so trusted and built. Sentry has the event (`ac036211153e4658b56613cd7274de10`).

> The referee mode is, the UI is very confusing. I wonder, is there a way to clean it up, take
> screenshots and just, you know, guide me a bit more? It seems to bury the actual actions and
> useful stuff underneath a whole bunch of warnings. I mean, maybe those warnings are necessary,
> but perhaps we could hide them inside the information tooltip or something, or create a warning
> tooltip, and in general see how you can improve that whole mode UI.
>
> — Greg, 2026-10-03 (`spya-vbeyse`)

## What we did

Plan, reviews, and the before and after screenshots:
[261003k](../plans/261003k-referee-mode-puts-the-actions-first-and-the-notices-behind-one-button.md).
What the band is now: [referee-mode.md § What the band looks like](../project/referee-mode.md#what-the-band-looks-like-since-2026-10-03).

- **The warnings are behind one *Notices* button** beside the four chips. It opens by itself when
  the hidden-instructions check found something.
- ***How Referee mode works* is the (i)** in the band's corner, like every other mode.
- **One line under the chips says what to do** in the sub-mode you are in.
- **The Candidates chip no longer starts a run**; its own button does, with the search-engine
  sentence beside it. That is what let that warning leave the top of the other three sub-modes.

The criterion box now starts 151px down the band at 1280 × 800 (it was 607), 205px on an iPad (783)
and 184px on a phone (627).

## Not built, and asked

Three questions went to Greg through the Overseer, written out in the plan's § Questions for Greg:
whether a one-line *"text already sent"* fact should stay on screen ([Q-referee-notices-hidden]),
whether Candidates should start on its chip again ([Q-candidates-press]), and whether to thin the
rule sentences inside each panel next ([Q-referee-panel-rules], not built).

## Greg's answers, 2026-10-03

> Q-referee-notices-hidden A
>
> Q-candidates-press yeah that's fine for now
>
> Q-referee-panel-rules B

The Notices button and the press-to-start Candidates stay as built. **The panels' how-to-read sentences move into hover cards or the (i)**, which is queued as session fb-referee-panel-rules.
