# Glossary: citation entries before and after the "a cited work is not a term" rule

Up: [investigations.md](../project/investigations.md) · the plan:
[261003o](../plans/261003o-glossary-keeps-cited-works-out-citations-are-not-terms.md) · the feature:
[glossary.md § A cited work is not a term](../project/glossary.md#a-cited-work-is-not-a-term)

**Question.** Greg, 2026-10-03 (spya-zn97q5): *"I don't think the glossary should include citations.
That's what citations are for."* Does a rule in the glossary prompt keep cited works out, and what
does it cost?

**Short answer.** Yes, nearly. On the one local paper where the old prompt named a cited book in
four runs of five, the shipped prompt did so in none of fifteen. Among the candidates checked
against the text, citations used as aliases fell from six aliases in all five runs to two in
fifteen. Five author-shaped candidates were not classified, so two is a confirmed lower bound, not
the total residual failure rate. **The cost is on the same paper:** its list is about two entries
shorter on average, and two runs in fifteen came back much shorter than the old prompt ever did.
The small essay samples showed no clear regression, but are too small to call unchanged; the people
and works watched there still appeared under the shipped prompt. **Batches of the same prompt
differ by as much as some of the wordings do** (means of 15.2 and 18.4 entries for the same
wording, an hour apart), so only the citation counts, not the list lengths, are firm.

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
| `v3-1` … `v3-10`, `v3b-1` … `v3b-5` | **the shipped wording** | The "what is the name's job" test, and a worked example; two batches |
| `final-1` … `final-5` | shipped wording plus two edits from code review | Tried and taken back out, below |
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

| | old prompt, 5 runs | shipped prompt, 15 runs |
|---|---|---|
| An entry named for a cited book ("Rakov and Uman", "Stenhoff") | 6 entries, in 4 runs ("Rakov and Uman" ×4, "Stenhoff" ×2) | 0 |
| An alias that is a citation | 6, in 5 runs ("Rakov and Uman"; "Rakov and Uman (2003)" ×3; "Stenhoff (1999)"; "Cen et al. case") | 2, in 2 runs ("Brand (1923, 2010)" on the book *Der Kugelblitz*; "fragmented science (2001)") |

The paper cites Stenhoff thirteen times and only ever as "(Stenhoff, 1999)" or "Stenhoff's book
(1999)"; "Rakov and Uman (2003)" likewise. Those are citations by any reading. The first old run's
alias "Rakov and Uman" has no year, so the report's regex did not flag it; the raw JSON shows it as
an alias of "Martin A. Uman". On `entropy` the old prompt gave "Williams and Beer" as a person in
one run of five, and the shipped prompt in none of five. The runs 261003d recorded earlier the same
day under `glossary/8`
(`evals/results/paperwork-modes/after*/`) show the same shapes and more: "Turner (2001)" as an alias
of "fragmented science", "Hill et al. 2008 experiment".

Authors who appear in some old-prompt lists and may be citation-only (Uman, Bychkov, Nikitin,
Singer, Cen) still turn up now and then under the shipped prompt (Uman in three runs of fifteen,
Bychkov in two, Nikitin in one). I did not read the paper's text for those five, so they are not counted either
way. That is a limit on the result, not evidence that they are safe: if any name is only a citation,
the shipped prompt's failure rate is higher than the two confirmed aliases above.

## What it cost

On `source-spya-f550ta`:

| | old prompt (5 runs) | first wording (5) | shipped wording (15: `v3` then `v3b`) |
|---|---|---|---|
| Entries | 19, 17, 19, 18, 17 — mean 18.0 | 15, 16, 17, 14, 19 — mean 16.2 | 7, 17, 18, 17, 16, 14, 17, 12, 16, 18, then 18, 20, 19, 17, 18 — mean 16.3 |
| Person entries | 9, 9, 7, 9, 8 — mean 8.4 | 8, 4, 5, 2, 7 — mean 5.2 | 0, 8, 7, 8, 9, 5, 7, 2, 6, 8, then 8, 10, 7, 10, 5 — mean 6.7 |
| François Arago | 5 of 5 | 1 of 5 | 10 of 15 |
| Richmann, Charcot | 5 of 5 each | 5 of 5 each | 14 of 15 each |

Losing about two entries a run is the rule working: that is how many were citations. **The two
short lists (7 and 12 entries) are not.** The old prompt never went under 17 on this paper in these
five runs, or in the three 261003d recorded. The second batch of the shipped wording had no short
list and averaged 18.4, so how often it happens is not pinned down: two in fifteen is what was
seen. The prompt says "fewer is fine", and with more to
leave out the model sometimes leaves out much more. *Find more* is what a reader has for a short
list.

Arago is the borderline case: the paper tells what he did and also cites him as "Arago (1837)".
The first wording dropped him four times in five. The shipped wording says a person the piece both
tells about and cites keeps their entry, and he is back in ten of fifteen.

**The small samples elsewhere showed no clear regression:**

| | old prompt | shipped prompt |
|---|---|---|
| `noema` people (3 old runs, 8 shipped) | 3, 2, 3 | 4, 4, 6, 3, 3, 3, 7, 7 |
| `scaling-hypothesis` people; works (2 runs each) | 2, 4; 6, 4 | 3, 1; 4, 4 |
| `entropy` entries (5 runs each) | 19, 19, 20, 20, 21 | 20, 21, 20, 23, 19 |

## Three wordings that were dropped

- **The first wording used the eval paper's own citations as its examples** ("Rakov and Uman
  (2003)", "Turner (2001)", "Hill et al. 2008 experiment"), which I had copied from the recorded
  runs into the prompt. Its clean result (no citation entry or alias in five runs) is therefore
  not evidence: the prompt named the answers. The shipped wording uses invented examples from
  another field.
- **`v2`** added *"a year or a reference beside the name does not change that"* to win Arago back.
  `f550ta` came back with 12, 17, 15, 10, 13 entries and 1, 6, 7, 8, 2 people: no better on people
  and shorter overall.

- **`final`**: GPT Sol's code review found that two older sentences in the prompt contradict the
  new rule ("People and works named without introduction still earn entries of their own"; "Each
  term, and each person, keeps an entry of its own") and qualified them with "unless the piece names
  them only as a citation" and "eligible". Run five times: no citations, but `f550ta` gave 13, 13,
  16, 9, 15 entries (mean 13.2) and `noema` gave 1, 6, 1 people in three runs. Those two sentences
  were written to stop people being dropped
  ([260926a](../plans/260926a-plainer-summaries-and-glossary.md)), and weakening them looked like
  it did what they were there to prevent. Five runs against batch wobble this large do not prove
  that, but nothing showed the edits helping, so the two sentences went back to the wording `v3`
  measured, and `v3b` was run to confirm it. The contradiction stays in the prompt; the model reads
  the specific rule over the general sentence, on this evidence.

GPT Sol's plan review asked for an operational test (*what is the name's job in the piece?*) and
worked BAD/GOOD cases. That is the shipped wording, and it recovered more of the people than the
first wording did.

## What was decided

- Ship the `v3` wording as `glossary/9`, with the "et al." guard in code behind it.
- The Citations cross-check the plan held in reserve (drop any entry or alias matching a cited
  work's in-text label) is not built. Two confirmed aliases still get through in fifteen runs on the
  densest paper, and the unclassified authors above mean that is a lower bound. The cross-check
  remains out of this change because it would join two pipeline steps to solve a wider class than
  the reported `et al.` case, not because this eval established that only two failures remain.
- The shorter lists are named to Greg in the plan as the cost.

## What this does not show

- It is one citation-dense paper. The cost is measured there and nowhere else.
- The production article in the report (`arxiv-2610-spya-bfrbaj`) was not run; it is not in the
  local database.
- Nobody judged the quality of the entries that remain; this counted which entries exist.
- The essay comparisons have only two old/shipped runs on `scaling-hypothesis` and three old runs
  on `noema`; they can reveal an obvious loss, not establish that the essays are unchanged.
