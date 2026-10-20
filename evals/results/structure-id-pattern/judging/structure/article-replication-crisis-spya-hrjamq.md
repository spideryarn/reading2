# The article: Replication crisis

TITLE: Replication crisis
BY: Contributors to Wikimedia projects
PUBLISHED IN: Wikimedia Foundation, Inc.
URL: https://en.wikipedia.org/wiki/Replication_crisis

---

Each block below starts with its id. The ids are for these instructions, not
for the reader: put one only where you are asked for an id or a citation, and
never name a passage in your own words as "block 12" or "block spya-k3m9qt".
Say what the passage says instead: "where mutual information is defined".

spya-kv0w8d: Replication crisis

spya-kjxxn0: Contributors to Wikimedia projects · Wikimedia Foundation, Inc. · ~150 min read

spya-twgsnd: Ioannidis (2005): "Why Most Published Research Findings Are False".[1]

spya-pcnqxn: The replication crisis, also known as the reproducibility or replicability crisis, refers to widespread failures to reproduce published scientific results. Because the reproducibility of empirical results is the cornerstone of the scientific method,[2] such failures undermine the credibility of theories and challenge substantial parts of scientific knowledge.

spya-ur36f2: Psychology and medicine have been focal points for replication efforts, with researchers systematically reexamining classic studies to verify their reliability and, when failures emerge, to identify the underlying causes.[3][4] Data strongly indicates that other natural and social sciences are also affected.[5]

spya-umxmuu: The phrase "replication crisis" was coined in the early 2010s as part of a growing awareness of the problem.[6] Considerations of causes and remedies have given rise to a new scientific discipline known as metascience,[7] which uses methods of empirical research to examine empirical research practice.[7]

spya-rtgcqu: Researchers distinguish two forms of reproducibility. Reproducibility in a narrow sense refers to reexamining and validating the analysis of a set of data. The second category, replication, involves repeating an experiment or study with new, independent data to verify the original conclusions.

spya-vmrrb6: Replication has been called "the cornerstone of science".[8][9] Environmental health scientist Stefan Schmidt began a 2009 review with this description of replication:

spya-xa7p42: Replication is one of the central issues in any empirical science. To confirm results or hypotheses by a repetition procedure is at the basis of any scientific conception. A replication experiment to demonstrate that the same findings can be obtained in any other place by any other researcher is conceived as an operationalization of objectivity. It is the proof that the experiment reflects knowledge that can be separated from the specific circumstances (such as time, place, or persons) under which it was gained.[10]

spya-v2xjsr: But no universal definition of replication or related concepts has been agreed on.[11][12][10] Replication types include:

spya-gjq4t4: direct (repeating procedures as closely as possible),[10][13]

spya-dt47ut: systematic (repeating with intentional changes),[13] and

spya-xhu6sc: conceptual (testing hypotheses using different procedures to assess generalizability).[10][13]

spya-rpm4a9: Reproducibility can also be distinguished from replication, as referring to reproducing the same results using the same data set. Reproducibility of this type is why many researchers make their data available to others for testing.[14]

spya-cxcn8h: Replication failures do not indicate that affected fields lack scientific rigor.[15][16][17] Rather, they reflect the normal operation of science—a mechanism by which unsupported hypotheses are eliminated,[18][19] but which often functions slowly and inconsistently.[20][21]

spya-tbsjz3: A hypothesis is generally considered supported when the results match the predicted pattern and that pattern is found to be statistically significant. Under null hypothesis assumption, results are deemed statistically significant when their probability falls below a predetermined threshold (the significance level). This generally answers the question of how unlikely such results would be by chance alone if no true effect existed in the statistical population. If the probability associated with the test statistic exceeds the chosen critical value, the results are considered statistically significant.[22] The p-value represents the probability of obtaining results at least as extreme as observed, assuming the null hypothesis is true. The standard threshold p < 0.05 means accepting a 5% false positive rate. Some fields use smaller p-values, such as p < 0.01 (1% chance of a false positive) or p < 0.001 (0.1% chance of a false positive). But a smaller chance of a false positive often requires greater sample sizes or a greater chance of a false negative (a correct hypothesis being erroneously found incorrect). Although p-value testing is the most commonly used method, it is not the only one.

spya-xrc2re: Certain terms commonly used in discussions of the replication crisis have technically precise meanings, which are presented here.[1]

spya-qnsh78: In the most common case, null hypothesis testing, there are two hypotheses, a null hypothesis and an alternative hypothesis . The null hypothesis is typically of the form "X and Y are statistically independent". For example, the null hypothesis might be "taking drug X does not change 1-year recovery rate from disease Y", and the alternative hypothesis is that it does change.

spya-cxbx9m: As testing for full statistical independence is difficult, the full null hypothesis is often reduced to a simplified null hypothesis "the effect size is 0", where "effect size" is a real number that is 0 if the full null hypothesis is true, and the larger the effect size is, the more the null hypothesis is false.[23] For example, if X is binary, then the effect size might be defined as the change in the expectation of Y upon a change of X:Note that the effect size as defined above might be zero even if X and Y are not independent, such as when their relationship is non-linear (such as ) or when one variable affects different subgroups oppositely. Since different definitions of "effect size" capture different ways for X and Y to be dependent, there are many definitions of effect size.

spya-c08svn: In practice, effect sizes cannot be directly observed, but must be measured by statistical estimators. For example, the above definition of effect size is often measured by Cohen's d estimator. The same effect size might have multiple estimators, as they have tradeoffs between efficiency, bias, variance, etc. This further increases the number of possible statistical quantities that can be computed on a single dataset. When an estimator for an effect size is used for statistical testing, it is called a test statistic.

spya-akqqjg: Illustration of the 4 possible outcomes of a null hypothesis test: false negative, true negative, false positive, true positive. In this illustration, the hypothesis test is a one-sided threshold test.

spya-m09hdw: A null hypothesis test is a decision procedure which takes in some data, and outputs either or . If it outputs , it is usually stated as "there is a statistically significant effect" or "the null hypothesis is rejected".

spya-v94yfb: Often, the statistical test is a (one-sided) threshold test, which is structured as follows:

spya-xwz6wm: Gather data .

spya-g90jq8: Compute a test statistic for the data.

spya-x0wutf: Compare the test statistic against a critical value/threshold . If , then output , else, output .

spya-gva0r9: A two-sided threshold test is similar, but with two thresholds, such that it outputs if either or

spya-mhwjtq: There are 4 possible outcomes of a null hypothesis test: false negative, true negative, false positive, true positive. A false negative means that is true, but the test outcome is ; a true negative means that is true, and the test outcome is , etc.

spya-rf6fau: Probability to reject Probability to not reject If is True α 1-α If is True 1-β (power) β

spya-snscum: Interaction between sample size, effect size, and statistical power. Distributions of sample means under the null (θ=0) and alternative hypotheses are shown. The shaded red area represents significance (α), held constant at 0.05, while the shaded green area represents statistical power (1-β). As the sample size increases, the distributions narrow, leading to clearer separation between the hypotheses and higher power. Similarly, a larger effect size increases the distance between the distributions, resulting in greater power.

spya-m4dued: Significance level, false positive rate, or the alpha level, is the probability of finding the alternative to be true when the null hypothesis is true:For example, when the test is a one-sided threshold test, then where means "the data is sampled from ".

spya-sg0nmn: Statistical power, true positive rate, is the probability of finding the alternative to be true when the alternative hypothesis is true:where is also called the false negative rate. For example, when the test is a one-sided threshold test, then .

spya-vzfkh8: Given a statistical test and a data set , the corresponding p-value is the probability that the test statistic is at least as extreme, conditional on . For example, for a one-sided threshold test, If the null hypothesis is true, then the p-value is distributed uniformly on . Otherwise, it is typically peaked at and roughly exponential, though the precise shape of the p-value distribution depends on what the alternative hypothesis is.[24][25]

spya-bnzb3f: Because the p-values are distributed uniformly on under the null hypothesis, researchers can set any significance level by computing the p-value, then output if . This is usually stated as "the null hypothesis is rejected at significance level ", or "", such as "smoking is correlated with cancer (p < 0.001)".

spya-yru28f: The replication crisis dates to a number of events in the early 2010s. Felipe Romero identified four precursors to the crisis:[26]

spya-t3scy3: Social priming failures: In the early 2010s, two direct replication attempts failed to reproduce[27] results from social psychologist John Bargh's much-cited "elderly-walking" study (originally published in 1996).[28] This experiment was part of a series of three studies that had been widely cited throughout the years, was regularly taught in university courses, and had inspired many conceptual replications. These replication failures triggered intense disagreement between replication researchers and the original authors.[29] Notably, many of the conceptual replications of the original studies also failed to replicate in subsequent direct replications.[30][31][32][33]

spya-vux5b3: Experiments on extrasensory perception: Social psychologist Daryl Bem conducted a series of experiments supposedly providing evidence for the controversial phenomenon of extrasensory perception.[34] Bem faced substantial criticism of his study's methodology. Reanalysis of his data found no evidence for extrasensory perception.[35] The experiment also failed to replicate in subsequent direct replications.[36] According to Romero, what the community found particularly upsetting was that many of the flawed procedures and statistical tools used in Bem's studies were part of common research practice in psychology.

spya-yj72uc: Biomedical replication failures: Scientists from biotech companies Amgen and Bayer Healthcare reported alarmingly low replication rates (11–20%) of landmark findings in preclinical oncological research.[37]

spya-t3us9w: P-hacking studies and questionable research practices: Since the late 2000s, a number of studies in metascience showed how commonly adopted practices in many scientific fields, such as exploiting the flexibility of the process of data collection and reporting, could greatly increase the probability of false positive results.[38][39][40] These studies suggested how a significant proportion of published literature in several scientific fields could be nonreplicable research.

spya-dg8j93: This series of events generated a great deal of skepticism about the validity of existing research in light of widespread methodological flaws and failures to replicate findings. This led prominent scholars to declare a "crisis of confidence" in psychology and other fields,[41] and the ensuing situation came to be known as the "replication crisis".

spya-z3zj97: Although the beginning of the replication crisis can be traced to the early 2010s, some authors point out that concerns about replicability and research practices in the social sciences had been expressed much earlier. Romero notes that authors voiced concerns about the lack of direct replications in psychological research in the late 1960s and early 1970s.[42][43] He also writes that certain studies in the 1990s were already reporting that journal editors and reviewers are generally biased against publishing replication studies.[44][45]

spya-nq8y2f: In the social sciences, the blog Data Colada (whose three authors coined the term "p-hacking" in a 2014 paper) has been credited with contributing to the start of the replication crisis.[46][47][48]

spya-ytj90k: University of Virginia professor and cognitive psychologist Barbara Spellman has written that many criticisms of research practices and concerns about replicability of research are not new.[49][50] She reports that between the late 1950s and the 1990s, scholars were already expressing concerns about a possible crisis of replication,[51] a suspiciously high rate of positive findings,[52] questionable research practices,[53] the effects of publication bias,[54] issues with statistical power,[55][56] and bad standards of reporting.[51]

spya-q6hdur: Spellman also identifies reasons that the reiteration of these criticisms and concerns in recent years led to a full-blown crisis and challenges to the status quo. First, technological improvements facilitated conducting and disseminating replication studies, and analyzing large swaths of literature for systemic problems. Second, the research community's increasing size and diversity made the work of established members more easily scrutinized by other community members unfamiliar with them. According to Spellman, these factors, coupled with increasingly limited resources and misaligned incentives for doing scientific work, led to a crisis in psychology and other fields.[49]

spya-u3tg84: According to Andrew Gelman,[57] the works of Paul Meehl, Jacob Cohen, and Tversky and Kahneman in the 1960s-70s were early warnings of replication crisis. In discussing the origins of the problem, Kahneman himself noted historical precedents in subliminal perception and dissonance reduction replication failures.[58]

spya-h7qg2e: It had been repeatedly pointed out since 1962[55] that most psychological studies have low power (true positive rate), but low power persisted for 50 years, indicating a structural and persistent problem in psychological research.[59][60]

spya-ut47ry: Several factors have combined to put psychology at the center of the conversation.[61][62] Some areas of psychology once considered solid, such as social priming and ego depletion,[63] have come under increased scrutiny due to failed replications.[64] Much of the focus has been on social psychology,[65] although other areas of psychology such as clinical psychology,[66][67][68] developmental psychology,[69][70][71] and educational research have also been implicated.[72][73][74][75][76]

spya-bha57y: In August 2015, the first open empirical study of reproducibility in psychology was published, called The Reproducibility Project: Psychology. Coordinated by psychologist Brian Nosek, researchers redid 100 studies in psychological science from three high-ranking psychology journals (Journal of Personality and Social Psychology, Journal of Experimental Psychology: Learning, Memory, and Cognition, and Psychological Science). Of 97 original studies with significant effects, 36% replicated successfully (p value below 0.05), with effect sizes averaging half the original magnitude.[11] Among non-replications, 25% directly contradicted the original while 49% were inconclusive due to underpowered designs. The same paper examined the reproducibility rates and effect sizes by journal and discipline. Study replication rates were 23% for the Journal of Personality and Social Psychology, 48% for Journal of Experimental Psychology: Learning, Memory, and Cognition, and 38% for Psychological Science. Studies in the field of cognitive psychology had a higher replication rate (50%) than studies in the field of social psychology (25%).[77] This inconclusiveness reflected inadequate statistical power: replication samples were approximately 40% the size of the originals.[78]

spya-vqgtc4: A study published in 2018 in Nature Human Behaviour replicated 21 social and behavioral science papers from Nature and Science, finding that only about 62% could successfully reproduce original results.[79][80]

spya-g7w0hc: Similarly, in a study conducted under the auspices of the Center for Open Science, a team of 186 researchers from 60 laboratories (representing 36 nationalities from six continents) conducted replications of 28 classic and contemporary findings in psychology.[81][82] The study's focus was not only whether the original papers' findings replicated but also the extent to which findings varied as a function of variations in samples and contexts. Overall, 50% of findings failed to replicate despite large sample sizes. When findings did replicate, they consistently replicated across most samples. When they failed, they consistently failed across contexts, suggesting contextual sensitivity was not the primary driver of replication failures. This evidence is inconsistent with a proposed explanation that failures to replicate in psychology are likely due to changes in the sample between the original and replication study.[82]

spya-ekg3fe: Results of a 2022 study suggest that many earlier brain–phenotype studies ("brain-wide association studies" (BWAS)) produced invalid conclusions as the replication of such studies requires samples from thousands of individuals due to small effect sizes.[83][84]

spya-d8g53k: Results from The Reproducibility Project: Cancer Biology suggest most studies of the cancer research sector may not be replicable.

spya-esjmns: Of 49 medical studies from 1990 to 2003 with more than 1000 citations, 92% found that the studied therapies were effective. Of these studies, 16% were contradicted by subsequent studies, 16% had found stronger effects than did subsequent studies, 44% were replicated, and 24% remained largely unchallenged.[85] A 2011 analysis by researchers with pharmaceutical company Bayer found that, at most, a quarter of Bayer's in-house findings replicated the original results.[86] But the analysis of Bayer's results found that the results that did replicate could often be successfully used for clinical applications.[87]

spya-k59a2x: In a 2012 paper, C. Glenn Begley, a biotech consultant working at Amgen, and Lee Ellis, a medical researcher at the University of Texas, found that only 11% of 53 pre-clinical cancer studies had replications that could confirm conclusions from the original studies.[37] In late 2021, The Reproducibility Project: Cancer Biology examined 53 top papers about cancer published between 2010 and 2012 and showed that among studies that provided sufficient information to be redone, the effect sizes were 85% smaller on average than the original findings.[88][89] A survey of cancer researchers found that half of them had been unable to reproduce a published result.[90] Another report estimated that almost half of randomized controlled trials contained flawed data (based on the analysis of anonymized individual participant data (IPD) from more than 150 trials).[91]

spya-acfh3t: In other disciplines

spya-z9kxy3: [edit]

spya-t5mxxc: In nutrition science

spya-z76bt2: [edit]

spya-d977mu: In nutrition science, for most food ingredients, there were studies that found that the ingredient has an effect on cancer risk. Specifically, out of a random sample of 50 ingredients from a cookbook, 80% had articles reporting on their cancer risk. Statistical significance decreased for meta-analyses.[92]

spya-s2xfzn: Economics has lagged behind other social sciences and psychology in its attempts to assess replication rates and increase the number of studies that attempt replication.[12] A 2016 study in the journal Science replicated 18 experimental studies published in two leading economics journals, The American Economic Review and the Quarterly Journal of Economics, between 2011 and 2014. It found that approximately 61% of studies successfully replicated, though the replicated effect sizes were only 66% of the original reported effect sizes on average, suggesting that the original studies' effect sizes were inflated.[93][94][95] About 20% of studies published in The American Economic Review are contradicted by other studies despite relying on the same or similar data sets.[96] A study of empirical findings in the Strategic Management Journal found that about 30% of 27 retested articles showed statistically insignificant results for previously significant findings, whereas about 4% showed statistically significant results for previously insignificant findings.[97]

spya-ac3f22: In water resource management

spya-xtbd9y: [edit]

spya-gvvmwj: A 2019 study in Scientific Data estimated with 95% confidence that of 1,989 articles on water resources and management published in 2017, study results might be reproduced for only 0.6% to 6.8%, largely because the articles did not provide sufficient information to allow for replication.[98]

spya-ypznph: In research on and with large language models

spya-bvr9j3: [edit]

spya-ch4h0b: The rapid adoption of large language models (LLMs) after 2022 introduced a distinct set of reproducibility concerns, affecting both research on LLMs and research that uses them as tools.[99] One difficulty is that empirical findings about how LLMs behave are often hard to reproduce. Commercial models are updated or retired without notice, their training data and weights are usually undisclosed, and their outputs can shift from one run to the next even when settings are held constant, so a result reported once may not hold when the same prompts are tried later. Researchers have warned that this combination of closed, fast-changing systems and sensitivity to small changes in prompt wording could produce a wave of findings that fail to replicate.[99] Reproducibility is also strained when LLMs are used as instruments within other fields. Reviews of machine learning research have found that many papers cannot be reproduced even in principle, because the code, data, exact hyperparameters, random seeds, or model versions go unreported, while reliance on proprietary models and datasets keeps others from verifying the results.[100][101]

spya-k47jy2: A recurring hazard across these studies is data leakage, in which information from the test set inadvertently enters training and inflates apparent performance; it has been singled out as a leading cause of irreproducible claims in machine-learning-based science.[102] A 2025 review of 640 papers that applied LLMs to software engineering tasks found persistent gaps in the availability of artefacts, the specification of computing environments, and documentation, and called the situation a reproducibility crisis within that subfield.[103]

spya-hsmjer: A further worry is that generative AI can corrupt the data on which behavioral research depends. Online participant pools such as Prolific and Amazon Mechanical Turk are widely used in psychology, but some participants now lean on chatbots to answer open-ended questions, producing fluent text that hides inattention and can distort experimental results. Analyzing keystroke records from three studies run on Prolific in 2025, one team estimated notable rates of AI-assisted responding and cautioned that this kind of contamination erodes statistical power and undermines the validity of crowdsourced studies.[104]

spya-v8ghsw: In response, researchers have begun developing reporting standards tailored to LLM-based work. In 2026, a large consensus group published a reporting checklist in Nature Human Behaviour, known as GUIDE-LLM, intended to improve the transparency, reproducibility, and ethical accountability of LLM-based research in the behavioral sciences. The checklist asks authors to document which models and versions they used, how prompts and parameters were chosen, and what steps were taken to guard against the instability and contamination problems described above, so that other researchers stand a better chance of reproducing the work.[105]

spya-fuynra: A 2016 survey by Nature on 1,576 researchers who took a brief online questionnaire on reproducibility found that more than 70% of researchers have tried and failed to reproduce another scientist's experiment results (including 87% of chemists, 77% of biologists, 69% of physicists and engineers, 67% of medical researchers, 64% of earth and environmental scientists, and 62% of all others), and more than half have failed to reproduce their own experiments. But fewer than 20% had been contacted by another researcher unable to reproduce their work. The survey found that fewer than 31% of researchers believe that failure to reproduce results means that the original result is probably wrong, although 52% agree that a significant replication crisis exists. Most researchers said they still trust the published literature.[5][106][107] In 2010, Fanelli (2010)[108] found that 91.5% of psychiatry/psychology studies confirmed the effects they were looking for, and concluded that the odds of this happening (a positive result) was around five times higher than in fields such as astronomy or geosciences. Fanelli argued that this is because researchers in "softer" sciences have fewer constraints to their conscious and unconscious biases.

spya-jn2qy3: Early analysis of result-blind peer review, which is less affected by publication bias, has estimated that 61% of result-blind studies in biomedicine and psychology have led to null results, in contrast to an estimated 5% to 20% in earlier research.[109]

spya-m3et6t: In 2021, a study conducted by University of California, San Diego found that papers that cannot be replicated are more likely to be cited.[110] Nonreplicable publications are often cited more even after a replication study is published.[111]

spya-b679yr: In 2026, the SCORE Project study of 3,900 social-science papers between 2009 and 2018 found that only about half the results could be replicated.[112][113]

spya-sy87zk: There are many proposed causes for the replication crisis.

spya-yza3w9: Historical and sociological causes

spya-x52rky: [edit]

spya-v697nj: The replication crisis may be triggered by the "generation of new data and scientific publications at an unprecedented rate" that leads to "desperation to publish or perish" and failure to adhere to good scientific practice.[114]

spya-ghwh8u: Predictions of an impending crisis in the quality-control mechanism of science can be traced back several decades. Derek de Solla Price—considered the father of scientometrics, the quantitative study of science—predicted in his 1963 book Little Science, Big Science that science could reach "senility" as a result of its own exponential growth.[115] Some present-day literature seems to vindicate this "overflow" prophecy, lamenting the decay in both attention and quality.[116][117]

spya-ktsjv4: Historian Philip Mirowski argues that the decline of scientific quality can be connected to its commodification, especially spurred by major corporations' profit-driven decision to outsource their research to universities and contract research organizations.[118]

spya-afzc0x: Social systems theory, as expounded in the work of German sociologist Niklas Luhmann, inspires a similar diagnosis. This theory holds that each system, such as economy, science, religion, and media, communicates using its own code: true and false for science, profit and loss for the economy, news and no-news for the media, and so on.[119][120] According to some sociologists, science's mediatization,[121] commodification,[118] and politicization,[121][122] as a result of the structural coupling among systems, have led to a confusion of the original system codes.

spya-d040tg: Problems with the publication system in science

spya-b5ds50: [edit]

spya-y782zn: Publication bias—the tendency to publish only positive, significant results—creates the "file drawer effect", where negative results remain unpublished.[a] This produces misleading literature and biased meta-analyses.[26] Only a very small proportion of academic journals in psychology and neurosciences explicitly welcomed submissions of replication studies in their aim and scope or instructions to authors.[123][124] This does not encourage reporting on, or even attempts to perform, replication studies. Among 1,576 researchers Nature surveyed in 2016, only a minority had ever attempted to publish a replication, and several respondents who had published failed replications noted that editors and reviewers demanded that they play down comparisons with the original studies.[5][106] An analysis of 4,270 empirical studies in 18 business journals from 1970 to 1991 reported that less than 10% of accounting, economics, and finance articles and 5% of management and marketing articles were replication studies.[93][125] Publication bias is augmented by the pressure to publish and the author's own confirmation bias,[b] and is an inherent hazard in the field, requiring a certain degree of skepticism on the part of readers.[40]

spya-f76az5: When publication bias is considered along with the fact that a majority of tested hypotheses might be false a priori, it is plausible that a considerable proportion of research findings might be false positives, as shown by metascientist John Ioannidis.[1] In turn, a high proportion of false positives in the published literature can explain why many findings are nonreproducible.[26]

spya-av0n2t: Another publication bias is that studies that do not reject the null hypothesis are scrutinized asymmetrically. For example, they are likely to be rejected as being difficult to interpret or having a Type II error. Studies that do reject the null hypothesis are not likely to be rejected for those reasons.[127]

spya-asmt0d: In popular media, there is another element of publication bias: the desire to make research accessible to the public led to oversimplification and exaggeration of findings, creating unrealistic expectations and amplifying the impact of non-replications. In contrast, null results and failures to replicate tend to go unreported. This explanation may apply to power posing's replication crisis.[128]

spya-xxd5as: Mathematical errors

spya-mb7cxf: [edit]

spya-wahvbn: Even high-impact journals have a significant fraction of mathematical errors in their use of statistics. For example, 11% of statistical results published in Nature and BMJ in 2001 are "incongruent", meaning that the reported p-value is mathematically different from what it should be if it were correctly calculated from the reported test statistic. These errors were likely from typesetting, rounding, and transcription errors.[129]

spya-mtsaxw: Among 157 neuroscience papers published in five top-ranking journals that attempt to show that two experimental effects are different, 78 erroneously tested instead for whether one effect is significant while the other is not, and 79 correctly tested for whether their difference is significantly different from 0.[130]

spya-h2nvfj: "Publish or perish" culture

spya-unp0ay: [edit]

spya-cw2g6v: Academic "publish or perish" culture exacerbates publication bias. Intense pressure to publish in recognized journals, driven by hypercompetitive environments and bibliometric career evaluations, incentivizes researchers to prioritize publishable results over validity.[131] According to Fanelli, this pushes scientists to employ a number of strategies aimed at making results "publishable".[132] In the context of publication bias, this can mean adopting behaviors aimed at making results positive or statistically significant, often at the expense of their validity.[131]

spya-huxt52: According to Center for Open Science founder Brian Nosek and his colleagues, "publish or perish" culture created a situation whereby the goals and values of single scientists (e.g., publishability) are not aligned with the general goals of science (e.g., pursuing scientific truth). This is detrimental to the validity of published findings.[133]

spya-jk4f5n: Philosopher Brian D. Earp and psychologist Jim A. C. Everett argue that, although replication is in the best interests of academics and researchers as a group, features of academic psychological culture discourage replication by individual researchers. They argue that performing replications can be time-consuming, and take away resources from projects that reflect the researcher's original thinking. They are harder to publish, largely because they are unoriginal, and even when they can be published they are unlikely to be viewed as major contributions to the field. Replications "bring less recognition and reward, including grant money, to their authors".[134]

spya-ys59mk: In his 1971 book Scientific Knowledge and Its Social Problems,[135] philosopher and historian of science Jerome R. Ravetz predicted that science—in its progression from "little" science composed of isolated communities of researchers to "big" science or "techno-science"—would suffer major problems in its internal system of quality control. He recognized that the incentive structure for modern scientists could become dysfunctional, creating perverse incentives to publish any findings, however dubious. According to Ravetz, quality in science is maintained only when there is a community of scholars, linked by a set of shared norms and standards, who are willing and able to hold each other accountable.

spya-wjstmr: Standards of reporting

spya-vdmrak: [edit]

spya-gjx6ut: Certain publishing practices also make it difficult to conduct replications and to monitor the severity of the reproducibility crisis, for articles often come with insufficient descriptions for other scholars to reproduce the study. The Reproducibility Project: Cancer Biology showed that of 193 experiments from 53 top papers about cancer published between 2010 and 2012, only 50 experiments from 23 papers have authors who provided enough information for researchers to redo the studies, sometimes with modifications. None of the 193 papers examined had its experimental protocols fully described and replicating 70% of experiments required asking for key reagents.[88][89] The aforementioned study of empirical findings in the Strategic Management Journal found that 70% of 88 articles could not be replicated due to a lack of sufficient information for data or procedures.[93][97] In water resources and management, most of 1,987 articles published in 2017 were not replicable because of a lack of available information shared online.[98] In studies of event-related potentials, only two-thirds the information needed to replicate a study were reported in a sample of 150 studies, highlighting that there are substantial gaps in reporting.[136]

spya-nbztjn: By the Duhem-Quine thesis, scientific results are interpreted by both a substantive theory and a theory of instruments. For example, astronomical observations depend both on the theory of astronomical objects and the theory of telescopes. A large amount of non-replicable research might accumulate if there is a bias of the following kind: faced with a null result, a scientist prefers to treat the data as saying the instrument is insufficient; faced with a non-null result, a scientist prefers to accept the instrument as good, and treat the data as saying something about the substantive theory.[137]

spya-ftd2ng: Smaldino and McElreath[60] proposed a simple model for the cultural evolution of scientific practice. Each lab randomly decides to produce novel research or replication research, at different fixed levels of false positive rate, true positive rate, replication rate, and productivity (its "traits"). A lab might use more "effort", making the ROC curve more convex but decreasing productivity. A lab accumulates a score over its lifetime that increases with publications and decreases when another lab fails to replicate its results. At regular intervals, a random lab "dies" and another "reproduces" a child lab with a similar trait as its parent. Labs with higher scores are more likely to reproduce. Under certain parameter settings, the population of labs converge to maximum productivity even at the price of very high false positive rates.

spya-bfx638: Questionable research practices

spya-t4zm6g: [edit]

spya-kqvxfb: Questionable research practices are behaviors that exploit researcher degrees of freedom (researcher DF)—choices in study design, data analysis, or reporting—to inflate false positive rates and undermine reproducibility.[138][139][40] Examples of questionable research practices include data dredging,[139][140][39][c] selective reporting of only statistically significant findings,[138][139][140][39][d] HARKing (hypothesizing after results are known),[139][140][39][e] PARKing (pre-registering after results are known), and conducting inappropriate power analyses.[142]

spya-j8h7w7: Researchers' degrees of freedom occur at many stages: hypothesis formulation, design of experiments, data collection and analysis, and reporting of research.[139] Analyses of identical datasets by different teams, even absent incentives for significant findings, often yield divergent results in disciplines such as psychology, linguistics, and ecology.[143][144][145] This is because research design and data analysis entail numerous decisions that are not sufficiently constrained by a field's best practices and statistical methodologies. As a result, researcher DF can lead to situations where some failed replication attempts use a different, yet plausible, research design or statistical analysis; such studies do not necessarily undermine previous findings.[146] Multiverse analysis, a method that makes inferences based on all plausible data-processing pipelines, provides a solution to the problem of analytical flexibility.[147] Sensitivity analysis explores modelling specifications to create a comprehensive view of how different analytical choices influence outcomes.[148] Collaborative approaches can be used to compensate for questionable research practices. In multianalyst approaches, different analysts conduct different analyses to address questions.[149][150][144] This collaborative validation fosters intellectual honesty and exposes questionable research practices, leading to more reliable and robust scientific conclusions.[151]

spya-k74qem: Irreproducible medical studies commonly share these characteristics: investigators not being blinded to the experimental versus the control arms; failure to repeat experiments; lack of positive and negative controls; failing to report all the data; inappropriate use of statistical tests; and use of reagents that were not appropriately validated.[152]

spya-dyt8c2: In machine learning research, a range of questionable practices have emerged due to intense pressure to achieve state-of-the-art benchmark results. Common evaluation questionable practices include "benchmark overfitting" by repeatedly tuning hyperparameters on held-out test sets, selectively reporting the best of multiple random seeds or experimental runs, and "metric hacking" through unreported post hoc decisions such as choice of tokenization or evaluation scripts that inflate scores.[153] Researchers also frequently cherry-pick tasks or datasets where their proposed model outperforms baselines, omit negative or lower-performing results, and obscure compute budgets to present energy-intensive methods as efficient. Such practices can give a misleading impression of model progress and hinder fair comparisons across methods. Moreover, many machine learning studies suffer from irreproducible research practices that impede replication and auditing. Key issues include incomplete disclosure of training details—such as dataset preprocessing, exact model hyperparameters, random seeds, and hardware configurations—and failure to release code or data used in experiments. Researchers often omit versions of dependencies or rely on proprietary datasets, preventing others from reproducing results. Even for public benchmarks, subtle "data leakage" through inadvertent inclusion of test data in training splits remains widespread. Together, these questionable practices undermine the validity and credibility of reported findings in machine learning and pose substantial barriers to cumulative scientific progress.[153]

spya-msmx4h: In October 2024, Communications of the ACM published a peer-reviewed critique[154] of a 2021 Nature paper[155] by researchers from Google. The critique described "a smorgasbord of questionable practices in ML, including irreproducible research practices, multiple variants of cherry-picking, misreporting, and likely data contamination (leakage)" with a reference to Leech et al.[153] The criticized paper claimed progress in fast chip design using reinforcement learning, but supported the claim with experiments on proprietary training and test datasets whose statistical details were undisclosed, preventing independent reproduction outside the company.[156] Specific execution times for both the proposed approach and prior techniques on individual test cases were not disclosed in the paper, but later studies found that Google's method ran orders of magnitude more slowly than the Cadence Design Systems tools available at the same time. The critique cross-checked such studies[157] and highlighted such questionable practices in the Nature paper as (i) selective reporting of results on only a subset of benchmarks, (ii) unfavorable comparisons to weaker baseline methods, (iii) use of inconsistent evaluation metrics, and (iv) undisclosed use of commercial software data that was only admitted years after the original work[155] and multiple rounds of criticism.[158][159][160] Additionally, the research may have suffered from data leakage, where separation of training and testing data could not be verified using published data, considered a significant flaw in experimental design.[154] After it rebranded as AlphaChip in 2024, multiple researchers voiced skepticism about the Google approach, as well as the data and source code released. The questionable research practices and independent researchers' inability to reproduce AlphaChip performance underscored the need for transparent, reproducible benchmarks and rigorous evaluation standards to ensure genuine progress in the field of electronic design automation.[161][162]

spya-scx28p: According to IU professor Ernest O'Boyle and psychologist Martin Götz, around 50% of researchers surveyed across various studies admitted engaging in HARKing.[163] In a survey of 2,000 psychologists by behavioral scientist Leslie K. John and colleagues, around 94% of psychologists admitted having employed at least one questionable research practice. More specifically, 63% admitted failing to report all of a study's dependent measures, 28% to report all of a study's conditions, and 46% to selectively reporting studies that produced the desired pattern of results. In addition, 56% admitted having collected more data after having inspected already collected data, and 16% to having stopped data collection because the desired result was already visible.[39] According to biotechnology researcher J. Leslie Glick's estimate in 1992, 10% to 20% of research and development studies involved either questionable research practices or outright fraud.[164] The methodology used to estimate questionable research practices has been contested, and more recent studies suggested lower prevalence rates on average.[165]

spya-f44um7: Questionable research practices are considered a separate category from more explicit violations of scientific integrity, such as data falsification.[138][139] A 2009 meta-analysis found that 2% of scientists across fields admitted falsifying studies at least once and 14% admitted knowing someone who did. Such misconduct was, according to one study, reported more frequently by medical researchers than by others.[166] Prominent examples (see also List of scientific misconduct incidents) include scientific fraud by social psychologist Diederik Stapel,[167][13] cognitive psychologist Marc Hauser, and social psychologist Lawrence Sanna.[13] In 2018, some researchers viewed scientific fraud as uncommon.[13] A 2025 Northwestern University study found that "the publication of fraudulent science is outpacing the growth rate of legitimate scientific publications". The study also discovered broad networks of organized scientific fraudsters.[168][169]

spya-a8tr3x: In March 2024, Harvard Business School's investigative committee, after reviewing a nearly 1,300-page report unsealed during Professor Francesca Gino's $25 million lawsuit against Harvard and the Data Colada bloggers, found that Gino "committed research misconduct intentionally, knowingly, or recklessly" by falsifying data in four published studies.[170] The report documented that Gino had altered participant responses—including changing 104 moral-impurity ratings (flipping low values to high in one experimental condition and vice versa in another) and manipulating four networking-intentions items, for a total of 168 modified observations—to make the data conform to her hypotheses.[171] She also engaged in selective reporting by publishing only the "Posted" dataset while omitting the original Qualtrics archives and misrepresented the provenance of her data by attributing discrepancies to alleged third-party tampering rather than to deliberate changes by her research team.[171] In June 2023 Gino was placed on unpaid administrative leave, and in May 2025 Harvard revoked her tenure—the first such action in roughly 80 years—citing egregious violations of academic integrity.[172]

spya-p7pun6: Low statistical power

spya-ymq643: [edit]

spya-hdubm3: Low statistical power hinders replication for three reasons: (1) low-power replications have reduced ability to detect true effects, (2) low-power original studies produce biased effect size estimates leading to undersized replications, and (3) low-power original studies yield results unlikely to reflect true effects.[14]

spya-x7d5t5: Mathematically, the probability of replicating a previous publication that rejected a null hypothesis in favor of an alternative is assuming significance is less than power. Thus, low power implies low probability of replication, regardless of how the previous publication was designed, and regardless of which hypothesis is really true.[78]

spya-zvfgme: Stanley and colleagues estimated the average statistical power of psychological literature by analyzing data from 200 meta-analyses. They found that on average, psychology studies have between 33.1% and 36.4% statistical power. These values are quite low compared to the 80% considered adequate statistical power for an experiment. Across the 200 meta-analyses, the median of studies with adequate statistical power was between 7.7% and 9.1%, implying that a positive result would replicate with probability less than 10%, regardless of whether the positive result was a true positive or a false positive.[14]

spya-m66r6m: The statistical power of neuroscience studies is quite low. The estimated statistical power of fMRI research is between .08 and .31,[173] and that of studies of event-related potentials was estimated as .72‒.98 for large effect sizes, .35‒.73 for medium effects, and .10‒.18 for small effects.[136]

spya-efs6mn: In a study published in Nature, psychologist Katherine Button and colleagues conducted a similar study with 49 meta-analyses in neuroscience, estimating a median statistical power of 21%.[174] Meta-scientist John Ioannidis and colleagues computed an estimate of average power for empirical economic research, finding a median power of 18% based on literature drawing upon 6.700 studies.[175] In light of these results, it is plausible that a major reason for widespread failures to replicate in several scientific fields might be very low statistical power on average.

spya-fgq7vr: The same statistical test with the same significance level will have lower statistical power if the effect size is small under the alternative hypothesis. Complex inheritable traits are typically correlated with a large number of genes, each of small effect size, so high power requires a large sample size. In particular, many results from the candidate gene literature suffered from small effect sizes and small sample sizes and would not replicate. More data from genome-wide association studies (GWAS) come close to solving this problem.[176][177] As a numeric example, most genes associated with schizophrenia risk have low effect size (genotypic relative risk, GRR). A statistical study with 1000 cases and 1000 controls has 0.03% power for a gene with GRR = 1.15, which is already large for schizophrenia. In contrast, the largest GWAS to date has ~100% power for it.[178]

spya-nqwfh4: Positive effect size bias

spya-sv83tx: [edit]

spya-r42sms: Even when the study replicates, the replication typically has a smaller effect size. Underpowered[clarification needed] studies have a large effect size bias.[179]

spya-r5jmvb: Distribution of statistically significant estimates of the regression factor in a linear model in the presence of added error. When the sample size is small, adding noise overestimates the regression factor about 50% of the times. When the sample size is small, it consistently underestimates. Figure appeared in.[180]

spya-hw9d4p: In studies that statistically estimate a regression factor, such as the in , when the dataset is large, noise tends to cause the regression factor to be underestimated, but when the dataset is small, noise tends to cause the regression factor to be overestimated.[180]

spya-z2xbqp: Problems of meta-analysis

spya-s3h7cm: [edit]

spya-th90w0: Meta-analyses have their own methodological problems and disputes, which leads to rejection of the meta-analytic method by researchers whose theory is challenged by meta-analysis.[127]

spya-n75efu: Rosenthal proposed the "fail-safe number" (FSN)[54] to avoid the publication bias against null results. It is defined as follows: Suppose the null hypothesis is true; how many publications would be required to make the current result indistinguishable from the null hypothesis?

spya-q6s08t: Rosenthal's point is that certain effect sizes are large enough, such that even if there is a total publication bias against null results (the "file drawer problem"), the number of unpublished null results would be impossibly large to swamp out the effect size. Thus, the effect size must be statistically significant even after accounting for unpublished null results.

spya-kkp77d: One objection to the FSN is that it is calculated as if unpublished results are unbiased samples from the null hypothesis. But if the file drawer problem is true, then unpublished results would have effect sizes concentrated around 0. Thus fewer unpublished null results would be necessary to swap out the effect size, and so the FSN is an overestimate.[127]

spya-d29jpu: Another problem with meta-analysis is that bad studies are "infectious" in the sense that one bad study might cause the entire meta-analysis to overestimate statistical significance.[78]

spya-qsad7n: Various statistical methods can be applied to make the p-value appear smaller than it really is. This need not be malicious, as moderately flexible data analysis, routine in research, can increase the false-positive rate to above 60%.[40]

spya-zjcy3c: For example, if one collects some data, applies several different significance tests to it, and publishes only the one that happens to have a p-value less than 0.05, then the total p-value for "at least one significance test reaches p < 0.05" can be much larger than 0.05, because even if the null hypothesis were true, the probability that one out of many significance tests is extreme is not itself extreme.

spya-umu7gf: Typically, a statistical study has multiple steps, with several choices at each step, such as during data collection, outlier rejection, choice of test statistic, choice of one-tailed or two-tailed test, etc. These choices in the "garden of forking paths" multiply, creating many "researcher degrees of freedom". The effect is similar to the file-drawer problem, as the paths not taken are not published.[181]

spya-jp3k7e: Consider a simple illustration. Suppose the null hypothesis is true, and we have 20 possible significance tests to apply to the dataset. Also suppose the outcomes to the significance tests are independent. By definition of "significance", each test has probability 0.05 to pass with significance level 0.05. The probability that at least 1 out of 20 is significant is, by assumption of independence, .[182]

spya-gnxfb0: Another possibility is the multiple comparisons problem. In 2009, it was twice noted that fMRI studies had a suspicious number of positive results with large effect sizes, more than would be expected since the studies have low power (one example[183] had only 13 subjects). It pointed out that over half of the studies would test for correlation between a phenomenon and individual fMRI voxels, and only report on voxels exceeding chosen thresholds.[184]

spya-dz88bh: The figure shows the change in p-values computed from a t-test as the sample size increases, and how early stopping can allow for p-hacking even when the null hypothesis is exactly true. Data is drawn from two identical normal distributions, . For each sample size , ranging from 5 to , a t-test is performed on the first samples from each distribution, and the resulting p-value is plotted. The red dashed line indicates the commonly used significance level of 0.05. If the data collection or analysis were to stop at a point where the p-value happened to fall below the significance level, a spurious statistically significant difference could be reported.

spya-kf0t33: Optional stopping is a practice where one collects data until some stopping criterion is reached. Though a valid procedure, it is easily misused. The problem is that p-value of an optionally stopped statistical test is larger than it seems. Intuitively, this is because the p-value is supposed to be the sum of all events at least as rare as what is observed. With optional stopping, there are even rarer events that are difficult to account for, i.e. not triggering the optional stopping rule, and collecting even more data before stopping. Neglecting these events leads to a p-value that is too low. In fact, if the null hypothesis is true, any significance level can be reached if one is allowed to keep collecting data and stop when the desired p-value (calculated as if one has always been planning to collect exactly this much data) is obtained.[185] For a concrete example of testing for a fair coin, see p-value#optional stopping.

spya-uxuzz0: More succinctly, the proper calculation of p-value requires accounting for counterfactuals, that is, what the experimenter could have done in reaction to data that might have been. Accounting for what might have been is hard even for honest researchers.[185] One benefit of preregistration is to account for all counterfactuals, allowing the p-value to be calculated correctly.[186]

spya-xty2jr: The problem of early stopping is not just limited to researcher misconduct. There is often pressure to stop early if the cost of collecting data is high. Some animal ethics boards even mandate early stopping if the study obtains a significant result midway.[182]

spya-nwgxra: Such practices are widespread in psychology. In a 2012 survey, 56% of psychologists admitted to early stopping, 46% to only reporting analyses that "worked", and 38% to post hoc exclusion, that is, removing some data after analysis was already performed on the data before reanalyzing the remaining data (often on the premise of "outlier removal").[39]

spya-ngbkx2: Statistical heterogeneity

spya-t4f77m: [edit]

spya-ddw4ya: As also reported by Stanley and colleagues, a further reason studies might fail to replicate is high heterogeneity of the to-be-replicated effects. Heterogeneity (variance in research findings due to multiple true effect sizes rather than one) is measured by the I-squared statistic, which quantifies unexplained variation in effect sizes across studies.[14][187] This variation can be due to differences in experimental methods, populations, cohorts, and statistical methods between replication studies. Heterogeneity poses a challenge to studies attempting to replicate previously found effect sizes. When heterogeneity is high, subsequent replications have a high probability of finding an effect size radically different than that of the original study.[f]

spya-r23rs2: Importantly, significant levels of heterogeneity are also found in direct/exact replications of a study. Stanley and colleagues discuss this while reporting a study by quantitative behavioral scientist Richard Klein and colleagues, where the authors attempted to replicate 15 psychological effects across 36 different sites in Europe and the U.S. In the study, Klein and colleagues found significant amounts of heterogeneity in 8 out of 16 effects (I-squared = 23% to 91%). Importantly, while the replication sites intentionally differed on a variety of characteristics, such differences could account for very little heterogeneity . According to Stanley and colleagues, this suggested that heterogeneity could have been a genuine characteristic of the phenomena being investigated. For instance, phenomena might be influenced by so-called "hidden moderators" – relevant factors that were previously not understood to be important in the production of a certain effect.

spya-x02d6v: In their analysis of 200 meta-analyses of psychological effects, Stanley and colleagues found a median percent of heterogeneity of I-squared = 74%. According to the authors, this level of heterogeneity can be considered "huge". It is three times larger than the random sampling variance of effect sizes measured in their study. If considered along sampling error, heterogeneity yields a standard deviation from one study to the next even larger than the median effect size of the 200 meta-analyses they investigated.[g] The authors conclude that if replication is defined by a subsequent study finding a sufficiently similar effect size to the original, replication success is not likely even if replications have very large sample sizes. Importantly, this occurs even if replications are direct or exact since heterogeneity nonetheless remains relatively high in these cases.

spya-cdhqgt: Within economics, the replication crisis may be also exacerbated because econometric results are fragile:[188] using different but plausible estimation procedures or data preprocessing techniques can lead to conflicting results.[189][190][191]

spya-z4db8z: Context sensitivity

spya-a7fpjz: [edit]

spya-qn347b: New York University professor Jay Van Bavel and colleagues argue that a further reason findings are difficult to replicate is the sensitivity to context of certain psychological effects. On this view, failures to replicate might be explained by contextual differences between the original experiment and the replication, often called "hidden moderators".[192] Van Bavel and colleagues tested the influence of context sensitivity by reanalyzing the data of the widely cited Reproducibility Project carried out by the Open Science Collaboration.[11] They re-coded effects according to their sensitivity to contextual factors and then tested the relationship between context sensitivity and replication success in various regression models.

spya-audpsj: Context sensitivity was found to negatively correlate with replication success, such that higher ratings of context sensitivity were associated with lower probabilities of replicating an effect.[h] Importantly, context sensitivity significantly correlated with replication success even when adjusting for other factors considered important for reproducing results (e.g., effect size and sample size of original, statistical power of the replication, methodological similarity between original and replication).[i] In light of the results, the authors concluded that attempting a replication in a different time, place or with a different sample can significantly alter an experiment's results. Context sensitivity thus may be a reason certain effects fail to replicate in psychology.[192]

spya-pytr5c: Bayesian explanation

spya-dfgdk8: [edit]

spya-fhcf00: In the framework of Bayesian probability, by Bayes' theorem, rejecting the null hypothesis at significance level 5% does not mean that the posterior probability for the alternative hypothesis is 95%, and the posterior probability is also different from the probability of replication.[193][185] Consider a simplified case where there are only two hypotheses. Let the prior probability of the null hypothesis be , and the alternative . For a given statistical study, let its false positive rate (significance level) be , and true positive rate (power) be . For illustrative purposes, let significance level be 0.05 and power be 0.45 (underpowered).

spya-gn5b3a: Now, by Bayes' theorem, conditional on the statistical studying finding to be true, the posterior probability of actually being true is not , but

spya-eg9dm4: 

spya-jhpanr: and the probability of replicating the statistical study is which is also different from . In particular, for a fixed level of significance, the probability of replication increases with power, and prior probability for . If the prior probability for is small, then one would require a high power for replication.

spya-esjk29: For example, if the prior probability of the null hypothesis is , and the study found a positive result, then the posterior probability for is , and the replication probability is .

spya-h9wzrk: Problem with null hypothesis testing

spya-g6pvfw: [edit]

spya-cjt38s: Some argue that null hypothesis testing is itself inappropriate, especially in "soft sciences" like social psychology.[194][195]

spya-rzjbzy: As repeatedly observed by statisticians,[196] in complex systems, such as social psychology, "the null hypothesis is always false", or "everything is correlated". If so, then if the null hypothesis is not rejected, that does not show that the null hypothesis is true, but merely that it was a false negative, typically due to low power.[197] Low power is especially prevalent in subject areas where effect sizes are small and data is expensive to acquire, such as social psychology.[194][198]

spya-j0ubfk: Furthermore, when the null hypothesis is rejected, it might not be evidence for the substantial alternative hypothesis. In soft sciences, many hypotheses can predict a correlation between two variables. Thus, evidence against the null hypothesis "there is no correlation" is no evidence for one of the many alternative hypotheses that equally well predict "there is a correlation". Fisher developed the NHST for agronomy, where rejecting the null hypothesis is usually good proof of the alternative hypothesis, since there are not many of them. Rejecting the hypothesis "fertilizer does not help" is evidence for "fertilizer helps". But in psychology, there are many alternative hypotheses for every null hypothesis.[198][199]

spya-pknetn: In particular, when statistical studies on extrasensory perception reject the null hypothesis at extremely low p-value (as in the case of Daryl Bem), it does not imply the alternative hypothesis "ESP exists".[200] Far more likely is that there was a small (non-ESP) signal in the experiment setup that has been measured precisely.[201]

spya-ew7pwx: Paul Meehl noted that statistical hypothesis testing is used differently in "soft" psychology (personality, social, etc.) from physics. In physics, a theory makes a quantitative prediction and is tested by checking whether the prediction falls within the statistically measured interval. In soft psychology, a theory makes a directional prediction and is tested by checking whether the null hypothesis is rejected in the right direction. Consequently, improved experimental technique makes theories more likely to be falsified in physics but less likely to be falsified in soft psychology, as the null hypothesis is always false since any two variables are correlated by a "crud factor" of about 0.30. The net effect is an accumulation of theories that remain unfalsified, but with no empirical evidence for preferring one over the others.[22][199]

spya-dzsa7e: According to philosopher Alexander Bird, a possible reason for the low rates of replicability in certain scientific fields is that a majority of tested hypotheses are false a priori.[202] On this view, low rates of replicability could be consistent with quality science. Relatedly, the expectation that most findings should replicate would be misguided and, according to Bird, a form of base rate fallacy. Bird's argument works as follows. Assuming an ideal situation of a test of significance, whereby the probability of incorrectly rejecting the null hypothesis is 5% (i.e. Type I error) and the probability of correctly rejecting the null hypothesis is 80% (i.e. Power), in a context where a high proportion of tested hypotheses are false, it is conceivable that the number of false positives would be high compared to those of true positives.[202] For example, in a situation where only 10% of tested hypotheses are actually true, one can calculate that as many as 36% of results will be false positives.[j]

spya-jxfrbv: The claim that the falsity of most tested hypotheses can explain low rates of replicability is even more relevant when considering that the average power for statistical tests in certain fields might be much lower than 80%. For example, the proportion of false positives increases to a value between 55.2% and 57.6% when calculated with the estimates of an average power between 34.1% and 36.4% for psychology studies, as provided by Stanley and colleagues in their analysis of 200 meta-analyses in the field.[14] A high proportion of false positives would then result in many research findings being non-replicable.

spya-p6eutd: Bird notes that the claim that a majority of tested hypotheses are false a priori in certain scientific fields might be plausible given factors such as the complexity of the phenomena under investigation, the fact that theories are seldom undisputed, the "inferential distance" between theories and hypotheses, and the ease with which hypotheses can be generated. In this respect, the fields Bird takes as examples are clinical medicine, genetic and molecular epidemiology, and social psychology. This situation is radically different in fields where theories have outstanding empirical basis and hypotheses can be easily derived from theories (e.g., experimental physics).[202]

spya-wcf9y7: When effects are wrongly stated as relevant in the literature, failure to detect this by replication will lead to the canonization of such false facts.[203]

spya-x6vcuf: A 2021 study found that papers in leading general interest, psychology and economics journals with findings that could not be replicated tend to be cited more over time than reproducible research papers, likely because these results are surprising or interesting. The trend is not affected by publication of failed reproductions, after which only 12% of papers that cite the original research will mention the failed replication.[204][205] Further, experts are able to predict which studies will be replicable, leading the authors of the 2021 study, Marta Serra-Garcia and Uri Gneezy, to conclude that experts apply lower standards to interesting results when deciding whether to publish them.[205]

spya-qht6nk: Public awareness and perceptions

spya-nucety: [edit]

spya-am34t9: Concerns have been expressed within the scientific community that the general public may consider science less credible due to failed replications.[206] Research supporting this concern is sparse, but a nationally representative survey in Germany showed that more than 75% of Germans have not heard of replication failures in science.[207] The study also found that most Germans have positive perceptions of replication efforts: only 18% think that non-replicability shows that science cannot be trusted, while 65% think that replication research shows that science applies quality control, and 80% agree that errors and corrections are part of science.[207]

spya-rx27qq: Response in academia

spya-e3h2j2: [edit]

spya-t88q4a: With the replication crisis of psychology earning attention, Princeton University psychologist Susan Fiske drew controversy for speaking against critics of psychology for what she called bullying and undermining the science.[208][209][210][211] She called these unidentified "adversaries" names such as "methodological terrorist" and "self-appointed data police", saying that criticism of psychology should be expressed only in private or by contacting the journals.[208] Columbia University statistician and political scientist Andrew Gelman responded to Fiske, saying that she had found herself willing to tolerate the "dead paradigm" of faulty statistics and had refused to retract publications even when errors were pointed out.[208] He added that her tenure as editor had been abysmal and that a number of published papers she edited were found to be based on extremely weak statistics; one of Fiske's own published papers had a major statistical error and "impossible" conclusions.[208]

spya-n0zj55: Credibility revolution

spya-n8fw2c: [edit]

spya-qthy2u: Some researchers in psychology indicate that the replication crisis is a foundation for a "credibility revolution", where changes in standards by which psychological science are evaluated may include emphasizing transparency and openness, preregistering research projects, and replicating research with higher standards for evidence to improve the strength of scientific claims.[212] Such changes may diminish the productivity of individual researchers, but this effect could be avoided by data sharing and greater collaboration.[212]

spya-qfhrdu: Focus on the replication crisis has led to renewed efforts in psychology to retest important findings.[40][213] A 2013 special edition of the journal Social Psychology focused on replication studies.[12]

spya-peeeth: Standardization as well as (requiring) transparency of the used statistical and experimental methods have been proposed.[214] Careful documentation of the experimental set-up is considered crucial for replicability of experiments and various variables may not be documented and standardized such as animals' diets in animal studies.[215]

spya-dcd9k5: A 2016 article by John Ioannidis elaborated on "Why Most Clinical Research Is Not Useful".[216] Ioannidis describes what he views as some of the problems and calls for reform, characterizing certain points for medical research to be useful again; one example he makes is the need for medicine to be patient-centered (e.g. in the form of the Patient-Centered Outcomes Research Institute) instead of the current practice to mainly take care of "the needs of physicians, investigators, or sponsors".

spya-h32yv9: Reform in scientific publishing

spya-jp6erf: [edit]

spya-na9ke6: Metascience is the use of scientific methodology to study science itself. It seeks to increase the quality of scientific research while reducing waste. It is also known as "research on research" and "the science of science", as it uses research methods to study how research is done and where improvements can be made. Metascience is concerned with all fields of research and has been called "a bird's eye view of science."[217] In Ioannidis's words, "Science is the best thing that has happened to human beings ... but we can do it better."[218]

spya-q8mbr9: Meta-research continues to be conducted to identify the roots of the crisis and to address them. Methods of addressing the crisis include pre-registration of scientific studies and clinical trials as well as the founding of organizations such as CONSORT and the EQUATOR Network that issue guidelines for methodology and reporting. Efforts continue to reform the system of academic incentives, improve the peer review process, reduce the misuse of statistics, combat bias in scientific literature, and increase the overall quality and efficiency of the scientific process.

spya-bzdyqn: Presentation of methodology

spya-nvbpzb: [edit]

spya-cstzz5: Some authors have argued that the insufficient communication of experimental methods is a major contributor to the reproducibility crisis and that better reporting of experimental design and statistical analyses would improve the situation. These authors tend to plead for both a broad cultural change in the scientific community of how statistics are considered and a more coercive push from scientific journals and funding bodies.[219] But concerns have been raised about the potential for standards for transparency and replication to be misapplied to qualitative as well as quantitative studies.[220]

spya-epfeeh: Business and management journals that have introduced editorial policies on data accessibility, replication, and transparency include the Strategic Management Journal, the Journal of International Business Studies, and the Management and Organization Review.[93]

spya-wv05ca: Result-blind peer review

spya-u7djwh: [edit]

spya-pqp4ce: In response to concerns in psychology about publication bias and data dredging, more than 140 psychology journals have adopted result-blind peer review. In this approach, studies are accepted not on the basis of their findings and after the studies are completed, but before they are conducted and on the basis of the methodological rigor of their experimental designs, and the theoretical justifications for their statistical analysis techniques before data collection or analysis is done.[221] Early analysis of this procedure has estimated that 61% of result-blind studies have led to null results, in contrast to an estimated 5% to 20% in earlier research.[109] In addition, large-scale collaborations between researchers working in multiple labs in different countries that regularly make their data openly available for different researchers to assess have become much more common in psychology.[222]

spya-wraexy: Pre-registration of studies

spya-u46v89: [edit]

spya-neds6m: Scientific publishing has begun using pre-registration reports to address the replication crisis.[223][224] The registered report format requires authors to submit a description of the study methods and analyses prior to data collection. Once the method and analysis plan is vetted through peer-review, publication of the findings is provisionally guaranteed, based on whether the authors follow the proposed protocol. One goal of registered reports is to circumvent the publication bias toward significant findings that can lead to implementation of questionable research practices. Another is to encourage publication of studies with rigorous methods.

spya-d97yu8: The journal Psychological Science has encouraged the preregistration of studies and the reporting of effect sizes and confidence intervals.[225] The editor in chief also noted that the editorial staff will be asking for replication of studies with surprising findings from examinations using small sample sizes before allowing the manuscripts to be published.

spya-wtg89f: Metadata and digital tools for tracking replications

spya-mwja6s: [edit]

spya-uq4qqe: It has been suggested that "a simple way to check how often studies have been repeated, and whether or not the original findings are confirmed" is needed.[204] Categorizations and ratings of reproducibility at the study or results level, as well as addition of links to and rating of third-party confirmations, could be conducted by the peer-reviewers, the scientific journal, or by readers in combination with novel digital platforms or tools.

spya-pge7t0: Requiring smaller p-values

spya-c622pm: [edit]

spya-c9bf7m: Many publications require a p-value of p < 0.05 to claim statistical significance. The paper "Redefine statistical significance",[226] signed by a large number of scientists and mathematicians, proposes that in "fields where the threshold for defining statistical significance for new discoveries is p < 0.05, we propose a change to p < 0.005. This simple step would immediately improve the reproducibility of scientific research in many fields." Their rationale is that "a leading cause of non-reproducibility (is that the) statistical standards of evidence for claiming new discoveries in many fields of science are simply too low. Associating 'statistically significant' findings with p < 0.05 results in a high rate of false positives even in the absence of other experimental, procedural and reporting problems."[226]

spya-vxp8je: This call was subsequently criticised by another large group, who argued that "redefining" the threshold would not fix current problems, would lead to some new ones, and that in the end, all thresholds needed to be justified case-by-case instead of following general conventions.[227] A 2022 followup study examined these competing recommendations' practical impact. Despite high citation rates of both proposals, researchers found limited implementation of either the p < 0.005 threshold or the case-by-case justification approach in practice. This revealed what the authors called a "vicious cycle", in which scientists reject recommendations because they are not standard practice, while the recommendations fail to become standard practice because few scientists adopt them.[228]

spya-eejydp: Addressing misinterpretation of p-values

spya-u73dx8: [edit]

spya-eg8p4m: Although statisticians are unanimous that the use of "p < 0.05" as a standard for significance provides weaker evidence than is generally appreciated, there is a lack of unanimity about what should be done about it. Some have advocated that Bayesian methods should replace p-values. This has not happened on a wide scale, partly because it is complicated and partly because many users distrust the specification of prior distributions in the absence of hard data. A simplified version of the Bayesian argument, based on testing a point null hypothesis was suggested by pharmacologist David Colquhoun.[229][230] The logical problems of inductive inference were discussed in "The Problem with p-values" (2016).[231]

spya-raafdf: The hazards of reliance on p-values arises partly because even an observation of p = 0.001 is not necessarily strong evidence against the null hypothesis.[230] Despite the fact that the likelihood ratio in favor of the alternative hypothesis over the null is close to 100, if the hypothesis was implausible, with a prior probability of a real effect being 0.1, even the observation of p = 0.001 would have a false positive risk of 8 percent. It would still fail to reach the 5 percent level.

spya-d6muwy: It was recommended that the terms "significant" and "non-significant" should not be used.[230] p-values and confidence intervals should still be specified, but they should be accompanied by an indication of the false-positive risk. It was suggested that the best way to do this is to calculate the prior probability that would be necessary to believe in order to achieve a false positive risk of a certain level, such as 5%. The calculations can be done with various computer software.[230][232] This reverse Bayesian approach, which physicist Robert Matthews suggested in 2001,[233] is one way to avoid the problem that the prior probability is rarely known.

spya-vnwm97: Encouraging larger sample sizes

spya-xbjrcx: [edit]

spya-q8j4xp: To improve the quality of replications, larger sample sizes than those used in the original study are often needed.[234] Larger sample sizes are needed because estimates of effect sizes in published work are often exaggerated due to publication bias and large sampling variability associated with small sample sizes in an original study.[235][236][237] Further, using significance thresholds usually leads to inflated effects, because particularly with small sample sizes, only the largest effects will become significant.[195]

spya-ctx94n: One common statistical problem is overfitting, that is, when researchers fit a regression model over a large number of variables but a small number of data points. For example, a typical fMRI study of emotion, personality, and social cognition has fewer than 100 subjects, but each subject has 10,000 voxels. The study would fit a sparse linear regression model that uses the voxels to predict a variable of interest, such as self-reported stress. But the study would then report on the p-value of the model on the same data it was fitted to. The standard approach in statistics, where data is split into a training and a validation set, is resisted because test subjects are expensive to acquire.[184][238]

spya-yfy5jn: One possible solution is cross-validation, which allows model validation while also allowing the whole dataset to be used for model-fitting.[239]

spya-hc3p7c: Replication efforts

spya-mg8hbx: [edit]

spya-rb0uw8: In July 2016, the Netherlands Organisation for Scientific Research made €3 million available for replication studies. The funding is for replication based on reanalysis of existing data and replication by collecting and analysing new data. Funding is available in the areas of social sciences, health research and healthcare innovation.[240]

spya-f3fc4d: In 2013, the Laura and John Arnold Foundation funded the launch of The Center for Open Science with a $5.25 million grant. By 2017, it provided an additional $10 million in funding.[241] It also funded the launch of the Meta-Research Innovation Center at Stanford at Stanford University run by Ioannidis and medical scientist Steven Goodman to study ways to improve scientific research.[241] It also provided funding for the AllTrials initiative led in part by medical scientist Ben Goldacre.[241]

spya-xg9hvq: Emphasis in post-secondary education

spya-p2kx6g: [edit]

spya-vn8ngk: Based on coursework in experimental methods at MIT, Stanford, and the University of Washington, it has been suggested that methods courses in psychology and other fields should emphasize replication attempts rather than original studies.[242][243][244] Such an approach would help students learn scientific methodology and provide numerous independent replications of meaningful scientific findings that would test the replicability of scientific findings. Some have recommended that graduate students should be required to publish a high-quality replication attempt on a topic related to their doctoral research prior to graduation.[245]

spya-k6r4cy: Replication database

spya-g4r9vq: [edit]

spya-v232aw: There has been a concern that replication attempts have been growing.[246][247] As a result, this may lead to lead to research waste.[248] In turn, this has led to a need to systematically track replication attempts. As a result, several databases have been created (e.g.[249][250]). The databases have created a replication database that includes psychology among other disciplines, to promote theory-driven research and optimize the use of academic and institutional resource, while promoting trust in science.[249]

spya-gm8gn3: Some institutions require undergraduate students to submit a final year thesis that consists of an original piece of research. Daniel Quintana, a psychologist at the University of Oslo in Norway, has recommended that students should be encouraged to perform replication studies in thesis projects, as well as being taught about open science.[251]

spya-nj479j: "The overall process of testing the reproducibility and robustness of the cancer biology literature by robot. First, text mining is used to extract statements about the effect of drugs on gene expression in breast cancer. Then two different teams semi-automatically tested these statements using two different protocols, and two different cell lines (MCF7 and MDA-MB-231) using the laboratory automation system Eve."

spya-qr0mf0: Researchers demonstrated a way of semi-automated testing for reproducibility: statements about experimental results were extracted from, as of 2022 non-semantic, gene expression cancer research papers and subsequently reproduced via robot scientist "Eve".[252][253] Problems of this approach include that it may not be feasible for many areas of research and that sufficient experimental data may not get extracted from some or many papers even if available.

spya-j4vetz: Involving original authors

spya-g2apww: [edit]

spya-p6uw40: Psychologist Daniel Kahneman argued that, in psychology, the original authors should be involved in the replication effort because the published methods are often too vague.[254][255] Others, such as psychologist Andrew Wilson, disagree, arguing that the original authors should write down the methods in detail.[254] An investigation of replication rates in psychology in 2012 indicated higher success rates of replication in replication studies when there was author overlap with the original authors of a study[256] (91.7% successful replication rates in studies with author overlap compared to 64.6% successful replication rates without author overlap).

spya-dtq8wq: The replication crisis has led to the formation and development of various large-scale and collaborative communities to pool their resources to address a single question across cultures, countries and disciplines.[257] The focus is on replication, to ensure that the effect generalizes beyond a specific culture and investigate whether the effect is replicable and genuine.[258] This allows interdisciplinary internal reviews, multiple perspectives, uniform protocols across labs, and recruiting larger and more diverse samples.[258] Researchers can collaborate by coordinating data collection or fund data collection by researchers who may not have access to the funds, allowing larger sample sizes and increasing the robustness of the conclusions.

spya-sbakqy: Broader changes to scientific approach

spya-rd67eu: [edit]

spya-g2wgkw: Emphasize triangulation, not just replication

spya-b8sd0x: [edit]

spya-astgqn: Psychologist Marcus R. Munafò and Epidemiologist George Davey Smith argue, in a piece published by Nature, that research should emphasize triangulation, not just replication, to protect against flawed ideas. They claim that,

spya-w073xf: replication alone will get us only so far (and) might actually make matters worse ... [Triangulation] is the strategic use of multiple approaches to address one question. Each approach has its own unrelated assumptions, strengths and weaknesses. Results that agree across different methodologies are less likely to be artefacts. ... Maybe one reason replication has captured so much interest is the often-repeated idea that falsification is at the heart of the scientific enterprise. This idea was popularized by Karl Popper's 1950s maxim that theories can never be proved, only falsified. Yet an overemphasis on repeating experiments could provide an unfounded sense of certainty about findings that rely on a single approach. ... philosophers of science have moved on since Popper. Better descriptions of how scientists actually work include what epistemologist Peter Lipton called in 1991 "inference to the best explanation".[259]

spya-vhasyu: Complex systems paradigm

spya-yj52bd: [edit]

spya-mq4uts: The dominant scientific and statistical model of causation is the linear model.[260] The linear model assumes that mental variables are stable properties which are independent of each other. In other words, these variables are not expected to influence each other. Instead, the model assumes that the variables will have an independent, linear effect on observable outcomes.[260]

spya-rfa98m: Social scientists Sebastian Wallot and Damian Kelty-Stephen argue that the linear model is not always appropriate.[260] An alternative is the complex system model which assumes that mental variables are interdependent. These variables are not assumed to be stable, rather they will interact and adapt to each specific context.[260] They argue that the complex system model is often more appropriate in psychology, and that the use of the linear model when the complex system model is more appropriate will result in failed replications.[260]

spya-q49kc6: ...psychology may be hoping for replications in the very measurements and under the very conditions where a growing body of psychological evidence explicitly discourages predicting replication. Failures to replicate may be plainly baked into the potentially incomplete, but broadly sweeping failure of human behavior to conform to the standard of independen[ce] ...[260]

spya-d4kvnh: Replication should seek to revise theories

spya-w33f8e: [edit]

spya-hnkzvj: Replication is fundamental for scientific progress to confirm original findings. However, replication alone is not sufficient to resolve the replication crisis. Replication efforts should seek not just to support or question the original findings, but also to replace them with revised, stronger theories with greater explanatory power. This approach therefore involves pruning existing theories, comparing all the alternative theories, and making replication efforts more generative and engaged in theory-building.[261][262] However, replication alone is not enough, it is important to assess the extent that results generalise across geographical, historical and social contexts is important for several scientific fields, especially practitioners and policy makers to make analyses in order to guide important strategic decisions. Reproducible and replicable findings was the best predictor of generalisability beyond historical and geographical contexts, indicating that for social sciences, results from a certain time period and place can meaningfully drive as to what is universally present in individuals.[263]

spya-k8gpmq: Tenets of open science

spya-a3xcsc: Open data, open source software and open source hardware all are critical to enabling reproducibility in the sense of validation of the original data analysis. The use of proprietary software, the lack of the publication of analysis software and the lack of open data prevents the replication of studies. Unless software used in research is open source, reproducing results with different software and hardware configurations is impossible.[264] CERN has both Open Data and CERN Analysis Preservation projects for storing data, all relevant information, and all software and tools needed to preserve an analysis at the large experiments of the LHC. Aside from all software and data, preserved analysis assets include metadata that enable understanding of the analysis workflow, related software, systematic uncertainties, statistics procedures and meaningful ways to search for the analysis, as well as references to publications and to backup material.[265] CERN software is open source and available for use outside of particle physics and there is some guidance provided to other fields on the broad approaches and strategies used for open science in contemporary particle physics.[266]

spya-zzxwdt: Online repositories where data, protocols, and findings can be stored and evaluated by the public seek to improve the integrity and reproducibility of research. Examples of such repositories include the Open Science Framework, Registry of Research Data Repositories, and Psychfiledrawer.org. Sites like Open Science Framework offer badges for using open science practices in an effort to incentivize scientists. However, there have been concerns that those who are most likely to provide their data and code for analyses are the researchers that are likely the most sophisticated.[267] Ioannidis suggested that "the paradox may arise that the most meticulous and sophisticated and method-savvy and careful researchers may become more susceptible to criticism and reputation attacks by reanalyzers who hunt for errors, no matter how negligible these errors are".[267]

spya-wc96k8: Base rate fallacy

spya-ne765k: Black swan theory

spya-m9qdg8: Correlation does not imply causation

spya-ntxsm4: Data dredging

spya-qszaja: Decline effect

spya-hg5p8d: Estimation statistics

spya-dmck6r: Exploratory data analysis

spya-h0evtk: Extension neglect

spya-beuha9: Falsifiability

spya-jk7fbv: Invalid science

spya-n39pbv: Misuse of statistics

spya-va5sak: Naturalism

spya-tbcf40: Observer bias

spya-yg5a3e: p-value

spya-h4e447: Problem of induction

spya-g0jmds: Sampling bias

spya-mp92km: Selection bias

spya-at4ge6: Statistical hypothesis testing

spya-x2u7u0: Uniformitarianism

spya-eu3adf: Bastian H (5 December 2016). "Reproducibility Crisis Timeline: Milestones in Tackling Research Reliability". Absolutely Maybe. Retrieved 2019-06-05.

spya-u7ehw9: Bonett, D.G. (2021). Design and analysis of replication studies. Organizational Research Methods, 24, 513–529. https://doi.org/10.1177/1094428120911088

spya-hdyvbx: Denworth L (October 2019). "A Significant Problem: Standard scientific methods are under fire. Will anything change?" (PDF). Scientific American. Vol. 321, no. 4. pp. 62–67. p. 63: The use of p values for nearly a century [since 1925] to determine statistical significance of experimental results has contributed to an illusion of certainty and [to] reproducibility crises in many scientific fields. There is growing determination to reform statistical analysis... Some [researchers] suggest changing statistical methods, whereas others would do away with a threshold for defining 'significant' results.

spya-hwp839: Harris R (2017). Rigor Mortis: How Sloppy Science Creates Worthless Cures, Crushes Hope, and Wastes Billions. New York: Basic Books. ISBN 978-0-465-09790-6.

spya-pcmkn2: Kafkafi N, Agassi J, Chesler EJ, Crabbe JC, Crusio WE, Eilam D, et al. (April 2018). "Reproducibility and replicability of rodent phenotyping in preclinical studies". Neuroscience and Biobehavioral Reviews. 87: 218–232. doi:10.1016/j.neubiorev.2018.01.003. PMC 6071910. PMID 29357292.

spya-m5hqe5: Ritchie S (July 2020). Science Fictions: How Fraud, Bias, Negligence, and Hype Undermine the Search for Truth. New York: Metropolitan Books. ISBN 978-1-250-22269-5. Book Review (November 2020, The American Conservative)

spya-bzsg5k: Whitfield J (October 2021). "Replication Crisis". London Review of Books. 43 (19): 39–40. review of Ritchie S (July 2020). Science Fictions: Exposing Fraud, Negligence and Hype in Science. London: Bodley Head. ISBN 978-1-84792-565-7.
