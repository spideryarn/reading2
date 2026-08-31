# Ideas — the things you have to hold in your head to get this piece

**Status: plan, not built.** Written 2026-08-26.

A sixth [mode](260826a-chat-mode.md) in the band, beside [Glossary](../project/glossary.md). The glossary
answers *what does this word mean*. This answers *what do I have to understand* — the ideas the piece
leans on without stating, and the ideas it puts forward.

Greg, 2026-08-26, asking for it:

> I'm wondering if we should add a new "Mental models" (or just "Ideas") mode, alongside Glossary.
>
> I'm thinking this could be a way to pull out new ideas that the text introduces and/or key ideas
> that the text requires the user to understand.

The prompt for it was
[a skill for *writing* tutorial explainers](https://raw.githubusercontent.com/mindstone/rebel-system/57d2fe44c311a19714aaada5cded3715da42144f/skills/documentation/write-tutorial-explainer/SKILL.md),
which asks an author for "2–5 conceptual frameworks" before any detail, on the grounds that they are
"pedagogical documents focused on building mental models rather than just cataloging facts". This is
the same instinct pointed the other way: not *write* the frames, but *find* the ones a piece already
depends on.

---

## The unit is the thing that is new, not the provenance

The glossary already splits by provenance. `senseHere` is what the author means; `background` is what
you bring. Both of Greg's halves are already there — for **terms**. What is missing is the other axis.

```
                     INTRODUCED by the piece          ASSUMED by the piece
                  ┌──────────────────────────────┬──────────────────────────────┐
                  │                              │                              │
   TERM           │  senseHere                   │  background                  │
   a word you     │  "writes and write-nots"     │  "Leslie Lamport"            │
   look up        │  "nonreductive explanation"  │  "Paxos"                     │
                  │                              │                              │
                  │  ◄────────── G L O S S A R Y  —  B U I L T ─────────────►   │
                  │                              │                              │
                  ├──────────────────────────────┼──────────────────────────────┤
                  │                              │                              │
   IDEA           │  "writing is thinking, so a  │  predictive processing, in a │
   a proposition  │   world where the machine    │  piece that never names it   │
   you hold       │   writes is a world that     │  and argues from it on every │
                  │   stops thinking"            │  page                        │
                  │                              │                              │
                  │  ◄──────────── I D E A S  —  T H I S  P L A N ──────────►   │
                  │                              │                              │
                  └──────────────────────────────┴──────────────────────────────┘
                     "what this piece adds"          "what you need to bring"
```

**The test that separates the rows: can you say it as a proposition?** A term is a noun phrase and the
answer to it is a definition. An idea has a claim shape — *X because Y*, *A is really a special case
of B* — and the answer to it is a sentence you could carry to a different article and use.

That test is what goes in the prompt, and it is also the answer to *why not just widen the glossary*
(§ [Why this is not a wider glossary](#why-this-is-not-a-wider-glossary)).

---

## What it looks like

```
  IDEAS MODE — same spine, same article, the band is a short list

 ┌─────────────┬───────────────────────┬────────────────────────────┬───┐
 │             │  Mode: ideas    back to contents                    │   │
 │  ▇▇▇▇▇▇▇▇   ├───────────────────────┼────────────────────────────┤ ▍ │
 │  ▇▇▇▇▇      │ Ideas          6      │  … and if the machines do  │   │
 │  ▇▇▇        ├───────────────────────┤    the writing, then the   │   │
 │  ▇▇▇▇▇▇▇    │ WHAT YOU NEED       2 │    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   │ ▍ │
 │  ▇▇         │ TO BRING              │  ┃ thinking goes with it,  │   │
 │  ▇▇▇▇       ├───────────────────────┤    because the writing WAS │   │
 │  ▇▇▇        │ ▸ Writing is a test   │    the thinking …          │   │
 │  ▇▇▇▇▇      │   of thought, not a   │                            │ ▍ │
 │  ▇▇         │   record of it        │      ↑ the wash and the    │   │
 │  ▇▇▇▇▇▇     │ ▾ Skills atrophy when │        ┃ border, exactly   │   │
 │             │   the task is         │        as a search hit     │   │
 │             │   automated away      │        draws them — which  │   │
 │             │  ┌──────────────────┐ │        is what it is       │   │
 │             │  │ THE IDEA         │ │                            │   │
 │             │  │ A capacity you   │ │                            │ ▍ │
 │             │  │ stop exercising  │ │                            │   │
 │             │  │ does not sit     │ │            ↑ and one lane  │   │
 │             │  │ still, it fades… │ │              down the rail,│   │
 │             │  ├──────────────────┤ │              which is the  │   │
 │             │  │ WHY YOU NEED IT  │ │              only thing    │   │
 │             │  │ The piece's whole│ │              that can show │   │
 │             │  │ case rests on it │ │              you the SHAPE │   │
 │             │  │ and never argues │ │              of an idea    │   │
 │             │  │ for it…          │ │                            │   │
 │             │  ├──────────────────┤ │                            │   │
 │             │  │ ONE WAY TO   (i) │ │                            │   │
 │             │  │ PICTURE IT       │ │                            │   │
 │             │  │ Like a path      │ │                            │   │
 │             │  │ through a field… │ │  ← the model's own frame,  │   │
 │             │  ├──────────────────┤ │    labelled as the model's │   │
 │             │  │ ASSUMED IN     4 │ │    the way `background` is │   │
 │             │  │  ‹  2 of 4   ›   │ │                            │   │
 │             │  │  k3m9qt qw82nf   │ │                            │   │
 │             │  │  b7x1pd m4n0zz   │ │                            │   │
 │             │  └──────────────────┘ │                            │   │
 │             ├───────────────────────┤                            │   │
 │             │ WHAT THIS PIECE     4 │                            │   │
 │             │ ADDS                  │                            │   │
 │             ├───────────────────────┤                            │   │
 │             │ ▸ A world that stops  │                            │   │
 │             │   writing is a world  │                            │   │
 │             │   that stops thinking │                            │   │
 │             │ ▸ …                   │                            │   │
 │             ├───────────────────────┤                            │   │
 │             │ Find them again       │                            │   │
 ├─────────────┴───────────────────────┴────────────────────────────┴───┤
 │ ⊞Contents ▤Summary 📖Glossary 💡Ideas ● 🔍Search ⌸Chat  …              │
 └───────────────────────────────────────────────────────────────────────┘

 Two groups. "What you need to bring" first, because a prerequisite is
 worth having before you read and a takeaway is not.

 The first draft called the divider "a fact about each idea rather than a
 judgment about it". It is NOT a fact: a piece can assume a broad framework
 and introduce its own refinement of it, and that idea belongs in both. So
 the divider is the model's CLASSIFICATION, drawn like every other thing
 the model asserts here, and the ambiguous cases are what to look at first
 on a real article.

 The three labelled sections inside an open idea are the whole answer to
 "which of this is the article's and which is yours": THE IDEA and WHY YOU
 NEED IT are grounded in the piece; ONE WAY TO PICTURE IT is the model's,
 and says so — the same label-not-badge treatment `background` gets in the
 glossary, for the same reason.

 ASSUMED IN / STATED IN is the occurrence list, and ‹ › steps through it.
 The heading's word changes with the group: an assumed idea is not SAID
 anywhere, so "stated in" would be a lie about every row under it.
```

---

## The occurrence is where you NEED it, not where it is said

This is the one design decision the whole feature turns on, and getting it wrong is the difference
between a working feature and a model inventing topics.

An **introduced** idea is easy: the piece states it, so quote the sentences that state and develop it.

An **assumed** idea is the interesting case, because *the article never says it*. That is the entire
definition. So there is nothing to quote — and a model asked for quotes anyway will do one of two
things, both bad: return nothing, or invent.

So the prompt asks a different question for it: **quote the passages that would stop making sense
without it.** The sentence that takes it for granted. That is a real, checkable location — the reader
presses it, lands on the sentence, and can judge for themselves whether it does lean on the idea.

```
   introduced   →  "where is this said?"        →  quote the statement
   assumed      →  "where would I be stuck?"    →  quote what presupposes it
```

### It is a hypothesis, and the panel has to say so

**The sharpest thing in GPT Sol's review, and it changes the copy rather than the code:**

> A reader can check whether an occurrence seems relevant. They cannot verify that the author actually
> assumed the idea. The UI must therefore say something like "the model thinks this passage relies
> on…" rather than present the anchor as article provenance.

That is exactly right and it is the same discipline the glossary already runs on. A block id proves
**the passage exists**. It does not prove that the claimed assumption is the author's — and an anchor
next to a confident sentence reads as if it did. Which means an assumed idea can *launder the model's
interpretation through the article's own ids*, which is a worse failure than a wrong glossary entry,
because the machinery around it looks like evidence.

So the section heading in the panel is **"the model thinks these passages rely on it"**, not *"assumed
in"* — the [label-not-badge](../project/glossary.md#provenance-is-the-label-not-a-badge) rule, applied
to the half of this feature that needs it most.

And the counterfactual has to be **bounded**, or the model satisfies the wording with *"institutions
shape behaviour"* and *"correlation is not causation"* — true of almost any text, needed by none of it
in particular. So each assumed occurrence must name the **local inferential move**: what the passage
says, what connection fails without the idea, and why *this* idea rather than general background
knowledge supplies it. That is what `reasoning` is for, and it is a harder question than search's
*"why does this match"*.

Both kinds come back as the same shape, so downstream nothing branches:

```ts
export interface IdeaOccurrence {
  blockId: BlockId;
  /** Verbatim from that block. The anchor is the id; this finds the words in it. */
  quote: string;
  /** One line: what this passage does with the idea. */
  reasoning: string;
  /** Where `quote` sat in `block.text` — a disambiguator, never the anchor. */
  start?: number;
}
```

Which is [`SearchHit`](../../src/types.ts) minus `confidence`, and dropping that field is deliberate:
a search hit's confidence answers *is this what you asked for*, and here **nobody asked a question**,
so there is nothing for a number to be confident about. A confidence on an idea would be the model
scoring its own homework with no question to score it against.

That absence is already a supported shape downstream. `Found.confidence` is `number | null`, and
`null` is what a **literal** word-match carries — it too is a passage with a place and no opinion
attached. So an idea occurrence travels the existing pipe with the confidence column simply empty,
and [the trap that null must survive a threshold rather than read as zero](../../src/web/search-hits.ts)
is already guarded and already tested.

### Every occurrence is checked before it is believed

Copied wholesale from `validateHits` in [`src/search.ts`](../../src/search.ts):

- a `blockId` not in `blocks.json` is **dropped** and counted (`unknownIds`);
- a `quote` that [`findQuote`](../../src/quote-match.ts) cannot locate in that block is **dropped**
  and counted (`unquoted`);
- more than six occurrences on one idea is truncated and counted.

And then the rule that is *not* the glossary's: **an idea left with zero occurrences is dropped, not
kept.** The glossary deliberately keeps a term that matched nothing and says so, because an unmatched
entry is still a definition you can read and the emptiness is a signal worth seeing. An idea with no
occurrence is a claim with no evidence and no way back to the page —
[principle 4](../project/vision.md#principles) says anything the model asserts is anchored to a block
id the reader can reach in one action. An idea that points nowhere fails that outright, and it is also
exactly the failure mode to expect: the model naming a general topic instead of finding a load-bearing
assumption. The count goes in the log line beside the other three.

---

## Highlighting, and the rail

Greg, 2026-08-26, asked for:

> Ideally highlight all the places it occurs (as per the Search mode) and scroll to the first? (There
> should also be a way in both Ideas and Glossary modes to jump to prev/next exemplifying block)

So: **reuse the search machinery, not the glossary's.** The glossary underlines a *word*; ideas wash a
*passage*, which is what search already does, down to the `┃` border scaled harder than the fill
([search.md § Drawing the marks](../project/search.md#drawing-the-marks-and-the-wall-that-wasnt-there)).

And the reuse goes much further than styling, because
[`search-hits.ts`](../../src/web/search-hits.ts) already frames itself as **two matchers, one
downstream**: a literal word search and a meaning search both resolve into one `Found[]`, and
everything after that — the marks, the paragraph bar, the rail, the ordering — reads only `Found`.

```
   words matcher  ──┐
                    ├──►  Found[]  ──►  hitMarks   ──►  the prose
   meaning search ──┤                   blockHues  ──►  the paragraph bar
                    │                   blockMatches ─► spineMarks ─► the rail
   ideas          ──┘                   orderFound ──►  the list, and prev/next
     (new: its own resolver, its own band)
```

`Found` is not search-shaped by accident — it is *a passage, from a source, with a place and a
strength*. So the work is **one resolver**, `resolveIdea(blocks, ideaId, slot, occurrences): Found[]`,
sitting beside `findLiteral` and `resolveHits`. Everything downstream is untouched:

| | What it takes | Change needed |
|---|---|---|
| Finding the words in the block | `findQuote`, [`quote-match.ts`](../../src/quote-match.ts) | **none** — already the one rule both sides share |
| Marks in the prose | `hitMarks(found, openKey)` | none |
| The whole-paragraph fallback | already in the `Found` builder (`whole: true`) | none |
| The paragraph bar and wash | `blockHues`, `blockStrength` | none |
| The rail | `blockMatches` → `laneOrder` → `spineMarks` | none — it already draws N lanes |
| Ordering, and therefore prev/next | `orderFound(found, "document")` | none |
| Bringing the rail back on entering the mode | [`Dock.tsx`](../../src/web/Dock.tsx) `onMode` | one more mode name in one condition |

**So there is no new `MarkKind` and no new colour token**, which is a reversal of this plan's first
draft and worth saying why. A fourth kind would have cost the union one entry and one `if` — genuinely
cheap — but it would also have cost `data-idea`, `--idea-a`, a `§ ideas mode` stylesheet block and a
`--idea-rgb` in [`tokens.css`](../../styles/tokens.css), *and* it would have cut ideas out of
`hitMarks`, which hard-codes `kind: "hit"`, and therefore out of the whole pipe above.

**An idea takes a real palette slot, from `assignSlots` — and the reason is the paragraph bar, not the
rail.** This plan's first draft said `slot: null` would make every idea share the literal matcher's
lane. **That is wrong**, and GPT Sol caught it: lane identity is the *run id*, not the slot —
`blockMatches` and `laneOrder` both key on `runId ?? ""`. An idea carrying `runId: idea.id` gets its
own lane whatever its slot is.

The real reason to give it a slot is one line further on: `blockHues` **deliberately drops null slots**
(*"a words search has no colour and cannot be one of several"*), so a null-slot idea would paint the
rail and leave the paragraph bar blank. Right conclusion, wrong reason — worth recording, because the
wrong reason would have survived into a code comment.

**And a slot needs a stable input, which an `Idea` has not got.** `assignSlots` takes
`{ id, createdAt }[]` and walks them oldest-first, so colours stay put when a search is added. An idea
has no `createdAt`, and handing every idea the artefact's single `generatedAt` makes the walk order
arbitrary — so **regenerating could recolour the whole set**. The rule has to be written down rather
than inherited: assign from `(id, index-in-artefact)`, with the artefact's order fixed at write time.

The honest cost of reusing `hit`: search marks and idea marks are the same thing in the DOM, so a
future feature that put both on screen at once could not tell them apart. Today it cannot arise —
[one mode owns the band at a time](260826a-chat-mode.md), and leaving a mode takes its marks with it — but
that is a fact about the app, not a property of the markup, so it is written down here rather than
assumed. The **semantic debt** is real and should be paid the moment a third non-search feature wants
this pipe: `data-hit`, `hitMarks` and a dozen comments will then mean *the selected passage set*
rather than *search*, and the fix is renaming the abstraction rather than adding a third alias to it.

### Search and Ideas must not share one `found`

**The most expensive thing GPT Sol found, and it would have shipped.** `Reader` holds a single
`found` state. `SearchBand` pushes into it from a **layout** effect and clears it from a **passive**
unmount cleanup, and both of those choices are deliberate and commented. Point an `IdeasBand` at the
same state and switching from search to ideas does this:

```
   commit: SearchBand unmounts, IdeasBand mounts
     │
     ├─ IdeasBand's LAYOUT effect       → found = [the idea's passages]     (before paint)
     │
     ├─ ...paint...
     │
     └─ SearchBand's PASSIVE cleanup    → found = []                        (after paint)
                                           ▲
                                           └── the ideas are gone, and nothing errored
```

Passive cleanups are flushed after paint; layout effects run before it. So the outgoing mode's tidy-up
runs *after* the incoming mode has already written, and wipes it. It does not happen today only
because glossary clears `term` and search clears `found` — two different pieces of state.

So: **Search and Ideas get separate state, and `Reader` picks by mode.** One line — `const passages =
mode === "ideas" ? ideaFound : found` — feeding the same memos downstream, so ownership is explicit
and there is nothing to race. Copying `SearchBand`'s effect pair into `IdeasBand` unchanged is the
thing not to do, and it is exactly what "reuse the pattern" would have led to.

**The whole-paragraph fallback comes across free.** Where `findQuote` cannot find the words, the block
is washed and the row says so — *"whole paragraph — the exact words have moved"* — rather than marking
nothing. Same trade search made: marking nothing throws a good answer away over a whitespace
difference, marking the wrong words is worse than either. And the same trap, which is already handled
in the code being reused: **whether the fallback fired is read from `findQuote`'s own answer**, never
inferred from "the span covers the whole block", which is a fact that usually but not always agrees
([silent-success.md](../reusable/silent-success.md)).

### The rail is the half a list cannot give you

The strongest argument for this feature is in [search.md § The rail](../project/search.md#the-rail-and-the-shape-of-a-search),
and it transfers exactly:

> The results list can tell you *what* matched and the marks in the prose can tell you *where a
> particular one is*. Neither can tell you the thing you actually want to know after running a search:
> **what shape is it.**

For an idea the shape is the whole point. **An idea threaded evenly through a piece is that piece's
spine; an idea concentrated in one section is a digression** — and those two are the same list row.
Only the rail can tell them apart, and the marks are placed from the spine's own **measured pixel
geometry**, never from a character ruler, for the reason
[§ The ruler](../project/search.md#the-ruler-which-is-the-thing-this-could-have-got-silently-wrong)
gives: twenty one-line list items hold few characters and many pixels, and a bird's-eye rail pointing
confidently at the wrong section is worse than no rail.

**One lane, for the selected idea.** Not one per idea: with six ideas the eight-hue palette would
divide a 24px gutter into six three-pixel tracks and say nothing legible. The N-lane code path already
exists, so *toggle several ideas on at once* is a v2 that costs a UI control and no arithmetic — noted
in [§ What this deliberately does not do](#what-this-deliberately-does-not-do) rather than built.

---

## Prev / next, in both modes

Greg asked for this in **both** Ideas and Glossary, so it is shared rather than a feature of either.

**Nothing generic exists today, and the thing closest to it is the comment stepper.**
[`comment-nav.ts`](../../src/web/comment-nav.ts) has three tiny pure functions — `orderComments`,
`stepComment`, `positionOf` — and only the first is genuinely `Comment`-typed; the other two need no
more than `{ id }`. [`CommentDialog`](../../src/web/CommentDialog.tsx) already renders exactly the
control this needs — arrows, `N / M`, drawn only when there is more than one. Search has no stepper at
all, so this is net-new UI either way.

So: **generalise the two that are already generic, and copy the control.** A `<BlockNav>` taking an
ordered list, the current id, and `onJump`.

Three decisions, and two of them are *matching an existing convention rather than choosing*:

- **It does not wrap.** At the last occurrence, *next* is disabled. This plan's first draft had it
  wrap, on the grounds that a greyed-out arrow explains what "4 of 4" already says. That is a
  perfectly good argument and it is the wrong one to win here: `stepComment` **deliberately** does not
  wrap, and two steppers three inches apart behaving differently on the same gesture is worse than
  either rule on its own.
- **Stepping does not jolt; selecting always jumps.** The two precedents are both deliberate and both
  commented. `goToComment` scrolls only `if (!isBlockOnScreen(target.blockId))`; a search result's
  `onOpen` **always** jumps, because *"I pressed it and nothing moved" is the complaint that makes a
  results list feel broken*. Both are right, for different gestures: pressing an idea is arriving
  somewhere, so it jumps; stepping ‹ › is moving between neighbours, so it leaves you alone when the
  next one is already in front of you.
- **Buttons only. No key bindings.** ↑ / ↓ belong to the article ([keyboard.md](../project/keyboard.md)),
  and [glossary.md § What is still open](../project/glossary.md#what-is-still-open) records that
  taking them inside the band needs a focus story the band has not got. → [question 3](#questions-for-greg).

**An occurrence needs an identity, and a block id is not one.** One idea can occur twice in the same
paragraph, so `stepComment`-style navigation keyed on `blockId` would silently collapse *4 of 6* into
*4 of 5* and skip one. The key is `${ideaId}:${blockId}:${n}` — the same shape search already needed
for exactly this reason, where `blockId` alone was tried first and was not unique. That gives four
things the first draft left undefined: what the stepper's *current* is, what changes it, how an arrow
turns into a block jump, and what *2 of 4* counts.

**And it counts what survived, not what the model returned.** After a re-extraction some occurrences
resolve and some do not, so the panel's *n of m* and the marks in the prose must be built from **one**
resolved list. Two counts derived separately is the panel and the article disagreeing about how many
places there are — the failure this codebase keeps catching in other clothes.

**Ordering is free on the ideas side and needs care on the glossary side.** Going through `Found[]`,
`orderFound(found, "document")` has already done it. The glossary's `entry.blocks` is a `BlockId[]`
built in `blocks.json` order by `findOccurrences`, so it is already right — but the warning at the top
of `comment-nav.ts` applies to whoever touches it next, and it is emphatic: **document order comes
from the index in `blocks.json` and never from the id string.** Sorting by `blockId` compiles, runs,
and is meaningless. (`orderComments` itself stays comment-specific; only `stepComment` and
`positionOf` are worth widening.)

**In the glossary this goes inside the existing `▸ used in 3 places` disclosure**, which today lists
the occurrence blocks as `<BlockRef>` chips and offers no way to step between them. A strict addition;
nothing there changes.

### Selecting scrolls — which the glossary already does

Selecting an idea scrolls to its first occurrence. That is Greg's ask, and it is also **exactly what
the glossary does today**: `GlossaryPanel` jumps to `entry.blocks[0]` on select, unconditionally, and
pressing the selected term again clears it. So this is consistency with the sibling mode rather than a
new behaviour, and there is nothing here for Greg to veto — the question that was in this slot in the
first draft has been deleted rather than asked, because it was asked from a wrong reading of the code.

---

## The artefact and the stage

`data/<slug>/ideas.json`, written by **stage 5f**, [`src/ideas.ts`](../../src/ideas.ts).

```ts
export interface Idea {
  /** `mintId`, so it is a block id by construction and `?idea=` validates for free. */
  id: string;
  /** The idea as a handle — a short proposition, three to ten words. */
  name: string;
  provenance: "assumed" | "introduced";
  /** The idea itself, stated so you could carry it to a different article. */
  statement: string;
  /** What stops making sense without it. Load-bearing for `assumed`, optional for `introduced`. */
  whyYouNeedIt?: string;
  /** The model's own frame, labelled as the model's. Absent is a real answer. */
  analogy?: string;
  occurrences: IdeaOccurrence[];
}

export interface Ideas {
  version: string;          // PROMPT_VERSION, "ideas/1"
  generator: string;        // CAPABLE_MODEL
  slug: string;
  sourceHash: string;       // hashBlocks — src/source-hash.ts, the same function as everywhere
  profileHash?: string | null;
  ideas: Idea[];
  generatedAt: string;
  elapsedMs: number;
}
```

**Four of those fields are copied deliberately rather than invented**, because
[`hashBlocks`](../../src/source-hash.ts) moved into its own module precisely so that two stages could
not compute "the same" fingerprint two ways and disagree about what *current* means.

### Where it sits in the pipeline

| | Value | Why |
|---|---|---|
| `STEP_ORDER` | after `glossary` | so it sorts, and so the API accepts the name |
| `DEFAULT_INGEST_STEPS` | **not in it** | the rule `tweets`, `glossary` and `summary` established: everything up to `arc` makes the article readable, everything after it is a thing somebody asks for |
| `FORCE_ONLY_WHEN_NAMED` | **in it** | it reads `blocks.json` and `tree.json` and nothing reads what it writes, so the positional cascade would buy a model call for nothing |
| `STAGE_EFFORT` | its own entry | effort is part of the prompt-cache key, so this table is the grouping and a second list beside it could quietly disagree |
| `stamp` | see below | **not** `isDone` — the comparison belongs in `sameStamp`, and only the values belong to the stage |

### Freshness, and the two holes not to inherit

This plan's first draft said the stage would check *"`sourceHash` + `PROMPT_VERSION` + model +
`profileHash`, the four the glossary checks."* **The glossary checks three.** Its `stamp` returns
`{ inputHash, promptVersion, model }` and nothing else, and `stepIsDone` compares exactly that. There
are two holes in it, both already known, and the cheap mistake here is to copy them because copying is
what makes a new stage look consistent.

**Hole one — the profile is not in the stamp.** The artefact *records* a `profileHash` and the panel
*reports* that the reader's profile has moved, but nothing makes the step re-run. For the glossary
that is a defensible gap. **For Ideas it is close to fatal**, because "what you need to bring" is not
merely pitched at the reader — it is *defined by* them. An ideas list written for last month's profile
is not stale, it is answering a different question. So `profileHash` goes **in the stamp**, and Ideas
is the stage that forces the `StepStamp` type to grow the field.

**Hole two — `inputHashFor` hashes the blocks and not the tree.** `StepStamp`'s own docstring flags
this: *"`arc`, `tweets`, `glossary` and `summary` all read the tree as well as the blocks, and
src/labels.ts already keeps a separate `structureHash` precisely because section boundaries can move
without a single block changing."* Ideas reads the tree too — the skeleton is what lets it judge what
is load-bearing. So its input hash is **blocks plus structure**, and the docstring's *"stage-5 job for
each step's owner"* is this stage claiming its half of that job.

### It is not a file, it is an artefact — and that is most of the work

**This plan's first draft said `data/<slug>/ideas.json` and stopped there, which was written against
an architecture this repo has moved past.** Storage now goes through a store abstraction, and a new
pipeline artefact has a checklist:

| Where | What |
|---|---|
| [`src/store/artifacts.ts`](../../src/store/artifacts.ts) | `"ideas"` in `ArtifactKind`, and its type in `ArtifactMap` |
| [`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts) | the file-backed adapter, keyed `(step, kind)` |
| [`src/store/contracts.ts`](../../src/store/contracts.ts) | `loadIdeas` on `ArticleReader`, beside `loadGlossary` and `loadSummaries` |
| [`src/db/schema.ts`](../../src/db/schema.ts) | a whole-artefact JSONB column on `article_revisions`, and `"ideas"` in the `revision_step_runs` CHECK constraint |
| `src/store/pg-*.ts` | the Postgres reader |
| [`src/store/import.ts`](../../src/store/import.ts), [`export.ts`](../../src/store/export.ts) | both directions, plus `ARTEFACTS` in `tests/store-roundtrip.test.ts` |
| [`tests/store-artefact-manifest.test.ts`](../../tests/store-artefact-manifest.test.ts) | `HOMES`, with the destination written down |

**That last one is not a chore, it is the thing that will tell you this list exists.** It asks the
*filesystem* what artefacts are there and holds the answer against a hand-written list, and its own
header says why: the migration was written against a schema already a day behind, five artefacts had
no home at all, and *"every check shared the same assumption about what exists"*. So a new
`ideas.json` turns up as **a red test rather than as archaeology**, and skipping the rest of the table
gives you a feature that works perfectly on a laptop and is silently absent in production.

The rule that test states, applied here: ideas is a **pipeline artefact**, so it is a JSONB column on
the revision — not reader state, and never a revision-keyed blob pretending to be one.

### The other five lists

`STAGE_EFFORT` alone is not enough, and the names are easy to miss because they live in one file:
`Task` and `TASK_TIER` in [`src/models.ts`](../../src/models.ts) decide which model tier runs it,
`PIPELINE_TASKS` is what the startup check walks, and `ArticleStage` + `STAGE_EFFORT` are what decide
prompt-cache grouping. Plus the three in `pipeline.ts` this plan already named. **Eight lists, and a
stage missing from any one of them fails in a different place.**

### No pagination, and therefore no append

The glossary paginates because its list is unbounded — an article can hold an encyclopaedia of terms,
and the [504s that shaped that feature](../project/glossary.md#one-the-answer-is-what-times-out-not-the-question)
were caused by output length. **A piece does not have forty ideas.** It has three to ten. So:

- one call, `suggestedIdeas(words)` = one per ~800 words, clamped to **3–10**;
- at most **six** occurrences per idea;
- `budgetFor("ideas", 400 + count * 420)` in [`token-budget.ts`](../../src/token-budget.ts) — the
  honest ceiling, which the previous version did not have and which is why their cap was the only
  thing between them and a truncated response.

And with no append, an entire class of glossary complexity does not exist here: no FORBIDDEN
checklist, no `existingFor`, no `passes`, no *"a stale glossary is not appended to"*, and no `DELETE`
route — because **re-running the step already is "start again"**. One button, *Find them again*, which
forces the step.

**Ids are still inherited across a regeneration — but the promise is weaker here than in the
glossary, and it has to be stated that way.** `idsByName` matches on the normalised name, which works
for a glossary because *"United States of America"* comes back spelled the same way twice. **An idea's
name is a sentence**, and a regeneration will paraphrase it — *"Writing is a test of thought"* and
*"Prose is where thinking is tested"* are the same idea and will not match.

So `?idea=` links survive an unchanged name and nothing more. Two ways to go, and the choice is worth
making deliberately rather than discovering:

- **Say so** — the link is best-effort, and a rewrite may orphan it. Honest, and cheap.
- **Match on name plus occurrence overlap** — two ideas are the same if their blocks largely agree.
  Better recall, and it is the shape a fuzzy match should take here, because the *evidence* is stable
  even when the wording is not.

What must not happen is casual semantic matching. **Inheriting an id wrongly is worse than minting a
new one**: a stale `?idea=` link that lands on nothing is a dead end the reader can see, and one that
lands on a *different* idea is a dead end that looks like it worked.

### The profile is not an afterthought here

[reader-profile.md § The glossary is the case this feature is really for](../project/reader-profile.md#the-glossary-is-the-case-this-feature-is-really-for)
argues that a difficulty score is a property of the *pair* rather than of the term. **Ideas is a
stronger version of that claim**, and arguably the case the profile is really for: "what you need to
bring" is *entirely* a function of who is reading. A physicist reading a physics essay assumes nothing;
the same essay for a lay reader is three assumed ideas deep before its first argument.

So `profileSection` in the user prompt (never the `system` block — the article is up there with the
breakpoint on it), `PROFILE_RULES` in `SYSTEM`, `profileHash` on the artefact, and the profile frozen
by whoever queued the job rather than read here.

---

## The prompt, and the one line the whole feature rests on

Full text in the implementation. The parts that are decisions rather than wording:

**The unit rule**, which is the glossary boundary made operational:

> An idea is not a word. A word goes in the glossary. An idea is something you have to HOLD IN YOUR
> HEAD — a claim, a frame, a way of carving something up — and a reader who does not have it will
> follow every sentence and still miss the piece.

**The anti-summary rule**, which is the guard rail against
["Read this in 2 minutes"](../project/vision.md#anti-goals):

> Never write an idea whose content is "the article's section about X". An idea is something the
> reader could carry OUT of this article and use on a different one. If your statement only makes
> sense as a description of this piece, it is not an idea — it is a summary, and this is not the
> summary.

**The assumed-occurrence rule**, from [§ The occurrence](#the-occurrence-is-where-you-need-it-not-where-it-is-said):

> For an "assumed" idea the article does NOT state it. Do not go looking for where it is said. Quote
> the passages that would STOP MAKING SENSE without it — the sentence that takes it for granted.

**The analogy rule**, with the glossary's hardest-won lesson attached:

> "analogy" is optional, and it is yours rather than the author's. A concrete everyday thing this idea
> works like. Only when you have one that genuinely helps — a strained analogy is worse than none, and
> the reader is told this one is yours. **Leave it out rather than reach.**

Two things carried over from the glossary because they cost a round trip each to learn there:

- **A prompt ban relocates a register, it does not delete one**
  ([glossary.md](../project/glossary.md#a-prompt-ban-relocates-a-register-it-does-not-delete-one)).
  Banning the describes-the-page voice in `statement` will push it into `whyYouNeedIt`. So the ban is
  on **both** fields explicitly, and both carry the give-away openers — *"The article argues"*, *"This
  section explains"*, *"The author's point that"*.
- **A negative example beats a rule**, because the failure is a register rather than a mistake. The
  prompt carries one bad idea verbatim, of the shape this feature will actually produce:

  > BAD — name: "The dangers of AI writing", statement: "The article argues that letting AI write will
  > harm our ability to think."
  > That is the piece's third section with a label on it. It is not something you could take anywhere.
  >
  > GOOD — name: "Writing is a test of thought, not a record of it", statement: "Prose that hangs
  > together is evidence the thinking hung together; you cannot fake the first without doing the
  > second. So anything that produces the artefact without the process breaks the test."

Structure of what the model is shown: **the skeleton before the full text**, the same order the arc,
the thread and the glossary use, so it judges what is load-bearing against the shape of the argument
rather than against how often a phrase appears.

### Where these bans will relocate to

The glossary's lesson is that a ban moves a register rather than deleting it, so the useful question is
*where to*. GPT Sol's predictions, which are specific enough to test against a first run:

| The ban | Where it goes instead |
|---|---|
| don't summarise | section theses with the nouns abstracted, relabelled as ideas |
| don't describe the page, in `statement` | into `whyYouNeedIt` |
| find what is assumed | the model's *interpretation*, dressed as a prerequisite |
| analogy is optional | strained analogies anyway, because a field invites filling |
| this is not the glossary | background knowledge relocating into idea *names* and into occurrence `reasoning` |

And the outputs to expect that the first draft did not anticipate: universal background truths;
themes wearing proposition clothes; moral or political judgments attributed to the author; the same
idea paraphrased into both groups; five ideas all citing the one convenient paragraph; "assumed" ideas
that the article states plainly somewhere else in different words; and conclusions the *model* drew
being filed as things the article introduced.

**So one negative example is not enough.** The glossary needed one because it had one failure mode.
This has at least four, and each needs its own:

1. a generic truth almost any text needs;
2. something that is really a glossary term;
3. a theme rather than a proposition;
4. an interpretation *compatible* with a passage but not *required* by it — the one that matters most,
   because it is the one that will look right.

Plus **one strong positive example of an assumed idea** that names the precise inferential bridge,
since the prompt is asking for something the model has no natural register for.

**Parse and salvage per idea**, the way the summaries do — one malformed entry must not take the other
seven with it — and log **counts only**: proposed, accepted, rejected-by-reason, zero-survivor. Never
idea prose, never occurrence quotes, never the raw parse failure, which quotes the article back into
the log.

---

## Why this is not a wider glossary

The obvious cheaper design is `kind: "idea"` on a `GlossaryEntry`. Three things break:

1. **The glossary's spine is that `blocks` is computed by us, never asked of the model.** That is a
   real safety property — the model is never shown a block id, so it cannot invent one, and a mistake
   can only ever be about *where* a term is, which the reader sees the moment they press it. An idea
   has no name to match, so it needs the model to name block ids, which means the *other* discipline
   (validate every id against `blocks.json` and count the drops). Two anchoring paths in one artefact
   is two ways for the panel and the prose to disagree.
2. **One list, two units.** Twenty-four terms and five ideas sorted by first use is a list where the
   ideas are lost, or a list where five rows in a different shape interrupt a scan. And the identity
   *"the terms this piece uses"* stops being true, which is the sentence the whole feature is built
   around.
3. **The prioritised order does not transfer.** `difficulty × centrality ≥ 0.30` gating twenty-four
   terms into two groups is doing work. Gating six ideas would divide them four-and-two and put a
   confident label over an arithmetic accident — which is
   [the exact failure `PRIORITY_GATE` was made absolute to avoid](../project/glossary.md#prioritised-which-is-now-the-default).

What it *does* reuse is everything that made the glossary cheap: the [mode band](260826a-chat-mode.md) slot
(zero layout arithmetic — `fitView` knows about the slot, not about chat), the button-on-demand rule,
the `sourceHash`/version/model/profile staleness quartet, and the label-not-badge provenance treatment.

**They are deliberately not deduped against each other.** The alternative — pass the glossary's names
into the ideas prompt as a FORBIDDEN list — would make `ideas.json` depend on `glossary.json`, which
means a stale or absent glossary silently changes what ideas you get, and `sourceHash` would not
capture it. A hidden input that staleness cannot see is the shape of a bug nobody can diagnose. So the
distinction is carried by the prompt's unit rule, the risk is that a central coinage appears in both
lists, and that risk is stated rather than engineered away. → [question 4](#questions-for-greg).

---

## Say the awkward thing first

*An "Ideas" list is a summary of the argument by another name.* That is the honest objection, and
[260826a-chat-mode.md](260826a-chat-mode.md#say-the-awkward-thing-first) set the precedent that it goes at the top of
its own section rather than in a footnote.

Four things keep it on the right side of
[the anti-goal](../project/vision.md#anti-goals), and one of them does not:

1. **Every idea is anchored to blocks you can press.** Principle 4, and the validation drops anything
   that is not.
2. **An `assumed` idea is not in the article at all**, so it cannot substitute for reading it. That
   half of the feature is unambiguously additive: it is the reader's *prerequisites*, and nothing else
   in the app produces them.
3. **It is a mode you open**, not marks injected into the prose on the model's initiative — the line
   [the glossary refused to cross](../project/glossary.md#what-we-deliberately-do-not-do).
4. **The rail shows a shape a summary cannot.** An idea threaded through five scattered paragraphs has
   no home in a positional summary, because it is not *in* a section.

**Where it is weakest: an `introduced` idea's `statement` genuinely is a compressed version of the
article's claim.** There is no getting round that. The defence is that
[Summary mode](../project/summaries.md) already does compression, openly, and this is a *different
axis* on the same material — summary is positional (this part, at this length), ideas is conceptual
(this thread, wherever it runs).

### The concession above is aimed at the wrong half

GPT Sol's, and it is right:

> `introduced` is the redundant half, but it is also the **checkable** half. A reader can compare the
> proposed idea with the passages and reject it. `assumed` is the distinctive and valuable half, but
> also the **weakly falsifiable** one. It risks laundering the model's interpretation through block
> anchors: the block proves the passage exists, not that the claimed assumption belongs to the author.

So the two halves fail in opposite directions, and the plan had only noticed one of them:

```
                    valuable?          checkable?
   introduced   │   redundant      │   yes — compare it with the passage
   assumed      │   unique         │   no  — the anchor proves the passage, not the premise
```

Which reverses the risk ranking. `introduced` is the half to *cut* if it does not earn its place, and
you will be able to tell. `assumed` is the half to *distrust* even when it looks good — hence
[§ It is a hypothesis](#it-is-a-hypothesis-and-the-panel-has-to-say-so), and hence an eval before any
UI is built.

### The argument this had missed, and the objection it had ducked

**Missed, in its own favour:** the list is not the product — **the thread is**. Selecting an idea and
watching it appear, vanish and return down the rail shows how a proposition is *developed* across a
piece, which is not visible from reading linearly and is not expressible in a positional summary. That
is a better argument for the feature than anything in the section above, and it is the one most
aligned with what this app is for.

**Ducked, against it:** naming "the ideas you need" may replace exactly the synthesis the product
exists to provoke. [vision.md](../project/vision.md) wants the reader to *"internalize and
interrogate"*; handing them a finished inventory of what to understand is doing the interrogating for
them. The mitigation is the same as everything else here — **present them as hypotheses to test
against the passages, not as an authoritative list** — and it is a mitigation rather than an answer.

---

## What this deliberately does not do

- **No difficulty / centrality scores, and no threshold slider.** The glossary's whole apparatus
  exists because twenty-four terms need triage. Six ideas do not, and a gate over six items invents a
  ranking that is not in the data — the failure that made `PRIORITY_GATE` absolute rather than
  relative. → [question 2](#questions-for-greg).
- **No per-idea web check.** The glossary's *Check the web* button exists because `background` is the
  model's unverified memory of a real-world fact. An idea's `statement` is a claim about *this
  article*, which the occurrences already let the reader check directly. The `analogy` is not a fact,
  so there is nothing to look up.
- **No multi-select in the rail.** One lane, for the selected idea. Every piece needed for several at
  once is there — real slots, packed lanes, per-source keys — so this is one control away rather than
  a rebuild, and it is left out only because six ideas dividing a 24px gutter into six three-pixel
  tracks says nothing legible.
- **It does not stream.** It goes through the job queue with `JobProgress`, exactly as glossary and
  summary do — which means a reader waits behind a spinner for something the
  [streaming rule](../../CLAUDE.md) says should stream. This is not a new exception, it is joining an
  existing one: [260826o-streaming-the-slow-two.md](260826o-streaming-the-slow-two.md) is the plan for that class, and
  **ideas should be added to its list** rather than solved here.
- **Nothing generates ideas for the committed `example/` fixture** — the same gap the glossary and the
  thread page have, unsatisfying in all three places.

---

## The files

**New**

| File | What |
|---|---|
| [`src/ideas.ts`](../../src/ideas.ts) | stage 5f — the prompt, the call, the validation, the CLI |
| `src/web/IdeasPanel.tsx`, `src/web/useIdeas.ts` | the band |
| `src/web/BlockNav.tsx` | `‹ 2 of 4 ›`, shared with the glossary — the control copied from `CommentDialog` |
| `tests/ideas.test.ts` | the four validation drops, per-idea salvage, id inheritance, staleness (**including profile and tree**), and that the prompt carries the profile |
| `tests/block-nav.test.ts` | the position arithmetic — both ends, "the reader is before the first", **two occurrences in one block**, and an occurrence whose block is gone |
| `evals/ideas/` | the human-scored pass on assumed ideas, **before any UI** |
| `docs/project/ideas.md` | the operating manual, once built — **plus its line in the CLAUDE.md table** |

**Changed — and this list is three times the first draft's, which is the review's main finding**

*Storage* (§ [It is not a file, it is an artefact](#it-is-not-a-file-it-is-an-artefact-and-that-is-most-of-the-work)) —
`src/store/artifacts.ts` · `artifacts-fs.ts` · `contracts.ts` · `import.ts` · `export.ts` ·
`src/db/schema.ts` (JSONB column + the `revision_step_runs` CHECK) · a Postgres reader · a migration ·
`tests/store-artefact-manifest.test.ts` · `tests/store-roundtrip.test.ts`.

*Pipeline and models* — `src/pipeline.ts` (`STEP_ORDER`, `DEFAULT_INGEST_STEPS`,
`FORCE_ONLY_WHEN_NAMED`, the step, and a tree-aware input hash) · `src/models.ts` (`Task`,
`TASK_TIER`, `PIPELINE_TASKS`, `ArticleStage`, `STAGE_EFFORT`) · `src/store/artifacts.ts` again, for
`StepStamp` growing a profile field · `src/token-budget.ts`.

*Server* — `src/types.ts` · `src/api.ts` (`loadIdeas`) · `src/routes.ts` (`GET /api/ideas/:slug`).

*Client* — `src/web/params.ts` (`MODES`, `ideaParam`) · `Dock.tsx` (`MODES_UI`, rail-on-entry) ·
`App.tsx` (`IdeasBand`, **and its own state rather than search's `found`**) · `search-hits.ts`
(`resolveIdea`, plus lifting the whole-paragraph fallback out of `resolveHits` so both callers share
it) · `comment-nav.ts` (`stepComment` / `positionOf` widened to `<T extends { id: string }>`) ·
`GlossaryPanel.tsx` (`BlockNav`).

*Docs* — `docs/project/ideas.md` (new, plus its CLAUDE.md line) · `architecture.md` (stage 5f, and
**Summary stays 5e**) · `glossary.md` · `url-state.md` · `vision.md` · `search.md`.

**Not changed, which is still the point**: `annotate.ts`, `spine-marks.ts`, `hit-colours.ts`,
`quote-match.ts`, `scroll.ts`, `Spine.tsx`, `TableView.tsx`, `tokens.css`, and the search half of
`styles.css`. The *drawing* really is free. Everything above it is not.

**Not changed, which is the point**: `annotate.ts`, `spine-marks.ts`, `hit-colours.ts`,
`quote-match.ts`, `scroll.ts`, `Spine.tsx`, `TableView.tsx`, `tokens.css`, and the search half of
`styles.css`.

### Run the eval before building any of it

**The one sequencing change GPT Sol's review makes to this plan.** No unit test can establish that
"assumed" means what [§ It is a hypothesis](#it-is-a-hypothesis-and-the-panel-has-to-say-so) says it
means — that is a question about model behaviour, and this repo already has the place for it:
[`evals/`](../../evals/README.md), run by hand, results committed so the next change is compared
against a number rather than a memory.

So: a human-scored pass over a handful of varied articles, scoring each proposed assumed idea on *is
this really assumed, or is it (a) a universal truth, (b) a glossary term, (c) a theme, (d) the model's
reading?* If the prompt cannot reliably clear that bar, **the feature is the `introduced` half only**,
and it is much better to learn that from an eval than from a finished panel.

### The states this has to draw

Enumerated because *"there is no artefact yet"* is only the first of nine, and the panel that handles
one of them and falls through on the rest is the usual way this goes wrong:

no artefact · job running · generation failed · a valid **empty** result (a real answer, and not the
same as a failure) · artefact stale because the article moved · profile changed since it was written ·
partial salvage (seven ideas of eight) · article unavailable · **every occurrence of the selected idea
lost after a re-extraction**.

That last one is the interesting one. Validation at generation time is not enough: after a
re-extraction block ids can be gone, quotes can no longer match, and a `?idea=` in somebody's URL can
name an idea that no longer exists. So the occurrence list and the *n of m* are built from **surviving
resolved** occurrences, and *"we can no longer find this idea in the article"* is a sentence the panel
has to be able to say.

### The fixture, and why "same gap as the glossary" is not good enough here

`example/` is committed, is not writable, and would show a **Find ideas** button that can never
succeed. The glossary and the thread page have the same hole and it is unsatisfying in all three
places — but *"consistent with an existing wart"* is not a decision. Either hand-author an
`ideas.json` for the fixture, or disable the button there with copy that says why. A button that
cannot work is worse than no button.

### Accessibility and the bottom bar

- The `‹ 2 of 4 ›` control copies `CommentDialog`'s treatment including its `aria-live`, so a
  screen-reader user hears the position change rather than only seeing it.
- **Selection must not be carried by colour alone** — the wash and the lane are colour; the selected
  row needs a non-colour state too.
- **Nine buttons wants a real device pass.** The dock is one flex row of large buttons and its
  overflow handling was not designed as a mode scroller. Touch targets, horizontal clipping, focus
  order, and — specific to this feature — whether jumping between successive occurrences fights the
  momentum scrolling [touch.md](../project/touch.md) is careful about.

### Security: nothing new, and one thing not to reach for

Ideas has no URL field, so the glossary's `safeUrl` problem does not arise. Every model string here is
rendered as **React text** — never Markdown, never `dangerouslySetInnerHTML`. The only innerHTML path
in the reading view stays what it is: sanitised block HTML through `annotateHtml`. If a future version
does add a link, copy the glossary's server-side scheme check rather than trusting the renderer —
Zod's `.url()` accepts `javascript:`, which is how that check came to exist.

### The traps this will walk into

Every one of these is already written down in the code being reused, and every one of them **renders
perfectly when it is wrong** — which is why they are listed here rather than left to be met.

1. **Two offset spaces.** `block.text` ≠ `renderedText(block.html)`: the first collapses whitespace and
   inserts a space at every nested block boundary. A server-side `start` is a **hint for choosing
   between repeats**, never the anchor. Re-find by text, always.
2. **Two rulers.** `Found.at` is measured in characters; the rail is measured in pixels off the DOM.
   Using the first for the second puts marks in the wrong band and never looks broken.
3. **Identity is the source id, never the palette slot.** Slots repeat past eight, so a slot-keyed map
   silently merges the ninth thing with the first.
4. **Keys must be unique across sources** — `${runId}:${blockId}:${n}`, not `blockId`. React drops
   duplicate-keyed siblings with a warning nobody reads.
5. **The panel and the prose must be one computation.** Filter in the panel and you hide a row while
   leaving its wash on the paragraph. Compute once, hand the same array to both.
6. **`useLayoutEffect` to push results up; a separate unmount-only `useEffect` to clear them.** Plain
   `useEffect` leaves a paintable frame where the panel shows the new list and the prose shows the old
   marks; folding the clear into the same effect flickers every mark on every change.
7. **A mark naming a block that is not there is skipped, never drawn at the top.**
8. **Never sort by block id.** See above.

**Icon and bar order.** Lucide `Lightbulb`, and the button goes **after Glossary** — the modes run
"from the article's own words outwards", and Glossary and Ideas are both ways *into* the piece. That
makes nine buttons on the bar, which is Greg's hand-set order plus one and may be one too many. →
[question 5](#questions-for-greg).

**URL.** `?mode=ideas` (push, existing parser). `?idea=<id>` (**replace**, mirroring `?term=` — stepping
between ideas while you read is browsing, and `mode` already put an entry on the stack for the trip in).

---

## The cross-family review, and what it changed

Reviewed by **GPT-5.6 Sol**, 2026-08-26, read-only over the plan and the code
([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)). **Verdict: do not build as
written.** Every factual claim in it was checked against the code before being folded in here, and
every one of them held.

What it found, in the order it costs to have missed:

| Finding | Status |
|---|---|
| **The storage checklist is missing entirely** — the plan was written against a filesystem architecture this repo has moved past | Confirmed. Eight files, a migration and a manifest test that goes red. The single biggest omission |
| **Search and Ideas cannot share `found`** — a passive unmount cleanup lands after the incoming mode's layout push and wipes it | Confirmed by reading React's flush order against the two commented effects. It would have shipped |
| **Summary is already stage 5e** | Confirmed, `src/summarise.ts:2`. Ideas is 5f |
| **The freshness stamp has three values, not four** — no profile — and hashes blocks but not the tree | Confirmed, and the second hole is flagged in `StepStamp`'s own docstring as a job for exactly this kind of stage |
| **The lane-collision reason was wrong** — lanes key on run id, not slot | Confirmed. Right conclusion, wrong reason; the real reason for a slot is the paragraph bar |
| **`assignSlots` needs a stable `createdAt`, which an `Idea` has not got** | Confirmed — regenerating could recolour everything |
| **An occurrence has no identity**, and one idea can occur twice in a paragraph | Confirmed by construction |
| **The concession in the honest-assessment section is aimed at the wrong half** | Accepted, and it reverses the risk ranking |
| **`assumed` ideas launder interpretation through block anchors** unless the panel says they are hypotheses | Accepted. Changed the copy and added the eval |
| **One negative example is not enough for four failure modes** | Accepted |
| **Id inheritance by name is much weaker for sentences than for terms** | Accepted |

Two places I did **not** simply take it:

- It called *"a third arm of one ternary"* wrong. Half right: `search-hits.ts` genuinely does frame
  itself as two matchers with one downstream, but the concrete ternary is inside `SearchBand`, and
  Ideas is its own band. The phrase was overstating a true thing, and is gone.
- It said the claim that a new `MarkKind` would "cut ideas out" of the pipe is too strong, since the
  renderer could be extended. True — but extending it buys another rendering branch with no
  reader-visible difference, and it agreed reuse is right for v1. Kept, with the semantic debt written
  down.

Its one-line summary is the fairest thing in it, and worth keeping at the top of whoever builds this:

> The rendering reuse is real. The plan is not fundamentally misguided. But it currently mistakes "the
> renderers accept the same shape" for "the feature is almost wired."

---

## Questions for Greg

Six. Each one says what is being asked, what happens either way, and what I would do. **Answer only
the ones you disagree with** — the recommendations are what gets built otherwise.

### 1. What is the button called — "Ideas" or "Mental models"?

You offered both. It is only a label; nothing else changes.

**Recommendation: Ideas.**

Two reasons. The bar has eight buttons and this makes nine, so "Mental models" would be the widest
label on a row that is already tight. And "mental model" is a phrase you have to already know — this
repo's own rule is *no jargon where an ordinary word will do*, and "idea" is the ordinary word for the
same thing. It is also the word you reached for yourself, in brackets, second.

### 2. Should each idea carry a difficulty and a centrality score, the way a glossary term does?

The glossary asks the model to rate every term 0–1 on two axes, shows both numbers on every row, and
gives you a slider that decides which terms get promoted to the top group.

**Recommendation: no scores, no slider.**

The glossary needs them because it has twenty-four terms and you cannot read twenty-four of anything
at a glance — the scores are triage. **A piece has about six ideas.** You can read six. And a
threshold over six items divides them four-and-two and puts a confident label over what is really an
arithmetic accident, which is the exact failure `PRIORITY_GATE` was made absolute rather than relative
to avoid.

**But you overrode this same recommendation for the glossary and you were right to.** The condition
you attached then — *keep the numbers, never sort by them silently* — is a good rule and it would
work fine here. So if you want them, the answer is not "no", it is "the same deal as the glossary":
numbers on every row, order named in a control, first-use one tap away. Say the word and it goes in.

### 3. Should ‹ › prev/next have keyboard shortcuts?

The plan gives you arrow buttons and nothing else.

**Recommendation: buttons only for now.**

Not on principle — ↑ / ↓ already belong to the article, and the band has no story yet for what
"focus is in the panel" means, which is the same gap that has kept the glossary's term list
un-navigable by keyboard. That is a fixable problem rather than a decision, so this is "not yet"
rather than "no". If you want `n` / `p` or `j` / `k`, it is worth saying now, because doing it
properly means giving the band a focus model and that is a piece of work rather than a line.

### 4. Is it a problem if the same thing shows up in both the Glossary and Ideas?

The article's central coinage could legitimately be a glossary term *and* an idea. Nothing stops it.

**Recommendation: allow it, and do not build anything to prevent it.**

The obvious fix — hand the ideas prompt a list of the glossary's terms and forbid them — would make
`ideas.json` quietly depend on `glossary.json`. Then whether you have a glossary, and how old it is,
silently changes what ideas you get, and **the staleness check cannot see that** because it only
fingerprints the article. A hidden input that staleness cannot see is a bug nobody can diagnose from
the outside.

So the two lists are kept apart by the prompt's own rule (*a term is a word you look up; an idea is a
claim you hold*) and by nothing else. If it looks wrong on a real article, the fix is a line in the
prompt, not a wire between the two artefacts.

### 5. Where does the Ideas button go on the bar?

You set the current order by hand: Contents, Summary, Glossary, Search, Chat, Questions, Tweets,
Metadata. This adds a ninth.

**Recommendation: straight after Glossary.**

Your order runs the five modes first and, inside them, outwards from the article's own words —
Contents and Summary are the article restated, Glossary and Search are ways *into* it, Chat is a
conversation about it. Glossary and Ideas are the same kind of thing pointed at different units, so
they belong side by side.

The real question underneath is **whether nine buttons still fits.** I have not measured it in a
browser. If it does not, the honest options are dropping the labels to icons at narrow widths, or
accepting that the bar has grown past what a single row can hold and needs a rethink — which is a
bigger conversation than this feature.

### 6. Which half of this feature are we actually betting on?

This is not a decision to make now — it is the thing to look at the first time you run it on a real
article, and it is worth agreeing in advance what would count as a failure.

The feature has two halves. **"What you need to bring"** finds ideas the article never states and
assumes you have. Nothing else in the app produces those, and they cannot substitute for reading,
because they are not in the piece. **"What this piece adds"** states the ideas the article puts
forward — and that is a compressed version of the argument, which is what Summary mode already does.

**Recommendation: build both — but run the eval on the "what you need to bring" half before building
any of the UI.**

I had this the wrong way round in the first draft, and the review corrected it. The two halves fail in
*opposite* directions:

- **"What this piece adds"** is the half that might be redundant — but you can *check* it. Read the
  idea, read the passage, decide. If on a real article it reads like the summary with the headings
  filed off, cut it. You will be able to tell, and cutting it would be the experiment succeeding.
- **"What you need to bring"** is the half nothing else can do — and it is the half you *cannot*
  easily check. When the model says the author assumed something, the passage it points at proves the
  passage exists. It does not prove the author assumed anything. A confident sentence with a real
  block id next to it looks like evidence whether or not it is.

So the risk is not "the second half is redundant". It is **"the first half is unfalsifiable"** — and
the answer is to test the prompt against real articles with a person scoring it, before any of this
gets a panel. If the model mostly returns universal truths, glossary terms, themes, or its own
reading, then the valuable half does not work yet and that is much cheaper to learn now.

Everything else in the design already leans this way: the panel says *"the model thinks these passages
rely on it"* rather than *"assumed in"*, because it is a hypothesis you are being invited to test, not
a fact you are being told.

---

## See also

- [glossary.md](../project/glossary.md) — the sibling mode, and where the provenance-as-label
  treatment, the id-inheritance rule and the register traps all come from
- [search.md](../project/search.md) — the marks, the fallback, the rail, and the ruler that would have
  been silently wrong
- [260826a-chat-mode.md](260826a-chat-mode.md) — the mode band this reuses, and the reframing that made it a slot
- [reader-profile.md](../project/reader-profile.md) — why "what you need to bring" is the case the
  profile is really for
- [summaries.md](../project/summaries.md) — the other axis on the same material, and the thing this
  has to stay distinct from
- [vision.md § Principles](../project/vision.md#principles) — 1 and 4 are the ones this is judged
  against; the **Argument view** on that roadmap is a *different* feature (a claim is what the author
  asserts and defends here; an idea is a tool you carry away)
- [260826o-streaming-the-slow-two.md](260826o-streaming-the-slow-two.md) — where the "it does not stream" debt is
  tracked
