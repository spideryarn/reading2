# Glossary: citation entries before and after the "a cited work is not a term" rule

Up: [investigations.md](../project/investigations.md) · the plan:
[261003o](../plans/261003o-glossary-keeps-cited-works-out-citations-are-not-terms.md) · the feature:
[glossary.md § A cited work is not a term](../project/glossary.md#a-cited-work-is-not-a-term)

**Question.** Greg, 2026-10-03 (spya-zn97q5): *"I don't think the glossary should include citations.
That's what citations are for."* Does a rule in the glossary prompt keep cited works out, and what
does it cost?

**Short answer.** Yes, nearly. On the one local paper where the old prompt named a cited book as an
entry in three runs of five, the shipped prompt did so in none of ten. Citations used as aliases
fell from five in five runs to two in ten. **The cost is on the same paper:** its list is two or
three entries shorter on average, and two runs in ten came back much shorter than the old prompt
ever did. Essays were unchanged, and people the pieces talk about were kept.

## What was run

`evals/glossary-citations.ts`, 2026-10-03, on the box, against the local database. It calls
production's `generateGlossary` (Sonnet, no profile, a first pass) and stores each list under
`evals/results/glossary-citations/<arm>/`, with the prompt version and a hash of the prompt's
source files. `report` prints the table, every name or alias containing "et al" or a year, and
every person and work entry, to be read by hand. Nothing blind: the question is which entries
exist, and the lists are read against the paper's own text.

| Arm | Prompt | What it is |
|---|---|---|
| `before`, `before-2` … `before-5` | `glossary/8`, the tree before the change | The old prompt, five times: the control for wobble |
| `after`, `after-2` … `after-5` | first wording | A plain rule, no test and no worked example |
| `v2-1` … `v2-5` | first wording plus one clause | Tried and dropped, below |
| `v3-1` … `v3-10` | **the shipped wording** | The "what is the name's job" test, and a worked example |
| `noema-before-1` … `-3` | `glossary/8` | The old prompt on the essay with people in it |

The `before`, `after` and `v2` arms were separated in time, each run on the tree as it then stood.
`noema-before-*` was run later, from a temporary copy of the committed `src/glossary.ts`
(`git show HEAD:…`), because by then the tree had moved; it is the same file, loaded by another
name. **The "et al." guard in code was in place for the `v3` arms and not for the others**, so a
`v3` list is what a reader would get; the old prompt produced one "et al." alias in five runs, so
the guard accounts for very little of the difference.

Pieces: `source-spya-f550ta` (a review paper on ball lightning, dense with author-and-year
citations and with historical people), `entropy-24-00930-spya-pywwkq` (a methods paper),
`scaling-hypothesis` and `noema-mythology-of-conscious-ai` (essays, with people and works they
talk about and no author-and-year citations), and `analog-cognition-…` (a paper, first two arms
only: it showed nothing either way).

## Citations as entries or aliases

Read by hand from the report, on `source-spya-f550ta`:

| | old prompt, 5 runs | shipped prompt, 10 runs |
|---|---|---|
| An entry named for a cited book ("Rakov and Uman", "Stenhoff") | 5 entries, in 3 runs | 0 |
| An alias that is a citation | 5, in 4 runs ("Rakov and Uman (2003)" ×3, "Stenhoff (1999)", "Cen et al. case") | 2, in 2 runs ("Brand (1923, 2010)" on the book *Der Kugelblitz*; "fragmented science (2001)") |

The paper cites Stenhoff thirteen times and only ever as "(Stenhoff, 1999)" or "Stenhoff's book
(1999)"; "Rakov and Uman (2003)" likewise. Those are citations by any reading. On `entropy` the old
prompt gave "Williams and Beer" as a person in one run of five, and the shipped prompt in none of
five. The runs 261003d recorded earlier the same day under `glossary/8`
(`evals/results/paperwork-modes/after*/`) show the same shapes and more: "Turner (2001)" as an alias
of "fragmented science", "Hill et al. 2008 experiment".

Authors who appear in some old-prompt lists and may be citation-only (Uman, Bychkov, Nikitin,
Singer, Cen) still turn up now and then under the shipped prompt (Uman twice, Bychkov and Nikitin
once in ten runs). I did not read the paper's text for those five, so they are not counted either
way.

## What it cost

On `source-spya-f550ta`:

| | old prompt (5 runs) | first wording (5) | shipped wording (10) |
|---|---|---|---|
| Entries | 19, 17, 19, 18, 17 — mean 18.0 | 15, 16, 17, 14, 19 — mean 16.2 | 7, 17, 18, 17, 16, 14, 17, 12, 16, 18 — mean 15.2 |
| Person entries | 9, 9, 7, 9, 8 — mean 8.4 | 8, 4, 5, 2, 7 — mean 5.2 | 0, 8, 7, 8, 9, 5, 7, 2, 6, 8 — mean 6.0 |
| François Arago | 5 of 5 | 1 of 5 | 6 of 10 |
| Richmann, Charcot | 5 of 5 each | 5 of 5 each | 9 of 10 each |

Losing about two entries a run is the rule working: that is how many were citations. **The two
short lists (7 and 12 entries) are not.** The old prompt never went under 17 on this paper in these
five runs, or in the three 261003d recorded. The prompt says "fewer is fine", and with more to
leave out the model sometimes leaves out much more. *Find more* is what a reader has for a short
list.

Arago is the borderline case: the paper tells what he did and also cites him as "Arago (1837)".
The first wording dropped him four times in five. The shipped wording says a person the piece both
tells about and cites keeps their entry, and he is back in six of ten.

**Elsewhere nothing was lost:**

| | old prompt | shipped prompt |
|---|---|---|
| `noema` people (3 runs each) | 3, 2, 3 | 4, 4, 6 |
| `scaling-hypothesis` people; works (2 runs each) | 2, 4; 6, 4 | 3, 1; 4, 4 |
| `entropy` entries (5 runs each) | 19, 19, 20, 20, 21 | 20, 21, 20, 23, 19 |

## Two wordings that were dropped

- **The first wording used the eval paper's own citations as its examples** ("Rakov and Uman
  (2003)", "Turner (2001)", "Hill et al. 2008 experiment"), which I had copied from the recorded
  runs into the prompt. Its clean result (no citation entry or alias in five runs) is therefore
  not evidence: the prompt named the answers. The shipped wording uses invented examples from
  another field.
- **`v2`** added *"a year or a reference beside the name does not change that"* to win Arago back.
  `f550ta` came back with 12, 17, 15, 10, 13 entries and 1, 6, 7, 8, 2 people: no better on people
  and shorter overall.

GPT Sol's plan review asked for an operational test (*what is the name's job in the piece?*) and
worked BAD/GOOD cases. That is the shipped wording, and it is the one that kept the people.

## What was decided

- Ship the `v3` wording as `glossary/9`, with the "et al." guard in code behind it.
- The Citations cross-check the plan held in reserve (drop any entry or alias matching a cited
  work's in-text label) is not built. What still gets through is two aliases in ten runs on the
  densest paper we have, which does not pay for joining two pipeline steps.
- The shorter lists are named to Greg in the plan as the cost.

## What this does not show

- It is one citation-dense paper. The cost is measured there and nowhere else.
- The production article in the report (`arxiv-2610-spya-bfrbaj`) was not run; it is not in the
  local database.
- Nobody judged the quality of the entries that remain; this counted which entries exist.
