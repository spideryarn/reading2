# Blind pairs: two cues for one quoted line

A reader is skimming an article they have **not read**, usually a research paper from a field they have not studied. They are shown one stop at a time: a **cue** (one line written by a model) and then a **quote** (a line cut out of the article). The cue is there to get them ready for the quote. It may say what to look for. It must **not** say what the passage found or concluded: the reader is meant to get that from the passage.

Each pair below is one quote and two candidate cues for it, A and B. You are also shown the quote's own paragraph and the paragraph before it. **The reader does not see those before the cue**; they are there so that you can check a cue against the text.

For each pair, answer three questions:

- **(a) better prepared:** which cue better prepares a reader who has not read the article to understand this quote: so that they know what is at stake, what is being compared, and what words like "this", "the latter" or "their approach" in the quote refer to? `A`, `B` or `tie`.
- **(b) gives it away:** does either cue state what the passage found, concluded or chose, so that the reader has the answer before reading? Asking the question, or naming the options, is not giving it away. `A`, `B`, `both` or `neither`.
- **(c) invents or misstates:** does either cue say something about the context that the paragraphs shown do not support, or that gets them wrong? `A`, `B`, `both` or `neither`.

Judge each pair on its own, only from what is on the page.

## Pair 1

**The paragraph before:** Reporting model performance on a limited number of benchmarks is practical and reasonable. However, there seems to be a systematic disconnect between what code benchmarks actually measure and how benchmark scores are commonly interpreted. Because of this “meaning gap”, specific achievements on a narrow benchmark may inflate into broad assertions of general coding capability.

**The quote's paragraph** [section: Benchmark measurements and capability claims]: We illustrate the meaning gap concept using examples from the Qwen3-Coder-480B-A35B model descriptions. The original blog post reports the model performance on eight coding-related tasks, five of which correspond to issue resolution similar to SWE-bench (QwenTeam, 2025), and summarizes them as “exceptional performance in both coding and agentic tasks”. Finally, an independent blog post comparing models makes a claim “Chinese models aren’t just competing—they’re winning. Qwen 3 Coder leads at 67% on SWE-bench, surpassing GPT-4.1’s 54.6%” (DigitalAppliedTeam, 2025). Each step is understandable in isolation, but together they broaden a narrow performance measurement into a claim about general superiority at coding that may influence deployment decisions.

**The quote:** Each step is understandable in isolation, but together they broaden a narrow performance measurement into a claim about general superiority at coding that may influence deployment decisions.

**Cue A:** Track the two steps by which a narrow measurement grows into a broad claim about ability.

**Cue B:** A narrow score can be stretched into a broad claim through two separate steps; see how far it travels.

---

## Pair 2

**The paragraph before:** First, benchmarks are high-effort community service that is weakly rewarded, especially for maintenance, which matters even more than creation. Each conference introduces many new benchmarks, but very few are ever widely adopted, and fewer are still maintained as models, data, and contamination risks evolve. High-quality suites need sustained curation, robust evaluation harnesses, contamination monitoring, and regular refresh (Bean et al., 2025).

**The quote's paragraph** [section: Discussion]: We believe this is addressable institutionally: targeted grants (including industry sponsorship), conference tracks and workshops that reward ongoing maintenance (e.g., new versions, repaired instances, and contamination audits), not just initial releases, treating benchmarks as first-class research artifacts. Without recognizing benchmark maintenance as essential research infrastructure, the existence and support of benchmarks like SWE-Bench-Pro, SWE-rebench (Badertdinov et al., 2025), or LiveCodeBench depend on the chance and goodwill of a small number of individuals.

**The quote:** Without recognizing benchmark maintenance as essential research infrastructure, the existence and support of benchmarks like SWE-Bench-Pro, SWE-rebench (Badertdinov et al., 2025), or LiveCodeBench depend on the chance and goodwill of a small number of individuals.

**Cue A:** Notice what the survival of major benchmarks is said to depend on.

**Cue B:** See what depending on a few individuals' goodwill means for whether benchmarks survive.

---

## Pair 3

**The paragraph before:** • Decide aggregation: how should we combine axes (tasks, repos, languages) to report an interpretable profile rather than an over-compressed single score?

**The quote's paragraph** [section: Discussion]: Developing such a taxonomy is substantial research, but other areas of science (e.g., psychometrics) suggest it is feasible: latent constructs are estimated through batteries of partially correlated tests, not single measurement. We sketch how this taxonomy can look like in Appendix A. We stress this taxonomy is not ready to use, as creating usable taxonomy requires extensive empirical and qualitative work beyond the scope of our paper.

**The quote:** Developing such a taxonomy is substantial research, but other areas of science (e.g., psychometrics) suggest it is feasible: latent constructs are estimated through batteries of partially correlated tests, not single measurement.

**Cue A:** Building a map of coding skills is compared to another field's way of measuring hidden traits; which field, and how?

**Cue B:** See which other field is cited as a model for how hidden abilities can be measured through batteries of tests.

---

## Pair 4

**The paragraph before:** Across all seven model pairs and three benchmarks (7 539 examples), fine-tuning drops the OK rate from 52.4% to 43.1%. The modal dominant regression path is OK → NOT_RUN: fine-tuned models emit agent-style output (XML tags, markdown fences, preamble code) that the harness cannot parse. In total, 47.2% of regressions come from format or parsing error (NOT_RUN + IndentationError), and 52.8% of regressions are caused by essential mistakes such as AssertionError or SyntaxError. Thus, the impact of coding capability degradation and failure to follow the format are compatible. Model capacity determines whether this overfitting occurs. Comparing SWE-agent-LM-7B and -32B (both fine-tuned on SWE-smith and have \(>13\%\) improvements on SWE-bench) on Method Generation:

**The quote's paragraph** [section: Appendices A–C: taxonomy and evidence]: • 7B (52.9% → 5.8% OK): the largest flow is OK → NOT_RUN (113 examples). The model wraps output in [object Object]…[object Object] tags instead of a bare def block; 54 further examples acquire IndentationError.

**The quote:** 7B (52.9% → 5.8% OK): the largest flow is OK → NOT_RUN (113 examples).

**Cue A:** Look at how one smaller model's correct-answer rate changed, and what kind of error dominated its failures.

**Cue B:** Note which direction of change dominates for this smaller model size.

---

## Pair 5

**The paragraph before:** When both SWE-agent checkpoints and the raw model are put into the same scaffolding, the fine-tuned checkpoints outperform the raw model. However, both for raw models and SWE-agent-LM-32B checkpoint removal of scaffolding further improves the results in ten-step setup. To check further if ten steps are insufficient and whether the agent runs out of steps, we evaluate SWE-agent-LM-32B checkpoint in agentic scaffolding with 75-step limit. We consider this particular checkpoint as it has the smallest difference with the raw model non-agentic performance, and we do not run other checkpoints due to budget limitations. In this setup, SWE-agent-LM-32B scores \(63.51\), so it takes 75 steps in an agentic scaffolding for a particular SWE-agent checkpoint to match a non-agentic setup for either SWE-agent checkpoint or raw model. The difference between ten and 75-step scaffolding performance highlights that agentic setup requires multiple tries to solve the task and suggests that in ten-step setup running out of steps is the key failure mode.

**The quote's paragraph** [section: Appendices A–C: taxonomy and evidence]: All in all, this indicates that regardless of the fine-tuning approach some tasks are better solved without an agentic scaffolding. The failure of SWE-agent-LM-32B checkpoint to outperform the raw model in non-agentic setup further supports our point on the lack of cross-task transfer. We stress that creators of SWE-agent checkpoints could not have checked this without creating additional benchmarks (a significant research and technical effort), so this reflects a failure of the evaluation ecosystem, not of the researchers themselves.

**The quote:** We stress that creators of SWE-agent checkpoints could not have checked this without creating additional benchmarks (a significant research and technical effort), so this reflects a failure of the evaluation ecosystem, not of the researchers themselves.

**Cue A:** Who does this gap in testing get blamed on, and why?

**Cue B:** Consider who this gap in testing reflects badly on: the researchers, or the evaluation system itself.

---

## Pair 6

**The paragraph before:** Furthermore, the two marginal mutual information terms can be decomposed accordingly:

**The quote's paragraph** [section: 4. PID: Partial Information Decomposition]: The result is an underdetermined system of linear equations, with three known values (the mutual information terms) and four unknown values (the partial information terms). If any of the unknown terms can be defined, then the other three emerge “for free”. Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each. The most common approach is to define a redundancy function such as the original proposal of Imin [1] (for more on redundancy functions, see Section 4.3), although there have also been proposals that start with the unique information [24,25] or synergy [26,27].

**The quote:** Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each.

**Cue A:** Classical information theory leaves redundancy, uniqueness, and synergy underdetermined. See what response this gap prompted.

**Cue B:** Redundant, unique, and synergistic pieces of information: why can't classical information theory settle their values uniquely?

---

## Pair 7

**The paragraph before:** Figure 2. Partial information lattices. On the left is the lattice for two predictor variables, and on the right is the lattice for three predictor variables. Each lattice is constructed and annotated following the notation in [1]. Lattice vertices are partial information atoms, i.e., the unique modes of information-sharing that comprise the overall joint mutual information. Information atoms are denoted by index only: for example, {1}{2} is the information redundantly disclosed by X₁ or X₂, {1}{23} is the information disclosed by X₁ or (X₂ and X₃), etc. Lattice edges indicate which atoms subsume other atoms. Atoms connected to and below other atoms consist of components of and/or subsets of the higher atoms, for example, {1}{2} ⪯ {1}{23} and {2}{13}, since information disclosed by {1}{2} would also be visible to {1}{23} and {2}{13} if we did not use the Mobius inversion.

**The quote's paragraph** [section: 4. PID: Partial Information Decomposition]: Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks (such as only being defined for systems of a fixed size, only being amenable to discrete random variables, or requiring arbitrary thresholds). There are, at present, close to a dozen competing redundancy functions (see [22,29,31–40]). In the absence of a single accepted measure, different contexts may require the choice of different functions. For example, having more than two predictors precludes the measures proposed in [24,31], while continuous data cannot be analyzed with the measures proposed in [24,40], and so on. The majority of the studies discussed in this paper used the original Imin measure proposed in [1], although this measure has been criticized for unintuitive behavior [29,39]. For a deeper discussion of the practical considerations, see Section 6.

**The quote:** In the absence of a single accepted measure, different contexts may require the choice of different functions.

**Cue A:** Why might different studies need to pick different redundancy measures rather than one standard choice?

**Cue B:** Ask whether one single way of measuring redundancy fits every situation.

---

## Pair 8

**The paragraph before:** Mutual information [12] can measure the dependence in the spiking between two neurons: I(X;Y) := ∑ x∈X y∈Y P(x, y)log2 P(x|y) P(x) (1) where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal probability of X, and P(x|y) is the conditional probability X = x given that Y = y. I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13]. This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”

**The quote's paragraph** [section: 2. Tracking Information in Neural Circuits]: Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1), conditioned on Y’s own past (Yp): TE(X → Y) := (2) ∑ yt+1∈Y xp∈Xp yp∈Yp P(yt+1, yp, xp)log2 P(yt+1|xp, yp) P(yt+1|yp) TE(X → Y) is read as the transfer entropy from X’s past to Y’s future. It is important to note that Xp does not necessarily have to be a single moment or bin but can be a multi-dimensional and potentially non-uniform embedding [15–17]. TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation. In addition to measuring the magnitude of information flow between two neurons, in the special case of binary signals the TE can be modified to also provide a measure of excitation/inhibition balance using the sorted local transfer entropy [18].

**The quote:** TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation.

**Cue A:** Compare this measure of information propagation to a plain measure of shared dependence between two variables.

**Cue B:** Mutual information tracks similarity; transfer entropy tracks something else. What does transfer entropy measure instead?

---

## Pair 9

**The paragraph before:** The observation that information propagation correlates with information processing suggests that rich clubs may be dense cores of information processing. Rich clubs generally represent the set of best-connected nodes of a network that are mutually interconnected with a probability higher than that expected by chance [48]. The rich club coefficient quantifies just how much more densely connected a given set of nodes is than would be expected by chance. Rich clubs, in the context of the effective networks built from cortical circuit spiking recordings, are comprised of the neurons that propagate the most information (i.e., sending and receiving). By definition, rich clubs are disproportionately dense in information propagation: 20% of the neurons account for 70% of the information propagation in organotypic cortical cultures [49].

**The quote's paragraph** [section: 5. PID in Action]: PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation.

**The quote:** Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B).

**Cue A:** Note how much more synergy densely interconnected hub neurons process compared to others.

**Cue B:** Compare synergy inside densely connected rich-club triads to synergy outside them. Note the ratio.

---

## Pair 10

**The paragraph before:** When trained on mid-sized datasets such as ImageNet without strong regularization, these models yield modest accuracies of a few percentage points below ResNets of comparable size. This seemingly discouraging outcome may be expected: Transformers lack some of the inductive biases inherent to CNNs, such as translation equivariance and locality, and therefore do not generalize well when trained on insufficient amounts of data.

**The quote's paragraph** [section: 1 INTRODUCTION]: However, the picture changes if the models are trained on larger datasets (14M-300M images). We find that large scale training trumps inductive bias. Our Vision Transformer (ViT) attains excellent results when pre-trained at sufficient scale and transferred to tasks with fewer datapoints. When pre-trained on the public ImageNet-21k dataset or the in-house JFT-300M dataset, ViT approaches or beats state of the art on multiple image recognition benchmarks. In particular, the best model reaches the accuracy of 88.55% on ImageNet, 90.72% on ImageNet-ReaL, 94.55% on CIFAR-100, and 77.63% on the VTAB suite of 19 tasks.

**The quote:** We find that large scale training trumps inductive bias.

**Cue A:** What do the authors conclude matters more than the kind of built-in structure a model starts with?

**Cue B:** Which matters more for a vision model, built-in structure or sheer scale of training data?

---

## Pair 11

**The paragraph before:** Inspired by the Transformer scaling successes in NLP, we experiment with applying a standard Transformer directly to images, with the fewest possible modifications. To do so, we split an image into patches and provide the sequence of linear embeddings of these patches as an input to a Transformer. Image patches are treated the same way as tokens (words) in an NLP application. We train the model on image classification in supervised fashion.

**The quote's paragraph** [section: 1 INTRODUCTION]: When trained on mid-sized datasets such as ImageNet without strong regularization, these models yield modest accuracies of a few percentage points below ResNets of comparable size. This seemingly discouraging outcome may be expected: Transformers lack some of the inductive biases inherent to CNNs, such as translation equivariance and locality, and therefore do not generalize well when trained on insufficient amounts of data.

**The quote:** When trained on mid-sized datasets such as ImageNet without strong regularization, these models yield modest accuracies of a few percentage points below ResNets of comparable size.

**Cue A:** See how these models perform on a mid-sized dataset without heavy regularization, compared to similarly sized CNNs.

**Cue B:** Note how this model performs on a mid-sized dataset without heavy regularization.

---

## Pair 12

**The paragraph before:** Figure 7: Left: Filters of the initial linear embedding of RGB values of ViT-L/32. Center: Similarity of position embeddings of ViT-L/32. Tiles show the cosine similarity between the position embedding of the patch with the indicated row and column and the position embeddings of all other patches. Right: Size of attended area by head and network depth. Each dot shows the mean attention distance across images for one of 16 heads at one layer. See Appendix D.7 for details.

**The quote's paragraph** [section: 5 CONCLUSION]: We have explored the direct application of Transformers to image recognition. Unlike prior works using self-attention in computer vision, we do not introduce image-specific inductive biases into the architecture apart from the initial patch extraction step. Instead, we interpret an image as a sequence of patches and process it by a standard Transformer encoder as used in NLP. This simple, yet scalable, strategy works surprisingly well when coupled with pre-training on large datasets. Thus, Vision Transformer matches or exceeds the state of the art on many image classification datasets, whilst being relatively cheap to pre-train.

**The quote:** This simple, yet scalable, strategy works surprisingly well when coupled with pre-training on large datasets.

**Cue A:** Note what simple strategy the authors credit for this result, combined with what scale of pre-training.

**Cue B:** Notice what simple strategy the authors credit for the surprising results, once paired with large-scale pre-training.

---

## Pair 13

**The paragraph before:** “Guarda! Guarda!” (“See! See!”) – calls from the Corsa dei Servi (central street, now Corso Vittorio Emanuele II) in the centre of Milan alarmed Lorenzo Butti, marine painter of the Empress of Austria. It was 18:00 LT (local time) in June 1841, with a heavy thunderstorm outside. Butti looked out of the window where people were running in the rain under a reddish-yellow ball of fire. It travelled at window height of the second floor, rose higher, and then exploded at a church tower cross with a dull crash. The artist wrote his experience to physicist Arago. Arago’s report was rediscovered by senior school official Walther Brand for his monograph “Der Kugelblitz” (1923, 2010), the only one in German to date.

**The quote's paragraph** [section: 1 Historical outline]: Since Sur le tonnerre of French astronomer and physicist François Arago (1837), the term ball lightning (Kugelblitz, foudre globulaire) stands for a still unexplained group of metastable luminous phenomena in atmospheric electricity. Ball lightning appears seemingly random in time and space, lasts a few seconds, and disappears with traces or without. Because of its unpredictable occurrence, most of the collected material remains anecdotal.

**The quote:** Ball lightning appears seemingly random in time and space, lasts a few seconds, and disappears with traces or without. Because of its unpredictable occurrence, most of the collected material remains anecdotal.

**Cue A:** Note why so much of the material on this phenomenon stays anecdotal rather than scientific.

**Cue B:** Notice how its unpredictable timing shapes what kind of evidence can ever be gathered about it.

---

## Pair 14

**The paragraph before:** Physics professor Vladimir Lvovich Bychkov, then working at Thousand Oaks, California, USA, returned home on 25 October 2002, at 21:30 LT. In his 2005 note he remembered smog, and it was dark and windy. “I walked downhill along a dimly lit street. Suddenly, 20–30 m above a palm tree 50 m from me, near my house, a bright object lit up noiselessly. It was white, had about 500–1000 W brightness, approximate size 30–40 cm, was falling down for about 2–3 s at 1 m s−1, and then silently went out. There were no people nearby, it was no firecracker, and did not fall from a plane” (Vladimir Lvovich Bychkov, personal communication, 2020). Camarillo airport, 27 km west, reported 88 % relative humidity and 4.6 mph (7.4 km h−1) ENE wind at 20:55 LT. It was cloudy, with local rain showers possible. As high object brightness was reported, we note that adaptation luminance is lowered by a night setting (Schreuder, 1998), so a ground glass 500 W incandescent light bulb (now phased out) will glare with 5 × 105 cd m−2.

**The quote's paragraph** [section: 3 Scientists as ball lightning observers]: A special category of reports is ball lightning encountered by children who, in their later life, followed a scientific career and then described in detail what they saw. It can be argued that all children have similar observation capabilities. However, scientific training and profession might improve the quality of their recalled eyewitness testimony. Therefore, four such accounts are included in this compilation:

**The quote:** A special category of reports is ball lightning encountered by children who, in their later life, followed a scientific career and then described in detail what they saw. It can be argued that all children have similar observation capabilities. However, scientific training and profession might improve the quality of their recalled eyewitness testimony.

**Cue A:** Ask what might make a childhood witness's later recollection more scientifically useful than an ordinary one.

**Cue B:** Ask what, if anything, a later scientific career adds to the reliability of a childhood sighting.

---

## Pair 15

**The paragraph before:** …e observer Kurt Krenn, station Wiel/Eibiswald, Styria, Austria, saw a severe thunderstorm cross the mountains with lightning after 21:30 LT. At 22:00, he noticed lightning with a blue-white flare that lasted for about 3 min and ended with two more lightning flashes and a local blackout. Other people had seen more – a stationary blue-white ball at the Gontschnigg hill west of Eibiswald for 3 min. In the evening of 4 July 1989, a thunderstorm front passed St Poelten, Lower Austria. Christian Witz, synoptic observer of the local weather station, was off duty, taking lightning photos near Senning, east of town. Around 21:00 LT it was dark because of heavy rain. After a ground stroke, Witz saw a white fuzzy ball above the ground about 300 m from the lightning location. It was stationary and went out after 7 s. A time exposure with his camera showed a white blob (Keul, 1994). On 15 January 1994, thunderstorms moved in from the North Sea over Neuruppin, Brandenburg, Germany. Shortly after 17:00 LT, Thomas Hinz, the local weather observer on duty, saw a very bright lightning flash with thunder after 10 s to the north. In the following days, a series of observations from Neuruppin people were forthcoming. Fourteen witnesses described ball lightning, mostly outside their homes, size between 0.2 and 1 m, seven objects were seen in motion. The German lightning location system BLIDS detected positive cloud–ground lightning of 370 kA at 17:08:36 LT 6 km to the north (Baecker et al., 2007).

**The quote's paragraph** [section: 4 Other trained observers]: The tendency of weather services to do without observers and automate synoptic stations (including German mountain-top observatories) may be justified from an economic standpoint, but it eliminates high-quality observations of rare phenomena such as ball lightning. Whether this will be compensated by citizen science and the spread of mobile phone and web cameras remains uncertain.

**The quote:** The tendency of weather services to do without observers and automate synoptic stations (including German mountain-top observatories) may be justified from an economic standpoint, but it eliminates high-quality observations of rare phenomena such as ball lightning.

**Cue A:** Consider what is lost for rare-phenomenon detection when trained human observers are replaced by automation.

**Cue B:** Consider what is lost scientifically when stations stop using human weather observers.

---

## Pair 16

**The paragraph before:** Using this method, I discovered a few more topics that I had forgotten—among them the efficacy of various forms of psychotherapy. So I began to investigate through the library, and so on, and I have so much to tell you that I can’t do it at all. I will have to limit myself to just a few little things. I’ll concentrate on the things more people believe in. Maybe I will give a series of speeches next year on all these subjects. It will take a long time.

**The quote's paragraph** [section: Defining Cargo Cult Science]: I think the educational and psychological studies I mentioned are examples of what I would like to call Cargo Cult Science. In the South Seas there is a Cargo Cult of people. During the war they saw airplanes land with lots of good materials, and they want the same thing to happen now. So they’ve arranged to make things like runways, to put fires along the sides of the runways, to make a wooden hut for a man to sit in, with two wooden pieces on his head like headphones and bars of bamboo sticking out like antennas—he’s the controller—and they wait for the airplanes to land. They’re doing everything right. The form is perfect. It looks exactly the way it looked before. But it doesn’t work. No airplanes land. So I call these things Cargo Cult Science, because they follow all the apparent precepts and forms of scientific investigation, but they’re missing something essential, because the planes don’t land.

**The quote:** So I call these things Cargo Cult Science, because they follow all the apparent precepts and forms of scientific investigation, but they’re missing something essential, because the planes don’t land.

**Cue A:** Look for what is missing even though every outward form of science is followed.

**Cue B:** What is the one missing ingredient that keeps these efforts from working, despite looking just like science?

---

## Pair 17

**The paragraph before:** He finally found that they could tell by the way the floor sounded when they ran over it. And he could only fix that by putting his corridor in sand. So he covered one after another of all possible clues and finally was able to fool the rats so that they had to learn to go in the third door. If he relaxed any of his conditions, the rats could tell.

**The quote's paragraph** [section: Case Studies in Poor Science]: Now, from a scientific standpoint, that is an A‑Number‑l experiment. That is the experiment that makes rat‑running experiments sensible, because it uncovers the clues that the rat is really using—not what you think it’s using. And that is the experiment that tells exactly what conditions you have to use in order to be careful and control everything in an experiment with rat‑running.

**The quote:** Now, from a scientific standpoint, that is an A‑Number‑l experiment. That is the experiment that makes rat‑running experiments sensible, because it uncovers the clues that the rat is really using—not what you think it’s using.

**Cue A:** Ask what made this rat experiment worth calling first-rate by scientific standards.

**Cue B:** What does this rat experiment reveal about what the rats were actually responding to?

---

## Pair 18

**The paragraph before:** Functional recordings of the dorsal hippocampus during rearing show that it is associated with increased power of 7–12 Hz ’high theta’ rhythmic activity20–24. Rearing maybe an epoch of hippocampal processing because theta, itself, is associated functionally with hippocampal encoding and retrieval25–34, disrupting theta interferes with hippocampal dependent memory35–38, and restoring theta can rescue hippocampal dependent learning deficits39,40. Yet, studies examining theta and its relationship to learning and memory are standardly restricted to periods of normal horizontal locomotion during spatial exploration. Thus, while the correlation between hippocampal theta and rearing suggests that rearing could be an epoch of hippocampal dependent encoding, the relevance of rearing for spatial memory is unknown.

**The quote's paragraph** [section: Introduction]: These convergent reasons led us to hypothesize that rearing is an epoch of hippocampal dependent encoding of spatial memories. To test this hypothesis, we selectivity inactivated the dorsal hippocampus during rearing events in a spatial memory task. Hippocampal activity was manipulated with closed-loop, bilateral, optogenetic inactivation triggered by a 3D camera system calibrated to detect rearing. Manipulations of hippocampal activity were restricted to the study phase of an 8-arm maze delayed-win-shift task41,42. Behavioral assessments were performed during the subsequent test phase. We found that inactivation of the dorsal hippocampus during bouts of rearing resulted in impaired spatial memory at test. Hippocampal inactivation for matched amounts of time but delayed relative to rearing events, did not produce significant memory impairments. This effect was unique to the experimental rats that were transfected to express halorhodopsin and a fluorescent reporter. No impairments were observed in any condition in the control group rats that were transfected to express the fluorescent reporter only. These data provide the first evidence that the activity of the dorsal hippocampus during rearing is important for spatial memory.

**The quote:** We found that inactivation of the dorsal hippocampus during bouts of rearing resulted in impaired spatial memory at test. Hippocampal inactivation for matched amounts of time but delayed relative to rearing events, did not produce significant memory impairments.

**Cue A:** Compare memory outcomes when hippocampal silencing is aligned to rearing versus delayed relative to it.

**Cue B:** What happened to spatial memory when hippocampal activity was silenced during rearing versus delayed relative to it?

---

## Pair 19

**The paragraph before:** The optogenetic experimental conditions were as follows: in the main experimental condition wherein light was delivered coincidentally with rearing behavior, referred to as ’Rear’ in the results, the laser was activated as the 3D camera system detected rearing and remained on for the full duration of the rear. In the baseline ’Off ’ condition, the main power switch for the laser remained off so that no light was delivered at any point. Nonetheless, the optical fiber was attached as in the other conditions. In the control ’Delay’ condition, light was delivered in response to rearing, but both the laser activation and deactivation were triggered at a fixed 6 s delay relative to the rearing. The 6 s delay was inserted by the control software between the time when the 3D camera system detected rearing and the time when the state of the laser system was switched. Thus, importantly, the duration of light delivery in the ’Delay’ condition matched the duration of the detected rear. All rats were coupled to the fiber patch cords during all testing, irrespective of condition or cohort. The three conditions were randomized such that all conditions were run in a random order every 3 trials. Epochs of optogenetic manipulation were restricted to occur in the study phase only. Hippocampal activity was unmanipulated during the test phase when spatial memory was assessed.

**The quote's paragraph** [section: Methods: Procedures and Analysis]: Rats in the experimental group underwent two surgeries. In the first, a virus was injected into the dorsal hippocampus. In the second, an optical fiber cannula for light delivery and opsin activation was implanted. During the first surgery, rats were anesthetized with 1.5–4% isoflurane, and their head was positioned in a stereotaxic frame. The scalp was cut and retracted. Three sites were drilled above the hippocampus bilaterally. In each, viral infusions were performed at 3 different depths. Thus, a total of 18 separate 45 nl injections were done at the following coordinates: [− 3.0 AP, ±2.2 ML, 2.1, 2.3, 2.5 DV]; [− 3.7 AP,±2.9 ML, 2.0, 2.2, 2.4 DV]; and [− 4.3 AP,±3.5 ML, 2.0, 2.2, 2.4 DV]. Halorhodopsin and fluorescent reporter expression were transduced with AAV(5)-CaMKIIa-eNpHR3.0-EYFP (UNC vector core). The same AAV serotype and promoter have been used to induce opsin expression in the rat hippocampus previously45. At the end of surgery, the scalp was sutured shut, and the rat was allowed to recover for one week post surgery before continuing regular behavioral training. Rats underwent the second surgery 2–5 weeks after the first surgery. Again, rats were anesthetized with 1.5–4% isoflurane, their head was mounted in a stereotaxic frame, and the scalp was cut and retracted. Two optical fibers (MFC_200/245–0.53_5mm_MF2.5-FLT; Doric Inc) were positioned above the center injection sites from the previous surgery, at -3.7 AP, 2.9 ML, 1.8 DV, and fixed to two jewelers screws inserted into the skull with dental acrylic. The scalp was sutured closed around the implant. The control group rats underwent one combined viral injection and optical fiber implantation surgery. Only a fluorescent reporter was expressed by infusing the virus AAV(5)-CAMKIIa-EYFP (UNC vector core). One 2 μl injection into each side of the hippocampus [− 3.6 AP, ± 2.8 ML, 2.4 DV] with two optical fibers (MFC_200/245–0.53_5mm_MF2.5-FLT; Doric Inc) placed bilaterally above the injection site. Again, rats were allowed to recover for one week following surgery before restarting behavioral training. Data collection began after rats reached behavioral criterion. While previous research demonstrates that isoflurane exposure can impair spatial memory46–48 because our results are based on within animal comparisons, this cannot account for the effects observed.

**The quote:** While previous research demonstrates that isoflurane exposure can impair spatial memory46–48 because our results are based on within animal comparisons, this cannot account for the effects observed.

**Cue A:** See why a drug used during surgery, known to impair memory, cannot explain the results.

**Cue B:** Look for why an anesthesia-related drug effect could not explain the results.

---

## Pair 20

**The paragraph before:** …essed with the eight-arm delayed-win-shift task, consisting of study, delay, and test phases (Fig. 1a,b). During the study phase, four of eight arms were opened to the rat, and, in each, the rat found food rewards. In the delay phase, rats were removed from the maze for four minutes. Finally, in the test phase, rats were granted access to all eight arms but could only find rewards in the four previously unopened arms. Rats were trained on this task with one trial per day to criterion level accuracy (<3 errors in four consecutive days of testing,>80% accuracy) before and after the viral transfection and fiber cannula implantation surgeries. Viral transfection targeted the bilateral dorsal hippocampus proper and either transduced expression of halorhodopsin and fluorescent reporter (experimental group) or fluorescent reporter only (control group). Fiber optic cannula were implanted bilaterally dorsal to the viral injection (Fig. 1c,d). Three different conditions of optogenetic manipulation were examined (Fig. 1e): Off) wherein no light was delivered, used to assess baseline performance; Rear) light delivery was synchronized to rearing events, used to assess memory performance when hippocampal processing was disrupted selectively during rearing; and Delay) light delivery is delayed by six seconds relative to the onset of a rearing event, used to control for intermittent disruption of hippocampal processing during study but without synchronizing the disruptions to rearing events.

**The quote's paragraph** [section: Results]: Starting with the experimental group, comparing percent correct (Fig. 2a. left bars) at test between the ’Rear’ condition (blue bar), wherein light delivery was synchronized to rearing, and the ’Off ’ condition (grey bar), wherein no light was delivered, revealed a significant reduction to spatial memory (77.7% vs. 65.7%; GLME est.=− 11.9% [− 21.6%, − 2.3%], t(178)= − 2.44, p=0.02). The same comparison between the ’Rear’ condition and ’Off ’ condition, performed on data collected from the control group (Fig. 2a. right bars), wherein halorhodopsin was not expressed, revealed that light delivery had no significant effect on percent correct (81.4% vs. 83%; GLME est.=2.7 [− 4.1, 6.5], t(217)=0.4, p=0.66).

**The quote:** comparing percent correct (Fig. 2a. left bars) at test between the ’Rear’ condition (blue bar), wherein light delivery was synchronized to rearing, and the ’Off ’ condition (grey bar), wherein no light was delivered, revealed a significant reduction to spatial memory (77.7% vs. 65.7%; GLME est.=− 11.9% [− 21.6%, − 2.3%], t(178)= − 2.44, p=0.02).

**Cue A:** Note the drop in percent correct when light delivery is synced to rearing versus no light at all.

**Cue B:** Compare accuracy when light delivery was synchronized to rearing versus when no light was delivered.

---

## Pair 21

**The paragraph before:** Our results are consistent with the hypotheses of Lever and colleagues regarding the functions of rearing. Having reviewed the limited body of work on rearing, Lever and colleagues15 synthesized the available data with the hypothesis that ’rearing is a useful marker of environmental novelty, that the hippocampal formation is a crucial component of the system controlling rearing in novel environments, and that rearing is one of several ethological measures that can profitably be used to assess hippocampal learning and memory.’ Strong evidence was available at the time to support their hypothesis that rearing marks environmental novelty: A wide variety of mammals rear in response to environmental novelty. The hypothesized links to hippocampal function were more speculative. The data indicated that lesions of the hippocampus have inconsistent effects on rearing frequency49,50. Only indirect evidence existed to link rearing and hippocampal learning. For example, rearing covaried with performance in the Morris water maze—declining during learning and reinstating when the platform is moved, and that hippocampal lesions disrupt this pattern5,51. In contrast, the present findings strongly and directly support the hypothesis that rearing is an ethological measure of hippocampal learning.

**The quote's paragraph** [section: Discussion]: The current results also advance our understanding of the connections between rearing and hippocampal learning beyond work done on the topic by Wells et al.18 and Mun et al.19 since Lever and colleagues published their review. Wells et al. showed that increasing environmental novelty both decreases the speed modulation of hippocampal theta and increases the number of times rats reared, a result that indicated a coupling between hippocampal function and rearing behavior18. Mun et al.19 reported that the discrimination index in a novel place task (a measure of spatial memory) was positively related to rearing frequency during the initial exploration phase. Notably, this effect was specific to the novel place task, a task known to be sensitive to hippocampal integrity, and was not observed in the novel object task, a task that is generally insensitive to hippocampal integrity except at long delays52,53. Thus, rearing specifically promoted memory in a hippocampal dependent task. Neither Wells et al.18 nor Mun et al.19 tested the necessity of hippocampal activity during rearing for spatial memory. The results of our experiment are an advance over these works by showing explicitly that hippocampal activity during rearing is important for spatial memory.

**The quote:** Neither Wells et al.18 nor Mun et al.19 tested the necessity of hippocampal activity during rearing for spatial memory. The results of our experiment are an advance over these works by showing explicitly that hippocampal activity during rearing is important for spatial memory.

**Cue A:** Notice what earlier rearing studies left untested that this one supplies.

**Cue B:** What did two earlier rearing studies fail to test that this experiment did?

---

## Pair 22

**The paragraph before:** The current results also advance our understanding of the connections between rearing and hippocampal learning beyond work done on the topic by Wells et al.18 and Mun et al.19 since Lever and colleagues published their review. Wells et al. showed that increasing environmental novelty both decreases the speed modulation of hippocampal theta and increases the number of times rats reared, a result that indicated a coupling between hippocampal function and rearing behavior18. Mun et al.19 reported that the discrimination index in a novel place task (a measure of spatial memory) was positively related to rearing frequency during the initial exploration phase. Notably, this effect was specific to the novel place task, a task known to be sensitive to hippocampal integrity, and was not observed in the novel object task, a task that is generally insensitive to hippocampal integrity except at long delays52,53. Thus, rearing specifically promoted memory in a hippocampal dependent task. Neither Wells et al.18 nor Mun et al.19 tested the necessity of hippocampal activity during rearing for spatial memory. The results of our experiment are an advance over these works by showing explicitly that hippocampal activity during rearing is important for spatial memory.

**The quote's paragraph** [section: Discussion]: While the function of rearing for spatial memory is not known, prior work suggests that the inactivation we performed in the current experiment may have disrupted spatial memory by interfering with updating of an internal model of the environment. Rearing is likely a form of active environmental sampling. As it relates to spatial memory, rearing has been suggested to aid in building and updating a model of the environment15,24. Rearing frequency is increased by cue changes that elicit hippocampal remapping54. Barth et al.24 suggested, based on analyses of hippocampal field potentials and unit activity, that the hippocampus switches to a distinct functional mode during rearing. This mode, they suggest, draws on sensory information gathered during the rearing to reduce uncertainty regarding the allocentric position and to perform sensory realignment of the cognitive map24. By inactivating the hippocampus during rearing, our manipulation may have prevented this updating with downstream consequences for spatial memory.

**The quote:** Barth et al.24 suggested, based on analyses of hippocampal field potentials and unit activity, that the hippocampus switches to a distinct functional mode during rearing. This mode, they suggest, draws on sensory information gathered during the rearing to reduce uncertainty regarding the allocentric position and to perform sensory realignment of the cognitive map24.

**Cue A:** Two ideas are compared here: a distinct hippocampal mode during rearing, and what it is thought to do for the cognitive map.

**Cue B:** What distinct functional mode did Barth et al. propose the hippocampus switches into during rearing?

---

## Pair 23

**The paragraph before:** While the function of rearing for spatial memory is not known, prior work suggests that the inactivation we performed in the current experiment may have disrupted spatial memory by interfering with updating of an internal model of the environment. Rearing is likely a form of active environmental sampling. As it relates to spatial memory, rearing has been suggested to aid in building and updating a model of the environment15,24. Rearing frequency is increased by cue changes that elicit hippocampal remapping54. Barth et al.24 suggested, based on analyses of hippocampal field potentials and unit activity, that the hippocampus switches to a distinct functional mode during rearing. This mode, they suggest, draws on sensory information gathered during the rearing to reduce uncertainty regarding the allocentric position and to perform sensory realignment of the cognitive map24. By inactivating the hippocampus during rearing, our manipulation may have prevented this updating with downstream consequences for spatial memory.

**The quote's paragraph** [section: Discussion]: We note, however, that any updating that is happening in our experiment is unlikely to be de novo environmental modeling. Prior to testing, while reaching performance criterion, our rats completed dozens of trials under identical circumstances providing ample time to model the environment proper. Importantly, however, the set of arms that opened during study (and which were still baited at test) varied randomly each day. Thus, the challenge on any given day was to disambiguate current trial information from the proactive interference of prior training. For this reason, we expect that any updating being performed would be to support trial specific event memory. This resembles the ’Where did I park my car today?’ type memory, requiring disambiguation of recent events from similar prior events, that characterizes hippocampal function55. Alternatively, as noted by Lever et al., rearing may reflect updating that is driven by the change of rewards in an established, stable spatial structure a possible and likely context in which foraging behavior commonly occurs. The radial arm maze is in fact designed to model foraging behavior, where new rewards and their relation to the established external distal cues are efficiently understood not by engaging in normal horizontal ambulation but in this context by rearing. The distal cues can help disambiguate arms for which rewards have or have not yet been consumed. Indeed these results provide direct evidence for the proposal by Lever et al. 2006 that rearing may be in some contexts, more efficient than horizontal locomotion in the determination and updating of spatial information15.

**The quote:** This resembles the ’Where did I park my car today?’ type memory, requiring disambiguation of recent events from similar prior events, that characterizes hippocampal function55.

**Cue A:** What everyday memory problem does rearing's role in telling apart similar past trials resemble?

**Cue B:** Think of a familiar memory problem, like recalling where you parked today versus other days, as you read this.

---

## Pair 24

**The paragraph before:** Stress and/or cytokine signaling pathways may also contribute to resistance to tamoxifen. Laboratory²⁵ and clinical²⁶ studies suggest that elevated levels of phosphorylated jun N-terminal kinase (JNK) are associated with tamoxifen resistance, and preliminary data also implicate activated p38.²⁷ p38 is a member of the mitogen-activated protein kinase (MAPK) family that is activated by environmental stresses including ionizing radiation, heat, oxidative stress, inflammatory cytokines (tumor necrosis factor family), growth factors, and tissue ischemia.²⁸,²⁹ In endometrial cancer cells, estrogen and tamoxifen both stimulate p38 activity.³⁰ In turn, p38 signaling can phosphorylate ERα (Thr311), inhibit ER nuclear export, enhance ER’s interaction with coactivators, and increase the estrogen agonist activity of tamoxifen.³¹ These mechanisms may well be important for tamoxifen resistance in clinical breast cancer.

**The quote's paragraph** [section: INTRODUCTION]: A major hindrance to the identification of molecular pathways involved in tamoxifen resistance in patients is the difficulty of obtaining paired tumor tissues for biomarker studies immediately before treatment and again at the time that resistance develops. Although local recurrence is not uncommon, most patients with breast cancer recur in bone or in visceral organs, which are relatively inaccessible for biopsy. Furthermore, the majority of patients with breast cancer today never suffer recurrence, and others do so only after tamoxifen adjuvant therapy has been completed. In our study we present the results of an analysis of such paired breast cancer specimens from 39 patients receiving tamoxifen adjuvant therapy. We also report data from a xenograft model of acquired tamoxifen resistance that, together with the clinical data, suggest a potential role for p38 signaling in addition to HER-2 in the development of resistance.

**The quote:** A major hindrance to the identification of molecular pathways involved in tamoxifen resistance in patients is the difficulty of obtaining paired tumor tissues for biomarker studies immediately before treatment and again at the time that resistance develops.

**Cue A:** What kind of tissue is hard to obtain, and why does that limit this research?

**Cue B:** What kind of tissue sample is described as hard to obtain for studying tamoxifen resistance?

---

## Pair 25

**The paragraph before:** Every reductionist has his favorite analogy from modern science. It is most unlikely that any of these unrelated examples of successful reduction will shed light on the relation of mind to brain. But philosophers share the general human weakness for explanations of what is incomprehensible in terms suited for what is familiar and well understood, though entirely different. This has led to the acceptance of implausible accounts of the mental largely because they would permit familiar kinds of reduction. I shall try to explain why the usual examples do not help us to understand the relation between mind and body—why, indeed, we have at present no conception of what an explanation of the physical nature of a mental phenomenon would be. Without consciousness the mind-body problem would be much less interesting. With consciousness it seems hopeless. The most important and characteristic feature of conscious mental phenomena is very poorly understood. Most reductionist theories do not even try to explain it. And careful examination will show that no currently available concept of reduction is applicable to it. Perhaps a new theoretical form can be devised for the purpose, but such a solution, if it exists, lies in the distant intellectual future.

**The quote's paragraph** [section: The unique difficulty of consciousness]: Conscious experience is a widespread phenomenon. It occurs at many levels of animal life, though we cannot be sure of its presence in the simpler organisms, and it is very difficult to say in general what provides evidence of it. (Some extremists have been prepared to deny it even of mammals other than man.) No doubt it occurs in countless forms totally unimaginable to us, on other planets in other solar systems throughout the universe. But no matter how the form may vary, the fact that an organism has conscious experience at all means, basically, that there is something it is like to be that organism. There may be further implications about the form of the experience; there may even (though I doubt it) be implications about the behavior of the organism. But fundamentally an organism has conscious mental states if and only if there is something that it is like to be that organism—something it is like for the organism.

**The quote:** But no matter how the form may vary, the fact that an organism has conscious experience at all means, basically, that there is something it is like to be that organism.

**Cue A:** Notice how this passage defines what makes an organism conscious at all.

**Cue B:** Notice what having experience at all is said to require, from the inside.

---

## Pair 26

**The paragraph before:** I assume we all believe that bats have experience. After all, they are mammals, and there is no more doubt that they have experience than that mice or pigeons or whales have experience. I have chosen bats instead of wasps or flounders because if one travels too far down the phylogenetic tree, people gradually shed their faith that there is experience there at all. Bats, although more closely related to us than those other species, nevertheless present a range of activity and a sensory apparatus so different from ours that the problem I want to pose is exceptionally vivid (though it certainly could be raised with other species). Even without the benefit of philosophical reflection, anyone who has spent some time in an enclosed space with an excited bat knows what it is to encounter a fundamentally alien form of life.

**The quote's paragraph** [section: What Is It Like to Be a Bat?]: I have said that the essence of the belief that bats have experience is that there is something that it is like to be a bat. Now we know that most bats (the microchiroptera, to be precise) perceive the external world primarily by sonar, or echolocation, detecting the reflections, from objects within range, of their own rapid, subtly modulated, high-frequency shrieks. Their brains are designed to correlate the outgoing impulses with the subsequent echoes, and the information thus acquired enables bats to make precise discriminations of distance, size, shape, motion, and texture comparable to those we make by vision. But bat sonar, though clearly a form of perception, is not similar in its operation to any sense that we possess, and there is no reason to suppose that it is subjectively like anything we can experience or imagine. This appears to create difficulties for the notion of what it is like to be a bat. We must consider whether any method will permit us to extrapolate to the inner life of the bat from our own case,⁵ and if not, what alternative methods there may be for understanding the notion.

**The quote:** But bat sonar, though clearly a form of perception, is not similar in its operation to any sense that we possess, and there is no reason to suppose that it is subjectively like anything we can experience or imagine.

**Cue A:** Notice what makes this creature's form of perception different from any sense we have.

**Cue B:** Consider why one particular sense is said to be unlike anything we possess.

---

## Pair 27

**The paragraph before:** So if extrapolation from our own case is involved in the idea of what it is like to be a bat, the extrapolation must be incompletable. We cannot form more than a schematic conception of what it is like. For example, we may ascribe general types of experience on the basis of the animal’s structure and behavior. Thus we describe bat sonar as a form of three-dimensional forward perception; we believe that bats feel some versions of pain, fear, hunger, and lust, and that they have other, more familiar types of perception besides sonar. But we believe that these experiences also have in each case a specific subjective character, which it is beyond our ability to conceive. And if there is conscious life elsewhere in the universe, it is likely that some of it will not be describable even in the most general experiential terms available to us.⁶ (The problem is not confined to exotic cases, however, for it exists between one person and another. The subjective character of the experience of a person deaf and blind from birth is not accessible to me, for example, nor presumably is mine to him. This does not prevent us each from believing that the other's experience has such a subjective character.)

**The quote's paragraph** [section: Facts beyond human concepts]: If anyone is inclined to deny that we can believe in the existence of facts like this whose exact nature we cannot possibly conceive, he should reflect that in contemplating the bats we are in much the same position that intelligent bats or Martians⁷ would occupy if they tried to form a conception of what it was like to be us. The structure of their own minds might make it impossible for them to succeed, but we know they would be wrong to conclude that there is not anything precise that it is like to be us: that only certain general types of mental state could be ascribed to us (perhaps perception and appetite would be concepts common to us both; perhaps not). We know they would be wrong to draw such a skeptical conclusion because we know what it is like to be us. And we know that while it includes an enormous amount of variation and complexity, and while we do not possess the vocabulary to describe it adequately, its subjective charater is highly specific, and in some respects describable in terms that can be understood only by creatures like us. The fact that we cannot expect ever to accommodate in our language a detailed description of Martian or bat phenomenology should not lead us to dismiss as meaningless the claim that bats and Martians have experiences fully comparable in richness of detail to our own. It would be fine if someone were to develop concepts and a theory that enabled us to think about those things; but such an understanding may be permanently denied to us by the limits of our nature. And to deny the reality or logical significance of what we can never describe or understand is the crudest form of cognitive dissonance.

**The quote:** The fact that we cannot expect ever to accommodate in our language a detailed description of Martian or bat phenomenology should not lead us to dismiss as meaningless the claim that bats and Martians have experiences fully comparable in richness of detail to our own.

**Cue A:** Ask whether a fact can be real even though we could never put it into words.

**Cue B:** Can a claim be meaningful even if we could never put its details into words? See what is argued here.

---

## Pair 28

**The paragraph before:** I shall not pursue this subject, however. Its bearing on the topic before us (namely, the mind-body problem) is that it enables us to make a general observation about the subjective character of experience. Whatever may be the status of facts about what it is like to be a human being, or a bat, or a Martian, these appear to be facts that embody a particular point of view.

**The quote's paragraph** [section: Point of view and objectivity]: I am not adverting here to the alleged privacy of experience to its possessor. The point of view in question is not one accessible only to a single individual. Rather it is a type. It is often possible to take up a point of view other than one's own, so the comprehension of such facts is not limited to one's own case. There is a sense in which phenomenological facts are perfectly objective: one person can know or say of another what the quality of the other's experience is. They are subjective, however, in the sense that even this objective ascription of experience is possible only for someone sufficiently similar to the object of ascription to be able to adopt his point of view—to understand the ascription in the first person as well as in the third, so to speak. The more different from oneself the other experiencer is, the less success one can expect with this enterprise. In our own case we occupy the relevant point of view, but we will have as much difficulty understanding our own experience properly if we approach it from another point of view as we would if we tried to understand the experience of another species without taking up its point of view.⁸

**The quote:** They are subjective, however, in the sense that even this objective ascription of experience is possible only for someone sufficiently similar to the object of ascription to be able to adopt his point of view—to understand the ascription in the first person as well as in the third, so to speak.

**Cue A:** What does it take to ascribe an experience to another, even objectively? See the condition given.

**Cue B:** Look for what kind of similarity is required before one creature can understand another's experience firsthand.

---

## Pair 29

**The paragraph before:** This is not by itself an argument against reduction. A Martian scientist with no understanding of visual perception could understand the rainbow, or lightning, or clouds as physical phenomena, though he would never be able to understand the human concepts of rainbow, lightning, or cloud, or the place these things occupy in our phenomenal world. The objective nature of the things picked out by these concepts could be apprehended by him because, although the concepts themselves are connected with a particular point of view and a particular visual phenomenology, the things apprehended from that point of view are not: they are observable from the point of view but external to it; hence they can be comprehended from other points of view also, either by the same organisms or by others. Lightning has an objective character that is not exhausted by its visual appearance, and this can be investigated by a Martian without vision. To be precise, it has a more objective character than is revealed in its visual appearance. In speaking of the move from subjective to objective characterization, I wish to remain noncommittal about the existence of an end point, the completely objective intrinsic nature of the thing, which one might or might not be able to reach. It may be more accurate to think of objectivity as a direction in which the understanding can travel. And in understanding a phenomenon like lightning, it is legitimate to go as far away as one can from a strictly human viewpoint.⁹

**The quote's paragraph** [section: Objectivity moves away from experience]: In the case of experience, on the other hand, the connection with a particular point of view seems much closer. It is difficult to understand what could be meant by the objective character of an experience, apart from the particular point of view from which its subject apprehends it. After all, what would be left of what it was like to be a bat if one removed the viewpoint of the bat? But if experience does not have, in addition to its subjective character, an objective nature that can be apprehended from many different points of view, then how can it be supposed that a Martian investigating my brain might be observing physical processes which were my mental processes (as he might observe physical processes which were bolts of lightning), only from a different point of view? How, for that matter, could a human physiologist observe them from another point of view?¹⁰

**The quote:** After all, what would be left of what it was like to be a bat if one removed the viewpoint of the bat?

**Cue A:** Ask what would be left of a bat's experience once its own viewpoint is subtracted.

**Cue B:** Ask what would remain of a bat's experience if its own viewpoint were taken away.

---

## Pair 30

**The paragraph before:** In a sense, the seeds of this objection to the reducibility of experience are already detectable in successful cases of reduction; for in discovering sound to be, in reality, a wave phenomenon in air or other media, we leave behind one viewpoint to take up another, and the auditory, human or animal viewpoint that we leave behind remains unreduced. Members of radically different species may both understand the same physical events in objective terms, and this does not require that they understand the phenomenal forms in which those events appear to the senses of members of the other species. Thus it is a condition of their referring to a common reality that their more particular viewpoints are not part of the common reality that they both apprehend. The reduction can succeed only if the species-specific viewpoint is omitted from what is to be reduced.

**The quote's paragraph** [section: Objectivity moves away from experience]: But while we are right to leave this point of view aside in seeking a fuller understanding of the external world, we cannot ignore it permanently, since it is the essence of the internal world, and not merely a point of view on it. Most of the neobehaviorism of recent philosophical psychology results from the effort to substitute an objective concept of mind for the real thing, in order to have nothing left over which cannot be reduced. If we acknowledge that a physical theory of mind must account for the subjective character of experience, we must admit that no presently available conception gives us a clue how this could be done. The problem is unique. If mental processes are indeed physical processes, then there is something it is like, intrinsically,¹¹ to undergo certain physical processes. What it is for such a thing to be the case remains a mystery.

**The quote:** But while we are right to leave this point of view aside in seeking a fuller understanding of the external world, we cannot ignore it permanently, since it is the essence of the internal world, and not merely a point of view on it.

**Cue A:** Notice the distinction drawn between a viewpoint on the external world and the viewpoint that makes up an inner one.

**Cue B:** Notice why a point of view cannot simply be set aside forever when studying the inner world.

---

## Pair 31

**The paragraph before:** Man is the noblest work of God; was made by design, and for a specific purpose. All his various powers are adapted to certain relations of life and conditions of things, and education is only complete when every faculty of the mind and function of the body are actively developed and devoted to a good end.

**The quote's paragraph** [section: Business, Vocation, and Conclusion]: Many men have been persecuted, imprisoned, and burned at the stake for advocating views that are now popular, so that no one need be discouraged if their own peculiar views are disbelieved by the mass, for if they are founded in nature, they will ultimately prevail. Perfection depends upon a full development, legitimate use, and right direction of the whole mind, the superior part taking the lead. Let us not forget that whatever may be our circumstances, it is “the mind that makes the man.” It should be the aim of us all to arrive as near perfection as possible, for the more disciplined and developed we are in this life, the better shall we be prepared for our eternal existence.

**The quote:** Let us not forget that whatever may be our circumstances, it is “the mind that makes the man.”

**Cue A:** Notice what is named as the true source of a person's worth, whatever their situation.

**Cue B:** Notice what final claim is made about what truly makes a person.

---

## Pair 32

**The paragraph before:** A child, who attended a public school in New York, was sent into a dark closet for a punishment. She had large Cautiousness, was very nervous ; and the teacher said to her, “I don’t know what there may be in that closet, but I think you will not behave badly again.” The child was frightened almost out of its senses, and might have been ruined for life by the fright. Some parents encourage the fears of their children by allowing the light to burn in the room at night, and run to them in haste if they chance to awaken, as though there was great danger. It requires judgment on the part of the parent to know just the right course to pursue. It is a principle of mind that an active organ in one person excites the same organ in another. Many are not aware of this, and give vent to the faculty they wish to check in their children. A very solicitous mother wanted me to tell her how to manage her unruly boy. My reply was, “manage yourself.” On inquiry, I found that both father and mother smoked, chewed tobacco, drank spirits, and quarrelled with each other ; and both exercised their temper upon the boy by beating him every day, and then thought it very singular that their boy should have such a bad temper. Many feed their children with exciting, stimulating, and highly-concentrated food, and they are surprised that their children are not quiet and good-natured.

**The quote's paragraph** [section: Phrenology in Domestic and Educational Life]: If the parent found Destructiveness very large in the head of the child, before it had shown passion, he would know that it would not be well to use force or coercion in its government, and that its temper should be quieted rather than the opposite. A clergyman in Bennington, Vermont, who had heard me lecture on this subject, invited me to visit him. I did so ; and saw his son Henry at his home. He was then a young man ; but the father related to me the following anecdote about his son, which occurred when he was a little child. His mother put him to bed one night ; but before he was fairly asleep, the rats began to run between the floor and the ceiling of the room below, and made a great noise. Henry was aroused, and thought the rats were after him. Being frightened he cried very loud, and his mother in vain tried to pacify him ; but she was obliged to take him up and get him to sleep in her arms. When the father came home, she told him what a time she had with Henry. “I will try my hand with him to-morrow night,” replied her husband. When the next night came, the father took Henry to bed ; but as soon as it was quiet, the rats began to run and Henry to cry. The father attempted to quiet his fears, but he clung to him with such a nervous grasp, that the father thought he must try another expedient ; so he told Henry to lie still for a few moments alone, when he would return to him. He soon brought a large stick, and said pleasantly to his son, “Harry, I would not be bothered every night with these rats, take this stick and beat them away.” Henry’s hair stood on ends, his heart was in his throat, and he hardly dared to stir ; but seeing his father strike the floor with it, he summoned courage, and taking the stick he pounded on the wall, crying, “Go away, old rats, and do not trouble me any more !” It was now the turn of the rats to be frightened, and run off. The father then said, “You see, Harry, the rats are afraid of you ; keep that stick on your bed, and every time the rats come, do you get up and drive them away.” Reason and expostulations would have been useless, but this little experiment balanced his Cautiousness, so that from that night his parents had no further trouble with him ; and Henry confirmed the statement of his father, and said he should never forget his terror for a few nights.

**The quote:** Reason and expostulations would have been useless, but this little experiment balanced his Cautiousness, so that from that night his parents had no further trouble with him

**Cue A:** An experiment is used to calm a child's fearfulness. Notice what effect it is said to have had.

**Cue B:** See what method is used to settle a child's temperament before trouble starts.

---

## Pair 33

**The paragraph before:** A father wished me to examine his son’s head. I told him that the power of the brain was in the superior, coronal part, and that he was much inclined to think and study ; that he should be out more in the open air, and have active exercise rather than close confinement, so that his bodily functions might be strengthened—his physical and mental organizations balanced. The father accordingly sent his son into the country, made him lay aside his books for awhile, and in a few years he became a fine, healthy lad, and then had physical stamina enough to sustain severe mental exertions.

**The quote's paragraph** [section: Phrenology in Domestic and Educational Life]: I visited a school where there was a young girl, 13 years of age, with a large brain and feeble body. She was the winner of all the prizes, from young ladies of her own age to 16 and 17 years of age. I told her parents, if they would save her life, to take her from school for one or two years. She pleaded with tears to remain at her studies, for she was very fond of her school ; but finally, when she heard that the only alternative was to do this or die, she submitted. In a few years she became a blooming young lady, and then pursued the studies more fitted for her years. Precocity is interesting to parents, but not to the physiologist. A mother in Natchez, Miss., went into the room where her little boy and a small coloured boy had been playing. She saw a pillow on the fire burning, and said to the slave boy, “Dick, who did this ?” “I didn’t, missus.” “Who did it ?” Dick looked at her son, but did not dare to say that it was John. The mother in anger said, “John, did you throw the pillow on the fire ?” John made no reply. The mother shook him, and said, “Tell me, or I will punish you severely.” Finally, John cried out sulkily, “I didn’t know it would burn !”

**The quote:** Precocity is interesting to parents, but not to the physiologist.

**Cue A:** Notice the contrast drawn between a parent's view of early brilliance and a physiologist's view.

**Cue B:** Notice whose view of early intellectual brilliance in children differs from the parents'.

---

## Pair 34

**The paragraph before:** …d by the moral faculties in the former case, and hence we see only the perversion of faculties which are good when their legitimate action is developed. Suppose we accumulate property for our wants, and to facilitate rational enjoyment, we shall give a proper exercise to Acquisitiveness, but if the faculty becomes morbid and craves what does not belong to us, we shall not sufficiently respect the rights of others, and then this faculty will be perverted. Mr. Hudson, “the Railroad King,” was at first a reputable tailor. Not satisfied with this calling he commenced business for himself, and becoming suddenly pious, he prayed over the dying moments of a sick man, who left him several thousand pounds which ought to have gone to the widow, who was thus reduced to want. The “King” invested this money in a railroad, and then commenced his speculations, and so great were they, that he had only to express an opinion in a particular branch, when lo ! stocks went up or down as the case might be. He would buy into a poor road, others hearing of it thought it must be good property, and rushed to the purchase ; when the stock was high, through his officials he would sell out and buy again. By-and-by so many were ruined by his unscrupulous schemes that he gradually lost his power, and now in disgrace is obliged to wander in a foreign land. If Conscientious- ness had been larger, or Acquisitiveness smaller, he might have excelled as a business man, and been a distinguished member of society.

**The quote's paragraph** [section: Everyday Applications of Phrenology]: Legislators and judges might be greatly benefited by a knowledge of Phrenology. No one at this day will deny that there is a greater accountability in some actions than in others; that there are degrees of crime and guilt; that some are not a law to themselves, for their tendencies to commit crimes are almost uncontrollable. I wish to impress the idea that Phrenology is not responsible for these shortcomings in individuals. It only points out the fact and gives the remedy. There are others who can control their propensities and are a restraint to themselves. I have again and again selected in prison the criminal convicted of particular crimes by the form of the head. There was a lad, about fourteen years of age, convicted of the crime of murdering his father in the State of New York, a number of years since. Mr. Seward was Governor of the State at the time, and when he saw that the boy had an idiotic head, with no reasoning faculties, but strong propensities, said he would not be guilty of his death without seeing more of the boy, so he took him to his own house to spend a few days, in order that he could watch his movements. He thereby became convinced that the boy was idiotic, and he declared that, believing in Phrenology, he would not hang a boy with an idiotic brain, so the lad was sent to prison for life. A few years after that time, not knowing the above circumstances, I visited Auburn States Prison, one of the largest in America. The warden brought a number of convicts into the room for me to examine their heads. Among them I pointed out one, of whom I said, “that if that young man had been convicted of a capital crime he was not responsible for it, because he had neither the moral nor the intellectual faculties, but that he should be restrained, to prevent his injuring any one, for his Destructiveness was immensely large.” Then I was informed who the young man was. It was better for society that he should not have his liberty, because he could not control his own actions, and he was treated very kindly in prison.

**The quote:** It only points out the fact and gives the remedy.

**Cue A:** Notice what two things phrenology is said to offer regarding a person's fault.

**Cue B:** Phrenology's role in judging wrongdoing is under discussion. Notice what it is said to do, short of assigning blame.

---

## Pair 35

**The paragraph before:** Some persons commence work with a feeble mind, and they do not succeed because their mental qualifications are very inferior. A young man, with a very feeble mind could not take care of his own property, because he did not know the value of money, and was obliged to have a guardian. By early discipline he, perhaps, could have succeeded better than he did, but his life would have been a failure whatever he might have attempted.

**The quote's paragraph** [section: Business, Vocation, and Conclusion]: Many individuals commence a business for which they have not the natural qualifications. They have neither the talents to plan their work, nor to comprehend the plans of others, and hence their labours result in imperfection.

**The quote:** Many individuals commence a business for which they have not the natural qualifications.

**Cue A:** Notice what mismatch is blamed when people take up a particular line of work.

**Cue B:** Notice what mismatch is blamed when people choose a line of work.

---

## Pair 36

**The paragraph before:** Hard labour without good plans fails to produce satisfactory results. Many men work very hard, but they have no settled purpose in life, only to drudge on from day to day in a kind of routine, without interest in what they do or accomplish. They hardly know why they toil, but work as necessity presses upon them. Some can form schemes or lay plans for others to carry out; they can sit in their office, and with brain-labour furnish employment for 300 men. They have the natural organization to do this, and are much better qualified for such a position than to go into the fields to labour, or into the quarries to dig stone. Should they attempt either of the latter employments, they would fail in their efforts.

**The quote's paragraph** [section: Business, Vocation, and Conclusion]: Some can succeed in business simply because they can manage to invest what they make profitably. Others may toil as hard and even more diligently, but they expend as fast as they make, and sometimes their expenses are beyond their incomes. Some live faster than they can generate vitality, and the consequence is that they early break down in health and strength. Some will overwork in one day, and exhaust their vital forces, so that they cannot do anything on the succeeding day. None need be surprised at the ultimate failure of such persons to accomplish much in life.

**The quote:** None need be surprised at the ultimate failure of such persons to accomplish much in life.

**Cue A:** Notice what outcome is said to be unsurprising for the people just described.

**Cue B:** People who work hard without good plans are meant here. Notice what is said of their eventual success.

---

## Pair 37

**The paragraph before:** Hear no till you hear yes.

**The quote's paragraph** [section: Finding and Reading Investors]: Treat investors as saying no till they unequivocally say yes, in the form of a definite offer with no contingencies.

**The quote:** Treat investors as saying no till they unequivocally say yes, in the form of a definite offer with no contingencies.

**Cue A:** What should count as a real yes from an investor, as opposed to friendly words?

**Cue B:** A reply from an investor could mean yes or could mean nothing. Notice the one thing that counts as a real yes.

---

## Pair 38

**The paragraph before:** Close committed money.

**The quote's paragraph** [section: Closing Committed Money]: It's not a deal till the money's in the bank. I often hear inexperienced founders say things like "We've raised $800,000," only to discover that zero of it is in the bank so far. Remember the twin fears that torment investors? The fear of missing out that makes them jump early, and the fear of jumping onto a turd that results? This is a market where people are exceptionally prone to buyer's remorse. And it's also one that furnishes them plenty of excuses to gratify it. The public markets snap startup investing around like a whip. If the Chinese economy blows up tomorrow, all bets are off. But there are lots of surprises for individual startups too, and they tend to be concentrated around fundraising. Tomorrow a big competitor could appear, or you could get C&Ded, or your cofounder could quit.

**The quote:** It's not a deal till the money's in the bank.

**Cue A:** Notice what this says counts as a deal actually being done.

**Cue B:** What is the only moment at which a fundraising deal should count as real?

---

## Pair 39

**The paragraph before:** Since there are no longer leads, why do investors use that term? Because it's a more legitimate-sounding way of saying what they really mean. All they really mean is that their interest in you is a function of other investors' interest in you. I.e. the spectral signature of all mediocre investors. But when phrased in terms of leads, it sounds like there is something structural and therefore legitimate about their behavior.

**The quote's paragraph** [section: Closing Committed Money]: When an investor tells you "I want to invest in you, but I don't lead," translate that in your mind to "No, except yes if you turn out to be a hot deal." And since that's the default opinion of any investor about any startup, they've essentially just told you nothing.

**The quote:** When an investor tells you "I want to invest in you, but I don't lead," translate that in your mind to "No, except yes if you turn out to be a hot deal." And since that's the default opinion of any investor about any startup, they've essentially just told you nothing.

**Cue A:** Translate what an investor really means when they say they will not lead a round.

**Cue B:** An investor says they want in but will not lead. What should a founder actually hear in that?

---

## Pair 40

**The paragraph before:** I'm not saying you should lie, but that you should lower your expectations initially. There is almost no downside in starting with a low number. It not only won't cap the amount you raise, but will on the whole tend to increase it.

**The quote's paragraph** [section: Planning Your Raise]: A good metaphor here is angle of attack. If you try to fly at too steep an angle of attack, you just stall. If you say right out of the gate that you want to raise a $5 million series A round, unless you're in a very strong position, you not only won't get that but won't get anything. Better to start at a low angle of attack, build up speed, and then gradually increase the angle if you want.

**The quote:** A good metaphor here is angle of attack. If you try to fly at too steep an angle of attack, you just stall.

**Cue A:** What flying image do they use to describe the risk of asking for too much too fast?

**Cue B:** What happens to a plane that climbs too steeply? See what that is meant to illustrate about asking for too much.

---

## Pair 41

**The paragraph before:** The Matrix

**The quote's paragraph** [section: A universal conspiracy]: have such resonance. Every kid grows up in a fake world. In a way it would be easier if the forces behind it were as clearly differentiated as a bunch of evil machines, and one could make a clean break just by taking a pill.

**The quote:** Every kid grows up in a fake world. In a way it would be easier if the forces behind it were as clearly differentiated as a bunch of evil machines, and one could make a clean break just by taking a pill.

**Cue A:** Picture the fictional clean break of taking a pill versus how messy waking up to the real world actually is.

**Cue B:** Consider why escaping a childhood's fake world is harder than the author wishes it were.

---

## Pair 42

**The paragraph before:** The main purpose of suburbia is to provide a protected environment for children to grow up in. And it seems great for 10 year olds. I liked living in suburbia when I was 10. I didn't notice how sterile it was. My whole world was no bigger than a few friends' houses I bicycled to and some woods I ran around in. On a log scale I was midway between crib and globe. A suburban street was just the right size. But as I grew older, suburbia started to feel suffocatingly fake.

**The quote's paragraph** [section: Protection]: Life can be pretty good at 10 or 20, but it's often frustrating at 15. This is too big a problem to solve here, but certainly one reason life sucks at 15 is that kids are trapped in a world designed for 10 year olds.

**The quote:** Life can be pretty good at 10 or 20, but it's often frustrating at 15. This is too big a problem to solve here, but certainly one reason life sucks at 15 is that kids are trapped in a world designed for 10 year olds.

**Cue A:** Think about why a world built for young children might stop working so well a few years later.

**Cue B:** Ask why a world built for one age might stop working so well a few years later.

---

## Pair 43

**The paragraph before:** Really? When a man runs off with his secretary, is it always partly his wife's fault? But I can see why Mayle might have said this. Maybe it's more important for kids to respect their parents than to know the truth about them.

**The quote's paragraph** [section: Authority]: But because adults conceal their flaws, and at the same time insist on high standards of behavior for kids, a lot of kids grow up feeling they fall hopelessly short. They walk around feeling horribly evil for having used a swearword, while in fact most of the adults around them are doing much worse things.

**The quote:** But because adults conceal their flaws, and at the same time insist on high standards of behavior for kids, a lot of kids grow up feeling they fall hopelessly short.

**Cue A:** Notice what effect hiding adult flaws while demanding good behavior has on kids.

**Cue B:** Consider what happens when adults hide their own flaws while demanding high standards from kids.

---

## Pair 44

**The paragraph before:** The famous scientists I remember were Einstein, Marie Curie, and George Washington Carver. Einstein was a big deal because his work led to the atom bomb. Marie Curie was involved with X-rays. But I was mystified about Carver. He seemed to have done stuff with peanuts.

**The quote's paragraph** [section: School]: It's obvious now that he was on the list because he was black (and for that matter that Marie Curie was on it because she was a woman), but as a kid I was confused for years about him. I wonder if it wouldn't have been better just to tell us the truth: that there weren't any famous black scientists. Ranking George Washington Carver with Einstein misled us not only about science, but about the obstacles blacks faced in his time.

**The quote:** It's obvious now that he was on the list because he was black (and for that matter that Marie Curie was on it because she was a woman), but as a kid I was confused for years about him. I wonder if it wouldn't have been better just to tell us the truth: that there weren't any famous black scientists.

**Cue A:** A school curriculum once listed famous scientists including one included for his race. See what the author wishes had been said instead.

**Cue B:** Ask whether a comforting fiction in a school lesson actually served the child better than a plain truth would have.

---

## Pair 45

**The paragraph before:** As an investigator of the human mind, he founded psychometrics and differential psychology, as well as the lexical hypothesis of personality. He devised a method for classifying fingerprints that proved useful in forensic science. He also conducted research on the power of prayer, concluding it had none due to its null effects on the longevity of those prayed for.[7] His quest for the scientific principles of diverse phenomena extended even to the optimal method for making tea.[8] As the initiator of scientific meteorology, he devised the first weather map, proposed a theory of anticyclones, and was the first to establish a complete record of short-term climatic phenomena on a European scale.[9] He also invented the Galton whistle for testing differential hearing ability.[10] Galton was knighted in 1909 for his contributions to science.[11] He was Charles Darwin's half-cousin.[12]

**The quote's paragraph** [section: Introduction]: He has received significant criticism for being a proponent of social Darwinism, eugenics, and biological racism; indeed he was a pioneer of eugenics, coining the term itself in 1883.[13][14] Galton is credited with popularizing the phrase "nature versus nurture" to frame the academic discussion regarding the relative influence of heredity and environment on human ability and social advancement.[15]

**The quote:** He has received significant criticism for being a proponent of social Darwinism, eugenics, and biological racism; indeed he was a pioneer of eugenics, coining the term itself in 1883.

**Cue A:** Notice which doctrines he is criticized for being a proponent of, and what term he coined.

**Cue B:** Notice the specific accusations levelled at him, and the term he is credited with coining.

---

## Pair 46

**The paragraph before:** Galton was interested at first in the question of whether human ability was hereditary, and proposed to count the number of the relatives of various degrees of eminent men.[30] If the qualities were hereditary, he reasoned, there should be more eminent men among the relatives than among the general population. To test this, he invented the methods of historiometry. Galton obtained extensive data from a broad range of biographical sources which he tabulated and compared in various ways. This pioneering work was described in detail in his book Hereditary Genius in 1869.[6] Here he showed, among other things, that the numbers of eminent relatives dropped off when going from the first degree to the second degree relatives, and from the second degree to the third. He took this as evidence of the inheritance of abilities.

**The quote's paragraph** [section: Career]: Galton recognised the limitations of his methods in these two works, and believed the question could be better studied by comparisons of twins. His method envisaged testing to see if twins who were similar at birth diverged in dissimilar environments, and whether twins dissimilar at birth converged when reared in similar environments. He again used the method of questionnaires to gather various sorts of data, which were tabulated and described in a paper The history of twins in 1875. In so doing he anticipated the modern field of behaviour genetics, which relies heavily on twin studies. He concluded that the evidence favoured nature rather than nurture. He also proposed adoption studies, including trans-racial adoption studies, to separate the effects of heredity and environment.

**The quote:** He concluded that the evidence favoured nature rather than nurture. He also proposed adoption studies, including trans-racial adoption studies, to separate the effects of heredity and environment.

**Cue A:** See which side, nature or nurture, he judged the evidence favoured, and what kind of studies he proposed to test it.

**Cue B:** Heredity or upbringing: which did he conclude mattered more, and what method did he propose to test it?

---

## Pair 47

**The paragraph before:** — Galton 1883, pp. 24–25

**The quote's paragraph** [section: Career]: He believed that a scheme of 'marks' for family merit should be defined, and early marriage between families of high rank be encouraged via provision of monetary incentives. He pointed out some of the tendencies in British society, such as the late marriages of eminent people, and the paucity of their children, which he thought were dysgenic. He advocated encouraging eugenic marriages by supplying able couples with incentives to have children. On 29 October 1901, Galton chose to address eugenic issues when he delivered the second Huxley lecture at the Royal Anthropological Institute.[27]

**The quote:** He believed that a scheme of 'marks' for family merit should be defined, and early marriage between families of high rank be encouraged via provision of monetary incentives.

**Cue A:** Look for the concrete scheme he proposed to encourage reproduction among the favoured.

**Cue B:** Notice what kind of scheme he proposed for ranking families and encouraging marriages between them.

---

## Pair 48

**The paragraph before:** — Darwin 1871, pp. 502–503

**The quote's paragraph** [section: Career]: Galton explicitly rejected the idea of the inheritance of acquired characteristics (Lamarckism), and was an early proponent of "hard heredity"[43] through selection alone. He came close to rediscovering Mendel's particulate theory of inheritance, but was prevented from making the final breakthrough in this regard because of his focus on continuous, rather than discrete, traits (now regarded as polygenic traits). He went on to found the biometric approach to the study of heredity, distinguished by its use of statistical techniques to study continuous traits and population-scale aspects of heredity.

**The quote:** He came close to rediscovering Mendel's particulate theory of inheritance, but was prevented from making the final breakthrough in this regard because of his focus on continuous, rather than discrete, traits (now regarded as polygenic traits).

**Cue A:** Note what kept him from anticipating a discrete, particle-based theory of inheritance.

**Cue B:** Notice what kind of trait, continuous rather than discrete, kept him from reaching Mendel's theory.

---

## Pair 49

**The paragraph before:** Galton went beyond measurement and summary to attempt to explain the phenomena he observed. Among such developments, he proposed an early theory of ranges of sound and hearing, and collected large quantities of anthropometric data from the public through his popular and long-running Anthropometric Laboratory, which he established in 1884, and where he studied over 9,000 people.[27] It was not until 1985 that these data were analysed in their entirety.

**The quote's paragraph** [section: Statistical innovation and psychological theory]: He made a beauty map of Britain, based on a secret grading of the local women on a scale from attractive to repulsive. The lowest point was in Aberdeen.[64]

**The quote:** He made a beauty map of Britain, based on a secret grading of the local women on a scale from attractive to repulsive. The lowest point was in Aberdeen.

**Cue A:** Notice the method he used to grade women across Britain, and where the lowest score fell.

**Cue B:** See what unlikely survey he carried out across Britain, and which city came out worst.

---

## Pair 50

**The paragraph before:** This work began in the 1880s while the Jewish scholar Joseph Jacobs studied anthropology and statistics with Francis Galton. Jacobs asked Galton to create a composite photograph of a Jewish type.[67] One of Jacobs' first publications that used Galton's composite imagery was "The Jewish Type, and Galton's Composite Photographs", Photographic News, 29, (24 April 1885): 268–269.

**The quote's paragraph** [section: Statistical innovation and psychological theory]: Galton hoped his technique would aid medical diagnosis, and even criminology through the identification of typical criminal faces. However, his technique did not prove useful and fell into disuse, although after much work on it including by photographers Lewis Hine, John L. Lovell and Arthur Batut.

**The quote:** Galton hoped his technique would aid medical diagnosis, and even criminology through the identification of typical criminal faces. However, his technique did not prove useful and fell into disuse

**Cue A:** Notice the two practical uses he hoped his photographic technique might serve, and how it actually fared.

**Cue B:** Look for the two practical uses he hoped his blended-photo technique would serve, and how it actually fared.

---

## Pair 51

**The paragraph before:** The flowering plant genus Galtonia was named after Galton.

**The quote's paragraph** [section: Awards and influence]: University College London has in the twenty-first century been involved in a historical inquiry into its role as the institutional birthplace of eugenics. Galton established a laboratory at UCL in 1904. Some students and staff have called on the university to rename its Galton lecture theatre, with journalist Angela Saini stating, "Galton's seductive promise was of a bold new world filled only with beautiful, intelligent, productive people. The scientists in its thrall claimed this could be achieved by controlling reproduction, policing borders to prevent certain types of immigrants, and locking away "undesirables", including disabled people."[90]

**The quote:** Galton established a laboratory at UCL in 1904. Some students and staff have called on the university to rename its Galton lecture theatre

**Cue A:** Notice what request students and staff have made about a lecture theatre bearing his name.

**Cue B:** Look for what a university named after him in 1904, and who later objected to it.

---

## Pair 52

**The paragraph before:** Galton produced over 340 papers and books. He also developed the statistical concept of correlation and widely promoted regression toward the mean. He was the first to apply statistical methods to the study of human differences and inheritance of intelligence, and introduced the use of questionnaires and surveys for collecting data on human communities, which he needed for genealogical and biographical works and for his anthropometric studies. He popularised the phrase "nature versus nurture".[3][4][5] His book Hereditary Genius (1869) was the first social scientific attempt to study genius and greatness.[6]

**The quote's paragraph** [section: Introduction]: As an investigator of the human mind, he founded psychometrics and differential psychology, as well as the lexical hypothesis of personality. He devised a method for classifying fingerprints that proved useful in forensic science. He also conducted research on the power of prayer, concluding it had none due to its null effects on the longevity of those prayed for.[7] His quest for the scientific principles of diverse phenomena extended even to the optimal method for making tea.[8] As the initiator of scientific meteorology, he devised the first weather map, proposed a theory of anticyclones, and was the first to establish a complete record of short-term climatic phenomena on a European scale.[9] He also invented the Galton whistle for testing differential hearing ability.[10] Galton was knighted in 1909 for his contributions to science.[11] He was Charles Darwin's half-cousin.[12]

**The quote:** He also conducted research on the power of prayer, concluding it had none due to its null effects on the longevity of those prayed for.

**Cue A:** Note the unusual subject of one of his studies, and what he concluded about it.

**Cue B:** See what question about prayer he set out to test, and what he concluded.

---

## Pair 53

**The paragraph before:** In his early years Galton was an enthusiastic traveller, and made a solo trip through Eastern Europe to Istanbul, before going up to Cambridge. In 1845 and 1846, he went to Egypt and travelled up the Nile to Khartoum in the Sudan, and from there to Beirut, Damascus and down to Jordan.

**The quote's paragraph** [section: Early life]: In 1850 he joined the Royal Geographical Society, and over the next two years mounted a long and difficult expedition into then little-known South West Africa (now Namibia). He wrote a book on his experience, Narrative of an Explorer in Tropical South Africa.[23] He was awarded the Royal Geographical Society's Founder's Medal in 1853 and the Silver Medal of the French Geographical Society for his pioneering cartographic survey of the region.[24] This established his reputation as a geographer and explorer. He proceeded to write the best-selling The Art of Travel, a handbook of practical advice for the Victorian on the move, which went through many editions and is still in print.

**The quote:** This established his reputation as a geographer and explorer.

**Cue A:** Notice what reputation his early travels earned him.

**Cue B:** Note what reputation his early travels earned him.

---

## Pair 54

**The paragraph before:** The best essay would be on the most important topic you could tell people something surprising about.

**The quote's paragraph** [section: What the Best Essay Would Be]: That may sound obvious, but it has some unexpected consequences. One is that science enters the picture like an elephant stepping into a rowboat. For example, Darwin first described the idea of natural selection in an essay written in 1844. Talk about an important topic you could tell people something surprising about. If that's the test of a great essay, this was surely the best one written in 1844. And indeed, the best possible essay at any given time would usually be one describing the most important scientific or technological discovery it was possible to make.

**The quote:** That may sound obvious, but it has some unexpected consequences. One is that science enters the picture like an elephant stepping into a rowboat. For example, Darwin first described the idea of natural selection in an essay written in 1844.

**Cue A:** Darwin's 1844 essay is the example here. See what role science plays in it that dwarfs other topics.

**Cue B:** Notice the odd comparison used to describe how science enters this picture, and what Darwin's essay illustrates.

---

## Pair 55

**The paragraph before:** Since the initial question does constrain you, in the best case it sets an upper bound on the quality of essay you'll write. If you do as well as you possibly can on the chain of thoughts that follow from the initial question, the initial question itself is the only place where there's room for variation.

**The quote's paragraph** [section: Following the Branches]: It would be a mistake to let this make you too conservative though, because you can't predict where a question will lead. Not if you're doing things right, because doing things right means making discoveries, and by definition you can't predict those. So the way to respond to this situation is not to be cautious about which initial question you choose, but to write a lot of essays. Essays are for taking risks.

**The quote:** Not if you're doing things right, because doing things right means making discoveries, and by definition you can't predict those. So the way to respond to this situation is not to be cautious about which initial question you choose, but to write a lot of essays. Essays are for taking risks.

**Cue A:** If discoveries can't be predicted in advance, what should that make you do about which questions you choose, and how many essays you write?

**Cue B:** If discoveries cannot be predicted in advance, what should that imply about how many essays to attempt?

---

## Pair 56

**The paragraph before:** As a lower bound, you have to like your work more than any unproductive pleasure. You have to like what you do enough that the concept of "spare time" seems mistaken. Which is not to say you have to spend all your time working. You can only work so much before you get tired and start to screw up. Then you want to do something else — even something mindless. But you don't regard this time as the prize and the time you spend working as the pain you endure to earn it.

**The quote's paragraph** [section: Bounds]: I put the lower bound there for practical reasons. If your work is not your favorite thing to do, you'll have terrible problems with procrastination. You'll have to force yourself to work, and when you resort to that the results are distinctly inferior.

**The quote:** If your work is not your favorite thing to do, you'll have terrible problems with procrastination. You'll have to force yourself to work, and when you resort to that the results are distinctly inferior.

**Cue A:** Notice what is said to happen when work isn't your favorite thing to do.

**Cue B:** Notice what happens to the quality of your results when you have to force yourself to work.

---

## Pair 57

**The paragraph before:** It's hard to find work you love; it must be, if so few do. So don't underestimate this task. And don't feel bad if you haven't succeeded yet. In fact, if you admit to yourself that you're discontented, you're a step ahead of most people, who are still in denial. If you're surrounded by colleagues who claim to enjoy work that you find contemptible, odds are they're lying to themselves. Not necessarily, but probably.

**The quote's paragraph** [section: Discipline]: Although doing great work takes less discipline than people think — because the way to do great work is to find something you like so much that you don't have to force yourself to do it — finding work you love does usually require discipline. Some people are lucky enough to know what they want to do when they're 12, and just glide along as if they were on railroad tracks. But this seems the exception. More often people who do great things have careers with the trajectory of a ping-pong ball. They go to school to study A, drop out and get a job doing B, and then become famous for C after taking it up on the side.

**The quote:** Although doing great work takes less discipline than people think — because the way to do great work is to find something you like so much that you don't have to force yourself to do it — finding work you love does usually require discipline.

**Cue A:** What kind of discipline is said to still be needed, even though doing great work itself takes less than people think?

**Cue B:** Which takes more discipline: doing great work, or finding work you love in the first place?

---

## Pair 58

**The paragraph before:** Ambition

**The quote's paragraph** [section: Ambition]: In practice, "stay upwind" reduces to "work on hard problems." And you can start today. I wish I'd grasped that in high school.

**The quote:** In practice, "stay upwind" reduces to "work on hard problems." And you can start today. I wish I'd grasped that in high school.

**Cue A:** Notice what staying upwind boils down to in practice, and when you could begin.

**Cue B:** See what staying upwind turns into as concrete advice you could follow starting today.

---

## Pair 59

**The paragraph before:** Kids are curious, but the curiosity I mean has a different shape from kid curiosity. Kid curiosity is broad and shallow; they ask why at random about everything. In most adults this curiosity dries up entirely. It has to: you can't get anything done if you're always asking why about everything. But in ambitious adults, instead of drying up, curiosity becomes narrow and deep. The mud flat morphs into a well.

**The quote's paragraph** [section: Curiosity]: Curiosity turns work into play. For Einstein, relativity wasn't a book full of hard stuff he had to learn for an exam. It was a mystery he was trying to solve. So it probably felt like less work to him to invent it than it would seem to someone now to learn it in a class.

**The quote:** Curiosity turns work into play. For Einstein, relativity wasn't a book full of hard stuff he had to learn for an exam. It was a mystery he was trying to solve. So it probably felt like less work to him to invent it than it would seem to someone now to learn it in a class.

**Cue A:** See what effect curiosity is said to have on the feeling of hard work, using Einstein as the example.

**Cue B:** See what the Einstein example suggests about the difference between play and assigned work.

---

## Pair 60

**The paragraph before:** [4] The second biggest regret was caring so much about unimportant things. And especially about what other people thought of them.

**The quote's paragraph** [section: Notes]: I think what they really mean, in the latter case, is caring what random people thought of them. Adults care just as much what other people think, but they get to be more selective about the other people.

**The quote:** I think what they really mean, in the latter case, is caring what random people thought of them. Adults care just as much what other people think, but they get to be more selective about the other people.

**Cue A:** The latter case concerns peer pressure. See what the author says it really amounts to caring about.

**Cue B:** Notice what is said to really lie behind caring what other people think, and how adults differ in it.

---

## Pair 61

**The paragraph before:** Vector

**The quote's paragraph** [section: Vector]: The need to do something unscalably laborious to get started is so nearly universal that it might be a good idea to stop thinking of startup ideas as scalars. Instead we should try thinking of them as pairs of what you're going to build, plus the unscalable thing(s) you're going to do initially to get the company going.

**The quote:** The need to do something unscalably laborious to get started is so nearly universal that it might be a good idea to stop thinking of startup ideas as scalars. Instead we should try thinking of them as pairs of what you're going to build, plus the unscalable thing(s) you're going to do initially to get the company going.

**Cue A:** Two parts are proposed for every startup idea: what you build, plus what else?

**Cue B:** Look for the two-part way of thinking about a startup idea being proposed here.

---

## Pair 62

**The paragraph before:** Fragile

**The quote's paragraph** [section: Recruit Users by Hand]: Airbnb now seems like an unstoppable juggernaut, but early on it was so fragile that about 30 days of going out and engaging in person with users made the difference between success and failure.

**The quote:** Airbnb now seems like an unstoppable juggernaut, but early on it was so fragile that about 30 days of going out and engaging in person with users made the difference between success and failure.

**Cue A:** Note how short a stretch of in-person effort is credited with making the difference for this company.

**Cue B:** Notice how short a window of effort is said to have decided this company's fate.

---

## Pair 63

**The paragraph before:** Consult

**The quote's paragraph** [section: Act as a Consultant]: Sometimes we advise founders of B2B startups to take over-engagement to an extreme, and to pick a single user and act as if they were consultants building something just for that one user. The initial user serves as the form for your mold; keep tweaking till you fit their needs perfectly, and you'll usually find you've made something other users want too. Even if there aren't many of them, there are probably adjacent territories that have more. As long as you can find just one user who really needs something and can act on that need, you've got a toehold in making something people want, and that's as much as any startup needs initially.

**The quote:** Sometimes we advise founders of B2B startups to take over-engagement to an extreme, and to pick a single user and act as if they were consultants building something just for that one user. The initial user serves as the form for your mold; keep tweaking till you fit their needs perfectly, and you'll usually find you've made something other users want too.

**Cue A:** See what extreme role founders are advised to take on for a single early user.

**Cue B:** Picture building for just one user as if they were your only client. Where does this advice say that leads?

---

## Pair 64

**The paragraph before:** [11]

**The quote's paragraph** [section: Big Launches Don't Work]: It's not enough just to do something extraordinary initially. You have to make an extraordinary effort initially. Any strategy that omits the effort — whether it's expecting a big launch to get you users, or a big partner — is ipso facto suspect.

**The quote:** It's not enough just to do something extraordinary initially. You have to make an extraordinary effort initially. Any strategy that omits the effort — whether it's expecting a big launch to get you users, or a big partner — is ipso facto suspect.

**Cue A:** Which two shortcuts for getting users does this say cannot replace real effort?

**Cue B:** What two substitutes for hard early effort does this passage warn are suspect?

---

## Pair 65

**The paragraph before:** Subfossil remains show the dodo measured about 62.6–75 centimetres (2.05–2.46 ft) in height and may have weighed 10.6–17.5 kg (23–39 lb) in the wild. The dodo's appearance in life is evidenced only by drawings, paintings, and written accounts from the 17th century. Since these portraits vary considerably, and since only some of the illustrations are known to have been drawn from live specimens, the dodos' exact appearance in life remains unresolved, and little is known about its behaviour. It has been depicted with brownish-grey plumage, yellow feet, a tuft of tail feathers, a grey, naked head, and a black, yellow, and green beak. It used gizzard stones to help digest its food, which is thought to have included fruits, and its main habitat is believed to have been the woods in the drier coastal areas of Mauritius. One account states its clutch consisted of a single egg. It is presumed that the dodo became flightless because of the ready availability of abundant food sources and a relative absence of predators on Mauritius. Though the dodo has historically been portrayed as being fat and clumsy, it is now thought to have been well-adapted for its ecosystem.

**The quote's paragraph** [section: Intro]: The first recorded mention of the dodo was by Dutch sailors in 1598. In the following years, the bird was hunted by sailors and invasive species, while its habitat was being destroyed. The last widely accepted sighting of a dodo was in 1662. Its extinction was not immediately noticed, and some considered the bird to be a myth. In the 19th century, research was conducted on a small quantity of remains of four specimens that had been brought to Europe in the early 17th century. Among these is a dried head, the only soft tissue of the dodo that remains today. Since then, a large amount of subfossil material has been collected on Mauritius, mostly from the Mare aux Songes swamp. The extinction of the dodo less than a century after its discovery called attention to the previously unrecognised problem of human involvement in the disappearance of entire species. The dodo achieved widespread recognition from its role in the story of Alice's Adventures in Wonderland, and it has since become a fixture in popular culture, often as a symbol of extinction and obsolescence.

**The quote:** The extinction of the dodo less than a century after its discovery called attention to the previously unrecognised problem of human involvement in the disappearance of entire species.

**Cue A:** Notice what new idea about human impact this bird's rapid disappearance brought to public attention.

**Cue B:** Note what new problem the dodo's rapid disappearance brought to people's attention.

---

## Pair 66

**The paragraph before:** 

**The quote's paragraph** [section: Taxonomy]: The dodo was variously declared a small ostrich, a rail, an albatross, or a vulture, by early scientists.[3] In 1842, Danish zoologist Johannes Theodor Reinhardt proposed that dodos were ground pigeons, based on studies of a dodo skull he had discovered in the collection of the Natural History Museum of Denmark.[4][5] This view was met with ridicule, but was later supported by English naturalists Hugh Edwin Strickland and Alexander Gordon Melville in their 1848 monograph The Dodo and Its Kindred, which attempted to separate myth from reality.[6] After dissecting the preserved head and foot of the specimen at the Oxford University Museum and comparing it with the few remains then available of the extinct Rodrigues solitaire (Pezophaps solitaria), they concluded that the two were closely related. Strickland stated that although not identical, these birds shared many distinguishing features of the leg bones, otherwise known only in pigeons.[7]

**The quote:** After dissecting the preserved head and foot of the specimen at the Oxford University Museum and comparing it with the few remains then available of the extinct Rodrigues solitaire (Pezophaps solitaria), they concluded that the two were closely related.

**Cue A:** Which extinct island bird did anatomical comparison of preserved remains link the dodo to?

**Cue B:** Which other extinct bird did anatomical comparison link the dodo to, and on what evidence?

---

## Pair 67

**The paragraph before:** The traditional image of the dodo is of a very fat and clumsy bird, but this view may be exaggerated. The general opinion of scientists today is that many old European depictions were based on overfed captive birds or crudely stuffed specimens.[55] It has also been suggested that the images might show dodos with puffed feathers, as part of display behaviour.[47] The Dutch painter Roelant Savery was the most prolific and influential illustrator of the dodo, having made at least twelve depictions, often showing it in the lower corners. A famous painting of his from 1626, now called Edwards's Dodo as it was once owned by the ornithologist George Edwards, has since become the standard image of a dodo. It is housed in the Natural History Museum, London. The image shows a particularly fat bird and is the source for many other dodo illustrations.[56][57]

**The quote's paragraph** [section: Description]: An Indian Mughal painting rediscovered in the Hermitage Museum, St. Petersburg, in 1955 shows a dodo along with native Indian birds.[58] It depicts a slimmer, brownish bird, and its discoverer Aleksander Iwanow and British palaeontologist Julian Hume regarded it as one of the most accurate depictions of the living dodo; the surrounding birds are clearly identifiable and depicted with appropriate colouring.[59] It is believed to be from the 17th century and has been attributed to the Mughal painter Ustad Mansur. The bird depicted probably lived in the menagerie of the Mughal Emperor Jahangir, located in Surat, India, where the English traveller Peter Mundy also claimed to have seen two dodos sometime between 1628 and 1633.[60][25] In 2014, another Indian illustration of a dodo was reported, but it was found to be derivative of an 1836 German illustration.[61]

**The quote:** It depicts a slimmer, brownish bird, and its discoverer Aleksander Iwanow and British palaeontologist Julian Hume regarded it as one of the most accurate depictions of the living dodo; the surrounding birds are clearly identifiable and depicted with appropriate colouring.

**Cue A:** Compare this depiction's build and colour to the overfed look described elsewhere, and note why it is judged more accurate.

**Cue B:** A newly found depiction shows a slimmer, brownish bird. See why experts rate it unusually accurate.

---

## Pair 68

**The paragraph before:** The mayors are superb and proud. They presented themselves with an unyielding, stern face and wide open mouth, very jaunty and audacious of gait. They did not want to budge before us; their war weapon was the mouth, with which they could bite fiercely. Their food was raw fruit; they were not dressed very well, but were rich and fat, therefore we brought many of them on board, to the contentment of us all.[64]

**The quote's paragraph** [section: Behaviour and ecology]: In addition to fallen fruits, the dodo probably subsisted on nuts, seeds, bulbs, and roots.[65] It has also been suggested that the dodo might have eaten crabs and shellfish, like their relatives the crowned pigeons. Its feeding habits must have been versatile, since captive specimens were probably given a wide range of food on the long sea journeys.[66] Oudemans suggested that as Mauritius has marked dry and wet seasons, the dodo probably fattened itself on ripe fruits at the end of the wet season to survive the dry season, when food was scarce; contemporary reports describe the bird's "greedy" appetite. The Mauritian ornithologist France Staub suggested in 1996 that they mainly fed on palm fruits, and he attempted to correlate the fat-cycle of the dodo with the fruiting regime of the palms.[32]

**The quote:** In addition to fallen fruits, the dodo probably subsisted on nuts, seeds, bulbs, and roots.

**Cue A:** Look at what else, besides fallen fruit, made up the bird's probable diet.

**Cue B:** Note the range of foods the dodo likely ate beyond fallen fruit.

---

## Pair 69

**The paragraph before:** Coloured engraving of the now lost London foot from 1793 (left), and 1848 lithograph of same in multiple views

**The quote's paragraph** [section: Physical remains]: Many sources state that the Ashmolean Museum burned the stuffed dodo around 1755 because of severe decay, saving only the head and leg. Statute 8 of the museum states "That as any particular grows old and perishing the keeper may remove it into one of the closets or other repository; and some other to be substituted."[126] The deliberate destruction of the specimen is now believed to be a myth; it was removed from exhibition to preserve what remained of it. This remaining soft tissue has since degraded further; the head was dissected by Strickland and Melville, separating the skin from the skull in two-halves. The foot is in a skeletal state, with only scraps of skin and tendons. Very few feathers remain on the head. It is probably a female, as the foot is 11% smaller and more gracile than the London foot, yet appears to be fully grown.[127] The specimen was exhibited at the Oxford museum from at least the 1860s and until 1998, where-after it was mainly kept in storage to prevent damage.[128] Casts of the head can today be found in many museums worldwide.[123]

**The quote:** The deliberate destruction of the specimen is now believed to be a myth; it was removed from exhibition to preserve what remained of it.

**Cue A:** A popular story claims a specimen was deliberately destroyed. What does the text say actually happened to it?

**Cue B:** Look for what is now believed about a famous specimen once thought deliberately destroyed.

---

## Pair 70

**The paragraph before:** The dodo's significance as one of the best-known extinct animals and its singular appearance led to its use in literature and popular culture as a symbol of an outdated concept or object, as in the expression "dead as a dodo," which has come to mean unquestionably dead or obsolete. Similarly, the phrase "to go the way of the dodo" means to become extinct or obsolete, to fall out of common usage or practice, or to become a thing of the past.[153] "Dodo" is also a slang term for a stupid, dull-witted person, as it was said to be stupid and easily caught.[154][155][156]

**The quote's paragraph** [section: Cultural significance]: The dodo appears frequently in works of popular fiction, and even before its extinction, it was featured in European literature, as a symbol for exotic lands, and of gluttony, due to its apparent fatness.[157] In 1865, the same year that George Clark started to publish reports about excavated dodo fossils, the newly vindicated bird was featured as a character in Lewis Carroll's Alice's Adventures in Wonderland. It is thought that he included the dodo because he identified with it and had adopted the name as a nickname for himself because of his stammer, which made him accidentally introduce himself as "Do-do-dodgson", his legal surname.[119] Carroll and the girl who served as inspiration for Alice, Alice Liddell, had enjoyed visiting the Oxford museum to see the dodo remains there.[158] The book's popularity made the dodo a well-known icon of extinction.[159] Popular depictions of the dodo often became more exaggerated and cartoonish following its Alice in Wonderland fame, which was in line with the inaccurate belief that it was clumsy, tragic, and destined for extinction.[160]

**The quote:** It is thought that he included the dodo because he identified with it and had adopted the name as a nickname for himself because of his stammer, which made him accidentally introduce himself as "Do-do-dodgson", his legal surname.

**Cue A:** Look for the personal reason an author is thought to have included the dodo in his writing.

**Cue B:** See what personal reason is suggested for an author's choice to include the dodo in his famous story.

---

## Pair 71

**The paragraph before:** The axolotl (; from Classical Nahuatl: āxōlōtl [aːˈʃoːloːtɬ] ⓘ; Ambystoma mexicanum) is a species of mole salamander. It is neotenic, reaching sexual maturity without undergoing metamorphosis, and the adults remain fully aquatic with obvious external gills. Axolotls may be difficult to distinguish from the larval stage of other neotenic adult mole salamanders, in particular the tiger salamander, or other species such as mudpuppies.[4]

**The quote's paragraph** [section: Introduction]: Axolotls originally inhabited a system of interconnected wetlands and lakes in the highlands of Mexico. They were known to inhabit the smaller lakes of Xochimilco and Chalco and are presumed to have inhabited the larger lakes of Texcoco and Zumpango. The desiccation of these lakes, initiated by the Aztecs and accelerated during the 20th century,[5][6][7] has led to the destruction of much of the axolotl's natural habitat, an area now largely occupied by Mexico City. Wild axolotls have been driven to near extinction by the introduction of invasive species such as tilapia and carp; with a decreasing population of around 50 to 1,000 adult individuals, the species has been assessed as critically endangered by the International Union for Conservation of Nature (IUCN) and is listed under Appendix II of the Convention on International Trade in Endangered Species (CITES).[2]

**The quote:** Wild axolotls have been driven to near extinction by the introduction of invasive species such as tilapia and carp; with a decreasing population of around 50 to 1,000 adult individuals, the species has been assessed as critically endangered by the International Union for Conservation of Nature (IUCN) and is listed under Appendix II of the Convention on International Trade in Endangered Species (CITES).

**Cue A:** Note how few individuals remain and what international protections this has triggered.

**Cue B:** Note the population numbers and what international status they have led to.

---

## Pair 72

**The paragraph before:** The Laboratorio de Restauracion Ecologica (transl. Laboratory of Ecological Restoration) of the National Autonomous University of Mexico has built up a population of 100 captive-bred axolotls, as of 2021. These are mostly used for research, but there are plans to establish a viable population in a semi-artificial wetland inside the university.[needs update][citation needed]

**The quote's paragraph** [section: Wild population]: A 2025 study confirmed the viability of releasing captive-bred axolotls into the wild, with recaptured individuals having gained weight since their release. However, this practice risks losing the axolotls through predation, as several of those released were preyed on by great egrets.[61][62][63]

**The quote:** A 2025 study confirmed the viability of releasing captive-bred axolotls into the wild, with recaptured individuals having gained weight since their release. However, this practice risks losing the axolotls through predation, as several of those released were preyed on by great egrets.

**Cue A:** Weigh the benefit of releasing captive-bred animals against the risk described.

**Cue B:** Weigh the benefit described here against the risk also mentioned for released, captive-bred individuals.

---

## Pair 73

**The paragraph before:** Physiognomy,[a] or face reading and sometimes known by the later term anthroposcopy,[b] is the practice of assessing a person's character or personality from their outer appearance—especially the face. The term physiognomy can also refer to the general appearance of a person, object, or terrain without reference to its implied characteristics—as in the physiognomy of an individual plant (e.g. plant life-form) or of a plant community (e.g. vegetation).

**The quote's paragraph** [section: Introduction]: Physiognomy as a practice meets the contemporary definition of pseudoscience,[4][5][6] and is regarded as such by academics because of its unsupported claims; popular belief in the practice of physiognomy is nonetheless still widespread. The practice was well-accepted by ancient Greek philosophers, but fell into disrepute in the 16th century while practised by vagabonds and mountebanks. It revived and was popularised by Johann Kaspar Lavater, before falling from favour in the late 19th century.[7]

**The quote:** Physiognomy as a practice meets the contemporary definition of pseudoscience,[4][5][6] and is regarded as such by academics because of its unsupported claims; popular belief in the practice of physiognomy is nonetheless still widespread.

**Cue A:** Notice how a practice can be formally rejected by scholars yet still thrive among ordinary people.

**Cue B:** Notice how physiognomy is classified by scholars today, despite its continuing popularity.

---

## Pair 74

**The paragraph before:** An anonymous Latin author, de Physiognomonia (about 4th century)

**The quote's paragraph** [section: Ancient]: Ancient Greek mathematician, astronomer, and scientist Pythagoras—who some believe originated physiognomics—once rejected a prospective follower named Cylon because, to Pythagoras, his appearance indicated bad character.[14] After inspecting Socrates, a physiognomist announced he was given to intemperance, sensuality, and violent bursts of passion—which was so contrary to Socrates's image, his students accused the physiognomist of lying. Socrates put the issue to rest by saying, originally, he was given to all these vices, but had particularly strong self-discipline.[15]

**The quote:** Pythagoras—who some believe originated physiognomics—once rejected a prospective follower named Cylon because, to Pythagoras, his appearance indicated bad character.[14]

**Cue A:** See what judgment Pythagoras is said to have made about a follower based on his looks alone.

**Cue B:** See what judgment Pythagoras is said to have made about a follower based only on looks.

---

## Pair 75

**The paragraph before:** During the Islamic Golden Age, the 12th-century Persian theologian and philosopher Fakhr al-Din al-Razi discussed physiognomy in his work Kitab al-Firasa (Book on Firasa), exploring the link between physical features and moral qualities. His contributions represent an early integration of physiognomic ideas within Arab thought. The term 'physiognomy' was common in Middle English, often written as 'fisnamy' or 'visnomy', as in the Tale of Beryn, a spurious addition to The Canterbury Tales: "I knowe wele by thy fisnamy, thy kynd it were to stele".

**The quote's paragraph** [section: Middle Ages and Renaissance]: Physiognomy's validity was once widely accepted. Michael Scot, a court scholar for Frederick II, Holy Roman Emperor, wrote Liber physiognomiae in the early 13th century concerning the subject. English universities taught physiognomy until Henry VIII of England outlawed "beggars and vagabonds playing 'subtile, crafty and unlawful games such as physnomye or 'palmestrye'" in 1530 or 1531.[16][17] Around this time, scholastic leaders settled on the more erudite Greek form 'physiognomy' and began to discourage the entire concept of 'fisnamy'.

**The quote:** English universities taught physiognomy until Henry VIII of England outlawed "beggars and vagabonds playing 'subtile, crafty and unlawful games such as physnomye or 'palmestrye'" in 1530 or 1531.[16][17]

**Cue A:** Notice what kind of activity face-reading was legally grouped with when it was banned.

**Cue B:** Notice what legal action was eventually taken against face-reading as a practice in England.

---

## Pair 76

**The paragraph before:** Those portions of the brain used for faculties related to each other are located together. Thus the brain is divided into regions or groups, as well into organs. The location and boundaries of these organs and regions may be best learned from the Phrenological bust, and the accompanying diagram ... .[25]

**The quote's paragraph** [section: Period of popularity]: In the late 19th century phrenology began to be taken less seriously which lead to physiognomy being regarded as a pseudoscience because of the close connection between the two.[7] Nevertheless, the German physiognomist Carl Huter (1861–1912) became popular in Germany with his concept of physiognomy, called "psycho-physiognomy".[29]

**The quote:** In the late 19th century phrenology began to be taken less seriously which lead to physiognomy being regarded as a pseudoscience because of the close connection between the two.[7]

**Cue A:** See how the fall of one pseudoscience dragged down a closely linked one.

**Cue B:** Notice what loss of scientific standing in a related field dragged face-reading down with it.

---

## Pair 77

**The paragraph before:** This interest in the relationship between criminology and physiognomy began upon Lombroso's first interaction with "a notorious Calabrian thief and arsonist" named Giuseppe Villella.[33] Lombroso was particularly taken by many striking personality characteristics that Villella possessed; agility and cynicism being some of them. Villella's alleged crimes are disputed and Lombroso's research is seen by many as northern Italian racism toward southern Italians.[36] Upon Villella's death, Lombroso "conducted a post-mortem and discovered that his subject had an indentation at the back of his skull, which resembled that found in apes".[33] He later referred to this anomaly as the "median occipital depression".[37] Lombroso used the term "atavism" to describe these primitive, ape-like behaviors that he found in many of those whom he deemed prone to criminality. As he continued analyzing the data he gathered from Villella's autopsy and compared and contrasted those results with previous cases, he inferred that certain physical characteristics allowed for some individuals to have a greater "propensity to offend and were also savage throwbacks to early man".[33]

**The quote's paragraph** [section: Period of popularity]: These sorts of examinations yielded far-reaching consequences for various scientific and medical communities at the time, and he wrote, "the natural genesis of crime implied that the criminal personality should be regarded as a particular form of psychiatric disease".,[34] which is an idea still seen today in psychiatry's diagnostic manual, the DSM-5, in its description of antisocial personality disorder.[38] Furthermore, these ideas promoted the concept that when a crime is committed, it is no longer seen as "free will" but instead a result of one's genetic pre-disposition to savagery.[34] Lombroso had numerous case studies to corroborate many of his findings due to the fact that he was the head of an insane asylum at Pesaro. He was easily able to study people from various walks of life and was thus able to further define criminal types. Because his theories primarily focused on anatomy and anthropological information, the idea of degeneracy being a source of atavism was not explored till later on in his criminological theory endeavors.[39] These "new and improved" theories led to the notion "that the born criminal had pathological symptoms in common with the moral imbecile and the epileptic, and this led him to expand his typology to include the insane criminal and the epileptic criminal". In addition, "the insane criminal type [was said to] include the alcoholic, the mattoid, and the hysterical criminal".[39] In the 21st century, Lombroso's ideologies are recognized as flawed and regarded as pseudo-science. Many have remarked on the overt sexist and racist overtones of his research, and denounce it for those reasons alone.[37] In spite of many of his theories being discredited, he is still hailed as the father of "scientific criminology".[40]

**The quote:** In spite of many of his theories being discredited, he is still hailed as the father of "scientific criminology".[40]

**Cue A:** Notice the title Lombroso still holds despite his theories being discredited.

**Cue B:** Ask how someone can keep a celebrated title even after their core theories are discredited.

---

## Pair 78

**The paragraph before:** A human skull and measurement device from 1902

**The quote's paragraph** [section: Introduction]: Craniometry is measurement of the cranium (the main part of the skull), usually the human cranium. It is a subset of cephalometry, measurement of the head, which in humans is a subset of anthropometry, measurement of the human body. It is distinct from phrenology, the pseudoscience that tried to link personality and character to head shape, and physiognomy, which tried the same for facial features.

**The quote:** Craniometry is measurement of the cranium (the main part of the skull), usually the human cranium. It is a subset of cephalometry, measurement of the head, which in humans is a subset of anthropometry, measurement of the human body. It is distinct from phrenology, the pseudoscience that tried to link personality and character to head shape, and physiognomy, which tried the same for facial features.

**Cue A:** How does craniometry differ from phrenology and physiognomy, which also studied the head and face?

**Cue B:** How does measuring the skull's shape differ from claims that head or face shape reveals character?

---

## Pair 79

**The paragraph before:** After inspecting three mummies from ancient Egyptian catacombs, Morton concluded that Caucasians and other races were already distinct three thousand years ago. Since the Bible indicated that Noah's Ark had washed up on Mount Ararat, only a thousand years ago before this, Morton claimed that Noah's sons could not possibly account for every race on Earth. According to Morton's theory of polygenism, races have been separate since the start.[13]

**The quote's paragraph** [section: Cranial capacity, races and 19th–20th-century scientific ideas]: Morton claimed that he could judge the intellectual capacity of a race by the skull size. A large skull meant a large brain and high intellectual capacity, and a small skull indicated a small brain and decreased intellectual capacity. Morton collected hundreds of human skulls from all over the world. By studying these skulls he claimed that each race had a separate origin. Morton had many skulls from ancient Egypt, and concluded that the ancient Egyptians were not African, but were White. His two major monographs were the Crania Americana (1839), An Inquiry into the Distinctive Characteristics of the Aboriginal Race of America and Crania Aegyptiaca (1844).

**The quote:** Morton claimed that he could judge the intellectual capacity of a race by the skull size. A large skull meant a large brain and high intellectual capacity, and a small skull indicated a small brain and decreased intellectual capacity.

**Cue A:** Consider the assumption linking skull size directly to intelligence.

**Cue B:** Notice the claimed link between skull size and intellectual capacity.

---

## Pair 80

**The paragraph before:** For example, it's more useful to say that Pike's Peak is near the middle of Colorado than merely somewhere in Colorado. But if I say it's in the exact middle of Colorado, I've now gone too far, because it's a bit east of the middle.

**The quote's paragraph** [section: Four parts of usefulness]: Precision and correctness are like opposing forces. It's easy to satisfy one if you ignore the other. The converse of vaporous academic writing is the bold, but false, rhetoric of demagogues. Useful writing is bold, but true.

**The quote:** Precision and correctness are like opposing forces. It's easy to satisfy one if you ignore the other. The converse of vaporous academic writing is the bold, but false, rhetoric of demagogues. Useful writing is bold, but true.

**Cue A:** Notice the tension between two forces the passage names, and which side bold writing favors.

**Cue B:** Two forces pull against each other in writing: precision and correctness. See which side the author favors.

---

## Pair 81

**The paragraph before:** My strategy is loose, then tight. I write the first draft of an essay fast, trying out all kinds of ideas. Then I spend days rewriting it very carefully.

**The quote's paragraph** [section: Tricks for each part]: I've never tried to count how many times I proofread essays, but I'm sure there are sentences I've read 100 times before publishing them. When I proofread an essay, there are usually passages that stick out in an annoying way, sometimes because they're clumsily written, and sometimes because I'm not sure they're true. The annoyance starts out unconscious, but after the tenth reading or so I'm saying "Ugh, that part" each time I hit it. They become like briars that catch your sleeve as you walk past. Usually I won't publish an essay till they're all gone — till I can read through the whole thing without the feeling of anything catching.

**The quote:** They become like briars that catch your sleeve as you walk past. Usually I won't publish an essay till they're all gone — till I can read through the whole thing without the feeling of anything catching.

**Cue A:** Look for what the small irritations in a draft are compared to, and when the author stops revising.

**Cue B:** What image does the passage use for the small flaws that stop a piece from feeling finished?

---

## Pair 82

**The paragraph before:** The way to get novelty is to write about topics you've thought about a lot. Then you can use yourself as a proxy for the reader in this department too. Anything you notice that surprises you, who've thought about the topic a lot, will probably also surprise a significant number of readers. And here, as with correctness and importance, you can use the Morris technique to ensure that you will. If you don't learn anything from writing an essay, don't publish it.

**The quote's paragraph** [section: Tricks for each part]: You need humility to measure novelty, because acknowledging the novelty of an idea means acknowledging your previous ignorance of it. Confidence and humility are often seen as opposites, but in this case, as in many others, confidence helps you to be humble. If you know you're an expert on some topic, you can freely admit when you learn something you didn't know, because you can be confident that most other people wouldn't know it either.

**The quote:** You need humility to measure novelty, because acknowledging the novelty of an idea means acknowledging your previous ignorance of it. Confidence and humility are often seen as opposites, but in this case, as in many others, confidence helps you to be humble.

**Cue A:** See how confidence and humility, usually opposites, work together here.

**Cue B:** Why does measuring an idea's novelty require admitting something about yourself first?

---

## Pair 83

**The paragraph before:** What I've learned since I was a kid is how to work toward goals that are neither clearly defined nor externally imposed. You'll probably have to learn both if you want to do really great things.

**The quote's paragraph** [section: Learning to Work Without Being Told]: The most basic level of which is simply to feel you should be working without anyone telling you to. Now, when I'm not working hard, alarm bells go off. I can't be sure I'm getting anywhere when I'm working hard, but I can be sure I'm getting nowhere when I'm not, and it feels awful.

**The quote:** Now, when I'm not working hard, alarm bells go off. I can't be sure I'm getting anywhere when I'm working hard, but I can be sure I'm getting nowhere when I'm not, and it feels awful.

**Cue A:** Notice what feeling the author treats as proof that real work is or is not happening.

**Cue B:** Look at what feeling the author now uses to judge whether he is working enough.

---

## Pair 84

**The paragraph before:** The other kind of fakeness is intrinsic to certain types of work. Some types of work are inherently bogus, or at best mere busywork.

**The quote's paragraph** [section: Discovering the Shape of Real Work]: There's a kind of solidity to real work. It's not all writing the Principia, but it all feels necessary. That's a vague criterion, but it's deliberately vague, because it has to cover a lot of different types.

**The quote:** There's a kind of solidity to real work. It's not all writing the Principia, but it all feels necessary. That's a vague criterion, but it's deliberately vague, because it has to cover a lot of different types.

**Cue A:** What loose but useful test does the author offer for telling real work from busywork?

**Cue B:** Look for the vague but deliberate test the author uses to tell real work from fake work.

---

## Pair 85

**The paragraph before:** What even counts as good results? That can be really hard to decide. If you're exploring an area few others have worked in, you may not even know what good results look like. History is full of examples of people who misjudged the importance of what they were working on.

**The quote's paragraph** [section: Discovering What to Work On]: The best test of whether it's worthwhile to work on something is whether you find it interesting. That may sound like a dangerously subjective measure, but it's probably the most accurate one you're going to get. You're the one working on the stuff. Who's in a better position than you to judge whether it's important, and what's a better predictor of its importance than whether it's interesting?

**The quote:** The best test of whether it's worthwhile to work on something is whether you find it interesting. That may sound like a dangerously subjective measure, but it's probably the most accurate one you're going to get.

**Cue A:** What simple, subjective measure does the author trust most for judging what is worth working on?

**Cue B:** Notice what test the author proposes for deciding whether work is worth doing.

---

## Pair 86

**The paragraph before:** According to Smedley and Marks the European concept of "race", along with many of the ideas now associated with the term, arose at the time of the Scientific Revolution, which introduced and privileged the study of natural kinds, and the age of European imperialism and colonization which established political relations between Europeans and peoples with distinct cultural and political traditions.[48][53] As Europeans encountered people from different parts of the world, they speculated about the physical, social, and cultural differences among various human groups. The rise of the Atlantic slave trade, which gradually displaced an earlier trade in slaves from throughout the world, created a further incentive to categorize human groups in order to justify the subordination of African slaves.[54]

**The quote's paragraph** [section: Historical origins of racial classification]: Drawing on sources from classical antiquity and upon their own internal interactions – for example, the hostility between the English and Irish powerfully influenced early European thinking about the differences between people[55] – Europeans began to sort themselves and others into groups based on physical appearance, and to attribute to individuals belonging to these groups behaviors and capacities which were claimed to be deeply ingrained. A set of folk beliefs took hold that linked inherited physical differences between groups to inherited intellectual, behavioral, and moral qualities.[56] Similar ideas can be found in other cultures,[57] for example in China, where a concept often translated as "race" was associated with supposed common descent from the Yellow Emperor, and used to stress the unity of ethnic groups in China. Brutal conflicts between ethnic groups have existed throughout history and across the world.[58]

**The quote:** A set of folk beliefs took hold that linked inherited physical differences between groups to inherited intellectual, behavioral, and moral qualities.

**Cue A:** See what kind of inner qualities people believed outward physical differences revealed.

**Cue B:** Notice what kind of inner qualities were falsely tied to inherited physical traits.

---
