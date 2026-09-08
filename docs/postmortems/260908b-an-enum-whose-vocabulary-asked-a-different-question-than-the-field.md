# An enum whose vocabulary asked a different question than the field

Debate mode drew a red **Critical** chip over an outside source that *supported* the article. Three
stored rows in one run, and the field that produced them had been through two design reviews.

The line that broke is not interesting. What is interesting is that the field was **answerable
without reading the article at all**, and nobody noticed for three days because the wrong answer and
the right answer look identical on screen.

## What happened

Each Debate row carries a model's reading of an outside page: `relation` — `disputes | qualifies |
extends | corroborates | unclear` — and, until 2026-09-08, `valence`, spelled `positive | negative |
neutral | unknown`. `valence` drew the chip.

The three bad rows, from the Cargo Cult Science run of 2026-09-05:

| stored | source | the model's own `applies` sentence |
|---|---|---|
| `disputes` / **positive** | psi-encyclopedia | "…Geller did appear to bend metal, **contradicting** the implication from Feynman's own null result…" |
| `corroborates` / **negative** | skepticalinquirer | "**Backs** Feynman's skeptical result… **supporting** the 'nothing happened' conclusion." |
| `disputes` / **positive** | psi-encyclopedia | "A pro-parapsychology source **pushes back** on the picture of vanishing… ESP results…" |

Read the `applies` column. **`relation` is right in all three, and the prose is right in all three.**
The model understood the row's target perfectly well when writing a sentence about it, and lost it
only when answering the enum.

## The real root cause

Not a missing instruction. That was the comfortable explanation and it is wrong, and the thing that
kills it is free: **all three errors are in the claims group, and the claims group already carried an
explicit target-binding sentence** —

> Here "valence" is the quoted passage's stance toward THE CLAIM you quoted — not toward the article
> as a whole, and not its tone.

The instruction was present and was not followed. What that sentence rules out is *the article as a
whole* and *tone*. What all three rows actually did is neither: they gave the passage's stance toward
**the outside page's own subject** — psi, Uri Geller, parapsychology. The negation was incomplete,
and the one exclusion it was missing is the one the failures needed.

Why that particular slip, and not some other? Because `positive | negative` is **sentiment-analysis
vocabulary**, and sentiment analysis has a well-defined answer that requires no target at all: the
polarity of the passage toward whatever the passage is about. A page arguing Uri Geller was a fraud
is, in that sense, unambiguously negative. That the page therefore *agrees with* an article claiming
nothing happened under test is a second hop, and the model skipped it — took the question the words
invited rather than the question the docblock intended.

So the field asked, in effect, two questions at once, and its vocabulary answered the easier one.

## The class

**An enum whose vocabulary asks a different question than the field.**

The values were drawn from a neighbouring, more famous problem — sentiment — while the field meant
something else: *stance toward this row's specific target*. When the value names are answerable
without the target, the target becomes optional in practice however loudly the prose insists on it.
The prose is a request; the vocabulary is an affordance, and the affordance wins.

The tell is a diagnostic worth keeping: **can a reader answer this field correctly while ignoring
half the row?** If yes, some fraction of the time they will.

A second class rode along, and it is the one that cost the most time here — *a check that shares an
assumption with the thing it checks*, in a **document** rather than in code. See below.

## Which commit introduced it

`39701ce7`, 2026-09-05, *"The debate stage: go out to the web, and refuse most of what comes back"* —
the commit that created the mode. `DebateValence` and the `READING` prompt block arrived together and
the vocabulary was never revisited. It was not a slip under pressure: the docblock states the
intended meaning carefully and at length, including *"Not the passage's tone, and not its stance
toward some third subject."* **The intent was documented and the vocabulary contradicted it**, which
is the whole shape of this.

## The fix that shipped, and the fix that is right

Shipped, 2026-09-08:

- **The vocabulary renamed to agreement words** — `leans-for | leans-against | neither | cannot-tell`,
  and the field `valence` → `lean`. These cannot be answered without naming what the lean is toward.
  This is the fix that addresses the cause rather than the instructions.
- **The negation completed**, in both groups: *"not toward whatever the outside piece is itself
  discussing."*
- **Group one given a target binding**, which it had never had — a real gap, though not this one:
  group one returned no rows at all in the failing run.
- A legacy accessor, `readStoredLean`, because every stored row uses the old vocabulary and nothing
  revalidates a row on the way out of the database.

**Right for the long term, and not shipped:** the reader-facing chip is still a categorical claim
about a stranger's page that nothing in the returned evidence verifies. The honest long-term design
is to score `relation` against the source and the target — not merely to check that the chip follows
the relation. A rename removes an invitation; it does not make the judgement checkable. And note the
migration risk, which is live: with the stance field's vocabulary repaired, the same collapse can
reappear in **`relation`**, which no type relates to the source either.

**What was tried and refused, twice.** Making the "contradictory" pairs unspellable — a display
coercion in round one, a discriminated union on 2026-09-08. Both were refused by cross-family review
(F35, then F65) on the same ground: `disputes` + supportive is *honest* when a passage takes issue
with part of a target while backing the whole of it. *"The stated 10% is wrong; it is at least 30%,
which makes the warning stronger."* Forbidding the pair forbids that row to forbid three bad ones.

## What would have caught it, ranked by ease against value

1. **Read the enum's values and ask whether they can be answered without the rest of the row.** Free,
   takes ten seconds, and would have caught this at design time — the docblock that carefully
   explains the intended target is itself the signal that the values do not carry it. Now stated as a
   rule in [name-is-evidence.md](../reusable/name-is-evidence.md)'s neighbourhood, and the reason this
   file exists.
2. **Cross-tabulate a categorical model output against its neighbours as soon as there is a corpus.**
   Free and it was free all along: the rows were in `article_revisions.debate` and the raw responses
   in the run journals the whole time. The crosstab that exposed the shape took twenty minutes and
   could have been run on day one. The plan had asserted *"the spike bought no replayable evidence"*,
   which was true of the validation question and false of this one — **an artefact's usefulness is per
   question, not per artefact.**
3. **A prompt-contract test over the words that carry the obligation.** Done —
   `tests/debate-prompt-target.test.ts`, mutation-checked by deleting the clause and watching it go
   red. It cannot show the repair *works*; it stops the clause being dropped later with nothing
   noticing, which is the failure mode that would otherwise be invisible until a reader believed a
   chip.
4. **A legacy-artefact render test.** Done — `tests/debate-legacy-lean.test.tsx`, which catches the
   crash a vocabulary change causes on rows written before it. Mutation-checked: bypassing the
   accessor throws `TypeError: Cannot read properties of undefined (reading 'icon')` and four tests
   fail. This one is not about the enum at all; it is about the fact that **nothing revalidates a row
   on the way out of the database**, which this repository has now been bitten by twice — `lossesOf`
   is the first.
5. A judge model scoring valence against the source — **rejected for this class**. It was designed,
   costed and cut. It measures the same categorical answer with another categorical answer, and would
   not have told us the *vocabulary* was the problem. The corpus and a crosstab did that for nothing.

## The document that contradicted itself, which is the process half

The plan for this work already contained the refutation of the design I proposed on 2026-09-08. § 4,
under a heading that says so, records that round one made exactly the same claim and that a review
refused it — with the two honest counter-examples spelled out. **I read that plan, wrote a
contradicting section into the same file six hundred lines below it, and sent it out for review
without noticing.**

That is *a check that shares an assumption with the thing it checks*, in prose: I was both the author
of the argument and its reviewer, so the contradiction was invisible from the inside. The only check
that caught it was the cross-family one — which is the argument for that rule stated more sharply
than [engineering-manager.md](../reusable/engineering-manager.md) currently states it. **A long
planning document is a codebase, and re-reading your own is a zero check.** The cheap countermeasure
is to grep a long plan for the terms of a new claim before writing it down, which would have surfaced
§ 4 in one command.
