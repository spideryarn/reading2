# A citation's hover card offers Dig deeper, and a proposal to fold Citations into Debate

Report `spya-c2qmbg`, Greg, 2026-10-03, from the Feedback button on the Entropy article:

> I've said before that I think I'd rather have fewer major modes and perhaps amalgamate them in and
> either hide or amalgamate them so we have submodes. Strikes me that, well, citations and debate
> modes are pretty closely related. … in an ideal world we'd find a way to combine citations and
> debate mode, maybe into just references or some other word that captures it all. … But so the
> thing that triggered me to think this was I was looking at a citation and it said, Do you want to
> search Scholar in the tooltip? So I clicked search Scholar and it took me to another page. It's
> just a Google Scholar search. That wasn't that interesting. What I was hoping is that it would have
> a button for dig deeper in the tooltip. I think maybe it does in the main citations mode? That's
> more generally what I wanted was for it to say, enable me to situate that citation within the
> wider debate. … maybe there's a button to say see in wider debate, and it figures out which theme
> within the debate themes it fits into … I suppose simpler would be just to have a chat, but maybe
> that's the backup plan if this all seems too complicated.

The full text is in the note, `docs/user-feedback/261003_*-citation-card-dig-deeper-and-citations-in-debate.md`.

Two parts. **Part 1 is built here.** **Part 2 is a proposal for Greg and nothing of it is built.**

## Part 1: Dig deeper on the citation's hover card

### What the reader gets

Resting on a citation in the prose opens its card. For the article's owner the card's foot gains one
button, **Dig deeper** (*Dig deeper again* when the row already has a kept answer). Pressing it does
what the glossary card's button has done since 261002c:

1. starts the existing *Dig deeper* for that work (the same paid, streamed call the Citations row
   makes; no new endpoint, prompt or schema);
2. closes the card;
3. opens Citations mode with that work's row scrolled into view, where the answer streams in with
   everything the row already does: the stage line, the draft, a failure, *Dig deeper again*.

While any dig is running the card's button is disabled, and on the work being dug it reads
*Digging deeper…* with the spinner. A visitor's card is unchanged: no button.

*search Scholar* stays in the foot for a row with no link. It is the only way out to the work for
such a row, and the safety property depends on it being drawn as a search.

### The one structural change

*Dig deeper*'s state lives in `useCitations` (src/web/useCitations.ts), which is mounted only while
the Citations band is. The card is on screen in every mode. So the state has to live somewhere that
is always mounted, and there is already such a place: `useCitationsRead`, mounted once in
`ArticlePage` and shared by the band and the prose.

So `investigate`, `investigating`, `investigateStage`, `investigateDraft`, `investigateFailed` and
`findNote` move from `useCitations` into `useCitationsRead` and onto `CitationsRead`. `useCitations`
passes them through, so `UseCitations`, `CitationsPanel` and every panel test are unchanged. This is
the move 261002c made for the glossary (`look` onto `GlossaryRead`), for the same reason.

What changes in behaviour because of the move:

- **Leaving Citations mode no longer stops the reading.** The stream carries on, and the row has the
  answer or the draft when the reader comes back. Leaving the *article* still aborts the fetch
  (the slug-change cleanup moves with the state). The server finished and stored the answer either
  way, before and after.
- `ArticlePage`/`Reader` re-render on each streamed delta while a dig runs. The glossary's
  `lookDraft` already does this from the same place.

### Opening the row

The card calls one thing, `citeActions.dig(id)`, and Reader owns what it does: call
`owner.citations.investigate(id)`, set a one-shot `citeFocus: { id, n }` in Reader state,
`setMode("citations")`. `CitationsBand` passes the focus to `CitationsPanel`, which:

- if the prioritised order's bar is hiding that work, lowers `?citebar=` to the work's priority,
  floored to the slider's step (a `barToReveal`, the twin of the glossary's `gateToReveal`), so the
  slider visibly moves and nothing happens behind the reader's back;
- once the row is drawn, scrolls it into view (`[data-citation-id]`, which the row already carries)
  and tells Reader which focus it took, so coming back to Citations later does not scroll again
  and an older request cannot clear a newer one. Nothing is taken while the list is loading; a work
  the ready list does not have is dropped.

**And a row being dug stays drawn** (added after the plan review, F1). A dig changes its own row's
priority: the `finding` step detaches the kept answer and with it a web influence that may be what
holds the row above the bar. So the panel lowers the bar whenever the priority of the last work dug
changes and the bar would hide it. Keyed on the priority, not the bar, so a reader who raises the
bar afterwards is not fought. This was already true of a press on the row itself.

No `?cite=` URL parameter. A selected citation in the URL is a separate feature (the row has no
selected state to draw), and a one-shot scroll does not need it.

### Passed over

- **The answer streaming inside the card.** The card is 18rem and closes when the pointer leaves; a
  minute-long answer needs somewhere that stays put. 261002c § 3 passed over the same thing.
- **A button that only opens the row, without starting the dig.** Two presses for what Greg asked
  for in one, and unlike the glossary card's twin.
- **Leaving the state in the band and handing it a "please start" request on mount.** Fewer lines
  moved, but the card could not know a dig was already running, and a request consumed in a mount
  effect is the shape that fires twice.

### Tests (red first)

- tests/citation-hover-card.test.tsx: an owner's card has *Dig deeper*; pressing it calls
  `investigate(id)` and `onDigWork(id)` and closes the card; *Dig deeper again* with a kept answer;
  disabled while another dig runs; no button without `citeActions` (a visitor).
- tests/citations-investigate-client.test.tsx: the read alone (no `useCitations` mounted) can run an
  investigation to `done`; the existing unmount test still aborts.
- tests/citations-panel.test.tsx: `barToReveal` (hidden row, shown row, non-prioritised order, a
  priority off the grid floors down); the panel scrolls a focused row and reports it taken.

### Docs

citations.md: § Marked in the prose gains the button; *Dig deeper from the hover card* comes out of
§ Deferred; § Dig deeper says leaving the band no longer stops the reading. The `CiteCard`
docstring's "deliberately not here" list loses its two entries that this builds.

## Part 2 (proposal, not built): Citations inside Debate

### What Greg is asking

Two separate things, which need separate answers:

1. **Fewer major modes.** Citations and Debate are both about other people's work: what the article
   cites, and what others say about the article. One mode with sub-modes rather than two modes.
2. **Situate a citation in the wider debate.** From one cited work, see which of the debate's themes
   it belongs to; and have Debate's *are the claims substantiated* include *do the cited works say
   what the article says they say*.

### What exists today

- **Citations** (not experimental): one row per cited work. *Dig deeper* already answers a form of
  (2) for one work. Its quick check reads the search extract and gives a verdict, *supports / partly
  supports / the extract doesn't show what the article uses it for*; its longer reading is prose
  about how the work bears on the article, with no structured verdict.
- **Debate** (experimental): two sub-modes since 261003o. **Reception** is what others wrote about
  the piece; **Claims** is what has been written about each claim the piece makes. **Threads**
  (themes, each a label, a sentence and a list of rows) and **key sources** narrow either.
- The two lists have no cross-links and no shared identity for a work. The same paper can turn up
  in both independently (Debate's key sources include an *origin* role), and nothing says so.
- Citation marks in the prose appear for the owner whatever the experimental switch says; a visitor
  has none.

### Options

```
A  as now, plus links        B  one mode, three sub-modes     C  B, and citations join the threads

[Citations] [Debate]         [ Debate (or a new name)      ]  [ Debate (or a new name)          ]
     |          |             Reception | Claims | Cited      Reception | Claims | Cited
  the list   R | C            the same three lists,           thread "scaling" -> 3 replies
  card: Dig deeper            moved under one button                              + 2 cited works
                                                              claim 2 -> outside views
                                                                       + the works cited for it,
                                                                         each with its verdict
```

**A. Keep two modes; connect them with buttons.** Part 1 is the first of these. A second could be
*Ask about this* on the card, opening chat with the work named (Greg's "backup plan").
*Costs:* almost nothing. *Gives up:* the mode count stays the same, and nothing places a citation in
a theme. **C1 below does not need the merge**, so *A plus C1* is also an option: two modes, and
Claims lists the cited works beside each claim.

**B. One mode, three sub-modes: Reception, Claims, Cited works.** The citations list moves, as it
is, under Debate's segmented control. `?mode=citations` keeps working by redirecting. One fewer
button on the mode bar.
*Costs:* a few days. No model call, prompt or schema changes; it is the mode catalogue, the URL
parameters, the help page and a lot of tests. **One real decision inside it:** Debate is behind the
experimental switch and Citations is not, and the prose's citation marks are on for everyone. So
either the merged mode comes out from behind the switch (Debate with it), or Cited works stays
reachable for readers with the switch off.
*Gives up:* nothing a reader has today. It does not by itself "situate" anything: the three lists
sit side by side.

**C. B, plus the citations take part in the debate.** Two additions, separable:

- *C1, cited works beside the claim.* In Claims, each claim lists the works the article cites **in
  that claim's paragraph**, each with its quick-check verdict and longer reading when it has them.
  It needs no model call: a Debate claim stores its paragraph (`blockId`) and a cited work stores
  the paragraphs that cite it (`citedAt`); GPT Sol checked both shapes. **What that join proves is
  only that they share a paragraph.** Two claims in one paragraph would both get all its works, and
  the verdict is about what the article uses the work for, not about that claim's words. So the
  heading has to say *cited in this paragraph*, not *supports this claim*. Claims also lists only
  the claims the search found outside sources for, not every claim in the piece.
- *C2, cited works in the threads.* A model pass assigns each cited work to a thread, so *See in
  wider debate* on a citation opens the thread it belongs to. *Costs:* a prompt change or a new
  call, a schema change, and a new way to be wrong (a work filed under a theme it does not belong
  to, from a title alone, since nothing has read most cited works).

### Recommendation

**B, then C1; not C2 yet.** B gives the fewer-modes half outright and is mechanical. C1 gives the
most useful part of "situate", the paper's own evidence beside the outside view of the same claim,
from data already stored. C2 is the part most likely to mislead, because for most works we have
only the bibliography entry; it is worth doing once *Dig deeper* has read more of them.

For the name: **Debate** is wrong for a bibliography and **References** is wrong for replies.
**Sources** or **Discussion** cover both; I would pick **Sources**.

### [Q-citations-in-debate] for Greg

1. A, A plus C1, B, or B then C1 (recommended)? And is C2 wanted at all?
2. If B: does the merged mode come out from behind the experimental switch, or does only its Cited
   works sub-mode show with the switch off?
3. The name: Sources (recommended), Discussion, References, or keep Debate.

## Stages

1. Move the dig state onto the read; card button; Reader wiring; reveal in the panel; tests; docs.
2. GPT Sol code review; browser check at desktop, iPad and phone widths; note; push.

## Log

- 2026-10-04: GPT Sol's plan review, [261004b-plan-review-sol.md](261004b-plan-review-sol.md):
  the lift is sound. F1 (P1), a dug row can fall under the bar mid-stream: fixed as above, with a
  test seen red by disabling the effect. F2, the focus hand-off: the taken focus is named, nothing
  is taken while loading, and a missing work is dropped; tests for each. F3, a test that closes the
  band alone mid-stream: added. F4 and F5 corrected Part 2's account of what the stored shapes
  prove, and added *A plus C1*. Its touch advice was to copy the glossary card's direct button,
  which this does. **Not taken:** it also said a `title` is not enough on touch to say the press is
  paid. The glossary card's button is the same, and Greg asked on 2026-10-03 for that card's foot to
  take less room, so no line was added; it is in the debrief as a choice.
- 2026-10-04: GPT Sol's code review, [261004b-code-review-sol.md](261004b-code-review-sol.md). It
  fixed two defects, each with a test it saw red. (1) On a narrow window the press could leave the
  Citations band hidden: a passage jump steps the band aside, and setting the mode it is already
  in does not bring it back; `dig` now clears `bandAway`
  ([postmortem](../postmortems/261004b-selecting-a-mode-does-not-reveal-its-hidden-band.md)).
  (2) A regenerated list inherited the old press's failure and no-match note, now that they outlive
  the band; they are cleared when the list's generation changes
  ([postmortem](../postmortems/261004b-longer-lived-results-need-a-generation-boundary.md)).
  It also narrowed the doc's claim about the dug row staying drawn: that holds while the panel is
  mounted, not for a dig that finishes with the band closed. **Reported, not fixed:** the glossary
  card has defect (1) too, from before this change; queued as qi-fs4qzzfm. And it repeated that a
  finger gets no visible word that the press is paid; left as the glossary card has it, and put to
  Greg in the debrief.
- 2026-10-04: browser check (Sonnet subagent, Playwright on the box, commit e5be1f9fc, so before the
  reviewer's two fixes; the paid POST intercepted and aborted, so nothing was spent). At 1440×900,
  834×1194 touch and 390×844 touch: the card has the button, 77×30px, on its own line at the foot's
  right, nothing clipped; one POST per press; the card closes; Citations opens with the row in view
  and *Digging deeper…* on it; another citation's button is disabled meanwhile; after the abort the
  row shows the failure and the buttons come back. With the bar raised to hide every row, the press
  lowered it from 0.80 to 0.76 and drew the row. **Not checked:** a signed-out visitor's card, for
  want of a public article with citation marks (a visitor has no marks by construction); and real
  WebKit. Shots: `261004b-shot-1` to `-6`.
- 2026-10-04: `git log` on citations and Debate: nothing has built this. fb-debate-2610 landed
  261003o (Reception and Claims) on dev at 4b4e5c4fb, which this worktree contains; it did not touch
  the citation card or `useCitations`.
