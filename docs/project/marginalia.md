# Marginalia

The column of notes to the right of the prose, each level with the block it is about. Its address is
`?margin=1`, and it stands beside whichever band is open. Up from here:
[reading-view-overview.md](reading-view-overview.md). Where this is meant to go is
[interface-vision.md](interface-vision.md): the right column is for what is anchored to the text.

The code is `src/web/marginalia/`: `notes.ts` decides which note goes beside which block (pure, and
tested in `tests/marginalia-notes.test.ts`), `MarginaliaColumn.tsx` draws them and the head, and
`press.ts` decides what the Dock button does on a narrow window.

**The block's gutter of icons sits between the prose and the notes.** It moved to the right of the
block on 2026-10-03 ([261003c](../plans/261003c-block-gutter-icons-move-to-the-right-of-the-block.md)),
into the reading cell's right padding; a note starts past the cell's edge, so the order across the
page is prose, icons, then the note, with at least `--blk-gutter-x + --marg-gap` between the icons
and a note's words. Nothing in the column's arithmetic (`fitMargin`, `--marg-reserve`) changed,
because the two pads only swapped sides.

## What it shows

**It generates one thing, its own relation words** ([below](#relation-words)). Every other note
comes from something another mode has already stored, and opening the column never runs another
mode. The owner's lists are read through each mode's *read half*
(`useIdeasRead`, `useFaqRead`, `useTimelineRead`, `useDebateRead`), never the full mode hook, because the full hook
can start a run on its own. `tests/artefact-read-hooks.test.tsx` checks that the read halves only
read. A visitor's lists come in their payload.

**So a FAQ, Timeline, Debate or Ideas list made later still reaches the owner's margin, and nothing is run for it.**
The column keeps no copy of these lists: it reads them every time it opens, and while it is open
it re-reads them when this tab's job engine announces a completion for them — the same feed each
band listens to, through
`useStepFinished` (`src/web/useStepJob.ts`), which is quiet and adds no polling. Citations comes
through the Reader's shared read instead, which listens the same way, so an announced Citations
completion after the reader has left its band reaches the margin too (as do Glossary's and Quotes'
reads, for the prose marks). Greg had asked for missing modes to be run when Marginalia opens, if a later
one would otherwise be missed; it would not be, so it is not
([interface-vision.md § Tensions](interface-vision.md#tensions-from-the-feedback-so-far),
[261002d](../plans/261002d-marginalia-refreshes-when-a-mode-it-reads-finishes.md),
`tests/marginalia-live-refresh.test.tsx`).

- **A relation word** (*so*, *but*, *vs*) beside a paragraph where the argument turns —
  [§ Relation words](#relation-words).
- **The head**, pinned at the top: which part and section you are in, and the arc's sentence for
  where the argument has got to. It has a rule under it so it does not read as one more note (Greg,
  spya-rczgjb). Uncovered rows above the first part (a title, a byline) name the first part, so it is not
  empty at the very top; in a gap the tree does not cover further down it draws nothing
  (`src/web/marginalia/notes.ts` § `headBlock`). While it is on screen the headings breadcrumb in the top bar is not drawn
  ([experimental-features.md](experimental-features.md#what-is-behind-it-today)).
- **Each part's Socratic question**, beside the part's first real paragraph.
- **An idea stamp** ("assumes", "introduces") where each idea first occurs.
- **Other modes' items, shut by default**: FAQ questions, Timeline's dated events, Debate's claim rows, Citations and comments
  (the owner's on a shared article; a bookmark with no words stays a mark in the gutter). Each block gets at most one line of each kind.
  One item shows its title; several show a count ("3 works"). Pressing the line opens the supporting
  quote and remaining-passage count for FAQ, the source quote and bearing for Debate, the byline and
  reason for a citation, or the comment and the first lines of its AI answer. This was
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
| Debate | the block of the claim a row answers | the claim's words must still be in that block. Whole-article rows have no block, so they stay in the band |
  | Citations | the earliest block that cites the work | **owner only**, and only from a fresh list, because the prose's citation marks are owner-only ([citations.md](citations.md)) |
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
  from a closed list (`RELATIONS` in src/types.ts). The model writes no prose. It must answer every
  listed paragraph; a run that answers fewer than half fails rather than storing a sparse list
  that would look like an article with few turns. Stored in `article_revisions.relations`.
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
  toggle, the first-open default that turns it on with nobody pressing anything
  ([url-state.md § Reopening an article where you left it](url-state.md#reopening-an-article-where-you-left-it)),
  a pasted `?margin=1` link, a reload, or this browser restoring the view you left. A press could
  not carry it, because the default arrives without one, and a new article would then have had no
  words until the column was turned off and on.
  - **One attempt per article per page load**, and unforced, so the step's own stamp check has the
    last word. Turning the column off and on again buys nothing, and a failed run does not loop.
  - **A stale or outdated list counts as none**, so the next showing rewrites it.
  - **Nothing is shown, nothing is spent.** On a window too narrow for the notes the owner's feed
    still reads, but waits to generate until the notes fit on screen. A visitor's column never reaches the hook.
  - **The press arms nothing.** Marginalia's row in `MODE_TARGET` (src/web/activation.ts) is
    `delegated` and answers `null`: the command bar still marks the row as one that may start work,
    and the import's list, which is derived from that table, does not include it.
  - **For part of 2026-10-05 an import queued it**, with the other main modes' steps
    ([261005d](../plans/261005d-marginalia-out-of-the-experimental-switch.md)). That cost a call
    for every article, opened or not. **No backfill**: an article from before gets its words the
    next time its owner has the column open (Greg: *"yes leave that for now"*).
- **Nothing in the column says it is running.** The notes are drawn without the words, and the
  words appear when the job finishes, with no reload; the job is in the jobs tray like any other. Metadata has a *Relation words* row to run it again.
- **Owner only.** A visitor's payload does not carry them: it has no staleness verdict, and a word,
  unlike a quote, cannot be checked against its paragraph, so an old *but* could sit beside a
  rewritten one.

## Every note says where it came from

> I can't tell what that Annotation is from or why or whether AI-generated (if so, it should be in
> the AI-generated font). Make sure all annotations have rich tooltips (see tooltips.md) explaining
> their origin, and anything else that might be helpful for the reader.
>
> — Greg, 2026-10-01 (spya-atv4nx)

**Every note, and the head's path and arc, has a house card**: what it is, then which mode made it,
who wrote the words (AI, the author, the reader) and why it sits beside this passage. The words are
one table, `src/web/marginalia/tips.ts`; **a new kind of note needs a row there**, and the `Record`
over the keys makes a missing row a type error. The shut lines carry their key as `data-marg-tip` and
the reading view's one delegated card draws it ([tooltips.md](tooltips.md)); a question is a button
with a card of its own, because it has nothing to press and the delegated card answers neither a
keyboard nor a finger. **And each note's words are in their writer's face** ([fonts.md](fonts.md)):
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
forgotten: Quotes, glossary terms, cross-references. The first two already mark
the prose.

The constraint each new kind is weighed against is the one the first plan named: the risk is *"a
second article down the margin"*. That is why there is one line per kind per block, and why every
kind starts shut.
