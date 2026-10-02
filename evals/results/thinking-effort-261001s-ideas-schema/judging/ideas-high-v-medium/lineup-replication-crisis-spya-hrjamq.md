# 4 candidates for "Replication crisis"

Each candidate is the ideas a reader needs in order to get this article, each tied to the passages that carry it. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-replication-crisis-spya-hrjamq.md` beside this file.

## Candidate W

```json
[
  {
    "id": "spya-jgp68y",
    "name": "Science can be studied scientifically",
    "provenance": "assumed",
    "statement": "The research process itself—how studies are designed, published, cited, and corrected—can be treated as an object of empirical investigation, measured and improved the same way any other phenomenon is studied.",
    "whyYouNeedIt": "The article's entire apparatus of 'metascience,' survey data on researcher behavior, and large coordinated replication projects only makes sense if one accepts that science's own practices are a legitimate, measurable subject of scientific inquiry rather than something outside empirical reach.",
    "occurrences": [
      {
        "blockId": "spya-umxmuu",
        "quote": "a new scientific discipline known as metascience,[7] which uses methods of empirical research to examine empirical research practice",
        "reasoning": "This line only lands as sensible to a reader who already grants that research practice can itself be an empirical object of study.",
        "start": 169,
        "blockText": "The phrase \"replication crisis\" was coined in the early 2010s as part of a growing awareness of the problem.[6] Considerations of causes and remedies have given rise to a new scientific discipline known as metascience,[7] which uses methods of empirical research to examine empirical research practice.[7]"
      },
      {
        "blockId": "spya-q8mbr9",
        "quote": "Meta-research continues to be conducted to identify the roots of the crisis and to address them.",
        "reasoning": "Presupposes without arguing that the causes of a scientific crisis can themselves be found by doing more science on science.",
        "start": 0,
        "blockText": "Meta-research continues to be conducted to identify the roots of the crisis and to address them. Methods of addressing the crisis include pre-registration of scientific studies and clinical trials as well as the founding of organizations such as CONSORT and the EQUATOR Network that issue guidelines for methodology and reporting. Efforts continue to reform the system of academic incentives, improve the peer review process, reduce the misuse of statistics, combat bias in scientific literature, and increase the overall quality and efficiency of the scientific process."
      },
      {
        "blockId": "spya-na9ke6",
        "quote": "Metascience is the use of scientific methodology to study science itself.",
        "reasoning": "States the practice as a going concern, assuming the reader already accepts that this reflexive application of method is coherent and productive.",
        "start": 0,
        "blockText": "Metascience is the use of scientific methodology to study science itself. It seeks to increase the quality of scientific research while reducing waste. It is also known as \"research on research\" and \"the science of science\", as it uses research methods to study how research is done and where improvements can be made. Metascience is concerned with all fields of research and has been called \"a bird's eye view of science.\"[217] In Ioannidis's words, \"Science is the best thing that has happened to human beings ... but we can do it better.\"[218]"
      }
    ]
  },
  {
    "id": "spya-h237pk",
    "name": "Selection for significance inflates reported effect sizes",
    "provenance": "introduced",
    "statement": "Because only studies that cross a significance threshold tend to get published, the effect sizes that make it into print are systematically larger than the true effect, so replications with adequate power routinely find smaller effects than the original.",
    "occurrences": [
      {
        "blockId": "spya-hw9d4p",
        "quote": "when the dataset is small, noise tends to cause the regression factor to be overestimated",
        "reasoning": "Gives the statistical mechanism (small-sample noise plus selection) that produces inflated published estimates.",
        "start": 173,
        "blockText": "In studies that statistically estimate a regression factor, such as the in , when the dataset is large, noise tends to cause the regression factor to be underestimated, but when the dataset is small, noise tends to cause the regression factor to be overestimated.[180]"
      },
      {
        "blockId": "spya-bha57y",
        "quote": "36% replicated successfully (p value below 0.05), with effect sizes averaging half the original magnitude",
        "reasoning": "Shows the real-world consequence: even successful replications shrink the reported effect substantially.",
        "start": 476,
        "blockText": "In August 2015, the first open empirical study of reproducibility in psychology was published, called The Reproducibility Project: Psychology. Coordinated by psychologist Brian Nosek, researchers redid 100 studies in psychological science from three high-ranking psychology journals (Journal of Personality and Social Psychology, Journal of Experimental Psychology: Learning, Memory, and Cognition, and Psychological Science). Of 97 original studies with significant effects, 36% replicated successfully (p value below 0.05), with effect sizes averaging half the original magnitude.[11] Among non-replications, 25% directly contradicted the original while 49% were inconclusive due to underpowered designs. The same paper examined the reproducibility rates and effect sizes by journal and discipline. Study replication rates were 23% for the Journal of Personality and Social Psychology, 48% for Journal of Experimental Psychology: Learning, Memory, and Cognition, and 38% for Psychological Science. Studies in the field of cognitive psychology had a higher replication rate (50%) than studies in the field of social psychology (25%).[77] This inconclusiveness reflected inadequate statistical power: replication samples were approximately 40% the size of the originals.[78]"
      }
    ]
  },
  {
    "id": "spya-pet7rw",
    "name": "Individual incentives diverge from science's collective goal",
    "provenance": "introduced",
    "statement": "Career rewards for individual researchers (publishing often, getting cited, landing grants) are not the same thing as the collective goal of accumulating true knowledge, so a population of rational, self-interested scientists can still produce a literature dominated by unreliable findings.",
    "occurrences": [
      {
        "blockId": "spya-huxt52",
        "quote": "the goals and values of single scientists (e.g., publishability) are not aligned with the general goals of science (e.g., pursuing scientific truth)",
        "reasoning": "States the incentive-misalignment claim explicitly as the mechanism behind degraded validity.",
        "start": 133,
        "blockText": "According to Center for Open Science founder Brian Nosek and his colleagues, \"publish or perish\" culture created a situation whereby the goals and values of single scientists (e.g., publishability) are not aligned with the general goals of science (e.g., pursuing scientific truth). This is detrimental to the validity of published findings.[133]"
      },
      {
        "blockId": "spya-ftd2ng",
        "quote": "the population of labs converge to maximum productivity even at the price of very high false positive rates",
        "reasoning": "Models formally how selection on career success, not truth, can drive an entire field toward high false-positive output.",
        "start": 736,
        "blockText": "Smaldino and McElreath[60] proposed a simple model for the cultural evolution of scientific practice. Each lab randomly decides to produce novel research or replication research, at different fixed levels of false positive rate, true positive rate, replication rate, and productivity (its \"traits\"). A lab might use more \"effort\", making the ROC curve more convex but decreasing productivity. A lab accumulates a score over its lifetime that increases with publications and decreases when another lab fails to replicate its results. At regular intervals, a random lab \"dies\" and another \"reproduces\" a child lab with a similar trait as its parent. Labs with higher scores are more likely to reproduce. Under certain parameter settings, the population of labs converge to maximum productivity even at the price of very high false positive rates."
      }
    ]
  },
  {
    "id": "spya-hphgdt",
    "name": "Power mathematically caps replication probability",
    "provenance": "introduced",
    "statement": "The chance that a second study will successfully reproduce a first study's significant finding is bounded by the statistical power of the test, regardless of how the original study was conducted or whether the hypothesis is true.",
    "occurrences": [
      {
        "blockId": "spya-x7d5t5",
        "quote": "Thus, low power implies low probability of replication, regardless of how the previous publication was designed, and regardless of which hypothesis is really true.",
        "reasoning": "Directly asserts the mathematical link between power and replication probability.",
        "start": 174,
        "blockText": "Mathematically, the probability of replicating a previous publication that rejected a null hypothesis in favor of an alternative is assuming significance is less than power. Thus, low power implies low probability of replication, regardless of how the previous publication was designed, and regardless of which hypothesis is really true.[78]"
      },
      {
        "blockId": "spya-zvfgme",
        "quote": "the median of studies with adequate statistical power was between 7.7% and 9.1%, implying that a positive result would replicate with probability less than 10%",
        "reasoning": "Applies the power-replication link to real meta-analytic data to explain why psychology replicates poorly.",
        "start": 362,
        "blockText": "Stanley and colleagues estimated the average statistical power of psychological literature by analyzing data from 200 meta-analyses. They found that on average, psychology studies have between 33.1% and 36.4% statistical power. These values are quite low compared to the 80% considered adequate statistical power for an experiment. Across the 200 meta-analyses, the median of studies with adequate statistical power was between 7.7% and 9.1%, implying that a positive result would replicate with probability less than 10%, regardless of whether the positive result was a true positive or a false positive.[14]"
      },
      {
        "blockId": "spya-fgq7vr",
        "quote": "A statistical study with 1000 cases and 1000 controls has 0.03% power for a gene with GRR = 1.15",
        "reasoning": "Shows a concrete case where tiny power essentially guarantees replication failure even for a real effect.",
        "start": 673,
        "blockText": "The same statistical test with the same significance level will have lower statistical power if the effect size is small under the alternative hypothesis. Complex inheritable traits are typically correlated with a large number of genes, each of small effect size, so high power requires a large sample size. In particular, many results from the candidate gene literature suffered from small effect sizes and small sample sizes and would not replicate. More data from genome-wide association studies (GWAS) come close to solving this problem.[176][177] As a numeric example, most genes associated with schizophrenia risk have low effect size (genotypic relative risk, GRR). A statistical study with 1000 cases and 1000 controls has 0.03% power for a gene with GRR = 1.15, which is already large for schizophrenia. In contrast, the largest GWAS to date has ~100% power for it.[178]"
      }
    ]
  },
  {
    "id": "spya-dhfzxe",
    "name": "Flexible analysis choices inflate false positives unintentionally",
    "provenance": "introduced",
    "statement": "When researchers have many defensible choices about how to collect, exclude, and analyze data, trying several and reporting only the ones that reach significance can push the true false-positive rate far above the nominal 5%, even without any deliberate cheating.",
    "occurrences": [
      {
        "blockId": "spya-qsad7n",
        "quote": "moderately flexible data analysis, routine in research, can increase the false-positive rate to above 60%",
        "reasoning": "States the core quantitative claim that ordinary flexibility, not fraud, can massively inflate false positives.",
        "start": 128,
        "blockText": "Various statistical methods can be applied to make the p-value appear smaller than it really is. This need not be malicious, as moderately flexible data analysis, routine in research, can increase the false-positive rate to above 60%.[40]"
      },
      {
        "blockId": "spya-umu7gf",
        "quote": "These choices in the \"garden of forking paths\" multiply, creating many \"researcher degrees of freedom\"",
        "reasoning": "Names the mechanism (many small decision points) that produces the inflation described above.",
        "start": 209,
        "blockText": "Typically, a statistical study has multiple steps, with several choices at each step, such as during data collection, outlier rejection, choice of test statistic, choice of one-tailed or two-tailed test, etc. These choices in the \"garden of forking paths\" multiply, creating many \"researcher degrees of freedom\". The effect is similar to the file-drawer problem, as the paths not taken are not published.[181]"
      },
      {
        "blockId": "spya-dz88bh",
        "quote": "If the data collection or analysis were to stop at a point where the p-value happened to fall below the significance level, a spurious statistically significant difference could be reported",
        "reasoning": "Illustrates with optional stopping how an honest-seeming procedure generates spurious significance.",
        "start": 468,
        "blockText": "The figure shows the change in p-values computed from a t-test as the sample size increases, and how early stopping can allow for p-hacking even when the null hypothesis is exactly true. Data is drawn from two identical normal distributions, . For each sample size , ranging from 5 to , a t-test is performed on the first samples from each distribution, and the resulting p-value is plotted. The red dashed line indicates the commonly used significance level of 0.05. If the data collection or analysis were to stop at a point where the p-value happened to fall below the significance level, a spurious statistically significant difference could be reported."
      }
    ]
  },
  {
    "id": "spya-jth6am",
    "name": "True effects can vary by hidden context (heterogeneity)",
    "provenance": "introduced",
    "statement": "Many findings fail to replicate not because the original result was a fluke but because the underlying effect genuinely differs across populations, settings, or unnoticed 'hidden moderators,' so there is no single fixed effect size to recover.",
    "occurrences": [
      {
        "blockId": "spya-qn347b",
        "quote": "failures to replicate might be explained by contextual differences between the original experiment and the replication, often called \"hidden moderators\"",
        "reasoning": "Generalizes the heterogeneity idea to context sensitivity as a cause of non-replication.",
        "start": 201,
        "blockText": "New York University professor Jay Van Bavel and colleagues argue that a further reason findings are difficult to replicate is the sensitivity to context of certain psychological effects. On this view, failures to replicate might be explained by contextual differences between the original experiment and the replication, often called \"hidden moderators\".[192] Van Bavel and colleagues tested the influence of context sensitivity by reanalyzing the data of the widely cited Reproducibility Project carried out by the Open Science Collaboration.[11] They re-coded effects according to their sensitivity to contextual factors and then tested the relationship between context sensitivity and replication success in various regression models."
      }
    ]
  },
  {
    "id": "spya-pchp6g",
    "name": "Posterior truth differs from p-value significance",
    "provenance": "introduced",
    "statement": "Rejecting a null hypothesis at the 5% significance level does not mean there is a 95% chance the alternative hypothesis is true; the actual probability that the finding is real depends on how plausible the hypothesis was before the test (its prior probability), via Bayes' theorem.",
    "occurrences": [
      {
        "blockId": "spya-fhcf00",
        "quote": "rejecting the null hypothesis at significance level 5% does not mean that the posterior probability for the alternative hypothesis is 95%",
        "reasoning": "States directly that significance level and posterior truth probability are different quantities.",
        "start": 61,
        "blockText": "In the framework of Bayesian probability, by Bayes' theorem, rejecting the null hypothesis at significance level 5% does not mean that the posterior probability for the alternative hypothesis is 95%, and the posterior probability is also different from the probability of replication.[193][185] Consider a simplified case where there are only two hypotheses. Let the prior probability of the null hypothesis be , and the alternative . For a given statistical study, let its false positive rate (significance level) be , and true positive rate (power) be . For illustrative purposes, let significance level be 0.05 and power be 0.45 (underpowered)."
      },
      {
        "blockId": "spya-esjk29",
        "quote": "if the prior probability of the null hypothesis is , and the study found a positive result, then the posterior probability for is",
        "reasoning": "Works a concrete numeric example showing how a low prior keeps the posterior probability of a true effect low even after a 'significant' result.",
        "start": 13,
        "blockText": "For example, if the prior probability of the null hypothesis is , and the study found a positive result, then the posterior probability for is , and the replication probability is ."
      }
    ]
  },
  {
    "id": "spya-az0tk5",
    "name": "Low prior truth-rate explains high false-positive share",
    "provenance": "introduced",
    "statement": "If most of the hypotheses being tested in a field are false to begin with, then even a technically correct testing procedure with standard error rates will produce a literature in which a large share of 'significant' results are actually false positives.",
    "occurrences": [
      {
        "blockId": "spya-dzsa7e",
        "quote": "a possible reason for the low rates of replicability in certain scientific fields is that a majority of tested hypotheses are false a priori",
        "reasoning": "States the base-rate argument explaining low replicability independent of any methodological flaw.",
        "start": 41,
        "blockText": "According to philosopher Alexander Bird, a possible reason for the low rates of replicability in certain scientific fields is that a majority of tested hypotheses are false a priori.[202] On this view, low rates of replicability could be consistent with quality science. Relatedly, the expectation that most findings should replicate would be misguided and, according to Bird, a form of base rate fallacy. Bird's argument works as follows. Assuming an ideal situation of a test of significance, whereby the probability of incorrectly rejecting the null hypothesis is 5% (i.e. Type I error) and the probability of correctly rejecting the null hypothesis is 80% (i.e. Power), in a context where a high proportion of tested hypotheses are false, it is conceivable that the number of false positives would be high compared to those of true positives.[202] For example, in a situation where only 10% of tested hypotheses are actually true, one can calculate that as many as 36% of results will be false positives.[j]"
      },
      {
        "blockId": "spya-p6eutd",
        "quote": "the claim that a majority of tested hypotheses are false a priori in certain scientific fields might be plausible given factors such as the complexity of the phenomena under investigation",
        "reasoning": "Extends the base-rate explanation to specific fields, linking it to features like inferential distance and ease of hypothesis generation.",
        "start": 16,
        "blockText": "Bird notes that the claim that a majority of tested hypotheses are false a priori in certain scientific fields might be plausible given factors such as the complexity of the phenomena under investigation, the fact that theories are seldom undisputed, the \"inferential distance\" between theories and hypotheses, and the ease with which hypotheses can be generated. In this respect, the fields Bird takes as examples are clinical medicine, genetic and molecular epidemiology, and social psychology. This situation is radically different in fields where theories have outstanding empirical basis and hypotheses can be easily derived from theories (e.g., experimental physics).[202]"
      }
    ]
  },
  {
    "id": "spya-b0adgx",
    "name": "Triangulation beats single-method replication",
    "provenance": "introduced",
    "statement": "Confidence in a finding should come from agreement across methods that have different, unrelated weaknesses, not merely from repeating the same method again, because repeating a flawed method only reproduces its flaw.",
    "occurrences": [
      {
        "blockId": "spya-w073xf",
        "quote": "replication alone will get us only so far (and) might actually make matters worse ... [Triangulation] is the strategic use of multiple approaches to address one question",
        "reasoning": "States directly that converging independent methods, not repeated identical ones, is the stronger form of evidence.",
        "start": 0,
        "blockText": "replication alone will get us only so far (and) might actually make matters worse ... [Triangulation] is the strategic use of multiple approaches to address one question. Each approach has its own unrelated assumptions, strengths and weaknesses. Results that agree across different methodologies are less likely to be artefacts. ... Maybe one reason replication has captured so much interest is the often-repeated idea that falsification is at the heart of the scientific enterprise. This idea was popularized by Karl Popper's 1950s maxim that theories can never be proved, only falsified. Yet an overemphasis on repeating experiments could provide an unfounded sense of certainty about findings that rely on a single approach. ... philosophers of science have moved on since Popper. Better descriptions of how scientists actually work include what epistemologist Peter Lipton called in 1991 \"inference to the best explanation\".[259]"
      },
      {
        "blockId": "spya-w073xf",
        "quote": "Results that agree across different methodologies are less likely to be artefacts.",
        "reasoning": "Gives the reasoning for why cross-method agreement is more diagnostic than same-method repetition.",
        "start": 246,
        "blockText": "replication alone will get us only so far (and) might actually make matters worse ... [Triangulation] is the strategic use of multiple approaches to address one question. Each approach has its own unrelated assumptions, strengths and weaknesses. Results that agree across different methodologies are less likely to be artefacts. ... Maybe one reason replication has captured so much interest is the often-repeated idea that falsification is at the heart of the scientific enterprise. This idea was popularized by Karl Popper's 1950s maxim that theories can never be proved, only falsified. Yet an overemphasis on repeating experiments could provide an unfounded sense of certainty about findings that rely on a single approach. ... philosophers of science have moved on since Popper. Better descriptions of how scientists actually work include what epistemologist Peter Lipton called in 1991 \"inference to the best explanation\".[259]"
      }
    ]
  }
]
```

## Candidate X

```json
[
  {
    "id": "spya-dyg79z",
    "name": "Science's replication machinery presumes one fixed true effect",
    "provenance": "assumed",
    "statement": "Power calculations, meta-analyses, and direct replications are built on the idea that a given hypothesis corresponds to one stable, context-independent effect size that every properly run study is estimating.",
    "whyYouNeedIt": "Without this assumption, concepts like 'statistical power to detect the effect' or 'pooling studies to estimate the effect' would not make sense — yet the article treats power, effect-size estimation, and meta-analysis this way until heterogeneity findings quietly undercut it.",
    "occurrences": [
      {
        "blockId": "spya-cxbx9m",
        "quote": "the full null hypothesis is often reduced to a simplified null hypothesis \"the effect size is 0\", where \"effect size\" is a real number that is 0 if the full null hypothesis is true",
        "reasoning": "Treats effect size as a single real number attached to the hypothesis, which only works if that number is fixed rather than context-dependent.",
        "start": 59,
        "blockText": "As testing for full statistical independence is difficult, the full null hypothesis is often reduced to a simplified null hypothesis \"the effect size is 0\", where \"effect size\" is a real number that is 0 if the full null hypothesis is true, and the larger the effect size is, the more the null hypothesis is false.[23] For example, if X is binary, then the effect size might be defined as the change in the expectation of Y upon a change of X:Note that the effect size as defined above might be zero even if X and Y are not independent, such as when their relationship is non-linear (such as ) or when one variable affects different subgroups oppositely. Since different definitions of \"effect size\" capture different ways for X and Y to be dependent, there are many definitions of effect size."
      },
      {
        "blockId": "spya-c08svn",
        "quote": "In practice, effect sizes cannot be directly observed, but must be measured by statistical estimators.",
        "reasoning": "Speaks of 'the' effect size as something estimators approximate, presupposing a single quantity exists to be approximated.",
        "start": 0,
        "blockText": "In practice, effect sizes cannot be directly observed, but must be measured by statistical estimators. For example, the above definition of effect size is often measured by Cohen's d estimator. The same effect size might have multiple estimators, as they have tradeoffs between efficiency, bias, variance, etc. This further increases the number of possible statistical quantities that can be computed on a single dataset. When an estimator for an effect size is used for statistical testing, it is called a test statistic."
      },
      {
        "blockId": "spya-x02d6v",
        "quote": "If considered along sampling error, heterogeneity yields a standard deviation from one study to the next even larger than the median effect size of the 200 meta-analyses they investigated.",
        "reasoning": "This finding only reads as a problem for replication if the reader had been assuming, up to this point, that there was one effect size each study should converge on.",
        "start": 328,
        "blockText": "In their analysis of 200 meta-analyses of psychological effects, Stanley and colleagues found a median percent of heterogeneity of I-squared = 74%. According to the authors, this level of heterogeneity can be considered \"huge\". It is three times larger than the random sampling variance of effect sizes measured in their study. If considered along sampling error, heterogeneity yields a standard deviation from one study to the next even larger than the median effect size of the 200 meta-analyses they investigated.[g] The authors conclude that if replication is defined by a subsequent study finding a sufficiently similar effect size to the original, replication success is not likely even if replications have very large sample sizes. Importantly, this occurs even if replications are direct or exact since heterogeneity nonetheless remains relatively high in these cases."
      }
    ]
  },
  {
    "id": "spya-ab70uj",
    "name": "Citation counts are assumed to track a finding's merit",
    "provenance": "assumed",
    "statement": "How often a paper gets cited is treated as a rough signal of how sound or important its findings are, which is why it registers as troubling when heavily cited findings turn out not to replicate.",
    "whyYouNeedIt": "The reported pattern — that non-replicable papers get cited more, even after being debunked — only reads as a problem, rather than a neutral fact, if citations are expected to track validity in the first place.",
    "occurrences": [
      {
        "blockId": "spya-m3et6t",
        "quote": "papers that cannot be replicated are more likely to be cited.",
        "reasoning": "Presents this correlation as a notable finding, which presumes citations should otherwise track replicability/validity.",
        "start": 77,
        "blockText": "In 2021, a study conducted by University of California, San Diego found that papers that cannot be replicated are more likely to be cited.[110] Nonreplicable publications are often cited more even after a replication study is published.[111]"
      }
    ]
  },
  {
    "id": "spya-bkra79",
    "name": "Low power mathematically caps replication odds",
    "provenance": "introduced",
    "statement": "If an original study's statistical power (its chance of detecting a real effect) is low, then even a true effect will often fail to turn up again in a repeat study — the replication rate is bounded by the power, no matter how the original study was designed or whether the hypothesis is actually true.",
    "analogy": "It is like a smoke detector set too low to trigger reliably: testing it again and again on a real fire will often fail to set it off, not because the fire went out but because the detector itself is weak.",
    "occurrences": [
      {
        "blockId": "spya-x7d5t5",
        "quote": "the probability of replicating a previous publication that rejected a null hypothesis in favor of an alternative is assuming significance is less than power. Thus, low power implies low probability of replication, regardless of how the previous publication was designed, and regardless of which hypothesis is really true.",
        "reasoning": "States the mechanical link between low power and low replication probability as a near-mathematical certainty.",
        "start": 16,
        "blockText": "Mathematically, the probability of replicating a previous publication that rejected a null hypothesis in favor of an alternative is assuming significance is less than power. Thus, low power implies low probability of replication, regardless of how the previous publication was designed, and regardless of which hypothesis is really true.[78]"
      },
      {
        "blockId": "spya-zvfgme",
        "quote": "implying that a positive result would replicate with probability less than 10%, regardless of whether the positive result was a true positive or a false positive.",
        "reasoning": "Applies the power-replication link to real psychology data to explain the field's poor replication rates.",
        "start": 443,
        "blockText": "Stanley and colleagues estimated the average statistical power of psychological literature by analyzing data from 200 meta-analyses. They found that on average, psychology studies have between 33.1% and 36.4% statistical power. These values are quite low compared to the 80% considered adequate statistical power for an experiment. Across the 200 meta-analyses, the median of studies with adequate statistical power was between 7.7% and 9.1%, implying that a positive result would replicate with probability less than 10%, regardless of whether the positive result was a true positive or a false positive.[14]"
      },
      {
        "blockId": "spya-hdubm3",
        "quote": "Low statistical power hinders replication for three reasons: (1) low-power replications have reduced ability to detect true effects, (2) low-power original studies produce biased effect size estimates leading to undersized replications, and (3) low-power original studies yield results unlikely to reflect true effects.",
        "reasoning": "Lays out the causal chain from low power to replication failure that the rest of the section depends on.",
        "start": 0,
        "blockText": "Low statistical power hinders replication for three reasons: (1) low-power replications have reduced ability to detect true effects, (2) low-power original studies produce biased effect size estimates leading to undersized replications, and (3) low-power original studies yield results unlikely to reflect true effects.[14]"
      },
      {
        "blockId": "spya-h7qg2e",
        "quote": "most psychological studies have low power (true positive rate), but low power persisted for 50 years, indicating a structural and persistent problem in psychological research.",
        "reasoning": "Treats chronic low power itself as the structural explanation for persistent replication trouble, relying on the power-replication link.",
        "start": 55,
        "blockText": "It had been repeatedly pointed out since 1962[55] that most psychological studies have low power (true positive rate), but low power persisted for 50 years, indicating a structural and persistent problem in psychological research.[59][60]"
      }
    ]
  },
  {
    "id": "spya-wvf3f8",
    "name": "Published effect sizes are inflated estimates (winner's curse)",
    "provenance": "introduced",
    "statement": "Because only the largest, most eye-catching results from small or noisy studies tend to clear the bar for publication, the effect sizes that make it into print are systematically bigger than the true effect, so later, better-powered studies routinely find something smaller.",
    "analogy": "It is like judging a bidding war only by the winning bid: the winner is, by definition, the most optimistic bidder, so the price that gets recorded overstates what the item is really worth.",
    "occurrences": [
      {
        "blockId": "spya-r42sms",
        "quote": "Even when the study replicates, the replication typically has a smaller effect size. Underpowered[clarification needed] studies have a large effect size bias.",
        "reasoning": "States the shrinkage pattern as a general statistical phenomenon, not a one-off anomaly.",
        "start": 0,
        "blockText": "Even when the study replicates, the replication typically has a smaller effect size. Underpowered[clarification needed] studies have a large effect size bias.[179]"
      },
      {
        "blockId": "spya-hw9d4p",
        "quote": "when the dataset is small, noise tends to cause the regression factor to be overestimated",
        "reasoning": "Gives the statistical mechanism (small-sample noise) underlying the inflation of published estimates.",
        "start": 173,
        "blockText": "In studies that statistically estimate a regression factor, such as the in , when the dataset is large, noise tends to cause the regression factor to be underestimated, but when the dataset is small, noise tends to cause the regression factor to be overestimated.[180]"
      },
      {
        "blockId": "spya-bha57y",
        "quote": "36% replicated successfully (p value below 0.05), with effect sizes averaging half the original magnitude",
        "reasoning": "Reports the empirical shrinkage that only makes sense as an instance of this general inflation phenomenon.",
        "start": 476,
        "blockText": "In August 2015, the first open empirical study of reproducibility in psychology was published, called The Reproducibility Project: Psychology. Coordinated by psychologist Brian Nosek, researchers redid 100 studies in psychological science from three high-ranking psychology journals (Journal of Personality and Social Psychology, Journal of Experimental Psychology: Learning, Memory, and Cognition, and Psychological Science). Of 97 original studies with significant effects, 36% replicated successfully (p value below 0.05), with effect sizes averaging half the original magnitude.[11] Among non-replications, 25% directly contradicted the original while 49% were inconclusive due to underpowered designs. The same paper examined the reproducibility rates and effect sizes by journal and discipline. Study replication rates were 23% for the Journal of Personality and Social Psychology, 48% for Journal of Experimental Psychology: Learning, Memory, and Cognition, and 38% for Psychological Science. Studies in the field of cognitive psychology had a higher replication rate (50%) than studies in the field of social psychology (25%).[77] This inconclusiveness reflected inadequate statistical power: replication samples were approximately 40% the size of the originals.[78]"
      },
      {
        "blockId": "spya-k59a2x",
        "quote": "the effect sizes were 85% smaller on average than the original findings",
        "reasoning": "Another concrete instance of the same inflation-then-shrinkage pattern, this time in cancer biology.",
        "start": 477,
        "blockText": "In a 2012 paper, C. Glenn Begley, a biotech consultant working at Amgen, and Lee Ellis, a medical researcher at the University of Texas, found that only 11% of 53 pre-clinical cancer studies had replications that could confirm conclusions from the original studies.[37] In late 2021, The Reproducibility Project: Cancer Biology examined 53 top papers about cancer published between 2010 and 2012 and showed that among studies that provided sufficient information to be redone, the effect sizes were 85% smaller on average than the original findings.[88][89] A survey of cancer researchers found that half of them had been unable to reproduce a published result.[90] Another report estimated that almost half of randomized controlled trials contained flawed data (based on the analysis of anonymized individual participant data (IPD) from more than 150 trials).[91]"
      }
    ]
  },
  {
    "id": "spya-cptvmh",
    "name": "Publication bias inflates false positives in the literature",
    "provenance": "introduced",
    "statement": "Journals' preference for positive, significant findings means negative or null results are disproportionately left unpublished, so the published record is a skewed, over-positive sample of all the research actually conducted.",
    "occurrences": [
      {
        "blockId": "spya-y782zn",
        "quote": "Publication bias—the tendency to publish only positive, significant results—creates the \"file drawer effect\", where negative results remain unpublished.[a] This produces misleading literature and biased meta-analyses.",
        "reasoning": "States directly that selective publication distorts the overall body of literature.",
        "start": 0,
        "blockText": "Publication bias—the tendency to publish only positive, significant results—creates the \"file drawer effect\", where negative results remain unpublished.[a] This produces misleading literature and biased meta-analyses.[26] Only a very small proportion of academic journals in psychology and neurosciences explicitly welcomed submissions of replication studies in their aim and scope or instructions to authors.[123][124] This does not encourage reporting on, or even attempts to perform, replication studies. Among 1,576 researchers Nature surveyed in 2016, only a minority had ever attempted to publish a replication, and several respondents who had published failed replications noted that editors and reviewers demanded that they play down comparisons with the original studies.[5][106] An analysis of 4,270 empirical studies in 18 business journals from 1970 to 1991 reported that less than 10% of accounting, economics, and finance articles and 5% of management and marketing articles were replication studies.[93][125] Publication bias is augmented by the pressure to publish and the author's own confirmation bias,[b] and is an inherent hazard in the field, requiring a certain degree of skepticism on the part of readers.[40]"
      },
      {
        "blockId": "spya-f76az5",
        "quote": "When publication bias is considered along with the fact that a majority of tested hypotheses might be false a priori, it is plausible that a considerable proportion of research findings might be false positives",
        "reasoning": "Connects publication bias to the buildup of false positives that later fail to replicate.",
        "start": 0,
        "blockText": "When publication bias is considered along with the fact that a majority of tested hypotheses might be false a priori, it is plausible that a considerable proportion of research findings might be false positives, as shown by metascientist John Ioannidis.[1] In turn, a high proportion of false positives in the published literature can explain why many findings are nonreproducible.[26]"
      },
      {
        "blockId": "spya-asmt0d",
        "quote": "the desire to make research accessible to the public led to oversimplification and exaggeration of findings, creating unrealistic expectations and amplifying the impact of non-replications",
        "reasoning": "Extends the publication-bias idea to popular science coverage, showing the same selective-positivity mechanism at a different stage.",
        "start": 64,
        "blockText": "In popular media, there is another element of publication bias: the desire to make research accessible to the public led to oversimplification and exaggeration of findings, creating unrealistic expectations and amplifying the impact of non-replications. In contrast, null results and failures to replicate tend to go unreported. This explanation may apply to power posing's replication crisis.[128]"
      },
      {
        "blockId": "spya-q6s08t",
        "quote": "Rosenthal's point is that certain effect sizes are large enough, such that even if there is a total publication bias against null results (the \"file drawer problem\"), the number of unpublished null results would be impossibly large to swamp out the effect size.",
        "reasoning": "A proposed statistical remedy only makes sense against the backdrop of unpublished null results systematically missing from the record.",
        "start": 0,
        "blockText": "Rosenthal's point is that certain effect sizes are large enough, such that even if there is a total publication bias against null results (the \"file drawer problem\"), the number of unpublished null results would be impossibly large to swamp out the effect size. Thus, the effect size must be statistically significant even after accounting for unpublished null results."
      }
    ]
  },
  {
    "id": "spya-rphjxk",
    "name": "Flexible analysis choices manufacture false significance",
    "provenance": "introduced",
    "statement": "When researchers have many undisclosed choices about how to collect, exclude, or analyze data, trying several of these and reporting only the one that comes out significant can make a false effect look statistically real far more often than the stated significance threshold suggests.",
    "analogy": "It is like playing twenty slot machines at once and only mentioning the one that paid out — of course one eventually will, even if every machine is rigged to lose.",
    "occurrences": [
      {
        "blockId": "spya-umu7gf",
        "quote": "These choices in the \"garden of forking paths\" multiply, creating many \"researcher degrees of freedom\". The effect is similar to the file-drawer problem, as the paths not taken are not published.",
        "reasoning": "Names the mechanism by which many small, unreported analytic choices compound into inflated false-positive rates.",
        "start": 209,
        "blockText": "Typically, a statistical study has multiple steps, with several choices at each step, such as during data collection, outlier rejection, choice of test statistic, choice of one-tailed or two-tailed test, etc. These choices in the \"garden of forking paths\" multiply, creating many \"researcher degrees of freedom\". The effect is similar to the file-drawer problem, as the paths not taken are not published.[181]"
      },
      {
        "blockId": "spya-jp3k7e",
        "quote": "The probability that at least 1 out of 20 is significant is, by assumption of independence, .",
        "reasoning": "The worked example only shows a problem once the reader accepts that testing many hypotheses and reporting the one hit is the hidden failure mode.",
        "start": 308,
        "blockText": "Consider a simple illustration. Suppose the null hypothesis is true, and we have 20 possible significance tests to apply to the dataset. Also suppose the outcomes to the significance tests are independent. By definition of \"significance\", each test has probability 0.05 to pass with significance level 0.05. The probability that at least 1 out of 20 is significant is, by assumption of independence, .[182]"
      },
      {
        "blockId": "spya-kqvxfb",
        "quote": "Questionable research practices are behaviors that exploit researcher degrees of freedom (researcher DF)—choices in study design, data analysis, or reporting—to inflate false positive rates and undermine reproducibility.",
        "reasoning": "Defines the whole category of questionable research practices in terms of exploiting this flexibility.",
        "start": 0,
        "blockText": "Questionable research practices are behaviors that exploit researcher degrees of freedom (researcher DF)—choices in study design, data analysis, or reporting—to inflate false positive rates and undermine reproducibility.[138][139][40] Examples of questionable research practices include data dredging,[139][140][39][c] selective reporting of only statistically significant findings,[138][139][140][39][d] HARKing (hypothesizing after results are known),[139][140][39][e] PARKing (pre-registering after results are known), and conducting inappropriate power analyses.[142]"
      },
      {
        "blockId": "spya-qsad7n",
        "quote": "moderately flexible data analysis, routine in research, can increase the false-positive rate to above 60%",
        "reasoning": "Quantifies how ordinary, non-malicious flexibility in analysis drives false-positive rates up, relying on the forking-paths mechanism.",
        "start": 128,
        "blockText": "Various statistical methods can be applied to make the p-value appear smaller than it really is. This need not be malicious, as moderately flexible data analysis, routine in research, can increase the false-positive rate to above 60%.[40]"
      }
    ]
  },
  {
    "id": "spya-uycfys",
    "name": "True effects can genuinely vary by context, not be one fixed number",
    "provenance": "introduced",
    "statement": "An effect may not have a single 'true' size waiting to be estimated; it can genuinely differ across populations, settings, and times because of hidden moderating factors, so even careful, well-powered direct replications can legitimately disagree with each other.",
    "occurrences": [
      {
        "blockId": "spya-r23rs2",
        "quote": "this suggested that heterogeneity could have been a genuine characteristic of the phenomena being investigated. For instance, phenomena might be influenced by so-called \"hidden moderators\"",
        "reasoning": "Explicitly frames variation across replications as reflecting real features of the phenomenon rather than noise.",
        "start": 671,
        "blockText": "Importantly, significant levels of heterogeneity are also found in direct/exact replications of a study. Stanley and colleagues discuss this while reporting a study by quantitative behavioral scientist Richard Klein and colleagues, where the authors attempted to replicate 15 psychological effects across 36 different sites in Europe and the U.S. In the study, Klein and colleagues found significant amounts of heterogeneity in 8 out of 16 effects (I-squared = 23% to 91%). Importantly, while the replication sites intentionally differed on a variety of characteristics, such differences could account for very little heterogeneity . According to Stanley and colleagues, this suggested that heterogeneity could have been a genuine characteristic of the phenomena being investigated. For instance, phenomena might be influenced by so-called \"hidden moderators\" – relevant factors that were previously not understood to be important in the production of a certain effect."
      },
      {
        "blockId": "spya-x02d6v",
        "quote": "if replication is defined by a subsequent study finding a sufficiently similar effect size to the original, replication success is not likely even if replications have very large sample sizes",
        "reasoning": "Shows that even infinite sample size cannot fix replication failure when the underlying effect is not a single fixed quantity.",
        "start": 546,
        "blockText": "In their analysis of 200 meta-analyses of psychological effects, Stanley and colleagues found a median percent of heterogeneity of I-squared = 74%. According to the authors, this level of heterogeneity can be considered \"huge\". It is three times larger than the random sampling variance of effect sizes measured in their study. If considered along sampling error, heterogeneity yields a standard deviation from one study to the next even larger than the median effect size of the 200 meta-analyses they investigated.[g] The authors conclude that if replication is defined by a subsequent study finding a sufficiently similar effect size to the original, replication success is not likely even if replications have very large sample sizes. Importantly, this occurs even if replications are direct or exact since heterogeneity nonetheless remains relatively high in these cases."
      },
      {
        "blockId": "spya-audpsj",
        "quote": "higher ratings of context sensitivity were associated with lower probabilities of replicating an effect",
        "reasoning": "Links context-dependence directly to replication outcomes, reinforcing that some effects are not single fixed quantities.",
        "start": 90,
        "blockText": "Context sensitivity was found to negatively correlate with replication success, such that higher ratings of context sensitivity were associated with lower probabilities of replicating an effect.[h] Importantly, context sensitivity significantly correlated with replication success even when adjusting for other factors considered important for reproducing results (e.g., effect size and sample size of original, statistical power of the replication, methodological similarity between original and replication).[i] In light of the results, the authors concluded that attempting a replication in a different time, place or with a different sample can significantly alter an experiment's results. Context sensitivity thus may be a reason certain effects fail to replicate in psychology.[192]"
      }
    ]
  },
  {
    "id": "spya-s3yg7b",
    "name": "A significant p-value's evidential weight depends on prior plausibility",
    "provenance": "introduced",
    "statement": "Rejecting the null hypothesis at the 5% level does not mean there is a 95% chance the alternative is true; by Bayes' theorem, how much a significant result should update belief depends heavily on how plausible the hypothesis was before the data came in.",
    "analogy": "It resembles a medical test for a rare disease: even an accurate positive result is more often a false alarm than a true case, simply because the disease is uncommon to start with.",
    "occurrences": [
      {
        "blockId": "spya-fhcf00",
        "quote": "rejecting the null hypothesis at significance level 5% does not mean that the posterior probability for the alternative hypothesis is 95%, and the posterior probability is also different from the probability of replication",
        "reasoning": "States directly that significance and posterior truth-probability are different quantities governed by prior odds.",
        "start": 61,
        "blockText": "In the framework of Bayesian probability, by Bayes' theorem, rejecting the null hypothesis at significance level 5% does not mean that the posterior probability for the alternative hypothesis is 95%, and the posterior probability is also different from the probability of replication.[193][185] Consider a simplified case where there are only two hypotheses. Let the prior probability of the null hypothesis be , and the alternative . For a given statistical study, let its false positive rate (significance level) be , and true positive rate (power) be . For illustrative purposes, let significance level be 0.05 and power be 0.45 (underpowered)."
      },
      {
        "blockId": "spya-esjk29",
        "quote": "if the prior probability of the null hypothesis is , and the study found a positive result, then the posterior probability for is , and the replication probability is",
        "reasoning": "Works through the numeric consequence that a low prior sharply limits how much a significant finding should be trusted.",
        "start": 13,
        "blockText": "For example, if the prior probability of the null hypothesis is , and the study found a positive result, then the posterior probability for is , and the replication probability is ."
      }
    ]
  },
  {
    "id": "spya-xu3jdx",
    "name": "Triangulation beats repeating the same method",
    "provenance": "introduced",
    "statement": "Confirming a finding through several methods that each rely on different, unrelated assumptions gives stronger evidence than simply repeating the original method, because a flaw baked into one method will reappear in every direct replication of it.",
    "occurrences": [
      {
        "blockId": "spya-astgqn",
        "quote": "research should emphasize triangulation, not just replication, to protect against flawed ideas",
        "reasoning": "States the core claim that multiple independent methods, not repetition, protect against error.",
        "start": 112,
        "blockText": "Psychologist Marcus R. Munafò and Epidemiologist George Davey Smith argue, in a piece published by Nature, that research should emphasize triangulation, not just replication, to protect against flawed ideas. They claim that,"
      },
      {
        "blockId": "spya-w073xf",
        "quote": "replication alone will get us only so far (and) might actually make matters worse ... [Triangulation] is the strategic use of multiple approaches to address one question. Each approach has its own unrelated assumptions, strengths and weaknesses. Results that agree across different methodologies are less likely to be artefacts.",
        "reasoning": "Spells out why shared assumptions across repeated identical methods fail to catch systematic flaws, which only triangulation can.",
        "start": 0,
        "blockText": "replication alone will get us only so far (and) might actually make matters worse ... [Triangulation] is the strategic use of multiple approaches to address one question. Each approach has its own unrelated assumptions, strengths and weaknesses. Results that agree across different methodologies are less likely to be artefacts. ... Maybe one reason replication has captured so much interest is the often-repeated idea that falsification is at the heart of the scientific enterprise. This idea was popularized by Karl Popper's 1950s maxim that theories can never be proved, only falsified. Yet an overemphasis on repeating experiments could provide an unfounded sense of certainty about findings that rely on a single approach. ... philosophers of science have moved on since Popper. Better descriptions of how scientists actually work include what epistemologist Peter Lipton called in 1991 \"inference to the best explanation\".[259]"
      }
    ]
  }
]
```

## Candidate Y

```json
[
  {
    "id": "spya-v3xyfv",
    "name": "Significance levels describe long-run frequencies, not single-case certainty",
    "provenance": "assumed",
    "statement": "A 5% significance level or a given power value is a statement about how often a testing procedure would err if repeated indefinitely under a hypothesis, not a probability attached to whether this particular finding, in front of you, happens to be true.",
    "whyYouNeedIt": "Without holding this frequentist framing, the formal definitions of significance level, power, and p-value given early in the piece collapse into (or get confused with) the posterior-probability claim that the article later goes out of its way to correct, so the definitions and the later correction cannot both be followed.",
    "occurrences": [
      {
        "blockId": "spya-m4dued",
        "quote": "Significance level, false positive rate, or the alpha level, is the probability of finding the alternative to be true when the null hypothesis is true",
        "reasoning": "This definition only makes sense as a long-run frequency across hypothetical repetitions under a fixed hypothesis, a framing the passage itself never spells out.",
        "start": 0,
        "blockText": "Significance level, false positive rate, or the alpha level, is the probability of finding the alternative to be true when the null hypothesis is true:For example, when the test is a one-sided threshold test, then where means \"the data is sampled from \"."
      },
      {
        "blockId": "spya-bnzb3f",
        "quote": "This is usually stated as \"the null hypothesis is rejected at significance level \", or \"\", such as \"smoking is correlated with cancer (p < 0.001)\"",
        "reasoning": "Treating this phrase as meaningful requires already knowing it reports a procedure's error rate over repeated sampling, not a probability about this one smoking-cancer claim.",
        "start": 163,
        "blockText": "Because the p-values are distributed uniformly on under the null hypothesis, researchers can set any significance level by computing the p-value, then output if . This is usually stated as \"the null hypothesis is rejected at significance level \", or \"\", such as \"smoking is correlated with cancer (p < 0.001)\"."
      },
      {
        "blockId": "spya-sg0nmn",
        "quote": "Statistical power, true positive rate, is the probability of finding the alternative to be true when the alternative hypothesis is true",
        "reasoning": "Again only coherent as a frequency over repeated hypothetical samples, which the reader must supply to avoid misreading power as a single-case certainty.",
        "start": 0,
        "blockText": "Statistical power, true positive rate, is the probability of finding the alternative to be true when the alternative hypothesis is true:where is also called the false negative rate. For example, when the test is a one-sided threshold test, then ."
      }
    ]
  },
  {
    "id": "spya-d564fw",
    "name": "Publication bias manufactures a false-positive-heavy literature",
    "provenance": "introduced",
    "statement": "When only positive, statistically significant results get published while null results are shelved (the 'file drawer' effect), the visible scientific literature ends up systematically enriched with false positives and inflated effects, even if individual researchers behave honestly.",
    "occurrences": [
      {
        "blockId": "spya-y782zn",
        "quote": "Publication bias—the tendency to publish only positive, significant results—creates the \"file drawer effect\", where negative results remain unpublished.",
        "reasoning": "States the core mechanism of selective publication distorting the visible record.",
        "start": 0,
        "blockText": "Publication bias—the tendency to publish only positive, significant results—creates the \"file drawer effect\", where negative results remain unpublished.[a] This produces misleading literature and biased meta-analyses.[26] Only a very small proportion of academic journals in psychology and neurosciences explicitly welcomed submissions of replication studies in their aim and scope or instructions to authors.[123][124] This does not encourage reporting on, or even attempts to perform, replication studies. Among 1,576 researchers Nature surveyed in 2016, only a minority had ever attempted to publish a replication, and several respondents who had published failed replications noted that editors and reviewers demanded that they play down comparisons with the original studies.[5][106] An analysis of 4,270 empirical studies in 18 business journals from 1970 to 1991 reported that less than 10% of accounting, economics, and finance articles and 5% of management and marketing articles were replication studies.[93][125] Publication bias is augmented by the pressure to publish and the author's own confirmation bias,[b] and is an inherent hazard in the field, requiring a certain degree of skepticism on the part of readers.[40]"
      },
      {
        "blockId": "spya-f76az5",
        "quote": "a high proportion of false positives in the published literature can explain why many findings are nonreproducible",
        "reasoning": "Connects the bias mechanism directly to the nonreplication outcome.",
        "start": 266,
        "blockText": "When publication bias is considered along with the fact that a majority of tested hypotheses might be false a priori, it is plausible that a considerable proportion of research findings might be false positives, as shown by metascientist John Ioannidis.[1] In turn, a high proportion of false positives in the published literature can explain why many findings are nonreproducible.[26]"
      }
    ]
  },
  {
    "id": "spya-amkb8a",
    "name": "Low power makes replication unlikely regardless of truth",
    "provenance": "introduced",
    "statement": "The chance that a published significant result will replicate is governed mathematically by the statistical power of the follow-up study, not by whether the original finding was actually true or false. If average power in a field is low, most claims — true or false — will fail to replicate simply because the tests are too weak to detect anything reliably.",
    "occurrences": [
      {
        "blockId": "spya-x7d5t5",
        "quote": "Mathematically, the probability of replicating a previous publication that rejected a null hypothesis in favor of an alternative is assuming significance is less than power. Thus, low power implies low probability of replication, regardless of how the previous publication was designed, and regardless of which hypothesis is really true.",
        "reasoning": "States directly that replication probability is a function of power alone, independent of ground truth.",
        "start": 0,
        "blockText": "Mathematically, the probability of replicating a previous publication that rejected a null hypothesis in favor of an alternative is assuming significance is less than power. Thus, low power implies low probability of replication, regardless of how the previous publication was designed, and regardless of which hypothesis is really true.[78]"
      },
      {
        "blockId": "spya-zvfgme",
        "quote": "implying that a positive result would replicate with probability less than 10%, regardless of whether the positive result was a true positive or a false positive",
        "reasoning": "Applies the same power-driven logic to explain psychology's low replication rates.",
        "start": 443,
        "blockText": "Stanley and colleagues estimated the average statistical power of psychological literature by analyzing data from 200 meta-analyses. They found that on average, psychology studies have between 33.1% and 36.4% statistical power. These values are quite low compared to the 80% considered adequate statistical power for an experiment. Across the 200 meta-analyses, the median of studies with adequate statistical power was between 7.7% and 9.1%, implying that a positive result would replicate with probability less than 10%, regardless of whether the positive result was a true positive or a false positive.[14]"
      }
    ]
  },
  {
    "id": "spya-x0p9gg",
    "name": "Selection for significance inflates published effect sizes",
    "provenance": "introduced",
    "statement": "Because only results clearing a significance threshold tend to get published, and small studies need an unusually large effect size to clear that bar by chance, the effect sizes that make it into print are systematically exaggerated, especially from underpowered studies — so replications routinely find smaller effects.",
    "occurrences": [
      {
        "blockId": "spya-hw9d4p",
        "quote": "when the dataset is small, noise tends to cause the regression factor to be overestimated",
        "reasoning": "Gives the statistical mechanism (small-sample noise plus selection) producing the inflation.",
        "start": 173,
        "blockText": "In studies that statistically estimate a regression factor, such as the in , when the dataset is large, noise tends to cause the regression factor to be underestimated, but when the dataset is small, noise tends to cause the regression factor to be overestimated.[180]"
      }
    ]
  },
  {
    "id": "spya-vx0sfk",
    "name": "Flexible analysis choices inflate false positives without fraud",
    "provenance": "introduced",
    "statement": "A researcher who makes any of many plausible, individually defensible choices about data collection, exclusion, and testing — the 'garden of forking paths' — can end up with a much higher real false-positive rate than the nominal 5%, even while acting in good faith and never consciously cheating.",
    "occurrences": [
      {
        "blockId": "spya-umu7gf",
        "quote": "These choices in the \"garden of forking paths\" multiply, creating many \"researcher degrees of freedom\". The effect is similar to the file-drawer problem, as the paths not taken are not published.",
        "reasoning": "States the mechanism by which legitimate-seeming flexibility multiplies hidden false-positive risk.",
        "start": 209,
        "blockText": "Typically, a statistical study has multiple steps, with several choices at each step, such as during data collection, outlier rejection, choice of test statistic, choice of one-tailed or two-tailed test, etc. These choices in the \"garden of forking paths\" multiply, creating many \"researcher degrees of freedom\". The effect is similar to the file-drawer problem, as the paths not taken are not published.[181]"
      },
      {
        "blockId": "spya-jp3k7e",
        "quote": "The probability that at least 1 out of 20 is significant is, by assumption of independence, .",
        "reasoning": "Gives the concrete calculation showing how testing multiple things inflates the chance of a spurious 'significant' result.",
        "start": 308,
        "blockText": "Consider a simple illustration. Suppose the null hypothesis is true, and we have 20 possible significance tests to apply to the dataset. Also suppose the outcomes to the significance tests are independent. By definition of \"significance\", each test has probability 0.05 to pass with significance level 0.05. The probability that at least 1 out of 20 is significant is, by assumption of independence, .[182]"
      },
      {
        "blockId": "spya-qsad7n",
        "quote": "This need not be malicious, as moderately flexible data analysis, routine in research, can increase the false-positive rate to above 60%.",
        "reasoning": "Explicitly denies intent is required for this inflation to occur.",
        "start": 97,
        "blockText": "Various statistical methods can be applied to make the p-value appear smaller than it really is. This need not be malicious, as moderately flexible data analysis, routine in research, can increase the false-positive rate to above 60%.[40]"
      }
    ]
  },
  {
    "id": "spya-xbhkk6",
    "name": "A single 'true effect size' may not exist to be replicated",
    "provenance": "introduced",
    "statement": "Many psychological effects vary genuinely across populations, settings, and hidden moderating conditions, so a replication can faithfully repeat the original procedure and still land on a legitimately different effect size — not because anyone erred, but because the underlying effect itself is not constant.",
    "occurrences": [
      {
        "blockId": "spya-ddw4ya",
        "quote": "Heterogeneity (variance in research findings due to multiple true effect sizes rather than one) is measured by the I-squared statistic, which quantifies unexplained variation in effect sizes across studies.",
        "reasoning": "Defines the heterogeneity concept that undermines the assumption of one fixed effect to reproduce.",
        "start": 148,
        "blockText": "As also reported by Stanley and colleagues, a further reason studies might fail to replicate is high heterogeneity of the to-be-replicated effects. Heterogeneity (variance in research findings due to multiple true effect sizes rather than one) is measured by the I-squared statistic, which quantifies unexplained variation in effect sizes across studies.[14][187] This variation can be due to differences in experimental methods, populations, cohorts, and statistical methods between replication studies. Heterogeneity poses a challenge to studies attempting to replicate previously found effect sizes. When heterogeneity is high, subsequent replications have a high probability of finding an effect size radically different than that of the original study.[f]"
      },
      {
        "blockId": "spya-x02d6v",
        "quote": "if replication is defined by a subsequent study finding a sufficiently similar effect size to the original, replication success is not likely even if replications have very large sample sizes",
        "reasoning": "Draws out the consequence: even huge, well-powered direct replications can 'fail' under high heterogeneity.",
        "start": 546,
        "blockText": "In their analysis of 200 meta-analyses of psychological effects, Stanley and colleagues found a median percent of heterogeneity of I-squared = 74%. According to the authors, this level of heterogeneity can be considered \"huge\". It is three times larger than the random sampling variance of effect sizes measured in their study. If considered along sampling error, heterogeneity yields a standard deviation from one study to the next even larger than the median effect size of the 200 meta-analyses they investigated.[g] The authors conclude that if replication is defined by a subsequent study finding a sufficiently similar effect size to the original, replication success is not likely even if replications have very large sample sizes. Importantly, this occurs even if replications are direct or exact since heterogeneity nonetheless remains relatively high in these cases."
      },
      {
        "blockId": "spya-qn347b",
        "quote": "failures to replicate might be explained by contextual differences between the original experiment and the replication, often called \"hidden moderators\"",
        "reasoning": "Connects heterogeneity to context-sensitivity as an alternative reading of failed replications.",
        "start": 201,
        "blockText": "New York University professor Jay Van Bavel and colleagues argue that a further reason findings are difficult to replicate is the sensitivity to context of certain psychological effects. On this view, failures to replicate might be explained by contextual differences between the original experiment and the replication, often called \"hidden moderators\".[192] Van Bavel and colleagues tested the influence of context sensitivity by reanalyzing the data of the widely cited Reproducibility Project carried out by the Open Science Collaboration.[11] They re-coded effects according to their sensitivity to contextual factors and then tested the relationship between context sensitivity and replication success in various regression models."
      }
    ]
  },
  {
    "id": "spya-uc9b2x",
    "name": "A significant p-value is not the posterior confidence in the theory",
    "provenance": "introduced",
    "statement": "Rejecting the null hypothesis at the 5% level does not mean there is a 95% chance the alternative hypothesis is correct; the actual probability that the finding is real depends on the prior plausibility of the hypothesis, via Bayes' theorem, and can be much lower.",
    "occurrences": [
      {
        "blockId": "spya-fhcf00",
        "quote": "rejecting the null hypothesis at significance level 5% does not mean that the posterior probability for the alternative hypothesis is 95%, and the posterior probability is also different from the probability of replication",
        "reasoning": "States the core correction to the common misreading of p-values.",
        "start": 61,
        "blockText": "In the framework of Bayesian probability, by Bayes' theorem, rejecting the null hypothesis at significance level 5% does not mean that the posterior probability for the alternative hypothesis is 95%, and the posterior probability is also different from the probability of replication.[193][185] Consider a simplified case where there are only two hypotheses. Let the prior probability of the null hypothesis be , and the alternative . For a given statistical study, let its false positive rate (significance level) be , and true positive rate (power) be . For illustrative purposes, let significance level be 0.05 and power be 0.45 (underpowered)."
      },
      {
        "blockId": "spya-gn5b3a",
        "quote": "Now, by Bayes' theorem, conditional on the statistical studying finding to be true, the posterior probability of actually being true is not , but",
        "reasoning": "Walks through the Bayesian recalculation that produces a different, usually lower, confidence figure.",
        "start": 0,
        "blockText": "Now, by Bayes' theorem, conditional on the statistical studying finding to be true, the posterior probability of actually being true is not , but"
      },
      {
        "blockId": "spya-esjk29",
        "quote": "if the prior probability of the null hypothesis is , and the study found a positive result, then the posterior probability for is , and the replication probability is",
        "reasoning": "Gives a worked numeric example showing the gap between nominal significance and actual confidence.",
        "start": 13,
        "blockText": "For example, if the prior probability of the null hypothesis is , and the study found a positive result, then the posterior probability for is , and the replication probability is ."
      }
    ]
  },
  {
    "id": "spya-abm06b",
    "name": "A rejected null doesn't single out one alternative theory",
    "provenance": "introduced",
    "statement": "In fields where many different theories all predict 'these two things are correlated,' disproving 'there is no correlation' provides almost no evidence for any one of those competing theories, unlike in simpler domains where there are few plausible alternatives.",
    "occurrences": [
      {
        "blockId": "spya-j0ubfk",
        "quote": "Thus, evidence against the null hypothesis \"there is no correlation\" is no evidence for one of the many alternative hypotheses that equally well predict \"there is a correlation\".",
        "reasoning": "States directly why beating the null doesn't confirm the specific theory a researcher favors.",
        "start": 203,
        "blockText": "Furthermore, when the null hypothesis is rejected, it might not be evidence for the substantial alternative hypothesis. In soft sciences, many hypotheses can predict a correlation between two variables. Thus, evidence against the null hypothesis \"there is no correlation\" is no evidence for one of the many alternative hypotheses that equally well predict \"there is a correlation\". Fisher developed the NHST for agronomy, where rejecting the null hypothesis is usually good proof of the alternative hypothesis, since there are not many of them. Rejecting the hypothesis \"fertilizer does not help\" is evidence for \"fertilizer helps\". But in psychology, there are many alternative hypotheses for every null hypothesis.[198][199]"
      }
    ]
  },
  {
    "id": "spya-rumtc9",
    "name": "Triangulation beats repeated replication alone",
    "provenance": "introduced",
    "statement": "Confidence in a finding should come from agreement across methodologically independent approaches with different flaws, not just from repeating the same method again and again, since repetition can simply reproduce a shared hidden flaw.",
    "occurrences": [
      {
        "blockId": "spya-w073xf",
        "quote": "replication alone will get us only so far (and) might actually make matters worse ... [Triangulation] is the strategic use of multiple approaches to address one question. Each approach has its own unrelated assumptions, strengths and weaknesses. Results that agree across different methodologies are less likely to be artefacts.",
        "reasoning": "States the triangulation idea directly as an alternative epistemic standard to mere replication.",
        "start": 0,
        "blockText": "replication alone will get us only so far (and) might actually make matters worse ... [Triangulation] is the strategic use of multiple approaches to address one question. Each approach has its own unrelated assumptions, strengths and weaknesses. Results that agree across different methodologies are less likely to be artefacts. ... Maybe one reason replication has captured so much interest is the often-repeated idea that falsification is at the heart of the scientific enterprise. This idea was popularized by Karl Popper's 1950s maxim that theories can never be proved, only falsified. Yet an overemphasis on repeating experiments could provide an unfounded sense of certainty about findings that rely on a single approach. ... philosophers of science have moved on since Popper. Better descriptions of how scientists actually work include what epistemologist Peter Lipton called in 1991 \"inference to the best explanation\".[259]"
      }
    ]
  }
]
```

## Candidate Z

```json
[
  {
    "id": "spya-r5u4ru",
    "name": "Trust comes from convergence across many studies, not one",
    "provenance": "assumed",
    "statement": "No single study, however large or well-run, is enough to establish a finding; confidence has to come from accumulating many independent studies and seeing whether they agree.",
    "whyYouNeedIt": "The push for multi-lab collaborations, bigger samples, and pooled data collection only makes sense as improvements if the reader already accepts that aggregating independent evidence, rather than any one result, is what grounds scientific confidence.",
    "occurrences": [
      {
        "blockId": "spya-dtq8wq",
        "quote": "Researchers can collaborate by coordinating data collection or fund data collection by researchers who may not have access to the funds, allowing larger sample sizes and increasing the robustness of the conclusions.",
        "reasoning": "Presents pooling resources across many researchers as something that increases robustness, assuming without arguing that more combined evidence is what makes conclusions trustworthy.",
        "start": 534,
        "blockText": "The replication crisis has led to the formation and development of various large-scale and collaborative communities to pool their resources to address a single question across cultures, countries and disciplines.[257] The focus is on replication, to ensure that the effect generalizes beyond a specific culture and investigate whether the effect is replicable and genuine.[258] This allows interdisciplinary internal reviews, multiple perspectives, uniform protocols across labs, and recruiting larger and more diverse samples.[258] Researchers can collaborate by coordinating data collection or fund data collection by researchers who may not have access to the funds, allowing larger sample sizes and increasing the robustness of the conclusions."
      },
      {
        "blockId": "spya-g7w0hc",
        "quote": "a team of 186 researchers from 60 laboratories (representing 36 nationalities from six continents) conducted replications of 28 classic and contemporary findings in psychology.",
        "reasoning": "The scale of this collaborative effort is presented as a strength in itself, relying on the unstated premise that more independent replications yield more trustworthy knowledge.",
        "start": 83,
        "blockText": "Similarly, in a study conducted under the auspices of the Center for Open Science, a team of 186 researchers from 60 laboratories (representing 36 nationalities from six continents) conducted replications of 28 classic and contemporary findings in psychology.[81][82] The study's focus was not only whether the original papers' findings replicated but also the extent to which findings varied as a function of variations in samples and contexts. Overall, 50% of findings failed to replicate despite large sample sizes. When findings did replicate, they consistently replicated across most samples. When they failed, they consistently failed across contexts, suggesting contextual sensitivity was not the primary driver of replication failures. This evidence is inconsistent with a proposed explanation that failures to replicate in psychology are likely due to changes in the sample between the original and replication study.[82]"
      },
      {
        "blockId": "spya-q8j4xp",
        "quote": "To improve the quality of replications, larger sample sizes than those used in the original study are often needed.",
        "reasoning": "Recommends larger samples as a quality improvement, assuming that more accumulated data converges toward the truth.",
        "start": 0,
        "blockText": "To improve the quality of replications, larger sample sizes than those used in the original study are often needed.[234] Larger sample sizes are needed because estimates of effect sizes in published work are often exaggerated due to publication bias and large sampling variability associated with small sample sizes in an original study.[235][236][237] Further, using significance thresholds usually leads to inflated effects, because particularly with small sample sizes, only the largest effects will become significant.[195]"
      }
    ]
  },
  {
    "id": "spya-dbc9t0",
    "name": "Citation counts stand in for scientific credibility",
    "provenance": "assumed",
    "statement": "The number of times a paper is cited is treated, by scientists and institutions alike, as a signal of how important or trustworthy its findings are.",
    "whyYouNeedIt": "The finding that non-replicable papers get cited more only reads as troubling if citations are already assumed to track quality; otherwise it would be an unremarkable, neutral fact about publicity.",
    "occurrences": [
      {
        "blockId": "spya-m3et6t",
        "quote": "In 2021, a study conducted by University of California, San Diego found that papers that cannot be replicated are more likely to be cited.",
        "reasoning": "This is presented as a concerning finding, which only makes sense if citation counts are assumed to reflect scientific merit.",
        "start": 0,
        "blockText": "In 2021, a study conducted by University of California, San Diego found that papers that cannot be replicated are more likely to be cited.[110] Nonreplicable publications are often cited more even after a replication study is published.[111]"
      },
      {
        "blockId": "spya-x6vcuf",
        "quote": "A 2021 study found that papers in leading general interest, psychology and economics journals with findings that could not be replicated tend to be cited more over time than reproducible research papers, likely because these results are surprising or interesting.",
        "reasoning": "Treats it as a problem that unreliable work accrues more citations, which presumes citations are meant to track reliability.",
        "start": 0,
        "blockText": "A 2021 study found that papers in leading general interest, psychology and economics journals with findings that could not be replicated tend to be cited more over time than reproducible research papers, likely because these results are surprising or interesting. The trend is not affected by publication of failed reproductions, after which only 12% of papers that cite the original research will mention the failed replication.[204][205] Further, experts are able to predict which studies will be replicable, leading the authors of the 2021 study, Marta Serra-Garcia and Uri Gneezy, to conclude that experts apply lower standards to interesting results when deciding whether to publish them.[205]"
      }
    ]
  },
  {
    "id": "spya-dyjpcb",
    "name": "Non-replication is science working, not failing",
    "provenance": "introduced",
    "statement": "A failed replication does not by itself mean a field is sloppy or corrupt; weeding out unsupported hypotheses through failed replication is how science is supposed to function, even though that process can be slow and uneven.",
    "occurrences": [
      {
        "blockId": "spya-cxcn8h",
        "quote": "Replication failures do not indicate that affected fields lack scientific rigor.",
        "reasoning": "States directly that replication failure should not be read as evidence of a field's poor rigor.",
        "start": 0,
        "blockText": "Replication failures do not indicate that affected fields lack scientific rigor.[15][16][17] Rather, they reflect the normal operation of science—a mechanism by which unsupported hypotheses are eliminated,[18][19] but which often functions slowly and inconsistently.[20][21]"
      },
      {
        "blockId": "spya-dzsa7e",
        "quote": "On this view, low rates of replicability could be consistent with quality science.",
        "reasoning": "Reinforces, via Bird's argument, that low replication rates can coexist with sound scientific practice rather than indicating it.",
        "start": 188,
        "blockText": "According to philosopher Alexander Bird, a possible reason for the low rates of replicability in certain scientific fields is that a majority of tested hypotheses are false a priori.[202] On this view, low rates of replicability could be consistent with quality science. Relatedly, the expectation that most findings should replicate would be misguided and, according to Bird, a form of base rate fallacy. Bird's argument works as follows. Assuming an ideal situation of a test of significance, whereby the probability of incorrectly rejecting the null hypothesis is 5% (i.e. Type I error) and the probability of correctly rejecting the null hypothesis is 80% (i.e. Power), in a context where a high proportion of tested hypotheses are false, it is conceivable that the number of false positives would be high compared to those of true positives.[202] For example, in a situation where only 10% of tested hypotheses are actually true, one can calculate that as many as 36% of results will be false positives.[j]"
      }
    ]
  },
  {
    "id": "spya-bttgj8",
    "name": "Published effect sizes shrink on replication",
    "provenance": "introduced",
    "statement": "Because of selective publication and small original samples, the effect sizes reported in the first, headline-making study are typically inflated, so that later replications almost always find a smaller effect even when they successfully confirm the finding exists.",
    "occurrences": [
      {
        "blockId": "spya-r42sms",
        "quote": "Even when the study replicates, the replication typically has a smaller effect size.",
        "reasoning": "States the shrinkage pattern as a general rule, independent of any particular field.",
        "start": 0,
        "blockText": "Even when the study replicates, the replication typically has a smaller effect size. Underpowered[clarification needed] studies have a large effect size bias.[179]"
      },
      {
        "blockId": "spya-hw9d4p",
        "quote": "when the dataset is large, noise tends to cause the regression factor to be underestimated, but when the dataset is small, noise tends to cause the regression factor to be overestimated.",
        "reasoning": "Gives the statistical mechanism (small-sample noise combined with a significance filter) that produces inflated original estimates.",
        "start": 77,
        "blockText": "In studies that statistically estimate a regression factor, such as the in , when the dataset is large, noise tends to cause the regression factor to be underestimated, but when the dataset is small, noise tends to cause the regression factor to be overestimated.[180]"
      },
      {
        "blockId": "spya-bha57y",
        "quote": "Of 97 original studies with significant effects, 36% replicated successfully (p value below 0.05), with effect sizes averaging half the original magnitude.",
        "reasoning": "Provides concrete numbers showing the shrinkage pattern in a large-scale replication project.",
        "start": 427,
        "blockText": "In August 2015, the first open empirical study of reproducibility in psychology was published, called The Reproducibility Project: Psychology. Coordinated by psychologist Brian Nosek, researchers redid 100 studies in psychological science from three high-ranking psychology journals (Journal of Personality and Social Psychology, Journal of Experimental Psychology: Learning, Memory, and Cognition, and Psychological Science). Of 97 original studies with significant effects, 36% replicated successfully (p value below 0.05), with effect sizes averaging half the original magnitude.[11] Among non-replications, 25% directly contradicted the original while 49% were inconclusive due to underpowered designs. The same paper examined the reproducibility rates and effect sizes by journal and discipline. Study replication rates were 23% for the Journal of Personality and Social Psychology, 48% for Journal of Experimental Psychology: Learning, Memory, and Cognition, and 38% for Psychological Science. Studies in the field of cognitive psychology had a higher replication rate (50%) than studies in the field of social psychology (25%).[77] This inconclusiveness reflected inadequate statistical power: replication samples were approximately 40% the size of the originals.[78]"
      }
    ]
  },
  {
    "id": "spya-efwvyz",
    "name": "Unpublished negative results distort the record",
    "provenance": "introduced",
    "statement": "Because journals favor positive, significant findings, negative and null results tend to go unpublished, which leaves the visible scientific literature systematically unrepresentative of what was actually found.",
    "occurrences": [
      {
        "blockId": "spya-y782zn",
        "quote": "Publication bias—the tendency to publish only positive, significant results—creates the \"file drawer effect\", where negative results remain unpublished.",
        "reasoning": "States directly that selective publication of positive results hides negative findings from view.",
        "start": 0,
        "blockText": "Publication bias—the tendency to publish only positive, significant results—creates the \"file drawer effect\", where negative results remain unpublished.[a] This produces misleading literature and biased meta-analyses.[26] Only a very small proportion of academic journals in psychology and neurosciences explicitly welcomed submissions of replication studies in their aim and scope or instructions to authors.[123][124] This does not encourage reporting on, or even attempts to perform, replication studies. Among 1,576 researchers Nature surveyed in 2016, only a minority had ever attempted to publish a replication, and several respondents who had published failed replications noted that editors and reviewers demanded that they play down comparisons with the original studies.[5][106] An analysis of 4,270 empirical studies in 18 business journals from 1970 to 1991 reported that less than 10% of accounting, economics, and finance articles and 5% of management and marketing articles were replication studies.[93][125] Publication bias is augmented by the pressure to publish and the author's own confirmation bias,[b] and is an inherent hazard in the field, requiring a certain degree of skepticism on the part of readers.[40]"
      },
      {
        "blockId": "spya-f76az5",
        "quote": "When publication bias is considered along with the fact that a majority of tested hypotheses might be false a priori, it is plausible that a considerable proportion of research findings might be false positives, as shown by metascientist John Ioannidis.",
        "reasoning": "Connects the hidden-negative-results mechanism to an explanation for widespread false positives in the published record.",
        "start": 0,
        "blockText": "When publication bias is considered along with the fact that a majority of tested hypotheses might be false a priori, it is plausible that a considerable proportion of research findings might be false positives, as shown by metascientist John Ioannidis.[1] In turn, a high proportion of false positives in the published literature can explain why many findings are nonreproducible.[26]"
      },
      {
        "blockId": "spya-asmt0d",
        "quote": "In popular media, there is another element of publication bias: the desire to make research accessible to the public led to oversimplification and exaggeration of findings, creating unrealistic expectations and amplifying the impact of non-replications.",
        "reasoning": "Extends the same selective-visibility mechanism to public media coverage of science.",
        "start": 0,
        "blockText": "In popular media, there is another element of publication bias: the desire to make research accessible to the public led to oversimplification and exaggeration of findings, creating unrealistic expectations and amplifying the impact of non-replications. In contrast, null results and failures to replicate tend to go unreported. This explanation may apply to power posing's replication crisis.[128]"
      }
    ]
  },
  {
    "id": "spya-m2d6er",
    "name": "Flexible analysis choices manufacture false positives",
    "provenance": "introduced",
    "statement": "Researchers face many small, seemingly reasonable choices in collecting, analyzing, and reporting data, and exploiting this flexibility (even without any intent to deceive) can turn a true null effect into an apparently significant finding far more often than the nominal 5% error rate suggests.",
    "occurrences": [
      {
        "blockId": "spya-kqvxfb",
        "quote": "Questionable research practices are behaviors that exploit researcher degrees of freedom (researcher DF)—choices in study design, data analysis, or reporting—to inflate false positive rates and undermine reproducibility.",
        "reasoning": "Names the general mechanism by which ordinary analytic choices, not fraud, inflate false positives.",
        "start": 0,
        "blockText": "Questionable research practices are behaviors that exploit researcher degrees of freedom (researcher DF)—choices in study design, data analysis, or reporting—to inflate false positive rates and undermine reproducibility.[138][139][40] Examples of questionable research practices include data dredging,[139][140][39][c] selective reporting of only statistically significant findings,[138][139][140][39][d] HARKing (hypothesizing after results are known),[139][140][39][e] PARKing (pre-registering after results are known), and conducting inappropriate power analyses.[142]"
      },
      {
        "blockId": "spya-umu7gf",
        "quote": "These choices in the \"garden of forking paths\" multiply, creating many \"researcher degrees of freedom\". The effect is similar to the file-drawer problem, as the paths not taken are not published.",
        "reasoning": "Explains how multiplying small decision points compounds into a large hidden source of false positives.",
        "start": 209,
        "blockText": "Typically, a statistical study has multiple steps, with several choices at each step, such as during data collection, outlier rejection, choice of test statistic, choice of one-tailed or two-tailed test, etc. These choices in the \"garden of forking paths\" multiply, creating many \"researcher degrees of freedom\". The effect is similar to the file-drawer problem, as the paths not taken are not published.[181]"
      },
      {
        "blockId": "spya-qsad7n",
        "quote": "Various statistical methods can be applied to make the p-value appear smaller than it really is. This need not be malicious, as moderately flexible data analysis, routine in research, can increase the false-positive rate to above 60%.",
        "reasoning": "States quantitatively how ordinary flexible analysis, without misconduct, inflates the false-positive rate far above the nominal threshold.",
        "start": 0,
        "blockText": "Various statistical methods can be applied to make the p-value appear smaller than it really is. This need not be malicious, as moderately flexible data analysis, routine in research, can increase the false-positive rate to above 60%.[40]"
      }
    ]
  },
  {
    "id": "spya-xkwjb8",
    "name": "Low power dooms replication regardless of truth",
    "provenance": "introduced",
    "statement": "If a study's statistical power (its chance of detecting a real effect when one exists) is low, then even a genuinely true finding is unlikely to be successfully replicated, no matter how the original study was designed or whether the original effect was real or a fluke.",
    "occurrences": [
      {
        "blockId": "spya-x7d5t5",
        "quote": "Thus, low power implies low probability of replication, regardless of how the previous publication was designed, and regardless of which hypothesis is really true.",
        "reasoning": "States the mathematical link between low power and low replication probability directly.",
        "start": 174,
        "blockText": "Mathematically, the probability of replicating a previous publication that rejected a null hypothesis in favor of an alternative is assuming significance is less than power. Thus, low power implies low probability of replication, regardless of how the previous publication was designed, and regardless of which hypothesis is really true.[78]"
      },
      {
        "blockId": "spya-zvfgme",
        "quote": "implying that a positive result would replicate with probability less than 10%, regardless of whether the positive result was a true positive or a false positive.",
        "reasoning": "Applies the power-replication link to psychology's estimated power levels to predict a near-universal low replication rate.",
        "start": 443,
        "blockText": "Stanley and colleagues estimated the average statistical power of psychological literature by analyzing data from 200 meta-analyses. They found that on average, psychology studies have between 33.1% and 36.4% statistical power. These values are quite low compared to the 80% considered adequate statistical power for an experiment. Across the 200 meta-analyses, the median of studies with adequate statistical power was between 7.7% and 9.1%, implying that a positive result would replicate with probability less than 10%, regardless of whether the positive result was a true positive or a false positive.[14]"
      },
      {
        "blockId": "spya-hdubm3",
        "quote": "Low statistical power hinders replication for three reasons: (1) low-power replications have reduced ability to detect true effects, (2) low-power original studies produce biased effect size estimates leading to undersized replications, and (3) low-power original studies yield results unlikely to reflect true effects.",
        "reasoning": "Spells out the several distinct ways low power specifically undermines replication.",
        "start": 0,
        "blockText": "Low statistical power hinders replication for three reasons: (1) low-power replications have reduced ability to detect true effects, (2) low-power original studies produce biased effect size estimates leading to undersized replications, and (3) low-power original studies yield results unlikely to reflect true effects.[14]"
      }
    ]
  },
  {
    "id": "spya-wk3nn9",
    "name": "Some 'failures to replicate' reflect real variation, not error",
    "provenance": "introduced",
    "statement": "An effect can genuinely differ in size or even direction across populations, settings, or time periods because of unrecognized 'hidden moderators', so a replication that finds something different from the original is not automatically evidence that the original was wrong.",
    "occurrences": [
      {
        "blockId": "spya-ddw4ya",
        "quote": "Heterogeneity (variance in research findings due to multiple true effect sizes rather than one) is measured by the I-squared statistic, which quantifies unexplained variation in effect sizes across studies.",
        "reasoning": "Defines the idea that there can be multiple genuinely different true effect sizes rather than one fixed truth to be found.",
        "start": 148,
        "blockText": "As also reported by Stanley and colleagues, a further reason studies might fail to replicate is high heterogeneity of the to-be-replicated effects. Heterogeneity (variance in research findings due to multiple true effect sizes rather than one) is measured by the I-squared statistic, which quantifies unexplained variation in effect sizes across studies.[14][187] This variation can be due to differences in experimental methods, populations, cohorts, and statistical methods between replication studies. Heterogeneity poses a challenge to studies attempting to replicate previously found effect sizes. When heterogeneity is high, subsequent replications have a high probability of finding an effect size radically different than that of the original study.[f]"
      },
      {
        "blockId": "spya-r23rs2",
        "quote": "this suggested that heterogeneity could have been a genuine characteristic of the phenomena being investigated. For instance, phenomena might be influenced by so-called \"hidden moderators\" – relevant factors that were previously not understood to be important in the production of a certain effect.",
        "reasoning": "Explicitly attributes replication variation to real differences in the phenomenon rather than to study quality.",
        "start": 671,
        "blockText": "Importantly, significant levels of heterogeneity are also found in direct/exact replications of a study. Stanley and colleagues discuss this while reporting a study by quantitative behavioral scientist Richard Klein and colleagues, where the authors attempted to replicate 15 psychological effects across 36 different sites in Europe and the U.S. In the study, Klein and colleagues found significant amounts of heterogeneity in 8 out of 16 effects (I-squared = 23% to 91%). Importantly, while the replication sites intentionally differed on a variety of characteristics, such differences could account for very little heterogeneity . According to Stanley and colleagues, this suggested that heterogeneity could have been a genuine characteristic of the phenomena being investigated. For instance, phenomena might be influenced by so-called \"hidden moderators\" – relevant factors that were previously not understood to be important in the production of a certain effect."
      },
      {
        "blockId": "spya-qn347b",
        "quote": "failures to replicate might be explained by contextual differences between the original experiment and the replication, often called \"hidden moderators\".",
        "reasoning": "Applies the same genuine-variation idea to explain why context sensitivity predicts replication failure.",
        "start": 201,
        "blockText": "New York University professor Jay Van Bavel and colleagues argue that a further reason findings are difficult to replicate is the sensitivity to context of certain psychological effects. On this view, failures to replicate might be explained by contextual differences between the original experiment and the replication, often called \"hidden moderators\".[192] Van Bavel and colleagues tested the influence of context sensitivity by reanalyzing the data of the widely cited Reproducibility Project carried out by the Open Science Collaboration.[11] They re-coded effects according to their sensitivity to contextual factors and then tested the relationship between context sensitivity and replication success in various regression models."
      }
    ]
  },
  {
    "id": "spya-kvu2qv",
    "name": "A significant result isn't proof the effect is real",
    "provenance": "introduced",
    "statement": "Rejecting the null hypothesis only shows the data would be unlikely if there were no effect; it does not by itself tell you the probability that the effect is actually there, which also depends on how plausible the effect was before the data came in.",
    "occurrences": [
      {
        "blockId": "spya-fhcf00",
        "quote": "In the framework of Bayesian probability, by Bayes' theorem, rejecting the null hypothesis at significance level 5% does not mean that the posterior probability for the alternative hypothesis is 95%, and the posterior probability is also different from the probability of replication.",
        "reasoning": "States explicitly that significance level is not the same thing as the probability the finding is true.",
        "start": 0,
        "blockText": "In the framework of Bayesian probability, by Bayes' theorem, rejecting the null hypothesis at significance level 5% does not mean that the posterior probability for the alternative hypothesis is 95%, and the posterior probability is also different from the probability of replication.[193][185] Consider a simplified case where there are only two hypotheses. Let the prior probability of the null hypothesis be , and the alternative . For a given statistical study, let its false positive rate (significance level) be , and true positive rate (power) be . For illustrative purposes, let significance level be 0.05 and power be 0.45 (underpowered)."
      },
      {
        "blockId": "spya-pknetn",
        "quote": "In particular, when statistical studies on extrasensory perception reject the null hypothesis at extremely low p-value (as in the case of Daryl Bem), it does not imply the alternative hypothesis \"ESP exists\".",
        "reasoning": "Uses an extreme case to show that even very low p-values do not establish the truth of the tested alternative hypothesis.",
        "start": 0,
        "blockText": "In particular, when statistical studies on extrasensory perception reject the null hypothesis at extremely low p-value (as in the case of Daryl Bem), it does not imply the alternative hypothesis \"ESP exists\".[200] Far more likely is that there was a small (non-ESP) signal in the experiment setup that has been measured precisely.[201]"
      }
    ]
  },
  {
    "id": "spya-vjj2wm",
    "name": "Converging methods beat repeating one method",
    "provenance": "introduced",
    "statement": "Running the same kind of study again and again is less informative than testing a question with several methods that each have different weaknesses, because agreement across unrelated methods is much less likely to be a shared artefact.",
    "occurrences": [
      {
        "blockId": "spya-w073xf",
        "quote": "[Triangulation] is the strategic use of multiple approaches to address one question. Each approach has its own unrelated assumptions, strengths and weaknesses. Results that agree across different methodologies are less likely to be artefacts.",
        "reasoning": "States directly why combining differently-flawed methods is more reliable than repeating one method.",
        "start": 86,
        "blockText": "replication alone will get us only so far (and) might actually make matters worse ... [Triangulation] is the strategic use of multiple approaches to address one question. Each approach has its own unrelated assumptions, strengths and weaknesses. Results that agree across different methodologies are less likely to be artefacts. ... Maybe one reason replication has captured so much interest is the often-repeated idea that falsification is at the heart of the scientific enterprise. This idea was popularized by Karl Popper's 1950s maxim that theories can never be proved, only falsified. Yet an overemphasis on repeating experiments could provide an unfounded sense of certainty about findings that rely on a single approach. ... philosophers of science have moved on since Popper. Better descriptions of how scientists actually work include what epistemologist Peter Lipton called in 1991 \"inference to the best explanation\".[259]"
      },
      {
        "blockId": "spya-dtq8wq",
        "quote": "This allows interdisciplinary internal reviews, multiple perspectives, uniform protocols across labs, and recruiting larger and more diverse samples.",
        "reasoning": "Describes multi-lab collaborations as valuable specifically because they bring multiple perspectives together, an instance of the same converging-methods logic.",
        "start": 379,
        "blockText": "The replication crisis has led to the formation and development of various large-scale and collaborative communities to pool their resources to address a single question across cultures, countries and disciplines.[257] The focus is on replication, to ensure that the effect generalizes beyond a specific culture and investigate whether the effect is replicable and genuine.[258] This allows interdisciplinary internal reviews, multiple perspectives, uniform protocols across labs, and recruiting larger and more diverse samples.[258] Researchers can collaborate by coordinating data collection or fund data collection by researchers who may not have access to the funds, allowing larger sample sizes and increasing the robustness of the conclusions."
      }
    ]
  }
]
```
