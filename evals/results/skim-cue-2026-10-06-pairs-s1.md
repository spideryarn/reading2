# Blind pairs: two cues for one quoted line

A reader is skimming an article they have **not read**, usually a research paper from a field they have not studied. They are shown one stop at a time: a **cue** (one line written by a model) and then a **quote** (a line cut out of the article). The cue is there to get them ready for the quote. It may say what to look for. It must **not** say what the passage found or concluded: the reader is meant to get that from the passage.

Each pair below is one quote and two candidate cues for it, A and B. You are also shown the quote's own paragraph and the paragraph before it. **The reader does not see those before the cue**; they are there so that you can check a cue against the text.

For each pair, answer three questions:

- **(a) better prepared:** which cue better prepares a reader who has not read the article to understand this quote: so that they know what is at stake, what is being compared, and what words like "this", "the latter" or "their approach" in the quote refer to? `A`, `B` or `tie`.
- **(b) gives it away:** does either cue state what the passage found, concluded or chose, so that the reader has the answer before reading? Asking the question, or naming the options, is not giving it away. `A`, `B`, `both` or `neither`.
- **(c) invents or misstates:** does either cue say something about the context that the paragraphs shown do not support, or that gets them wrong? `A`, `B`, `both` or `neither`.

Judge each pair on its own, only from what is on the page.

## Pair 1

**The paragraph before:** Egor Shibaev Affiliation: Code Modelling Research, JetBrains Research, Munich, Germany Affiliation: Constructor University, Bremen, Germany Vera Kudrevskaia Affiliation: Code Modelling Research, JetBrains Research, Munich, Germany Affiliation: Constructor University, Bremen, Germany Mikhail Evtikhiev Affiliation: Code Modelling Research, JetBrains Research, Paphos, Cyprus Correspondence to: mikhail.evtikhiev@jetbrains.com Ana Terna Affiliation: Code Modelling Research, JetBrains Research, Amsterdam, The Netherlands Rastislav Rabatin Affiliation: Code Modelling Research, JetBrains Research, London, United Kingdom Timur Kudashev Affiliation: Code Modelling Research, JetBrains Research, Munich, Germany Affiliation: Constructor University, Bremen, Germany Timofey Bryksin Affiliation: Code Modelling Research, JetBrains Research, Paphos, Cyprus Arina Puchkova Affiliation: Code Modelling Research, JetBrains Research, Munich, Germany Patrik Bartak Affiliation: Code Modelling Research, JetBrains Research, Amsterdam, The Netherlands Egor Bogomolov Affiliation: Code Modelling Research, JetBrains Research, Amsterdam, The Netherlands Sergey Titov Affiliation: Code Modelling Research, JetBrains Research, Amsterdam, The Netherlands

**The quote's paragraph** [section: Title, authors and abstract]: Post-training papers, model cards, and blog posts often treat scores on a small set of coding benchmarks (e.g., SWE-bench and LiveCodeBench) as evidence of broad “coding capability”, both for research artifacts and user-facing systems. We argue that optimization for these benchmarks leads to measuring task-specific performance, creating a meaning gap between measured scores and claims of general coding ability. We examine this gap with a Django-based case study benchmark suite we create.

**The quote:** We argue that optimization for these benchmarks leads to measuring task-specific performance, creating a meaning gap between measured scores and claims of general coding ability.

**Cue A:** Look for what gap they say separates a benchmark score from a general-ability claim.

**Cue B:** Look for what kind of gap the authors say separates benchmark scores from claims about ability.

---

## Pair 2

**The paragraph before:** This conflation matters because it shapes research priorities. For example, if post-training on SWE-bench trajectories reliably improves general coding capabilities, this approach provides a path towards model improvement. But if it just produces models skilled at SWE-bench-like tasks, the field risks optimizing for the benchmark itself rather than addressing the underlying capability or other coding tasks, severely limiting the impact of this post-training approach. Thus, researchers working on evaluation of coding agents and LLM coding capabilities may be confounded into misinterpreting their results, and engineers relying on their work may make suboptimal deployment decisions.

**The quote's paragraph** [section: Introduction]: Our evidence supports the latter interpretation: post-training gains on SWE-bench do not consistently transfer to other code tasks, even within the same repository. To illustrate this, we build a Django benchmark covering code editing, generation, and completion, and evaluate community-released checkpoints and our fine-tuned models. We observe a consistent pattern across both community-released SWE-bench-oriented checkpoints and models we fine-tune. Models fine-tuned on issue-resolution trajectories do not generally improve on our Django-related tasks or LiveCodeBench (LCB) (Jain et al., 2024), while models fine-tuned on one of the Django tasks do not improve on other Django tasks or LCB. This suggests narrow training recipes drive task-specific specialization, not general coding improvement. Moreover, SWE-bench (and even multi-benchmark) rankings may not always reliably predict relative performance on these modalities. Together, our findings suggest that SWE-bench rankings may systematically misrepresent models’ relative strengths on individual SE tasks, particularly since real-world usage extends beyond agentic issue resolution.

**The quote:** Our evidence supports the latter interpretation: post-training gains on SWE-bench do not consistently transfer to other code tasks, even within the same repository.

**Cue A:** Check whether gains from training on one benchmark carry over to other tasks in the same codebase.

**Cue B:** Notice whether gains from SWE-bench training carried over to other tasks in the same codebase.

---

## Pair 3

**The paragraph before:** 

**The quote's paragraph** [section: Benchmark measurements and capability claims]: These observations do not diminish the value of SWE-bench Verified as a benchmark. However, when a model achieves a high score on SWE-bench Verified, there is no standard way to determine whether the improvement reflects (a) genuine SE capability that transfers to other coding tasks, (b) limited SE capability on this family of tasks, (c) inadvertent optimization for SWE-bench’s specific format, tasks, workflow, or agentic scaffolding, (d) accidental contamination of training dataset, or (e) some mixture of all of the above. This problem is especially pronounced in academic post-training studies, as researchers often cannot afford to run many benchmarks and may mistake within-benchmark gains for general improvements in capability.

**The quote:** However, when a model achieves a high score on SWE-bench Verified, there is no standard way to determine whether the improvement reflects (a) genuine SE capability that transfers to other coding tasks, (b) limited SE capability on this family of tasks, (c) inadvertent optimization for SWE-bench’s specific format, tasks, workflow, or agentic scaffolding, (d) accidental contamination of training dataset, or (e) some mixture of all of the above.

**Cue A:** List the different reasons a high score on a benchmark could occur, besides real skill.

**Cue B:** Count the distinct explanations a high SWE-bench score could have, besides real transferable skill.

---

## Pair 4

**The paragraph before:** Post-trained checkpoints show near-universal failure of cross-task transfer. The meaning gap is more pronounced for post-trained checkpoints. Across both community-released SWE-bench-optimized checkpoints and our fine-tuned variants, improvements are largely confined to the training/evaluation distribution, with little to no consistent gains on our Django benchmark suite and LiveCodeBench. In several cases, performance severely degrades on other tasks (e.g., SWE-agent-LM-7B and OpenHands-LM-32B underperform their base models across multiple benchmarks, failing to follow instructions). Moreover, failures are not uniform: some checkpoints follow instructions and formats reasonably well, yet still do not improve out-of-distribution, making the lack of transfer difficult to detect via qualitative “sanity checks” alone. As LiveCodeBench and our benchmark suite use very different data and test models on different tasks, we speculate this may mean lack of cross-task improvement on other coding tasks as well.

**The quote's paragraph** [section: Discussion]: Benchmarks capture coarse capability differences, but are brittle for fine-grained choices. We do not claim benchmarks are useless. Across model tiers (e.g., small vs. mid-size vs. frontier systems), stronger models tend to outperform weaker ones on most tasks, indicating that coding capabilities do improve over time and scale. The practical problem arises precisely where users most need guidance: choosing between models that are close in headline benchmark scores (e.g., selecting the ”best 8B model”) or, more importantly, checkpoints that are fine-tuned for a specific task. In this regime, a model that edges ahead on SWE-bench can lag behind on completion or repair, so single-leaderboard rankings become unreliable guides for practitioners’ and researchers’ decisions. This is where the meaning gap causes the most harm and where multi-task evaluation or task-specific human-in-the-loop studies are most necessary.

**The quote:** The practical problem arises precisely where users most need guidance: choosing between models that are close in headline benchmark scores (e.g., selecting the ”best 8B model”) or, more importantly, checkpoints that are fine-tuned for a specific task. In this regime, a model that edges ahead on SWE-bench can lag behind on completion or repair, so single-leaderboard rankings become unreliable guides for practitioners’ and researchers’ decisions.

**Cue A:** Ask when single leaderboard rankings become least reliable for choosing between models.

**Cue B:** Ask when a single leaderboard stops being a reliable way to pick between models.

---

## Pair 5

**The paragraph before:** These can be run as model–vs–model competitions with standardized rules, potentially sponsored by model developers. The results can be reported as a public leaderboard if the protocol is transparent and robust enough to avoid becoming another easily optimized proxy. While costly, a holistic evaluation targets the meaning gap directly: it measures performance when tasks are underspecified, requirements drift, and success requires adaptive problem-solving.

**The quote's paragraph** [section: Discussion]: Evaluation approaches in practice. These approaches are complementary. For frontier foundation models, holistic assessments (and carefully designed human studies) should be the most informative. For research on incremental techniques and smaller models, benchmark suites should provide a practical and scalable way to detect narrow vs. broad improvements. Single-score benchmarks are useful for rapid iteration, but should not be treated as decisive evidence. For narrow practical tasks such as fine-tuning a model on a private repository for internal usage, task-specific human-in-the-loop setups should be the most actionable: general leaderboards are unreliable guides for models close in capability. This approach can surface narrow failure modes that public benchmarks miss.

**The quote:** For frontier foundation models, holistic assessments (and carefully designed human studies) should be the most informative. For research on incremental techniques and smaller models, benchmark suites should provide a practical and scalable way to detect narrow vs. broad improvements. Single-score benchmarks are useful for rapid iteration, but should not be treated as decisive evidence. For narrow practical tasks such as fine-tuning a model on a private repository for internal usage, task-specific human-in-the-loop setups should be the most actionable: general leaderboards are unreliable guides for models close in capability.

**Cue A:** Match each kind of evaluation method to the kind of decision it best supports.

**Cue B:** Look for which evaluation method is matched to which kind of decision.

---

## Pair 6

**The paragraph before:** LLM, benchmarks, evaluation, machine learning for software engineering

**The quote's paragraph** [section: Introduction]: The deep learning for code (DL-for-code) community has converged on a narrow evaluation paradigm. On one end, researchers use self-contained algorithmic tasks, such as HumanEval, that are convenient for benchmarking, yet only weakly resemble real-world software development. On the other end, SWE-bench (Jimenez et al., 2024) became the de facto standard for measuring “real-world” coding ability, with leaderboard rankings frequently interpreted as proxies for general coding capability. “General coding capability” is a latent factor explaining positive correlations in model performance across diverse programming tasks, distinct from narrow task-specific skills. It is similar to the definition of intelligence by Chollet (Chollet, 2019). This convergence has driven a remarkable engineering effort: complex post-training approaches, specialized agent architectures, and training pipelines specifically designed to maximize SWE-bench scores (Zeng et al., 2025; Pan et al., 2024).

**The quote:** “General coding capability” is a latent factor explaining positive correlations in model performance across diverse programming tasks, distinct from narrow task-specific skills.

**Cue A:** Consider what kind of thing 'general coding capability' is supposed to be, if not a score.

**Cue B:** Notice how the authors describe general coding skill as something hidden rather than directly measured.

---

## Pair 7

**The paragraph before:** The deep learning for code (DL-for-code) community has converged on a narrow evaluation paradigm. On one end, researchers use self-contained algorithmic tasks, such as HumanEval, that are convenient for benchmarking, yet only weakly resemble real-world software development. On the other end, SWE-bench (Jimenez et al., 2024) became the de facto standard for measuring “real-world” coding ability, with leaderboard rankings frequently interpreted as proxies for general coding capability. “General coding capability” is a latent factor explaining positive correlations in model performance across diverse programming tasks, distinct from narrow task-specific skills. It is similar to the definition of intelligence by Chollet (Chollet, 2019). This convergence has driven a remarkable engineering effort: complex post-training approaches, specialized agent architectures, and training pipelines specifically designed to maximize SWE-bench scores (Zeng et al., 2025; Pan et al., 2024).

**The quote's paragraph** [section: Introduction]: SWE-bench scores may indeed correlate with genuine progress in coding. Recent generations of foundation models show clear improvements across many coding-related behaviors, and agents combined with frontier proprietary models are now widely used in practice (Christian Mürtz, 2025). However, the current structure of SWE-bench and other coding benchmarks often cannot tell us why scores improve. SWE-bench-style performance mixes multiple factors: repository understanding, patch synthesis, tool use, search and retrieval strategies, and adherence to a particular workflow and output format. It is thus difficult to identify the true driver of improvement without deep analysis. For the foundation models, improvements are typically reported across a broad range of benchmarks, including non-coding ones, providing stronger evidence of genuine gains in general intelligence. In contrast, many post-training papers report improvements primarily on SWE-bench (or a small cluster of similar benchmarks), providing a potentially limited and ambiguous signal about generalization and changes in underlying capabilities.

**The quote:** However, the current structure of SWE-bench and other coding benchmarks often cannot tell us why scores improve. SWE-bench-style performance mixes multiple factors: repository understanding, patch synthesis, tool use, search and retrieval strategies, and adherence to a particular workflow and output format.

**Cue A:** List the different ingredients that get mixed together in a SWE-bench-style score.

**Cue B:** Ask what separate skills get blended together inside a single benchmark score.

---

## Pair 8

**The paragraph before:** Repository snapshot. We choose Django because it constitutes 46% of SWE-bench Verified. All tasks are derived from a snapshot at version 4.0.4.11 1 commit hash \(89807fbde8b7b17d00434bc4695535855e96fe77\), date: 11th Apr 2022.

**The quote's paragraph** [section: Evidence from a Django case study]: This choice enables a simple and testable prediction: if SWE-bench-optimized checkpoints truly improve transferable repository-level SE ability (rather than specializing to SWE-bench’s workflow and distribution), then they should also improve on Django-centric tasks within the same codebase. Thus, we test cross-task transfer for relatively close tasks that come from data distribution close to SWE-bench’s. We describe repository selection, data statistics, and data curation in appendix B.1.

**The quote:** This choice enables a simple and testable prediction: if SWE-bench-optimized checkpoints truly improve transferable repository-level SE ability (rather than specializing to SWE-bench’s workflow and distribution), then they should also improve on Django-centric tasks within the same codebase.

**Cue A:** Look for the prediction this test setup is designed to check.

**Cue B:** Look for the specific prediction the authors use to test whether training produced transfer.

---

## Pair 9

**The paragraph before:** Table 2: Cross-task transfer diagnostics for task-specific fine-tuning Generation Completion Repair LCB Fine-tuning score \(\Delta\) score \(\Delta\) score \(\Delta\) score \(\Delta\) Qwen2.5-Coder-32B Base Model \(64.07\) – \(60.17\) – \(47.35\) – \(28.20\) – Generation \(71.03\) \(6.96\) \(54.60\) \(-5.57\) \(42.90\) \(-4.45\) \(22.90\) \(-5.30\) Completion \(66.02\) \(1.95\) \(74.65\) \(14.48\) \(24.51\) \(-22.84\) \(25.20\) \(-2.90\) Repair \(69.08\) \(5.01\) \(56.82\) \(-3.35\) \(56.27\) \(8.92\) \(25.50\) \(-2.60\) Qwen2.5-Coder-7B Base Model \(52.92\) – \(50.97\) – \(17.83\) – \(15.20\) – Generation \(58.22\) \(5.30\) \(50.14\) \(-0.83\) \(15.88\) \(-1.95\) \(16.40\) \(1.20\) Completion \(19.77\) \(-33.15\) \(64.07\) \(13.10\) \(1.39\) \(-16.44\) \(15.00\) \(-0.3\) Repair \(55.71\) \(2.79\) \(51.25\) \(0.28\) \(40.95\) \(23.12\) \(15.00\) \(-0.3\)

**The quote's paragraph** [section: Evidence from a Django case study]: Task-specific fine-tuning: strong within-task gains, weak transfer. Table 2 reports our fine-tuning experiments. In most cases, our fine-tuning reliably improves within-task model performance (e.g., repair-tuned models improve on repair), but we do not observe consistent improvements on other modalities, including LiveCodeBench. Across all six settings, fine-tuning improves performance on the trained modality (six improvements and no degradations). For cross-task transfer, we observe a pattern consistent with no improvement in capabilities, similar to public checkpoints. Across 18 cross-task comparisons (each fine-tuned checkpoint evaluated on three held-out benchmarks), we observe five improvements and 13 degradations. The low scores for Qwen2.5-Coder-7B-Instruct fine-tuned on code completion reflect overfitting to the output format.

**The quote:** Across all six settings, fine-tuning improves performance on the trained modality (six improvements and no degradations). For cross-task transfer, we observe a pattern consistent with no improvement in capabilities, similar to public checkpoints. Across 18 cross-task comparisons (each fine-tuned checkpoint evaluated on three held-out benchmarks), we observe five improvements and 13 degradations.

**Cue A:** Compare how fine-tuning affects the trained task versus held-out tasks.

**Cue B:** Compare how fine-tuning affected the trained task versus held-out tasks.

---

## Pair 10

**The paragraph before:** Task-specific fine-tuning: strong within-task gains, weak transfer. Table 2 reports our fine-tuning experiments. In most cases, our fine-tuning reliably improves within-task model performance (e.g., repair-tuned models improve on repair), but we do not observe consistent improvements on other modalities, including LiveCodeBench. Across all six settings, fine-tuning improves performance on the trained modality (six improvements and no degradations). For cross-task transfer, we observe a pattern consistent with no improvement in capabilities, similar to public checkpoints. Across 18 cross-task comparisons (each fine-tuned checkpoint evaluated on three held-out benchmarks), we observe five improvements and 13 degradations. The low scores for Qwen2.5-Coder-7B-Instruct fine-tuned on code completion reflect overfitting to the output format.

**The quote's paragraph** [section: Evidence from a Django case study]: These results support our claim: reasonable fine-tuning with within-task evaluation (practical from an effort standpoint) may mislead practitioners into perceiving a ”capability jump” that largely reflects task-specific specialization rather than transferable coding ability. Notably, excluding output format failures, we observe no difference in cross-task transfer between our benchmarks and LiveCodeBench despite their widely different task distributions. This cross-task regression matters for LLM and coding agent development reliability: a checkpoint optimized for one workflow may be worse on other ones.

**The quote:** These results support our claim: reasonable fine-tuning with within-task evaluation (practical from an effort standpoint) may mislead practitioners into perceiving a ”capability jump” that largely reflects task-specific specialization rather than transferable coding ability.

**Cue A:** Ask what kind of 'capability jump' might be an illusion here.

**Cue B:** Ask what illusion practitioners might fall for if they only check within-task performance.

---

## Pair 11

**The paragraph before:** We believe this is addressable institutionally: targeted grants (including industry sponsorship), conference tracks and workshops that reward ongoing maintenance (e.g., new versions, repaired instances, and contamination audits), not just initial releases, treating benchmarks as first-class research artifacts. Without recognizing benchmark maintenance as essential research infrastructure, the existence and support of benchmarks like SWE-Bench-Pro, SWE-rebench (Badertdinov et al., 2025), or LiveCodeBench depend on the chance and goodwill of a small number of individuals.

**The quote's paragraph** [section: Discussion]: The second obstacle is a construct validity problem: a benchmark suite is a good proxy for “general coding capability” only to the extent that it is built on a clear and correct taxonomy of coding skills and behaviours it aims to measure. In addition to the general construct validity questions raised by (Bean et al., 2025), a robust suite requires the community to answer (at least) the questions below:

**The quote:** The second obstacle is a construct validity problem: a benchmark suite is a good proxy for “general coding capability” only to the extent that it is built on a clear and correct taxonomy of coding skills and behaviours it aims to measure.

**Cue A:** Notice what a benchmark suite needs to rest on to be a good proxy for ability.

**Cue B:** Ask what a benchmark suite needs to rest on to be a good proxy for coding ability.

---

## Pair 12

**The paragraph before:** A related alternative is qualitative evaluation, exemplified by Yang et al. (Yang et al., 2025b), which examines how and why models fail, what distinguishes success from failure, and what patterns emerge across cases. Such analysis reveals capability boundaries invisible in summary statistics—whether models fail on long-range dependencies, specification understanding, or semantic correctness despite syntactic validity. We view qualitative analysis as a valuable complement to quantitative evaluation, not a replacement, and believe qualitative findings can inform better benchmark design that addresses common failure modes. However, the need for reliable quantitative comparison remains.

**The quote's paragraph** [section: Alternative views]: Another possible counterargument is that the evaluation system is self-correcting. For example, the emergence of SWE-bench and LiveCodeBench addresses the limitations of HumanEval: limited task scope and contamination, respectively. We are less optimistic: benchmark gains are now read as capability gains, masking failures to transfer and creating selection pressure for Goodhart’s law-like effects to appear (Manheim and Garrabrant, 2018). It also takes time for the community to change the benchmark of choice: while first concerns about leaks and test quality in SWE-bench first appeared in 2024 (Aleithan et al., 2024), SWE-bench is still the most popular benchmark for evaluating LLMs on SE tasks. One of the goals of our contribution is to show the limitations of self-correction feedback.

**The quote:** We are less optimistic: benchmark gains are now read as capability gains, masking failures to transfer and creating selection pressure for Goodhart’s law-like effects to appear (Manheim and Garrabrant, 2018).

**Cue A:** Look for why the authors are skeptical that benchmarking alone will self-correct.

**Cue B:** Ask why rising benchmark scores might mask rather than reveal transfer failures.

---

## Pair 13

**The paragraph before:** SWE-bench scores may indeed correlate with genuine progress in coding. Recent generations of foundation models show clear improvements across many coding-related behaviors, and agents combined with frontier proprietary models are now widely used in practice (Christian Mürtz, 2025). However, the current structure of SWE-bench and other coding benchmarks often cannot tell us why scores improve. SWE-bench-style performance mixes multiple factors: repository understanding, patch synthesis, tool use, search and retrieval strategies, and adherence to a particular workflow and output format. It is thus difficult to identify the true driver of improvement without deep analysis. For the foundation models, improvements are typically reported across a broad range of benchmarks, including non-coding ones, providing stronger evidence of genuine gains in general intelligence. In contrast, many post-training papers report improvements primarily on SWE-bench (or a small cluster of similar benchmarks), providing a potentially limited and ambiguous signal about generalization and changes in underlying capabilities.

**The quote's paragraph** [section: Introduction]: This conflation matters because it shapes research priorities. For example, if post-training on SWE-bench trajectories reliably improves general coding capabilities, this approach provides a path towards model improvement. But if it just produces models skilled at SWE-bench-like tasks, the field risks optimizing for the benchmark itself rather than addressing the underlying capability or other coding tasks, severely limiting the impact of this post-training approach. Thus, researchers working on evaluation of coding agents and LLM coding capabilities may be confounded into misinterpreting their results, and engineers relying on their work may make suboptimal deployment decisions.

**The quote:** For example, if post-training on SWE-bench trajectories reliably improves general coding capabilities, this approach provides a path towards model improvement. But if it just produces models skilled at SWE-bench-like tasks, the field risks optimizing for the benchmark itself rather than addressing the underlying capability or other coding tasks, severely limiting the impact of this post-training approach.

**Cue A:** Consider what is at stake for the field if training on one benchmark only helps that benchmark.

**Cue B:** Weigh the two possible outcomes of post-training on SWE-bench traces and what each would mean.

---

## Pair 14

**The paragraph before:** Our evidence supports the latter interpretation: post-training gains on SWE-bench do not consistently transfer to other code tasks, even within the same repository. To illustrate this, we build a Django benchmark covering code editing, generation, and completion, and evaluate community-released checkpoints and our fine-tuned models. We observe a consistent pattern across both community-released SWE-bench-oriented checkpoints and models we fine-tune. Models fine-tuned on issue-resolution trajectories do not generally improve on our Django-related tasks or LiveCodeBench (LCB) (Jain et al., 2024), while models fine-tuned on one of the Django tasks do not improve on other Django tasks or LCB. This suggests narrow training recipes drive task-specific specialization, not general coding improvement. Moreover, SWE-bench (and even multi-benchmark) rankings may not always reliably predict relative performance on these modalities. Together, our findings suggest that SWE-bench rankings may systematically misrepresent models’ relative strengths on individual SE tasks, particularly since real-world usage extends beyond agentic issue resolution.

**The quote's paragraph** [section: Introduction]: In this position paper, we argue that this mismatch between performance on different benchmarks reflects a construct validity problem: when a small number of benchmarks is treated as a proxy for “general coding capability,” the resulting claims exceed what the measurements can actually support. SWE-bench targets a complex but specific behavior that involves navigating repositories, understanding issue descriptions, and producing targeted patches. These measurements may mix multiple underlying capabilities with narrow task-specific skills. High performance may indicate strong coding ability, but may equally reflect proficiency at the particular format and workflow developed under benchmark optimization pressure. Without evaluation across diverse task modalities, we cannot distinguish among these hypotheses, understand the strengths and weaknesses of our post-training approaches, or even assess the foundation models with sufficient granularity. The resulting misnterpretation can then spread to engineers and users working with LLMs and agents, as LLM-assisted coding and coding agents become increasingly common, and, in the end, undermine their trust in these systems.

**The quote:** High performance may indicate strong coding ability, but may equally reflect proficiency at the particular format and workflow developed under benchmark optimization pressure. Without evaluation across diverse task modalities, we cannot distinguish among these hypotheses, understand the strengths and weaknesses of our post-training approaches, or even assess the foundation models with sufficient granularity.

**Cue A:** Ask what high performance might instead reflect besides real coding ability.

**Cue B:** Think about what evidence would be needed to tell a real skill gain from mere format-matching.

---

## Pair 15

**The paragraph before:** These limitations become even more pronounced for post-training checkpoints. Compared to releases of foundation models, post-training papers face page limits, computational costs of evaluation (Jordan et al., 2024), and the engineering overhead of adopting additional harnesses. As a result, single-benchmark evaluations are often the pragmatic default rather than an exception.

**The quote's paragraph** [section: Background]: This constraint produces a typical pattern: post-training works tend to evaluate on benchmarks aligned with their intended contribution. Works targeting repository-level SE commonly report only SWE-bench performance (e.g., Lingma SWE-GPT (Ma et al., 2024), R2EGym-Agent (Jain et al., 2025), SWE-agent-LM (Yang et al., 2025b), Skywork-SWE (Zeng et al., 2025), DeepSWE-Preview (Luo et al., 2025)). On the other hand, studies focused on developing general post-training techniques often evaluate on self-contained suites like HumanEval (e.g., (Wei et al., 2024), (Tang et al., 2025), (Yu et al., 2024b)). While perfectly rational, this evaluation approach does not allow distinguishing whether the improvement comes from task-specific optimization or reflects a general improvement of coding capability. Capability generalization cannot be taken for granted: Yu et al. (Yu et al., 2024a) show cases where instruction tuning improves algorithmic benchmark scores without commensurate gains on the underlying behavior. This cited pattern we find undesirable motivates our position. To support it, we directly test cross-task transfer by evaluating checkpoints trained on specific tasks across multiple SE modalities.

**The quote:** Capability generalization cannot be taken for granted: Yu et al. (Yu et al., 2024a) show cases where instruction tuning improves algorithmic benchmark scores without commensurate gains on the underlying behavior.

**Cue A:** Look for an example where a benchmark score rose without a matching real-behavior gain.

**Cue B:** Look for an earlier finding where a benchmark score rose without a matching real-world gain.

---

## Pair 16

**The paragraph before:** This constraint produces a typical pattern: post-training works tend to evaluate on benchmarks aligned with their intended contribution. Works targeting repository-level SE commonly report only SWE-bench performance (e.g., Lingma SWE-GPT (Ma et al., 2024), R2EGym-Agent (Jain et al., 2025), SWE-agent-LM (Yang et al., 2025b), Skywork-SWE (Zeng et al., 2025), DeepSWE-Preview (Luo et al., 2025)). On the other hand, studies focused on developing general post-training techniques often evaluate on self-contained suites like HumanEval (e.g., (Wei et al., 2024), (Tang et al., 2025), (Yu et al., 2024b)). While perfectly rational, this evaluation approach does not allow distinguishing whether the improvement comes from task-specific optimization or reflects a general improvement of coding capability. Capability generalization cannot be taken for granted: Yu et al. (Yu et al., 2024a) show cases where instruction tuning improves algorithmic benchmark scores without commensurate gains on the underlying behavior. This cited pattern we find undesirable motivates our position. To support it, we directly test cross-task transfer by evaluating checkpoints trained on specific tasks across multiple SE modalities.

**The quote's paragraph** [section: Benchmark measurements and capability claims]: From the general coding capability point of view, any single benchmark can at best provide a noisy, partial measurement of this latent capability. In particular, when two models are far apart in overall competence (e.g., frontier systems versus small baselines), a large and consistent performance gap on a benchmark is often a reasonable shorthand for a capability difference. The difficulty arises when benchmark results are treated as sufficient evidence for broad capability claims, especially when models are optimized for that benchmark.

**The quote:** In particular, when two models are far apart in overall competence (e.g., frontier systems versus small baselines), a large and consistent performance gap on a benchmark is often a reasonable shorthand for a capability difference. The difficulty arises when benchmark results are treated as sufficient evidence for broad capability claims, especially when models are optimized for that benchmark.

**Cue A:** Notice when a big benchmark gap is a fair signal and when it is not.

**Cue B:** Ask when a benchmark gap between two models is trustworthy and when it stops being so.

---

## Pair 17

**The paragraph before:** Reporting model performance on a limited number of benchmarks is practical and reasonable. However, there seems to be a systematic disconnect between what code benchmarks actually measure and how benchmark scores are commonly interpreted. Because of this “meaning gap”, specific achievements on a narrow benchmark may inflate into broad assertions of general coding capability.

**The quote's paragraph** [section: Benchmark measurements and capability claims]: We illustrate the meaning gap concept using examples from the Qwen3-Coder-480B-A35B model descriptions. The original blog post reports the model performance on eight coding-related tasks, five of which correspond to issue resolution similar to SWE-bench (QwenTeam, 2025), and summarizes them as “exceptional performance in both coding and agentic tasks”. Finally, an independent blog post comparing models makes a claim “Chinese models aren’t just competing—they’re winning. Qwen 3 Coder leads at 67% on SWE-bench, surpassing GPT-4.1’s 54.6%” (DigitalAppliedTeam, 2025). Each step is understandable in isolation, but together they broaden a narrow performance measurement into a claim about general superiority at coding that may influence deployment decisions.

**The quote:** Each step is understandable in isolation, but together they broaden a narrow performance measurement into a claim about general superiority at coding that may influence deployment decisions.

**Cue A:** Trace the two steps by which a narrow score becomes a broad claim.

**Cue B:** Notice the two separate steps by which a narrow score grows into a broad capability claim.

---

## Pair 18

**The paragraph before:** Foundation models: rankings are not always stable across modalities. Even for foundation models, relative ordering can flip across tasks: a model stronger on SWE-bench can underperform on our benchmark, illustrating that a single headline score may not reflect a full capability profile. For example, while Qwen-2.5-32B-Coder-Instruct outperforms Qwen3-32B on our code completion benchmark, it has worse SWE-bench scores.

**The quote's paragraph** [section: Evidence from a Django case study]: Public checkpoints: no cross-task transfer. SWE-bench-optimized checkpoints, while significantly outperforming their base models on SWE-bench, generally do not improve on our Django tasks or LiveCodeBench. Across the 28 out-of-domain checkpoint–benchmark comparisons (7 checkpoints \(\times\) 4 benchmarks), we observe 18 degradations versus ten improvements. Five of seven checkpoints degrade on the majority of benchmarks, none improve on all four, and only DeepSWE-Preview shows more improvements than degradations overall. Because we report single greedy evaluations on stochastic benchmarks, small deltas should not be over-interpreted. The overall pattern is consistent with the absence of change in cross-task capabilities, with occasional regressions. Importantly, these regressions do not always come from output-format failures: most checkpoints follow task formats, with only SWE-agent-LM-7B and OpenHands-LM-32B sometimes failing to follow instructions. To illustrate our point on cross-task transfer for both format and substance mistakes, we provide error-flow analysis in appendix C.1.

**The quote:** Across the 28 out-of-domain checkpoint–benchmark comparisons (7 checkpoints \(\times\) 4 benchmarks), we observe 18 degradations versus ten improvements. Five of seven checkpoints degrade on the majority of benchmarks, none improve on all four, and only DeepSWE-Preview shows more improvements than degradations overall.

**Cue A:** Count how many of the out-of-domain comparisons improved versus got worse.

**Cue B:** Count how improvements compare to degradations across the out-of-domain checkpoint comparisons.

---

## Pair 19

**The paragraph before:** Our experiments provide empirical support for the meaning gap: performance on a popular coding benchmark can fail to predict performance on other coding tasks, even if they are closely related. As a result, broad capability claims based on a narrow set of leaderboards are often overstated.

**The quote's paragraph** [section: Discussion]: Limited evidence of cross-benchmark rank reversals for foundation models. If a single benchmark is a good proxy for “general coding capability,” the relative ordering of models should be broadly stable across different coding evaluations. In our limited comparison (Qwen2.5 vs. Qwen3), we observe a rank reversal: Qwen3-32B scores higher on SWE-bench, yet performs substantially worse than Qwen2.5-Coder-32B-Instruct models on our code completion benchmark. This suggestive rather than definitive evidence illustrates the core risk: leaderboard position on one benchmark can be an unreliable signal for another task that also corresponds to a facet of general coding capability.

**The quote:** In our limited comparison (Qwen2.5 vs. Qwen3), we observe a rank reversal: Qwen3-32B scores higher on SWE-bench, yet performs substantially worse than Qwen2.5-Coder-32B-Instruct models on our code completion benchmark.

**Cue A:** Look for a case where one model scores higher on one benchmark but worse on another.

**Cue B:** Look for a case where one model beats another on one benchmark but loses on a different one.

---

## Pair 20

**The paragraph before:** Limited evidence of cross-benchmark rank reversals for foundation models. If a single benchmark is a good proxy for “general coding capability,” the relative ordering of models should be broadly stable across different coding evaluations. In our limited comparison (Qwen2.5 vs. Qwen3), we observe a rank reversal: Qwen3-32B scores higher on SWE-bench, yet performs substantially worse than Qwen2.5-Coder-32B-Instruct models on our code completion benchmark. This suggestive rather than definitive evidence illustrates the core risk: leaderboard position on one benchmark can be an unreliable signal for another task that also corresponds to a facet of general coding capability.

**The quote's paragraph** [section: Discussion]: Post-trained checkpoints show near-universal failure of cross-task transfer. The meaning gap is more pronounced for post-trained checkpoints. Across both community-released SWE-bench-optimized checkpoints and our fine-tuned variants, improvements are largely confined to the training/evaluation distribution, with little to no consistent gains on our Django benchmark suite and LiveCodeBench. In several cases, performance severely degrades on other tasks (e.g., SWE-agent-LM-7B and OpenHands-LM-32B underperform their base models across multiple benchmarks, failing to follow instructions). Moreover, failures are not uniform: some checkpoints follow instructions and formats reasonably well, yet still do not improve out-of-distribution, making the lack of transfer difficult to detect via qualitative “sanity checks” alone. As LiveCodeBench and our benchmark suite use very different data and test models on different tasks, we speculate this may mean lack of cross-task improvement on other coding tasks as well.

**The quote:** Moreover, failures are not uniform: some checkpoints follow instructions and formats reasonably well, yet still do not improve out-of-distribution, making the lack of transfer difficult to detect via qualitative “sanity checks” alone.

**Cue A:** Ask why a simple sanity check on instruction-following might miss the real problem.

**Cue B:** Consider why checking that a model follows instructions properly might not reveal a lack of transfer.

---

## Pair 21

**The paragraph before:** Benchmark suites (beyond a single score). The most direct response to single-benchmark limitations is broader coverage: a suite spanning completion, editing, bug localization, question answering, and repository navigation. MTEB (Muennighoff et al., 2023) exemplifies this for text embeddings, where diverse tasks constrain overgeneralization. However, this approach faces two obstacles.

**The quote's paragraph** [section: Discussion]: First, benchmarks are high-effort community service that is weakly rewarded, especially for maintenance, which matters even more than creation. Each conference introduces many new benchmarks, but very few are ever widely adopted, and fewer are still maintained as models, data, and contamination risks evolve. High-quality suites need sustained curation, robust evaluation harnesses, contamination monitoring, and regular refresh (Bean et al., 2025).

**The quote:** First, benchmarks are high-effort community service that is weakly rewarded, especially for maintenance, which matters even more than creation. Each conference introduces many new benchmarks, but very few are ever widely adopted, and fewer are still maintained as models, data, and contamination risks evolve.

**Cue A:** Notice what kind of benchmark-related work is least rewarded by the field.

**Cue B:** Notice what is said about how benchmarks get maintained after they are created.

---

## Pair 22

**The paragraph before:** First, benchmarks are high-effort community service that is weakly rewarded, especially for maintenance, which matters even more than creation. Each conference introduces many new benchmarks, but very few are ever widely adopted, and fewer are still maintained as models, data, and contamination risks evolve. High-quality suites need sustained curation, robust evaluation harnesses, contamination monitoring, and regular refresh (Bean et al., 2025).

**The quote's paragraph** [section: Discussion]: We believe this is addressable institutionally: targeted grants (including industry sponsorship), conference tracks and workshops that reward ongoing maintenance (e.g., new versions, repaired instances, and contamination audits), not just initial releases, treating benchmarks as first-class research artifacts. Without recognizing benchmark maintenance as essential research infrastructure, the existence and support of benchmarks like SWE-Bench-Pro, SWE-rebench (Badertdinov et al., 2025), or LiveCodeBench depend on the chance and goodwill of a small number of individuals.

**The quote:** Without recognizing benchmark maintenance as essential research infrastructure, the existence and support of benchmarks like SWE-Bench-Pro, SWE-rebench (Badertdinov et al., 2025), or LiveCodeBench depend on the chance and goodwill of a small number of individuals.

**Cue A:** Ask what keeps some widely used benchmarks alive at all.

**Cue B:** Look for what the survival of several well-known benchmarks is said to depend on.

---

## Pair 23

**The paragraph before:** • Decide aggregation: how should we combine axes (tasks, repos, languages) to report an interpretable profile rather than an over-compressed single score?

**The quote's paragraph** [section: Discussion]: Developing such a taxonomy is substantial research, but other areas of science (e.g., psychometrics) suggest it is feasible: latent constructs are estimated through batteries of partially correlated tests, not single measurement. We sketch how this taxonomy can look like in Appendix A. We stress this taxonomy is not ready to use, as creating usable taxonomy requires extensive empirical and qualitative work beyond the scope of our paper.

**The quote:** Developing such a taxonomy is substantial research, but other areas of science (e.g., psychometrics) suggest it is feasible: latent constructs are estimated through batteries of partially correlated tests, not single measurement.

**Cue A:** Look for what other field is used as an example of estimating a hidden ability from many tests.

**Cue B:** Look for the comparison to another field that suggests a skill taxonomy is achievable.

---

## Pair 24

**The paragraph before:** Developing such a taxonomy is substantial research, but other areas of science (e.g., psychometrics) suggest it is feasible: latent constructs are estimated through batteries of partially correlated tests, not single measurement. We sketch how this taxonomy can look like in Appendix A. We stress this taxonomy is not ready to use, as creating usable taxonomy requires extensive empirical and qualitative work beyond the scope of our paper.

**The quote's paragraph** [section: Discussion]: Human-in-the-loop validation. A complementary approach is evaluation on genuinely real-world tasks with human judgment. For SE tasks, this could mean sampling open GitHub issues or internal tickets and collecting structured assessments from maintainers or domain experts. This can be uncontaminated by design (new issues are not in training data) and better reflect practical distributions, including cases that are underspecified, unsolvable with available context, or unnecessary to address. Moreover, human in the loop validation can also assess the perception of a coding agent, which affects the efficiency of human-agent collaboration. However, human evaluation has its own failure modes: expense, limited scalability, inconsistent standards across projects, and the risk of preferring style over substance (Wu and Aji, 2025).

**The quote:** However, human evaluation has its own failure modes: expense, limited scalability, inconsistent standards across projects, and the risk of preferring style over substance (Wu and Aji, 2025).

**Cue A:** List the weaknesses that come with using human judges to evaluate code.

**Cue B:** List the weaknesses raised against relying on human evaluation.

---

## Pair 25

**The paragraph before:** Holistic open-ended evaluation. A more radical departure from fixed tasks is holistic evaluation in open-ended scenarios. E.g. to succeed in Anthropic’s Project Vend (Anthropic, 2025) a model has to integrate many skills under events that no benchmark designer would anticipate. For coding, analogous setups can be controlled hackathons or bug-squashing days where teams are randomly assigned AI assistants, with models judged on outcomes and user experience.

**The quote's paragraph** [section: Discussion]: These can be run as model–vs–model competitions with standardized rules, potentially sponsored by model developers. The results can be reported as a public leaderboard if the protocol is transparent and robust enough to avoid becoming another easily optimized proxy. While costly, a holistic evaluation targets the meaning gap directly: it measures performance when tasks are underspecified, requirements drift, and success requires adaptive problem-solving.

**The quote:** While costly, a holistic evaluation targets the meaning gap directly: it measures performance when tasks are underspecified, requirements drift, and success requires adaptive problem-solving.

**Cue A:** Think about what kind of task conditions a holistic evaluation is meant to capture.

**Cue B:** Ask what kind of task conditions a holistic evaluation is meant to capture.

---

## Pair 26

**The paragraph before:** In this paper, we propose a three-pronged evaluation approach: holistic assessment of frontier models, multi-task benchmarks for academic research, and task-specific user studies for narrow practical tasks. However, there are alternative views on model evaluation, which we present and discuss below.

**The quote's paragraph** [section: Alternative views]: Jordan et al. (Jordan et al., 2024) argue that rigorous benchmarking can be prohibitively expensive and propose using scientific testing instead to understand how algorithms work. While we agree that mechanistic understanding is valuable in academic research, we believe benchmarking model performance outside controlled experiments is equally necessary for algorithm evaluation—complementing rather than replacing scientific testing. To paraphrase a famous statement, “all DL approaches are not general, but some are useful”, and benchmarking is how one can estimate the limits of usefulness.

**The quote:** To paraphrase a famous statement, “all DL approaches are not general, but some are useful”, and benchmarking is how one can estimate the limits of usefulness.

**Cue A:** Ask what the author thinks benchmarking is actually useful for showing.

**Cue B:** Consider what role benchmarking is still said to play, despite its limits.

---

## Pair 27

**The paragraph before:** Another possible counterargument is that the evaluation system is self-correcting. For example, the emergence of SWE-bench and LiveCodeBench addresses the limitations of HumanEval: limited task scope and contamination, respectively. We are less optimistic: benchmark gains are now read as capability gains, masking failures to transfer and creating selection pressure for Goodhart’s law-like effects to appear (Manheim and Garrabrant, 2018). It also takes time for the community to change the benchmark of choice: while first concerns about leaks and test quality in SWE-bench first appeared in 2024 (Aleithan et al., 2024), SWE-bench is still the most popular benchmark for evaluating LLMs on SE tasks. One of the goals of our contribution is to show the limitations of self-correction feedback.

**The quote's paragraph** [section: Conclusions: what should be done]: In this position paper, we argue that there is no “one size fits all” approach to DL-for-code model evaluation, and that using a single or a limited number of benchmarks to assess model performance does not provide sufficient information about model capabilities. We suggest using four complementary approaches: single-score benchmarks for iteration, benchmark suites for capability profiles, human-in-the-loop studies for narrow deployments, and holistic open-ended evaluations for frontier models. To make benchmark suites reliable, we suggest treating them as research infrastructure: funding creation and long-term maintenance (e.g., targeted grants and industry sponsorship) and rewarding versioned updates via dedicated conference tracks. We also urge the community to ground benchmark suites in a shared capability taxonomy that covers tasks, domains, languages, and aggregation to ensure construct validity, and acknowledge the limitations of the benchmarking methods for the task at hand. Finally, we also call on DL for code researchers working on training recipes and coding agents to explicitly report what capabilities transfer across tasks and to characterize measurement limitations of their evaluations.

**The quote:** Finally, we also call on DL for code researchers working on training recipes and coding agents to explicitly report what capabilities transfer across tasks and to characterize measurement limitations of their evaluations.

**Cue A:** Look for what researchers are asked to report alongside their training results.

**Cue B:** Notice what the authors ask coding-agent researchers to report alongside their results.

---

## Pair 28

**The paragraph before:** Figure 1: Per-example error type flow Sankey diagram

**The quote's paragraph** [section: Appendices A–C: taxonomy and evidence]: Across all seven model pairs and three benchmarks (7 539 examples), fine-tuning drops the OK rate from 52.4% to 43.1%. The modal dominant regression path is OK → NOT_RUN: fine-tuned models emit agent-style output (XML tags, markdown fences, preamble code) that the harness cannot parse. In total, 47.2% of regressions come from format or parsing error (NOT_RUN + IndentationError), and 52.8% of regressions are caused by essential mistakes such as AssertionError or SyntaxError. Thus, the impact of coding capability degradation and failure to follow the format are compatible. Model capacity determines whether this overfitting occurs. Comparing SWE-agent-LM-7B and -32B (both fine-tuned on SWE-smith and have \(>13\%\) improvements on SWE-bench) on Method Generation:

**The quote:** In total, 47.2% of regressions come from format or parsing error (NOT_RUN + IndentationError), and 52.8% of regressions are caused by essential mistakes such as AssertionError or SyntaxError.

**Cue A:** Note how regressions split between formatting errors and genuine coding mistakes.

**Cue B:** Compare how many regressions come from formatting mistakes versus genuine coding errors.

---

## Pair 29

**The paragraph before:** Across all seven model pairs and three benchmarks (7 539 examples), fine-tuning drops the OK rate from 52.4% to 43.1%. The modal dominant regression path is OK → NOT_RUN: fine-tuned models emit agent-style output (XML tags, markdown fences, preamble code) that the harness cannot parse. In total, 47.2% of regressions come from format or parsing error (NOT_RUN + IndentationError), and 52.8% of regressions are caused by essential mistakes such as AssertionError or SyntaxError. Thus, the impact of coding capability degradation and failure to follow the format are compatible. Model capacity determines whether this overfitting occurs. Comparing SWE-agent-LM-7B and -32B (both fine-tuned on SWE-smith and have \(>13\%\) improvements on SWE-bench) on Method Generation:

**The quote's paragraph** [section: Appendices A–C: taxonomy and evidence]: • 7B (52.9% → 5.8% OK): the largest flow is OK → NOT_RUN (113 examples). The model wraps output in [object Object]…[object Object] tags instead of a bare def block; 54 further examples acquire IndentationError.

**The quote:** 7B (52.9% → 5.8% OK): the largest flow is OK → NOT_RUN (113 examples).

**Cue A:** Look at which direction of change dominates for the smallest model size.

**Cue B:** Look at which failure mode dominates for the smaller model size.

---

## Pair 30

**The paragraph before:** Model / scaffolding Scaffolding, 10 steps No scaffolding Qwen2.5-Coder-7B-Instruct 0.0 52.92 SWE-agent-LM-7B 24.51 5.85 Qwen2.5-Coder-32B-Instruct 8.59 64.07 SWE-agent-LM-32B 39.62 66.57 Table 6: Model performance with and without SWE-agent scaffolding.

**The quote's paragraph** [section: Appendices A–C: taxonomy and evidence]: When both SWE-agent checkpoints and the raw model are put into the same scaffolding, the fine-tuned checkpoints outperform the raw model. However, both for raw models and SWE-agent-LM-32B checkpoint removal of scaffolding further improves the results in ten-step setup. To check further if ten steps are insufficient and whether the agent runs out of steps, we evaluate SWE-agent-LM-32B checkpoint in agentic scaffolding with 75-step limit. We consider this particular checkpoint as it has the smallest difference with the raw model non-agentic performance, and we do not run other checkpoints due to budget limitations. In this setup, SWE-agent-LM-32B scores \(63.51\), so it takes 75 steps in an agentic scaffolding for a particular SWE-agent checkpoint to match a non-agentic setup for either SWE-agent checkpoint or raw model. The difference between ten and 75-step scaffolding performance highlights that agentic setup requires multiple tries to solve the task and suggests that in ten-step setup running out of steps is the key failure mode.

**The quote:** In this setup, SWE-agent-LM-32B scores \(63.51\), so it takes 75 steps in an agentic scaffolding for a particular SWE-agent checkpoint to match a non-agentic setup for either SWE-agent checkpoint or raw model.

**Cue A:** Notice what it costs, in steps, for one setup to match another's performance.

**Cue B:** Notice how many extra steps an agentic setup needs just to match a simpler one.

---

## Pair 31

**The paragraph before:** When both SWE-agent checkpoints and the raw model are put into the same scaffolding, the fine-tuned checkpoints outperform the raw model. However, both for raw models and SWE-agent-LM-32B checkpoint removal of scaffolding further improves the results in ten-step setup. To check further if ten steps are insufficient and whether the agent runs out of steps, we evaluate SWE-agent-LM-32B checkpoint in agentic scaffolding with 75-step limit. We consider this particular checkpoint as it has the smallest difference with the raw model non-agentic performance, and we do not run other checkpoints due to budget limitations. In this setup, SWE-agent-LM-32B scores \(63.51\), so it takes 75 steps in an agentic scaffolding for a particular SWE-agent checkpoint to match a non-agentic setup for either SWE-agent checkpoint or raw model. The difference between ten and 75-step scaffolding performance highlights that agentic setup requires multiple tries to solve the task and suggests that in ten-step setup running out of steps is the key failure mode.

**The quote's paragraph** [section: Appendices A–C: taxonomy and evidence]: All in all, this indicates that regardless of the fine-tuning approach some tasks are better solved without an agentic scaffolding. The failure of SWE-agent-LM-32B checkpoint to outperform the raw model in non-agentic setup further supports our point on the lack of cross-task transfer. We stress that creators of SWE-agent checkpoints could not have checked this without creating additional benchmarks (a significant research and technical effort), so this reflects a failure of the evaluation ecosystem, not of the researchers themselves.

**The quote:** We stress that creators of SWE-agent checkpoints could not have checked this without creating additional benchmarks (a significant research and technical effort), so this reflects a failure of the evaluation ecosystem, not of the researchers themselves.

**Cue A:** Ask whose fault this gap in checking is said to be.

**Cue B:** Ask whose fault the authors say this blind spot really is.

---

## Pair 32

**The paragraph before:** Third, we observe a consistent ordering of task difficulty across models. Method generation (CG) is generally easier than method completion (CC) and program repair (PR), similarly to what we observe for the open-weights models and post-trained checkpoints.

**The quote's paragraph** [section: Appendices D–F: tasks, training, prompts]: Fourth, the table reveals that even frontier models exhibit uneven capability profiles across tasks, with various models having different strengths and weaknesses. For example, GPT-5 performs significantly better than Gemini 3 Pro on code completion, but is not better on code generation and program repair.

**The quote:** Fourth, the table reveals that even frontier models exhibit uneven capability profiles across tasks, with various models having different strengths and weaknesses. For example, GPT-5 performs significantly better than Gemini 3 Pro on code completion, but is not better on code generation and program repair.

**Cue A:** Compare how differently two frontier models perform across different task types.

**Cue B:** Compare how two frontier models differ across completion, generation and repair tasks.

---

## Pair 33

**The paragraph before:** In every case, we evaluate the last epoch checkpoint.

**The quote's paragraph** [section: Appendices D–F: tasks, training, prompts]: These settings are not the result of extensive hyperparameter search. We deliberately use standard, reasonable defaults to demonstrate that even without careful tuning, single-task fine-tuning produces models with improved in-distribution performance but limited cross-task transfer. This supports our main thesis about the meaning gap in benchmark evaluation and risks of missing it in single-benchmark evaluation setup.

**The quote:** We deliberately use standard, reasonable defaults to demonstrate that even without careful tuning, single-task fine-tuning produces models with improved in-distribution performance but limited cross-task transfer.

**Cue A:** Ask why the authors chose plain, untuned settings for their fine-tuning experiment.

**Cue B:** Look for why they chose not to carefully tune the fine-tuning setup.

---

## Pair 34

**The paragraph before:** Keywords: higher-order interactions; entropy; information theory; neuroscience; neural recording; computation; cortical circuits

**The quote's paragraph** [section: 1. Introduction]: A grand challenge of modern neuroscience is to discover how brains “process information”. Though there is debate regarding what information processing means precisely, it is clear that brains take in sensory signals from the environment and use that information to generate adaptive behavior informed by their surroundings. The ways that sensory information is modified and transformed are poorly understood. It is known, however, that such processes are distributed over integrative interactions in neural circuits throughout the brain and involve large numbers of interacting neurons. We refer to this collective activity as neural information processing.

**The quote:** It is known, however, that such processes are distributed over integrative interactions in neural circuits throughout the brain and involve large numbers of interacting neurons. We refer to this collective activity as neural information processing.

**Cue A:** What does the author mean by collective neural information processing?

**Cue B:** Notice how the authors describe the scale of neurons involved in information processing.

---

## Pair 35

**The paragraph before:** There are many basic unanswered questions about information processing. What types of circuit connectivity are most favorable for neural information processing? How is neural information processing affected by the overall structure and correlations present in incoming information flows? What are the physiological correlates of information processing at the level of neural circuits? Are distinct transformations promoted by distinct physiological systems? Do distinct transformations relate to the demands of different environmental or behavioral tasks? Modern neuroscientific research has begun to probe these issues. While many questions remain, patterns have begun to emerge, replicated across multiple studies, that suggest that the structure of information processing in the brain follows certain reliable trends and may serve particular purposes with respect to ongoing biological and cognitive processes.

**The quote's paragraph** [section: 1. Introduction]: Historically, there have been two key limitations hindering the study of information processing by neural circuits. The first was a lack of appropriate data, since the analysis of synergistic dynamics requires large amounts of data to accurately infer the structure of multivariate dependence. Until recently, such data were difficult to access. In the last decade, however, with innovative new electrical and optical recording technologies that can record from hundreds or thousands of neurons at sub-millisecond temporal resolution, this limitation has abated considerably. The second was a lack of appropriate analytical approaches. Despite the recent explosion of data, a rendering processes is still needed to extract interpretable insights from terabytes of recordings.

**The quote:** Historically, there have been two key limitations hindering the study of information processing by neural circuits. The first was a lack of appropriate data, since the analysis of synergistic dynamics requires large amounts of data to accurately infer the structure of multivariate dependence.

**Cue A:** What two obstacles historically blocked studying how circuits process information?

**Cue B:** What two obstacles does the piece say historically blocked study of synergistic dynamics?

---

## Pair 36

**The paragraph before:** Given two elements (e.g., neurons), one serving as an information source and another as a target receiving information from that source, the tools of information theory make it possible to track how neural activity propagates across a neural system. Information-theoretic tools such as mutual information [10] and transfer entropy [11] are well suited to this purpose.

**The quote's paragraph** [section: 2. Tracking Information in Neural Circuits]: Mutual information [12] can measure the dependence in the spiking between two neurons: I(X;Y) := ∑ x∈X y∈Y P(x, y)log2 P(x|y) P(x) (1) where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal probability of X, and P(x|y) is the conditional probability X = x given that Y = y. I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13]. This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”

**The quote:** I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13].

**Cue A:** How is mutual information described in relation to correlation between two signals?

**Cue B:** How is mutual information described here as a kind of correlation?

---

## Pair 37

**The paragraph before:** Mutual information [12] can measure the dependence in the spiking between two neurons: I(X;Y) := ∑ x∈X y∈Y P(x, y)log2 P(x|y) P(x) (1) where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal probability of X, and P(x|y) is the conditional probability X = x given that Y = y. I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13]. This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”

**The quote's paragraph** [section: 2. Tracking Information in Neural Circuits]: Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1), conditioned on Y’s own past (Yp): TE(X → Y) := (2) ∑ yt+1∈Y xp∈Xp yp∈Yp P(yt+1, yp, xp)log2 P(yt+1|xp, yp) P(yt+1|yp) TE(X → Y) is read as the transfer entropy from X’s past to Y’s future. It is important to note that Xp does not necessarily have to be a single moment or bin but can be a multi-dimensional and potentially non-uniform embedding [15–17]. TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation. In addition to measuring the magnitude of information flow between two neurons, in the special case of binary signals the TE can be modified to also provide a measure of excitation/inhibition balance using the sorted local transfer entropy [18].

**The quote:** TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation.

**Cue A:** How does transfer entropy differ from plain correlation in what it tracks?

**Cue B:** Look for the contrast drawn between functional and effective connectivity.

---

## Pair 38

**The paragraph before:** Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1), conditioned on Y’s own past (Yp): TE(X → Y) := (2) ∑ yt+1∈Y xp∈Xp yp∈Yp P(yt+1, yp, xp)log2 P(yt+1|xp, yp) P(yt+1|yp) TE(X → Y) is read as the transfer entropy from X’s past to Y’s future. It is important to note that Xp does not necessarily have to be a single moment or bin but can be a multi-dimensional and potentially non-uniform embedding [15–17]. TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation. In addition to measuring the magnitude of information flow between two neurons, in the special case of binary signals the TE can be modified to also provide a measure of excitation/inhibition balance using the sorted local transfer entropy [18].

**The quote's paragraph** [section: 3. Information Processing in Neural Circuits]: Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]. How does one examine information processing itself? We propose that one successful avenue is that of multivariate information decomposition [1].

**The quote:** Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]. How does one examine information processing itself? We propose that one successful avenue is that of multivariate information decomposition [1].

**Cue A:** What limitation of tracking information flow motivates a different kind of analysis?

**Cue B:** What can information transfer not tell us about how neurons combine inputs?

---

## Pair 39

**The paragraph before:** Individual neurons receive inputs from from many “parent” neurons, which are “integrated” into a single “decision” by the target neuron, i.e., whether to fire an action potential or not. Exactly how individual neurons “compute” their future behavior as a function of their inputs is a long-standing question in computational and theoretical neurosciences. We can quantify the total amount of information the inputs provide about the decision state of the target neuron using the joint mutual information: I(X;Y) = ∑ x∈X ∑ y∈Y P(x, y)log2 P(y|x) P(y) (3) where X = {X1, . . . , XN} is the set of all pre-synaptic parent neurons and Y is the single post-synaptic target neuron. We can also compute the individual information that single parents provide about the target with the marginal mutual information I(Xi;Y). Interestingly, it cannot be assumed that the joint mutual information (the “whole”) is reducible to a sum of all its component marginal “parts”. I(X;Y) 6= ∑ i=1 |X| I(Xi;Y). (4)

**The quote's paragraph** [section: 4. PID: Partial Information Decomposition]: If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating “computation” on all of its inputs considered jointly (this is also sometimes referred to as “information modification” in the literature [19]). Conversely, if the whole is less than the sum of its parts, then there must be redundant information about Y instantiated multiple times over the parent neurons that is “double counted” when summing the marginals. The way that these pieces fit together is illustrated in Figure 1.

**The quote:** If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating “computation” on all of its inputs considered jointly (this is also sometimes referred to as “information modification” in the literature [19]). Conversely, if the whole is less than the sum of its parts, then there must be redundant information about Y instantiated multiple times over the parent neurons that is “double counted” when summing the marginals.

**Cue A:** Watch for how a mismatch between whole and parts is interpreted as either synergy or redundancy.

**Cue B:** Look for how the whole being greater or less than the sum of parts is interpreted.

---

## Pair 40

**The paragraph before:** Figure 1. The total information contained in the activity of two source neurons X1 and X2 about the activity of a target neuron Y consists of multiple parts. This total information, I(X1, X2;Y), is represented by the outermost oval. Contained within this total is the information that X1 and X2 each independently carry about Y, represented by the red circle for I(X1;Y) and the blue circle for I(X2;Y). These independent sources can carry redundant information, represented by the overlapping striped section labeled Red(X1, X2;Y). The non-redundant information each source neuron accounts for is the unique information Unq(X1;Y) and Unq(X2;Y). Finally, and most relevantly for the study of information processing, the joint state of X1 and X2 can account for the activity of Y to some degree. This information is not accounted for by either source independently and is the synergistic information that X1 and X2 carry about Y, i.e., Syn(X1, X2;Y). The purple space making up the difference between what is included in the I(X1;Y) and I(X2;Y) circles and the total information I(X1, X2;Y) represents Syn(X1, X2;Y).

**The quote's paragraph** [section: 4. PID: Partial Information Decomposition]: This inequality has been recognized for decades; however, it was not until the seminal work of Williams and Beer [1] that it was recognized how to algebraically decompose the total joint mutual information into the particular contributions of the parts (and higher-order ensembles of parts). Since its introduction, this framework, termed partial information decomposition, has been widely applied in fields from theoretical and computational neuroscience [9,21] to climate modeling [22] and sociology [23].

**The quote:** This inequality has been recognized for decades; however, it was not until the seminal work of Williams and Beer [1] that it was recognized how to algebraically decompose the total joint mutual information into the particular contributions of the parts (and higher-order ensembles of parts).

**Cue A:** Who is credited with first showing how to split joint information into parts?

**Cue B:** Who is credited with first showing how to algebraically split joint information into parts?

---

## Pair 41

**The paragraph before:** Furthermore, the two marginal mutual information terms can be decomposed accordingly:

**The quote's paragraph** [section: 4. PID: Partial Information Decomposition]: The result is an underdetermined system of linear equations, with three known values (the mutual information terms) and four unknown values (the partial information terms). If any of the unknown terms can be defined, then the other three emerge “for free”. Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each. The most common approach is to define a redundancy function such as the original proposal of Imin [1] (for more on redundancy functions, see Section 4.3), although there have also been proposals that start with the unique information [24,25] or synergy [26,27].

**The quote:** Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each.

**Cue A:** Why can't classical information theory alone pin down redundancy, uniqueness and synergy?

**Cue B:** Why does classical information theory fail to pin down a single answer here?

---

## Pair 42

**The paragraph before:** Figure 2. Partial information lattices. On the left is the lattice for two predictor variables, and on the right is the lattice for three predictor variables. Each lattice is constructed and annotated following the notation in [1]. Lattice vertices are partial information atoms, i.e., the unique modes of information-sharing that comprise the overall joint mutual information. Information atoms are denoted by index only: for example, {1}{2} is the information redundantly disclosed by X₁ or X₂, {1}{23} is the information disclosed by X₁ or (X₂ and X₃), etc. Lattice edges indicate which atoms subsume other atoms. Atoms connected to and below other atoms consist of components of and/or subsets of the higher atoms, for example, {1}{2} ⪯ {1}{23} and {2}{13}, since information disclosed by {1}{2} would also be visible to {1}{23} and {2}{13} if we did not use the Mobius inversion.

**The quote's paragraph** [section: 4. PID: Partial Information Decomposition]: Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks (such as only being defined for systems of a fixed size, only being amenable to discrete random variables, or requiring arbitrary thresholds). There are, at present, close to a dozen competing redundancy functions (see [22,29,31–40]). In the absence of a single accepted measure, different contexts may require the choice of different functions. For example, having more than two predictors precludes the measures proposed in [24,31], while continuous data cannot be analyzed with the measures proposed in [24,40], and so on. The majority of the studies discussed in this paper used the original Imin measure proposed in [1], although this measure has been criticized for unintuitive behavior [29,39]. For a deeper discussion of the practical considerations, see Section 6.

**The quote:** In the absence of a single accepted measure, different contexts may require the choice of different functions.

**Cue A:** Why might different situations call for different redundancy measures?

**Cue B:** What does the lack of one accepted measure imply for choosing an approach across studies?

---

## Pair 43

**The paragraph before:** Figure 3. Example of how neuronal activity recordings can be subjected to PID-based study. Rapid extraction and sectioning of mouse brains created 400 µm sagittal slices of cortex. Incubation in nutrient media allowed the slice to culture, restoring organotypic connectivity patterns [47]. Placing the culture on a high-density 512-channel microelectrode array allowed for recordings permitting spike sorting via PCA waveform analysis, to attribute observed spikes to individual neurons. The resulting spike rasters reflect the millisecond-level precision activation patterns of hundreds of neurons. Analyzing the effective connectivity among neurons using transfer entropy enables extraction of the full effective network upon which the spiking dynamics occurred. The computational triads, consisting of two neurons (source neurons) connecting to a common third neuron (target neuron), can then be identified. PID can then be applied separately to each computational triad. Variations across triads can be used to analyze how synergy (or redundancy) varies as a function of network properties such as the boundaries of a rich club or as a function of the number of feedback and recurrent connections. Figure adapted from [2].

**The quote's paragraph** [section: 5. PID in Action]: For example, one can ask whether synergy varies systematically as a function of the amount of information propagation—the transfer entropy from sources to a target—across triads. When we performed this analysis, examining 25 separate recordings at timescales varying from 1 ms to 14 ms, we found that synergy was strongly correlated (ρ ≫ 0.57 for all recordings and timescales; see Figure 4A). Interestingly, this analysis revealed that—for these recordings—the amount of synergy observed in a given triad was reliably about a quarter of the transfer entropy for that triad [2]. The implication of this is that feedforward information propagation between source neurons and a target neuron is a reliable predictor of information processing.

**The quote:** The implication of this is that feedforward information propagation between source neurons and a target neuron is a reliable predictor of information processing.

**Cue A:** What relationship between feedforward flow and processing is being claimed here?

**Cue B:** What does feedforward propagation between neurons seem to predict about processing?

---

## Pair 44

**The paragraph before:** The observation that information propagation correlates with information processing suggests that rich clubs may be dense cores of information processing. Rich clubs generally represent the set of best-connected nodes of a network that are mutually interconnected with a probability higher than that expected by chance [48]. The rich club coefficient quantifies just how much more densely connected a given set of nodes is than would be expected by chance. Rich clubs, in the context of the effective networks built from cortical circuit spiking recordings, are comprised of the neurons that propagate the most information (i.e., sending and receiving). By definition, rich clubs are disproportionately dense in information propagation: 20% of the neurons account for 70% of the information propagation in organotypic cortical cultures [49].

**The quote's paragraph** [section: 5. PID in Action]: PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation.

**The quote:** Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B).

**Cue A:** Look at how much more synergy rich-club triads show compared to others.

**Cue B:** Look for how densely connected hub neurons compare to others in amount of synergy.

---

## Pair 45

**The paragraph before:** Understanding how connectivity patterns relate to synergistic integration may be useful for predicting how a network with a given topology might perform computationally. Connectivity motifs characterize and describe the different ways a fixed number of nodes can be connected. For example, in a three-element triad, the connectivity can be parsed into feedforward, feedback, and recurrent types. Feedforward connections are those from the source neurons to the target neuron. Of the two possible feedforward connections from source neurons to a target, both must exist in any computational triad. Feedback connections are those from the target back to the source neurons. There may be zero, one, or two of these in a computational triad. Recurrent connections are connections between the source neurons. Again, there may be zero, one, or two recurrent connections. The question for our analysis was whether synergistic integration was sensitive to the number of feedback or recurrent connections.

**The quote's paragraph** [section: 5. PID in Action]: Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy.

**The quote:** Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy.

**Cue A:** How do recurrent versus feedback connections relate to synergy levels?

**Cue B:** How do recurrent versus feedback connections relate to the amount of synergy found?

---

## Pair 46

**The paragraph before:** …4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy.

**The quote's paragraph** [section: 5. PID in Action]: In addition to questions about network topology, we also examined whether synergy varies based on the functional similarity of converging information streams. We tested whether there was a systematic correlation between the synergy of a triad and the mutual information in the source-neuron activities. Initially, we tested this for timescales in the synaptic range (<14 ms), consistent with the analyses described above. The result was unambiguous. The greater the mutual information between source neurons at the synaptic timescale, the greater the synergy [3]. More information processing occurs where similar information streams converge (Figure 4E, the three leftmost panels for synaptic timescales).

**The quote:** The result was unambiguous. The greater the mutual information between source neurons at the synaptic timescale, the greater the synergy [3]. More information processing occurs where similar information streams converge (Figure 4E, the three leftmost panels for synaptic timescales).

**Cue A:** How does similarity between source neurons relate to the synergy they produce?

**Cue B:** How does similarity between input sources at fast timescales relate to synergy?

---

## Pair 47

**The paragraph before:** In addition to questions about network topology, we also examined whether synergy varies based on the functional similarity of converging information streams. We tested whether there was a systematic correlation between the synergy of a triad and the mutual information in the source-neuron activities. Initially, we tested this for timescales in the synaptic range (<14 ms), consistent with the analyses described above. The result was unambiguous. The greater the mutual information between source neurons at the synaptic timescale, the greater the synergy [3]. More information processing occurs where similar information streams converge (Figure 4E, the three leftmost panels for synaptic timescales).

**The quote's paragraph** [section: 5. PID in Action]: To test whether synergy increases indefinitely as mutual information grows at longer timescales, we explored a range extending well past the synaptic range (time bins up to 2.25 s wide). Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease (this level is marked by the vertical dotted line in Figure 4E). In the context of explaining the density of synergy in the rich club, the strong positive relationship between synergy and mutual information at synaptic timescales suggested that the activity of rich club neurons is generally more correlated than the activity of neurons outside the rich club. Indeed, rich clubs consist of a disproportionate number of inhibitory neurons with correlated spiking activity that synergistically predict the dynamics of the rest of the network [50].

**The quote:** Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease (this level is marked by the vertical dotted line in Figure 4E).

**Cue A:** Notice where synergy stops rising as inputs become more similar, and what happens after.

**Cue B:** At what point does rising similarity between sources stop increasing synergy?

---

## Pair 48

**The paragraph before:** To test whether synergy increases indefinitely as mutual information grows at longer timescales, we explored a range extending well past the synaptic range (time bins up to 2.25 s wide). Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease (this level is marked by the vertical dotted line in Figure 4E). In the context of explaining the density of synergy in the rich club, the strong positive relationship between synergy and mutual information at synaptic timescales suggested that the activity of rich club neurons is generally more correlated than the activity of neurons outside the rich club. Indeed, rich clubs consist of a disproportionate number of inhibitory neurons with correlated spiking activity that synergistically predict the dynamics of the rest of the network [50].

**The quote's paragraph** [section: 5. PID in Action]: Leveraging the multiple outputs that PID offers, including redundancy as well as synergy, we were able to explore how the overall composition of information propagation varies across timescales [3]. As we lengthened the timescale, the total multivariate transfer entropy between the source neurons and the target neuron increased steadily across all timescales examined. As noted already, however, synergy increased only at the shorter timescales and decreased at the longer timescales. Observing the redundancy offered an explanation. Redundancy was positively related to mutual information at all timescales. Indeed, the slope relating the redundancy to mutual information became steeper at longer timescales (Figure 4E). This suggests that as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed.

**The quote:** This suggests that as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed.

**Cue A:** What happens to synergy once converging inputs become too similar?

**Cue B:** What explanation is offered for why synergy falls once inputs grow too similar?

---

## Pair 49

**The paragraph before:** These caveats have informed recent applications of PID to questions of neural dynamics. Varley et al. [5] analyzed spiking neural activity from the pre-motor and motor regions of three macaques while the monkeys were engaged in a multi-phase behavioral task involving symbol recognition, motor planning, memory storage, and motor execution [52]. As with the in vitro work, this study began by inferring transfer entropy networks for each behavioral epoch and then calculated the PID for every triad in the resulting networks. Rather than using a bivariate transfer entropy function, however, the authors used a serial conditioning algorithm to infer the multivariate TE networks [51,53,54] that contextualize every source–target relationship based on the global patterns of information flow. Despite this difference, many aspects of the in vitro results were successfully replicated in animal models, including the presence of a rich club and an increase in synergy in high-degree nodes. The authors also found that, in addition to a positive correlation between synergy and target degree, there was also a positive correlation between the local clustering coefficient and the synergy, which is significant because it points to a relationship between the local computational structure of a single neuron and its local environment (including neurons it may not directly interact with).

**The quote's paragraph** [section: 5. PID in Action]: The ability to assess how the structure of information processes changes in response to the demands of different tasks is a significant departure from the limitations of in vitro research. The researchers found that while brain activity was generally synergy-dominated (as opposed to redundancy-dominated), during movement execution (a reach-and-grasp action) the relative abundance of redundant information increased dramatically. This increase in relative redundancy was interpreted as a response to the practical requirements of the task: during motor execution, the brain needs to send the “move” signal to distant muscles, and to ensure high-fidelity transmission the brain may duplicate information many times over (minimizing the risk of a single corrupted signal leading to erroneous behavior). Similarly, different brain regions had different relative synergies during different tasks. For example, AIP (a pre-motor region) had the highest synergy during the fixation/cueing epoch, which then dropped off during movement, while M1 (the primary motor region) had the lowest synergy during the memory epoch, which then exploded during movement execution.

**The quote:** The researchers found that while brain activity was generally synergy-dominated (as opposed to redundancy-dominated), during movement execution (a reach-and-grasp action) the relative abundance of redundant information increased dramatically.

**Cue A:** How does the balance of synergy versus redundancy shift during a specific behavior?

**Cue B:** How does the balance of synergy versus redundancy shift during an actual movement?

---

## Pair 50

**The paragraph before:** The ability to assess how the structure of information processes changes in response to the demands of different tasks is a significant departure from the limitations of in vitro research. The researchers found that while brain activity was generally synergy-dominated (as opposed to redundancy-dominated), during movement execution (a reach-and-grasp action) the relative abundance of redundant information increased dramatically. This increase in relative redundancy was interpreted as a response to the practical requirements of the task: during motor execution, the brain needs to send the “move” signal to distant muscles, and to ensure high-fidelity transmission the brain may duplicate information many times over (minimizing the risk of a single corrupted signal leading to erroneous behavior). Similarly, different brain regions had different relative synergies during different tasks. For example, AIP (a pre-motor region) had the highest synergy during the fixation/cueing epoch, which then dropped off during movement, while M1 (the primary motor region) had the lowest synergy during the memory epoch, which then exploded during movement execution.

**The quote's paragraph** [section: 5. PID in Action]: These results show not only that synergistic information dynamics is a feature of ongoing, spontaneous neural activity but also that synergy seems to reflect behaviorally specific patterns of dynamical activity in the cortex.

**The quote:** These results show not only that synergistic information dynamics is a feature of ongoing, spontaneous neural activity but also that synergy seems to reflect behaviorally specific patterns of dynamical activity in the cortex.

**Cue A:** What do these results suggest about synergy during spontaneous activity versus specific behavior?

**Cue B:** What does this say about synergy appearing even without a task being performed?

---

## Pair 51

**The paragraph before:** Finally, for MATLAB users, there is the Neuroscience Information Theory Toolbox [9]. This package only supports the Imin redundancy function, and like IDTxl it also includes functions for transfer entropy inference, although it lacks the additional algorithms and multivariate extensions that have been developed since its release.

**The quote's paragraph** [section: 6. Practical Considerations in PID]: One important caveat to note with respect to PID applied to neural data is that while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated. Now that the existence of statistical synergies is well replicated, a natural future avenue of research might be to attempt to determine how particular biological aspects of neuronal function (e.g., neurotransmitter systems, neural architecture, etc.) produce redundant, unique, or synergistic computational dynamics.

**The quote:** One important caveat to note with respect to PID applied to neural data is that while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated.

**Cue A:** What kind of explanation does PID fail to provide, even when it finds strong dependencies?

**Cue B:** What kind of explanation does PID fail to provide about synergy-dominated neurons?

---

## Pair 52

**The paragraph before:** One important caveat to note with respect to PID applied to neural data is that while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated. Now that the existence of statistical synergies is well replicated, a natural future avenue of research might be to attempt to determine how particular biological aspects of neuronal function (e.g., neurotransmitter systems, neural architecture, etc.) produce redundant, unique, or synergistic computational dynamics.

**The quote's paragraph** [section: 6. Practical Considerations in PID]: The PID framework has a number of limitations that potentially complicate its application in naturalistic settings. The most significant is the explosive growth of the PI lattice. For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]. This sequence of numbers grows appallingly fast: in the case of six parent neurons, there are 7,828,354 distinct PI atoms, the vast majority of which are difficult to interpret. Dedekind numbers greater than nine are currently unknown. Given that single neurons can receive inputs from very large numbers of upstream neurons, a “complete” description of the information dynamics of any individual neuron is completely intractable. This issue may be partially addressed by the development of heuristic measures of redundancy and synergy such as the O-information [65], which has been applied to information dynamics in networks of neurons [66] and human functional magnetic resonance imaging blood-oxygen-level-dependent (fMRI-BOLD) signals [67], although these measures typically trade completeness for scalability.

**The quote:** This sequence of numbers grows appallingly fast: in the case of six parent neurons, there are 7,828,354 distinct PI atoms, the vast majority of which are difficult to interpret.

**Cue A:** Note how quickly the number of distinct components grows as parent neurons increase.

**Cue B:** Notice how fast the number of distinct information components grows with more neurons.

---

## Pair 53

**The paragraph before:** The original PID framework allows for the decomposition of the information that an arbitrary set of parents provides about a single target. A natural generalization is to allow for multiple targets. For example, what synergistic information about two targets is disclosed by the synergistic joint state of two parents? In the context of a temporally evolving process, the same analysis could be used to decompose the redundant, unique, and synergistic ways that the past constrains the future. A recent multi-target generalization of the PID, termed integrated information decomposition (ΦID) [69,70] has been proposed, which opens the door to a much wider range of possible analyses than is possible with a single-target PID analysis. ΦID analysis of fMRI data has found changes in the flow of synergistic information associated with loss of consciousness [46,71] and the genetic architecture of the brain [44]. A recently introduced “temporal redundancy function” (Iτsx), coupled with a ΦID analysis, led to the discovery of a set of sixteen distinct information dynamics associated with the temporal evolution of pairs of interacting neurons, many of which were previously unknown [45]. Due to its comparative novelty, multi-target information decomposition has received less attention than its single-target counterpart, and consequently, a number of open questions remain.

**The quote's paragraph** [section: 8. Summary and Closing Matter]: In this paper, we have aimed to provide an accessible introduction to the partial information decomposition framework [1] and shown how it can be applied to answer fundamental questions about information processing in neural circuits. We have focused particularly on statistical synergy, i.e., the information about the future of a target neuron that is disclosed by the higher-order patterns instantiated by multiple upstream neurons and is irreducible to any single source, as a measure of processing or computation. The existence of synergy in empirical data shows us that neurons do not appear to blindly sum the number of inputs and fire in response to the total (as would be expected from a basic threshold model or complex contagion model), but instead they are also sensitive to the particular patterns of incoming stimuli. Furthermore, not only does the existence of statistical synergy add nuance and dimensions to our understanding of the dynamics of individual neurons, we have also shown that the patterns of synergistic information processing are informed by the local environment in which those neurons are embedded (rich club membership, motifs, clustering, etc.), as well as the behavioral state of the oganism under study. These findings hint at the existence of a large, potentially fruitful space of future research relating higher-order information dynamics to biological, cognitive, systemic phenomena at many scales of analysis.

**The quote:** The existence of synergy in empirical data shows us that neurons do not appear to blindly sum the number of inputs and fire in response to the total (as would be expected from a basic threshold model or complex contagion model), but instead they are also sensitive to the particular patterns of incoming stimuli.

**Cue A:** What does the presence of synergy suggest neurons are doing besides simple summation?

**Cue B:** What alternative to simple summation of inputs does the presence of synergy point to?

---

## Pair 54

**The paragraph before:** Ball lightning monographies and reviews were accomplished, e.g. by Brand (1923, 2010), Singer (1971), Stakhanov (1979), Barry (1980), Smirnov (1993), Stenhoff (1999), Rakov and Uman (2003), Bychkov et al. (2010), Shmatov and Stephan (2019), and Boerner (2019). Ball lightning cases also have a psychological side, when it comes to eyewitness quality, (non-)reporting, and public and media event labelling. Here, everyday life theories or mindsets are more influential than science. However, research about lay theories (Furnham, 1988; Zedelius et al., 2017) has its focus on the social sciences and not physics, so the borderland of ball lightning, folklore, and public opinions has not been further explored.

**The quote's paragraph** [section: 1 Historical outline]: In chapter 20 of their lightning handbook, Rakov and Uman (2003) summed up the status quo on ball lightning. The authors were puzzled by 2400 references in Stenhoff’s book (1999), whereas their handbook on all lightning aspects comprises over 6000. This was also remarked by Thottapillil (2005, p. 31) in his COST Action proposal P18 on the physics of lightning together with 30 European researchers and the consensus that “the reality of ball lightning is not in doubt.” Rakov and Uman (2003, p. 656, p. 658) characterized ball lightning as “a phenomenon for which there exists numerous witness reports but little, if any, scientific documentation such as photographs, videotapes, or other scientific recordings.” They counted almost 5000 observation reports. “There may be more than one type of ball lightning and more than one mechanism by which ball lightning is generated”, they continue, also “There have been many theories devised to explain ball lightning. None is completely satisfactory” and “many luminous phenomena created in the laboratory are claimed by their creators to be ball lightning”. For the same reason, Turner called ball lightning research a “fragmented science” (2001).

**The quote:** Rakov and Uman (2003, p. 656, p. 658) characterized ball lightning as “a phenomenon for which there exists numerous witness reports but little, if any, scientific documentation such as photographs, videotapes, or other scientific recordings.”

**Cue A:** Look for what kind of evidence the literature says is missing.

**Cue B:** Look for how scientific reviewers describe the quality of evidence for this phenomenon.

---

## Pair 55

**The paragraph before:** “Guarda! Guarda!” (“See! See!”) – calls from the Corsa dei Servi (central street, now Corso Vittorio Emanuele II) in the centre of Milan alarmed Lorenzo Butti, marine painter of the Empress of Austria. It was 18:00 LT (local time) in June 1841, with a heavy thunderstorm outside. Butti looked out of the window where people were running in the rain under a reddish-yellow ball of fire. It travelled at window height of the second floor, rose higher, and then exploded at a church tower cross with a dull crash. The artist wrote his experience to physicist Arago. Arago’s report was rediscovered by senior school official Walther Brand for his monograph “Der Kugelblitz” (1923, 2010), the only one in German to date.

**The quote's paragraph** [section: 1 Historical outline]: Since Sur le tonnerre of French astronomer and physicist François Arago (1837), the term ball lightning (Kugelblitz, foudre globulaire) stands for a still unexplained group of metastable luminous phenomena in atmospheric electricity. Ball lightning appears seemingly random in time and space, lasts a few seconds, and disappears with traces or without. Because of its unpredictable occurrence, most of the collected material remains anecdotal.

**The quote:** Ball lightning appears seemingly random in time and space, lasts a few seconds, and disappears with traces or without. Because of its unpredictable occurrence, most of the collected material remains anecdotal.

**Cue A:** Notice what makes each occurrence so hard to predict or capture.

**Cue B:** Notice what kind of traces, if any, are said to remain after the event.

---

## Pair 56

**The paragraph before:** Reported object relations were the following: nine mountains; six telephone, power lines, or power station; four aeroplanes; three lakes or rivers; one tower; and one sailboat. One object penetrated a wall, one disappeared into a wall, one split, and two phenomena were repeaters.

**The quote's paragraph** [section: 5 Synopsis of cases]: Thus, even this relatively small sample of educated and trained observers shows a variety of situations, object sizes, and case durations, and some outliers are hard to integrate into one general ball lightning model. This has led some researchers (as Rakov and Uman, 2003) to assume several types of ball lightning. Epistemologically, it would be odd to define a “ball lightning norm” and a priori exclude cases that do not meet this definition. Regardless of all problems with an explanatory theory, detailed case reports should be documented. Scientists who read the article and who have not reported their experience are invited to share it with the author.

**The quote:** Epistemologically, it would be odd to define a “ball lightning norm” and a priori exclude cases that do not meet this definition. Regardless of all problems with an explanatory theory, detailed case reports should be documented.

**Cue A:** Ask whether the author wants a single strict definition of the phenomenon or not.

**Cue B:** Ask whether the author treats all reported cases as one single type of event.

---

## Pair 57

**The paragraph before:** In chapter 20 of their lightning handbook, Rakov and Uman (2003) summed up the status quo on ball lightning. The authors were puzzled by 2400 references in Stenhoff’s book (1999), whereas their handbook on all lightning aspects comprises over 6000. This was also remarked by Thottapillil (2005, p. 31) in his COST Action proposal P18 on the physics of lightning together with 30 European researchers and the consensus that “the reality of ball lightning is not in doubt.” Rakov and Uman (2003, p. 656, p. 658) characterized ball lightning as “a phenomenon for which there exists numerous witness reports but little, if any, scientific documentation such as photographs, videotapes, or other scientific recordings.” They counted almost 5000 observation reports. “There may be more than one type of ball lightning and more than one mechanism by which ball lightning is generated”, they continue, also “There have been many theories devised to explain ball lightning. None is completely satisfactory” and “many luminous phenomena created in the laboratory are claimed by their creators to be ball lightning”. For the same reason, Turner called ball lightning research a “fragmented science” (2001).

**The quote's paragraph** [section: 2 Methodology]: Chances to monitor the transient phenomenon directly are minimal: Tompkins et al. (1975) searched about 12 000 photographic records of the US Prairie Meteorite Network that observed the night sky daily for over 10 years and found two probable ball lightning events. Other photographic or video records (e.g. 1935 Berlin; 1976 Transvaal, South Africa; 1978 Montafon, Austria; 1985 Lake Undugun, Russia; or 2003 Zwönitz, Germany) were also random products. Therefore, Singer (1971, chap. 5.B.2) and Stenhoff (1999, chap. 10.4) paid special attention to ball lightning reports coming from scientists or trained professionals. However, large databanks like Rayle’s (1966; N = 112 reports) and McNally’s (1966; N = 513 reports) from the US did not ask for observer’s professions and degrees. Published ball lightning reports of scientists are scattered, and even more remain unpublished.

**The quote:** Chances to monitor the transient phenomenon directly are minimal: Tompkins et al. (1975) searched about 12 000 photographic records of the US Prairie Meteorite Network that observed the night sky daily for over 10 years and found two probable ball lightning events.

**Cue A:** Note how rare a direct photographic catch turned out to be, given the search effort.

**Cue B:** Note how rare direct photographic capture of the phenomenon turns out to be.

---

## Pair 58

**The paragraph before:** Physics professor Vladimir Lvovich Bychkov, then working at Thousand Oaks, California, USA, returned home on 25 October 2002, at 21:30 LT. In his 2005 note he remembered smog, and it was dark and windy. “I walked downhill along a dimly lit street. Suddenly, 20–30 m above a palm tree 50 m from me, near my house, a bright object lit up noiselessly. It was white, had about 500–1000 W brightness, approximate size 30–40 cm, was falling down for about 2–3 s at 1 m s−1, and then silently went out. There were no people nearby, it was no firecracker, and did not fall from a plane” (Vladimir Lvovich Bychkov, personal communication, 2020). Camarillo airport, 27 km west, reported 88 % relative humidity and 4.6 mph (7.4 km h−1) ENE wind at 20:55 LT. It was cloudy, with local rain showers possible. As high object brightness was reported, we note that adaptation luminance is lowered by a night setting (Schreuder, 1998), so a ground glass 500 W incandescent light bulb (now phased out) will glare with 5 × 105 cd m−2.

**The quote's paragraph** [section: 3 Scientists as ball lightning observers]: A special category of reports is ball lightning encountered by children who, in their later life, followed a scientific career and then described in detail what they saw. It can be argued that all children have similar observation capabilities. However, scientific training and profession might improve the quality of their recalled eyewitness testimony. Therefore, four such accounts are included in this compilation:

**The quote:** A special category of reports is ball lightning encountered by children who, in their later life, followed a scientific career and then described in detail what they saw. It can be argued that all children have similar observation capabilities. However, scientific training and profession might improve the quality of their recalled eyewitness testimony.

**Cue A:** Consider why a childhood witness's later career might matter to how their account is read.

**Cue B:** Consider what is claimed to make a childhood witness's later account more reliable.

---

## Pair 59

**The paragraph before:** The author, meteorologist and psychologist, collected, evaluated, and published European ball lightning cases for 45 years (Keul, 1980, 1981, 1992, 1993, 1994, 2004; Keul and Stummer, 2002; Kugelblitz, 2021). For most of this period of time, ball lightning case work was limited to single case investigations and statistical synopses, lacking an interdisciplinary perspective with forensic experts, materials science, lightning protection experts, etc. The upswing of modern lightning location networks (like BLIDS, German lightning information service, or ALDIS, Austrian lightning detection and information system) opened up new options, so recently, a first correlation of 34 central European ball lightning events, 1994–2016, with lightning location data was done together with ALDIS (Keul and Diendorfer, 2018). Nineteen detected strokes, correlated in time with ball lightning, were positive (4–370 kA peak current) and 15 were negative (−3 to −37 kA). Twenty-eight were cloud–ground strokes and 6 were cloud–cloud strokes; 28 occurred in the summer months and 6 in winter. Seventeen events had close-distance lightning strokes – ball lightning under 1 km (mean 0.42 km), and 17 were distant events (1–10 km, mean 5.7 km). The unexpectedly high number of positive strokes and the equal frequency of close and distant events were discussed at the 34th International Conference on Lightning Protection.

**The quote's paragraph** [section: 3 Scientists as ball lightning observers]: We start our series of cases with a chronology of eyewitness reports by natural scientists, and technical and medical experts. Several alleged observations (e.g. of Niels Bohr and Victor Weisskopf), often quoted in science or popular journals, were incorrect or lacked data: Tuck (1971) only wrote that he heard from Weisskopf that Bohr had once seen ball lightning. Martin Ryle was quoted without details by Davies (1987). Pyotr Leonidovich Kapitsa developed a ball lightning theory but reported no alleged sighting. Geologist and mineralogist Wilhelm von Haidinger, member of the Imperial Academy of Sciences at Vienna, observed ball lightning from his home at Vienna’s 3rd district Landstrasse on 20 October 1868, in a heavy thunderstorm between 17:15 and 17:30 LT: “The electric fireball was one of the very first discharges of the thunderstorm . . . It stood maybe 2–3 s in front of the right pane of the window . . . It is indeed simple to describe the ball, of a vivid yellow light, especially on the right . . . while on the left . . . clearly red, with longer rays than the ball, firing from it to the right and towards the earth, of red, yellow colour, up to the most dazzling white. Also, left there were shorter rays inclined obliquely towards the earth. . . . Several discharges followed and after [them] hail and rain.” Haidinger (see his sketch in Fig. 1) determined the object’s angular diameter as 0.83°. After his observation at Ungargasse 3, 3rd district, to the southwest, Haidinger heard about other occurrences in Vienna. Four of them sound like ordinary lightning but two described ball lightning: P. Joseph Dobner, Haidinger’s friend, took shelter from the thunderstorm in a friend’s home at Magdalenenstr. 32, 6th district. He saw a glaring blue sphere outside the window to the southeast. No more details are given. Another

**The quote:** Wilhelm von Haidinger, member of the Imperial Academy of Sciences at Vienna, observed ball lightning from his home at Vienna’s 3rd district Landstrasse on 20 October 1868, in a heavy thunderstorm between 17:15 and 17:30 LT

**Cue A:** Look at what detail an academy scientist's own account supplies about timing and place.

**Cue B:** Look for the exact time and setting recorded for this early witnessed case.

---

## Pair 60

**The paragraph before:** Stanley Singer (1971, pp. 29–33) lists several accounts of natural scientists in his book, starting with Belgian astronomer M. E. Bijl, who saw in 1905 a red glowing ball with halo near his observatory. Abbott Lawrence Rotch, US meteorologist, founder of the Blue Hill Observatory south of Boston, and pioneer of kite soundings, saw and described ball lightning after lightning hit the Eiffel Tower in Paris in 1903. The bright ball, size 1 m, fell from the top to third platform, about 100 m in 2 s, where it disappeared. The tower guard knew other similar events (Singer, 1971). The time of 2 s for 100 m was faster than the free fall which would have taken about 5 s.

**The quote's paragraph** [section: 3 Scientists as ball lightning observers]: Walther Gerlach, physics professor at the University of Tübingen, wrote a report to Naturwissenschaften on 20 May 1927: “On 9 May 1927, 08:00 [LT] I observed ball lightning [at Tübingen] . . . I happened to stand at the window . . . In the northeast, linear lightning went down with strong ramifications. From it (apparently out of a sharp kink) came a bright luminous yellowish-white ball in a considerable height and flew to the southwest. The time between lightning and the ball’s flyover of our institute was roughly 1 s. It could be observed for another second in the same appearance on its straight trajectory, soundless. Two seconds later, a not very strong thunder started, and 1.5 s after its start, there was an extraordinarily violent detonation, like an explosion bang.” Gerlach did his calculations: with a speed of sound of 330 m s−1 and observed times of the lightning’s thunder and the explosion, he got a ball lightning trajectory of 1300 + 1150 = 2450 m. In 2 s flight time, “ball lightning had a mean speed of about 1200 m s−1”. “I learnt at noon that the ball hit a small, barn-like house on the edge of Tübingen which is 1100 m distant . . . the top of an electrical mast was smashed nearby.” Gerlach also mentioned bluish “spraying” of electrical wires and blown fuses in “a whole row of houses” (Gerlach, 1927). His speed calculation of 1225 m s−1 is quite amazing, because it means the object travelled at a speed of Mach 3.6 “soundless”, without an acoustic effect (sonic boom). This is one of the rare occasions where ball lightning met a gifted experimental physicist. Gerlach is renowned for his 1922 experiment about spin quantization in a magnetic field.

**The quote:** Gerlach also mentioned bluish “spraying” of electrical wires and blown fuses in “a whole row of houses” (Gerlach, 1927). His speed calculation of 1225 m s−1 is quite amazing, because it means the object travelled at a speed of Mach 3.6 “soundless”, without an acoustic effect (sonic boom). This is one of the rare occasions where ball lightning met a gifted experimental physicist.

**Cue A:** Watch how a physicist turns an observed motion into a speed figure, and what that implies.

**Cue B:** Check what physical quantity is inferred from the aftermath rather than observed directly.

---

## Pair 61

**The paragraph before:** The German graduate physicist Hans Dolezalek, working on atmospheric electricity after 1961 for the US Navy, reported his own observation at Tübingen, Baden-Württemberg, Germany (Dolezalek, 1951). On 8 June 1951, about 17:00 LT, a thunderstorm started. Minutes before 18:00 LT, Dolezalek saw ball lightning like a car headlight 30 m away, moving downwards aslant with about 50–100 m s−1, disappear behind trees. A violent bang was heard, like an explosion or a grenade launcher, followed by a rising blue smoke cloud. The object’s impact with 10 m bright rays spreading upwards was seen by another observer in a meadow. Later, a 50 cm burned spot was found. Two isolators of a 5 kV power line pylon 5 m from the impact point were damaged. Neckar power station Hirschau (connected to the 5 kV line) registered an interruption at 17:54 LT.

**The quote's paragraph** [section: 3 Scientists as ball lightning observers]: Coroner Leopold Breitenecker, later a forensic medicine professor at Vienna University, encountered ball lightning at Ternitz, Lower Austria, in the summer of 1955, 16–17:00 LT. He carried out an autopsy with a colleague in an old mortuary during a heavy thunderstorm, when lightning struck and threw the electricity meter out of the wall. From the hole in the wall, a fist-sized, sharply outlined ball descended to the floor, radiating a bluish white light like a welding arc. It moved 5 cm above the floor to the open door but disappeared into the stone wall beneath the door frame. The witness threw down his instruments and leapt to the door just in time to see the ball (apparently after passing through a crack in the wall) move across the vestibule and out of the mortuary’s front door. It bounced down the steps like a toy ball and disappeared into a grave mound after travelling 8–10 m in about 5 s (Keul, 1980, 1981). Breitenecker saw ball lightning a second time from Mühlbach/Attersee, Upper Austria, in the summer of 1975, late afternoon, looking towards Mt Schafberg in a thunderstorm with many lightning flashes. Suddenly, a distant fireball travelled horizontally along a mountain wall, then burst sparking, like a spray candle.

**The quote:** Coroner Leopold Breitenecker, later a forensic medicine professor at Vienna University, encountered ball lightning at Ternitz, Lower Austria, in the summer of 1955, 16–17:00 LT.

**Cue A:** Notice who this witness became professionally and why that might matter.

**Cue B:** Notice what profession this witness held and how that shapes the account given.

---

## Pair 62

**The paragraph before:** …e observer Kurt Krenn, station Wiel/Eibiswald, Styria, Austria, saw a severe thunderstorm cross the mountains with lightning after 21:30 LT. At 22:00, he noticed lightning with a blue-white flare that lasted for about 3 min and ended with two more lightning flashes and a local blackout. Other people had seen more – a stationary blue-white ball at the Gontschnigg hill west of Eibiswald for 3 min. In the evening of 4 July 1989, a thunderstorm front passed St Poelten, Lower Austria. Christian Witz, synoptic observer of the local weather station, was off duty, taking lightning photos near Senning, east of town. Around 21:00 LT it was dark because of heavy rain. After a ground stroke, Witz saw a white fuzzy ball above the ground about 300 m from the lightning location. It was stationary and went out after 7 s. A time exposure with his camera showed a white blob (Keul, 1994). On 15 January 1994, thunderstorms moved in from the North Sea over Neuruppin, Brandenburg, Germany. Shortly after 17:00 LT, Thomas Hinz, the local weather observer on duty, saw a very bright lightning flash with thunder after 10 s to the north. In the following days, a series of observations from Neuruppin people were forthcoming. Fourteen witnesses described ball lightning, mostly outside their homes, size between 0.2 and 1 m, seven objects were seen in motion. The German lightning location system BLIDS detected positive cloud–ground lightning of 370 kA at 17:08:36 LT 6 km to the north (Baecker et al., 2007).

**The quote's paragraph** [section: 4 Other trained observers]: The tendency of weather services to do without observers and automate synoptic stations (including German mountain-top observatories) may be justified from an economic standpoint, but it eliminates high-quality observations of rare phenomena such as ball lightning. Whether this will be compensated by citizen science and the spread of mobile phone and web cameras remains uncertain.

**The quote:** The tendency of weather services to do without observers and automate synoptic stations (including German mountain-top observatories) may be justified from an economic standpoint, but it eliminates high-quality observations of rare phenomena such as ball lightning.

**Cue A:** Ask what trade-off is described between automation and quality of rare observations.

**Cue B:** Think about what is lost when human observers are replaced by automated stations.

---

## Pair 63

**The paragraph before:** Thus, even this relatively small sample of educated and trained observers shows a variety of situations, object sizes, and case durations, and some outliers are hard to integrate into one general ball lightning model. This has led some researchers (as Rakov and Uman, 2003) to assume several types of ball lightning. Epistemologically, it would be odd to define a “ball lightning norm” and a priori exclude cases that do not meet this definition. Regardless of all problems with an explanatory theory, detailed case reports should be documented. Scientists who read the article and who have not reported their experience are invited to share it with the author.

**The quote's paragraph** [section: 6 Other influential or notable cases]: A citation classic in ball lightning literature (Singer, 1971; Barry, 1980) as well as in popular articles is the case of Georg Wilhelm Richmann, a Baltic German physicist and member of the St Petersburg Academy of Sciences, who, during work on atmospheric electricity, was electrocuted in 1753. From an investigation protocol with autopsy results (Anonymous, 1755, pp. 64–68), it is obvious that it was a conventional lightning accident caused by a non-grounded conductor. However, a popular engraving pictured a lightning ball that hit Richmann. As in the 1818 Frankenstein novel, the grim fate of an avantgarde scientist sounded plausible. Ball lightning acquired a deadly and destructive popular image fed by injuries and damage caused by ordinary cloud–ground strokes.

**The quote:** Ball lightning acquired a deadly and destructive popular image fed by injuries and damage caused by ordinary cloud–ground strokes.

**Cue A:** Ask what ordinary event may have supplied the dramatic image attached to this phenomenon.

**Cue B:** Look for what ordinary event is said to have shaped the dramatic public image.

---

## Pair 64

**The paragraph before:** On 23 June 2008, at about 20:45 LT, Rozlyn Krjcik, administrative director emeritus of the New York State Spinal Cord Injury Center, Poughquag, New York, USA, arrived at her Poughquag home by car in heavy rain and with lightning around. Waiting in her car for the rain to decrease, she had the front glass porch in view (Stephan et al., 2016, p. 33): “I was stunned. . . . I saw that fiery ball, yellow-flame appearance in my front door. . . . It was the centre of the door, at least twice, two and a half times more area than you’d expect from that small cantaloupe-size blue object I saw.” The glowing blue sphere was 14 cm in diameter and then flew away between her house and her car. Glass types fluoresce when subjected to ionizing radiation of < 375 nm (UV light or X-rays) because of heavy metals in the glass. Calibrated quantitative fluorometry measurements of the NY porch window in June 2016 found that for a floodlight illumination, the object’s ionizing-radiation output was 10 W; if considerably brighter, it was 100 W.

**The quote's paragraph** [section: 6 Other influential or notable cases]: An innovative field experiment was carried out by Martin A. Uman’s US research group (Hill et al., 2010): at the military base Camp Blanding, Florida, the group had already triggered numerous lightning strikes by rockets with a trailed metal wire. In 2008, triggered lightning was conducted to over 100 substances on the ground, including salt water, silicon wafers, stainless steel, or conifer branches. The resulting phenomena were photographed and analysed. So, a flame was created for over half a second over salt water, glowing silicon fragments fell down for 1 s, a flashover on the steel surface formed a 33 cm ball of light, and the discharge into the conifer branches was visible for half a second. Uman and colleagues call what was produced not ball lightning but point to interesting effects of different materials under the influence of lightning.

**The quote:** Uman and colleagues call what was produced not ball lightning but point to interesting effects of different materials under the influence of lightning.

**Cue A:** Look for what a lab-produced effect was and was not judged to be.

**Cue B:** Notice what distinction researchers draw between their experimental result and the real phenomenon.

---

## Pair 65

**The paragraph before:** Looking back onto 41 ball lightning observations by scientists and trained professionals published or from researchers’ records and six other cases with high investigation effort, it can be discussed how such reports and material-evidence cases may promote fieldwork and stimulate and evaluate ball lightning theories to overcome Turner’s “fragmented science” (2001).

**The quote's paragraph** [section: 7 Conclusions]: The main difference between modern science and Frankenstein’s laboratory is guiding research paradigms that – in the case of natural phenomena – condition a proper order of systematic data acquisition, formation, and testing of hypotheses and theories, and – if possible – laboratory simulation. In the case of ball lightning, the research logic is distorted by a random phenomenon that is hard to observe, irreproducible, and mostly reported by change. Weird popular press stories and a lack of economic (except some military) interest did not encourage scientific community nor weather services to deal with this “unsolved problem in atmospheric physics” (Stenhoff, 1999). Most ball lightning research was (and still is) part-time and individualized – some people collecting data, some theorizing, some doing laboratory tests. Big databases (e.g. Brand, Stakhanov, Rayle, McNally) ended and amateurs took over, theorists opened at least 16 explanatory domains (Rakov and Uman, 2003, p. 664), and a diversity of laboratory simulations developed laterally.

**The quote:** The main difference between modern science and Frankenstein’s laboratory is guiding research paradigms that – in the case of natural phenomena – condition a proper order of systematic data acquisition, formation, and testing of hypotheses and theories, and – if possible – laboratory simulation. In the case of ball lightning, the research logic is distorted by a random phenomenon that is hard to observe, irreproducible, and mostly reported by change.

**Cue A:** Ask what the author says disrupts the normal order of scientific investigation here.

**Cue B:** What does the author say throws off the normal order of scientific research here?

---

## Pair 66

**The paragraph before:** The main difference between modern science and Frankenstein’s laboratory is guiding research paradigms that – in the case of natural phenomena – condition a proper order of systematic data acquisition, formation, and testing of hypotheses and theories, and – if possible – laboratory simulation. In the case of ball lightning, the research logic is distorted by a random phenomenon that is hard to observe, irreproducible, and mostly reported by change. Weird popular press stories and a lack of economic (except some military) interest did not encourage scientific community nor weather services to deal with this “unsolved problem in atmospheric physics” (Stenhoff, 1999). Most ball lightning research was (and still is) part-time and individualized – some people collecting data, some theorizing, some doing laboratory tests. Big databases (e.g. Brand, Stakhanov, Rayle, McNally) ended and amateurs took over, theorists opened at least 16 explanatory domains (Rakov and Uman, 2003, p. 664), and a diversity of laboratory simulations developed laterally.

**The quote's paragraph** [section: 7 Conclusions]: Nevertheless, the author is still optimistic that scientific progress will be faster when capacities are better coordinated. A new US research group is just underway organizing online report collection and investigation (Sonnenfeld et al., 2020). With physical evidence cases like the Dorstone tub, the Poughquag glass, or the Qinghai spectrum as benchmarks and digital material from abundantly present mobile phones and webcams, systematic multidisciplinary case documentation and discussion can lead to a database against which ball lightning theories and simulations can be critically assessed.

**The quote:** With physical evidence cases like the Dorstone tub, the Poughquag glass, or the Qinghai spectrum as benchmarks and digital material from abundantly present mobile phones and webcams, systematic multidisciplinary case documentation and discussion can lead to a database against which ball lightning theories and simulations can be critically assessed.

**Cue A:** Look for what kinds of modern evidence the author hopes will anchor future study.

**Cue B:** Look for what kinds of physical evidence and modern tools could build a better record.

---

## Pair 67

**The paragraph before:** When trained on mid-sized datasets such as ImageNet without strong regularization, these models yield modest accuracies of a few percentage points below ResNets of comparable size. This seemingly discouraging outcome may be expected: Transformers lack some of the inductive biases inherent to CNNs, such as translation equivariance and locality, and therefore do not generalize well when trained on insufficient amounts of data.

**The quote's paragraph** [section: 1 INTRODUCTION]: However, the picture changes if the models are trained on larger datasets (14M-300M images). We find that large scale training trumps inductive bias. Our Vision Transformer (ViT) attains excellent results when pre-trained at sufficient scale and transferred to tasks with fewer datapoints. When pre-trained on the public ImageNet-21k dataset or the in-house JFT-300M dataset, ViT approaches or beats state of the art on multiple image recognition benchmarks. In particular, the best model reaches the accuracy of 88.55% on ImageNet, 90.72% on ImageNet-ReaL, 94.55% on CIFAR-100, and 77.63% on the VTAB suite of 19 tasks.

**The quote:** We find that large scale training trumps inductive bias.

**Cue A:** What tradeoff between scale and built-in assumptions does this claim?

**Cue B:** Look for what the authors say matters more than built-in image-specific design.

---

## Pair 68

**The paragraph before:** Figure 7: Left: Filters of the initial linear embedding of RGB values of ViT-L/32. Center: Similarity of position embeddings of ViT-L/32. Tiles show the cosine similarity between the position embedding of the patch with the indicated row and column and the position embeddings of all other patches. Right: Size of attended area by head and network depth. Each dot shows the mean attention distance across images for one of 16 heads at one layer. See Appendix D.7 for details.

**The quote's paragraph** [section: 5 CONCLUSION]: We have explored the direct application of Transformers to image recognition. Unlike prior works using self-attention in computer vision, we do not introduce image-specific inductive biases into the architecture apart from the initial patch extraction step. Instead, we interpret an image as a sequence of patches and process it by a standard Transformer encoder as used in NLP. This simple, yet scalable, strategy works surprisingly well when coupled with pre-training on large datasets. Thus, Vision Transformer matches or exceeds the state of the art on many image classification datasets, whilst being relatively cheap to pre-train.

**The quote:** This simple, yet scalable, strategy works surprisingly well when coupled with pre-training on large datasets.

**Cue A:** What two ingredients does the strategy pair to work this well?

**Cue B:** Note what simple strategy the authors call surprisingly effective, and under what condition.

---

## Pair 69

**The paragraph before:** Inspired by the Transformer scaling successes in NLP, we experiment with applying a standard Transformer directly to images, with the fewest possible modifications. To do so, we split an image into patches and provide the sequence of linear embeddings of these patches as an input to a Transformer. Image patches are treated the same way as tokens (words) in an NLP application. We train the model on image classification in supervised fashion.

**The quote's paragraph** [section: 1 INTRODUCTION]: When trained on mid-sized datasets such as ImageNet without strong regularization, these models yield modest accuracies of a few percentage points below ResNets of comparable size. This seemingly discouraging outcome may be expected: Transformers lack some of the inductive biases inherent to CNNs, such as translation equivariance and locality, and therefore do not generalize well when trained on insufficient amounts of data.

**The quote:** When trained on mid-sized datasets such as ImageNet without strong regularization, these models yield modest accuracies of a few percentage points below ResNets of comparable size.

**Cue A:** Look for how the model performs on medium-sized data compared to ResNets.

**Cue B:** How does accuracy compare to ResNets when the training set is only mid-sized?

---

## Pair 70

**The paragraph before:** \[y = \operatorname{LN}(z^0_L)\] (4)

**The quote's paragraph** [section: 3 METHOD]: We note that Vision Transformer has much less image-specific inductive bias than CNNs. In CNNs, locality, two-dimensional neighborhood structure, and translation equivariance are baked into each layer throughout the whole model. In ViT, only MLP layers are local and translationally equivariant, while the self-attention layers are global. The two-dimensional neighborhood structure is used very sparingly: in the beginning of the model by cutting the image into patches and at fine-tuning time for adjusting the position embeddings for images of different resolution (as described below). Other than that, the position embeddings at initialization time carry no information about the 2D positions of the patches and all spatial relations between the patches have to be learned from scratch.

**The quote:** We note that Vision Transformer has much less image-specific inductive bias than CNNs. In CNNs, locality, two-dimensional neighborhood structure, and translation equivariance are baked into each layer throughout the whole model. In ViT, only MLP layers are local and translationally equivariant, while the self-attention layers are global.

**Cue A:** Which parts of the model stay local and which become fully global?

**Cue B:** Compare which layers in this model are local versus global, and why that matters.

---

## Pair 71

**The paragraph before:** Figure 5: Performance versus pre-training compute for different architectures: Vision Transformers, ResNets, and hybrids. Vision Transformers generally outperform ResNets with the same computational budget. Hybrids improve upon pure Transformers for smaller model sizes, but the gap vanishes for larger models.

**The quote's paragraph** [section: 4 EXPERIMENTS]: Second, we train our models on random subsets of 9M, 30M, and 90M as well as the full JFT-300M dataset. We do not perform additional regularization on the smaller subsets and use the same hyper-parameters for all settings. This way, we assess the intrinsic model properties, and not the effect of regularization. We do, however, use early-stopping, and report the best validation accuracy achieved during training. To save compute, we report few-shot linear accuracy instead of full fine-tuning accuracy. Figure 4 contains the results. Vision Transformers overfit more than ResNets with comparable computational cost on smaller datasets. For example, ViT-B/32 is slightly faster than ResNet50; it performs much worse on the 9M subset, but better on 90M+ subsets. The same is true for ResNet152x2 and ViT-L/16. This result reinforces the intuition that the convolutional inductive bias is useful for smaller datasets, but for larger ones, learning the relevant patterns directly from data is sufficient, even beneficial.

**The quote:** This result reinforces the intuition that the convolutional inductive bias is useful for smaller datasets, but for larger ones, learning the relevant patterns directly from data is sufficient, even beneficial.

**Cue A:** Why might built-in geometric assumptions matter less as dataset size grows?

**Cue B:** Ask why built-in locality assumptions might stop mattering as dataset size grows.

---

## Pair 72

**The paragraph before:** We perform a controlled scaling study of different models by evaluating transfer performance from JFT-300M. In this setting data size does not bottleneck the models’ performances, and we assess performance versus pre-training cost of each model. The model set includes: 7 ResNets, R50x1, R50x2 R101x1, R152x1, R152x2, pre-trained for 7 epochs, plus R152x2 and R200x3 pre-trained for 14 epochs; 6 Vision Transformers, ViT-B/32, B/16, L/32, L/16, pre-trained for 7 epochs, plus L/16 and H/14 pre-trained for 14 epochs; and 5 hybrids, R50+ViT-B/32, B/16, L/32, L/16 pre-trained for 7 epochs, plus R50+ViT-L/16 pre-trained for 14 epochs (for hybrids, the number at the end of the model name stands not for the patch size, but for the total dowsampling ratio in the ResNet backbone).

**The quote's paragraph** [section: 4 EXPERIMENTS]: Figure 5 contains the transfer performance versus total pre-training compute (see Appendix D.5 for details on computational costs). Detailed results per model are provided in Table 6 in the Appendix. A few patterns can be observed. First, Vision Transformers dominate ResNets on the performance/compute trade-off. ViT uses approximately 2 − 4× less compute to attain the same performance (average over 5 datasets). Second, hybrids slightly outperform ViT at small computational budgets, but the difference vanishes for larger models. This result is somewhat surprising, since one might expect convolutional local feature processing to assist ViT at any size. Third, Vision Transformers appear not to saturate within the range tried, motivating future scaling efforts.

**The quote:** First, Vision Transformers dominate ResNets on the performance/compute trade-off. ViT uses approximately 2 − 4× less compute to attain the same performance (average over 5 datasets).

**Cue A:** Look at how much less computation is needed for similar performance.

**Cue B:** Look for how much less computation is needed to match performance.

---

## Pair 73

**The paragraph before:** Naive application of self-attention to images would require that each pixel attends to every other pixel. With quadratic cost in the number of pixels, this does not scale to realistic input sizes. Thus, to apply Transformers in the context of image processing, several approximations have been tried in the past. Parmar et al. (2018) applied the self-attention only in local neighborhoods for each query pixel instead of globally. Such local multi-head dot-product self attention blocks can completely replace convolutions (Hu et al., 2019; Ramachandran et al., 2019; Zhao et al., 2020). In a different line of work, Sparse Transformers (Child et al., 2019) employ scalable approximations to global self-attention in order to be applicable to images. An alternative way to scale attention is to apply it in blocks of varying sizes (Weissenborn et al., 2019), in the extreme case only along individual axes (Ho et al., 2019; Wang et al., 2020a). Many of these specialized attention architectures demonstrate promising results on computer vision tasks, but require complex engineering to be implemented efficiently on hardware accelerators.

**The quote's paragraph** [section: 2 RELATED WORK]: Most related to ours is the model of Cordonnier et al. (2020), which extracts patches of size 2 × 2 from the input image and applies full self-attention on top. This model is very similar to ViT, but our work goes further to demonstrate that large scale pre-training makes vanilla transformers competitive with (or even better than) state-of-the-art CNNs. Moreover, Cordonnier et al. (2020) use a small patch size of 2 × 2 pixels, which makes the model applicable only to small-resolution images, while we handle medium-resolution images as well.

**The quote:** Most related to ours is the model of Cordonnier et al. (2020), which extracts patches of size 2 × 2 from the input image and applies full self-attention on top. This model is very similar to ViT, but our work goes further to demonstrate that large scale pre-training makes vanilla transformers competitive with (or even better than) state-of-the-art CNNs.

**Cue A:** How does the patch size and prior approach compare to this one, and what's the key difference claimed?

**Cue B:** Notice how this prior patch-based model differs from the one in this paper.

---

## Pair 74

**The paragraph before:** We first compare our largest models – ViT-H/14 and ViT-L/16 – to state-of-the-art CNNs from the literature. The first comparison point is Big Transfer (BiT) (Kolesnikov et al., 2020), which performs supervised transfer learning with large ResNets. The second is Noisy Student (Xie et al., 2020), which is a large EfficientNet trained using semi-supervised learning on ImageNet and JFT-300M with the labels removed. Currently, Noisy Student is the state of the art on ImageNet and BiT-L on the other datasets reported here. All models were trained on TPUv3 hardware, and we report the number of TPUv3-core-days taken to pre-train each of them, that is, the number of TPUv3 cores (2 per chip) used for training multiplied by the training time in days.

**The quote's paragraph** [section: 4 EXPERIMENTS]: Table 2 shows the results. The smaller ViT-L/16 model pre-trained on JFT-300M outperforms BiT-L (which is pre-trained on the same dataset) on all tasks, while requiring substantially less computational resources to train. The larger model, ViT-H/14, further improves the performance, especially on the more challenging datasets – ImageNet, CIFAR-100, and the VTAB suite. Interestingly, this

**The quote:** The smaller ViT-L/16 model pre-trained on JFT-300M outperforms BiT-L (which is pre-trained on the same dataset) on all tasks, while requiring substantially less computational resources to train.

**Cue A:** Compare compute cost between the two top-performing models here.

**Cue B:** Compare the smaller model's training cost against the bigger baseline it beats.

---

## Pair 75

**The paragraph before:** The Vision Transformer performs well when pre-trained on a large JFT-300M dataset. With fewer inductive biases for vision than ResNets, how crucial is the dataset size? We perform two series of experiments.

**The quote's paragraph** [section: 4 EXPERIMENTS]: First, we pre-train ViT models on datasets of increasing size: ImageNet, ImageNet-21k, and JFT-300M. To boost the performance on the smaller datasets, we optimize three basic regularization parameters – weight decay, dropout, and label smoothing. Figure 3 shows the results after fine-tuning to ImageNet (results on other datasets are shown in Table 5)². When pre-trained on the smallest dataset, ImageNet, ViT-Large models underperform compared to ViT-Base models, despite (moderate) regularization. With ImageNet-21k pre-training, their performances are similar. Only with JFT-300M, do we see the full benefit of larger models. Figure 3 also shows the performance region spanned by BiT models of different sizes. The BiT CNNs outperform ViT on ImageNet, but with the larger datasets, ViT overtakes.

**The quote:** When pre-trained on the smallest dataset, ImageNet, ViT-Large models underperform compared to ViT-Base models, despite (moderate) regularization. With ImageNet-21k pre-training, their performances are similar. Only with JFT-300M, do we see the full benefit of larger models.

**Cue A:** Notice how the ranking of model sizes shifts depending on which dataset pretrains them.

**Cue B:** Track how model size interacts with dataset size in these results.

---

## Pair 76

**The paragraph before:** After the projection, a learned position embedding is added to the patch representations. Figure 7 (center) shows that the model learns to encode distance within the image in the similarity of position embeddings, i.e. closer patches tend to have more similar position embeddings. Further, the row-column structure appears; patches in the same row/column have similar embeddings. Finally, a sinusoidal structure is sometimes apparent for larger grids (Appendix D). That the position embeddings learn to represent 2D image topology explains why hand-crafted 2D-aware embedding variants do not yield improvements (Appendix D.4).

**The quote's paragraph** [section: 4 EXPERIMENTS]: Self-attention allows ViT to integrate information across the entire image even in the lowest layers. We investigate to what degree the network makes use of this capability. Specifically, we compute the average distance in image space across which information is integrated, based on the attention weights (Figure 7, right). This “attention distance” is analogous to receptive field size in CNNs. We find that some heads attend to most of the image already in the lowest layers, showing that the ability to integrate information globally is indeed used by the model. Other attention heads have consistently small attention distances in the low layers. This highly localized attention is less pronounced in hybrid models that apply a ResNet before the Transformer (Figure 7, right), suggesting that it may serve a similar function as early convolutional layers in CNNs. Further, the attention distance increases with network depth. Globally, we find that the model attends to image regions that are semantically relevant for classification (Figure 6).

**The quote:** We find that some heads attend to most of the image already in the lowest layers, showing that the ability to integrate information globally is indeed used by the model.

**Cue A:** Look for how early in the network attention spans become wide.

**Cue B:** Look for how early in the network attention spans the whole image.

---

## Pair 77

**The paragraph before:** Figure 6: Representative examples of attention from the output token to the input space. See Appendix D.7 for details.

**The quote's paragraph** [section: 4 EXPERIMENTS]: Transformers show impressive performance on NLP tasks. However, much of their success stems not only from their excellent scalability but also from large scale self-supervised pre-training (Devlin et al., 2019; Radford et al., 2018). We also perform a preliminary exploration on masked patch prediction for self-supervision, mimicking the masked language modeling task used in BERT. With self-supervised pre-training, our smaller ViT-B/16 model achieves 79.9% accuracy on ImageNet, a significant improvement of 2% to training from scratch, but still 4% behind supervised pre-training. Appendix B.1.2 contains further details. We leave exploration of contrastive pre-training (Chen et al., 2020b; He et al., 2020; Bachman et al., 2019; Henaff et al., 2020) to future work.

**The quote:** With self-supervised pre-training, our smaller ViT-B/16 model achieves 79.9% accuracy on ImageNet, a significant improvement of 2% to training from scratch, but still 4% behind supervised pre-training.

**Cue A:** How close does self-supervised pre-training come to matching supervised results?

**Cue B:** Compare self-supervised results against training from scratch and against supervised pre-training.

---

## Pair 78

**The paragraph before:** Using this method, I discovered a few more topics that I had forgotten—among them the efficacy of various forms of psychotherapy. So I began to investigate through the library, and so on, and I have so much to tell you that I can’t do it at all. I will have to limit myself to just a few little things. I’ll concentrate on the things more people believe in. Maybe I will give a series of speeches next year on all these subjects. It will take a long time.

**The quote's paragraph** [section: Defining Cargo Cult Science]: I think the educational and psychological studies I mentioned are examples of what I would like to call Cargo Cult Science. In the South Seas there is a Cargo Cult of people. During the war they saw airplanes land with lots of good materials, and they want the same thing to happen now. So they’ve arranged to make things like runways, to put fires along the sides of the runways, to make a wooden hut for a man to sit in, with two wooden pieces on his head like headphones and bars of bamboo sticking out like antennas—he’s the controller—and they wait for the airplanes to land. They’re doing everything right. The form is perfect. It looks exactly the way it looked before. But it doesn’t work. No airplanes land. So I call these things Cargo Cult Science, because they follow all the apparent precepts and forms of scientific investigation, but they’re missing something essential, because the planes don’t land.

**The quote:** So I call these things Cargo Cult Science, because they follow all the apparent precepts and forms of scientific investigation, but they’re missing something essential, because the planes don’t land.

**Cue A:** Look for the one missing ingredient that makes the rituals of science actually work.

**Cue B:** Look for what the Cargo Cult planes metaphor says is missing from imitation science.

---

## Pair 79

**The paragraph before:** Now it behooves me, of course, to tell you what they’re missing. But it would he just about as difficult to explain to the South Sea Islanders how they have to arrange things so that they get some wealth in their system. It is not something simple like telling them how to improve the shapes of the earphones. But there is one feature I notice that is generally missing in Cargo Cult Science. That is the idea that we all hope you have learned in studying science in school—we never explicitly say what this is, but just hope that you catch on by all the examples of scientific investigation. It is interesting, therefore, to bring it out now and speak of it explicitly. It’s a kind of scientific integrity, a principle of scientific thought that corresponds to a kind of utter honesty—a kind of leaning over backwards. For example, if you’re doing an experiment, you should report everything that you think might make it invalid—not only what you think is right about it: other causes that could possibly explain your results; and things you thought of that you’ve eliminated by some other experiment, and how they worked—to make sure the other fellow can tell they have been eliminated.

**The quote's paragraph** [section: Defining Cargo Cult Science]: Details that could throw doubt on your interpretation must be given, if you know them. You must do the best you can—if you know anything at all wrong, or possibly wrong—to explain it. If you make a theory, for example, and advertise it, or put it out, then you must also put down all the facts that disagree with it, as well as those that agree with it. There is also a more subtle problem. When you have put a lot of ideas together to make an elaborate theory, you want to make sure, when explaining what it fits, that those things it fits are not just the things that gave you the idea for the theory; but that the finished theory makes something else come out right, in addition.

**The quote:** If you make a theory, for example, and advertise it, or put it out, then you must also put down all the facts that disagree with it, as well as those that agree with it.

**Cue A:** Ask what a theorist is obligated to report even when it hurts their own claim.

**Cue B:** Look for what a theory's advocate is asked to disclose even against their own case.

---

## Pair 80

**The paragraph before:** But this long history of learning how to not fool ourselves—of having utter scientific integrity—is, I’m sorry to say, something that we haven’t specifically included in any particular course that I know of. We just hope you’ve caught on by osmosis.

**The quote's paragraph** [section: Self-Deception in Experiments]: The first principle is that you must not fool yourself—and you are the easiest person to fool. So you have to be very careful about that. After you’ve not fooled yourself, it’s easy not to fool other scientists. You just have to be honest in a conventional way after that.

**The quote:** The first principle is that you must not fool yourself—and you are the easiest person to fool. So you have to be very careful about that. After you’ve not fooled yourself, it’s easy not to fool other scientists. You just have to be honest in a conventional way after that.

**Cue A:** Ask whose deception the author says comes first, before honesty toward others.

**Cue B:** Notice who the author says is hardest to deceive and why that comes first.

---

## Pair 81

**The paragraph before:** We have learned a lot from experience about how to handle some of the ways we fool ourselves. One example: Millikan measured the charge on an electron by an experiment with falling oil drops and got an answer which we now know not to be quite right. It’s a little bit off, because he had the incorrect value for the viscosity of air. It’s interesting to look at the history of measurements of the charge of the electron, after Millikan. If you plot them as a function of time, you find that one is a little bigger than Millikan’s, and the next one’s a little bit bigger than that, and the next one’s a little bit bigger than that, until finally they settle down to a number which is higher.

**The quote's paragraph** [section: Self-Deception in Experiments]: Why didn’t they discover that the new number was higher right away? It’s a thing that scientists are ashamed of—this history—because it’s apparent that people did things like this: When they got a number that was too high above Millikan’s, they thought something must be wrong—and they would look for and find a reason why something might be wrong. When they got a number closer to Millikan’s value they didn’t look so hard. And so they eliminated the numbers that were too far off, and did other things like that. We’ve learned those tricks nowadays, and now we don’t have that kind of a disease.

**The quote:** Why didn’t they discover that the new number was higher right away? It’s a thing that scientists are ashamed of—this history—because it’s apparent that people did things like this: When they got a number that was too high above Millikan’s, they thought something must be wrong—and they would look for and find a reason why something might be wrong. When they got a number closer to Millikan’s value they didn’t look so hard. And so they eliminated the numbers that were too far off, and did other things like that.

**Cue A:** Watch how the pattern of adjustments to a famous number reveals an unconscious bias.

**Cue B:** Watch how a running tally of measurements crept toward the true value - why so slowly?

---

## Pair 82

**The paragraph before:** For example, I was a little surprised when I was talking to a friend who was going to go on the radio. He does work on cosmology and astronomy, and he wondered how he would explain what the applications of this work were. “Well,” I said, “there aren’t any.” He said, “Yes, but then we won’t get support for more research of this kind.” I think that’s kind of dishonest. If you’re representing yourself as a scientist, then you should explain to the layman what you’re doing—and if they don’t want to support you under those circumstances, then that’s their decision.

**The quote's paragraph** [section: Self-Deception in Experiments]: One example of the principle is this: If you’ve made up your mind to test a theory, or you want to explain some idea, you should always decide to publish it whichever way it comes out. If we only publish results of a certain kind, we can make the argument look good. We must publish both kinds of result. For example—let’s take advertising again—suppose some particular cigarette has some particular property, like low nicotine. It’s published widely by the company that this means it is good for you—they don’t say, for instance, that the tars are a different proportion, or that something else is the matter with the cigarette. In other words, publication probability depends upon the answer. That should not be done.

**The quote:** In other words, publication probability depends upon the answer. That should not be done.

**Cue A:** Ask what it means for whether a result gets published to depend on what it shows.

**Cue B:** Consider what it means for whether a result gets published to depend on what it says.

---

## Pair 83

**The paragraph before:** One example of the principle is this: If you’ve made up your mind to test a theory, or you want to explain some idea, you should always decide to publish it whichever way it comes out. If we only publish results of a certain kind, we can make the argument look good. We must publish both kinds of result. For example—let’s take advertising again—suppose some particular cigarette has some particular property, like low nicotine. It’s published widely by the company that this means it is good for you—they don’t say, for instance, that the tars are a different proportion, or that something else is the matter with the cigarette. In other words, publication probability depends upon the answer. That should not be done.

**The quote's paragraph** [section: Self-Deception in Experiments]: I say that’s also important in giving certain types of government advice. Supposing a senator asked you for advice about whether drilling a hole should be done in his state; and you decide it would he better in some other state. If you don’t publish such a result, it seems to me you’re not giving scientific advice. You’re being used. If your answer happens to come out in the direction the government or the politicians like, they can use it as an argument in their favor; if it comes out the other way, they don’t publish it at all. That’s not giving scientific advice.

**The quote:** If your answer happens to come out in the direction the government or the politicians like, they can use it as an argument in their favor; if it comes out the other way, they don’t publish it at all. That’s not giving scientific advice.

**Cue A:** Notice how selective publishing by outcome undermines honest advice to policymakers.

**Cue B:** Notice what happens to an inconvenient finding when it reaches people in power.

---

## Pair 84

**The paragraph before:** He finally found that they could tell by the way the floor sounded when they ran over it. And he could only fix that by putting his corridor in sand. So he covered one after another of all possible clues and finally was able to fool the rats so that they had to learn to go in the third door. If he relaxed any of his conditions, the rats could tell.

**The quote's paragraph** [section: Case Studies in Poor Science]: Now, from a scientific standpoint, that is an A‑Number‑l experiment. That is the experiment that makes rat‑running experiments sensible, because it uncovers the clues that the rat is really using—not what you think it’s using. And that is the experiment that tells exactly what conditions you have to use in order to be careful and control everything in an experiment with rat‑running.

**The quote:** Now, from a scientific standpoint, that is an A‑Number‑l experiment. That is the experiment that makes rat‑running experiments sensible, because it uncovers the clues that the rat is really using—not what you think it’s using.

**Cue A:** Look for what made this rat experiment different from ordinary ones in its design.

**Cue B:** Look for what made this rat experiment different from the usual kind.

---

## Pair 85

**The paragraph before:** Now, from a scientific standpoint, that is an A‑Number‑l experiment. That is the experiment that makes rat‑running experiments sensible, because it uncovers the clues that the rat is really using—not what you think it’s using. And that is the experiment that tells exactly what conditions you have to use in order to be careful and control everything in an experiment with rat‑running.

**The quote's paragraph** [section: Case Studies in Poor Science]: I looked into the subsequent history of this research. The subsequent experiment, and the one after that, never referred to Mr. Young. They never used any of his criteria of putting the corridor on sand, or being very careful. They just went right on running rats in the same old way, and paid no attention to the great discoveries of Mr. Young, and his papers are not referred to, because he didn’t discover anything about the rats. In fact, he discovered all the things you have to do to discover something about rats. But not paying attention to experiments like that is a characteristic of Cargo Cult Science.

**The quote:** They just went right on running rats in the same old way, and paid no attention to the great discoveries of Mr. Young, and his papers are not referred to, because he didn’t discover anything about the rats. In fact, he discovered all the things you have to do to discover something about rats. But not paying attention to experiments like that is a characteristic of Cargo Cult Science.

**Cue A:** Ask why other researchers ignored a method that exposed a flaw in their own work.

**Cue B:** Notice why a careful experimenter's results were ignored by the field that followed.

---

## Pair 86

**The paragraph before:** I looked into the subsequent history of this research. The subsequent experiment, and the one after that, never referred to Mr. Young. They never used any of his criteria of putting the corridor on sand, or being very careful. They just went right on running rats in the same old way, and paid no attention to the great discoveries of Mr. Young, and his papers are not referred to, because he didn’t discover anything about the rats. In fact, he discovered all the things you have to do to discover something about rats. But not paying attention to experiments like that is a characteristic of Cargo Cult Science.

**The quote's paragraph** [section: Case Studies in Poor Science]: Another example is the ESP experiments of Mr. Rhine, and other people. As various people have made criticisms—and they themselves have made criticisms of their own experiments—they improve the techniques so that the effects are smaller, and smaller, and smaller until they gradually disappear. All the parapsychologists are looking for some experiment that can be repeated—that you can do again and get the same effect—statistically, even. They run a million rats—no, it’s people this time—they do a lot of things and get a certain statistical effect. Next time they try it they don’t get it any more. And now you find a man saying that it is an irrelevant demand to expect a repeatable experiment. This is science?

**The quote:** All the parapsychologists are looking for some experiment that can be repeated—that you can do again and get the same effect—statistically, even. They run a million rats—no, it’s people this time—they do a lot of things and get a certain statistical effect. Next time they try it they don’t get it any more. And now you find a man saying that it is an irrelevant demand to expect a repeatable experiment. This is science?

**Cue A:** Look for what happens to an effect when the same test is tried again.

**Cue B:** Notice what happens when an effect can't be made to happen again on demand.

---

## Pair 87

**The paragraph before:** Another example is the ESP experiments of Mr. Rhine, and other people. As various people have made criticisms—and they themselves have made criticisms of their own experiments—they improve the techniques so that the effects are smaller, and smaller, and smaller until they gradually disappear. All the parapsychologists are looking for some experiment that can be repeated—that you can do again and get the same effect—statistically, even. They run a million rats—no, it’s people this time—they do a lot of things and get a certain statistical effect. Next time they try it they don’t get it any more. And now you find a man saying that it is an irrelevant demand to expect a repeatable experiment. This is science?

**The quote's paragraph** [section: Case Studies in Poor Science]: This man also speaks about a new institution, in a talk in which he was resigning as Director of the Institute of Parapsychology. And, in telling people what to do next, he says that one of the things they have to do is be sure they only train students who have shown their ability to get PSI results to an acceptable extent—not to waste their time on those ambitious and interested students who get only chance results. It is very dangerous to have such a policy in teaching—to teach students only how to get certain results, rather than how to do an experiment with scientific integrity.

**The quote:** It is very dangerous to have such a policy in teaching—to teach students only how to get certain results, rather than how to do an experiment with scientific integrity.

**Cue A:** Look for the danger in teaching students to get a result rather than to test honestly.

**Cue B:** Consider the danger of teaching students to get a result rather than to run a fair test.

---

## Pair 88

**The paragraph before:** This man also speaks about a new institution, in a talk in which he was resigning as Director of the Institute of Parapsychology. And, in telling people what to do next, he says that one of the things they have to do is be sure they only train students who have shown their ability to get PSI results to an acceptable extent—not to waste their time on those ambitious and interested students who get only chance results. It is very dangerous to have such a policy in teaching—to teach students only how to get certain results, rather than how to do an experiment with scientific integrity.

**The quote's paragraph** [section: Case Studies in Poor Science]: So I wish to you—I have no more time, so I have just one wish for you—the good luck to be somewhere where you are free to maintain the kind of integrity I have described, and where you do not feel forced by a need to maintain your position in the organization, or financial support, or so on, to lose your integrity. May you have that freedom. May I also give you one last bit of advice: Never say that you’ll give a talk unless you know clearly what you’re going to talk about and more or less what you’re going to say.

**The quote:** So I wish to you—I have no more time, so I have just one wish for you—the good luck to be somewhere where you are free to maintain the kind of integrity I have described, and where you do not feel forced by a need to maintain your position in the organization, or financial support, or so on, to lose your integrity.

**Cue A:** Notice what conditions the speaker says are needed to keep one's integrity intact.

**Cue B:** Notice what pressures the author names as threats to keeping one's integrity.

---
