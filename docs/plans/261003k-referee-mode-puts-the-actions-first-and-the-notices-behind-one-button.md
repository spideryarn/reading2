# Referee mode puts the actions first, and the notices behind one button

Feedback report `spya-vbeyse`, Greg, 2026-10-03, on the Entropy article in Referee mode:

> The referee mode is, the UI is very confusing. I wonder, is there a way to clean it up, take
> screenshots and just, you know, guide me a bit more? It seems to bury the actual actions and
> useful stuff underneath a whole bunch of warnings. I mean, maybe those warnings are necessary,
> but perhaps we could hide them inside the information tooltip or something, or create a warning
> tooltip, and in general see how you can improve that whole mode UI.

The mode is described in [referee-mode.md](../project/referee-mode.md). This plan changes the web
client only. Another session (sweep-c6a) is changing Referee's store and its two route handlers, so
nothing here touches `src/store/`, the routes, a prompt or the database.

## What is on screen today, top to bottom

Before the first thing a referee can act on (the criterion box), the band shows:

1. a header row with one button, *How this works*;
2. a box with the sentence *"This article's text has already been sent to a third-party model
   provider."* (press to expand two more paragraphs);
3. in the same box, always visible, *"Opening Candidates may send terms drawn from this paper to a
   search engine, which is a different third party from the model provider."*;
4. a second box, *Hidden instructions*, with a one or two line result of the source scan;
5. the four sub-mode chips: Criteria, Claims, Mirror, Candidates;
6. on a first visit, the *How Referee mode works* card: two paragraphs, one of them about what
   colours mean on a kind of criterion the referee has not written yet;
7. then the panel.

Measurements and screenshots of this state are in § Before, below.

Each of items 2 to 4 and 6 was added for a reason that is written down, and each was reviewed. Taken
one at a time they are defensible. Together they are what Greg met: a screen of notices with the
actions underneath.

## What changes

**One: the three notices go behind one button in the header.** The header row gets a second
button, *Notices*, with a warning-triangle icon, beside *How this works*. Pressing it opens the same
box that is there today (`.ref-brief`, with its height cap and its scroll), holding the
confidentiality paragraphs in full and the hidden-instructions scan. Shut, it costs no height.

- It is a button you press, not a hover tooltip, because a tooltip does not exist on an iPad or a
  phone. The button also carries a hover card that says in two sentences what is inside.
- **It opens itself when the scan found something.** That is the rule the scan box already has
  (open when it looked and found something, shut otherwise), moved up one level. A finding is news
  about this document; the rest is the same on every paper.
- Nothing is remembered: it starts shut on every visit unless the scan found something. So this
  stays a collapse, not a dismissal, as the present notice is.
- Inside the open box the confidentiality text is printed in full, with no second chevron to
  press. The scan keeps its own open/shut control, unchanged; `SourceScanNotice.tsx` is not edited.

What this gives up, said plainly: today the one-line fact *"This article's text has already been
sent to a third-party model provider"* is on screen at all times in Referee mode. After this it is
one press away. The same fact is still shown at the moment an article is added, before anything is
sent (`ADDING_SENDS_TEXT_AWAY`). This is question [Q-referee-sent-line] in § Questions for Greg.

**Two: the Candidates chip stops starting a run, so its warning can leave the top of the mode.**
The always-visible Candidates sentence (item 3) exists for one reason: since 2026-09-06 pressing the
Candidates chip itself starts an AI turn that may run a web search, so the warning had to be on
screen before the chip was pressed, in all four sub-modes. `src/messages.ts` says what to do if that
ever changes: *"If Candidates ever goes back behind a button, this line goes with it."*

So Candidates goes back behind its button. Pressing the chip opens the panel and runs nothing. The
panel already draws a *Build the reviewer brief* button with a visible sentence under it naming the
search engine (`StartBrief` in `CandidatesPanel.tsx`), which today is seen only when the automatic
attempt failed. After this it is what a first visit to Candidates shows. The warning is then beside
the control that causes the thing it warns about, and nowhere else.

- The change is one entry removed from `REFEREE_TARGET` in `src/web/activation.ts`. The command
  bar's row for Candidates reads the same table, so it stops starting a run too, and stops showing
  its "this generates" marker.
- Claims still runs on its chip. It reaches no new third party, and its run is stored.
- The simpler option passed over: keep the chip running it and move the sentence into the chip's
  hover card. That would let a press on a phone, where there is no hover, send terms from an
  unpublished paper to a search engine with nothing visible having said so. It costs one extra
  press to avoid that. This reverses, for this one sub-mode, Greg's 2026-09-06 rule that opening a
  mode starts it; it is [Q-candidates-press] below.
- `REFEREE_CANDIDATES_REACHES_SEARCH` stays in `src/messages.ts`, unchanged, and is printed inside
  the Notices box, so the full list of where text goes is still in one place.

**Three: a line under the chips says what to do in the sub-mode you are in.** Each chip already has
a hover card whose first sentence says what the sub-mode is for, for example Criteria: *"Write what
you have been asked to judge this paper against. Each criterion becomes a re-runnable pass that
marks the passages bearing on it."* That sentence is exactly the guidance Greg asked for, and today
it is only on hover. It is printed, from the same constant (`REFEREE_VIEW_TIP[view].what`), as one
quiet line between the chips and the panel. The hover card keeps both sentences.

Where a panel's own empty-state line then says the same thing a second time, that line goes
(Criteria's *"Nothing yet. Write what you have been asked to judge…"* and Claims' *"The claims this
paper makes about its own work…"*).

**Four: the *How Referee mode works* card starts shut.** It is two paragraphs of principle and
colour-key above the first control. *How this works* in the header opens it, as now, and the choice
is still remembered on the device. The line from change three does the guiding instead. The stored
bit changes meaning from "the referee shut it" to "the referee opened it", under a new key, so
nobody's old "shut" is read as "open".

## What does not change, and why

- **No sentence is reworded and no warning is deleted.** Every notice is still there in full, one
  press away or beside the control it is about.
- **The rules printed inside each panel stay** (*a passage takes a claim up, never whether it
  carries it*; *the number is the model's ordering, not a score*; the Mirror evidence note; the
  conflict-of-interest caveat). Most appear only once there are results to read them against, and
  they are what keeps the mode from reading as a verdict. Thinning them is the natural second pass
  and is [Q-referee-panel-rules] below; it is not built here.
- No change to the scan, the stores, the routes, the prompts or the URL parameters.

## The simpler option passed over

Only restyle: keep everything where it is and make the notice boxes smaller and greyer. Passed over
because the complaint is about order and height, not colour: the actions are below the notices, and
smaller notices would still be above them.

## Stages

One stage; it is one screen.

1. Tests first, seen red: the band shows no notice text when shut; the Notices button opens it and
   says so with `aria-expanded`; it is open without a press when the scan found something; the
   Candidates chip arms nothing; the lead line prints the current sub-mode's sentence; the How card
   is shut on a device that has never seen it.
2. The change, in `RefereeMode.tsx`, `RefereeCard.tsx`, `referee-card.ts`, `activation.ts`,
   `CriteriaPanel.tsx`, `ClaimsPanel.tsx`, `styles/referee.css`.
3. Existing tests that pin the old layout are updated to pin the new one, not deleted:
   `referee-band-fits`, `referee-how-card`, `pressing-a-chip-arms-it`, `referee-candidates-press`,
   `command-bar-sub-modes`, and whichever others go red.
4. `npm test`, `npm run typecheck`, lint on touched files.
5. Browser check by a Sonnet subagent at 1280×800, 820×1180 and 390×844: the same four states as
   § Before, the same measurement, and the Notices box opened at each width.
6. GPT Sol reviews the code. `referee-mode.md`, the docstrings in `messages.ts` and `activation.ts`
   that describe the old arrangement, and the feedback note are updated in the same commit.

Done means: at 1280×800 the first control in Criteria is within the top third of the band on a
first visit, every notice is reachable in one press at all three widths, and nothing starts a web
search without a press on a button that has the warning beside it.

## Questions for Greg

Written up in full in the debrief; the build does not wait on them.

- **[Q-referee-sent-line]** whether the one-line *"text has already been sent"* fact should stay
  permanently visible. Built: behind the Notices button.
- **[Q-candidates-press]** whether Candidates should start on its chip. Built: it waits for its
  button.
- **[Q-referee-panel-rules]** whether to thin the rule sentences inside each panel next. Not built.

## Before

_Filled in from the browser pass._

## After

_Filled in from the browser pass._
