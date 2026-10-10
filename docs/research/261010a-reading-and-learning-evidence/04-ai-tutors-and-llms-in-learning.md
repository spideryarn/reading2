# AI tutors and LLM help: do they help you learn, or just help you perform?

Up: [reading-research-overview.md](../../project/reading-research-overview.md) · part of the
[reading and learning evidence library](digest.md), 2026-10-10.

The question: when a language model helps someone study, do they learn more, or do they only do better *while the model is there*? The short answer from 2023–2026 is that it depends almost entirely on what the model is allowed to do. A model that hands over answers lifts performance with the tool and can leave people no better, or worse, once it is taken away. A model built to hint, ask and withhold, or one used to ask for explanations rather than solutions, can protect learning, and in one well-built case beat a good human-run lesson. Almost none of this evidence is about expert adults reading research papers, and almost none measures learning more than a few days later.

## The short answer

- Unrestricted LLM help raises scores on the tool-assisted task but can lower unassisted performance afterwards: the clearest field experiment found a 17% drop on a closed-book exam after a plain GPT-4 chat, and no drop with a hint-giving tutor prompt. (**Moderate certainty · Indirect**)
- A tightly designed, pedagogy-scripted AI tutor beat in-class active learning in one RCT at Harvard (immediate post-test, introductory physics), in less time. One course, designed by the people who tested it, no delayed test. (**Low–Moderate certainty · Indirect**)
- *How* people use the model seems to matter more than *whether* they have it: asking for explanations went with better understanding, asking for solutions with worse. Exploratory, from a preprint. (**Low certainty · Indirect**)
- Where the learning was reading, LLM-only study did worse on a three-day delayed test than note-taking alone or note-taking plus the LLM; students nonetheless preferred the LLM. (**Moderate certainty · Analogy**: 14–15-year-olds, history passages, ChatGPT 3.5)
- Using an LLM instead of web search lowers reported mental effort, and in these experiments the reasoning or advice produced was weaker; but knowledge was rarely tested objectively. (**Low–Moderate certainty · Indirect**)
- People using LLMs tend to overrate what they have learned. (**Low–Moderate certainty · Indirect**)
- Pre-LLM intelligent tutoring systems show a median gain of about 0.66 SD, mostly on locally written tests, for step-by-step problem solving rather than reading. (**Moderate certainty · Analogy**)
- A 2025 meta-analysis reporting a very large ChatGPT effect (g = 0.87) is marked as retracted and should not be cited. (**Contested**)

## The evidence

### 1. Unguarded versus guarded LLMs: the field experiment

**Bastani et al. 2025** (*PNAS*; [1]). Design: classroom-randomised trial at one Turkish high school, Fall 2023, nearly 1,000 students in about 50 classes, grades 9–11, four 90-minute maths review sessions. Three arms: control (books and notes), "GPT Base" (a ChatGPT-like GPT-4 interface), and "GPT Tutor" (same interface, with teacher-supplied solutions, common mistakes, and instructions to give hints rather than answers). Each session ended with a closed-book, closed-laptop exam. The preregistered primary outcome was the unassisted exam.

| Arm | Practice (with AI) | Exam (no AI) |
|---|---|---|
| GPT Base | +0.137 (SE 0.031), about +48% | −0.054 (SE 0.022), about −17% |
| GPT Tutor | +0.361 (SE 0.032), about +127% | −0.004 (SE 0.013), not significant |

(Control means: practice 0.284, exam 0.321, normalised 0–1.) So the guarded tutor largely removed the harm but did **not** produce an exam gain. GPT Base was right only about 51% of the time in the authors' tests, but its errors did not carry into exam answers, which the authors read as students copying rather than being misled. GPT Base students did not think they had learned less; GPT Tutor students thought they had performed better despite no exam gain. Limits (the authors'): one school, one subject, one semester when generative AI was new, short-term outcomes only, mechanisms inferred observationally. A published correction exists (see Not verified). (**Moderate certainty · Indirect**: adolescents, maths practice, not reading.)

### 2. When a purpose-built tutor does help

**Kestin et al. 2025** (*Scientific Reports*; [2]). Crossover RCT in Harvard's introductory physics course for life-science students, Fall 2023; 194 students analysed, assigned in groups of two or three. Each student had one AI-tutored lesson and one in-class active-learning lesson on different topics, order reversed between groups, identical content. The tutor used pre-written step-by-step solutions. Median post-test 4.5 (AI) versus 3.5 (in-class) from a pre-test median of 2.75; regression effect size 0.63 (the authors call it an underestimate because of ceiling effects), quantile regression 0.73–1.3 SD; Cohen's d and confidence intervals not reported. Median AI time on task 49 minutes against an assumed 60. The post-test came immediately; there was **no delayed retention test**. Authors' caveats: ceiling effects, introductory material, one institution, and several authors developed both the tutor and the active-learning method. (**Low–Moderate certainty · Indirect**: undergraduates, problem-solving topics, immediate test.)

### 3. Usage patterns, in the field and the lab

**Lehmann, Cornelius & Sting** (arXiv preprint, v2 March 2025; **not peer-reviewed**; [3]). A field study in two Dutch graduate Python courses (113 students) inferred ChatGPT use from code similarity: similarity raised the grade on the same question (+0.18) but lowered later grades (about −0.02 per unit of cumulative similarity; about −0.06 in the instrumented version). Two pre-registered lab experiments (a Python lesson; 107 and 69 students) found **no overall effect** of ChatGPT access on the post-test (for example 7.9 control versus 9.0 treated, p = 0.206). Exploratory analyses: requesting solutions was linked to lower understanding, requesting explanations to higher; benefits were concentrated among students with higher pre-test scores (the gap widened); treated students rated their learning higher even after adjusting for actual learning. A search-result summary said students without prior knowledge gained more; the paper's own text says the gap widened, so I follow the paper. (**Low certainty · Indirect**: the usage-pattern claims are exploratory.)

**Fan et al. 2025** (*BJET* 56(2); [4]). Randomised lab experiment, 117 university students revising an essay with ChatGPT, a human expert, a checklist tool, or nothing. The ChatGPT group improved essay scores most, but knowledge gain and transfer did not differ significantly between groups; the ChatGPT group showed fewer self-regulation processes (evaluation, orientation), which the authors call "metacognitive laziness". I saw the journal abstract and the preprint's tables, not the inferential statistics. Mean essay improvement in the preprint table: 3.60 (SD 3.14) for ChatGPT against 1.63 (SD 1.98) for control. "Metacognitive laziness" is the authors' interpretive label for process data, not a measured trait. (**Low–Moderate certainty · Indirect**)

### 4. LLM versus search, and learning from reading

**Kreijkes et al. 2025** (*Computers & Education* 243; [5]; abstract and press release only). Pre-registered RCT with within- and between-participant elements, 405 students aged 14–15 in seven English schools, two history passages (apartheid; the Cuban missile crisis), ChatGPT 3.5. Conditions: LLM alone, note-taking alone, LLM plus notes. A surprise comprehension and retention test came three days later. Note-taking alone, and notes plus LLM, beat LLM alone on both; most students preferred the LLM and found it more helpful. The authors suggest LLMs help with first understanding and interest while notes support engagement and memory. I could not see effect sizes. This is the most reading-specific item in the set. (**Moderate certainty · Analogy**: teenagers, short passages, an early model.)

**Stadler, Bannert & Sailer 2024** (*Computers in Human Behavior* 160; [6]; abstract only). 91 university students researched nanoparticles in sunscreen with ChatGPT 3.5 or Google. LLM users reported significantly lower cognitive load and produced lower-quality reasoning and argumentation in their recommendations. (**Low–Moderate certainty · Indirect**: a single task.)

**Melumad & Yun 2025** (*PNAS Nexus* 4; [7]; full text, truncated before the supplement). Seven experiments, 10,462 online and lab participants, on everyday topics (gardening, a healthy lifestyle, a scam). Learning from an LLM summary rather than web links meant less time searching, lower self-reported learning, and shorter, less original advice written afterwards. **No objective knowledge test was used** in the main experiments, so "shallower knowledge" rests on self-report and the advice text. (**Low certainty · Indirect**)

### 5. Baseline: older tutoring systems, and a field trial in Nigeria

**Kulik & Fletcher 2016** (*Review of Educational Research* 86(1); [8]; abstract only, via a library copy). 50 controlled evaluations of intelligent tutoring systems (rule-based tutors giving step-by-step feedback). Median effect 0.66 SD over conventional teaching (50th to about 75th percentile); much larger on locally developed tests than standardised ones, so alignment between test and teaching inflates results; evaluations with nonconventional controls or flawed implementation were excluded and had small effects. (**Moderate certainty · Analogy**.) **Ma et al. 2014** (*Journal of Educational Psychology*) is the other standard meta-analysis; I could not open it, so I give no numbers (Not verified).

**De Simone et al. 2025** (World Bank working paper, **not peer-reviewed**; [9]; read through the authors' blog summary only). A six-week after-school RCT in Edo State, Nigeria, with a GPT-4-based tutor and teachers present; about 0.3 SD overall and 0.24 in English, rising with attendance. The authors stress that the effect belongs to the whole package (structured prompts, curriculum alignment, teacher support), that durability is unknown, and the blog gives no sample size. (**Low certainty · Analogy**)

## Where it is weak, contested or contrary

- **Almost no one measures delayed learning**, and almost no one studies adults reading dense text. Kreijkes (three days) is the nearest; Kestin has no delayed test and Melumad no objective test. The typical participant is a schoolchild or undergraduate doing maths, physics, coding or short passages.
- **Effects depend on model era.** These studies used GPT-3.5 or early GPT-4 in 2023–2024. Current models are better at hinting, and a Bastani-style tutor prompt is now easy to write. We cannot assume the harms or the benefits carry over unchanged.
- **Guardrails remove harm more convincingly than they add learning.** Bastani's guarded arm had a null exam effect. Only the heavily engineered Kestin tutor shows a clear gain, and its designers ran the trial.
- **Self-reports do a lot of work** in the LLM-versus-search literature (Melumad; Stadler's load ratings). Perceived ease and perceived learning are not learning.
- **A headline meta-analysis is marked retracted.** Wang & Fan 2025 (*Humanities and Social Sciences Communications*; [10]), reporting g = 0.87 for ChatGPT on learning performance across 51 studies, carries a "RETRACTED ARTICLE" label on its indexing record. I did not find the notice's reasons. Treat pooled positive claims about ChatGPT in education as fragile.
- **Interpretive coinages.** "Metacognitive laziness" (Fan) is an interpretation, not a measured construct. Brain-activity preprints on ChatGPT use are deliberately excluded.
- **Independence.** The Harvard authors built what they tested; Kreijkes involves a firm that invests in generative AI. Neither invalidates the results, but I found no independent replication of any headline finding.

## What it means for Spideryarn

Spideryarn's principle is that AI augments reading rather than replacing it ([vision.md](../../project/vision.md)). This evidence broadly supports the principle, but says little about this population of readers.

### Learn mode
**Today:** the reader says what they remember; the model corrects at most once, cites the passage, and nudges them to remember more, filling the gap only when they are stuck. The reader must have read the piece first, which is the structural reason it is not the anti-goal ([learn-mode.md](../../project/learn-mode.md#why-this-one-is-not-the-anti-goal)).
**Supports:** the nearest cousins are Bastani's guarded tutor (hints, not answers) and Lehmann's pattern that explanations beat solutions. Learn puts the reader's own recall first, which is where the unguarded harm lay.
**Suggests a change (proposal):** Bastani's guarded arm felt better than it tested, so the "filled when stuck" path deserves watching; an unassisted re-check of the same passage some days later would show whether Learn changes anything beyond the session.
**Untested:** no study tests a recall-first conversational tutor on adults reading research papers.

### Tutorial (guided reading)
**Today:** a reader who has not read the piece may start here; every piece taught is a short quotation or close paraphrase with its block id, sending them into the passage ([learn-mode.md](../../project/learn-mode.md#why-this-one-is-not-the-anti-goal)).
**Supports / suggests a change (proposal):** Kreijkes suggests an LLM helps first understanding but not retention unless the reader does their own active work. One idea: close a Tutorial pass by inviting a note or a Learn turn, so the AI-led pass is followed by something the reader produces.
**Untested:** Tutorial itself.

### Chat and the tools it can call
**Today:** a tool loop where the model can search the web and reach the reader's own notes and other articles, with citations to block ids ([chat-tools.md](../../project/chat-tools.md)). Learn's doc names chat as the nearest thing to the "chatbot with the article stuffed in the context window" anti-goal.
**Supports:** block-id citations send the reader back to the text, which answers Melumad's worry about summaries replacing sources (an inference; nobody has tested it).
**Suggests a change (proposal):** Lehmann and Kreijkes suggest nudging chat toward "explain this" and "where does the piece say…" rather than "give me the answer", while Stadler and Melumad suggest the risk is low effort and weaker reasoning. A "have a go first" prompt or a save-as-note step could be tried.
**Untested:** whether citations change reader behaviour.

### Live conversation
**Today:** spoken talk with a companion holding the whole piece, stored as ordinary chat rows ([live-conversation.md](../../project/live-conversation.md)).
**Untested:** I found no learning study of spoken versus typed LLM tutoring. Treat it as chat, with the same cautions.

### High-powered AI (Opus instead of Sonnet)
**Today:** a per-article switch moving most capable-tier calls to a stronger model for dense papers ([high-powered-ai.md](../../project/high-powered-ai.md)).
**Supports (weakly):** Bastani found GPT Base wrong about half the time on maths, though errors did not drive the harm. Accuracy matters for trust, but a stronger model does not fix the behavioural problem the unguarded studies found; it may make copying easier.
**Untested:** no study compares model tiers on learning.

## Not verified

- **Bastani correction** (*PNAS*, https://doi.org/10.1073/pnas.2518204122): confirmed to exist as a published erratum; I could not read what it corrected. The numbers above come from the original; check before quoting.
- **Ma, Adesope, Nesbit & Liu 2014**, *Journal of Educational Psychology* 106(4), https://doi.org/10.1037/a0037123: title and journal confirmed via Crossref; abstract not retrievable.
- **Darvishi et al. 2024**, *Computers & Education* 210, 104967 (AI peer-feedback prompts removed; 1,625 students): seen only in a secondary report and a catalogue entry; not opened, DOI not checked.
- **"ChatGPT as a cognitive crutch: a randomized controlled trial on knowledge retention"** (ScienceDirect, 2025): found in search, could not open.
- **Deng et al. 2025**, *Computers & Education* review of 69 ChatGPT experiments: seen in a search summary only.
- **Kosmyna et al. 2025** (EEG, ChatGPT essays): preprint, deliberately excluded.

## Search log

Web search (standard and extended) for each named lead plus "meta-analysis ChatGPT learning performance 2025", "LLM chatbot reading comprehension randomized experiment", and "Melumad Yun LLM versus web search". Crossref used for title and DOI checks (several calls hit 429 rate limits; Semantic Scholar metadata was used in their place for some). Europe PMC REST API supplied full text for Bastani (PMC12232635), Kestin (PMC12179260) and Melumad (PMC12560091). PNAS, Nature, ScienceDirect, Wiley, SAGE and the PMC site returned 403 or a verification screen. Citation chaining was limited to what the searches surfaced. Retraction found: Wang & Fan 2025. Correction found: Bastani 2025. Null results: Lehmann's two pre-registered lab experiments; Fan's knowledge gain and transfer.

## Sources

1. Bastani et al. (2025). Generative AI without guardrails can harm learning: Evidence from high school mathematics. *PNAS* 122(26), e2422633122. https://doi.org/10.1073/pnas.2422633122 — checked 2026-10-10 (full text via Europe PMC; title confirmed in Crossref).
2. Kestin et al. (2025). AI tutoring outperforms in-class active learning: an RCT introducing a novel research-based design in an authentic educational setting. *Scientific Reports* 15. https://doi.org/10.1038/s41598-025-97652-6 — checked 2026-10-10 (full text via Europe PMC; title confirmed in Crossref).
3. Lehmann, M., Cornelius, P. B., & Sting, F. J. (2025). AI meets the classroom: When do large language models harm learning? arXiv:2409.09047 v2. https://doi.org/10.48550/arXiv.2409.09047 — **preprint**; checked 2026-10-10 (full text, first 100,000 characters).
4. Fan, Y., Tang, L., Le, H., Shen, K., Tan, S., Zhao, Y., Shen, Y., Li, X., & Gašević, D. (2025). Beware of metacognitive laziness: Effects of generative artificial intelligence on learning motivation, processes, and performance. *British Journal of Educational Technology* 56(2), 489–530. https://doi.org/10.1111/bjet.13544 — checked 2026-10-10 (abstract and Crossref metadata; tables from the arXiv preprint 2412.09315).
5. Kreijkes, P., Kewenig, V., Kuvalja, M., Lee, M., Vitello, S., Hofman, J. M., Sellen, A., Rintel, S., Goldstein, D. G., Rothschild, D. M., Tankelevitch, L., & Oates, T. (2025). Effects of LLM use and note-taking on reading comprehension and memory: A randomised experiment in secondary schools. *Computers & Education* 243, 105514. https://doi.org/10.1016/j.compedu.2025.105514 — checked 2026-10-10 (abstract only, via the Microsoft Research page; Crossref confirmed; press release for design detail).
6. Stadler, M., Bannert, M., & Sailer, M. (2024). Cognitive ease at a cost: LLMs reduce mental effort but compromise depth in student scientific inquiry. *Computers in Human Behavior* 160, 108386. https://doi.org/10.1016/j.chb.2024.108386 — checked 2026-10-10 (abstract only, via the TUM research portal).
7. Melumad, S., & Yun, J. H. (2025). Experimental evidence of the effects of large language models versus web search on depth of learning. *PNAS Nexus* 4(10), pgaf316. https://doi.org/10.1093/pnasnexus/pgaf316 — checked 2026-10-10 (full text via Europe PMC, up to the supplement).
8. Kulik, J. A., & Fletcher, J. D. (2016). Effectiveness of intelligent tutoring systems: A meta-analytic review. *Review of Educational Research* 86(1), 42–78. https://doi.org/10.3102/0034654315581420 — checked 2026-10-10 (abstract only, via a library copy; Crossref confirmed).
9. De Simone, M. E., et al. (2025). From chalkboards to chatbots: Evaluating the impact of generative AI on learning outcomes in Nigeria. World Bank working paper. https://openknowledge.worldbank.org/entities/publication/15e1ff08-15ae-4f7a-b2a8-d146e6c113ee/full — **working paper, not peer-reviewed**; paper not opened (403); read via the authors' blog https://blogs.worldbank.org/en/developmenttalk/addressing-the-learning-crisis-with-generative-ai--lessons-from- (checked 2026-10-10).
10. Wang, J., & Fan, W. (2025). The effect of ChatGPT on students' learning performance, learning perception, and higher-order thinking: insights from a meta-analysis. *Humanities and Social Sciences Communications* 12. https://doi.org/10.1057/s41599-025-04787-y — **marked RETRACTED**; indexing record (ideas.repec.org) read, abstract incomplete; not used as evidence.
