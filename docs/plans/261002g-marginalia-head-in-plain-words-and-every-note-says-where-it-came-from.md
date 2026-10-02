# Marginalia: cut off at the right, a plainer head, and every note says where it came from

Three reports from Greg (admin, `feedback-reporter.ts` exit 0 on each), all filed 2026-10-01 about
the right-hand column then called Annotations, now Marginalia ([marginalia.md](../project/marginalia.md)).
Overseer queue item `qi-2cxmnb4d`.

> Annotation mode gets cut off by the right margin
>
> Use Playwright screenshots to test.
>
> — Greg, 2026-10-01 (spya-hut48h)

> And in Annotations mode, that rail at the top that shows where you are - the language is too
> complex. Can you make it shorter and simpler.
>
> — Greg, 2026-10-01 (spya-g4yrew)

> It has a "schema representations..." annotation, but I can't tell what that Annotation is from or
> why or whether AI-generated (if so, it should be in the AI-generated font). Make sure all
> annotations have rich tooltips (see tooltips.md) explaining their origin, and anything else that
> might be helpful for the reader.
>
> — Greg, 2026-10-01 (spya-atv4nx)

## Prior work

- `git log origin/dev`, `docs/plans/`, `docs/user-feedback/`, `gjd-remote ls`, the Overseer queue.
- **261001k** (`docs/user-feedback/261001_0915-…`) made the head's path wrap instead of ending in an
  ellipsis, and made the notes swap in for a band on a narrow window. It did not touch the words.
- **261002a** (aec8ff52f, deployed) laid the reading view out for the width *beside* a classic
  scrollbar. Before it, a Mac with a mouse plugged in gave a 15px scrollbar and the whole page was
  15px too wide, which is exactly "cut off by the right margin" for a column that sits at the right
  edge. The likely fix for spya-hut48h; § 1 checks it.
- **261002f** (9b4b7a933, on dev) put the three faces in front of everyone and voiced Marginalia's
  head path, questions, idea names and arc. **Not voiced yet: the FAQ, Debate, Citations and
  comment lines** that 261002b added. Queue item `qi-bm8fpvy4` (session `fb9a-…`, asleep, no commits)
  asked for exactly the margin's voices; § 3 finishes it, so that item can close with this one.
- The `fb9a` and `marginalia-live-refresh` sessions this item waited for have landed nothing on the
  files below beyond 261002d (`useStepFinished` in the column), which this does not change.

## 1. Cut off at the right — reproduce first

A Sonnet browser agent runs Playwright with **classic scrollbars forced on**
(`ignoreDefaultArgs: ["--hide-scrollbars"]`, the 261002a method) against two trees: `aec8ff52f^`
(before) and dev (after), at 1920/1440/1280/1024/900, the column alone and beside a band, measuring
every note's and the head's right edge against `clientWidth`, and sideways scroll.

- If *before* is cut off and *after* is clean, spya-hut48h ends **Shipped, naming aec8ff52f**, with
  the screenshots. Nothing to build.
- If *after* is still cut off, the fix is in `layout.ts § fitMargin` / `marginalia.css` and gets a
  failing test first.

## 2. The head, in plain words

What Greg saw, read from production (read-only): the path's titles are already short — *"Cats Don't
Talk › Scaling Up Brains"*. The hard part is **the arc sentence** under them:

> At stake is whether scaling a brain past ours would simply drown its workings in the computational
> irreducibility that concepts and language currently hold at bay, or whether the pockets of
> reducibility brains already exploit would keep such a mind within reach of description.

Across production's 41 arcs the median sentence is 29–34 words for every prompt version; the shared
plain-words rule (`arc/4`, 2026-09-28) did not shorten them (`arc/4` median 34, p90 51). The head
clamps the arc at three lines of a 200–288px column, about 15–20 words, so a typical arc is also
**cut mid-sentence** — the truncation 7M complained about, one line lower.

**Change: `arc/6`, a shorter, simpler arc sentence.** The prompt keeps its job (relational, about the
whole piece, never the article as subject) and gains a hard limit and a plainness rule:

- **At most 20 words.** Its own worked example is 17. Fits the head's three lines.
- One idea, or two joined by a semicolon; no stacked subordinate clauses; the reader's everyday words
  over the field's terms where both say it (on top of `plainWords("explain")`).
- The good/bad examples rewritten at that length, since examples drive length more than rules do.

**Measured before it lands**, per [prompting-guide.md](../project/prompting-guide.md): the arc step
run on ~5 local articles at `arc/5` and `arc/6`, word counts and the sentences side by side, written up
under `docs/investigations/`.

**Pass criteria, declared before the `after` arm was read** (evals/arc-length/run.ts; five local
articles, the old prompt run twice as the control):

| | `before` | `before-2` | `after` must reach |
|---|---|---|---|
| median words | 31 | 36 | ≤ 20 |
| sentences whole in the head's 3 lines at 288px | 1/35 | 0/35 | ≥ 80% |
| … at 200px | 0/35 | 0/35 | ≥ 50% |

The line count is a greedy wrap at the head's width in the AI face (≈33 and ≈22 characters a line),
an estimate rather than a render. Fidelity and plainness are judged blind: an Opus subagent sees each
part's old and new sentence in random order, with the part's gist, and says which is plainer and
whether either misstates the part. Pass if the new one is plainer in most parts and no more often
wrong. The old prompt failing every row is the positive control.

**Existing arcs** (revised after GPT Sol's plan review: keep drawing, never blank). An arc in the article payload is used as-is today (`useArc` § seeded from the
payload), so a prompt bump would never reach Greg's two articles (`arc/2`, `arc/3`). Change, owner
only: **when the payload's arc is from an older prompt, `useArc` keeps drawing it and starts the
one unforced run it already knows how to start**; the run regenerates (the step's stamp compares the
prompt version) and the completion's `refresh` swaps the new arc in. The first draft blanked the old
arc instead, which would have taken it off Structure too for the length of a model call (Sol, F2).
**Strictly older** (`isArcOutdated` in `src/arc-version.ts`, the rule Quotes already uses): a
rolled-back build leaves a newer arc alone, and an unparseable version is not evidence (Sol, F1).
Version only, not the full fingerprint: a constant compare, no hashing on every open, and exactly the
case this change creates. `src/arc-version.ts` imports nothing, so the client can read it without
pulling in the server's `arc.ts`.

Cost: one capable-model call per owned article with an arc, the first time its owner opens it after
deploy — ~41 articles today, most of them Greg's.

**Simpler option passed over:** drop the arc from the head and show only the path. Greg said of the
same head the same day: *"I really like the rail at the top … both in terms of the structure and the
arc"* (spya-rczgjb). He wants it plainer, not gone.

**Deferred, named:** a visitor's payload still carries whatever arc the owner last had written; it
catches up when the owner next opens the article. The full-fingerprint staleness on open (a tree that
changed under an arc) stays as it was.

## 3. Every note says where it came from, in its voice

**Cards.** Every note, and the head's path and arc, gets the house card
([tooltips.md](../project/tooltips.md)), `ControlTip`'s shape: a head, what it is, then what you could
not guess — **which mode it came from, who wrote it (AI, the author, you), and why it sits beside
this passage**. The native `title`s go.

The column can hold dozens of shut lines, so they do not each get a Floating UI instance: they carry
`data-marg-tip="<kind>"` and the reading view's one delegated card (`BlockLinkCard.tsx`) draws them,
as it draws the gutter's controls since 261002e — mouse hover and keyboard focus, not a finger (a tap
opens the note, which shows the rest). **Questions are different** (Sol, F4): a question has nothing to
press, so its card is the only thing a keyboard or a finger could reach, and the delegated card
answers neither. It becomes a button with a controlled `Tooltip` of its own, like the idea stamp; one
per part, so a few instances. The words live in one table in `src/web/marginalia/tips.ts`, keyed by
kind, so the cards and their test read one copy. The idea stamp, the path and the arc already have
their own `Tooltip` (they open on a tap too); each gains the origin line.

| Kind | What it is | Where it came from |
|---|---|---|
| Question (whole article / a part) | the question the article / this part answers | written by AI with the article's structure; beside the opening / the part's first paragraph |
| Idea stamp (assumes / introduces) | an idea the piece takes for granted / argues for | Ideas mode, written by AI; where the idea first appears |
| FAQ | a question a careful reader might ask, answered here | FAQ mode; the question is AI's, the quote the article's own words; beside the earliest passage that answers it |
| Debate | a page on the web that answers a claim made here | Debate mode: AI searched and judged how it bears; the quote is the page's |
| Citation | a work the article cites, here for the first time | Citations mode; the title is the work's, the reason AI's |
| Comment | a note on this passage | written by you (or by the article's owner, to a visitor); an AI answer under it if asked |
| Path | where you are: part, then section | the article's structure — the author's heading, or a title AI wrote where there was none |
| Arc | where the argument has got to | AI, one sentence per part |

**Voices** (fonts.md's rule; classes added to `voices.css` and `VOICES_BY_MODE.marginalia`):

- FAQ: the question **AI**, its "Answered here" quote **the author's**.
- Debate: the quote is the page's — third party, left **UI** as fonts.md says; the headline too,
  except when `rowWork` says the model read it off the page (`titleIsAI`), where it is **AI**, as
  the band's `dbt-title-ai` (Sol, F5); its "applies" line **AI**.
- Citation: title the work's (**UI**, as in the band); its why **AI**.
- Comment: body **the reader's**; its answer **AI**.
- The shut line's words take the voice of the one item it shows; a count ("3 works") is **UI**.

## Tests

- `tests/marginalia-tips.test.ts(x)`: every `MarginaliaNote` kind has a card (a `Record` over the
  kind union, so a new kind is a type error); no card's second paragraph restates its first or its
  head (the referee-tooltips check); the delegated card draws a `data-marg-tip` note.
- `tests/voices-css.test.ts`: the new classes in `VOICES_BY_MODE.marginalia`.
- `useArc`: a payload arc with an older version reads `/api/arc` and starts a run; a current one does
  neither (red first).
- Browser check (Sonnet, Playwright): cards on hover in the column, voices visible, screenshots.

## Stages

1. Reproduce § 1 (running). 2. § 3 cards and voices. 3. § 2 prompt + measurement + `useArc`.
GPT Sol on this plan before building; on the code before pushing.

## Results

- **§ 1: Shipped already, by aec8ff52f** (261002a, deployed). A Sonnet browser agent ran Playwright
  with classic 15px scrollbars against the tree before it and against dev. Before: every width
  scrolled sideways, and from 1280px down (1440 with a band open) the column's text ran under the
  scrollbar — "the clain" for "the claim". After: no sideways scroll and every note inside the page,
  at all five widths, alone and beside a band. Shots in [261002g-shots/](261002g-shots/).
- **§ 2: `arc/6` ships, after one failed draft.** The first draft wrote short gists and lost the arc's
  job (a blind judge preferred the old sentence on "where the argument stands" in 26 of 35 parts); the
  second recovered it (11 / 13 / 11), stayed plainer (33 of 35) and misstated nothing. **Missed**: the
  head-fit criterion (71% whole at 288px against 80%; none at 200px). The head's arc clamp went from
  three lines to four, because the AI face is a monospace. The numbers are in
  [261002p](../investigations/261002p-arc-sentences-shorter-and-plainer.md).
- **§ 3: built as revised after Sol's review.** Shut lines through the delegated card; questions a
  button with their own card; the idea, path and arc cards gained an origin line; the shut notes'
  words are in their voices.
- **A red that was not ours**: `tests/public-network-trace.test.tsx` still read the gutter mark's
  native `title`, which 261002e had replaced with `data-tip`; fixed in passing.
