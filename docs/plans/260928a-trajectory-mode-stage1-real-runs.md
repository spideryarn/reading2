# Trajectory stage 1 — the real runs

Stage 1 of [260928a](260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md): the server step
run on three local articles, 2026-09-28, local database, `claude-sonnet-5`, `low` effort, no reader
profile. Runs went through `scripts/stage.ts quotes <slug>` and then `scripts/stage.ts trajectory
<slug>`. The numbers come from the `trajectory` column, `revision_blocks` and `spideryarn.ai_calls`.
"Words" means the words in the blocks the stops sit on, and "%" is that share of every block in
the revision.

## Three prompt versions, and why

- **`trajectory/1`** — 2 of 3 runs completed. The entropy paper failed with `MalformedJson`.
- **`trajectory/2`** told the model not to use straight double quotes, and marked a second quote
  from the same paragraph. The short essay then failed in the same way. The raw answer showed why:
  the model had copied a quote id back as `"spya-spya-xcg2ub".replace("spya-spya-","spya-")`.
  Quote ids look like block ids, and the model mangles them.
- **`trajectory/3`** (the code-review candidate) shows the model the labels `Q1…Qn` instead of ids, and maps them
  back before validation (`labelOf`/`fromLabels`, with a test that fails without the mapping). All
  3 runs then completed. The tables below are from `/3`.
- **`trajectory/4`** is the reviewed prompt: it offers only the highest-priority quote from each
  block and fences each quote record as untrusted article data. This review did not touch the
  database or network, so the measured runs below remain `/3` evidence.

## Results

| | Short essay: *Life is Short* (`vb-spya-vu3xen`) | Normal paper: *Neural information processing* (`entropy-24-00930…`) | Long sectioned paper: *Ball lightning observations* (`source-spya-furjgs`) |
|---|---|---|---|
| Body | 1,687 words, 41 blocks | 8,580 words, 99 blocks | 9,995 words, 95 blocks |
| Quotes (offered) | 10 | 26 | 16 |
| Stops at Gist / More / Most | 2 / 5 / 9 | 5 / 12 / 21 | 4 / 6 / 13 |
| Words (%) at Gist | 123 (7.3%) | 666 (7.8%) | 491 (4.9%) |
| Words (%) at More | 361 (21.4%) | 1,623 (18.9%) | 731 (7.3%) |
| Words (%) at Most | 822 (48.7%) | 2,769 (32.3%) | 1,920 (19.2%) |
| Dropped | 1 same-block | 5 same-block | 3 same-block |
| Trajectory call | 4.6 s, $0.0088 | 9.0 s, $0.0196 | 9.4 s, $0.0135 |
| Quotes call (if bought first) | 11.4 s, $0.023 | 33.6 s, $0.080 | 20.8 s, $0.072 |

Across the three versions and six completed calls, the trajectory call took 4–12 s and cost
$0.009–0.021.

### Quotes per top-level section (the coverage risk)

- **Essay:** 1 · 3 · 2 · 3 · 1 · 0 (the Notes). Covered.
- **Normal paper:** Front matter 0 · Intro 2 · Tracking 3 · Processing 1 · PID 5 · PID in Action 10 ·
  Practical 3 · **Future Directions 0** (636 words) · Summary 2.
- **Long paper:** Overview 0 · History 3 · Methodology 1 · **Scientists as observers 4 over 4,587
  words** (46% of the body) · Other observers 1 over 1,896 words · Synopsis 1 · Notable cases 2 ·
  Conclusions 4.

### The routes (`trajectory/3`)

Each stop is written as its number, its depth, its section path, and then its role.

**Essay:**
1 [G] Savoring › Squeezing Out Experience — *The core advice in one line* ·
2 [G] Life Actually Is Short › Counting in Peanuts — *How the author came to feel time's scarcity* ·
3 [M] Eliminating Bullshit › The Character of Bullshit ·
4 [M] Seeking What Matters › Learning What Matters ·
5 [M] Surprised by Loss › Taken by Surprise — *The behavior change this urgency calls for* ·
6–9 [Most] Bullshit Forced On You, Bullshit You Choose, Learning What Matters, Taken by Surprise.

**Normal paper:**
1 [G] 1. Introduction › Open Questions — *What the article means by information processing* ·
2 [G] 4. PID › 4.1 Basic Problem — *The core distinction between synergy and redundancy* ·
3 [G] 3. Processing › Limits of Information Transfer — *Why a new analytic tool is needed* ·
4 [G] 5. PID in Action › 5.1 Rich Clubs — *Where synergy concentrates in the network* ·
5 [G] 8. Summary — *What the overall findings mean for neuron function* ·
6–12 [M] Historical Limitations, 2.2 Tracking Information, two from 4.1, 4.3 Choosing a Redundancy
Measure, 5.3, 5.5 ·
13–21 [Most] the rest of §2, §4, §5 and §6.

**Long paper:**
1 [G] 1 History › Origins of the term — *What makes this phenomenon hard to study* ·
2 [G] 1 History › Assessing the literature — *How the field's evidence base is judged* ·
3 [G] 7 Conclusions — *Why normal scientific method struggles here* ·
4 [G] 7 Conclusions — *A path toward better evidence going forward* ·
5–6 [M] 2 Methodology › Rarity of direct evidence; 5 Synopsis › Diversity of case types ·
7–13 [Most] §3 ×4, §4.1, §6 ×2.

## Judgment

- **Does Gist alone give the gist?**
  - **Essay: yes.** Stop 1 is the essay's own one-line summary.
  - **Long paper: yes.** What the phenomenon is and why it is hard, how good the evidence is, and
    the conclusion's two moves: about 490 words.
  - **Normal paper: mostly.** Its five Gist stops do frame the review: the question, the key
    concept, why a tool is needed, a result, and what it means. But stop 4's role leans towards a
    finding.
- **Does the route start somewhere sensible?** Yes on all three. None starts at paragraph 1 by
  default. The essay starts at its conclusion, and both papers start at the framing, with a jump
  to the conclusion or a result by stop 3–5. That is Greg's "results first, then a tour" adapted
  per piece.
- **The role rule mostly holds, and leaks at depth 3.** For example, *"Why too much similarity
  suppresses synergy"* (entropy, stop 18) states a finding. This needs watching in stage 2. A
  prompt tweak or a validation pass can come later.
- **Coverage is the real risk, as the plan predicted.**
  - The long paper's biggest section (46% of the words) has 4 quotes, all at depth 3. Its
    "Other trained observers" section has 1 quote over 1,896 words.
  - The normal paper's Future Directions section has none.
  - So Most reaches only 19–32% of the words on the papers.
  - This is Quotes' prompt, not this stage's. It is reported, not changed here.
- **Same-block drops are not fixed by the prompt.** The prompt marks "same paragraph as Qn", and
  3–5 stops per paper are still dropped. Validation is right to drop them, but those quotes cost
  nothing yet are never shown. There are two options: offer only one quote per paragraph, or
  accept the loss.
- **The growth rule never fired** on these three. The caps never bound.

## Stage 3: the cue prompt, `trajectory/5` (2026-09-28, once credit was restored)

| | Normal paper (entropy) | Short essay (*Life is Short*) |
|---|---|---|
| Stops at Gist / More / Most | 5 / 11 / 21 | 2 / 5 / 9 |
| Call time and cost | 10.5 s, $0.0227 | 5.2 s, $0.0108 |
| `badCue` | 0 | 0 |

Cues, first five of each:

- **Entropy:** *"Look for how the article frames the challenge of information processing in
  brains"* · *"Notice what question information transfer alone cannot answer"* · *"Look for how the
  whole versus sum of parts distinguishes synergy from redundancy"* · *"Look for how rich-club
  membership relates to information processing"* · *"Look for what synergy implies about how
  neurons respond to input patterns"*.
- **Essay:** *"Look for the three-part summary of how to respond to life's shortness"* · *"Notice how
  counting years in discrete units changes how time feels"* · *"Ask what force the phrase 'life is
  too short' actually carries"* · *"Look for what habit is recommended toward things you most want
  to do"* · *"Look for the test proposed for telling real value from fake urgency"*.

**Judgment.** Not one of the 30 cues states a finding. One edges towards it by presupposing a
finding: entropy stop 18, *"Look for why too much similarity suppresses synergy"*. That is the same
leak the role line had, and it is much rarer here. The cues are **monotonous**: 26 of the 30 start
*"Look for"*. They read as a checklist rather than a voice. A prompt nudge towards variety is cheap
if Greg finds it grating (trajectory.md § Questions for Greg, question 2).
