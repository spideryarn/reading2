# Fidelity guard: GPT-6 Luna's new alarms, read by hand (2026-10-09)

Every paragraph that GPT-6 Luna flags `contradicts`, that has no fault or borderline label, and that GPT-5.6 Luna
passed. Each was read against the passages it cites, and against the rest of the article where the
claim wasn't in those passages.

## How the runs were lined up

- Both files come from `scripts/probes/261001h-fidelity-guard-probe.ts check`. There is one JSONL
  line per *level*, keyed by `(arm, slug, level)`. A missing `slug` means the PID paper. Verdict `n`
  is the 1-based paragraph index. Following the probe's own `readLines`/`score`, the first line for
  each level is the one that counts.
- A paragraph's label key is `<arm>/<level>/<n-1>` on the PID paper and
  `<arm>/<slug>/<level>/<n-1>` on a control. "Labelled" means present in `faults` or `borderline` in
  `docs/plans/261001h-fidelity-guard-labels.json`.
- The paragraph text, its cited ids and the cited block texts come from
  `data/probes/261001h-fidelity-guard-corpus.json` (gitignored; the probe's `corpus` step rebuilds
  it). Claims that weren't in the cited blocks were checked against the rest of the corpus, and for
  Gwern against `evals/extraction/fixtures/gwern.html`.
- 274 levels appear in both runs, holding 1018 unlabelled paragraphs. GPT-5.6 Luna flags 15 of them
  and GPT-6 Luna flags 56. Both flag 12, so 44 are new to GPT-6 Luna (the net difference is 41).
  The 44 split as 15 on PID, 9 on Olah and 20 on Gwern.
- Offline review reproduced those counts from the two JSONL files alone: the
  common levels each contain 1,046 verdicts, less 26 fault-labelled paragraphs
  and 2 in `borderline`. The probe's operational scoring also excludes one
  paragraph marked borderline in `alarmsReadByHand`, giving 1,017, 14 and 55
  instead; the 44 new flags are the same under either denominator.

**Classes.** REAL: the paragraph says something its passages don't support, or contradicts them,
and the article doesn't back it either. BORDERLINE: an arguable overstatement. NITPICK: the paragraph
is faithful and the flag is wrong or pedantic. The milder class was taken when in doubt.
**"True elsewhere"** (`te` below) means the claim is right about the article but sits in a passage
the paragraph didn't cite. The labels file already scores that case as a false alarm
(`true-elsewhere`), and the checker's own prompt says "not covered … is ok", so it counts as NITPICK
here.

## The 44

| # | level id | paragraph excerpt | checker's reason | class | why |
|---|---|---|---|---|---|
| 0 | high-15-beforeA/paragraphs/3 | "synergy was higher … in neurons with more loop-like (recurrent) connections, and where input signals were moderately similar" | Passages don't say synergy was higher when inputs moderately similar | NITPICK | te: the peak at moderate MI is spya-ybmve2 |
| 1 | high-15-beforeA/scaling-hypothesis/paragraphs/2 | "training pushes it toward the simplest ones that still work, which turn out to be more general and human-like" | Passages say sub-models average out to favour simple solutions, not general/human-like | NITPICK | te: "more generalizable, more human-like" is in spya-ewxv9q |
| 2 | high-about-after1/scaling-hypothesis/paragraphs/1 | "it learned to follow instructions and pick up new tasks from a few examples … It was never specifically trained to do this" | Passages don't say GPT-3 was never specifically trained to do this | NITPICK | Passage: trained only on next-token prediction, yet "manifests … meta-learning" |
| 3 | high-about-slider2/fuller/2 | "runs about 2.7x higher in densely connected 'rich club' hub neurons" | The 2.7× is about triads inside rich clubs, not hub neurons | NITPICK | Triad→neuron is a plain-words simplification; same direction, same number (near-borderline) |
| 4 | high-about-slider2/scaling-hypothesis/fuller/2 | "easy, memorizing sub-models win early, but enough data and scale force out sub-models that generalize … bloat eventually breaks memorization" | Passages don't say memorizing sub-models win early or that bloat breaks memorization | NITPICK | te: spya-vkkfzh says exactly this |
| 5 | high-about-split1/paragraphs/1 | "mutual information … and transfer entropy … can track information flow but can't reveal how information … is combined" | Passage says MI doesn't quantify transfer; it measures instantaneous dependence | BORDERLINE | spya-qjdbvj calls both "well suited" to tracking propagation, but cited spya-f6sbgx says MI isn't flow |
| 6 | high-about-split1/scaling-hypothesis/fuller/2 | "squeezing out the last bits of prediction error on text forces a model toward real understanding" | Passages don't say rare prediction errors force understanding | NITPICK | te: "The last bits are deepest" (spya-kmyg3w) |
| 7 | high-about-split2/olah-a4-spya-ujr7p0/paragraphs/2 | "Superposition … stores far more features than there are neurons, at the cost of losing easy linear readout and blocking composition" | Passages call them competing strategies, not mutually exclusive | NITPICK | "if there's no composition, one can instead store exp(m) items in superposition" supports it |
| 8 | high-about-split2/scaling-hypothesis/paragraphs/1 | "GPT-3 was cheap by government or military budget standards" | Passage calls GPT-3 extraordinarily expensive by ML standards | NITPICK | The milli-Manhattan-Project sarcasm means just this; spya-ewxv9q says it outright |
| 9 | high-about-split2/scaling-hypothesis/paragraphs/3 | "comparing it to past dismissals of nuclear weapons feasibility" | Cited passages don't compare scaling scepticism to nuclear dismissals | NITPICK | te: Bohr and "Don't Worry—It Can't Happen" (atomic bomb) are in the essay |
| 10 | high-goalA-after1/olah-a4-spya-ujr7p0/paragraphs/2 | "Composition … uses more neurons but lets new combinations be read out easily" | Cited passages say composition needs fewer neurons than a local code | BORDERLINE | Defensible next to superposition, but its own passage says "many fewer neurons"; it misleads |
| 11 | high-goalA-slider1/scaling-hypothesis/brief/1 | "while most researchers assumed complex architectures were needed. GPT-3's results suggest otherwise" | Passages don't say most researchers assumed complex architectures were needed | NITPICK | te: "believed to require complicated architectures & fancy algorithms" (spya-ewxv9q) |
| 12 | high-goalA-slider1/scaling-hypothesis/paragraphs/2 | "simple memorizing solutions get outcompeted by more general, abstract ones—because memorization can't scale" | Passages don't say memorization cannot scale | NITPICK | te: spya-vkkfzh ("can't possibly memorize all the instances") |
| 13 | high-goalA-slider1/scaling-hypothesis/paragraphs/3 | "most AI researchers … have no real model of why scaling works … their public reassurances about AI risk carry little weight" | Passages don't support lacking a model or reassurances carrying little weight | NITPICK | te: "no coherent model … their comments on AI risk are meaningless" (spya-ewxv9q) |
| 14 | high-goalA-slider1/scaling-hypothesis/fuller/1 | "The scaling curves for GPT-3's prediction loss also kept improving smoothly … with no sign yet of bending" | Passages say scaling factors unchanged, not that they were prediction-loss curves | NITPICK | Pedantic; "curves still are not bending" is quoted |
| 15 | high-goalA-slider2/brief/1 | "was about 2.7 times higher in triads inside densely connected 'rich club' hubs" | Passages say synergy was a quarter of transfer entropy, not 2.7× higher | NITPICK | Checker misread; the 2.7× rich-club figure is exact |
| 16 | high-goalA-slider2/olah-a4-spya-ujr7p0/brief/1 | "it needs few neurons, generalizes well, and stays linearly readable. Superposition … loses that linear readability" | Passages don't support linear readability claims | NITPICK | Cited passage: superposition needs "a non-linearity … to retrieve" |
| 17 | high-goalA-slider2/scaling-hypothesis/paragraphs/0 | "it showed meta-learning … that its predecessor GPT-2 never showed" | Passages don't say GPT-2 never showed meta-learning | NITPICK | Passage contrasts GPT-2's tasks with GPT-3's "qualitatively distinct" meta-learning |
| 18 | high-goalA-slider3/olah-a4-spya-ujr7p0/paragraphs/2 | "full composition needs exponential volume to store all feature combinations" | Passage says n composable features need exp(n) volume | NITPICK | Checker restates the paragraph and calls it a contradiction |
| 19 | high-goalA-slider3/scaling-hypothesis/brief/2 | "DeepMind's 'weak' one, which expects AGI to need separately engineered modules built up piece by piece" | DeepMind's modules are invented and refined piece by piece, not built up | NITPICK | Checker's reason is garbled; the paragraph matches spya-vr9q2p |
| 20 | high-goalB-after1/scaling-hypothesis/paragraphs/1 | "OpenAI built its whole strategy on betting that scaling works; most other labs, like DeepMind, did not" | DeepMind held a weak scaling hypothesis, not disbelief | NITPICK | "did not bet" is right: DM won't "bet the company" |
| 21 | high-goalB-slider2/scaling-hypothesis/brief/2 | "scaling keeps working with no sign of hitting a wall … agency is often the most useful way to compress" | Passages don't say no wall; agency framed as a possibility | NITPICK | te: no-wall is spya-asr663; agency matches spya-mkbrjp |
| 22 | high-goalB-split2/fuller/2 | "peaking when their shared information is only about 7% of its maximum … redundancy spiking during movement execution" | Passages don't report peak or monkey findings; feedback point misread | NITPICK | te (spya-ybmve2, monkey passage); the feedback point matches spya-sd9fzd |
| 23 | high-goalB-split2/fuller/3 | "relied on simpler bivariate connectivity estimates … plus it was done in cultured tissue rather than a fully behaving brain" | Passages don't support bivariate/culture claims; estimates overstate MI, underestimate entropy | NITPICK | te (spya-j4cy9j); "overstate information" = overestimated MI. Small scope slip: the monkey work wasn't cultured |
| 24 | high-none-after1/scaling-hypothesis/fuller/2 | "unlike most research, where small problems are easy and big ones are hard" | Passage says small things are hard and large things impossible | NITPICK | Same ordering (small easier than large); a paraphrase |
| 25 | high-none-pidpost2/paragraphs/3 | "Studying mouse brain tissue in dishes, the authors found synergy … clusters in 'rich clubs'" | Passages don't say these came from mouse tissue in dishes | NITPICK | te: organotypic mouse cortical cultures (spya-sw5ukx) |
| 26 | high-none-pidpost2/olah-a4-spya-ujr7p0/brief/0 | "'distributed representations,' where information is spread across many neurons instead of one neuron per thing" | Passages don't say they spread information across neurons | NITPICK | A definitional gloss of the term; the note's whole subject |
| 27 | high-none-pidpost2/olah-a4-spya-ujr7p0/brief/2 | "Superposition squeezes more things than there are neurons by overlapping them, letting you store exponentially more" | Passages say exponentially many items, not more than neurons | NITPICK | Pedantic; exp(m) items in m bits is more than the neurons |
| 28 | high-none-pidpost2/olah-a4-spya-ujr7p0/paragraphs/3 | "only one of them keeps things understandable in terms of a manageable number of separate features" | Passages say composition does, not that only one does | NITPICK | The checker's reason agrees with the paragraph |
| 29 | high-none-pidpost2/scaling-hypothesis/fuller/2 | "unlike most research, where problems get harder as they grow, deep learning problems seem to get easier" | Passage says larger models learn faster, not that problems get harder | NITPICK | Misread; "small things are hard and large things impossible" |
| 30 | high-none-pidpost3/fuller/1 | "mutual information … and transfer entropy … can track information flowing through a circuit" | Passage says MI does not quantify transfer or flow | BORDERLINE | As #5; only the passage that denies it is cited |
| 31 | high-none-pidpost6/brief/2 | "Synergy was also higher when input signals were somewhat similar, though too much similarity caused redundancy instead" | Passage says more similarity → more synergy, not redundancy | NITPICK | te: spya-cs9fdy ("grows past some point, it becomes redundant") |
| 32 | high-none-pidpost6/paragraphs/3 | "on recordings from mouse brain tissue … when input neurons were moderately correlated in their firing" | Passages don't identify mouse tissue or moderate correlation | NITPICK | te; already hand-labelled `true-elsewhere` in alarmsReadByHand |
| 33 | high-none-pidpost11/fuller/1 | "mutual information … and transfer entropy … can track information flow, but cannot show how neurons combine inputs" | MI is undirected and does not quantify transfer or flow | BORDERLINE | As #30 |
| 34 | high-none-pidpre2/olah-a4-spya-ujr7p0/fuller/3 | "superposition instead crams in exponentially many unrelated items but only works if there's no composition" | Passages say they can mix when sparse, not superposition only works without composition | BORDERLINE | "only works" overstates the limiting case, and the next sentence of the paragraph says they mix |
| 35 | high-none-pidv2_1/paragraphs/2 | "Synergy rose then fell … peaking at about 7% of the maximum possible correlation" | Peak is at 7% of maximal mutual information, not correlation | BORDERLINE | Number pinned to a different quantity, though the article calls MI "a nonlinear correlation" |
| 36 | high-none-pidv2_1/scaling-hypothesis/brief/2 | "real steps toward general AI are closer than most experts think, yet few research groups are willing to bet on it" | Passages say scaling was unpopular, not that few groups would bet | NITPICK | te: the OpenAI-vs-DeepMind bet (spya-arrq35, spya-vr9q2p) |
| 37 | high-none-pidv2_2/olah-a4-spya-ujr7p0/paragraphs/2 | "A 'compositional' code uses separate neurons for color and for shape … needing fewer neurons and generalizing well" | Passages call this scheme semi-local, not compositional | NITPICK | Misread: spya-qcd003 says Thorpe's "semi-local" *is* the compositional code |
| 38 | high-none-pidv2_2/scaling-hypothesis/brief/2 | "hard problems get easier for these models as they grow, instead of harder" | Hard problems easier for larger models, not as they grow | NITPICK | Pedantic distinction without a difference |
| 39 | high-none-pidv2_5/paragraphs/2 | "'rich clubs' … which had 2.7 times more synergy than other neurons … added similarity caused redundancy instead" | The 2.7× compares triads, not neurons | NITPICK | As #3; the redundancy claim is te (spya-cs9fdy) |
| 40 | high-none-pidv2_6/fuller/1 | "new tools are now needed to make sense of huge amounts of recorded brain activity" | Passages say recording tech made data available, not that new tools were needed | NITPICK | spya-s9kmxa: "a rendering process is still needed to extract interpretable insights from terabytes" |
| 41 | high-none-slider1/paragraphs/1 | "That synergistic piece is treated as a sign of real computation, not just adding up inputs" | Passages don't say it signals computation rather than adding up inputs | NITPICK | spya-e94ury: whole > sum of parts = integrating "computation" |
| 42 | high-none-slider2/scaling-hypothesis/brief/2 | "Many expert researchers doubted this would work, but the author argues GPT-3 proves them wrong" | Passages don't say GPT-3 proves it or that experts doubted | NITPICK | spya-cty5hx ("written off … by the rest of the AI community"), spya-emqjaa ("they were right") |
| 43 | high-none-slider3/scaling-hypothesis/paragraphs/1 | "future AI progress depends mainly on spending enough money and computing power, not inventing new tricks" | Passage says compute and algorithms both had to be built | NITPICK | The essay's thesis; "We built the compute, and the algorithms did come" |

## Counts

| class | count |
|---|---|
| REAL | 0 |
| BORDERLINE | 6 (#5, #10, #30, #33, #34, #35) |
| NITPICK | 38 (14 of them true elsewhere: the claim is right, but the paragraph didn't cite the passage that says it) |
| total | 44 |

The other 24 NITPICKs come from the checker misreading its passages (#15, #18, #19, #29, #37),
from pedantic wording distinctions, and from treating a fair paraphrase as a contradiction. Three of
the six BORDERLINE flags are one recurring issue on the PID paper: the paragraph says mutual
information "tracks flow", and the article itself says this in one passage and qualifies it in
another.

## Verdict

GPT-6 Luna's extra strictness mostly causes needless rewrites. None of the 44 new alarms is a real
fault, 6 are arguable overstatements, and 38 are wrong or pedantic, often because it treats "not in
the cited passages" as "contradicts", which its prompt tells it not to do. Its 21/26 catch rate on
the labelled faults matches GPT-5.6 Luna's, so the extra alarms buy nothing in recall, and they
suggest more needless rewrites. These counts are paragraph alarms, not distinct
levels or measured rewrite calls; 56 versus 15 does not establish a fourfold
increase in level rewrites or total cost. The observed recall and alarm pattern
support holding the guard back pending a measurement of the full rewrite loop.
