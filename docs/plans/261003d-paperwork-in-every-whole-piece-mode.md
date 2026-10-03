# The paperwork rule in every mode that writes from the whole piece

The second half of report `spya-k930hy` (Greg, admin; `scripts/feedback-reporter.ts` exited 0),
queue entry `qi-qczrxnye`:

> The structure, summary, tweet thread, and other such modes don't really need to include summaries
> of stuff like acknowledgements or conflicts of interest or affiliations or, you know, stuff like
> that that isn't really the content of the paper.
>
> — Greg, 2026-10-01, [SPIDERYARN-READING2-8M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8M)

The first half shipped as
[261001p](261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md): one shared section,
`paperwork(kind)` in `src/paperwork.ts`, in Summary, Tweets and both structure-step prompts, and the
takeaway lean. [261003c](261003c-summary-and-structure-skip-the-front-matter.md) then widened the
list to the title block and the reference list. 261001p's § Deferred named the rest: *"Sketch,
FAQ, Quiz, Ideas, Trajectory, Debate, Illustrated … the shared `paperwork()` makes each of them a
one-line import plus its own measurement."* This is that. Prompt changes, so
[prompting-guide.md](../project/prompting-guide.md) governs.

## Which modes, and why those

A survey of every prompt that is handed the whole article (`articleWithIds` or `articleText`). What
reaches the model today: `blocks.filter(isBodyEvidence)` removes only blocks stage 3 marked
`supplement` (detected notes and bibliography). The title block, the authors, affiliations,
acknowledgements, funding, disclosures, ethics and data statements all reach every one of them.

| mode | what it writes | how paperwork would leak | kind |
|---|---|---|---|
| Sketch (`src/sketch.ts`) | the argument as boxes and arrows | an "Authors" or "Funding" box; today's line even allows one, *"draw it once, muted"* | `summary` |
| Illustrated (`src/illustrated.ts`) | the Sketch, painted | follows the sketch, but sees the article too | `summary` |
| FAQ (`src/faq.ts`) | the questions a careful reader asks, answered from the piece | "Who funded this study?" | `pick` (new) |
| Quiz (`src/quiz.ts`) | recall questions | "Where do the authors work?" | `pick` |
| Ideas (`src/ideas.ts`) | the propositions the piece assumes or introduces | a disclosure or ethics approval as an "assumed" idea | `pick` |
| Quotes (`src/quotes.ts`) | the lines worth keeping | a warm line from the acknowledgements | `pick` |
| Glossary (`src/glossary.ts`) | terms and people the reader needs | funders, institutions, thanked people as entries | `pick` |
| Timeline (`src/timeline.ts`) | dates the story narrates | received/accepted dates, a grant's years. Its own *"EXCLUDE the piece's own dates"* covers publication, not the rest | `pick` |
| Arc (`src/arc.ts`) | one sentence per part, shown in Structure › Expanded | a part that is only References or Acknowledgements must get a sentence, and gets a summary of it | `part` (new) |

**Left out, with the reason** (each also listed in the coverage test below):

- **The paperwork is the content:** Citations (the reference list is its subject), the referee
  candidates prompt (needs the authors and affiliations), referee criteria (ethics, data
  availability and conflicts are what a reviewer checks), and the metadata readers
  (`paper-metadata`, `pdf-authors`, `pdf-frontmatter`, `citation-*`).
- **Asked modes, where the reader decides:** Chat, Remember, Live, Explain, Search. A reader may ask
  "who funded this?", and the answer is in the paperwork.
- **Low risk, not worth a stamp:** Skim (sees only the quotes, ideas and outline, never the
  article, so it inherits from Quotes and Ideas), Debate (its claims search; the identity half
  needs title and authors, and the stamp is pinned in two tests), Cross-references, Labels,
  referee claims (the title is a claim there). Named here so the next reader does not have to
  re-derive it.

## The change

### 1. Two more kinds in `paperwork(kind)`

Today there are `"summary"` (leave it out) and `"structure"` (keep the node, label it). Question-
and item-writing prompts read "do not summarise it" as not about them, so:

- **`"pick"`** — *Take nothing from it: no question, answer, idea, quote, term, person, organisation
  or date comes from a passage that is only paperwork. A person or organisation who appears only
  there is not part of the piece.*
- **`"part"`** — for Arc: *A part that is only paperwork still gets its sentence, because there is
  one per part: a short plain label of what it is ("The references."), with no claim. The rules
  for the first and last part apply to the first and last parts that are content.*

The list and the by-role clause stay shared; only the kind's sentence differs, as before.

### 2. Each prompt interpolates it beside `plainWords(...)`

One line per prompt, and three existing lines reconciled so the prompt gives one rule, not two:

- **Sketch**: *"If the article has a part that is apparatus — notes, bibliography,
  acknowledgements — leave it out or draw it once, muted, at the bottom"* becomes *"…notes, and the
  paperwork below — leave it out."* The muted box was the leak.
- **Timeline**: the piece's own dates rule stays (it is about the author's reporting, which is not
  paperwork); the paperwork section covers received/accepted/grant dates.
- **Glossary**: *"the article's own title, or the author's name"* stays; the section adds the rest.

### 3. A coverage test, so the next mode gets it by default

`tests/paperwork-coverage.test.ts`, the shape of `tests/plain-words-coverage.test.ts`: every
`src/` file that hands a model the whole article (`articleWithIds(` or `articleText(`, found by
syntax) calls `paperwork(` or is in `PAPERWORK_EXEMPT` in `src/paperwork.ts` with its reason. Seen
red first, by deleting one interpolation. And a line in [mode.md](../project/mode.md)'s checklist.

**What it cannot see:** a file with two prompts passes if either carries it (Debate's would, if it
were not exempt), and a prompt that reads the article some other way (the structure step numbers
its own blocks) is invisible. A default, not a proof — the same limits plain-words' test states.

### 4. Stamps

Bump each prompt stamp the text reaches, so a stored output reads *outdated* and Metadata offers to
write it again, as 261001p did for Tweets: `sketch/4→5`, `illustrated/5→6`, `faq/5→6`,
`quiz/6→7`, `ideas/4→5`, `quotes/8→9`, `glossary/7→8`, `timeline/4→5`, `arc/6→7`. Nothing is
rebuilt; each stored output gets a *Write it again* button. Arc is regenerated only when the
pipeline runs (stage 5b), so new articles and re-runs.

**Quiz is the one judgement call.** Its own note says a bump is for when *what a question is*
changes, not for a wording fix, because the button lands in front of every reader with a quiz.
This does change what a question may be about, so it bumps; the alternative is that no stored quiz
ever gets the rule.

**The simpler option passed over:** paste the rule only into the three Greg's report and the
deferral named (Sketch, FAQ, Quiz). The leak is the same in the other six, and the coverage test is
what stops a tenth mode needing its own report.

**The bigger option passed over, still deferred:** mark paperwork blocks `supplement` at stage 3,
so no model sees them (261001p § Deferred). Deterministic and total, but it changes what counts as
body for every stage and every asked mode, which is where readers legitimately want the paperwork.

## Measuring it

prompting-guide.md § Measuring a prompt change, with a sharper screen than 261001p had, because
most of these modes cite blocks:

- **Articles:** the four local papers 261001p used (`entropy-24-00930-spya-pywwkq`,
  `source-spya-f550ta`, `analog-cognition-and-consciousness-4-28-26-spya-f03kqf`, and
  `scaling-hypothesis` as the boundary case, where OpenAI's funding is argument).
- **Paperwork blocks marked by hand**, per article, from the local blocks, in the harness (as 261003c
  marked each abstract).
- **Arms:** `before`, `before-2` (the control) on the parent commit; `after` on this one; an
  `after-2` if the first pair is close.
- **What runs:** production's `generate*` for each of the nine, no profile, `power: "standard"`.
  An extension of `evals/paperwork/run.ts` (`--set modes`), recording each prompt source's hash.
- **The screen:** for each output item, its cited blocks; an item whose blocks are *all* paperwork
  is a paperwork item. Count per mode per arm, and item counts overall (a large drop would mean the
  rule ate content). For Glossary and Arc, which cite no blocks, the 261001p regex, every hit read.
- **Blind judge** only where the `before` arms show paperwork items: pairs per mode and article,
  shuffled with `blindCoin`, asking which spends less on paperwork and whether either lost or bent
  something of the piece's content. Against the control.
- **The boundary:** on `scaling-hypothesis`, the funding-as-argument passages must still appear.
- **Read the outputs anyway.** Budget about $15.

## What GPT Sol's plan review changed

[261003d-…-plan-review-sol.md](261003d-paperwork-in-every-whole-piece-mode-plan-review-sol.md): no
P0, four P1s, all taken. The sections above are the plan as first written; the code differs here:

- **P1, Debate is in.** Its identity pass sees only the title and byline, so the rule cannot hurt
  it; its claims pass (`CLAIMS_SYSTEM`) reads the whole article and picks claims, so it takes
  `paperwork("pick")`. `debate/5 → debate/6`, and its pinned test moves. **Not measured**: each run
  is a paid web search per claim, and the text it gains is the same `pick` section measured on six
  other modes. Said here rather than implied.
- **P1, Illustrated and an older Sketch.** Paint again on a Sketch that is only *outdated* still
  paints every scene, so a muted paperwork box from `sketch/4` could reach the plate. Rather than
  refusing an outdated Sketch (a product change), Illustrated's per-node instruction now says a
  node that is only paperwork, *"which an older sketch may still have, gets nothing: leave it out of
  the picture"*. Nothing in the code requires a vignette per node, so leaving one out is valid.
- **P1, Arc's bump spends money on its own.** The plan said Arc is rewritten only when the pipeline
  runs. Wrong: an owner opening an article whose arc is older queues a new one
  (`src/web/useArc.ts`). So `arc/7` costs one Sonnet call per article, once, when its owner next
  opens it. Accepted: Arc is the one mode where the `before` arm showed paperwork in the output
  (below), and this is how every earlier Arc bump reached readers. Said in `src/arc.ts`'s history.
- **P1, a screen per mode.** The harness reads each mode's own anchors — FAQ's passages, Quiz's
  evidence, Ideas' and Timeline's occurrences, a quote's block, a glossary entry's blocks, a vignette's
  block, a sketch node's block, an arc entry's range — and puts the unanchored prose (captions, plate
  titles, the image prompt) through the word screen.
- **P2s taken:** `pick` says *choose nothing from it alone; every item must come from the content*
  rather than an absolute *take nothing*; `part` named the three Arc rules it was an exception to
  (relational, no part titles, first/last part) — and was then replaced by the measurement, which
  found the label broke Arc's sentence count (Ledger); the coverage test's header names its false
  positives too; the client-facing stamps live in `sketch-scene.ts`, `illustrated-plate.ts` and
  `arc-version.ts`, and moved there. Illustrated's version is in its input fingerprint, so its plates
  read stale as well as outdated — the same as every Illustrated bump.
- **Noted, not changed:** writing Quotes again can break a saved link to a quote unless the same
  words are chosen again. That is true of every *Write them again*, and the reader chooses it.

## Ledger

Four papers, the nine modes through production's own `generate*` (no profile, standard power),
results under `evals/results/paperwork-modes/`, harness `evals/paperwork/modes.ts`. Arms: `before`
and `before-2` on the old prompts (same prompt hashes, checked); `after` on the first wording;
`after-2` on the final one; `after-3`, one paper, to test a failure (below). Plus targeted
repeats of Arc and Quiz from scratch copies of the old and new prompt files, since removed. About
$12 in all.

### What the old prompts did

**On these papers, eight of the nine modes already left the paperwork out.** The block screen found
no item anchored only in paperwork in Sketch, Illustrated, FAQ, Quiz, Ideas, Quotes, Glossary or
Timeline, in either old arm, and every word-screen hit read as body content. The one exception the
judges found was Timeline on `scaling-hypothesis`, spending two events on the essay's own editor's
note and follow-up post. So for most modes this change is a guard — against the article Greg was
reading, which has nine authors and an AstraZeneca disclosure — not a fix of something these four
papers show.

**Arc is where it leaked**, because Arc owes one sentence per part and Structure gives the
paperwork its own parts: *"Only the authors and their disclosures stand before the argument itself
begins."*, *"what follows are only pointers outward, not further argument."*

### Arc: the first wording failed, and what replaced it

The plan's `"part"` kind made a paperwork part's sentence a plain label. It failed in a way the
plan did not foresee: on `entropy-24`, whose first part is the title block *and* the abstract, the
model wrote the label and then a second opening sentence, so **3 answers in 36** had one sentence
too many and Arc refused them (`buildArc`). The old prompt did this **0 times in 14**. The guard
sentence *"the label IS that part's one sentence"* did not help (1 in 10).

The replacement is simpler: Arc's sentence is *where the argument stands as this part opens*, which
is as true of a paperwork part as any other. So a paperwork part keeps its ordinary sentence —
what is at stake at the start, what is settled at the end — and the sentence may not mention the
paperwork. **16 of 16** well-formed on `entropy-24`, and 0 malformed in every later run.

| paperwork in the Arc sentence | old prompt | new prompt |
|---|---|---|
| `analog-cognition`, the opening part (authors, disclosures) | 2 of 2 | 1 of 7 |
| `scaling-hypothesis`, the closing part (links) | 2 of 2 | 0 of 1 |
| `source` (ball lightning), the closing part (data, interests, thanks), by my reading | about 6 of 8 | about 4 of 8, and lighter: the conclusion leads |

Reduced, not removed. The rest belongs to the deterministic option deferred above.

### A failure that was load, not the prompt

The two full `after` arms lost half of Quiz's questions on `source` (10 and 14 dropped as
*unquoted*: the evidence quote not found in the passage named), and `after-2`'s FAQ there failed
outright on 14 block ids that are not in the article. Neither old arm did it. In isolation it does
not reproduce: **Quiz 5 of 5 clean on each prompt, old and new; FAQ 5 of 5 clean on the new**, and
`after-3` (the same paper alone, all nine modes) was clean. Both bad runs were inside a burst of 36
concurrent calls. Recorded as seen, not chased: it is not this change, but a model that cites ids
it was not shown under load is worth knowing about.

### The blind read

Two Opus judges, each reading one `pairs.md` only, 12 pairs (one per mode, Arc on all four
papers), keys balanced 7 : 5, unblinded afterwards.

| | less paperwork (new : old : tie) | preferred (new : old : tie) |
|---|---|---|
| new (`after-2`) vs old (`before`) | **3 : 0 : 9** — Timeline's editor's notes, Arc's closing "pointers", Arc on ball lightning | 7 : 5 : 0 |
| control, old vs old (`before-2` vs `before`) | 1 : 0 : 11 (one draw happened to skip the editor's note) | 7 : 2 : 3 |

**Paperwork goes down where there was some, and preference is inside the control's spread**, so no
quality effect either way: neither judge's worst faults (an invented date in a new Timeline; Quiz
and FAQ questions whose passages do not answer them, on both sides) is a paperwork effect, and the
control produced faults of the same kinds. **The boundary held**: on `scaling-hypothesis` the new
prompts keep OpenAI's funding as argument — the *"lacking anything like DM's long-term funding"*
quote and OpenAI LP in the Glossary.

Debate was not measured (above).
