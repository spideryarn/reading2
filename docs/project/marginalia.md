# Marginalia

Up: [reading-view-overview.md](reading-view-overview.md)

The column of notes to the right of the prose, each level with the block it is about. Its address is
`?margin=1`, and it stands beside whichever band is open. Where this is meant to go is
[interface-vision.md](interface-vision.md): the right column is for what is anchored to the text.

The code is [`src/web/marginalia/`](../../src/web/marginalia/): [`notes.ts`](../../src/web/marginalia/notes.ts) decides which note goes beside which block (pure, and
tested in [`tests/marginalia-notes.test.ts`](../../tests/marginalia-notes.test.ts)), [`MarginaliaColumn.tsx`](../../src/web/marginalia/MarginaliaColumn.tsx) draws them and the head,
[`tips.ts`](../../src/web/marginalia/tips.ts) holds every note's card, and
[`press.ts`](../../src/web/marginalia/press.ts) decides what the Dock button does on a narrow window.

**The block's gutter of icons sits between the prose and the notes.** It moved to the right of the
block on 2026-10-03 ([261003c](../plans/261003c-block-gutter-icons-move-to-the-right-of-the-block.md)),
into the reading cell's right padding; a note starts past the cell's edge, so the order across the
page is prose, icons, then the note, with at least `--blk-gutter-x + --marg-gap` between the icons
and a note's words. Nothing in the column's arithmetic (`fitMargin`, `--marg-reserve`) changed,
because the two pads only swapped sides.

## What it shows

**It has one call of its own**, which generates relation words ([below](#relation-words)) and,
since 2026-10-11, may add **a few notes of its own** ([§ Notes the model
writes](#notes-the-model-writes)). Every other note
comes from something another mode has already stored, and opening the column never runs another
mode. The owner's lists are read through each mode's *read half*
(`useIdeasRead`, `useFaqRead`, `useTimelineRead`, `useReceptionRead`), never the full mode hook, because the full hook
can start a run on its own. `tests/artefact-read-hooks.test.tsx` checks that the read halves only
read. A visitor's lists come in their payload.

**So a FAQ, Timeline, Debate or Ideas list made later still reaches the owner's margin, and nothing is run for it.**
The column keeps no copy of these lists: it reads them every time it opens, and while it is open
it re-reads them when this tab's job engine announces a completion for them — the same feed each
band listens to, through
`useStepFinished` (`src/web/useStepJob.ts`), which is quiet and adds no polling. Bibliography comes
through the Reader's shared read instead, which listens the same way, so an announced Bibliography
completion after the reader has left its band reaches the margin too (as do Glossary's and Quotes'
reads, for the prose marks). Greg had asked for missing modes to be run when Marginalia opens, if a later
one would otherwise be missed; it would not be, so it is not
([interface-vision.md § Tensions](interface-vision.md#tensions-from-the-feedback-so-far),
[261002d](../plans/261002d-marginalia-refreshes-when-a-mode-it-reads-finishes.md),
`tests/marginalia-live-refresh.test.tsx`).

- **A relation word** (*so*, *but*, *vs*) beside a paragraph where the argument turns —
  [§ Relation words](#relation-words).
- **A note the model chose to write**, open, under the word: *Tension*, *Recall* or *Note*, a
  sentence or two, and a link to the other passage where there is one —
  [§ Notes the model writes](#notes-the-model-writes).
- **The head**, pinned at the top: which part and section you are in, and the arc's sentence for
  where the argument has got to. It has a rule under it so it does not read as one more note (Greg,
  spya-rczgjb). Uncovered rows above the first part (a title, a byline) name the first part, so it is not
  empty at the very top; in a gap the tree does not cover further down it draws nothing
  (`src/web/marginalia/notes.ts` § `headBlock`). While it is on screen the headings breadcrumb in the top bar is not drawn
  ([experimental-features.md](experimental-features.md#what-is-behind-it-today)).
- **Each part's Socratic question**, beside the part's first real paragraph.
- **An idea stamp** ("assumes", "introduces") where each idea first occurs.
- **Other modes' items, shut by default**: FAQ questions, Timeline's dated events, Debate's claim rows, Bibliography works and comments
  (the owner's on a shared article; a bookmark with no words stays a mark in the gutter). Each block gets at most one line of each kind.
  One item shows its title; several show a count ("3 works"). Pressing the line opens the supporting
  quote and remaining-passage count for FAQ, the source quote and bearing for Debate, the byline and
  reference entry for a citation (not the model's reason, since 261003j) and, where there is one,
  the checked note on what the work says from its abstract, the Sources band's own `CiteBlurb`
  (since 2026-10-18, [261018i](../plans/261018i-marginalia-notes-that-save-a-click.md)), or, for a comment, the
  first lines of its AI answer. A lone comment's own words are its line and are not said again
  underneath: pressing a comment with no answer only lets a long line wrap (Greg, `spya-a0wpv4`;
  [261006i](../plans/261006i-a-lone-comment-in-the-margin-says-its-words-once-and-the-gutter-s-chat-button-wears-chat-s-two-bubbles.md)).
  **The line is the button**, so its card says "Press this line" and
  its words are underlined under a pointer or keyboard focus (Greg, `spya-xf6m2u`: *"the tooltip
  says to 'press it' but I don't see anything to press"*;
  [261005m](../plans/261005m-earlier-tab-links-the-page-and-marginalia-tips-say-what-to-press.md)). This was
  [report 82](../user-feedback/261002_0300-marginalia-shows-other-modes-items.md), and the reasons
  are in [261002b](../plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md):

  > Perhaps include FAQ, Citations, Debate items, Comments etc (if generated) in Annotations. […]
  > Rather than showing the full item, maybe show them default-collapsed.
  >
  > — Greg, 2026-10-01

  | Kind | Beside | Rule |
  |---|---|---|
  | FAQ | the question's earliest answering passage that is still there | the quoted words must still be in that block |
  | Timeline | the passage that dates the event: where its date was read from, or the earliest mention that holds the article's own phrase for when | only events the piece dates. A date with no year counts, and shows the article's words as the band does (*"On July 7"*). An untimed event or any other date we could not read stays in the band. A date we did read always carries its year, because the margin has no head to say it once ([261003f](../plans/261003f-marginalia-relation-words-and-timeline-events.md)) |
| Debate (Sources › Claims) | the block of the claim a row answers | the claim's words must still be in that block. Whole-article rows have no block, so they stay in the band |
  | Bibliography | the earliest block that cites the work | **owner only**, and only from a fresh list, because the prose's citation marks are owner-only ([bibliography.md](bibliography.md)) |
  | Comments | the comment's block | a referee note (one with a `criterionId`) and a bare bookmark are left out |
  | Questions | the block the chat is anchored to | **owner only** (a visitor's payload has no chats); in the same line as that block's comments |

  Each comment and question is stamped with its kind (*Comment*, *Comment + AI*, *Question*), and
  a line holding both counts them apart ("1 comment · 1 question"). A question opens to *Open the
  conversation*, the Comments drawer's own press. Greg, SPIDERYARN-READING2-9H, 2026-10-01;
  [comments.md § Every mark says which of three it is](comments.md#three-kinds) and
  [261002j](../plans/261002j-visible-bookmark-comment-without-ai-and-comment-kinds-in-the-margin.md).

  The quote check is there because a visitor's payload carries no staleness flag (no "this was
  written against an older version of the article"). A list written before a block changed could
  otherwise sit beside prose that no longer says what it quotes.

**The block chat sits here too, while one is open**, as a card level with its block (on trial since
2026-10-04). Its host is a `[data-marg-note]` like any note, first in its block's cell, so
`useMarginLayout` pushes later notes below it. It is wider than the notes when the window has the
room. The margin's *Question* line for that conversation is left out while its card is up. Without
room for a card, or with the trial's switch off, the panel docks over the lower part of the column
or floats in the corner. [comments.md § Where the chat panel sits](comments.md#chat-dock).

**The column is wider on a wide window.**

> it still seemed pretty narrow. Maybe if the screen is wide we allow the Marginalia column to be a
> bit wider
>
> — Greg, 2026-10-05, about the chat card

It is 288px at most wherever it has to take room from the prose or a band, as before. Where
the centred prose already leaves more than that to its right, the column grows into it, up to
384px. With a 16px root, the rail on and no band, it is 310px in a 1440px window and reaches
384px from about 1590px. Beside a band it grows only into room
that was already spare right of the column. The prose and the band do not move or change width, and
below about 1400px nothing changes at that root size. The chat card's own width did not change:
it already took all the room right of the prose, up to 576px, so at 1440px it is still about 282px, and wider there would
mean moving the prose. `MARG_WIDE` and `widened` in [`layout.ts`](../../src/web/layout.ts);
[`layout-margin.test.ts`](../../tests/layout-margin.test.ts).

**From a 1600px window the prose moves left, for the chat card.**

> re wider margin for chat card: B give it more room on wide windows
>
> — Greg, 2026-10-06

B was offered as a small shift left from about 1600px, keeping the prose's width, so the margin
and the card get about 100px more. With the column on and no band, the prose moves up to 100px
further left from 1600px, whether or not a card is open. It moves only as far as the card can use, and the card
stops at 576px. With a 16px root and the rail on: 100px at 1600 (card 362 → 462), 54px at
1920 (522 → 576), and none from 2028px, where the prose is centred again. Larger type can leave
less space on the left; the shift keeps at least half of it clear of the rail. The notes' cap
stays at 384px; at larger roots the notes can also grow into the new room, up to that cap.
Below 1600px the prose stays where it was, so it jumps as a window
is dragged across that width. Beside a band nothing moves: the prose is not centred there and
the band has the page left of it. The masthead's title follows the prose at every width
(`marginalia.css` § the room) — since 2026-10-06 below 1600px too, where the column had been
pushing the prose left without it, leaving the title up to about 145px right of the prose from an iPad's width to about 1400px
([the plan](../plans/261006c-the-title-follows-the-prose-below-1600px-with-the-marginalia-column-on.md) has the measurements).
`shiftForCard` and `margTitleReserve` in [`layout.ts`](../../src/web/layout.ts).

**A lone question's line says its words once.** Opened, it shows only *Open the conversation*; the
line itself un-truncates. Among several entries each keeps its own head, which is how they are told
apart (report `spya-f6dpj5`).

## Relation words

> include the "relation-words", e.g. BUT, SO
>
> — Greg, 2026-09-30 (spya-u3dgk7)

A small-caps word first in a paragraph's note, saying how it bears on the paragraph before it:
**so** (it draws its conclusion from it), **but** (it pushes back on it), **vs** (it sets something
against it without denying it). The word is a button; its card says the sentence. The plan, the
options passed over and GPT Sol's review are in
[261003f](../plans/261003f-marginalia-relation-words-and-timeline-events.md).

- **The `relations` step** ([`src/relations.ts`](../../src/relations.ts)): one model call per
  article. Every body paragraph of at least a sentence, bar the first, gets one of ten relations
  from a closed list (`RELATIONS` in src/types.ts). It must answer every listed paragraph; a run
  that answers fewer than half fails rather than storing a sparse list that would look like an
  article with few turns. The same call may write the prose notes below. Stored in
  `article_revisions.relations`.
- **Ten are stored, three are drawn.** `DRAWN_RELATIONS` in `notes.ts` is the one place that says
  which, with a card for each in `tips.ts`. On the 108 paragraphs of the decorated experiment the
  three are about one paragraph in three; all ten would be a word on every paragraph. Drawing
  *why* or *e.g.* later is a row in each table and no new model call.
- **Made when the column is shown, not on import and not on a press.**

  > generate linking words when Marginalia mode is opened
  >
  > — Greg, 2026-10-05

  The owner's column mounting is what asks ([`src/web/useRelations.ts`](../../src/web/useRelations.ts),
  through `useAutoRunOnArrival` in [`useAutoRun.ts`](../../src/web/useAutoRun.ts), the rule the
  thread in Summary already used). So it does not matter what showed the column: a press of the
  toggle, a pasted `?margin=1` link, a reload, or this browser restoring the view you left. A press
  could not carry the last three. (From 2026-10-05 to 2026-10-11 the first-open default turned the
  column on too, which is why the rule was made; it no longer does —
  [url-state.md § An article never opened here arrives at a default](url-state.md#an-article-never-opened-here-arrives-at-a-default).)
  - **One attempt per article per page load**, and unforced, so the step's own stamp check has the
    last word. Turning the column off and on again buys nothing, and a failed run does not loop.
  - **A stale list is hidden; an outdated one stays on screen.** Either starts one rewrite, and the
    old words and notes remain visible in the outdated case until their replacements arrive.
  - **Nothing is shown, nothing is spent.** On a window too narrow for the notes the owner's feed
    still reads, but waits to generate until the notes fit on screen. A visitor's column never reaches the hook.
  - **The press arms nothing.** Marginalia's row in `MODE_TARGET` (src/web/activation.ts) is
    `delegated` and answers `null`: the command bar still marks the row as one that may start work,
    and the import's list, which is derived from that table, does not include it.
  - **For part of 2026-10-05 an import queued it**, with the other main modes' steps
    ([261005d](../plans/261005d-marginalia-out-of-the-experimental-switch.md)). That cost a call
    for every article, opened or not. **No backfill**: an article from before gets its words the
    next time its owner has the column open (Greg: *"yes leave that for now"*).
- **Nothing in the column says it is running.** Notes already supplied by other modes are drawn
  without the words, and the words and Marginalia's own notes appear when the job finishes, with no
  reload; the job is in the jobs tray like any other. Metadata has a *Marginalia notes* row (called
  *Relation words* until 2026-10-11) to run it again.
- **Owner only.** A visitor's payload does not carry them: it has no staleness verdict, and a word,
  unlike a quote, cannot be checked against its paragraph, so an old *but* could sit beside a
  rewritten one.

## Notes the model writes

> I think we could give the LLM just a bit more freedom to play and experiment, so perhaps it can
> produce other scribble notes as it sees fit. Perhaps it can explain things that would otherwise
> be confusing, or provide other notes sparingly that might be helpful to the reader. We don't
> want to overdo it, though. […] maybe the marginalia mode could highlight really important
> cross-references, especially if there's an inconsistency or if the reader might benefit from
> being reminded what that other section said.
>
> — Greg, 2026-10-11 (spya-qyuet0)

**The relations call may also write a few notes** (`relations/3`, plan
[261011o](../plans/261011o-marginalia-off-the-first-open-and-notes-of-its-own.md)). There is no
second call and no new step: the notes need the same article, the same freshness and the same
owner-only rule as the words, so they ride on the call that was already there, stored in the same
`article_revisions.relations` row as `notes` (no migration; a row from before reads as none).

- **Four kinds from the article alone**, the four Greg named: `tension` (this passage and another seem not to agree),
  `recall` (what a passage far from here said, which this one leans on), `explain` (a step likely
  to confuse) and `aside` (anything else, rarely). The stamp says *Tension*, *Recall* or *Note*;
  its card says what the kind is and that AI wrote it (`NOTE_TIPS` in `tips.ts`).
- **Both ends are quoted and checked.** Each note quotes the words it is about in its own passage,
  and a note about another passage quotes that one too; `toNotes` keeps a note only when each quote
  is in its passage, spacing and all, and stores the article's characters. An id alone could name a
  real but wrong passage. This proves the join, not the judgement: a *tension* can still be the
  model misreading, which is why its card says to judge for yourself.
- **Sparing, in code as well as in the prompt**: at most one note per eight paragraphs asked about,
  two at least and eight at most (`noteCap`), one per passage, 35 words at most. Every rule runs
  before the cap. A bad note is dropped and counted in `notesDropped`, and never fails the run:
  the words are the step's contract and the notes are extra. An article with fewer than two body
  paragraphs still makes no call, so it gets no notes.
- **The notes come first in the answer**, before the hundred rows of words. Asked for after them,
  the model wrote two notes across four articles; asked for first, eleven to fourteen, about one
  per eighteen paragraphs (the plan's § Measurement).
- **Open, not shut**, unlike other modes' items: at most a handful, and a shut line would hide the
  only thing a note has to say. A link to the other passage is the one block link (`BlockRef`), so
  it has the passage's card and the jump flashes the checked target words.
- **Owner only**, as the words are.

**A note about the world outside the piece** (a source, a correction, how others see a claim)
would be a note whose content is *not* in the article. The labels and the trigger Chat, Recall
and Quiz use for that since 2026-10-18 are one shared section, `widerWorld()` in
[`src/wider-world.ts`](../../src/wider-world.ts):
[prompting-guide.md § The wider world](prompting-guide.md#the-wider-world-labelled-widerworld).
The relations call does not use it: its four article kinds keep to the article, and its one
memory kind, *Origin* below, is about where a quotation comes from rather than whether the piece
is right, and is labelled *AI memory, unchecked* on the note.

### Origin notes: where a quote or allusion comes from, from memory

> the annotations should be the useful stuff, the stuff that saves the user a click, the things that
> they would have looked up. So it could be a combination of, you know, oh, where does that come
> from, or why did they choose that quote, or what's that citation say
>
> — Greg, 2026-10-17 (spya-w99qsz)

**Since `relations/4` the same call may write a few *Origin* notes**: beside a passage that
quotes, alludes to or names something the article leaves bare, where it comes from. Plan
[261018i](../plans/261018i-marginalia-notes-that-save-a-click.md).

- **The only notes allowed to use the model's own knowledge**, so they are their own array in the
  answer, `sourceNotes`, with no `kind` field: code stamps `source` (`toSourceNotes`). The four
  kinds above stay "use only the article", and the model cannot choose `source` as their kind.
  This field boundary does not keep their prose inside the article: an `explain` note may still
  gloss a word or name from general knowledge (*Fight Club* "the film"; before this, the control's
  "Latin for 'to be astonished at nothing'"), as it always has — plan § Code review. Stored in the
  same `notes` list, told apart by kind.
- **Marked on the note, not only in its card**: the stamp *Origin* and, after the words, *AI memory,
  unchecked* (`SOURCE_NOTE_LABEL`), quiet and never a warning, as Glossary's *background* is
  ([glossary.md § Provenance is the label](glossary.md#provenance-is-the-label-not-a-badge)).
  Nothing checks the attribution; the quote check proves only where the note sits.
- **The prompt's bar**: only what the piece leaves bare (a phrase used without its source, a
  quotation without its author, a person named with no word of who they are), not what it
  already says or what nearly every reader knows; an attribution only as specific as the model is
  sure of, disputed ones said to be disputed; **never why the author chose it.**
- **Their own small cap**, `sourceCap`: one per sixteen paragraphs, two to four, beside the
  article-only notes' `noteCap`, and still one note per passage across both.
- **Measured** on six local articles (the plan's § Measurement): no wrong attribution in four
  runs, none on the Transformer paper, and a blind judge found 10 of 14 useful, 4 redundant, none
  harmful. The redundant ones name famous works the piece already names.

**Cross-references are something else.** [cross-references.md](cross-references.md) links a phrase
to the passage that backs it, many to an article and unranked, in the prose. A *Recall* or
*Tension* note is the few the model judged worth a sentence. Neither reads the other.

## Every note says where it came from

> I can't tell what that Annotation is from or why or whether AI-generated (if so, it should be in
> the AI-generated font). Make sure all annotations have rich tooltips (see tooltips.md) explaining
> their origin, and anything else that might be helpful for the reader.
>
> — Greg, 2026-10-01 (spya-atv4nx)

**Every note, and the head's path and arc, has a card that explains it.** Most use the house card:
what the note is, then which mode made it, who wrote the words (AI, the author, the reader) and why
it sits beside this passage. Those words are one table, `src/web/marginalia/tips.ts`; **a new kind
without a richer card to reuse needs a row there**, and the `Record` over the house-card keys makes
a missing row a type error. Most shut lines carry their key as `data-marg-tip` and the reading
view's one delegated card draws it ([tooltips.md](tooltips.md)); a question is a button with a card
of its own, because it has nothing to press and the delegated card answers neither a keyboard nor a
finger. The *Cites* exception is below.

> The Marginalia mode tooltip for a citation is pretty unhelpful. It's just a kind of generic
> message. I feel like we have more information than that for a citation if I hover over it in the
> text. So let's try and reuse that same tooltip. And the same goes for other stuff in the Marginalia
> mode - their tooltips should be the best we can make them, and ideally reuse what tooltip
> machinery we already have for that kind of marginalia-annotation.
>
> — Greg, 2026-10-19 (spya-gdbsq2)

**Where the prose has a richer card for the same kind of item, the margin uses it.** Since
2026-10-20 that is the *Cites* line: its card is the prose's `CiteCard`, one per work, with its
buttons, in an interactive `Tooltip` of the line's own (`LineCard` in `MarginaliaColumn.tsx`; the
senders come through `MarginCiteActions`). It is shut while the line is open, and a finger's press
opens the line, not the card. No other kind has a card in the prose to reuse
([tooltips.md § Every card on a mode's mark](tooltips.md#every-card-on-a-modes-mark-has-a-way-into-its-mode)),
so the rest keep the house card, which **says the item's own words when its line is cut off**
(`cutWords` in `BlockLinkCard.tsx`), in their writer's face. Plan
[261020g](../plans/261020g-marginalia-tooltips-reuse-the-prose-citation-card-and-say-the-item.md),
which also names what was left: a count line's card listing its items, and a press on *Cites*
opening the card in place of the panel. **And each note's words are in their writer's face** ([fonts.md](fonts.md)):
the shut line takes the voice of the one item it shows, a count is ours. Tested in
`tests/marginalia-note-cards.test.tsx`;
[261002g](../plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md).

**The arc in the head is asked for in at most 20 words** (`arc/6`; a median of 17 measured, and some go over), after Greg found the head's language *"too
complex"* (spya-g4yrew): at 30-odd words it was hard going and cut mid-sentence by the three-line
clamp, now four lines ([261002p](../investigations/261002p-arc-sentences-shorter-and-plainer.md)). An arc written by an older prompt stays on screen while the owner's open writes a new one
(`useArc`, `isArcOutdated`).

## Keep an eye out for new kinds

Greg, 2026-10-01: *"make a note … that we should keep an eye out for where new mode-items might be
useful to include/display in Annotations mode."*

**When a mode stores items that are anchored to blocks, ask whether they belong here**, shut by
default. Adding one is one new kind in `MarginaliaNote`, one loop in `marginaliaNotes` that places
it at its earliest surviving block and checks its quote, one small component in
`MarginaliaColumn.tsx`, and a read half if the mode hook can start a run.
[mode.md](mode.md) points here from its checklist. Not here yet, and named so they are not
forgotten: Quotes, glossary terms, cross-references (the few that matter now come as the model's
own notes, [above](#notes-the-model-writes)). The first two already mark
the prose.

The constraint each new kind is weighed against is the one the first plan named: the risk is *"a
second article down the margin"*. That is why there is one line per kind per block, and why every
kind starts shut.
