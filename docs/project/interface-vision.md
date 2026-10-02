# Interface vision: three columns

Up: [reading-view-overview.md](reading-view-overview.md)

> **Not decided.** This is one direction of travel to explore, written up at Greg's request on
> 2026-10-01. Nothing here is a plan or a commitment, and the reading view does not work this way
> yet — [reading-view-overview.md](reading-view-overview.md) says how it does work. When a piece of
> this is decided, it moves into the doc that owns that piece and comes out of here.

## What Greg asked for

> I suspect I'm probably not going to want to actually scroll through the glossary, say. What I want
> is for the glossary to be there when I need it because I'm reading a word that I don't understand
> and I see the little dashed line or dotted line underneath the word and I hover and that's great.
> So I can imagine a world in which, you know, maybe those modes with their special mode columns
> still exist, but they're kind of not emphasized in the user interface and that most users won't
> ever need to use them.
>
> […] Instead, the user will have a left-hand column with stuff like Structure and Summary, and a
> right-hand column with occasional default-collapsed block-level marginalia, and a heavily
> marked-up/decorated text.
>
> — Greg, 2026-10-01, SPIDERYARN-READING2-8E (the whole report is in
> [the note](../user-feedback/261001_1132-interface-vision-and-annotations-become-marginalia.md))

He hedged both halves: the decorated text is *"one vision. I'm not sure if it's right"*, and the
whole is *"not definitely what we're going to do, but it's one direction of travel to explore."* It
continues his layout from the day before (SPIDERYARN-READING2-7K): *"left-hand-column (if displayed)
would be stuff that's unanchored to the text, middle column for the text itself, and
right-hand-column (if displayed) for annotations anchored to the blocks"*. And it is a concrete form
of [vision.md](vision.md)'s *"eventually, not six modes"*: the band the modes take turns in was
always the simpler-first version, not the end state.

## The picture

```
 spine │ LEFT — not anchored     │ MIDDLE — the text            │ RIGHT — anchored marginalia
       │ doesn't scroll with it  │ decorated, progressively     │ scrolls with the text
       │                         │ disclosed                    │
   ▮   │ Structure (the tree)    │ ¶ … a ·glossary· term, a     │
   ▮   │ Summary                 │   quote's rule, a citation   │ ? What would have to be true
   ▯   │ Tweets                  │   mark, a cross-reference …  │   for this to hold?
   ▯   │ (Diagram, Skim?)  │                              │
   ▯   │                         │ ¶ …                          │ ⚑ Disputed — 2 replies  ▸
   ▯   │                         │                              │
   ▯   │                         │ ¶ …                          │ ↳ answers the objection
       │                         │                              │   in §2                 ▸
```

- **The middle is the article**, and for many readers it may be all they want. Everything the
  modes know about a phrase shows up *on* the phrase, quietly, and opens on hover or tap.
- **The right is block-anchored marginalia**: occasional, default-collapsed notes level with the
  passage they are about, scrolling with it. Today's Marginalia (called Annotations until the
  rename in [261001n](../plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md))
  is the first cut.
- **The left is everything that is about the piece as a whole**: Structure, Summary, Tweets. It
  stays put while the text scrolls.
- **Both sides can be open at once** when the window is wide enough.
- **The single-purpose mode bands still exist but recede.** Glossary's list, Ideas' list, Timeline,
  FAQ: reachable (the command bar, an overflow), but not what a reader is offered first, *once*
  their content reaches the reader through the text and the margin. Today it mostly does not — see
  the table.

## Where each mode's content would live

Read from the mode docs and the code, 2026-10-02. "Exists" means the data is already stored and
anchored, so placing it costs layout, not a model call.

| Content | Anchored to | Where it would live | Exists today? |
|---|---|---|---|
| Glossary terms | phrases | middle: dotted underline + card | **yes**, in every mode ([glossary.md](glossary.md)) |
| Quotes | sentences | middle: the quote's rule | **yes**, in every mode ([quotes.md](quotes.md)) |
| Citations | phrases | middle: citation mark | **yes** ([citations.md](citations.md)) |
| Cross-references | phrases | middle: underline + hover card | **yes**, owner-only ([cross-references.md](cross-references.md)) |
| Quiz questions | paragraphs | middle: italic line after the paragraph | **yes** ([quiz.md](quiz.md)) |
| Socratic questions, the arc | parts | right, and the right's head | **yes**, in Marginalia |
| Ideas (assumes / introduces) | block ids | right: a stamp at first occurrence | **in the margin**, once Ideas has run; marked in the prose only while Ideas' band is open (`selectPassages`, `src/web/reader/passages.ts`) |
| Debate's disputed claims | every claim row has a `blockId` and a located `claimQuote` (`readClaimGroup`, `src/debate.ts`); its `relation` is one of disputes, qualifies, extends, corroborates, unclear | right: collapsed, opening the replies | **in the margin** since 261002b, every relation with its word first — Greg, 2026-10-02: *"Let's try with everything, and see how it feels"* (narrowing to `disputes` is one line in `src/web/marginalia/notes.ts`) |
| FAQ answers | the passages that answer | right, or a mark | **in the margin** since 261002b, beside the earliest answering passage, shut; marked nowhere in the prose |
| Timeline events | resolved passages | right, or a mark | data yes; marked in the prose only while Timeline's band is open |
| Rebuttals, conclusions ("this answers §2", "so…") | blocks | right | **no** — a new model pass (the relation words in [261001d](../plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md) stage 2) |
| Explaining a hard paragraph | blocks | right, collapsed | **no** — needs [vision.md](vision.md)'s difficulty map, which does not exist |
| Structure | the whole | left | yes, as a band |
| Summary | the whole, linked to passages | left | yes, as a band |
| Tweets | the whole, posts linked to passages | left | yes, as a wide band (Greg already called it *"its own left-hand column"*, 5A) |
| Diagram / Sketch / Illustrated | the whole | left, or a surface of its own | yes, as bands |
| Skim | a route through quotes | left? it is walked, not read | yes, as a band |
| Comments and bookmarks | blocks or quoted passages | right: collapsed | **in the margin** since 261002b; a visitor sees the owner's published comments |
| Search, Chat, Remember / Quiz, Referee | the reader's own actions | tools, not columns | — |

The finding that matters: **most of the right-hand column's content is already made and already
anchored.** The expensive items — rebuttals, conclusions, explanations — are the two that need a new
model pass, and they can come last.

## What is already true

- **The right column exists.** Marginalia's notes sit level with their blocks, push each other down
  when they collide, and generate nothing. Visitors see the public Ideas, FAQ and Debate artefacts
  plus the owner's published comments, but never the owner's Citations. The notes are faint, small
  and hueless
  ([261001d](../plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md)).
- **Left and right already coexist.** Since 261001i the margin is a switch of its own, `?margin=1`,
  beside whichever band is open. From 900px both are drawn; from 612px to 899px whichever was
  pressed last swaps in; under 612px the notes do not fit even alone, so pressing Marginalia leaves
  the band open and the notes hidden (`src/web/marginalia/press.ts`) ([261001i](../plans/261001i-annotations-column-beside-a-band-mode.md),
  [261001k](../plans/261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md),
  [narrow-windows.md](narrow-windows.md)).
- **The middle is already decorated** — but only Glossary's terms, Quotes and Citations are marked
  in every mode, under the rule written into [mode.md](mode.md). Ideas and Timeline mark the prose
  only while their own band is open, and FAQ marks nothing.
- **The decorated playground** (`experiments/decorated/`, the ideas in
  [260828c](../research/260828c-decorated-mode-ideas.md)) is the catalogue of what else the middle
  could carry — 168 ideas, and a *channel budget* that keeps them from fighting: one owner per
  channel, at most two non-default channels on one block.

## What would have to change

- **The left stays today's band, for now.** One mode at a time, chosen as a radio, Plain is "no
  band", and the margin opens beside it. Greg likes having the two open together; several left
  modes at once is where he can see it going, on very wide screens, and out of scope for now. Whether
  Marginalia stays the only right-hand mode is undecided:

  > I definitely like being able to have both a left-hand and the right-hand mode open at the same
  > time. I haven't decided whether Marginalia will be the only right-hand mode, or whether we'll add
  > other right-hand modes. FWIW I can imagine a future world where (on really wide screens) we might
  > want to be able to have multiple left-hand-modes open (e.g. both Structure and Summary) plus the
  > Marginalia right-hand mode all open at the same time, for a really rich text-reading experience.
  > We can treat that as out of scope for right now if it will add too much complexity.
  >
  > — Greg, 2026-10-02
- **The margin gains kinds of note**, each one sparse and collapsed by default. The constraint the
  261001d plan named still holds: the risk is *"a second article down the margin"*.
- **The single-purpose modes move off the main bar.** The Dock is a long list today and Greg has
  re-sorted it twice ([4E](../user-feedback/260929_0455-mode-bar-reordered-into-runs.md),
  [57](../user-feedback/260929_1435-glossary-ideas-timeline-join-trajectory-search-joins-chat.md)).
  Hierarchy is precedent for removing a mode outright when another covers it (4B).
- **A rule for narrow windows and phones.** Three columns do not fit on a phone held upright; today
  even two do not. Something has to say what a phone reader gets.

## Tensions, from the feedback so far

These are the reasons to go carefully, each one already said by Greg in another report.

- **A mark that has to be explained has already failed.** Greg could not tell twice what a grey line
  beside a block meant (4S, 84). Every new underline or margin stamp is that question again unless
  it explains itself on hover *and* on tap. The playground's `verify.mjs` already checks that every
  mark has a tooltip; the app does not.
- **Less text versus more decoration.** Greg keeps taking words off the page — mode descriptions
  (7B), text labels (6H: *"there's just so much text already on the page"*), header rows (4G). A
  heavily decorated middle pulls the other way, so the decorations have to be quiet by default
  (progressive disclosure is the whole point) and few at a time.
- **Who owns the right margin.** The decorated research gave the right margin to *the reader* (their
  comments and bookmarks, the only hue on the page); Marginalia began with *the machine*, kept faint.
  Both now live there, and still need different voices — the
  typefaces experiment (7C: author serif, AI Courier, reader Arial) is one answer.
- **Cost and consent — settled 2026-10-02: opening Marginalia spends nothing.** It shows only what
  other modes have already made, and the automatic help comments in 7E were declined for the same
  reason. Greg would have had it run the missing modes, but only if a mode made later never reached
  the margin:

  > My worry is that if we *don't* fill in stuff that hasn't been generated, then even if we do
  > generate that mode afterwards it won't get fed into Marginalia mode... If that concern is
  > correct, then let's automatically run any missing modes when we first run Marginalia mode.
  > Perhaps the ideal would be for Marginalia mode to notice if new modes that it depends on have
  > been run since it first ran, and update itself. But if that's going to add substantial
  > complexity, let's hold off on it.
  >
  > — Greg, 2026-10-02

  The worry does not hold: the margin reads the owner's FAQ, Debate and Ideas each time it opens,
  and since [261002d](../plans/261002d-marginalia-refreshes-when-a-mode-it-reads-finishes.md) it
  also refreshes them, and the Reader's shared Citations read, on completions announced by this
  tab's job engine — his "ideal", which turned out small.
  [marginalia.md § What it shows](marginalia.md).
- **Phones.** On a phone a band already covers the article, and a passage link in it scrolls text
  you cannot see (5A), and the notes do not fit at all under 612px. The vision has no phone answer
  yet.
- **Experimental gating.** Marginalia, the typefaces, cross-references, Debate, Diagram and FAQ are
  behind the switch or owner-only. A vision that makes them the default view is also a decision to
  take them out from behind it.

## A path, simplest first

Each step is useful on its own, and none commits us to the next.

1. **Rename Annotations to Marginalia** — done, 2026-10-01
   ([261001n](../plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md)).
2. **Notes from data already stored** — done, 2026-10-02, wider than the trial this step proposed:
   report 82 asked for FAQ, Citations, Debate and comments, shut by default, and that is what
   [261002b](../plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md)
   built: one line per kind per block, opening to the stored content, no model call.
   [marginalia.md](marginalia.md).
3. **Every mark explains itself on hover and on tap** — the app-side version of the playground's
   check, before adding marks.
4. **Recede the single-purpose modes** from the Dock into an overflow and the command bar — each
   one only once its content reaches the reader through the middle or the right; Timeline does not
   reach either yet.
5. **New model passes for the margin** — relation words, rebuttals, conclusions — measured on the
   eval corpus before shipping, as any new prompt is ([prompting-guide.md](prompting-guide.md)).
6. **The left as a column of its own**, if the band turns out not to be enough.

## Open questions

Put to Greg three at a time through the Overseer
([ask-me-questions.md](../reusable/ask-me-questions.md)). Answers move into the owning doc, and the
question comes off this list.

The first batch (the left column, and whether Marginalia may spend) was answered on 2026-10-02; the
answers are under [What would have to change](#what-would-have-to-change) and
[Tensions](#tensions-from-the-feedback-so-far).

**Not yet sent** — the next batch:

- How the single-purpose modes recede (an overflow and the command bar, or removal as Hierarchy
  was) — not askable until each one's content reaches the reader another way.
- What a phone reader gets: the text and marks only, with each column a sheet opened on demand?
- How the reader's comments and bookmarks differ in voice from the machine's notes in the margin.
- Whether the decorated text stays a playground or becomes the default middle, and if so whether it
  is a density dial (bare → loud, the designer's idea in [260828c](../research/260828c-decorated-mode-ideas.md))
  or a set of toggles.
- When, if ever, these come out from behind the experimental switch.
