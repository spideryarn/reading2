# Plainer summaries and glossary: a name is a handhold, not an explanation

From SPIDERYARN-READING2-44, a suggestion from Greg, overseer queue entry `qi-qpsx92kg`.

**Status:** stages 1 and 1b shipped to `dev` 2026-09-26; stage 2 committed (`570c5536`) 2026-09-28.
**Stage 3 (one shared rule for every prompt) built and tested; its `after` arms wait on OpenRouter credit.** Written before the work, per
[engineering-manager.md](../reusable/engineering-manager.md).

## What Greg said

> we want the summaries to really use simpler language, because half the problem is we may not know
> what the jargon means, and the glossary as well especially should explain in simpler language.
>
> — Greg, 2026-09-26, sent from `/read/bf03197835-spya-qfwsw2?mode=glossary&deep=2` (production; not
> readable from the box)

## Why this is the second time, and what the first one left open

On 2026-09-03 thirteen prompts were given the same plain-words rule (commit `89f15dfb`,
[new-mode.md § The words the mode puts in front of the reader](../project/new-mode.md)):

> **the article's own words for the things the article names** — those are the reader's handholds —
> and **ordinary words for everything else** … plainer than the article, never further from it.

That rule is what lets the jargon through. Every term of art *is* a thing the article names, so "keep
the article's own words for the things it names" exempts exactly the words Greg is complaining about.
The handhold half is right — a reader has to be able to find the word again in the prose — but it has
been doing a second job it was never meant to: leaving the word unexplained.

The fix (Fable's framing, adopted): **keep the name as a handhold, and never leave it bare.** A term a
well-read non-specialist would not know is either said in ordinary words instead, or kept with a short
plain gloss beside it. And a guard in the same breath, because the product is about augmenting
reading, not replacing it ([vision.md](../project/vision.md)): **plainer is the same claim in commoner
words, never a looser claim.** "Uses a clever method" for "uses gradient descent" is vaguer, not
plainer.

## What changes

*Written before the build and describing v1. The candidate is v3's gists and v5's glossary: a
self-check, a 20-word first sentence for glossary fields, "at most one term of art" at the root and
depth 1, worked examples, and two guards intended to fix regressions v3 and v4 caused — § What
happened in stage 1 says what the eval found.*

### Summaries — `src/hierarchy.ts` `SYSTEM`, and `src/hierarchy-expand.ts` `EXPAND_SYSTEM`

The last bullet of GISTS (the handhold rule) becomes three bullets:

1. **Handhold, not explanation.** Keep the article's name for a thing the reader will look for in the
   prose, but if a well-read reader outside the field would not know it, either say it in ordinary
   words instead or keep it and add a few plain words beside it. Never a bare hard word.
2. **The gloss counts toward the word limit.** Where it does not fit — usually at the root — the plain
   phrase replaces the term. Everything that is not a name: the commonest word that loses nothing.
3. **Plainer is not vaguer.** Keep every number, name, direction and condition; if replacing a term
   would drop what the sentence asserts, keep the term and gloss it.

`EXPAND_SYSTEM`'s gist bullet gets the same three, so the cascade's fine rungs do not drift from the
structure call's.

**QUESTIONS is left byte-for-byte alone in the first cut**, and that is deliberate.
`tests/summaries-eval.test.ts` asserts the production QUESTIONS block *is* `variants.md` § V4, the
text the Socratic eval measured, and its last bullet already says *"ordinary words for the rest,
exactly as with gists"*, so it inherits the gist rule by reference. If the eval below shows the
question lines did not get plainer, stage 1b edits that bullet too and pins the old block in
`variants.md` as *The shipped QUESTIONS block, toc/7*, the way `toc/6` was pinned — the precedent
exists, it is just more bookkeeping than a first cut needs to buy blind.

**Titles are not touched.** A title is a landmark, and most are the author's heading copied
unchanged; plain-wording them would break the one thing they are for.

`PROMPT_VERSION` `toc/7` → `toc/8`. **New articles only** — the decision Greg made twice
([hierarchy.md § prompt-versions](../project/hierarchy.md#prompt-versions)); an existing tree keeps
its gists until its stage is re-run from the metadata page. The bump also invalidates structure
checkpoints for articles mid-stage, which is what it is for. The byte pins in
`tests/hierarchy-structure-request-parity.test.ts` and `tests/hierarchy-prompt-hoist.test.ts` move
with it, on purpose.

### Glossary — `src/glossary.ts` `SYSTEM`

The WRITING section gains:

- **Who it is for:** a curious, well-read reader who has never studied this field.
- **No second hard word.** Nothing in an entry that reader would need to look up, unless the sentence
  explains it as it goes. If the only accurate definition needs another hard word, define that in the
  same breath.
- **Lead with the everyday sense**; a more exact restatement may follow, never lead.
- **One everyday example or comparison is allowed** when it carries the meaning, in a clause, not for
  its own sake.
- **Plainer is not vaguer** — same guard as the gists.

and a worked BAD/GOOD pair beside the existing Lamport one, because the existing pair is about
describing the page and says nothing about register. A negative example is the strongest guard
against a register (glossary.md § A prompt ban relocates a register).

`PROMPT_VERSION` `glossary/4` → `glossary/5`. **Unlike the tree, this reaches existing glossaries**:
the version is compared on read (`outdated`, `src/store/pg.ts`), and every older list shows the
banner with *Find them again*. That is the glossary's designed migration and every previous bump used
it. **But the banner's copy is wrong for this bump** — it still says *"These were written before
entries said where each half came from"*, which was true of `glossary/1` only. It becomes a sentence
true of any version: written by an earlier version, finding them again rewrites them the way they
would be written now. Regeneration is per reader, on a click, and inherits term ids, so `?term=`
links survive.

### Docs

- `new-mode.md` § The words the mode puts in front of the reader — Greg's new sentence under the old
  one, and the handhold rule restated as *handhold, not explanation*. Only summaries and glossary
  change prompts now; the other eleven prompts that carry the old rule are named as the deferred rest.
- `summaries.md`, `glossary.md` — a paragraph each, and `hierarchy.md` § prompt-versions gets `toc/8`
  as the third application of the same decision.

## The eval

**Is the new prompt actually plainer, and did it get vaguer on the way?** Both halves, because a
readability number alone rewards the failure the guard exists for.

`evals/plain-words/run.ts` calls the production structure request and `generateGlossary` — the same
functions the pipeline calls, so no prompt is copied into the eval — on three jargon-heavy local
articles, once on the commit before the prompt change (`--arm before`) and once after:

- `entropy-24-00930-spya-pywwkq` — an information-theory paper (the hard case)
- `olah-a4-spya-ujr7p0` — an ML interpretability essay
- `noema-mythology-of-conscious-ai` — the consciousness essay the Socratic eval used

Measured:

1. **Hard-word share** per field (root / depth-1 / depth-2 gists, questions, `senseHere`,
   `background`): the share of words outside the 6,000 commonest English word forms (`wordfreq`).
   **A gate, not a target** — it must fall, and nothing is concluded from a fall alone.
   Flesch-Kincaid is skipped on purpose: sentence length dominates it, and the gloss rule lengthens
   sentences deliberately.
2. **Words per line**, so a fall in hard words that came from shorter lines is visible as such.
3. **Side by side, for fidelity as well as plainness** — before and after pairs for the same nodes
   and the same terms, read by me and by a blind Fable pass asked two questions per pair: which is
   easier for an outsider, and did either lose or bend a claim. This is the evidence; the number only
   screens.

Cost: one structure call and one glossary call per article per arm. The tree is about a tenth of a
cent per block ([open-questions.md § Q7](../project/open-questions.md#q7)); six calls over three
articles is well under two dollars. Not a spend question.

**What it cannot say.** One sample per arm, so model wobble is not separated from the prompt's
effect; the cascade's `EXPAND_SYSTEM` is not exercised; and a common-word list is a proxy for "a
reader outside the field knows this word". The Socratic eval's judge, which does score simplicity
against fidelity, measures GISTS and QUESTIONS *blocks* over a fixed tree and would need an arm for
this — more machinery than this change is worth unless the side-by-side is ambiguous.

## Stages

| | what | ends when |
|---|---|---|
| 0 | this plan, reviewed by GPT Sol; the `before` arm generated | review answered |
| 1 | the prompt edits, the version bumps, the banner copy, the pins; the `after` arm; the report | gates green, the pairs read, Sol code review, committed |
| 1b | only if the questions did not get plainer: the QUESTIONS bullet, with the V4 pin | as stage 1 |
| 2 | docs, the user-feedback note, the queue entry | pushed to `dev` |

## GPT Sol on the plan, round 1 (2026-09-26)

No P0; five P1s and four P2s, all accepted. Its framing of the fix was better than mine and is the
one the prompts use: *keep an unfamiliar term when the reader needs it to recognise the prose, but
make the sentence understandable without already knowing it; work the meaning into the sentence, no
dictionary asides; plain means equally specific.*

| | finding | what changed |
|---|---|---|
| F1 P1 | `EXPAND_SYSTEM` changes need `EXPAND_PROMPT_VERSION` bumped too | `expand/5`, and its stamp tests |
| F2 P1 | `summaries-eval.test.ts` also asserts the pinned `toc/6` GISTS block *is* production's | the pin stays as history; the tests now say production has moved past it — not re-pinned |
| F3 P1 | "keep every number, name…" is unsatisfiable in an 18-word root | "do not lose a number, name, direction, comparison or condition *the claim depends on*"; no bracketed asides; never explain an ordinary word |
| F4 P1 | an "everyday example" in `senseHere` would break its article-only provenance | an example in `senseHere` must come from the article; the model's own comparison goes in `background`. "No second lookup" rather than "no second hard word" |
| F5 P1 | the eval pooled lines, dropped ranges, skipped production's question filter, had no pairing and one sample | ranges kept, pairing by range and term name, questions through `questionFor`, a blind `pairs` file with a separate key, and a `before-2` arm for the wobble |
| F6 P2 | the metric was not a gate, exempted every ≤2-letter token, was ASCII-only, ignored limits | Unicode words, no short-word exemption, per-field over-limit lists, matched before→after columns, and `tests/plain-words-metric.test.ts` |
| F7 P2 | the stage-1b trigger was too weak | 1b is a gate on matched root and depth-1 questions separately |
| F8 P2 | the lookup path is `term-lookup.ts` → `explain.ts`, shared with Explain mode | deferred, named accurately below |
| F9 P2 | `outdated` is inequality, so "earlier version" is false after a rollback; public readers never see the banner | *"written by a different version of the glossary"*; "every owner's older glossary" |

## What happened in stage 1: three versions, and what the numbers said

**The first two versions did almost nothing, and the first screen could not see it.** The runs are in
`evals/results/plain-words/`: `before` and `before-2` are the old prompts twice (the wobble),
`after` is v1, `after-2` v2, `after-3` v3, and `after-4` to `after-6` are the glossary guards
below; `after-6` is the candidate that entered round-2 review.

| | first sentence of `senseHere` | hard words in it (types, not counting the term) | other entries it leans on |
|---|---:|---:|---:|
| before | 33.3 words | 4.91 | 0.91 |
| before-2 | 33.9 | 5.06 | 0.78 |
| v1 (`after`) | 37.1 | 5.32 | 0.78 |
| v2 (`after-2`) | 34.2 | 4.91 | 0.78 |
| **v3 (`after-3`)** | **28.2** | **3.16** | **0.38** |

v1 and v2 left *transfer entropy* as *"a directional measure of how much a source neuron's past
activity reduces uncertainty about a target neuron's future activity"*. Fable diagnosed why from
the outputs:

- **The loophole came back.** v1's self-check exempted "the term itself and names the article uses",
  and in a paper every hard word is article-named. It is the 2026-09-03 exemption again, one level
  down.
- **The example was in the wrong field.** All of the technical paper's entries are `senseHere`, and
  my BAD/GOOD pair was a `background` one.
- **`senseHere` read as "the author's definition".** For a paper, the author's meaning *is* a
  formal definition, so restating it looked like fidelity.

v3 says the meaning comes from the article and the words are ours, exempts only the term and proper
names, asks for a first sentence of at most 20 words with no other hard word, and carries a
`senseHere` worked pair. **The worked subjects are ones none of the three eval articles touch**
(moral hazard, twin studies, and — after round-2 review — the prisoner's dilemma) — Fable's drafts
used the eval article's own terms, which would have taught the test.

The share-of-hard-words screen was **flattering** v1 and v2: an explanation adds common words around
the same hard ones, so the share falls while the entry gets longer and no easier. The per-entry
screens above (Fable's suggestion) are the ones that moved only when the entries did.

### Two regressions the plainness rule caused, and the guards

The share and the per-entry screens both said v3 was better. Reading the entries said two more
things were wrong, and both were caused by the new rules:

- **Outside knowledge moved into `senseHere`.** In `after-4`, one entry in 46 had a `background`
  (the old prompt: 7 and 18); *"A classic visual illusion where two equal-length lines look
  different…"* was labelled as coming from the article. That is the provenance label lying, which
  is the thing `glossary/2` was built to stop (Sol's F4, arriving by another road). Guard: *what a
  term ordinarily means, who a person is, who coined an idea … is "background", however plainly you
  can put it.* `after-5`: 12.
- **People were dropped and terms were fused.** Chalmers, Hinton, Turing and Vallor went, and
  *"Blake Lemoine and LaMDA"* and *"Anthropocentrism, human exceptionalism and anthropomorphism"*
  arrived. The cross-reference rule (*an entry that can only be understood by reading another entry
  has explained nothing*) is the likely cause: merging is the cheapest way to obey it. Guard:
  *rewrite the words, never the list of entries … each term, and each person, keeps an entry of its
  own.* `after-6`: Chalmers, Hinton and Turing are back, but Vallor and Turkle are not; the entry
  count is the old one (50 against 50), with a different list.

Two fused names survive in `after-6`, and both carry every part as an alias, so every occurrence in
the prose is still found ([term-match.ts](../../src/term-match.ts) matches name and aliases); the
three biases are a group the essay itself names together. The aliases make the occurrence matching
work, but *Blake Lemoine and LaMDA* still combines a person and a chatbot against the prompt's
one-entry-per-thing rule, so the guard did not fully work. The screens that catch both are in
`run.ts` now — entries with `background`, and fused names.

Round-2 review found that the background count did not prove the provenance guard worked:
`after-6` still defines the ordinary *Müller-Lyer illusion* and *pareidolia* in `senseHere`, despite
the prompt naming a famous illusion's ordinary meaning as `background`. The review added a worked
concept-allusion pair from a fourth subject (the prisoner's dilemma): ordinary meaning in
`background`, and no `senseHere` when the article has not bent it. `after-7` and `after-8` are the
two paid reruns with that pair in the prompt; § The valid blind read records what they did and did
not fix.

| | entries | with `background` | first sentence of `senseHere` | hard types in it | other entries leaned on |
|---|---:|---:|---:|---:|---:|
| before | 50 | 7 | 33.3 | 4.91 | 0.91 |
| before-2 | 54 | 18 | 33.9 | 5.06 | 0.78 |
| v3 (`after-3`) | 47 | 10 | 28.2 | 3.16 | 0.38 |
| v4 (`after-4`) | 46 | **1** | 30.1 | 3.36 | 0.31 |
| v5 (`after-5`) | 45 | 12 | 27.3 | 2.63 | 0.42 |
| **candidate (`after-6`)** | **50** | **10** | **27.2** | **3.15** | **0.75** |

The candidate gives back some of the cross-reference gain while restoring three people and the
number of background fields. It still misses two people and still mislabels some outside knowledge,
which are defects rather than trades to argue away; a leaning entry is merely a weaker entry.

### The attempted blind read — the side shuffle was broken

100 pairs of `before` against `after-3`, matched by node range and term name, were judged by Fable
from the pairs file alone (`pairs-before-vs-after-3.md`; the verdicts are in `.judged.txt` and the
key in `.key.tsv`). Round-2 review found that the advertised seeded coin was broken by JavaScript
number precision: it put the new arm on X once and on Y 99 times (once and 94 times in the 95-pair
`after-6` read). Fable could not see the key, but a fixed side cannot rule out a preference for the
second item. The tables below are an accurate decoding of the recorded judgments, not valid
randomised blind evidence; the pair files must be regenerated and judged again.

| field | v3 plainer | old plainer | same |
|---|---:|---:|---:|
| `senseHere` | 34 | 0 | 1 |
| depth-1 question | 13 | 0 | 1 |
| depth-1 gist | 11 | 4 | 0 |
| deeper gist | 19 | 9 | 1 |
| root gist | 1 | 2 | 0 |
| root question | 2 | 1 | 0 |
| background | 1 | 0 | 0 |
| **all** | **81** | **16** | **3** |

**The recorded fidelity flags:** five pairs were flagged: three against the old lines (a blurred
finding, a dropped strand, *who* was dismissed bent) and two against v3 — one depth-1 gist narrating
the page (*"The summary concludes … followed by author and funding credits"*) and one entry that
glossed the person rather than the 1989 paper cited.

**The `after-6` candidate, read the same way** (`pairs-before-vs-after-6.*`, 95 pairs, a fresh blind
Fable told to judge ease rather than length):

| field | candidate judged plainer | old judged plainer | same |
|---|---:|---:|---:|
| `senseHere` | 32 | 1 | 0 |
| `background` | 3 | 0 | 1 |
| depth-1 question | 8 | 2 | 3 |
| depth-1 gist | 11 | 2 | 0 |
| deeper gist | 21 | 3 | 2 |
| root gist | 3 | 0 | 0 |
| root question | 3 | 0 | 0 |
| **all** | **81** | **8** | **6** |

**The recorded fidelity result costs something, and it is named rather than argued away**: 5 of 95
flagged against the candidate lines, 1 against the old. Two narrate the page (a depth-1 gist *"are
shown to be"*, a question *"what has this review established"*), one depth-1 gist drops the reason a
distinction matters, one entry drops *"regardless of the material"* from computational
functionalism, and one root gist softens the essay's recommendation (*"myth"*, *"refuse to
build"*). In the v3 read it was 2 against the new side and 3 against the old. In the recorded
judgments the candidate is plainer almost everywhere and, on about one line in twenty, a little less
exact; the broken shuffle means neither rate is a blind comparison yet. That is the thing Greg's own
guard — augment, not replace — is about, and it is what the next person to touch these prompts
should look at first.

The recorded judgments call 13 of 14 matched depth-1 questions plainer with the QUESTIONS block
byte-for-byte unchanged, through its "exactly as with gists" line. The broken side shuffle means
that result cannot waive the stage-1b gate until the pairs are judged again.

### The valid blind read, and stage 1b

With the shuffle fixed (`blindCoin`, 32-bit, tested), three reads, all by a fresh Fable from the
pairs file alone. Files: `pairs-<a>-vs-<b>.{md,key.tsv,judged.txt}`.

| read | pairs | new plainer | old plainer | same | fidelity flags: new / old |
|---|---:|---:|---:|---:|---:|
| **control**: `before` vs `before-2` (old prompt, twice) | 113 | — | 55 / 46 | 12 | 2 on one side |
| `before` vs `after-7` (round-2 glossary fixes; QUESTIONS by reference) | 89 | 66 | 18 | 5 | 3 / 1 |
| **`before` vs `after-8` (what ships)** | 91 | **70** | **13** | 8 | **4 / 3** |

**The control is what makes the other two mean something**: the same prompt against itself splits
55–46, so the judge is not picking a side and not preferring a run; 70–13 is not noise.

**Stage 1b fired.** In `after-7` the depth-1 questions split 6–5 — the "exactly as with gists"
cross-reference had not carried the rule to the line the Summary panel draws by default. The last
QUESTIONS bullet (in `SYSTEM` and `EXPAND_SYSTEM`) now says it outright: *the topic keeps the
article's own term as the handhold; the question after it is in ordinary words and must make sense
to a reader who does not know that term yet. No other term of art.* In `after-8` they split
**10–1** (3 same). The block is otherwise still V4; the tests now assert *V4 with that bullet
replaced*, and V4 itself stays in `variants.md` as what the Socratic eval measured.

`after-8`, by field:

| field | shipped plainer | old plainer | same |
|---|---:|---:|---:|
| root gist | 2 | 0 | 1 |
| depth-1 gist | 13 | 1 | 0 |
| deeper gist | 18 | 6 | 1 |
| root question | 3 | 0 | 0 |
| depth-1 question | 10 | 1 | 3 |
| `senseHere` | 24 | 4 | 2 |
| `background` | 0 | 1 | 1 |

**Fidelity is even**: 4 flags against the shipped lines (a root gist that says *"cannot"* where the
essay says *likely*; a depth-1 gist that drops the linear-against-exponential reason; one that
narrates *"essay examines"*; one entry that never says what the thing is) and 3 against the old.
The judge's pattern note is the useful part: the plainer line is the one that names concrete things
instead of field terms, and the fidelity flags cluster on lines that narrate the page — which both
prompts already ban, and which the old prompt did as often.

**Provenance is at parity, not better.** `after-8` has 15 entries with `background` and no fused
names, but ordinary definitions still land in `senseHere` on the essay (*Müller-Lyer illusion*,
*Turing machine*, *Watt governor*) — as they did under the old prompt. The regression `after-4` had
is gone; the older habit is not, and it is named under § Deferred.

### The cost, named

**Longer lines, and the word ceilings are broken more often.** Across the three articles:

| | root gists over 18 | depth-1 over 25 | deeper over 32 |
|---|---:|---:|---:|
| before | 2/3 | 1/23 | 0/71 |
| before-2 | 2/3 | 1/22 | 0/58 |
| v3 | 2/3 | 6/21 | 8/53 |
| v4 (`after-4`) | 2/3 | 4/21 | 1/52 |
| `after-6` | 1/3 | 6/21 | 0/55 |
| `after-7` | 1/3 | 6/21 | 9/60 |
| **shipped (`after-8`)** | 2/3 | 8/23 | 4/53 |

The gist prompt is the same from v3 to `after-7`, so those rows are one prompt sampled
five times: the deeper overruns come and go, and **depth 1 is the one that stays** (4–6 of 21
against 1). The overruns are small (26–29 words against 25) and the root was over already.
The judge also said the plainer side is *"systematically longer and more explanatory"*, so part of
the 81 may be a preference for length. Two things were tried against it — "the limit wins" and
"at most one term of art" at the root and depth 1 — and the overruns fell from v1's but did not go
away. I stopped there rather than trade plainness back for length on a third round; the ceilings
are Greg's from 2026-09-06, and if a line of 28 words is worse to him than a jargon-dense line of
24, it is a one-line tightening.

**The glossary's 20-word first-sentence ceiling was missed more severely, and the original report
did not count it.** Round-2 review added that count to `run.ts`; in `after-6`, 37 of 40 `senseHere`
first sentences and all 10 `background` first sentences exceed 20 words. The worked GOOD example
itself was 23 words and did not establish that its driver comparison came from the article; the
review shortened it and made that provenance explicit, red-first in
`tests/plain-words-metric.test.ts`. Both `after-7` and `after-8` include that correction.

**The glossary's 20-word first sentence is still mostly ignored after the fix**: 33 of 39
`senseHere` and 13 of 15 `background` in `after-8`. The hard words in those sentences fell anyway
(2.9 types against 4.9), so the rule is doing its work through the "no hard word" half, not the
length half. Not tightened further: a sixth round would be tuning to three articles.

**One sample per arm**, read against the `before`/`before-2` control. Spend: eleven runs (ten arms,
plus a first `before` thrown away when the script gained ranges) of three articles, one structure
call and one glossary call each — 66 calls, roughly five or six dollars estimated from
[Q7](../project/open-questions.md#q7)'s cost per block, not read from the ledger.

The eight older arms record `tocVersion` and `glossaryVersion`, but all successive after arms used
the same `toc/8` and `glossary/5` labels while their prompt text changed. Their exact intermediate
prompt bytes therefore cannot be reconstructed from the JSON alone. Round-2 review added source-file
SHA-256 hashes to every new arm; `after-7` and `after-8` carry them, and `after-8`'s match the source
files that ship.

## GPT Sol on the code, rounds 1 and 2

**Round 1 (`eb6717ad`) said do not ship**, and was right: the blind read's side shuffle was broken
(C1), the glossary's 20-word first sentence was ignored and not counted (C2), outside knowledge still
landed in `senseHere` (C3), the plan overstated the restored people and waved away fused names (C4),
depth-1 overruns were recurrent (C5), intermediate arms were not reproducible (C6), and
`prompt-caching.md` was stale (C7). It fixed C1, C2, C3's prompt half, C6 and C7 itself; those fixes
were read and kept. C1 is why § The valid blind read exists; C4 and C5 are in the plan as costs.

**Round 2 (`8ef53055`), narrow, said ship after its fixes**: no P0 or P1. D1 — `EXPAND_SYSTEM`'s new
QUESTIONS bullet was not pinned by any test (now it is); D2 — the plan and `glossary.md` still said
the example fixes awaited a rerun, and miscounted the unhashed arms. It recomputed every `after-8`
and control table from the key and judged files and found them exact. Discovery closed there.

## Stage 2 — Greg's answers to the two open questions (2026-09-28)

Relayed by the Overseer, from Greg, on the two decisions this plan left open:

> a. Yes: give chat, Explain and the glossary's "Check the web" answer the same plain-words rule.
> Keep each prompt change as small as you can, and measure before/after the way you did for
> summaries.
> b. Plain beats short: keep the plainer depth-1 line and raise the word limit a little (the
> smallest raise that fits the plain version, about 30), rather than squeezing it back under 25.
> Update anything that enforces or tests the 25.
>
> — Greg, 2026-09-28, via the Overseer

### a. Chat, Explain and *Check the web*

**Two prompts, not three.** *Check the web* is `explainStream` on the term's own words
([`src/term-lookup.ts`](../../src/term-lookup.ts)), so it and Explain are one `SYSTEM` in
[`src/explain.ts`](../../src/explain.ts). Chat is `SYSTEM` in [`src/converse.ts`](../../src/converse.ts).
`REMEMBER_SYSTEM` in the same file carries the same old wording and is **not** changed: Greg named
three surfaces, and Remember is a fourth.

**The change is one bullet in each**, the one that already carries the 2026-09-03 rule — Explain's
*"Keep the author's own distinctive vocabulary … Ordinary words for everything else"* and chat's
*"Keeps the author's own distinctive vocabulary …"*. Each becomes the stage-1 rule in that prompt's
voice:

> Keep the author's own distinctive words — the reader meets them again on the page — but a
> handhold is not an explanation: if a reader from outside the field would not know a term, say
> what it means as you use it, in ordinary words. Never explain one hard word with another.
> Plainer means equally specific, never vaguer: plainer than the article, never further from it.

Nothing else in either prompt moves. Neither has a version stamp or an `outdated` flag (answers are
generated on request; stored *Check the web* answers keep the text they were written with, and a
reader who asks again gets the new one), and no test pins either prompt's text. Both are cached
system prompts, so the first call after the deploy pays one cache write.

**Why not also the worked example or the self-check** that the glossary needed: those were added
because the glossary rule alone did not land, which the eval showed. The same eval decides here —
the smallest change first, and more only if the numbers say it did nothing.

**The eval**: [`evals/plain-words/answers.ts`](../../evals/plain-words/answers.ts), the same design
as `run.ts` — production's own calls (`explainStream`; `converse` with `kind: "chat"` and tools on),
fixed cases, arms separated in time, a `before-2` control, and blind shuffled pairs judged by a
fresh Fable. Per article, two terms the old glossary defined with other hard words, each asked about
three ways: Explain on the bare term (the *Check the web* shape), Explain on the sentence around it,
and a chat question naming it — 18 answers an arm. Web search stays on, because it is part of what
an answer is; the control is what separates its variance from the prompt's effect. Cost: about 18
calls with the whole article as a cached prefix, a few cents each — under two dollars an arm.

### b. Depth-1 gists: 25 → 30 words

The plain depth-1 lines in `after-7` and `after-8` ran to 31 and 34 words with a limit of 25; the old
prompt's ran to 26 and 27. **30** is Greg's number and fits all but the tail. `SYSTEM`'s
*"depth 1: AT MOST 25 words"* becomes 30; the root (18) and the deeper band (22–32) are unchanged,
so the ordering Greg asked for on 2026-09-06 — coarser lines shorter — still holds (18 < 30 ≤ 32).

What enforces or tests the 25: only the prompt itself, the byte pin in
`tests/hierarchy-structure-request-parity.test.ts` (and the key in `tests/hierarchy-prompt-hoist.test.ts`
that hashes it), and `LIMIT["d1 gist"]` in `evals/plain-words/run.ts`. **No code enforces a gist
length.** `evals/summaries/variants.md` and `arms.ts` keep 25, because they describe blocks that
shipped at `toc/6` and `toc/7`.

**No version bump.** `toc/8` is on `dev` and not on `main` (checked 2026-09-28), so no reader has a
tree built under the 25; this is still `toc/8` before it ships, as stage 1b was.

The risk is the one the limit was there for: a ceiling of 30 may pull every depth-1 line up towards
30 rather than just letting the plain ones through. `after-9` measures it — the depth-1 length
distribution against `after-8`'s, and the blind read against `before`.

### Stages

| | what | ends when |
|---|---|---|
| 2.0 | this section; `before` and `before-2` answer arms on the current prompts | Sol's plan review answered |
| 2a | the two bullets; the `after` answer arm; blind reads (`before` vs `after`, `before` vs `before-2`) | the read says plainer, fidelity even, or the plan says why not |
| 2b | 25 → 30, the pins, `after-9` summaries arm and its read | depth-1 lengths and the read recorded |
| 2c | Sol code review, gates, the report-44 note, its row out of `awaiting-approval.md`, push | on `dev`, worktree removed |

### GPT Sol on the stage-2 plan (2026-09-28)

No P0; two P1s, all seven accepted. **E1** — chat's "?" help addendum carried the old exemption as a
later, user-level instruction, which would likely have beaten the new `SYSTEM` bullet; it now says
the new rule, and `tests/help-prompt.test.ts` asserts it (red on the old line, green on the new).
**E2** — `answers.ts` could silently pair mismatched or incomplete arms; it now refuses an arm that
is not exactly 18 distinct cases, records a digest of the article's blocks, and throws on a missing
partner or a changed question. **E3** — "assume a reader from outside the field" contradicted the
reader-profile rules for a reader who says they are expert; the bullet now reads *if this reader
would not know a term … when no background is given, assume a curious reader from outside the
field*, and the glossary's WHO READS AN ENTRY got the same carve-out. **E4** — the `term` arm applies
*Check the web*'s accepted endings; the quote matcher differs from `anchorIn` and says so. **E5** —
citation ids and link targets are stripped before scoring, and searches are reported (nearly zero
in every arm: this eval says nothing about answers built from web results). **E6** — `18 < 30 ≤ 32`
proved nothing about ordering; measured below instead. **E7** — § Deferred rewritten.

### What stage 2 found

**b. Depth-1 at 30 words — as hoped.** The ceiling did not pull lines up to it:

| | depth-1 median | max | over 30 | over 25 | depth-1 shorter than its children's mean |
|---|---:|---:|---:|---:|---:|
| before | 21 | 26 | 0 | 1/23 | 17/23 |
| before-2 | 21 | 27 | 0 | 2/22 | 11/20 |
| `after-8` (limit 25) | 24 | 34 | 3 | 9/23 | 12/19 |
| **`after-9` (limit 30)** | **24** | 33 | **1** | 6/22 | 13/22 |

The ordering Greg asked for on 2026-09-06 is inside the old prompt's own wobble. The blind read of
`after-9` against `before` (87 pairs, shuffled): **67 plainer, 16 old, 4 same** — `after-8` was
70–13 — with depth-1 questions 10–0 and `senseHere` 31–3, and fidelity flags 2 against the old
lines and 1 against the new.

**a. Chat, Explain, *Check the web* — the one-bullet change did not show a reliable effect.**

| read (18 answers, shuffled) | new plainer | old plainer | same | fidelity flags new / old |
|---|---:|---:|---:|---:|
| control: `before` vs `before-2` | — | 6 / 9 | 3 | 6 across both |
| `before` vs `after` | 13 | 5 | 0 | 2 / 4 |
| `before-2` vs `after-2` (a second, independent sample of each) | 9 | 9 | 0 | 4 / 3 |

Pooled, 22–14 for the new wording against a 6–9 control, and the hard-word screen moved a little
(7.5–8.2 hard types per 100 words against 8.2–9.3). That is not the 67–16 the summaries show, and
it is not honest to call it an effect. Both judges gave the same reason for which answer won: *the
one that opens with the meaning in everyday words, before the formal wording or the quotation.*

### Greg widened (a), mid-stage, the same day

> 4a Yes, we want to make this plainer/simpler language rule common across *all* prompts that
> generate text of any kind. And ideally also in a way that it will apply to all future prompts
> (e.g. maybe we need a prompting-guide.md signposted from AGENTS.md). P.S. I do think this is a
> subtle goal, because a) on the one hand we really want to use simple language; b) on the other,
> we'd like to stay true to the wording of the paper. I think perhaps (a) is more important
> (especially for summaries, explanations), though perhaps (b) plays more of a rule in headings? Not
> sure. Use your judgment.
>
> — Greg, 2026-09-28, via the Overseer

So the chat/Explain bullet lands now as it is — measured, harmless, and the E1 fix is a real one —
and **stage 3** replaces the per-prompt copies with one shared rule, planned below.

## Stage 3 — one plain-words rule for every prompt that writes

Greg's widened (a) is quoted above (§ Greg widened (a)). The Overseer's brief, from him: every
prompt that generates text, one shared rule rather than N copies, so that a new prompt gets it by
default; the trade-off between plain words and the paper's own wording judged per kind of output
and written down here; `docs/project/prompting-guide.md` for future prompts; measured per kind.
And, the same day: *"Stop using Fable. Let's just rely on Opus 5.5 for anything advanced in the
Claude family."* The second opinions below are Opus.

### The inventory: 32 prompts

Every model call in `src/` that writes text, by the kind of words it writes. The kind decides how
the rule applies.

| kind | prompts (`src/…`) | what the rule does |
|---|---|---|
| **explains** — answers, summaries, definitions, reasons, feedback, captions | chat `SYSTEM` and `REMEMBER_SYSTEM` and the "?" addendum (`converse.ts`); Explain and *Check the web* (`explain.ts`, `DEEP` inherits); summary gists (`hierarchy.ts`, `hierarchy-expand.ts`); glossary `senseHere`/`background`; `arc.ts`; `tweets.ts`; `ideas.ts`; quotes' `reason`; `quiz-mark.ts`; `debate.ts` (`applies`, `limits`); citations' `why`; `link-summary.ts`; `illustrated.ts` `depicts`; `search.ts` `reasoning`; `live.ts` (spoken) | **plain wins** — meaning first in everyday words; the article's term kept as a handhold and explained where it first appears |
| **asks** — questions | `quiz.ts`, `faq.ts`, summary questions (`hierarchy.ts`, `hierarchy-expand.ts`) | **plain wins**, the topic keeping the article's term (as stage 1b) |
| **names** — labels, headings, titles the model writes | sidebar labels (`labels.ts`); table-of-contents titles (`hierarchy.ts`, `hierarchy-expand.ts`); sketch node labels and captions (`sketch.ts`); timeline `label` | **the author's term wins** — a short phrase: the author's key term, ordinary words around it; a landmark, not a sentence |
| **copies** — verbatim | quotes' `text`; glossary `name`; headings the TOC copies unchanged; `pdf-read.ts` transcription | **untouched** — a copy stays a copy |
| **for a specialist** | the four referee prompts (`referee-candidates-prompt.ts`, `referee-mirror.ts`, `referee-criteria-run.ts`, `referee-claims-run.ts`) | the rule applies, with the reader named: a peer reviewer in the paper's field needs no field term explained; plain words for everything else |
| **machine-only** | `quiz-verdict.ts` (one word), `citation-find.ts` (a URL), `pdf-frontmatter.ts` (ids), `pdf-read.ts` (verbatim transcription) — and `transcribe.ts`, which has no prompt | **exempt**, with the reason written beside it |

Two had no plain-words wording of any vintage: `illustrated.ts` and `link-summary.ts`. Seventeen
carry the 2026-09-03 wording; five carry stage 1–2's.

### The trade-off, decided

Greg: *"(a) is more important (especially for summaries, explanations), though perhaps (b) plays
more of a rule in headings? Not sure. Use your judgment."*

**Plain wins wherever the words explain or ask.** That is what the reader reads *instead of* the
prose for a moment, and the evidence is on it: 67–16 and 70–13 blind for gists, questions and
definitions, with fidelity even. What the paper's wording is for — the reader meeting the term again
in the text — is kept by the handhold: the term stays, and is explained where it first appears.

**The author's term wins in a label, heading or title — but it is not a licence for jargon.** A label
is a landmark the reader matches against the prose, it has no room for an explanation, and at the
coarse zoom levels a column of them is a summary in its own right. So: the author's *key* term, with
ordinary words around it, as a short phrase; never the author's term replaced with ours, and never a
pile of field nouns (*"Transfer-entropy estimator bias correction"*). Opus's point, and a better one
than my draft's "no room to explain": a label the *model* writes may carry a plain word beside the
term; only a heading the author wrote is copied untouched.

**Copies are never touched**, and the verbatim and machine-only prompts do not carry the rule at
all: a transcriber told to prefer common words is a transcriber invited to tidy (Opus).

**Who the reader is.** The default is a curious reader who has not studied the field. **A reader
the prompt names, or a reader's own profile, overrides it** — the referee prompts, and anyone who
says in their profile that they know the field. Named explicitly, because "unless you are told who
the reader is" collided with `PROFILE_RULES` (Opus).

### One fragment, and what goes in it

`PLAIN_WORDS` in a new `src/plain-words.ts`, interpolated as its own section into each prompt the
way `PROFILE_RULES` (`src/profile.ts`) already is — the one cross-file prompt fragment the codebase
has, and the model for this. **One** fragment rather than one per kind: a single prompt often writes
several kinds (the summary prompt writes titles, gists and questions), and per-kind fragments would
drift.

The general rule first, then how it applies per kind — then the two things the evidence says a
bare rule lacks: **one worked BAD/GOOD pair** (an explanatory sentence, on a subject none of the eval
articles touch) and **a one-line self-check**. The glossary moved only once it had both; chat and
Explain, with a bullet alone, did not move reliably. About 350 tokens, inside cached system prompts.

The wording to build from (reviewed by Opus: *"lead with what it means here"* rather than *"the
everyday sense"*, which reads as the word's ordinary meaning and is the glossary's open bug; hedges
added to what plainer must keep; the anchor phrase kept, because three tests and `new-mode.md`'s
grep use it, and defined rather than left as a slogan):

```
PLAIN WORDS

Use the commonest word that loses nothing. What changes is the words, never the
meaning: plainer means equally specific. Never drop a number, a direction, a
comparison, a condition or a hedge ("may", "in mice", "in this sample") that
the claim depends on. A sentence that is plainer and less exact is worse.

Write for a curious reader who has not studied this field. If these
instructions, or the reader's own description, say who the reader is, write
for them instead: a specialist does not need their own field's terms explained.

How it applies to what you write:
- Anything that explains or asks — an answer, a summary, a definition, a
  reason, feedback, a caption, a question: say what it means here, in everyday
  words, first. Keep the article's own term where the reader will meet it again
  in the prose; it is their handhold. But a handhold is not an explanation: if
  this reader would not know the term, say what it means where it first
  appears. Never explain one hard word with another. A word is not plain
  because the article uses it.
- A label, heading or title you write: a short phrase with the author's key
  term and ordinary words around it. It is a landmark the reader matches to the
  text, so never replace the author's term with your own.
- Anything you copy — a quotation, a name, a heading you were told to keep —
  stays exactly as written.

For example, explaining a line in a medical paper:
BAD: "The trial was underpowered, so its null result is uninformative."
GOOD: "The trial was too small to reliably catch an effect of the size it was
looking for (it was 'underpowered'), so finding no effect tells us little
either way."

Before you finish, find each word this reader might not know. Either it is the
article's term and you have said what it means where it first appears, or
change it.

Plainer than the article, never further from it: never less exact, and never
beyond what it says.
```

**In each prompt:** the prompt's own plain-words bullet (the 2026-09-03 wording, or stage 2's in
chat and Explain) is **removed** and `${PLAIN_WORDS}` goes in as its own section near the end, so
there is one rule and not two. **The two measured blocks keep their measured text** — the summary
GISTS rules (the lengths, one term of art at the root and depth 1, the twin-study example) and the
glossary WRITING section (the 20-word first sentence, the field-matched worked pairs, the
self-check) — and gain the fragment; only a sentence that would contradict it is aligned (Opus).
Live gets one line of its own on top: short spoken sentences, no brackets, never read notation
aloud.

### The default for future prompts

Two things, because a guide alone is advice:

- **A test** (`tests/plain-words-coverage.test.ts`, in the manner of `doc-links`): it finds every
  prompt constant in `src/` — every `const …SYSTEM` template, plus the few prompts named otherwise,
  listed — and fails unless the prompt interpolates `PLAIN_WORDS` or is on the exemption list in
  `src/plain-words.ts` with its reason beside it. A new prompt is red until someone decides. It has
  to be seen red: a prompt constant added without the fragment.
- **`docs/project/prompting-guide.md`**: the rule and the trade-off above, where the fragment lives
  and how to use or exempt it, the naming convention the test relies on, and how to measure a prompt
  change the way this plan did (production's own calls, a same-prompt control, shuffled blind pairs,
  a fidelity question beside the plainness one, a check that the shuffle is balanced). Owner:
  [architecture.md](../project/architecture.md), which already owns `ai-gateway.md` and
  `prompt-caching.md`. **The pointer in AGENTS.md is a rule edit**: its exact before and after go to
  the Overseer for Greg's yes before it is committed.

### Versions, and what readers see

Every prompt with a version stamp whose text changes gets a bump. `toc/8`, `expand/5` and
`glossary/5` are not on `main`, so they absorb this unbumped, as stage 2 did. The rest move: `arc`,
`tweets`, `labels`, `ideas`, `quotes`, `sketch`, `timeline`, `illustrated`, `quiz`, `faq`,
`debate`, `citations`, `link-summary`.

**This is the visible part, named rather than discovered:** ten of those have an `outdated` banner
(`src/store/pg.ts`), so after the deploy **every owner's existing arc, ideas, quotes, sketch,
timeline, illustrated, quiz, FAQ, debate and citations artefacts say they were written by a
different version**, with the mode's own regenerate button — the migration each mode was built
with, and what the glossary did in stage 1. Each banner's copy is checked for a reason that is only
true of one old bump (the glossary's was). Labels, tweets, link summaries and the tree regenerate
when next asked for or when their stage next runs; chat, Explain, search, quiz-mark, live and the
referee prompts have no stored artefact.

### Measuring it, per kind

| kind | harness | arms | cost |
|---|---|---|---|
| gists, questions, definitions | `run.ts` (stage 1) | `after-10` vs `before`, blind | ~$1.5 |
| answers: chat, Explain, *Check the web* | `answers.ts` (stage 2) | two new samples vs `before`/`before-2`, blind | ~$2 |
| the rest: arc, tweets, ideas, quotes' reasons, citations' why, illustrated, quiz, FAQ, labels, sketch, timeline, quiz-mark, search | a new `artefacts.ts`: each production generator on **one** article, before and after, prose fields extracted, blind pairs judged for plainness **and**, for labels, whether the author's key term survived | before on the current commit, after once built | ~$2–3 |

About **$6** in all, each run well under a few dollars. **Not measured**, with the reason: `live` (a
realtime voice session — no headless generator), `debate` (a web search per claim; its text gets the
same shared fragment and its fields are checked by reading), the four referee prompts (a specialist
reader, for whom the rule changes little; one output each, read). An Opus subagent judges, blind,
as before.

### Stages

| | what | ends when |
|---|---|---|
| 3.0 | this section; Opus's view; GPT Sol plan review | review answered |
| 3a | `artefacts.ts`, and its `before` arm on the current prompts | the arm written, before any prompt changes |
| 3b | `src/plain-words.ts`, wired into every prompt, old bullets out, the coverage test (seen red), version bumps, banner copy; the three `after` arms and blind reads | plainer by kind, fidelity even, or the plan says why not |
| 3c | `prompting-guide.md`, `new-mode.md`, the AGENTS.md pointer (after the Overseer's yes), the report-44 note | docs link-checked |
| 3d | GPT Sol code review, gates, push, worktree removed | on `dev`, green |

### GPT Sol on the stage-3 plan, and what changed (2026-09-28)

*Build with changes*; no P0, six P1s. **This section supersedes the fragment wording, the test
design and the version and banner claims above**, which are kept as what was proposed.

- **H2 — one long fragment contradicted prompts it was added to** (a question told to explain its
  own term, a label told to be a phrase where `labels.ts` wants a 6–20-word claim, a transcription-
  style self-check over copied fields, an example with the bracketed aside the summary prompt
  forbids). **Changed:** one source, `plainWords(...kinds)` in
  [`src/plain-words.ts`](../../src/plain-words.ts) — a short core in every call (who the reader is;
  commoner words for the same meaning; nothing lost; *"it never changes which field a fact belongs
  in, which source may support it, or the shape and length set above for each field: where those
  rules are more specific, they win"*; copies untouched) plus only the kinds a prompt names:
  `explain` (meaning first, handhold, the worked pair, the self-check), `ask`, `landmark`, `spoken`.
  The example has no brackets.
- **H3 — the glossary's provenance.** The core's field-ownership sentence is the invariant Sol
  asked for, and the summary and glossary prompts take the **core alone**: their own measured
  sections already carry the per-kind detail and field-matched examples.
- **H4 — a naming-based test cannot prove coverage.** **Partly taken.** The test parses the source
  and finds calls to the wire functions that make them (`streamMessage`, `openRouterJson`,
  `openRouterStream`, …), rather than matching constant names or stripping comments with a regex;
  a file that calls a model must carry
  `plainWords(` in code or be in `PLAIN_WORDS_EXEMPT` with a reason; prompt files whose call is made
  elsewhere (`hierarchy-expand.ts`, `live.ts`, `referee-candidates-prompt.ts`, the changelog) are
  listed. Seen red before any prompt was wired: 33 files. **Not taken: Sol's typed `plainWords`
  policy on every outgoing request.** It is the stronger guarantee — it would check the prompt
  actually sent — and it means changing every wire function's signature and all 30-odd call
  sites. The test says in its header what it cannot see, and the typed policy is named in
  § Deferred as the next step.
- **H5 — `toc/8`, `expand/5` and `glossary/5` are on `main`.** True — stage 1 was deployed. So
  stage 2's 30-word change needs **`toc/9`**, its glossary profile carve-out **`glossary/6`**, and
  stage 3 moves `expand` to **`expand/6`**. Checked against `origin/main` again before the commit.
- **H6 — only seven modes show the `outdated` banner.** Ideas, quotes, timeline, quiz, FAQ,
  debate and citations do, with copy generic enough for this bump; **arc, sketch and illustrated
  store the flag and never show it**, so their old artefacts stay on screen unmarked until
  regenerated. Left that way deliberately: sketch and illustrated redraws cost about $0.20 and
  $0.40–0.60, and inviting every owner to redo them for a wording change is not worth it. Search
  runs and referee criteria and claims **are** stored, with no prompt version: old saved runs keep
  their words.
- **H7 — no mass rerun.** A bump marks or invalidates; nothing regenerates until a stage runs or a
  reader asks.
- **H1 — missed prompts.** The public changelog's copy prompt (`scripts/changelog/`) gets the rule;
  `scripts/gjd-remote-envpolicy.ts` is an internal tool's reason for Greg and is exempt with that
  reason. Field-level kinds: each prompt names every kind it writes (sketch writes `explain` and
  `landmark`; FAQ, quiz and summary questions `ask`).
- **H8 — one article per generator is a smoke test.** Agreed, and it is called that. Added: a
  `before-2` same-prompt control for the artefact generators, link summaries, Remember, the "?"
  help turn and one referee-claims run. Still not run: `live` (no headless session; the `spoken`
  kind is checked by reading), debate (a web search per claim), `EXPAND_SYSTEM` (only runs on a
  long article's deepening). Spend: $4–8 across all stage-3 runs, each well under a few dollars.

### What stage 3 built (2026-09-28)

- **`src/plain-words.ts`**: `plainWords(...kinds)` and `PLAIN_WORDS_EXEMPT`. The core says the
  prompt's own field rules win where *"these instructions set"* them (not *"set above"*: in several
  prompts the rule sits before a closing output section, and some field rules come after it).
- **Wired into 29 prompts in 27 files**, each prompt's own old plain-words sentence removed and
  quoted in the wiring reports: summary, expansion and glossary take the core alone
  (`plainWords()`, measured sections kept); arc, tweets, ideas, quotes, citations, illustrated,
  debate (both prompts), Explain, chat, Remember, quiz-mark, search, link summaries, the four
  referee prompts and the public changelog's copy take `"explain"`; sketch `"explain"` +
  `"landmark"`; quiz `"ask"` + `"explain"` (it writes reference answers too); FAQ `"ask"`; labels,
  timeline `"landmark"` and trajectory `"ask"` (timeline's only written field is a short
  label — a departure from the inventory's first placement of timeline, taken because `"explain"`
  would tell a ten-word label to explain its terms; trajectory was `"landmark"` for its old "role"
  label until the merge of `dev` brought the trajectory mode's "cue", a question or instruction to
  the reader, so `"ask"` and `trajectory/6`); live `"explain"` + `"spoken"`. The changelog's
  copy prompt is a Markdown file a subagent reads, so the rule is written beside the inputs as
  `copy-plain-words.md` and `copy-brief.md` tells the subagent to read it.
- **Exempt, with reasons in the file**: the quiz verdict, the citation URL finder, PDF front matter,
  PDF figure location (merged in from `dev` the same day), PDF transcription, dictation, embeddings,
  the two wires, the pipeline's factory call, the expansion call site, a string that names a call,
  two spikes and the environment-policy tool.
- **Tests**: `tests/plain-words-coverage.test.ts` (red on 33 files before wiring, green after);
  `tests/plain-words-wiring.test.ts` checks eleven of the interactive prompts' sent text carries the
  rule exactly once and the old sentence is gone; the phrase assertions in the FAQ, citations and
  debate tests now assert the prompt contains `plainWords(...)`'s output; the byte pin and key moved
  to `toc/9`.
- **Versions**: `toc/9`, `expand/6`, `glossary/6`, `arc/4`, `tweets/4`, `ideas/3`, `quotes/7`,
  `sketch/3`, `timeline/3`, `illustrated/4`, `quiz/4`, `faq/3`, `citations/3`, `debate/2`,
  `labels/3`, `trajectory/5`, link summaries `4`.
- **Docs**: [prompting-guide.md](../project/prompting-guide.md) (the substance), and one-sentence
  pointers in AGENTS.md (Greg: *"pull most of that out into its own .md file, and signpost from
  AGENTS.md (and other relevant docs) with a single sentence to it. Then consider this approved."*),
  `architecture.md`, `ai-gateway.md` and `new-mode.md`, whose rule section is now that sentence.

**The `after` arms waited on credit.** The OpenRouter key hit its $100 cap mid-way through the
artefacts `before-2` arm (a 402 *no credit*); Greg raised it the same morning, and the arms below
ran on the committed-to-be prompts. `before-2` has no quotes, illustrated or referee-claims (they
failed on the cap, and cannot be re-run on the old prompts now). **All reads from here are by a
blind Opus judge** — Fable was retired mid-stage — so each has its own Opus control, and the
stage-1/2 Fable reads are not mixed in.

| what | read | new plainer | old plainer | same | fidelity flags new / old |
|---|---|---:|---:|---:|---:|
| **answers** (chat, Explain, *Check the web*) | control, `before` vs `before-2` | — | 8 / 10 | 0 | 3 / 3 |
| | `before` vs `after-3` | **12** | 6 | 0 | 1 / 5 |
| | `before-2` vs `after-4` | **13** | 5 | 0 | 0 / 3 |
| **artefacts** (15 generators, one essay) | control, `before` vs `before-2` | — | 51 / 48 | 93 | 5 / 7 |
| | `before` vs `after` | **77** | 45 | 116 | 12 / 9 |
| **summaries + glossary** (3 articles) | `before` vs `after-10` | **76** | 14 | 5 | 4 / 1 |

**Answers moved this time.** The stage-2 bullet alone gave 13–5 then 9–9; the shared rule, with
its example and self-check, gives 12–6 and 13–5 against an 8–10 control, fidelity no worse. By
kind, pooled: *Check the web* 9–3, Explain on a sentence 8–4, chat 8–4.

**Artefacts moved where they explain, and stayed put where the author's words should win.** Ideas
14–1, tweets 8–0, citations 5–2, FAQ 3–0, search 4–1; labels 5–6 and timeline 1–0 with most pairs
the same, which is the landmark rule doing what it says; illustrated 8–9 and quiz 8–6 roughly even;
**quote reasons 4–7, the one generator that went the other way**. The hard-word screen agrees (tweets
18.5 → 9.6 hard types per 100 words, sketch 21.3 → 13.2, FAQ 11.2 → 5.8, labels unchanged). **The
cost**: 12 fidelity flags against the new lines to 9 against the old (the control: 5 and 7), mostly
small inventions in picture descriptions and labels (*"Nagel recognisable by his scroll"*,
*"decades before others"*), and items got longer (tweets 30 → 41 words, sketch nodes 7 → 11).

**Summaries and glossary kept their gain with the core added**: 76–14, against stage 1b's 67–16
from `before` without it.

**Two things this read could not settle, checked separately:**

- **The glossary's people come and go.** `after-9` and `after-10` gave the essay no person entry
  at all, against six from the old prompt. Two more runs of the current prompt
  (`evals/plain-words/glossary-people.ts`) gave one person and five. It is sampling, not the rule —
  and that run with one person had also moved *Müller-Lyer illusion*, *pareidolia* and *Watt
  governor* under `background`, which is where ordinary meanings belong.
- **Deep gists overran their 32-word ceiling** in `after-10`: 14 of 65, against 0–3 in every
  earlier arm. `after-11`, the same prompt again: **1 of 73**, median 27 words as in `after-9`. It
  was sampling, and the core stays in the summary prompt. The lesson is the one the control arms
  exist for: a single arm's outlier looks exactly like a regression.

**Referee claims failed on both attempts on the essay** with production errors (*the answer was
longer than there was room for*, then *ran out of room before it wrote anything*), under the old
prompt, before any change here — worth a look on its own: an 8,000-word essay may be past what
`runClaims` can answer.

And **G1–G3** from Sol's stage-2 code review: `answers.ts` now checks the exact set of 18 cases, not
any 18 (red first, `tests/plain-words-answers.test.ts`); `awaiting-approval.md` shows its "nothing
resting" line again; and the depth-1 table in § What stage 2 found counts words by whitespace — by
`run.ts`'s `wordsIn`, which counts a hyphenated compound once, before's ordering is 16/23,
before-2's over-25 is 1/22 and `after-8`'s is 8/23, and the conclusion does not move.

## The simpler option passed over

**Just strengthen the existing sentence** — "plainer than the article" → "much plainer" — in place.
It is one word and no new structure, and it would do nothing about the cause: the exemption for named
things stays, and the named things are the jargon.

## Deferred, named

- **A typed plain-words policy on every model request** (GPT Sol, stage-3 plan review H4): every
  wire function takes a required `plainWords: { kind } | { exempt, reason }`, and a test checks the
  prompt actually sent. Stronger than the file-level scan that shipped; a signature change across
  every call site.
- **Outdated banners for arc, sketch and illustrated**, which store the flag and never show it.
- **Ordinary definitions labelled as the article's.** The glossary puts what a term ordinarily means
  in `senseHere` (article-only) as often under the new prompt as the old; a worked example against
  it went in during round 2 and did not visibly move it. Worth a change of its own, with a screen
  that checks the label rather than counting fields.
- **Backfilling trees.** New articles only, per Greg twice.
- **Stored *Check the web* answers** keep the text they were written with. They survive a glossary
  rewrite by term id, so a newly plain entry can open onto an older, denser checked answer until the
  reader asks again.

*Answered by Greg on 2026-09-28, and so no longer here: the depth-1 limit (30 — § Stage 2) and the
other prompts (all of them — § Stage 3).*
