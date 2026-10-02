# Skim — a paper at increasing depth

A mode for going round a piece more than once, a little deeper each time: a handful of stops the
first time round, about a dozen the second, a larger share of the piece the third. The stops need
not come in the paper's order — the results first, say, and then a quick tour of the methods.

**Status (2026-09-29): built, out of Experimental, and a stored route is shown to visitors** — planning one stays owner-only — the plan is
[260928a](../plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md). This doc is the
vision; the plan is the build.

**Called Trajectory until 2026-10-01**, when Greg renamed it Skim (report spya-skxhcz) so that code,
UI, database and docs share one name — *"so that it's easy to grep, and there's less confusion for
an agent reading the code about what's what"*; the rename is
[261001r](../plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md). Greg's own words
below say Trajectory, and stay as he said them. Old `?mode=trajectory` links still open Skim, and
typing *Trajectory* in the command bar still finds it.

### What keeps the old name

A grep for `trajector` outside the historical folders should find only these, each on purpose:

- **The Commands keyword** — `"trajectory"` in `MODE_CATALOG.skim.aliases`
  ([`src/mode-catalog.ts`](../../src/mode-catalog.ts)), at Greg's request.
- **`RETIRED_MODES`: `trajectory → skim`**, beside `outline`/`hierarchy → structure`, so a bookmarked,
  shared or remembered `?mode=trajectory` opens Skim. Feedback from a tab loaded before the rename
  is normalised the same way (and its `job.step`, by a step alias), rather than refused.
- **The input-hash namespace `"trajectory-input\n"`** in `skimInputHash`. Changing it changes every
  hash, so every stored route would read stale.
- **The cost ledger.** `ai_calls` is append-only, so its historical rows keep `purpose` /
  `step_name` `'trajectory'`; a legacy alias in [`src/cost-categories.ts`](../../src/cost-categories.ts)
  counts them with `skim`.
- History: plan, postmortem and feedback file names, and the applied migrations.

## What shipped

v1, for the article's owner only, and behind the experimental switch until later on 2026-09-28
([experimental-features.md](experimental-features.md)):

- **The step**, `skim` ([`src/skim.ts`](../../src/skim.ts)): one small model call
  over the stored Quotes — their words, section paths and priorities, never the rest of the prose —
  that orders them into a route and gives each a depth and a short role line (a cue since v2,
  below). It refuses without
  Quotes; the band asks for both in one job when there are none.
- **The band** ([`SkimPanel.tsx`](../../src/web/SkimPanel.tsx),
  [`modes/skim/SkimMode.tsx`](../../src/web/modes/skim/SkimMode.tsx)): a
  pinned head with `‹ Stop k of N ›` and **Gist · More · Most** (only the depths that add stops),
  then the stops with their section paths and (since 260928e) their words, the role shown on the current row only. Until
  2026-09-29 a deeper pass also listed the shallower passes' stops, dimmed; since then each pass
  lists and walks only its own (below).
- **In the prose**: the current stop's quote is ringed and barred, brought into view on every
  step (centred since 2026-09-29, below), and followed by a **Next stop ›** door — *More detail ›*
  at the end of a pass, and nothing at the end of the deepest, since 2026-09-29, below. On a narrow window the band steps aside once a stop is
  chosen, and the door carries the walk.
- **Keys and address**: ← / → step the stops while the mode is open
  ([keyboard.md](keyboard.md) § ← / → in Skim); `?depth=` pushes and `?stop=`
  replaces ([url-state.md](url-state.md)). The rules for where a step or a depth change lands are
  one pure module, [`skim-route.ts`](../../src/web/skim-route.ts).

v2, the scrapbook, is built on top of that:

- **A cue instead of a role.** The same call now gives each stop one **cue**: at most 140
  characters, an instruction or a question naming what to *look for* in the passage, never what it
  found — *"Look for how rich-club membership changes the comparison."* It stands on its own and
  never mentions another stop, because a reader can arrive at a stop from anywhere. The current row
  shows it — above the quote since 2026-10-01, so the question comes before the passage it is asked
  of (Greg, `SPIDERYARN-READING2-8J`, plan 261001n) — and a route written before cues shows its old role instead (`PROMPT_VERSION`
  `trajectory/5` marks those as out of date).
- **The next stop's cue under the door.** Under **Next stop ›** in the prose, in small muted
  italics, so the door says where it leads.
- **The stop card**, under the current row only
  ([`stop-card.ts`](../../src/web/stop-card.ts) gathers it; the panel draws it). It holds whatever
  the other modes have **already** written about this paragraph:
  - the glossary terms it uses, as chips that open to a one-line sense and an icon into Glossary
    (a text link until 2026-09-29, below). They are found in the prose the reader sees, by the
    glossary's own matcher, over every term. A term an earlier stop on this pass also uses says
    *"also at stop k"*;
  - the ideas it bears on — links into Ideas until 2026-09-29, chips that open in place since;
  - where it sits in the study, as links into Timeline when that experimental control is available,
    and as text when it is hidden.

  The FAQ question the paragraph answers was there too, from 2026-09-28 until it was removed on
  2026-10-01 (below). An artefact that is stale contributes nothing. When nothing is there, there is
  no card, and no sentence asking you to make one. The card reads through read-only hooks
  (`useIdeasRead`, `useTimelineRead`, beside `useGlossaryRead`), so it cannot start a run. Nothing on
  it is generated for it: what ties the pieces together is seeing them side by side, not a new
  summary of them.

Stage 5, asked for by Greg on 2026-09-28 (his words are in the
[plan § Stage 5](../plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md)):

- **A flash on every arrival** — ‹ ›, ← →, the door, and a depth change that
  moves you all go through one helper that scrolls to the stop and flashes it with
  [`flashBlock`](../../src/web/flash.ts) once the scroll settles, and on a narrow window steps the
  band aside. A row press is a jump and flashes through `beginJump`, once. A `?stop=` link scrolls
  to its stop and flashes it once when the band opens, leaving the band open. A depth change that
  keeps your stop does nothing. This is the named exception to flash.ts's "stepping does not
  flash": the route is out of paper order, so each step is a jump across the article.
- **Where each stop sits**: a thin muted track with a dot on every row (vertical, under the number, since 2026-09-29 — below), the same on each, so
  the dots zig-zag down the list as the route jumps about. The dot is at the stop's position in
  words (`positionOf` in [`skim-route.ts`](../../src/web/skim-route.ts)); the current
  row's dot is in the accent. A screen reader hears "about 70% of the way through".
- **Further left in the bar**: Quotes, then Skim, straight after Summary (`MODES_UI` in
  [`Dock.tsx`](../../src/web/Dock.tsx)).
- **Plan it again** rebuilds the route only (`skim` is forced by name). **Since 2026-09-29 it
  is offered only in the stale and profile-changed banners**; the standing button in the foot went,
  and a current route is re-planned from Metadata's *AI processing*, which has a Skim
  row ([260929b](../plans/260929b-one-place-to-re-run-ai-processing.md)). A route planned by an
  older prompt over the same article (*outdated*) is not announced at all — Greg, 2026-09-29
  (SPIDERYARN-READING2-55): *"There are probably lots of cases where the prompt will get out of
  date, and it's not worth bugging the user about it."*
  ([260929c](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md)). Greg on the
  foot's button:

  > In Trajectory mode, remove the "Plan it again" button. The user can do that from Metadata if they
  > really want.
  >
  > — Greg, 2026-09-29

  **Stale Quotes are chosen again first**, on the automatic run and on the banner's button, as missing
  ones always were — unforced, so current Quotes cost nothing — and the empty state says when they
  will be. The Metadata row names only `skim`, so it never buys Quotes or Ideas, and refuses
  in the row when there are no Quotes.

Stage 6 ([plan § Stage 6](../plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md)),
written under `trajectory/7` and unchanged in `skim/8` (whose request adds a strict JSON schema):

- **The route sees the Ideas and the outline.** The call is also given the article's Ideas
  (`I1…`, name and statement) and its top-level sections (title, gist where there is one), fenced
  as data. Which Ideas each quote *carries* (same block) or sits *beside* (the nearest body
  paragraph either side, same top-level section) is worked out in code, never by the model. It is
  asked to cover as many Ideas as the quotes allow at each pass. Stops are still quotes only.
- **It waits for the Ideas.** The automatic run and *Plan it again* find the Ideas first, in the
  same job, when they are missing or stale; the empty state says so before the press, and that
  finding them is the long part. The job's end refreshes the stop card's Ideas.
- **One input hash** (`skimInputHash`) over exactly what the prompt renders is both the stamp
  and the read's freshness check, so regenerated Ideas, or Ideas arriving after a route planned
  without them, mark the route stale.
- **The abstract is left out.** Greg, 2026-09-28: *"Slight tweak to Trajectory mode - prefer not to
  include the Abstract as part of a trajectory, since that's kinda obviously already a good place to
  get the gist, and it's dense."* A quote under a section titled *Abstract* (at any level of its
  path, numbering and case ignored), or an opening *Executive Summary*, is never offered
  (`inAbstract` in `src/skim.ts`), and the prompt says why briefly. Plain *Summary*
  needs stronger evidence: either it is under *Front Matter*, or it is the opening top-level section
  immediately before *Introduction*. That keeps an essay's introductory *Summary* on the route. An
  untitled or non-English abstract is not detected. Excluded quotes count in neither `notOnRoute`
  nor the Most pass's denominator.

**Every row shows its quote's words**
([plan 260928e](../plans/260928e-trajectory-rows-show-the-quote-words.md)), from a report of Greg's
on 2026-09-28: *"include summarised and/or truncated version (with tooltip for full version) of the
quote itself in the left-hand column, not just the double-quotes symbol"*. The words are the Quote's
own, cut at about 100 characters with the whole of them in a tooltip; the current row shows them
whole, which is also what a tap reaches on touch. The `〃` that stood for a repeated section path is
gone — beside a quotation it read as another quotation mark — and a repeated path is now said to a
screen reader only. A model-written summary per stop is deferred, with the reason, in the plan.

**Four reports of Greg's, 2026-09-29**
([plan 260929a](../plans/260929a-trajectory-opens-on-stop-one-two-end-of-pass-doors-centred-jumps-compact-position.md),
his words quoted there):

- **Opening the mode goes to its stop** (SPIDERYARN-READING2-4K). Switching into Skim by
  pressing something, or opening a Skim link that names no stop and no position, jumps to the
  band's current stop — stop 1 on a fresh opening, or where you had got to if you left the mode and
  came back. It is a real jump, so the **↩ Back to …** chip offers the way home if that was not what
  you wanted ([url-state.md](url-state.md#the-pushed-entry-says-where-you-came-from)). That makes
  two history entries, the mode and then the jump: the first Back returns you to where you were and
  keeps Skim open, the second leaves it. Back or Forward *into* Skim never jumps — that
  restores an entry. A `?stop=` link arrives at its stop without a push, as before, and one whose
  stop has gone arrives at stop 1. **← on stop 1** goes to stop 1 again ([keyboard.md](keyboard.md)).
- **Two doors at the end of a pass** (SPIDERYARN-READING2-4N): **Go round again**, to stop 1 of the
  same pass, and **More detail ›**, to stop 1 of the next deeper pass — offered only when there is
  one, so the end of *Most* offers going round again alone. Under them, *End of Gist — 5 stops.* The
  depth buttons in the head no longer go round when pressed on the last stop: a depth change always
  keeps your place (until 260929e, below, when it began landing on stop 1 of the new pass), and going round is the doors' job. *Go round again* went later the same day
  (SPIDERYARN-READING2-51, below).
- **Every arrival is centred** (SPIDERYARN-READING2-4M) — the stop's quote in the middle of the
  window, so you see what is round it; a quote too tall to centre goes to the top. This is every
  block link in the app, not only Skim: [url-state.md § A jump lands centred](url-state.md).
- **The position mark is a short vertical line under the row's number** (SPIDERYARN-READING2-4D) —
  top the start of the article, bottom its end, as the spine draws it — instead of a horizontal
  track with a column of its own, which took about 53px of a band that can be 280px wide.

**Three more of Greg's, 2026-09-29**
([plan 260929b](../plans/260929b-trajectory-deeper-passes-one-door-promise-in-a-tooltip-list-follows-the-stop.md),
his words quoted there):

- **One door at the end of a pass** (SPIDERYARN-READING2-51): *Go round again* is gone, *More
  detail ›* stays, and the end of the deepest pass has no button, only the line saying which pass
  ended. ← walks back, and ← on stop 1 goes to its passage.
- **The promise is a tooltip** (SPIDERYARN-READING2-52): the two sentences that were the foot —
  where the passages come from, and at Most how many of the Quotes it walks — moved first to an info
  button at the right of the pinned head, then on 2026-10-01 to the (i) in the band's top-right
  corner with the rest of the mode's information. Hover, focus or a tap opens it. The foot is gone
  too, bar a job's progress or failure while one runs — see *Plan it again* above.
- **The list follows the stop** (SPIDERYARN-READING2-54): whatever moves the current stop, the
  band's own list scrolls just enough to show its row — Summary's `useFollow`
  ([`follow.ts`](../../src/web/follow.ts)), which moves that scroller and never the page — and
  measures again when a band that stepped aside on a narrow window comes back.

**Each pass walks only its own stops** — Greg's SPIDERYARN-READING2-4P, 2026-09-29
([plan 260929e](../plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md), which quotes
the whole report):

> In Trajectory mode, it's a bit annoying for the more detailed levels of granularity to reuse the
> same snippets as the coarser levels if I've just read the coarser level. [...] The main thing is
> to ensure that there's diversity within levels, and perhaps ideally between them.
>
> — Greg, 2026-09-29

Measured first, on the six local routes: 43% of the More walk and 46% of the Most walk were stops
the reader had just stood at, because the passes contained one another. Within a pass, a strict
read found no two stops making the same point at Gist or More, and three adjacent pairs in 56 at
Most. So:

- **Gist walks the depth-1 stops, More the depth-2 ones, Most the depth-3 ones.** The list, `Stop k
  of N`, ← / →, the door and the depth buttons' counts are all the pass's own. No row is dimmed any
  more, because no row is from another pass. **More and Most are what the passes before them left
  out, not skims that stand alone** — a reader who opens More without Gist gets only More's stops.
  Greg: *"I suppose it's possible that a user might jump straight to the more detailed levels...
  but I suspect they won't."*
- **A depth change lands on stop 1 of the new pass**, as *More detail ›* does, and moves the reader
  there. It used to keep your stop, which a deeper pass then contained.
- **A link's `?stop=` wins over its `?depth=`**: the stop's own pass is drawn, so a link from before
  this change still arrives at its stop.
- **The route and its prompt are unchanged.** The model still plans the passes as nesting — depth 2
  covering Gist and More — which is the allocation wanted either way; `visibleCounts` (src/skim.ts) still
  counts that way. The prompt's description was left alone because 260929b measured the "the reader
  has read the earlier pass" framing with no gain. Longer snippets at deeper passes, Summary or
  Glossary stops at the coarser ones, and variety within Most are deferred in the plan.

**Snippets that open in place, a route sparkline, and a "where am I" card** — two reports of
Greg's, 2026-09-29, SPIDERYARN-READING2-59 and 5C
([plan 260929f](../plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md), which
quotes both whole):

> I'm increasingly thinking of the trajectory mode as one of the main modes, and that I'd mostly
> stay within it. [...] so that I can stay in trajectory mode and access almost everything that I'd
> want to for the snippets.
>
> — Greg, 2026-09-29

- **Ideas open in place**, as the terms do: a chip opens the idea's statement under it. One snippet
  is open at a time across the stop — a term, an idea or (until 2026-10-01) a question — and
  stepping on closes it.
- **The FAQ question goes first** (removed altogether on 2026-10-01, below). It was on the card
  under the quote, where it read as an afterthought; it moved above the row, with FAQ's icon. Its tooltip says what it is: a question
  the FAQ wrote, which the FAQ pairs with a passage in this paragraph — the model's reading, and
  pairing by paragraph, so FAQ's words there may not be the stop's quote. Pressing it opens every
  passage FAQ points to for it, with their sections: FAQ answers only in the article's own words.
- **Navigation is an icon with a tooltip.** *In the glossary ›* became the Glossary icon; Ideas and
  FAQ are opened the same way, each by its own mode's icon — the rule is now in
  [icons.md § Navigation](icons.md#navigation-an-icon-with-a-tooltip-not-a-text-label).
- **A sparkline instead of "Stop k of N".** One dot per stop of the pass, left to right in walking
  order, each at its height in the article; walked dots filled, the current one in the accent. It
  is a button: its tooltip says *Stop k of N · about P% through the article*, and a screen reader
  still hears the count on every step. With the words gone, the depth buttons share its row where
  the band is wide enough, and wrap under it where it is not.

**The old (i) shared the controls' row; ‹ › name their keys** — Greg, 2026-09-30,
SPIDERYARN-READING2-73 and -74 ([plan 260930h](../plans/260930h-trajectory-info-button-on-the-controls-row-and-shortcut-keys-in-tooltips.md)).
In the 400px band the (i) had been overflowing the head by about 13px, onto a row of its own. The
head's gaps were tightened and the (i) travelled with the depth buttons until the band-wide corner
(i) replaced it on 2026-10-01. The arrows, and the door's *Next stop ›*, have hover and focus cards
that say what they do and name ← or →; a finger's tap still steps at once. The rule behind that is
[tooltips.md § A shortcut is named on its card](tooltips.md#a-shortcut-is-named-on-its-card).
- **Where am I.** Each row's position mark is also a button, whose tooltip is a small fisheye of the
  article's outline: the top-level sections, and down the path to this stop's section with its near
  neighbours, the section you are in marked. It is one component (`WhereCard` over `whereRows` in
  [`where.ts`](../../src/web/where.ts)), generic over the outline's shape so that the spine can use
  it too; **the spine does not yet**, because its hover cards need a shorter, node-based version
  first (the plan's *Deferred*).

**The route says what it was planned for** — Greg, 2026-09-30, SPIDERYARN-READING2-60
([plan 260930e](../plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md),
which quotes it whole): *"people want to come with an intent … maybe there's a single extra
trajectory that's added that's specific to their reading intent if they provided one."* The route
was already shaped by the article's purpose; now the owner can see which one. Over a ready route,
one quiet line: *Reading for: …*, the whole sentence in a tooltip, and **Edit** into Metadata. With
no purpose, a small box, *What do you want from this piece?*, and **Plan the route for this**, which
saves the purpose and only then re-plans the route (unforced — the stamp's profile hash is what
re-plans it). **Not in the empty state**: the automatic run plans one there, and a second request
with a different profile would not de-duplicate. Nothing for a visitor, nothing while the purpose
cannot be read, and no second ask under the stale or profile-changed banner.
[`SkimPurpose.tsx`](../../src/web/SkimPurpose.tsx).

**Quiz questions at a stop are the prose's, not the card's** — Greg, 2026-09-30,
SPIDERYARN-READING2-6V (*"we could reuse that in trajectory mode somehow"*). Quiz questions are now
drawn in the prose in every mode ([quiz.md § In the prose](quiz.md)), after their passage, so at a
stop with one it sits between the passage and **Next stop ›** — the cue asks what to look for before
you read, the question what you took after. Nothing was added to the card or the route: on the card
the question repeated the cue, and a question as its own stop would braid a second ordered path into
the route. Both, and the pass's questions at the end of a pass, are deferred in
[260930i](../plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md).

**The FAQ question at a stop is gone** — Greg, 2026-10-01, SPIDERYARN-READING2-8Z (report
spya-bjbcxp): *"Remove the FAQ snippets (they don't add much)"*. The question above the current
row, and the passages it opened, were removed, and Skim no longer reads the FAQ at all. The
terms, ideas and events on the card stay, and so does the cue above the quote, which is a different
thing: the question to read the passage with.

### What we tried for v2

Three static mockups, on real data from the entropy paper
([plan § Stage 3 in detail](../plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md)):

- **The stop card** ([screenshot](../plans/260928a-trajectory-scrapbook-spike-stop-card.png)) — what
  was built, trimmed. The section's gist was dropped because it gave the finding away, and the
  quote's reason because it repeated the role.
- **The skim sheet** ([screenshot](../plans/260928a-trajectory-scrapbook-spike-skim-sheet.png)) — one
  page per depth, a card per stop. It felt most like a scrapbook, and it was also the most readable
  *replacement* for the paper. **Kept for later**, as a toggle over the same data.
- **Threaded** ([screenshot](../plans/260928a-trajectory-scrapbook-spike-threaded.png)) — the card
  plus a generated line per stop saying how it follows the one before. It tied the pieces together
  best. **The relational line was deferred** after GPT Sol's review (F18): one stop at one depth can
  be reached from several places — a deep link, going round again, pressing a row, Back — so a line
  about "the previous stop" would be false about half the time. Doing it properly needs a line per
  actual step from one stop to another, shown only when that is the step the reader took. The
  context-free cue is what survived of it.

## What Greg asked for

Dictated on 2026-09-28 and lightly transcribed from speech, so it keeps the repeats and false starts
of talking — including one paragraph said twice. It is kept whole on purpose: this is the idea as he
had it, before anyone tidied it.

> Okay, this is a bit less well specified as an idea. I want to create a new mode. I don't know whether to call it spiral mode or trajectory mode. Let's go with trajectory mode for now.
>
> And the idea is that it would help me skim a paper efficiently at multiple levels of granularity. So the first time I run it, maybe it would only show me a few sections. I don't know, at most a handful. If I read those, it would give me a gist of the most important ideas.
>
> And then maybe I could dial it up to be like, okay, I want to go round again, but this time in a bit more detail. Show me more. And so it would perhaps take me through, I don't know, a dozen blocks. And then maybe there's a third level of granularity that takes me through a bigger proportion of the paper.
>
> And so I don't know what this would look like. Maybe it's a mode with sort of forward and back. buttons and a slider for granularity. It would maybe I can also use left and right to trigger the forward and backward buttons to jump to the next sections. Now importantly, I think it's okay for the trajectory mode to show me stuff that is not in the order it's presented in the paper.
>
> So it may be that you start with, I don't know, the conclusions. So you start with the results. And then a quick tour through the methods or something. I don't know, it might vary from paper to paper.
>
> I think that's the key idea. So in the ideal world, it would take into account the information that the user has provided in their profile. And then it might vary from paper to paper. I think that's the key idea.
>
> So in the ideal world, it would take into account the information that the user has provided in their profile. Profile and or in the metadata for the paper about their intentions and that that would guide what the trajectory should be if that's been provided. So if I've said, look, what I'm most interested in is understanding how this paper differs from, you know, some other paper or is new in the literature, then that might, you know, and I'm already an expert in this field, that might change the trajectory that you choose to display.
>
> It might also mean that you need to do some web searching, though that would complicate it. I know we have tools for doing that in the chat, so we could reuse those. Maybe that's a version two. I think it would be nice to reuse as much of the existing machinery as we have.
>
> So we've got the quotes and a bunch of metadata that effectively highlight bits of the paper. That would be an obvious place to start in terms of like those are presumably relevant and central and, you know, maybe it's a trajectory through quotes so that we don't have multiple metadata annotations of the paper that are all kind of similar.
>
> So let's try and have one reusable set of highlights that we think are most important. We also reuse the glossary and the summaries. And so actually, I think this is another thing that I dream of is that, you know, this might be eventually not just a way of jumping through sections, but also gathering extra metadata and snippets and stuff.
>
> And so we've got to see the results that we've generated that together create a kind of scrapbook, miscellaneous set of materials that really help the user to skim through the paper as effectively as possible in increasing depth. But again, maybe that's overcomplicating things for now. Anyway, so I'd like you to capture pretty much all of these thoughts verbatim somewhere in a vision document for the trajectory mode.
>
> And for now, use the engineering manager to proceed autonomously to build at least a version one and maybe even a version two if you feel confident delegating this to a new agent. I think gather all your questions in that document. But for now, just proceed autonomously and do your best job.
>
> I won't be able to answer any more questions for now.
>
> — Greg, 2026-09-28

## The core idea, as we read it

**One route through the piece, walked at three depths.** The first pass is the gist: about five
passages, chosen so that reading only those tells you what the piece found and why it matters. The
second pass walks the same route with more stops on it — about a dozen — and the third walks it
again with enough stops to cover a real share of the piece. You read the passages themselves, in the
article; the mode only chooses where to stand and in what order.

Three things follow from Greg's words and they shape everything below:

- **It is still reading.** A stop is a passage of the article, drawn in the prose where it sits,
  not a summary of it. That is [vision.md](vision.md)'s whole argument — augment the reading, do not
  replace it — and it is why the mode's own generated text is one short line per stop naming *what
  the passage does* ("the headline result", "how they measured it"), never what it found.
- **The order is the mode's, not the paper's.** A paper is written in the order it was done;
  somebody skimming wants it in the order that makes sense fastest. So the route can start at the
  results and loop back to the methods, and it can differ from paper to paper.
- ~~**Going round again keeps what you already read.** The second pass contains the first pass's
  stops, in the same order, with more between them; the third contains the second. That is what
  makes it a spiral rather than three unrelated lists — you never lose your place when you turn the
  depth up, because the stop you are on is still there.~~ **Reversed 2026-09-29**: walking the
  first pass's stops again at the second was the thing Greg found annoying, so each pass now walks
  only the stops it adds (above, under *Each pass walks only its own stops*). The route is still
  one order, planned as nesting passes; only the walk changed.

**Who is reading changes the route.** When the reader has said who they are
([reader-profile.md](reader-profile.md) — *About you*) or why they are reading this piece (the
article's *Why you're reading this one*), the route is chosen for that: an expert reading to see
what is new goes to the contribution and the comparison with earlier work first, and skips the
textbook background. With neither, the default is a first-time reader who wants the main point
first.

**One set of highlights, not another.** Greg does not want a fourth near-identical annotation of the
piece beside Quotes, Ideas and the summaries — *"maybe it's a trajectory through quotes"*. So it is
one: **the stops are the article's Quotes**, the lines Quotes mode already chose, checked and marked in
the prose. What Skim adds is only an **order** and a **depth** for each quote, and a short role
line. If a piece has no Quotes yet, opening Skim makes them first. The design that was
considered and dropped — a fresh selection of passages from the whole article — and why, are in the
plan's *The versions not built*.

The cost of that choice is **coverage**: the route can only stop where Quotes stopped, and a methods
paragraph is rarely quotable. When that shows, the fix is to Quotes, so that the one shared set gets
better for every mode that reads it.

## Version one

- A **Skim** button in every owner's mode bar (behind the experimental switch only on the
  day it first shipped, 2026-09-28).
- Opening it for the first time makes one small model call that puts the article's Quotes in a route
  and gives each a depth, written once and stored. If there are no Quotes yet, they are made first.
- The band shows **Stop 3 of 5**, a **‹ ›** pair, and a three-step depth control, **Gist · More ·
  Most**, with the number of stops on each. Below it are the stops of the current depth, each with
  the section it is in; the current one also shows its role line, stops from an earlier pass were
  dimmed (until 2026-09-29, when each pass became only its own stops), and pressing one goes to it.
- The current stop's passage is marked in the prose and scrolled to near the top, with a **Next
  stop ›** door after it — on an iPad your thumb is in the prose, not the band. At the end of a pass
  the door offers to go round again, one depth deeper.
- **← and →** step to the previous and next stop while Skim is open (↑ and ↓ stay the
  article's, [keyboard.md](keyboard.md)).
- The reader's profile and the article's *why you're reading this* shape the route when they exist.

## Version two: the scrapbook

> Re Trajectory:
> - Yes, Experimental only for now
> - And for v2, I'd say the scrapbook (that can draw on useful stuff from any other modes that you
>   think might be useful if they've already run) is more important than the web search. I'd also
>   encourage the agent to experiment with new UI or short generated snippets that might help tie
>   together the disparate elements. This scrapbook aspect is the thing I'm most excited to
>   experiment with.
>
> — Greg, 2026-09-28, answering two questions from this build

**The scrapbook is v2, and it is a real stage, not a maybe.** Beside each stop, gathered from
whatever the other modes have *already* produced for this article — quotes inside the passage, the
glossary terms it uses, the ideas it bears on, the gist of the section it sits in, timeline events,
citations, FAQ questions it answers (tried, and removed on 2026-10-01), and so on. It does not start new runs of those modes by
default; it shows what is there. Everything in it is already addressed by block id, so gathering it
is a lookup.

Greg asks for experiment here: new UI, and **short generated snippets that tie the disparate pieces
together**. So v2 tries more than one shape and picks with evidence; what was tried, and what was
chosen, is written below when it lands.

## Decided

- ~~**Behind the experimental switch, for now**~~ — Greg, 2026-09-28, above; **reversed the same day**:
  *"take Trajectory and Quotes modes out of Experimental features, i.e. into mainstream features."*
  The button is in every owner's bar. A visitor to a public article sees a route that has already
  been planned, from the page's own payload, and cannot plan one — since 2026-09-29, when Greg found
  the explanatory band refusing a stored route (SPIDERYARN-READING2-56,
  [260929c](../plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md))
  ([experimental-features.md](experimental-features.md)).
- **v2 is the scrapbook, not web search** — Greg, 2026-09-28, above.

## Later

1. **Where it sits in the literature** — a web search for how this paper differs from earlier work,
   reusing chat's web tools ([chat-tools.md](chat-tools.md)), feeding the route for a reader who has
   said that is what they want. It costs a search per paper, the results are not in the article,
   and [Debate](../plans/260905f-debate-mode-what-the-web-says-about-this-piece.md) already goes to
   the web for what others say about a piece — the two would want to share rather than duplicate.
   Until then, a reader whose stated purpose is "how is this different from X" gets a route that
   leans on what the paper itself says about earlier work, and no more.
2. **Quotes as the stops** — see the plan's *Reuse* section for why v1 does not do this, and what
   would change our mind.

## Questions for Greg

Each of these was decided by default so the work could go on. Every one is cheap to change. More
are added as the build goes; the plan's Progress section has the order things happened in.

### 1. Should the stops be the Quotes, or a fresh choice of passages?

**Background.** A stop has to be *some* passage of the article. There were two ways to get them. The
first is to reuse the lines Quotes mode already picks — its "lines worth keeping", each checked
against the article and already marked in the prose. The second is a new model pass over the whole
article that picks its own passages for the route.

- **Quotes (built).** One set of highlights shared by both modes, as you asked. Skim only adds
  an order, a depth and a short role line, so its model call is small and cheap. The cost is
  coverage: the route can only stop where Quotes stopped, and a plain methods paragraph with nothing
  quotable in it cannot be a stop. A piece with no Quotes gets them made first, which is Quotes'
  usual cost plus a few seconds.
- **A fresh choice.** It could stop anywhere, including that methods paragraph. But it is a second,
  near-identical set of highlights beside Quotes, and it needs a call over the whole article.

**How to choose.** Use it on a few papers. If the route keeps skipping parts you wanted to see, say
so. The first fix to try is to make Quotes cover every major section, which improves both modes.
Only if that fails would a second set be worth it.

### 2. The one generated line per stop: a cue, or a thread?

**Background.** Each stop gets one short generated line, shown on the current stop and, in small
italics, under the **Next stop ›** door, so the door says where it leads. v1 wrote a *role* (what
the passage does: "The headline result"). v2 writes a **cue** instead, at most 140 characters, saying
what to look for in the passage ("Look for how rich-club membership changes the comparison"). Like
the role, it never says what the passage found.

**The option we tried and did not build: a thread.** This was a line tying each stop to the one
before it ("From the definition to real recordings — note the number"). In the spike it did the most
to make the route feel like one walk (spike C, linked above). It was dropped because a reader
reaches a stop from many places — a link, a row press, a depth change, Back — so a line about
"the previous stop" is often about a stop they never came from. Doing it properly means one line per
step between two stops, shown only when that is the step you actually took: more lines and more
cost, for a sentence that is sometimes absent.

**Options.** The cue (default taken); the thread, done properly; or no line at all, leaving just
the section name.

**How to choose.** If the route feels like a pile of separate stops rather than one walk, the thread
is what would fix that. One thing already visible in the first real runs: 26 of 30 cues begin
*"Look for …"*, so they read like a checklist. A one-line prompt nudge towards variety is cheap if
that grates.

### 3. Three buttons, not a slider

You said "maybe … a slider". There are exactly three depths, so the control is three buttons —
**Gist · More · Most** — each showing how many stops it has. Three buttons are easier to hit on an
iPad than a slider's thumb, and they do the same job. If you want an actual slider, it is a small
change.

### 4. The route appears all at once, not streamed

The house rule is to stream anything a reader waits on. The ordering call is small (seconds), and
the route is only usable once it has been checked as a whole: half a route would be reordered under
you as the rest arrived. So the job shows its progress and the route appears complete. When Quotes
have to be made first, that wait is Quotes', and Quotes stream. Streaming stops one at a time is
possible later if the wait turns out to matter.

### 5. A route built before you wrote a profile goes out of date once you have one

Elsewhere in the app, an artefact made before you had a profile is left alone when you add one. A
route is the thing a profile most obviously should change, and it is cheap to rebuild (about two
cents), so Skim marks a route as out of date when the profile changes in either direction —
including "none → a profile" — and the band offers a rebuild. It does not rebuild by itself. Say if
either half surprises you.

### 6. Should Quotes be made to cover every part of the paper?

**Background.** Because the stops are the Quotes, the route can only go where Quotes went. On the
three test articles, the deepest pass (Most) covered 19–32% of a paper's words, not the "bigger
proportion" you described. One paper's biggest section, nearly half its words, had only four quotes,
and another had a whole section with none. Quotes picks lines worth *keeping*; a plain methods
paragraph rarely is one.

**Options.**

- **Leave Quotes alone** (default taken). Skim v1 goes where Quotes go, and Most is a partial
  tour.
- **Ask Quotes to cover every major section** — one sentence in its prompt. Both modes change: the
  Quotes list gets longer and more even, and some quotes will be less striking.
- **Let Skim add its own stops** where Quotes left a gap — back towards a second set of
  highlights, which is what you asked us to avoid.

**How to choose.** Try Most on a paper you know. If it skips the part you would have wanted, the
second option is the one to try, and it is a small change.

**What happened next (2026-09-28).** You answered: *"It might make sense to make a minimal update
to Quotes to increase representativeness a bit more widely across sections — And/or allow Summary
content as another kind of content? Or just plain blocklinks to important sections?"* Each was
measured on the three test articles before anything was kept
([plan § Stage 6](../plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md)):

- **The route now reads the Ideas and the outline (kept).** It sees which quotes carry which of the
  article's Ideas, and aims each pass at covering as many as it can. Gist now lands on 7 of the
  three articles' 21 Ideas, against 5 before, the same in both runs of each; More gains a little;
  Most cannot change, because at Most every quote is already a stop. About half a cent more per
  route. A fresh article now makes its Ideas before the route, which is the longer wait.
- **The Quotes nudge (not kept).** One added sentence asking Quotes to cover the main sections, run
  twice against the current prompt run twice: no better than the current prompt's own run-to-run
  noise, and slightly worse on Ideas. Quotes' prompt is unchanged, so no existing Quotes went out of date.
- **Section stops and a summary line (not built, for now).** The top-level sections with no quote
  on the three articles are *Notes*, *Front Matter*, *Article overview* and one real one, the
  entropy paper's *Future Directions*. One section in three papers did not justify a second kind of
  stop, and the gist line was the thing the scrapbook spike dropped for giving the finding away. If
  real reading keeps meeting a skipped section, a plain link to its opening passage is the next step.

### 7. Should opening Skim also make the Glossary and Timeline?

**What you asked.** *"If there are other modes that should also run first as part of generating
Trajectory, queue them first too."* (2026-09-28). The Overseer read that as: when Skim is
first opened, also start Glossary, Ideas, FAQ and Timeline for the article if they have not been
made, so the card under each stop has something in it. **Only part of that was built, so this is
yours to decide.** FAQ has dropped out of it: the card stopped showing the FAQ's question on
2026-10-01, so making the FAQ would no longer fill anything in.

**Background.** Two different things use the other modes:

- **The route itself** — which quotes to stop at, in what order. Since stage 6 this reads the
  article's **Ideas**, so each pass covers as many key points as it can. So Ideas now *are* made
  first, in the same job as the Quotes and the route. That part of your request is done.
- **The card under the current stop** — the terms the passage uses (Glossary), the ideas it bears on
  (Ideas), where it sits in the study (Timeline). Today the card shows whatever of these already
  exists, and simply leaves out what does not. It never starts a run.

The question is whether opening Skim should also **make Glossary and Timeline** when they are
missing, purely so the card fills in.

**Why it was not built.** Nothing was broken. It was left out because:

- **Cost to the reader, on a press they did not make for it.** On the entropy paper, Glossary, FAQ and
  Timeline together cost about $0.20 (measured before FAQ dropped out), against about $0.02 for the
  route. A first open from nothing
  is already $0.13 and 95 seconds with Quotes and Ideas (measured on *Cargo Cult Science*); this would
  roughly double or triple the spend, for modes the reader did not open.
- **Your words were "run first as part of generating Trajectory"**, and these three do not generate
  it: the route never reads them. GPT Sol and an Opus arbiter both read the sentence that way.
- **It needs extra machinery**: a second job, and a way for the card to notice when each of those
  finishes (the read it uses today does not). Timeline is also still behind the experimental
  switch, so for most readers only Glossary would run anyway.

**Options.**

- **A. As it is now** (default taken). The route makes what it needs (Quotes, Ideas); the card
  shows whatever else exists. Nothing extra is spent. On a fresh article the card has ideas but no
  terms or events until the reader opens those modes.
- **B. Make them automatically on the first open**, as the Overseer read your request: Glossary for
  everyone, Timeline for readers with the switch on. About $0.10–0.20 more per article, said
  in the empty state before the press, and the card fills in over the next minute or two. The route
  does not wait for them.
- **C. A button on the card: "Fill in the card"**, which makes the missing ones on request and says
  what it will cost first. Nothing is spent unless the reader asks.

**How to choose.** If you want the card to be rich every time without thinking about it, B. If you
would rather nobody pays for modes they did not open, A, or C to let them choose. **Recommended: C**
— it gets you the full card when you want it, keeps the rule that a press only buys what it says,
and is a small build.

---

Up: [reading-view-overview.md](reading-view-overview.md)
