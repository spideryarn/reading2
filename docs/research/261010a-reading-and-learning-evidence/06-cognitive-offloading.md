# Cognitive offloading, the "Google effect" and deskilling

Up: [reading-research-overview.md](../../project/reading-research-overview.md) · part of the
[reading and learning evidence library](digest.md), 2026-10-10.

The question: when a person hands part of a mental job to a tool (a search engine, a notes file, an AI), does their own memory, skill or judgement get better, worse, or stay the same? The short answer is that it depends on three things the evidence keeps returning to: whether the person *intended* to learn the material, whether the tool does the effortful part or only the clerical part, and whether the person can still tell what they do and do not know. The famous "Google effect" is much weaker than its reputation (its best-known experiment failed two replications). The evidence on generative AI is real but thin: mostly self-report surveys, a few short experiments, one observational medical study, and a lot of framing that has no data behind it yet. None of it studies expert adults reading research papers.

"Cognitive offloading" means using an action or an external aid to reduce the mental load of a task: a reminder on your phone, a note in the margin, a calculator (Risko & Gilbert 2016, abstract only).

## The short answer

- Offloading is normal, often sensible, and its memory cost depends on whether you meant to learn the thing: when people knew a memory test was coming, offloading's penalty nearly vanished (Grinschgl 2021, three lab experiments). (**Moderate certainty · Analogy**)
- Saving something externally can *improve* memory for what you study next, by freeing you from holding the old material (Storm & Stone 2015, three experiments). (**Moderate certainty · Analogy**)
- The headline "Google effect" is shaky. The Stroop priming experiment from Sparrow et al. 2011 failed to replicate in a large pre-registered project (Camerer 2018, as recorded by the FLoRA replication atlas) and again in a closer-to-original attempt (Hesselmann 2020). The separate claim that expecting future access lowers recall was not part of those replications, and I found no pre-registered replication of it. (**Contested · Analogy**)
- In a field experiment with nearly 1,000 high-school students, unrestricted GPT-4 raised practice scores but lowered later unaided exam scores by 17% against a no-AI control; a tutor variant with guardrails largely avoided the harm (Bastani 2025, PNAS). (**Moderate certainty · Indirect**: strong design, but teenagers doing maths)
- Surveys link heavier AI use, or more confidence in AI, to less self-reported critical thinking (Lee 2025; Gerlich 2025). These are correlations from self-report, so they cannot say which way cause runs. (**Low certainty · Indirect**)
- Used as an aid, AI can inflate confidence: people who solved logic problems with AI scored higher but overestimated their score by about four points, and the usual pattern of poor performers overrating themselves disappeared (Fernandes 2026, two online experiments). (**Moderate certainty · Indirect**)
- Skill decay with professional automation has one real-world data point: endoscopists' unaided adenoma detection fell from 28.4% to 22.4% after AI was introduced (Budzyń 2025), but it is a retrospective before/after study at four sites, so causation is not shown. (**Low certainty · Analogy**)
- "Cognitive surrender" and "metacognitive laziness" are named ideas. The second has one small experiment behind it; the first has a working paper I could not open. Treat both as hypotheses. (**Low certainty · Indirect**)

## The evidence

### What offloading does to memory (basic experiments)

**Risko & Gilbert 2016** is a review in *Trends in Cognitive Sciences*; its abstract proposes a *metacognitive* account: whether we offload depends on our beliefs about our own memory and about the cost of the aid. I read only the abstract. It is the framework, not an effect size.

**Grinschgl, Papenmeier & Meyerhoff 2021** (*Quarterly Journal of Experimental Psychology*, abstract only). Three lab experiments with a pattern-copying task, where participants could use a tablet as external memory (the abstract summary gives N = 172 per experiment). Higher cost of offloading meant less offloading, worse immediate performance, but better memory on a surprise test. In Experiment 2, offloading still harmed memory when participants knew a test was coming. In Experiment 3, participants forced to offload heavily but who knew about the test nearly eliminated the penalty. The authors conclude that offloading hurts memory mainly when people lack an explicit goal to learn. The performance gain and the memory loss are different outcomes, and this paper shows both. (**Moderate certainty · Analogy**: a block-copying task, not reading.)

**Storm & Stone 2015** (*Psychological Science*, abstract only). Across three experiments, saving one file before studying a new one improved memory for the new file's contents. The effect disappeared when saving seemed unreliable or the saved file was not substantial. Their reading: saving lets people strategically offload and reduces interference from what they no longer need to hold. This is the strongest evidence that offloading can *help* memory. (**Moderate certainty · Analogy**)

### The "Google effect" and what happened to it

**Original claim.** Sparrow, Liu & Wegner 2011 (*Science*, abstract only) reported four studies: after hard questions people think of computers; when they expect future access to information they remember it less well but remember where to find it better. The paper concluded that the internet works as external "transactive memory".

**Failed replications of the Stroop study.** The first study (slower colour-naming of computer-related words after hard trivia) was one of 21 experiments replicated by Camerer et al. 2018 (*Nature Human Behaviour*). The project as a whole reproduced 13 of 21 (62%), with effects about half the original size (abstract). The FLoRA replication atlas records the Sparrow study as failed: p = 0.2647 in the first round and 0.4493 pooled, with the estimate in the original direction. (The Camerer abstract does not name individual studies; the Sparrow-specific figures are from the atlas entry.) Sparrow later pointed to design differences, including that her data were collected around 2006 using search-engine words from that era (reported in secondary sources, not verified). **Hesselmann 2020** (*PeerJ*, abstract only) then used a design closer to the original and found "no conclusive evidence" for the effect.

**What was not replicated.** The claims about remembering information versus remembering where to find it were not part of Camerer's project, and I found no pre-registered replication of them. A 2024 meta-analysis (Chen & Yang, *Frontiers in Public Health*, abstract only) reports that "Google effects" relate to cognitive load, cognitive self-esteem and device, and are weaker for people with larger knowledge bases. I could not see the number of studies, the pooled effect or publication-bias checks, so it cannot carry weight. (**Contested · Analogy**)

**A related claim.** Fisher, Goddu & Keil 2015 reported that searching online inflates people's estimate of their own knowledge. I confirmed the citation but not the findings; see "Not verified".

### Generative AI, effort and critical thinking

**Lee et al. 2025** (CHI conference paper; survey; abstract only). 319 knowledge workers gave 936 first-hand examples of using generative AI at work. Quantitatively, higher task-specific self-confidence and higher confidence in AI predicted whether critical thinking occurred and how much effort it took; the abstract's wording is "Higher confidence in GenAI is associated with less critical thinking". Qualitatively, critical thinking shifted toward verifying outputs, integrating responses and stewarding the task. Self-reported and self-selected; "effort" is perceived effort. (**Low certainty · Indirect**)

**Gerlich 2025** (*Societies*, abstract only). Mixed methods, 666 participants of varied ages and education. Frequent AI use correlated negatively with critical thinking, a link mediated by more cognitive offloading; younger participants reported more AI dependence and lower critical thinking; more education was linked to better critical thinking regardless. Cross-sectional, so a person who thinks less critically may simply lean on AI more. (**Low certainty · Indirect**)

**Bastani et al. 2025** (*PNAS*; field experiment; abstract only). Nearly 1,000 high-school maths students. Two AI tutors: GPT Base (a standard ChatGPT-style interface) and GPT Tutor (prompts designed to protect learning). During practice, grades rose 48% (Base) and 127% (Tutor). When access was removed, Base users scored 17% *worse* than students who never had AI; Tutor's safeguards largely prevented the loss. The authors call it a "crutch". This is the best design here: an experiment with a delayed, unaided test, which separates performance-while-assisted from learning. (**Moderate certainty · Indirect**: teenagers, mathematics.)

**Fan et al. 2025** (*British Journal of Educational Technology*; randomised experiment; abstract only). 117 university students on a writing task, four conditions (ChatGPT, human expert, writing-analytics tools, none). The ChatGPT group improved more on essay scores, but knowledge gain and transfer did not differ significantly; motivation did not differ; self-regulated-learning behaviour did. The authors coined "metacognitive laziness" from this. Note the finding is better output with *no learning difference*, not a harm. Small and short. (**Low certainty · Indirect**)

**Fernandes et al. 2026** (*Computers in Human Behavior*; two online experiments, N = 246 and 452; Crossref metadata plus a university research-portal summary, not the paper). Participants solved Law School Admission Test logic problems with AI. They scored about three points above a norm group but overestimated their performance by four points. Higher AI literacy went with *less* accurate self-assessment. Participants were required to use AI, which differs from real use. (**Moderate certainty · Indirect**)

### Deskilling in professional settings

**Budzyń et al. 2025** (*Lancet Gastroenterology & Hepatology*; abstract via the Warwick repository). Retrospective observational study at four Polish endoscopy centres in the ACCEPT trial. Adenoma detection rate in non-AI colonoscopies fell from 28.4% (226/795) before AI introduction to 22.4% (145/648) after, a difference of -6.0 points (95% CI -10.5 to -1.6, p = 0.0089). AI exposure was independently associated with detection rate in a multivariable model. Weaknesses: three months either side, so season and case mix can differ; four centres; experienced clinicians; and it shows a fall in unaided performance, not the mechanism. It is still the most concrete worked example of "good when the tool is on, worse when it is off". (**Low certainty · Analogy**)

**Macnamara et al. 2024** (*Cognitive Research*; abstract only) is a *theoretical perspective*, not data: AI assistants may speed skill decay in experts and slow acquisition in learners, and users may not notice. **Cash, Kelly, Macnamara & Risko 2026** (*Trends in Cognitive Sciences*, "Is AI making us stupid?") I verified only as a citation. Secondary coverage says it distinguishes specific learned skills from general cognitive ability and that risk depends on how AI is used (not verified).

### Framings without strong data

- **"Cognitive surrender"** (Shaw & Nave, "Thinking-Fast, Slow, and Artificial", SSRN, 2026). I could not open it (403). Secondary coverage reports experiments with 1,372 participants on a reflection-test variant, with AI accuracy randomised: accuracy rose about 25 points when the AI was right and fell about 15 when wrong, with confidence rising either way. **A working paper, not shown to be peer-reviewed, and not verified by me**; it is kept out of the backbone. If the pattern holds it looks like ordinary automation bias (see the earlier [prior-art note](../260831e-helping-peer-reviewers/prior-art-and-cognitive-offloading.md)).
- **"Metacognitive laziness"** (Fan 2025, above): one small experiment.
- **"Your Brain on ChatGPT"** (Kosmyna et al., arXiv 2506.08872, **preprint**, v2 31 Dec 2025; abstract only). 54 participants wrote essays with an LLM, a search engine or nothing; EEG, linguistic and human scoring; only 18 completed the fourth session. The abstract reports weakest brain connectivity and lowest sense of ownership in the LLM group. No journal publication was shown. Small, writing rather than reading, and EEG connectivity is hard to interpret. Not load-bearing.

## Where it is weak, contested or contrary

- **Replication and reputation.** The Google effect's best-known experiment failed twice; the rest is untested. Do not cite "the Google effect" as settled in product copy.
- **Self-report dominates.** Lee and Gerlich measure perceived effort and thinking, cross-sectionally. The direction of cause is open.
- **Performance and learning come apart.** Bastani, Fan and Grinschgl all show better output with the aid and, in some cases, no learning gain or a later loss. Any claim should say which outcome it means.
- **Offloading can help.** Storm & Stone and Grinschgl's Experiment 3 are reminders that aids are not inherently harmful; intent and design matter.
- **Populations and tasks.** High-school mathematics, LSAT puzzles, colonoscopy, pattern copying, essay writing. No study here concerns experienced readers of research papers, and none measures reading comprehension of a text with versus without an AI companion.
- **Short horizons.** Weeks at most; "atrophy" over years is inference, not observation.
- **Publication bias.** Alarming headlines travel faster than nulls; Fan's null on learning and Grinschgl's vanishing penalty are less quoted.

## What it means for Spideryarn

The stance is in [vision.md](../../project/vision.md): "it augments human cognition, but it doesn't replace it", with the forklift-truck analogy and the tiebreak "what will help the human to best form their own rich updated internal representations?"

### The overall stance (augment, don't replace)
**Supports.** The Bastani contrast (an unrestricted helper harms later unaided performance; a guardrailed tutor largely does not) is the closest direct evidence for "design the aid so the effort stays with the learner". Grinschgl supports "intent to learn" as the lever. Caveat: that is school maths and a lab task, not reading. **Untested** for readers of papers.

### Chat and its tools
How it works: chat can call nine tools that reach things the model's prompt does not carry, filtered by "does it send the reader somewhere they could not otherwise get to?" ([chat-tools.md](../../project/chat-tools.md)). **Supports** the filter: offloading the clerical part (exhaustive word search, fetching a cited page) is the kind of offloading that frees capacity, as in Storm & Stone. **Suggests a change (proposal only)**: Fernandes and Lee point to confidence as the risk, so answers could show where the model is unsure, and chat could sometimes ask the reader for their own attempt first. An unrestricted answer to a question the reader has not tried to answer is the "GPT Base" case in Bastani. **Untested** for reading.

### Glossary
How it works: terms the article uses in a non-obvious way, defined from the article itself, underlined in the prose with a hover card ([glossary.md](../../project/glossary.md)). **Supports** the door-not-wall design: it saves lookup effort (clerical offloading) while the reader stays in the prose. **Untested**: whether a ready definition replaces the reader's own attempt to infer the term from context.

### Learn mode and the quiz
How it works: the reader says what they remember and the model corrects and nudges them to recall more ([learn-mode.md](../../project/learn-mode.md)). **Supports** the strategy: Grinschgl shows an explicit goal to learn largely removes the memory cost of offloading, and recall-first designs build that goal in. Fernandes' calibration result also favours checks that show a reader their actual level. **Untested**: whether recall prompts reduce the confidence inflation seen with AI help.

### Summaries and orientation modes
Vision principle 1 says generated text should be a door, not a wall. Fan (better product, no learning difference) is the nearest evidence here. **Supports** keeping the reader's own reading step in place of a summary; **untested** for reading itself.

## Not verified

- Fisher, Goddu & Keil 2015, "Searching for explanations: how the Internet inflates estimates of internal knowledge", *JEP: General* 144(3), 674-687, https://doi.org/10.1037/xge0000070. Crossref confirmed the citation; the findings (nine experiments; searching inflates self-assessed knowledge) come from a search snippet only.
- Shaw & Nave, "Thinking-Fast, Slow, and Artificial" (SSRN 6097646): page returned 403; all figures are from secondary coverage.
- Cash et al. 2026: citation confirmed by Crossref (vol. 30, no. 8, pp. 673-675); content not read.
- Camerer 2018's own tables on the Sparrow study (sample size, effect) and the claim that Sparrow's data were collected in 2006 with early search-engine words.
- Chen & Yang 2024 meta-analysis details beyond the abstract.
- The Lee et al. percentages in the earlier prior-art note (79% / 72% / 76% reporting less effort); not seen in the abstract here, so not repeated.
- A 2021 *Memory* paper on saved versus deleted information (Schooler and Storm), mentioned in one search result: not found, not used.

## Search log

- Crossref API for DOIs of Risko & Gilbert, Gerlich, Storm & Stone, Grinschgl, Fan, Fernandes, Macnamara, Cash, Fisher (several returned 429 at first and were retried); Europe PMC REST for Sparrow, Camerer, Hesselmann, Bastani. PubMed and PMC pages were blocked (cookie or reCAPTCHA), the Nature page redirected to a login, and ACM, PNAS, Cell and SSRN pages returned 403.
- Web searches: Budzyń endoscopist deskilling; Camerer and Sparrow replication; Hesselmann 2020; Shaw & Nave "cognitive surrender"; Fan "metacognitive laziness"; Fernandes; Fisher et al.; Macnamara 2024 and Cash 2026; Google-effect meta-analysis.
- Citation chaining: from Hesselmann to Camerer and the FLoRA atlas; from Macnamara to Cash et al.
- Retractions or corrections: none seen. Nulls noted: Camerer/Hesselmann (Stroop), Fan (knowledge and transfer), Grinschgl Experiment 3.
- Abstracts were read through a summarising fetch tool, so numbers should be rechecked against the publisher before quoting.

## Sources

1. Risko, E. F. & Gilbert, S. J. (2016). Cognitive offloading. *Trends in Cognitive Sciences* 20(9), 676-688. https://doi.org/10.1016/j.tics.2016.07.002 — checked 2026-10-10 (abstract only).
2. Sparrow, B., Liu, J. & Wegner, D. M. (2011). Google effects on memory: cognitive consequences of having information at our fingertips. *Science* 333(6043), 776-778. https://doi.org/10.1126/science.1207745 — checked 2026-10-10 (abstract only).
3. Camerer, C. F. et al. (2018). Evaluating the replicability of social science experiments in Nature and Science between 2010 and 2015. *Nature Human Behaviour* 2(9), 637-644. https://doi.org/10.1038/s41562-018-0399-z — checked 2026-10-10 (abstract only). Sparrow-specific figures: FLoRA Replication Atlas, https://forrt.org/flora-replication-atlas/doi/10.1126/science.1207745/ — checked 2026-10-10 (atlas entry).
4. Hesselmann, G. (2020). No conclusive evidence that difficult general knowledge questions cause a "Google Stroop effect". A replication study. *PeerJ* 8, e10325. https://doi.org/10.7717/peerj.10325 — checked 2026-10-10 (abstract only).
5. Storm, B. C. & Stone, S. M. (2015). Saving-enhanced memory: the benefits of saving on the learning and remembering of new information. *Psychological Science* 26(2), 182-188. https://doi.org/10.1177/0956797614559285 — checked 2026-10-10 (abstract only).
6. Grinschgl, S., Papenmeier, F. & Meyerhoff, H. S. (2021). Consequences of cognitive offloading: boosting performance but diminishing memory. *Quarterly Journal of Experimental Psychology* 74(9), 1477-1496. https://doi.org/10.1177/17470218211008060 — checked 2026-10-10 (abstract only).
7. Chen, G. & Yang, Y. (2024). Google effects on memory: a meta-analytical review of the media effects of intensive Internet search behavior. *Frontiers in Public Health* 12. https://doi.org/10.3389/fpubh.2024.1332030 — checked 2026-10-10 (abstract only).
8. Lee, H.-P. et al. (2025). The impact of generative AI on critical thinking: self-reported reductions in cognitive effort and confidence effects from a survey of knowledge workers. CHI 2025 (conference paper). https://doi.org/10.1145/3706598.3713778 — checked 2026-10-10 (abstract only, via the Microsoft Research page; DOI itself not opened).
9. Gerlich, M. (2025). AI tools in society: impacts on cognitive offloading and the future of critical thinking. *Societies* 15(1), 6. https://doi.org/10.3390/soc15010006 — checked 2026-10-10 (abstract only).
10. Bastani, H. et al. (2025). Generative AI without guardrails can harm learning: evidence from high school mathematics. *PNAS* 122(26), e2422633122. https://doi.org/10.1073/pnas.2422633122 — checked 2026-10-10 (abstract only).
11. Fan, Y. et al. (2025). Beware of metacognitive laziness: effects of generative artificial intelligence on learning motivation, processes, and performance. *British Journal of Educational Technology* 56(2), 489-530. https://doi.org/10.1111/bjet.13544 — checked 2026-10-10 (abstract only).
12. Fernandes, D. et al. (2026). AI makes you smarter but none the wiser: the disconnect between performance and metacognition. *Computers in Human Behavior* 175, 108779. https://doi.org/10.1016/j.chb.2025.108779 — checked 2026-10-10 (Crossref metadata; findings from the Aalto University research-portal summary, https://research.aalto.fi/en/publications/ai-makes-you-smarter-but-none-the-wiser-the-disconnect-between-pe/).
13. Budzyń, K. et al. (2025). Endoscopist deskilling after exposure to artificial intelligence in colonoscopy: a multicenter observational study. *Lancet Gastroenterology & Hepatology* 10, 896-903. https://doi.org/10.1016/S2468-1253(25)00133-5 — checked 2026-10-10 (abstract only, via https://wrap.warwick.ac.uk/id/eprint/191005; the DOI itself was not resolvable in Europe PMC).
14. Macnamara, B. N. et al. (2024). Does using artificial intelligence assistance accelerate skill decay and hinder skill development without performers' awareness? *Cognitive Research: Principles and Implications* 9, 46. https://doi.org/10.1186/s41235-024-00572-8 — checked 2026-10-10 (Crossref abstract; theoretical perspective).
15. Cash, T. N., Kelly, M. O., Macnamara, B. N. & Risko, E. F. (2026). Is AI making us stupid? *Trends in Cognitive Sciences* 30(8), 673-675. https://doi.org/10.1016/j.tics.2026.06.004 — checked 2026-10-10 (Crossref metadata only).
16. Kosmyna, N. et al. (2025). Your brain on ChatGPT: accumulation of cognitive debt when using an AI assistant for essay writing task. **Preprint**, arXiv:2506.08872. https://arxiv.org/abs/2506.08872 — checked 2026-10-10 (abstract only).
