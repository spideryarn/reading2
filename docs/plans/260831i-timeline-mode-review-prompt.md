# Review this plan before we build it: Timeline mode

You are reviewing a **design plan**, before a line of it has been written. This is the house
convention in this repo — every plan under `docs/plans/` goes to a different model family before it
is built, because a bad plan caught now costs an hour and caught later costs the feature.

Be adversarial. I would rather you tell me the design is wrong than that it is nice.

## What to read

1. **`docs/plans/260831i-timeline-mode.md`** — the plan under review. Read it all.
2. **`AGENTS.md`** (= `CLAUDE.md`, a symlink) — the project's working agreements and its principles.
3. **`docs/project/vision.md`** — especially the anti-goals. This plan's own § "Say the awkward thing
   first" claims a timeline sits closest to them of anything built so far; judge whether the answer
   it gives is real or a rationalisation.
4. **`docs/plans/260826ac-ideas-mode.md`** and **`docs/project/ideas.md`** — the feature this is modelled on,
   including the validation discipline this plan extends and the "it is a hypothesis" worry.
5. **`src/ideas.ts`** — the reference stage: the prompt, the call, `validateOccurrences`, the
   `Dropped` counters, id inheritance.
6. **`src/quote-match.ts`** — `findQuote`. The plan leans on it for a check it was not written for.
   This matters (see question 3).
7. **`src/types.ts`**, **`src/pipeline.ts`**, **`src/store/artifacts.ts`**, **`src/store/pg.ts`**,
   **`drizzle/0031_sketch.sql`**, **`tests/db-step-constraint.test.ts`** — what adding a stage costs.
8. **`src/web/IdeasPanel.tsx`**, **`src/web/useIdeas.ts`**, **`src/modes.ts`**, **`src/web/Dock.tsx`** —
   what adding a mode costs.

## What the feature is

Greg asked for: *"a Timeline mode (which can deal with ambiguity about dates, resorting to ordering,
and indicating the uncertainty)"*, to be tried on
<https://www.dwarkesh.com/p/openai-huggingface> — an essay dense with half-specified dates.

He then chose, from options with diagrams: an **ordered list** (no time-to-scale axis); content =
narrated events + undated-but-ordered steps + future/hypothetical times, **excluding** the piece's own
publication/interview dates, and *"leave a bit of room for the agent to exercise its judgment about
what to include and how"*; and uncertainty shown **in the drawing itself** (marks, with a legend)
rather than as a word plus a hover card.

Those choices are settled. Tell me if one of them cannot work, but do not re-litigate them as taste.

## The questions I actually want answered

**1. Is the `When` model right?** The plan replaces the obvious discriminated union
(`exact | about | range | before | after | relative | none`) with **one interval plus two flags**:
`{ earliest, latest, extent: instant|extended, basis: stated|derived|inferred, phrase }`. Section
"One interval, two flags" argues `extent` is what stops "an event that lasted six days" being confused
with "a one-moment event we can only place within a day". Is that decomposition complete? Take the 24
verbatim temporal expressions in § "The test article" and try to encode **every one** of them in this
model. Name the ones that do not fit, and say what field is missing. I would rather learn the model is
short one field now than after two stages of work.

**2. Is `basis` doing too many jobs, and is `granularity` missing?** The plan carries precision
implicitly (via the width of the interval) and certainty explicitly (via `basis` and the marks).
"May 2026" (precise to a month, completely certain) and "around 26 June" (precise to a day, uncertain)
have differently-shaped uncertainty. Does one interval + `basis` really capture both, or does the
model need an explicit `granularity` field? The plan's § "The traps" item 4 raises partial ISO strings
("2026-05") and does not settle it. Settle it, and say which choice makes the ordering function and
the display simpler.

**3. The phrase check is the plan's central safety claim — does it hold?** § "Nothing is dated unless
the article dates it" says: every date must come with `phrase`, the article's own words, and the
phrase must be locatable by `findQuote` inside one of the blocks the event cites, or **the date is
dropped and the event becomes undated**. Read `src/quote-match.ts` and answer concretely:
   - What normalisation does `findQuote` actually do? Dashes, curly quotes, non-breaking spaces,
     collapsed whitespace, case?
   - Will it find "By the next morning, July 11" in a block whose HTML-derived text differs in one of
     those ways? What is the realistic false-negative rate, and what does a false negative cost here
     (a real date silently demoted to undated, which the reader cannot see)?
   - **Is the check actually load-bearing?** A model that wants to invent a date could supply a
     `phrase` that IS in the text but does not contain the date. Does the plan close that? (It gestures
     at it in § "The traps" item 1.) Propose the strongest version of this check you can, including
     whether the *date itself* must appear in the phrase, and what to do about phrases like "two weeks
     later" that legitimately contain no date.
   - Is "demote to undated" the right failure, or should it be a drop? The plan argues demote because
     an event minus its date is still an event. Push back if you disagree.

**4. The ordering function.** § "Ordering, which is the part that has to be a pure function" gives a
four-rule precedence and says dates beat the model's `order` on conflict, with the conflict counted.
   - Is the precedence right, and is it *total*? Find an input where it is ambiguous or
     non-deterministic.
   - Undated events are "placed by `order`, between the dated events that bracket it". Is that
     well-defined when several undated events share a bracket, or when the model's `order` puts an
     undated event outside the range of any dated one?
   - Rule 4 partitions predictions to the end regardless of date. Does that interact badly with rules
     1–3? Is a stable sort enough or does this need an explicit tie-break?
   - The relative-anchor resolution is described as "a fixed-point pass with a visited set". Is that
     the right algorithm, and is the cycle handling (demote both, count, return) right?
   - Is the list of test cases at the end of that section complete? Add the ones it is missing.

**5. Where will the model actually fail?** § "Negative examples" predicts five failure modes and the
registers the bans will relocate into. This repo's hardest-won lesson (`docs/project/glossary.md`) is
that *a prompt ban relocates a register rather than deleting it*. Given the prompt described, predict
what will actually come back from the Dwarkesh article, specifically. What has the plan not
anticipated? Is asking the model to produce a **structure** (relative offsets, interval bounds,
`extent`, `modality`, `phrase`, `order`) rather than a rendered date too much structure for one call —
should this be two passes?

**6. The stage plan.** Four stages: (1) pure arithmetic + types + fixture, (2) the pipeline stage,
(3) the panel, with 2 and 3 in parallel against stage 1's fixed contract, (4) join up. Is that the
right cut? Is the parallelism real given the file table, or will 2 and 3 collide? Is there a cheaper
first stage that would tell us the idea is wrong before we build any of it — the plan does **not**
propose an eval, and `docs/plans/260826ac-ideas-mode.md` has a section called "Run the eval before building any
of it". Should it?

**7. The awkward thing.** Is § "Say the awkward thing first" honest, or is it a rationalisation of a
summary feature? Its three answers are: rows are pointers not retellings; chronological order is a
genuinely different artefact from the prose; and the uncertainty is the content. Attack those.

**8. Anything else.** Security, privacy, logging (this repo never logs article prose), accessibility
of a panel whose meaning is carried by six typographic glyphs, dark mode, i18n, what happens on an
article with 200 dates, cost per run, and anything the plan simply has not thought of.

## How to answer

Ordered by how much it would cost us to get wrong. For each finding: what is wrong, why it matters
concretely, and what to do instead. Say plainly which of my eight questions you think I am asking
about the wrong thing.

Do not edit any file. This is a review.
