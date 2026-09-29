# Trajectory: snippets that open in place, a route sparkline, and a "where am I" card

Two reports of Greg's from 2026-09-29, relayed by the Overseer as the next stages of the Trajectory
work. Both verbatim.

**SPIDERYARN-READING2-59:**

> I'm increasingly thinking of the trajectory mode as one of the main modes, and that I'd mostly
> stay within it. I really like the way that you've included the quotes in the left-hand column of
> the trajectory mode, and I'm wondering, and the way that you've included the expandable glossary
> buttons, that's cool too, so that if I want, I can ask for more information. I wonder where else
> we could be pulling from. So perhaps we could be making use of the FAQ as a snippet, or for the
> ideas, can we make them be expandable as well, like the glossary, so that I can stay in
> trajectory mode and access almost everything that I'd want to for the snippets. And I might
> occasionally want to click through to, you know, the full glossary mode or the full ideas mode,
> but mostly I won't have to.
>
> — Greg, 2026-09-29

**SPIDERYARN-READING2-5C:**

> In the trajectory, we have included these collapsed glossary entries, which is great. I love
> them. And if I click on one, it shows me more information in place, which is also great. And I'd
> like to be doing that for various kinds of snippets in the trajectory, as we've said separately.
> The thing I wanted to note is it says in the glossary as a piece of text. I'd rather that was an
> icon with a tooltip, because I'm trying to avoid adding more text than we need, because there's
> already so much text on the page. Icons should always have tooltips, and for navigation, I'm
> suggesting that where we can, we use icons + tooltips rather than text labels. And add this as a
> note to our design document going forwards.
>
> I also noticed something else in the trajectory mode. There's something a little bit strange
> underneath quotes. It seems to ask a question. Is that from the summary, or where does that come
> from? See if you can have a look at some screenshots. And there's just something about the
> placement of it that doesn't quite follow. It's like it shows the quote and then asks the
> question that it relates to. I kind of like the idea of situating the quote in terms of the
> question for which it's an answer. But if so, maybe the question should go first and add a
> tooltip so that it provides extra information to say something like, This is a generated
> summary, and which section it comes from.
>
> And in general, if we can try and help the user situate themselves when using trajectory mode
> in the, where they are in the article. So that could be partly breadcrumbs showing where in the
> hierarchy, although that takes up a lot of space and might be just extra noise. Maybe it's all
> hidden in tooltips. So if I hover, I get a sense of where I am in the wider article structure,
> like a mini tooltip showing the... Yeah, actually, it might be nice to have a reusable tooltip
> for the structure mode fish eye that actually would be useful when hovering over the spine to
> show, okay, this is where I am right now relative to the wider course hierarchy. So we could
> perhaps add that here when hovering on elements in the trajectory mode or hovering over the
> little vertical line indicator for how far through the article.
>
> One other related idea. At the very top of the trajectory mode, it says step n of m. Perhaps to
> the right of that, we could have a kind of sparkline that shows how we are going to move through
> the position of the document, how each step moves up and down in the document, or something like
> that, just to show what path the trajectory is going to take us on. In fact, if there were little
> sort of dots along the way, that would give us a clear indication of how many steps and how far
> through the steps we are. And so then maybe we wouldn't actually need step 11 of 18. You could
> just have that sparkline with a tooltip that would give you the number. And then that would mean
> that we could move the sort of three levels of detail up onto that same row to take up less
> vertical space.
>
> — Greg, 2026-09-29

## What the question under the quote is

It is **FAQ's**, not Summary's. The stop card
([`stop-card.ts`](../../src/web/stop-card.ts)) gathers, for the current stop's paragraph, whatever
the other modes have already written: the Glossary terms it uses, the Ideas it bears on, **the FAQ
question whose answer passages include this paragraph**, and where it sits in the Timeline. The
card sits under the quote, so the question reads as an afterthought. FAQ's questions are
model-written; their answers are passages of the article (`FaqQuestion.passages`, 1–3 of them).

## What gets built

Each is the simplest version that answers the report. The product calls it takes are listed under
*Assumptions* below.

### 1. The card's snippets open in place (59, 5C)

- **Glossary terms** stay as they are — a chip that opens its sense in place — but the *In the
  glossary ›* text link becomes an **icon button**, the Glossary mode's own icon (`BookA`), with a
  tooltip *"Open in Glossary"*.
- **Ideas become chips like the terms.** Pressing one opens its **statement** (the one line the Ideas
  step wrote for it) in place, with the Ideas icon (`Lightbulb`) to open it in Ideas. Today an idea
  is only a link that leaves the mode.
- **The FAQ question moves above the quote**, on the current row, as Greg suggested: the question,
  then the passage that answers it. It carries FAQ's icon (`BadgeQuestionMark`) with a tooltip saying
  what it is — *"A question the FAQ wrote about this article. This passage, in <section>, is one of
  its answers."* Pressing the question opens its **other answer passages** in place — the article's
  own words, each with its section — which is the FAQ's answer, since FAQ answers only in the
  article's passages. An icon opens FAQ. The card's own *"The question it answers"* cluster goes.
- **Timeline events** stay as they are; they are experimental and nobody reported them.

One open snippet at a time across the whole card, so the card never grows by more than one sense.
Stepping on closes it (the card is keyed on the stop already).

### 2. The head: a sparkline instead of "Stop k of N", and the depths on the same row (5C)

`‹ [sparkline] ›  Gist 4 · More 6 · Most 10  ⓘ`, one row where the band is wide enough, wrapping
where it is not ([narrow-windows.md](../project/narrow-windows.md)).

- **The sparkline** is a small SVG: one dot per stop of the current pass, left to right in walking
  order, each at its height in the article (top the start, bottom the end — the same axis as each
  row's vertical position mark), joined by a thin line. The current stop's dot is larger and in the
  accent; the ones walked before it are filled, the ones still to come hollow. It shows the path the
  pass will take and how far along it you are.
- **Its tooltip** says *"Stop 3 of 6 · about 40% through the article"*. The words *Stop k of N* stay
  for a screen reader, `sr-only` and `aria-live`, so nothing is lost to someone who cannot see the
  line.
- **The dots are not buttons** in this version; the list's rows already jump. Deferred.

### 3. A "where am I" card, one component for Trajectory and the spine (5C)

A compact **fisheye of the article's outline**, built once as `WhereCard` over a pure function
(`whereRows` in a new `src/web/where.ts`) and used in two places:

- **Trajectory**: the tooltip of each row's vertical position mark, and of the row's section path.
- ~~**The spine**: the band hover card's top line, where today one crumb says *"Part name 3 of
  7"*.~~ **Deferred** after Sol's review (F1, F2): a band is a node, not a block, and its card has no
  height cap, so the spine needs a shorter, node-based version. `whereRows` already takes a path of
  node ids over any outline shape, so that version reuses it.

What it draws, for a block:

```
  Introduction
  Methods
▸ Results                    ← the top-level section you are in, marked
    Rich-club triads
  ▸ Synergy peaks            ← each level down the path, siblings near it shown
    Behaving primates
    … 2 more
  Discussion
  … 3 more
```

- every top-level section when there are few (≤ 8); otherwise the ones within two of yours and an
  *"… n more"* line either side;
- then, down the path to the block, each level's siblings within two of the one you are in, the
  same way, indented;
- the section you are in marked, and `aria-current="location"` on it.

It is text in a tooltip, so it costs no space until hovered, which is what Greg asked for: *"Maybe
it's all hidden in tooltips."* No gists: this answers *where*, and the spine card already carries the
gist.

### 4. The design note (5C)

*Icons with tooltips rather than text labels, for navigation* goes into
[icons.md](../project/icons.md) as a section of its own — not under its § Rules, which would need
approval (Sol F9) — with Greg's words, and a signpost to it in
[design-css-overview.md](../project/design-css-overview.md) is **not** made here: that file is a
rule doc, so its wording goes to Greg as a before/after in the debrief
([edit-important-docs.md](../reusable/edit-important-docs.md)).

## Assumptions (product calls taken the simple way)

1. **The FAQ question sits above the quote words on the current row only**, the way the cue and the
   card do; the other rows stay as they are.
2. **The FAQ "snippet" is the question's other answer passages**, because FAQ writes no answer text
   of its own. If the only passage is this one, the question does not expand, and says so in its
   tooltip.
3. **The sparkline's dots are not clickable** yet.
4. **The where-card replaces only the spine card's crumb line**; the title, gist and sub-sections
   there stay.
5. **Only navigation gets the icon rule.** Cluster headings (*Terms it uses*) are labels, not
   navigation, and stay words.

## The simpler options passed over

- **Leave the FAQ question where it is and add only a tooltip.** Cheaper, but Greg's point is the
  order: a question read after its answer does not frame it.
- **A visible breadcrumb on every row** instead of the where-card. Greg thought it would be noise; the
  row already shows the section path.
- **A separate tooltip in each place** for "where am I". Greg asked for one reusable one, and two
  copies of "where is this block" is the class of bug `structure.ts`'s header warns about.

## Stages

1. This plan; GPT Sol plan review (read-only).
2. Build (1) and (4); then (2); then (3). Tests first where the logic is pure: `whereRows`, the
   sparkline's points, the card's one-open rule.
3. Gates, GPT Sol code review (with fixes), a browser check at desktop and phone widths (Sonnet),
   feedback notes for 59 and 5C, push to `dev`.

## Deferred

- Clickable sparkline dots.
- Expanding Timeline events in place.
- The where-card anywhere else (Structure mode's own rows, the Summary list).

## Progress

- 2026-09-29 — plan written.
- GPT Sol plan review ([prompt](260929f-trajectory-plan-review-prompt.md),
  [answer](260929f-trajectory-plan-review-sol.md)): *approve with changes*, all taken.
  **F1, F2** the spine is deferred (above). **F3** the FAQ pairs a question with a *paragraph*, so
  the tooltip says so, and the question opens to *every* passage FAQ points to, not "the others".
  **F4** the question is a sibling of the row's button, above it, and the one-open state lives in
  the panel (keyed to the stop) so the list's follow-scroll re-measures when a snippet opens.
  **F5** one where-card trigger: an invisible button laid over the position mark, beside the row's
  button, controlled so a tap opens it. **F6** the sparkline is a button with the count in its
  label and tooltip, plus a separate `role="status"` line. **F7** the head wraps at the band's
  narrowest, and a stop with no position breaks the line instead of getting an invented height.
  **F8** `modeForCardTarget` is total, so FAQ cannot inherit Timeline's switch. **F9** as above.
- Built: `where.ts` + `WhereCard.tsx` (tests/where.test.ts), `route-spark.ts`
  (tests/route-spark.test.ts), the card and head in `TrajectoryPanel.tsx`, `stop-card.ts`
  (statements, passages, `modeForCardTarget`), `Reader.tsx`'s FAQ link, the CSS, icons.md and
  trajectory.md. The card's panel tests were rewritten for the new behaviour and new ones pin the
  question's place and passages, the icon buttons, one-open-at-a-time and the where-card.
- GPT Sol code review ([prompt](260929f-trajectory-code-review-prompt.md),
  [answer](260929f-trajectory-code-review-sol.md)), *approve after fixes*, all five read and kept:
  **F1** a snippet closed by stepping away reopened when you stepped back (my bug: the state was
  hidden, not cleared); **F2** a where-card could reopen after its row came back; **F3** the
  where-button's position is now derived from the row's own measures rather than a magic offset;
  **F4** two FAQ passages with the same words shared a React key; **F5** the sparkline's label says
  when a stop has no position.
- Browser check (Sonnet, Playwright, the entropy paper), in two rounds. The first found the
  article's Glossary, Ideas and FAQ **stale** — it had been re-made at 12:38 that day — so the card
  drew nothing; the second pressed *Find them again* on all three (local database only, about
  $0.20, authorised for the purpose) and ran the card checks. At 1280×800 and 390×844: the
  sparkline and its tooltip, the where-card (centred on the mark, and it does not press the row),
  term and idea chips with icon links, one snippet at a time, the FAQ question above the row with
  its passages, and stepping closing a snippet all pass. FAQ questions were on Gist stop 2 and Most
  stops 2, 3, 6, 7, 9, 10. It also found: an idea chip's wrapped name 33px between lines; a large
  FAQ tooltip; Most's depth buttons wrapping by a few pixels at 1280; and — in the screenshot — the
  FAQ's passage repeating the stop's own quote right above it. All four were changed: chip line
  height, a shorter and narrower tooltip, a sparkline of 6px a stop up to 72px, and *"This stop's
  passage, below"* in place of a repeat.
- GPT Sol code review 2, of those changes ([prompt](260929f-trajectory-code-review-2-prompt.md),
  [answer](260929f-trajectory-code-review-2-sol.md)), *approve after F1*: my match hid a longer FAQ
  passage that merely contained the stop's quote, hiding words not shown below. Now only a FAQ
  passage lying wholly inside the stop's quote is named rather than repeated, proved by the stored
  offsets where the Quote has them, and by the words (40 characters or more) where it does not.
- Screenshots: [where, 1280](260929f-shot-where-1280.png), [head, 390](260929f-shot-head-390.png),
  [card, 1280](260929f-shot-card-1280.png), [question, 1280](260929f-shot-question-1280.png),
  [card, 390](260929f-shot-card-390.png) — taken before the last round of cosmetic changes.
