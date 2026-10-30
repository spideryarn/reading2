# Explained passages underlined in the prose

Report `spya-njkskc` (Greg, admin — `feedback-reporter.ts` exit 0), filed 2026-10-29 09:20 UTC from
production on *Consciousness in Artificial Intelligence* (`arxiv-2308-08708-spya-xax6v4`, margin open).
Session `fbnjkskc-explanations-underline`.

> New Explanations mode: Can we indicate when, in the text, when something's being explained,
> perhaps using something, an underline quite similar to the glossary.
>
> — Greg, 2026-10-29 (spya-njkskc)

He asked for the same thing when the mode was first proposed (*"There's just a little underline
waiting for me"*, spya-nkq6rj). It was stage 3 of
[261028c](261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md), deferred on
GPT Sol's review (PR-2) until it had an overlap design, and queued as `qi-ym6872mj`. This plan is
that design, and the build. Mode doc: [explanations.md](../project/explanations.md).

## What the reader gets

Every explanation the owner has, while the [experimental switch](../project/experimental-features.md)
is on, is underlined where its quoted words are, **in every mode**, as a glossary term is: a dotted
rule under the words, and a card when the pointer rests on them saying what the explanation says,
its labels (*Not sure*, *Draws on AI memory, unchecked*), and *Ask in chat · Open in Explanations*.

```
  … the authors argue that   recurrent processing   is a necessary condition, since
                            ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈  ← orange dotted: a glossary term
  feedforward sweeps alone do not give rise to the global availability that …
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  ← teal dotted: explained here
                         ┌────────────────────────────────────────┐
                         │ ✦ EXPLAINED                            │
                         │ The step skipped here: "global          │
                         │ availability" is the workspace theory's │
                         │ test for consciousness, so …            │
                         │ Not sure                                │
                         │ [Ask in chat]       Open in Explanations│
                         └────────────────────────────────────────┘
```

## Decisions

### 1. A seventh `MarkKind`, built from the citation's finder — not a second way

`annotate.ts` is the one place marks are made; a new kind costs "one entry in a union, one `if`,
one class and one attribute" (its header), and that is all this adds: kind `explained`, class
`explained`, attribute `data-explained`. (Not `expl`: that is already the band's class,
`.mode-band.expl`.)

**Where the words are** is the citation's question exactly: a stored slice of the article's own
characters in a named block, to be re-found in the rendered text, **the only occurrence or
nothing** (an explanation's quote is already checked unique in `block.text` at write time,
src/explanations.ts, but uniqueness there does not prove it in the rendered string — the argument
`citeMarks`' docstring records). So `citeMarks`' body becomes a shared `placedMarks(blocks,
selections, kind)` and `citeMarks` / `explainedMarks` are its two one-line callers. A place that
cannot be re-found draws nothing — never the whole block.

### 2. The look: Glossary's rule in another hue

*"An underline quite similar to the glossary"*: the **same shape and weight** — `border-bottom: 2px
dotted`, Glossary's channel — in a **teal** (`--explained`, OKLCH hue 175; dark `0.76 0.11`,
light `0.52 0.10`), so the two read as one family and can still be told apart. Orange is the
glossary's and the brand's, and a fainter orange would be confused with a term that has faded on
repeat (`termProminence`). Teal sits between the reader's green highlight (150) and the reading-time
cyan (200), and is drawn as a rule where both of those are fills. `cursor: help`, words never
recoloured, hover darkens the rule and adds a faint wash — `mark.term`'s rules.

No fade: one explanation per block at most, a dozen in an article, so there is no repetition to
quiet.

### 3. When a passage is both a glossary term and explained

They are one `<mark class="term explained">` (annotateHtml merges every kind over a run), and both
want `border-bottom`. **The term keeps its orange rule on its own words; the explanation's teal
runs either side of it.** A term is a word or two inside a clause, so the reader still sees the
clause underlined, broken by an orange stretch — which says exactly what is true: this clause is
explained, and this word in it is a glossary term. The card on those words draws **both
sections**, term first (as with a term and a citation: what the word means, then what the passage
is missing).

The same rule for the reader's own marks: a **comment or chat** over explained words keeps its
solid line (it is the clickable one), as `mark.cmt.term` already does. **Citations and
cross-references** draw on `text-decoration`, a different channel, so both lines show. A **quote**
is a fill, a **search hit** an outline: both show.

### 4. The card

`ExplainedCard` beside `QuoteCard` in ProseHoverCard.tsx: a label row (*explained*, the mode's
Dock icon), the explanation in the AI's face, the labels from `explanationLabels` (one copy, the
band and the margin use it), and a foot of Reader's existing senders — *Ask in chat*
(`askExplanationInChat`) and `OpenInMode` for Explanations (`openExplanationInBand`, which already
lowers the band's bar to show a row it was hiding). Owner-only by construction: the list is only
ever the owner's.

**Open delay**: an explained passage is clause-long and the pointer rests in it while reading, so
it takes the quote's longer `QUOTE_OPEN_MS` when it is the only thing on the words.

**Touch**: in `tapSelector`, Glossary's rule — the first tap shows the card, the second opens
Explanations on that row. Without it a tap on a mark that is not a quote is swallowed by
`NOT_A_BLOCK_SELECTION` and does nothing (the "dead hole" `mark.cite` was added for). A term inside
the passage still wins the second tap, since the existing term branch runs first.

**No pressed state, and no keyboard letter, in this change.** The band's rows jump to their block
(and the flash marks it); nothing selects an explanation in the prose. Glossary's G has no twin.

### 5. One read, for the prose and the margin

Today the owner's explanations are read only inside the margin (`ExplanationsMarginFeed` in
MarginaliaColumn.tsx), so they exist only while the margin is open. The prose needs them in every
mode, so **the read moves up to Reader**, still mounted only for an owner with the switch on, and
the margin takes the same list from Reader instead of reading its own — one GET, not two, and the
margin and the prose cannot disagree about which list is current. Same rules as now: a stale list
is not drawn (`!read.stale`), and `useStepFinished` brings in a list written while the page is
open.

### 6. TableView

A fourth memoised map, `explainedMarksByBlock`, beside `citeMarksByBlock`, and **in `proseHtml`'s
dependency list and `sameInputs`** — the citation marks once shipped missing from that list and
appeared only when something else re-rendered (tests/prose-not-rebuilt.test.tsx). A test pins
that a list arriving after the first render draws.

### 7. What does not change

- **The sanitiser.** Since v8 an article keeps only allowlisted classes and `data-*` attributes, so
  `explained` / `data-explained` cannot be forged and need no entry; tests/sanitize-allowlist.test.ts
  scans `src/` to prove it.
- **Visitors** see nothing: there is no public projection of explanations.
- **The server.** No prompt, artefact or route change.

## The simpler option passed over

**Reuse `kind: "term"`** with explanation ids in `data-term`. Zero new kinds, but the hover card
would look the ids up in the glossary and find nothing, the fade would count them, Glossary's G and
second tap would try to open them, and the look could not differ. It is "a second way" wearing the
first one's name.

**Underline only in Explanations mode.** Less on the page, but Greg's point is that he meets these
in the margin and the prose while reading, not in the band (*"users are mostly going to benefit from
it in the marginalia"*), and Glossary's underline is in every mode.

## Stages

One stage: annotate.ts (kind, `placedMarks`, `explainedMarks`), annotations.css + tokens, TableView
map, ProseHoverCard section and wiring, Reader read moved up, margin fed from it, /design specimen
of the overlap, explanations.md § Not built yet → a section on the underline. Tests:
tests/annotate.test.ts (the mark, the overlap's classes, a quote found twice draws nothing),
the prose-not-rebuilt case, the card (text, labels, buttons). Browser check against a canned list
locally (no model calls until 1 November): the underline, a term inside an explained passage, the
card, margin still drawing.

## What waits

- How it reads on **real** explanations, and whether a dozen clause-long underlines is too much —
  the first live run (`qi-k738ybv4`).
- A pressed state from the band, and a keyboard road; whether the underline should follow the
  band's threshold (the margin does not, today).

## GPT Sol's plan review, and what changed

[261029j-plan-review-sol.md](261029j-plan-review-sol.md): one P1, four P2, all taken.

- **P1, a tap on a comment or chat inside the passage would be stolen** — the hover card claims the
  tap and cancels the click that opens the comment. Every mark arm in `tapSelector` (term, citation
  and explained) excludes `.cmt` and `.chat`: one merged mark may carry three kinds, so excluding
  only the explained arm still let an older arm steal it (caught in code review). Tests: a tap on
  `mark.cmt.explained`, `mark.cmt.term.explained` or `mark.chat.term.explained` opens the reader's
  own artefact.
- **P2-2, the band reads separately, and `useStepFinished` misses another tab's run** — the band's
  opening read publishes its revalidated list into the shared prose-and-margin state. The feed does
  not make the same GET again, and while the band is open leaves job-completion refreshes to it
  (corrected in code review after the first version issued two independent reads).
- **P2-3, the read must stay a gated child** — it is: `ExplanationsFeed`, mounted only for an owner
  with the switch on, handing back null when unmounted. Test: the marks go when the list goes.
- **P2-4, the card's buttons must close it** — both wrap `onClose`. Tests for both.
- **P2-5, a keyboard focus on a link inside the passage** — the read now looks down from a focused
  link, as terms and citations do. Test.

Each of those four tests was watched going red with its fix taken out (the memo key, the
`:not(.cmt)`, the downward lookup).

**One change from § 3 as first written**: the comment and chat cases are not pairwise overrides.
The explained rule is wrapped in `:where()`, weighing nothing, so any other mark's border wins
whatever order the stylesheets load in (`mark.chat` is in dialogs.css, after annotations.css;
`mark.cmt` before).

**The older bug Sol's code review found** — a finger tap on a glossary term or citation inside a
reader's comment or chat cancelled the click that opens it — is written up in
[261029b](../postmortems/261029b-a-finger-could-not-open-a-comment-under-a-glossary-term-or-citation.md).
The fix (`:not(.cmt):not(.chat)` on all three touch selectors) is in this change, with tests.

**One name was taken.** The referee scan already drew a finding with an *ordinary* label as
`.ref-scan-item.explained`, and tests/prose-marks-stay-inline-in-chrome.test.ts holds that a mark
kind's class is styled only on a `<mark>`. That modifier is now `.ref-scan-ordinary`
(SourceScanNotice.tsx, referee.css), which also says what it means.
