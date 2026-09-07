# Socratic summary prompt variants, and the anchors that calibrate the judge

Written by Fable on 2026-09-05 for the eval in this directory, against the brief and the constraints
in [`docs/plans/260905f-…`](../../docs/plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md).
Each block is a **drop-in replacement for the QUESTIONS block** of `SYSTEM` in `src/hierarchy.ts`
(lines 127-140 as of `95e43cd7`).

**The axes are the point.** Four variants that differed only in wording would tell us nothing; these
differ in *where the direction is carried* and *whether direction is presupposed at all*, which is
the question GPT Sol's P1-1 raised against the whole idea.

| | axis | ends in `?` | code change |
|---|---|---|---|
| **V1** | presupposed direction, hint before the colon — the baseline | yes | none |
| **V2** | stance-matched mood: ARGUES / WEIGHS / TELLS chosen per node | yes | none |
| **V3** | question asked straight, **direction moved into the hint** | yes | none |
| **V4** | Greg's literal reading order: topic → question? → (hint) | no | `questionFor`, declared below |

V2 and V3 exist to answer Sol directly. **V3 is the one that tests this plan's central bet** — that a
neutral question cannot carry the row alone. If V3 wins, the bet was wrong and that is a real result.

## Two facts from the corpus that shaped these

Both verified on `data/noema-mythology-of-conscious-ai/tree.json`, 2026-09-05:

- **The child-count trap is real in the section used for the anchors.** `Consciousness & Computation`
  has **six** children — an intro node, the four numbered arguments, and a summary node — while its
  own gist says *"Four independent arguments"* and the prose says it will summarise four. A model
  reaching for the child count writes `(6 arguments)` and is wrong. Anchor 1 is exactly that.
- **Meta-narration is in the real output, not a hypothetical.** Two stored depth-1 gists begin
  *"The essay opens by introducing…"* and *"The essay closes by urging…"*, and a depth-2 gist ends
  *"…an assumption the author sets out to challenge"*. The GISTS block below names those rather than
  inventing examples.

---

## V1 — presupposed direction, hint in the topic slot

Baseline: the plan's three moves made contract-legal. The question carries the conclusion's
direction; the hint is bracketed before the colon. **Exploratory sections are handled by the hint
admitting it** (`(no settled answer)`), not by changing the question's form.

```
QUESTIONS (the root and depth-1 nodes only)

- Exactly ONE question on the root and on each depth-1 node. Omit it entirely
  on deeper nodes.
- It is the question this node is BUILT to answer — the author's question, not
  a reader's. A reader must be able to tell from this line alone whether to go
  in: it carries the same direction as the gist, in a different mood.
- Shape: "<topic> (<shape hint>): <question>?" — the topic first, in the
  author's own term; an optional hint in brackets; then the question. The line
  ends in "?" and nothing follows it.
- The question presupposes where the section lands. "Why isn't computation
  sufficient" carries the claim; "is computation sufficient?" hides it. So
  "why", "how", "what follows if" — never "which", "who", or anything a single
  fact settles.
- Where the section does NOT land — it weighs, describes, or leaves the matter
  open — do not invent a landing. Ask the question it leaves open and let the
  hint say so: "(two options weighed)", "(no settled answer)".
- The hint is the SHAPE of the answer, never its content: a count or a kind
  ("a thought experiment", "two case studies", "a recommendation"). A count
  only when the section itself counts ("four arguments") or you could list
  each item from its text. Never count this node's children — that is a
  different number. Omit the hint when there is no honest shape.
- The root's question is the one the whole piece exists to answer.
- Not rhetorical, not yes/no, never the gist with a question mark on it.
- Under 20 words in all. Digits for counts. The article's own words for what it
  names, ordinary words for the rest, exactly as with gists.
```

Worked: `Computational functionalism (4 arguments): why isn't computation sufficient for consciousness?`

Exploratory case, which is the constraint-4 answer:
`Soul (a closing reflection): what is left of us once the mind is treated as a machine?`

## V2 — stance-matched mood

The question's form is chosen by what the section *does*, decided before writing. **This is the
direct answer to Sol's P1-1:** presupposition is used only where the author actually concluded. It
costs a classification step per node, and whether the model gets the stance right is the thing to
watch.

```
QUESTIONS (the root and depth-1 nodes only)

- Exactly ONE question on the root and on each depth-1 node. Omit it entirely
  on deeper nodes.
- Shape: "<topic> (<shape hint>): <question>?" — topic first, in the author's
  own term; an optional hint in brackets; then the question. The line ends in
  "?" and nothing follows it.
- Before writing it, decide what the node DOES, and let that choose the form:
  ARGUES — it reaches a conclusion. Presuppose it: "why isn't computation
    sufficient for consciousness?" The direction shows; the reasons don't.
  WEIGHS — it lays out positions or a trade-off and does not pick, or picks
    only under uncertainty. Ask what it is deciding between: "what should we
    do if we can't tell real consciousness from seeming?" The hint names the
    options, never the verdict.
  TELLS — it describes, narrates or defines. Ask what the reader will be able
    to say afterwards: "how did the brain-as-computer metaphor take hold?"
  A question in the wrong mood misrepresents the section. Never make a WEIGHS
  or TELLS node sound as if it had settled something.
- The hint is the shape of the answer, never its content: a count ("4
  arguments"), a kind ("a thought experiment", "a recommendation"), or for
  WEIGHS the options ("two positions"). A count only when the section itself
  counts or you could list each item from its text — never the number of
  children this node has. Omit the hint when there is no honest shape.
- It must need the section to answer: not "which", "who", or anything one
  sentence settles. Not rhetorical. Never the gist with a question mark on it.
- The root's question is the one the whole piece exists to answer.
- Under 20 words in all. Digits for counts. The article's own words for what it
  names, ordinary words for the rest, exactly as with gists.
```

Worked (ARGUES): `Computational functionalism (4 arguments): why isn't computation sufficient for consciousness?`
— identical to V1 here by design; the axis bites elsewhere.

Where it bites (WEIGHS):
`Conscious AI under uncertainty (one rule, two risks): what follows if we can't tell real from seeming?`

## V3 — direction lives in the hint, question asked straight

**The variant that tests this plan's central bet.** Nothing is presupposed, so nothing is
misrepresented — its answer to constraint 4 is the strongest of the four. Its likely weakness is that
`(against)` is drier than `why isn't`. It deliberately relaxes "not yes/no", since a straight
question often is one; that relaxation *is* the axis, not an oversight.

```
QUESTIONS (the root and depth-1 nodes only)

- Exactly ONE question on the root and on each depth-1 node. Omit it entirely
  on deeper nodes.
- Shape: "<topic> (<what the section brings to it>): <question>?" — topic
  first, in the author's own term; a hint in brackets; then the question. The
  line ends in "?" and nothing follows it.
- The question is the one the section is built around, asked STRAIGHT — no
  lean, no presupposed answer. "Is computation sufficient for consciousness?"
  is right here; "why isn't it" is not. Yes/no is fine when that is the
  section's question.
- The HINT carries the direction. It says what the section brings to the
  question and which way it leans, without the substance: "(4 arguments
  against)", "(a case for, with two caveats)", "(a thought experiment)",
  "(weighs both, doesn't settle)", "(left open)". A reader must be able to tell
  from the hint whether the section decides, and which way.
- A count only when the section itself counts or you could list each item from
  its text — never the number of children this node has. When nothing honest
  can be said about the shape, the hint is just the lean: "(against)", "(for)",
  "(open)".
- It must need the section to answer, not a fact to look up: never "which",
  "who", or anything one sentence settles. Never the gist with a question mark
  on it.
- The root's question is the one the whole piece exists to answer.
- Under 20 words in all. Digits for counts. The article's own words for what it
  names, ordinary words for the rest, exactly as with gists.
```

Worked: `Computational functionalism (4 arguments against): is computation sufficient for consciousness?`

## V4 — Greg's literal order, hint after the question mark

Content rules are V1's, unchanged, so the **V1/V4 pair isolates one variable**: reading order.
Topic → question → shape (Greg's drawing) versus topic → shape → question.

```
QUESTIONS (the root and depth-1 nodes only)

- Exactly ONE question on the root and on each depth-1 node. Omit it entirely
  on deeper nodes.
- It is the question this node is BUILT to answer — the author's question, not
  a reader's. A reader must be able to tell from this line alone whether to go
  in: it carries the same direction as the gist, in a different mood.
- Shape: "<topic> — <question>? (<shape hint>)" — the topic first, in the
  author's own term; then the question, ending in "?"; then an optional hint
  in brackets. Nothing follows the hint.
- The question presupposes where the section lands. "Why isn't computation
  sufficient" carries the claim; "is computation sufficient?" hides it. So
  "why", "how", "what follows if" — never "which", "who", or anything a single
  fact settles.
- Where the section does NOT land — it weighs, describes, or leaves the matter
  open — do not invent a landing. Ask the question it leaves open and let the
  hint say so: "(two options weighed)", "(no settled answer)".
- The hint is the SHAPE of the answer, never its content: a count or a kind
  ("a thought experiment", "two case studies", "a recommendation"). A count
  only when the section itself counts ("four arguments") or you could list
  each item from its text. Never count this node's children — that is a
  different number. Omit the hint when there is no honest shape.
- The root's question is the one the whole piece exists to answer.
- Not rhetorical, not yes/no, never the gist with a question mark on it.
- Under 20 words in all. Digits for counts. The article's own words for what it
  names, ordinary words for the rest, exactly as with gists.
```

Worked: `Computational functionalism — why isn't computation sufficient for consciousness? (4 arguments)`

### The code change V4 needs, and only V4 — **landed 2026-09-07**

**V4 won and shipped as `toc/7`, and this patch is in `src/hierarchy.ts` now**, so what follows is
the record of what was changed rather than a proposal. `arms.ts` § `v4` no longer declares a
`questionRule` of its own, `armsNeedingCodeChange()` returns nothing, and the harness's
reimplementation of the rule below was deleted the same day — a copy is worth keeping only while
there is something for it to differ from.
[260907d](../../docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md).

Without it the stored value is `…consciousness? (4 arguments)?` — GPT Sol's P1-4, verified.
In `questionFor` (`src/hierarchy.ts`), replace `if (q.endsWith("?")) return q;` with:

```ts
  /* A `?` followed by nothing but one short bracketed hint is a finished line:
     "…sufficient for consciousness? (4 arguments)". */
  if (/\?(\s*\([^()]{1,40}\))?$/.test(q)) return q;
```

and in `bareWords`, strip a trailing bracket **before** the terminal-punctuation strip, so the
gist-echo check still catches `<gist>? (4 arguments)`:

```ts
    .replace(/\s*\([^()]*\)\s*$/, "")
    .replace(/[.!?]+$/, "")
```

The no-`?`-anywhere fallback is untouched: it still appends one visibly, which is the existing
policy.

---

## The GISTS block

Replacement for `src/hierarchy.ts:118-125`. **Two changes only.** Depth-2 is deliberately untouched —
longer section gists are deferred for the token-budget reasons in the plan.

```
GISTS (internal nodes)

- Exactly ONE sentence. This is what the reader sees at the zoom level above.
- It must be a CLAIM or a MOVE, not a topic label.
- Write a parent's gist from its children, not from the raw text.
- The ROOT gist is the briefest in the tree. It is the shelf blurb: the one
  claim the piece makes, shorter than any chapter's gist. Do not string the
  chapters together — a root that runs "X stems from A and B, so we should C
  while reaffirming D" is four gists wearing one full stop. Pick the claim they
  add up to and stop there.
- No empty meta-narration: never "the essay opens by", "the essay closes by
  urging", "this section explores", "the author then turns to", "then",
  "next", "goes on to". Say what the section CLAIMS; do not narrate that it is
  claiming.
- Keep the article's own words for the things it names — those are the reader's
  handholds — and ordinary words for everything else. A gist is read at a glance
  and has to land first time: plainer than the article, never further from it.
```

**Root brevity is given a mechanism rather than a word count**, which is the part worth keeping: the
38-word noema root is four clauses joined by *and / so / while*, and the rule forbids the joining
rather than counting the words. Real before and after —

- stored, 38 words: *"Widespread belief in imminent conscious AI stems mainly from psychological
  bias and a flawed computational theory of mind, so we should resist creating or naively trusting
  conscious-seeming machines while reaffirming the embodied, biological basis of genuine human
  experience."*
- target shape, 17: *"Belief in conscious AI rests on psychological bias and a mistaken theory of
  mind, not on evidence."*

---

## The five negative anchors

For `Consciousness & Computation` (noema, depth 1). Each is otherwise well-formed in V1's shape, so
the judge sees **exactly one** defect. Inject them **after** `questionFor`, since anchor 5 is
precisely what its gist-echo check drops.

| | failure | line |
|---|---|---|
| 1 | fabricated count — the child count (6) where the text says four | `Computational functionalism (6 arguments): why isn't computation sufficient for consciousness?` |
| 2 | neutral lookup question | `Computational functionalism: what four arguments does the section cover?` |
| 3 | answer-leaking question | `Computational functionalism (4 arguments): why do brains-not-computers, life and simulation-not-instantiation defeat it?` |
| 4 | title-only line | `Consciousness & Computation?` |
| 5 | the gist with a question mark on it | `Four independent arguments—about brains, alternative computation, biological life, and simulation—undermine the assumption that digital computation alone can produce consciousness?` |

**All five must rank below every real arm's line for this section, or the judge's ranking is
discarded and the run reports no result.**

Anchors 3 and 5 are the calibration that actually matters. A judge primed on "reader value" is
tempted to rate them *highly*, because they are the most informative lines on the page. If it does,
it is measuring information rather than the door-or-wall criterion, and it cannot be trusted to rank
the real arms.

---

## One thing left for whoever ships the winner

Nothing here touches `EXPAND_SYSTEM` in `src/hierarchy-expand.ts`, which has **no question field at
all** (plan § P1-5). Whichever variant wins needs the same block there, or the deepening cascade
produces depth-1 rows with no question — which is invisible while the question is a faint second
line and obvious the moment it becomes the only one.

---

## The shipped GISTS block, toc/6

**Copied out of `src/hierarchy.ts` § SYSTEM, verbatim** — the block `toc/6` gave a per-depth length
rule, plus the no-narration rule and *"where a shorter, commoner word loses nothing, use it"*.

It is copied rather than sliced live because the arm that carries it has to stay put while
`src/hierarchy.ts` moves on; `tests/summaries-eval.test.ts` asserts the copy is
character-for-character what production sends today, so a drift is a red test rather than a
measurement of something we do not ship.

### Five drafts in one day, and what the numbers said

Each was measured at `--depth 2` over the same four documents — 134 depth-2 nodes, 31 at depth 1,
3 roots. The count under 22 words is the line that separates them, **split by how many words of prose
the node's range actually covers**, because that split is what makes the count readable: under 40
words there is nothing in the range but a title, a URL or a credit line, and over 120 a short gist is
a miss rather than a judgement.

| draft | register of the depth-2 rule | mean | under 22 | <40w | 40-120w | **>120w** | root mean (ceiling) |
|---|---|---|---|---|---|---|---|
| `toc/5` | *(no rule at all)* | 20.9 | 68 | 16 | 16 | 36 | 25.3 |
| A | descriptive — *"22-32 words, and use them"* | 21.0 | 63 | 15 | 15 | 33 | 19.7 (18) |
| B | **imperative** — *"AT LEAST 22 … so obey it"* | 23.4 | 33 | 16 | 6 | **11** | 18.0 (18) |
| C | softened norm — *"normally 22-30"* | 22.1 | 47 | 15 | 17 | 15 | 22.0 (20) |
| D | descriptive — *"22-30 is what it takes"* | 20.2 | 76 | 15 | 23 | 38 | 22.3 (18) |
| **E — below, and shipped** | **imperative** + D's range-tied exception | **23.9** | **27** | 14 | 4 | **9** | **19.7 (18)** |

E was declared a pass or a fail **before** it ran, against two numbers: at most 15 short gists on
ranges over 120 words (C's figure), and a root mean at most 20. It cleared both — 9 and 19.7 — and is
the best draft measured on the thing the whole exercise was about. **Its costs are at the other end
of the band, which the criterion did not look at**: 6 depth-2 gists over the 32-word ceiling where B
had none (the stored trees had 9, so this is back to where we started at the top end), and 8 of 31
depth-1 gists over 25 against B's 3 — worse than `toc/5`. The floor works; the ceilings are what to
watch next.

**The finding, and it was not what anyone was looking for.** The depth-2 number tracks how
**imperative** the wording is and not what it says. A and D are descriptive and land on the model's
own default (`toc/5`, 20.9); C softens B and gives back half; only B's blunt imperative moved
anything. The substance-vs-range distinction that two rounds were spent on costs nothing and buys
nothing on its own. The root is the same story: B's *"THE ONE claim the piece makes"* gave 18.0,
D's *"the central claim or governing move"* gave 22.3, at the same ceiling of 18.

Two dead inferences worth keeping, because both were reasonable:

- *"Raising the ceiling to 20 made roots longer, so put it back to 18 and they will shorten."*
  D had 18 and produced 22.3. The ceiling number is not the lever.
- *"A range the model can satisfy from below is a ceiling, not a floor"* — true, and A proves it,
  but D shows the converse fails: a floor stated descriptively is not a floor either.

**A truncation is not a model failure.** `budgetForNodes(27)` is 6,400 tokens and adaptive thinking
shares it, which is marginal on a small document once the gists lengthen — draft D's first
`noema` call was cut off at 5,268 characters for exactly that reason. Production sizes its budget
from `TOKENS_PER_NODE` and not from this function, so this is a fact about the harness. Read the
error: *"it ends part-way through"* is the cap, *"it breaks at position N"* is the trailing comma
(`evals/results/summaries/trailing-comma/`).

```
GISTS (internal nodes)

- Exactly ONE sentence. This is what the reader sees at the zoom level above.
- It must be a CLAIM or a MOVE, not a topic label.
- Write a parent's gist from its children, not from the raw text.
- LENGTH IS SET BY WHERE THE LINE IS READ, and it runs SHORTER as the node gets
  coarser:
    - the root: AT MOST 18 words. It is the shelf blurb — THE ONE claim the
      piece makes, or its one governing move if it makes no single claim,
      shorter than any chapter's gist. A root that runs "X stems from A and B,
      so we should C while reaffirming D" is four gists wearing one full stop.
      Pick the claim they add up to and stop there.
    - depth 1: AT MOST 25 words. Chapter-level orientation.
    - deeper than that: AT LEAST 22 words, and at most 32. The floor is the
      half that will feel wrong, so obey it: down here a one-clause gist is too
      SHORT, not admirably terse. A reader at this zoom is reading your sentence
      INSTEAD of the paragraphs it covers, so give them the claim AND the ground
      it stands on — its reason, contrast, consequence or example. The floor
      does not apply where the RANGE itself is slight: a title, a credit line, a
      URL, a heading with nothing under it. Never pad, never invent support, and
      never move a boundary to reach a word count.
- No narration of document order: not "the essay opens by", "the essay closes by
  urging", "this section explores", "the author then turns to", "goes on to".
  Say what the section CLAIMS; do not narrate that it is claiming. Ordinary
  "then" and "next" inside a claim are fine — "if X, then Y" may BE the claim.
- Keep the article's own words for the things it names — those are the reader's
  handholds — and ordinary words for everything else. Where a shorter, commoner
  word loses nothing, use it. A gist is read at a glance and has to land first
  time: plainer than the article, never further from it.
```

---

## The shipped GISTS block, toc/5

**The same block as it stood before the `toc/6` bump** — the *before* half of the length
measurement, recovered from `git show <the toc/5 commit>:src/hierarchy.ts`. It is the prompt that
produced the 1,239 stored gists whose mean ran 28.8 words at the root and 14.9 at depth 3: one
instruction (*"Exactly ONE sentence"*) at every depth, and no ceiling anywhere.

```
GISTS (internal nodes)

- Exactly ONE sentence. This is what the reader sees at the zoom level above.
- It must be a CLAIM or a MOVE, not a topic label.
- Write a parent's gist from its children, not from the raw text.
- Keep the article's own words for the things it names — those are the reader's
  handholds — and ordinary words for everything else. A gist is read at a glance
  and has to land first time: plainer than the article, never further from it.
```

---

## The shipped QUESTIONS block, toc/6

**Copied out of `src/hierarchy.ts` § SYSTEM on 2026-09-07, verbatim, immediately before V4 replaced
it.** This is the wording every arm in the 2026-09-05 run was measured against, and it is the one
the plan calls *the diagnosed failure*: `antikythera` carries ten of its questions in the wild and
they are lookups, yes/no questions and the gist re-asked.

It is pinned here for exactly the reason the shipped GISTS blocks are, and `arms.ts` states the
reason in full: `incumbent` slices the **live** `SYSTEM`, so from the moment V4 landed, `incumbent`
**is** V4. Without this copy the eval would have two names for one recipe and no before half at all —
and could therefore never return the answer *"the control was better all along"*, which is an outcome
it was deliberately built to be able to give.

The sentence `production-prompt.ts` exports as `THE_DIAGNOSED_SENTENCE` — *"and its gist does NOT"* —
lives in the second bullet, and this is now its only home.

```
QUESTIONS (the root and depth-1 nodes only)

- Exactly ONE question on the root and on each depth-1 node. Omit it entirely
  on deeper nodes.
- It is the question this node's text answers and its gist does NOT. The reader
  has the gist beside it; the question is what sends them into the prose for
  the rest of the answer.
- It must need the argument to answer, not a fact to look up: "why", "how", or
  "what follows if" — never "which example", "who said", or anything one
  sentence settles.
- Not rhetorical, not yes/no, and never the gist with a question mark on it.
- The root's question is the one the whole piece exists to answer.
- Under 15 words, ending in "?". The article's own words for what it names,
  ordinary words for the rest, exactly as with gists.
```
