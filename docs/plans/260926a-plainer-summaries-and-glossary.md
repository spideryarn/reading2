# Plainer summaries and glossary: a name is a handhold, not an explanation

From SPIDERYARN-READING2-44, a suggestion from Greg, overseer queue entry `qi-qpsx92kg`.

**Status:** shipped to `dev` — stages 1 and 1b, two rounds of GPT Sol code review, the second
ending *"ship after my fixes"*. Written before the work, per
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

## The simpler option passed over

**Just strengthen the existing sentence** — "plainer than the article" → "much plainer" — in place.
It is one word and no new structure, and it would do nothing about the cause: the exemption for named
things stays, and the named things are the jargon.

## Deferred, named

- **Ordinary definitions labelled as the article's.** The glossary puts what a term ordinarily means
  in `senseHere` (article-only) as often under the new prompt as the old; a worked example against
  it went in during round 2 and did not visibly move it. Worth a change of its own, with a screen
  that checks the label rather than counting fields.
- **Depth-1 gists run past 25 words** in about a third of cases against one in twenty before. Greg's
  call whether 28 plain words beat 24 dense ones.

- **The other eleven prompts** carrying the 2026-09-03 rule (converse, quiz, quiz-mark, arc, labels,
  ideas, sketch, explain, live, quotes' `reason`, timeline's `label`). Greg named summaries and the
  glossary; the same split probably belongs in chat and explain next, and that is for him to say.
- **Backfilling trees.** New articles only, per Greg twice.
- **The two lookup answers** — *Check the web* and a typed term — both run `explainStream`
  ([`src/term-lookup.ts`](../../src/term-lookup.ts) → [`src/explain.ts`](../../src/explain.ts)),
  which is also Explain mode's prompt and still carries the 2026-09-03 wording. Changing it changes
  Explain mode, which Greg did not name, so it is deferred rather than folded in. Stored lookup
  answers survive a glossary rewrite by term id, so a newly plain entry can open onto an older,
  denser checked answer until the reader asks again.
