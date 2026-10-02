# 4 candidates for "Revealing the Dynamics of Neural Information Processing with Multivariate Information Decomposition"

Each candidate is the ideas a reader needs in order to get this article, each tied to the passages that carry it. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-entropy-24-00930-spya-pywwkq.md` beside this file.

## Candidate W

```json
[
  {
    "id": "spya-asb7n5",
    "name": "Statistical dependency structure is not a mechanistic explanation",
    "provenance": "assumed",
    "statement": "Finding that a triad's information is redundant, unique, or synergistic describes a statistical relationship in the data; it does not by itself explain the biological or mechanistic cause of that pattern.",
    "whyYouNeedIt": "Without holding this distinction, a reader would conflate the PID-based findings about rich clubs and recurrence with proven causal/mechanistic accounts of neural computation, which the text explicitly resists doing.",
    "occurrences": [
      {
        "blockId": "spya-spdx0y",
        "quote": "while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated",
        "reasoning": "This caveat only makes sense as a corrective if the reader was implicitly treating earlier statistical results as mechanistic; the idea underlies why this caution is needed.",
        "start": 80,
        "blockText": "One important caveat to note with respect to PID applied to neural data is that while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated. Now that the existence of statistical synergies is well replicated, a natural future avenue of research might be to attempt to determine how particular biological aspects of neuronal function (e.g., neurotransmitter systems, neural architecture, etc.) produce redundant, unique, or synergistic computational dynamics."
      },
      {
        "blockId": "spya-akxt70",
        "quote": "To understand better why cortical rich clubs are so dense in information processing, we examined other determinants of synergistic integration.",
        "reasoning": "The search for 'why' presumes that the prior statistical correlation (rich club synergy) was not itself an explanation, requiring the assumed distinction between correlation and mechanism.",
        "start": 0,
        "blockText": "To understand better why cortical rich clubs are so dense in information processing, we examined other determinants of synergistic integration. We asked, for example, how the connectivity motif of computational triads related to synergy. We also asked whether the similarity of the spike trains converging on a target neuron from two source neurons impacts the amount of synergistic integration. Each of these is unpacked next."
      }
    ]
  },
  {
    "id": "spya-hgtbcp",
    "name": "Finite data systematically distorts information estimates",
    "provenance": "assumed",
    "statement": "Estimating entropy and mutual information from a limited number of samples produces biased results—typically underestimating entropy and inflating apparent mutual information—especially as the number of possible joint states grows.",
    "whyYouNeedIt": "This is necessary to understand why the article repeatedly warns about discretization, binning choices, and sample size rather than treating PID outputs as exact quantities.",
    "occurrences": [
      {
        "blockId": "spya-qa7gt2",
        "quote": "the plug-in estimator for the Shannon entropy consistently underestimates the true entropy and overestimates the mutual information",
        "reasoning": "States the bias directly, which other cautions in the piece presuppose.",
        "start": 243,
        "blockText": "PID also inherits a limitation common to most applied information-theoretic frameworks, i.e., the problem of accurately estimating entropies and mutual information. When naively estimating probabilities from a finite dataset, it is known that the plug-in estimator for the Shannon entropy consistently underestimates the true entropy and overestimates the mutual information (for example, two processes that are uncorrelated can have non-zero apparent mutual information) [68]. While this is less of an immediate concern in the case of single-neuron recordings, where the state space is small (binary) and recording times are long (often of the order of millions of samples), this concern can become an issue as the state space grows. Consequently, great care should be taken when performing a PID (or any other information-theoretic) analysis to ensure appropriate null-model comparisons and that the limitations of the chosen entropy estimator are understood (for a more detailed discussion of information estimation in finite-sized datasets, see [15])."
      },
      {
        "blockId": "spya-tz99zn",
        "quote": "care should be taken to ensure that there are enough data for it to be possible to robustly infer the probabilities of all configurations, as undersampling and finite-size effects can severely compromise the estimated entropies and mutual information data",
        "reasoning": "The warning about binning and sample size only makes sense given the assumed fact that finite samples bias information estimates.",
        "start": 676,
        "blockText": "In addition to concerns around data type, there are also practical concerns about the size of the available dataset that can be used to infer joint probability distributions. For a system of k interacting variables, any multivariate information-theoretic analysis (beyond just the PID) requires a k-dimensional joint probability distribution to be constructed, which can require incredibly large amounts of data as k becomes large. For a system of binary elements such as spiking neurons, there are 2 k possible combinations of 0s and 1s. When analyzing recordings with hundreds or thousands of neurons (as might be recorded on a multielectrode array or a Neuropixels probe), care should be taken to ensure that there are enough data for it to be possible to robustly infer the probabilities of all configurations, as undersampling and finite-size effects can severely compromise the estimated entropies and mutual information data. This is one reason why it is generally considered inadvisable to discretize continuous data by binning it into a large number of communities [15], as pipelines that use large numbers of bins almost certainly do not have sufficient data to brute force the full space, and the resulting inferences will be severely compromised. There are, however, practical guides to handling sampling in real-world empirical settings [59,60]."
      }
    ]
  },
  {
    "id": "spya-b5a48e",
    "name": "Transfer entropy measures directed flow, not interaction",
    "provenance": "introduced",
    "statement": "Mutual information captures undirected statistical dependence (functional connectivity), while transfer entropy captures directed, time-ordered information flow (effective connectivity); neither reveals how multiple inputs combine.",
    "whyYouNeedIt": "Readers need this distinction to understand why a further tool (PID) is required beyond these two classic measures.",
    "occurrences": [
      {
        "blockId": "spya-f6sbgx",
        "quote": "It does not, however, quantify information transfer between the neurons, as it is an undirected measure",
        "reasoning": "Clarifies mutual information's limitation.",
        "start": 626,
        "blockText": "Mutual information [12] can measure the dependence in the spiking between two neurons: I(X;Y) := ∑ x∈X y∈Y P(x, y)log2 P(x|y) P(x) (1) where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal probability of X, and P(x|y) is the conditional probability X = x given that Y = y. I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13]. This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”"
      },
      {
        "blockId": "spya-p4pyuy",
        "quote": "Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity",
        "reasoning": "States the core distinction used to motivate PID's necessity.",
        "start": 765,
        "blockText": "Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1), conditioned on Y’s own past (Yp): TE(X → Y) := (2) ∑ yt+1∈Y xp∈Xp yp∈Yp P(yt+1, yp, xp)log2 P(yt+1|xp, yp) P(yt+1|yp) TE(X → Y) is read as the transfer entropy from X’s past to Y’s future. It is important to note that Xp does not necessarily have to be a single moment or bin but can be a multi-dimensional and potentially non-uniform embedding [15–17]. TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation. In addition to measuring the magnitude of information flow between two neurons, in the special case of binary signals the TE can be modified to also provide a measure of excitation/inhibition balance using the sorted local transfer entropy [18]."
      },
      {
        "blockId": "spya-s0db2g",
        "quote": "Information transfer captures the overall \"flow\" of information through the system; however, it is limited in its ability to reveal how different streams of information \"interact\"",
        "reasoning": "Directly sets up the need for decomposition beyond flow measures.",
        "start": 0,
        "blockText": "Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]. How does one examine information processing itself? We propose that one successful avenue is that of multivariate information decomposition [1]."
      }
    ]
  },
  {
    "id": "spya-tsmjpq",
    "name": "Whole can exceed or fall short of sum of parts",
    "provenance": "introduced",
    "statement": "The joint information that multiple sources provide about a target is not simply the sum of what each source provides individually; it can be greater (synergy) or smaller (redundancy) than that sum.",
    "occurrences": [
      {
        "blockId": "spya-h5dz45",
        "quote": "I(X;Y) 6= ∑ i=1 |X| I(Xi;Y).",
        "reasoning": "States the core inequality that motivates the whole decomposition framework.",
        "start": 959,
        "blockText": "Individual neurons receive inputs from from many “parent” neurons, which are “integrated” into a single “decision” by the target neuron, i.e., whether to fire an action potential or not. Exactly how individual neurons “compute” their future behavior as a function of their inputs is a long-standing question in computational and theoretical neurosciences. We can quantify the total amount of information the inputs provide about the decision state of the target neuron using the joint mutual information: I(X;Y) = ∑ x∈X ∑ y∈Y P(x, y)log2 P(y|x) P(y) (3) where X = {X1, . . . , XN} is the set of all pre-synaptic parent neurons and Y is the single post-synaptic target neuron. We can also compute the individual information that single parents provide about the target with the marginal mutual information I(Xi;Y). Interestingly, it cannot be assumed that the joint mutual information (the “whole”) is reducible to a sum of all its component marginal “parts”. I(X;Y) 6= ∑ i=1 |X| I(Xi;Y). (4)"
      },
      {
        "blockId": "spya-e94ury",
        "quote": "If the left-hand side of Equation (4) (the \"whole\") is greater than the right-hand side (the sum of the \"parts\"), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent.",
        "reasoning": "Explains synergy and redundancy as deviations from additivity.",
        "start": 0,
        "blockText": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating “computation” on all of its inputs considered jointly (this is also sometimes referred to as “information modification” in the literature [19]). Conversely, if the whole is less than the sum of its parts, then there must be redundant information about Y instantiated multiple times over the parent neurons that is “double counted” when summing the marginals. The way that these pieces fit together is illustrated in Figure 1."
      }
    ]
  },
  {
    "id": "spya-tezu2x",
    "name": "Synergy as the signature of genuine computation",
    "provenance": "introduced",
    "statement": "Synergistic information—information only available from the joint pattern of multiple inputs, not from any one alone—is treated as the hallmark of a neuron actively computing on its inputs rather than just passing information along.",
    "whyYouNeedIt": "Without this framing, the empirical findings about rich clubs, recurrence, and task-related synergy would just be statistical curiosities rather than evidence about 'processing'.",
    "occurrences": [
      {
        "blockId": "spya-e94ury",
        "quote": "the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating \"computation\" on all of its inputs considered jointly",
        "reasoning": "Directly equates synergy with computation.",
        "start": 271,
        "blockText": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating “computation” on all of its inputs considered jointly (this is also sometimes referred to as “information modification” in the literature [19]). Conversely, if the whole is less than the sum of its parts, then there must be redundant information about Y instantiated multiple times over the parent neurons that is “double counted” when summing the marginals. The way that these pieces fit together is illustrated in Figure 1."
      },
      {
        "blockId": "spya-sp50v3",
        "quote": "The existence of synergy in empirical data shows us that neurons do not appear to blindly sum the number of inputs and fire in response to the total",
        "reasoning": "Uses synergy as evidence for pattern-sensitive computation.",
        "start": 519,
        "blockText": "In this paper, we have aimed to provide an accessible introduction to the partial information decomposition framework [1] and shown how it can be applied to answer fundamental questions about information processing in neural circuits. We have focused particularly on statistical synergy, i.e., the information about the future of a target neuron that is disclosed by the higher-order patterns instantiated by multiple upstream neurons and is irreducible to any single source, as a measure of processing or computation. The existence of synergy in empirical data shows us that neurons do not appear to blindly sum the number of inputs and fire in response to the total (as would be expected from a basic threshold model or complex contagion model), but instead they are also sensitive to the particular patterns of incoming stimuli. Furthermore, not only does the existence of statistical synergy add nuance and dimensions to our understanding of the dynamics of individual neurons, we have also shown that the patterns of synergistic information processing are informed by the local environment in which those neurons are embedded (rich club membership, motifs, clustering, etc.), as well as the behavioral state of the oganism under study. These findings hint at the existence of a large, potentially fruitful space of future research relating higher-order information dynamics to biological, cognitive, systemic phenomena at many scales of analysis."
      }
    ]
  },
  {
    "id": "spya-k55m4k",
    "name": "No unique redundancy function exists",
    "provenance": "introduced",
    "statement": "Classical information theory underdetermines the decomposition into redundant, unique, and synergistic parts; a redundancy measure must be chosen by assumption, and many competing, non-equivalent choices exist with different tradeoffs.",
    "whyYouNeedIt": "Without grasping this, a reader would wrongly assume PID gives one objective number rather than depending on an analyst's choice of measure.",
    "occurrences": [
      {
        "blockId": "spya-bgsd4n",
        "quote": "Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each.",
        "reasoning": "States the underdetermination directly.",
        "start": 257,
        "blockText": "The result is an underdetermined system of linear equations, with three known values (the mutual information terms) and four unknown values (the partial information terms). If any of the unknown terms can be defined, then the other three emerge “for free”. Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each. The most common approach is to define a redundancy function such as the original proposal of Imin [1] (for more on redundancy functions, see Section 4.3), although there have also been proposals that start with the unique information [24,25] or synergy [26,27]."
      },
      {
        "blockId": "spya-rc76qn",
        "quote": "To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks",
        "reasoning": "Reinforces that the choice of redundancy measure is a live, consequential decision.",
        "start": 112,
        "blockText": "Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks (such as only being defined for systems of a fixed size, only being amenable to discrete random variables, or requiring arbitrary thresholds). There are, at present, close to a dozen competing redundancy functions (see [22,29,31–40]). In the absence of a single accepted measure, different contexts may require the choice of different functions. For example, having more than two predictors precludes the measures proposed in [24,31], while continuous data cannot be analyzed with the measures proposed in [24,40], and so on. The majority of the studies discussed in this paper used the original Imin measure proposed in [1], although this measure has been criticized for unintuitive behavior [29,39]. For a deeper discussion of the practical considerations, see Section 6."
      }
    ]
  },
  {
    "id": "spya-dg2g4d",
    "name": "Combinatorial explosion limits PID's scalability",
    "provenance": "introduced",
    "statement": "The number of distinct information atoms grows astronomically (following Dedekind numbers) as the number of input sources increases, making full PID intractable for neurons with many inputs.",
    "whyYouNeedIt": "This explains why nearly all empirical neuroscience applications restrict themselves to two-source triads rather than realistic many-input neurons.",
    "occurrences": [
      {
        "blockId": "spya-q9gytb",
        "quote": "in the case of three or more parents, the resulting system of equations is not as constrained as in the two-element case, as the number of distinct partial information atoms grows much faster than the number of known mutual information terms",
        "reasoning": "States the scaling problem motivating the triad restriction used throughout the empirical section.",
        "start": 284,
        "blockText": "By far the most common approach to applying PID in neurosciences involves analyzing only triads, with two parents and a single target (for example, [2–4,20,28]); however, the PID framework is conceptually powerful enough to support any number of pre-synaptic elements. Unfortunately, in the case of three or more parents, the resulting system of equations is not as constrained as in the two-element case, as the number of distinct partial information atoms grows much faster than the number of known mutual information terms. The general PID framework requires the introduction of more involved mathematical machinery."
      },
      {
        "blockId": "spya-aby2dp",
        "quote": "in the case of six parent neurons, there are 7,828,354 distinct PI atoms, the vast majority of which are difficult to interpret",
        "reasoning": "Quantifies the explosion and explains why full decomposition is impractical.",
        "start": 351,
        "blockText": "The PID framework has a number of limitations that potentially complicate its application in naturalistic settings. The most significant is the explosive growth of the PI lattice. For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]. This sequence of numbers grows appallingly fast: in the case of six parent neurons, there are 7,828,354 distinct PI atoms, the vast majority of which are difficult to interpret. Dedekind numbers greater than nine are currently unknown. Given that single neurons can receive inputs from very large numbers of upstream neurons, a “complete” description of the information dynamics of any individual neuron is completely intractable. This issue may be partially addressed by the development of heuristic measures of redundancy and synergy such as the O-information [65], which has been applied to information dynamics in networks of neurons [66] and human functional magnetic resonance imaging blood-oxygen-level-dependent (fMRI-BOLD) signals [67], although these measures typically trade completeness for scalability."
      }
    ]
  },
  {
    "id": "spya-fb9xx0",
    "name": "The partial information lattice via Möbius inversion",
    "provenance": "introduced",
    "statement": "Given a redundancy function, the total information can be recursively broken into atomic, non-overlapping information components by organizing all source combinations into a partially ordered lattice and applying Möbius inversion.",
    "occurrences": [
      {
        "blockId": "spya-t8mg0s",
        "quote": "it is possible to decompose the total joint mutual information into a finite set of unique, partial information atoms based on how all the elements of S share information about Y",
        "reasoning": "States the lattice decomposition idea.",
        "start": 130,
        "blockText": "One of the key insights from Williams and Beer was that given a suitable measure of redundancy (which we will refer to as I∩(·)), it is possible to decompose the total joint mutual information into a finite set of unique, partial information atoms based on how all the elements of S share information about Y. This idealized redundancy function must satisfy a number of axioms (for further discussion, see [1,29,30]). For our purposes, it is sufficient to assume that an idealized I∩(·) function exists."
      },
      {
        "blockId": "spya-m37w5y",
        "quote": "it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion",
        "reasoning": "Names the specific mathematical mechanism generalizing beyond two sources.",
        "start": 281,
        "blockText": "This can be read as indicating that one element of A (α) is said to precede another element (β) on the lattice if every element of β has an associated element in α that is a superset or equal to it. Given this partially ordered lattice structure and our redundancy function I∩(·), it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion:"
      }
    ]
  },
  {
    "id": "spya-z98dtc",
    "name": "Synergy concentrates where connectivity is denser and more recurrent",
    "provenance": "introduced",
    "statement": "Across independent analyses, synergistic computation is disproportionately found in densely interconnected 'rich club' hubs and in circuit motifs with more recurrent connections among input sources, while feedback connections do not consistently increase it.",
    "occurrences": [
      {
        "blockId": "spya-fud8q3",
        "quote": "triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club",
        "reasoning": "Empirical anchor for the rich-club synergy claim.",
        "start": 226,
        "blockText": "PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation."
      },
      {
        "blockId": "spya-sd9fzd",
        "quote": "triads with more recurrent connections also had greater synergy",
        "reasoning": "Empirical anchor for the recurrence claim.",
        "start": 25,
        "blockText": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy."
      },
      {
        "blockId": "spya-sd9fzd",
        "quote": "Finally, feedback connections were not significantly related to synergy.",
        "reasoning": "Completes the structure-function pattern being generalized.",
        "start": 1152,
        "blockText": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy."
      }
    ]
  },
  {
    "id": "spya-vtk2a4",
    "name": "Synergy peaks at intermediate input correlation, not maximal correlation",
    "provenance": "introduced",
    "statement": "Synergy between two converging inputs rises with their similarity only up to a point, then falls as similarity increases further and redundancy takes over instead; this peak occurs at a similar fraction of maximal correlation across timescales.",
    "occurrences": [
      {
        "blockId": "spya-ybmve2",
        "quote": "the peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease",
        "reasoning": "States the nonmonotonic relationship directly.",
        "start": 240,
        "blockText": "To test whether synergy increases indefinitely as mutual information grows at longer timescales, we explored a range extending well past the synaptic range (time bins up to 2.25 s wide). Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease (this level is marked by the vertical dotted line in Figure 4E). In the context of explaining the density of synergy in the rich club, the strong positive relationship between synergy and mutual information at synaptic timescales suggested that the activity of rich club neurons is generally more correlated than the activity of neurons outside the rich club. Indeed, rich clubs consist of a disproportionate number of inhibitory neurons with correlated spiking activity that synergistically predict the dynamics of the rest of the network [50]."
      },
      {
        "blockId": "spya-cs9fdy",
        "quote": "as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed",
        "reasoning": "Explains the mechanism behind the nonmonotonic pattern.",
        "start": 743,
        "blockText": "Leveraging the multiple outputs that PID offers, including redundancy as well as synergy, we were able to explore how the overall composition of information propagation varies across timescales [3]. As we lengthened the timescale, the total multivariate transfer entropy between the source neurons and the target neuron increased steadily across all timescales examined. As noted already, however, synergy increased only at the shorter timescales and decreased at the longer timescales. Observing the redundancy offered an explanation. Redundancy was positively related to mutual information at all timescales. Indeed, the slope relating the redundancy to mutual information became steeper at longer timescales (Figure 4E). This suggests that as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed."
      }
    ]
  }
]
```

## Candidate X

```json
[
  {
    "id": "spya-w4g3s8",
    "name": "Mutual information measures association, not directional influence",
    "provenance": "assumed",
    "statement": "A measure of statistical dependence between two variables (like mutual information) tells you they are related but says nothing about which one's past is shaping the other's future; that requires a separate, time-directed construction.",
    "whyYouNeedIt": "The passage contrasting mutual information and transfer entropy only makes sense if the reader already distinguishes association from causal/temporal flow; otherwise the two measures would seem redundant rather than serving different roles.",
    "occurrences": [
      {
        "blockId": "spya-f6sbgx",
        "quote": "It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”",
        "reasoning": "States the limitation that only matters if the reader already holds the general distinction between association and directed influence.",
        "start": 626,
        "blockText": "Mutual information [12] can measure the dependence in the spiking between two neurons: I(X;Y) := ∑ x∈X y∈Y P(x, y)log2 P(x|y) P(x) (1) where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal probability of X, and P(x|y) is the conditional probability X = x given that Y = y. I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13]. This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”"
      },
      {
        "blockId": "spya-p4pyuy",
        "quote": "Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity",
        "reasoning": "This labeling presumes the reader already separates correlation-like measures from flow-like measures.",
        "start": 765,
        "blockText": "Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1), conditioned on Y’s own past (Yp): TE(X → Y) := (2) ∑ yt+1∈Y xp∈Xp yp∈Yp P(yt+1, yp, xp)log2 P(yt+1|xp, yp) P(yt+1|yp) TE(X → Y) is read as the transfer entropy from X’s past to Y’s future. It is important to note that Xp does not necessarily have to be a single moment or bin but can be a multi-dimensional and potentially non-uniform embedding [15–17]. TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation. In addition to measuring the magnitude of information flow between two neurons, in the special case of binary signals the TE can be modified to also provide a measure of excitation/inhibition balance using the sorted local transfer entropy [18]."
      }
    ]
  },
  {
    "id": "spya-z50y9c",
    "name": "Synergy is only resolvable, not uniquely defined, by classical information theory",
    "provenance": "assumed",
    "statement": "Shannon's framework fixes the total and marginal mutual informations but leaves the split into redundant, unique, and synergistic pieces underdetermined; some extra assumption about what counts as redundancy must be supplied from outside classical theory.",
    "whyYouNeedIt": "Without this, the reader cannot understand why there are a dozen competing 'redundancy functions' or why results depend on which one a study picked.",
    "occurrences": [
      {
        "blockId": "spya-bgsd4n",
        "quote": "The result is an underdetermined system of linear equations, with three known values (the mutual information terms) and four unknown values (the partial information terms).",
        "reasoning": "This statement only makes sense if the reader already grasps that classical information theory alone cannot fix a unique decomposition, which is assumed throughout earlier intuitive discussion.",
        "start": 0,
        "blockText": "The result is an underdetermined system of linear equations, with three known values (the mutual information terms) and four unknown values (the partial information terms). If any of the unknown terms can be defined, then the other three emerge “for free”. Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each. The most common approach is to define a redundancy function such as the original proposal of Imin [1] (for more on redundancy functions, see Section 4.3), although there have also been proposals that start with the unique information [24,25] or synergy [26,27]."
      },
      {
        "blockId": "spya-rc76qn",
        "quote": "To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks",
        "reasoning": "Relies on the prior idea that the decomposition is inherently underdetermined, requiring arbitrary choice of measure.",
        "start": 112,
        "blockText": "Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks (such as only being defined for systems of a fixed size, only being amenable to discrete random variables, or requiring arbitrary thresholds). There are, at present, close to a dozen competing redundancy functions (see [22,29,31–40]). In the absence of a single accepted measure, different contexts may require the choice of different functions. For example, having more than two predictors precludes the measures proposed in [24,31], while continuous data cannot be analyzed with the measures proposed in [24,40], and so on. The majority of the studies discussed in this paper used the original Imin measure proposed in [1], although this measure has been criticized for unintuitive behavior [29,39]. For a deeper discussion of the practical considerations, see Section 6."
      }
    ]
  },
  {
    "id": "spya-wqagvj",
    "name": "A system's few known joint quantities cannot pin down its many possible interaction patterns once there are more than two sources",
    "provenance": "assumed",
    "statement": "When more than two sources contribute to a target, the number of distinct ways information can be shared (redundantly, uniquely, in combinations) grows much faster than the number of measurable mutual-information quantities, so solving for them needs an entirely separate combinatorial structure, not just more equations of the same kind used for two sources.",
    "whyYouNeedIt": "This is needed to understand why the two-parent case can be solved by simple algebra but three or more parents require introducing the entire partial information lattice machinery.",
    "occurrences": [
      {
        "blockId": "spya-q9gytb",
        "quote": "in the case of three or more parents, the resulting system of equations is not as constrained as in the two-element case, as the number of distinct partial information atoms grows much faster than the number of known mutual information terms.",
        "reasoning": "This claim assumes the reader understands why a growing combinatorial space outpaces a linearly growing set of equations, motivating the lattice approach introduced next.",
        "start": 284,
        "blockText": "By far the most common approach to applying PID in neurosciences involves analyzing only triads, with two parents and a single target (for example, [2–4,20,28]); however, the PID framework is conceptually powerful enough to support any number of pre-synaptic elements. Unfortunately, in the case of three or more parents, the resulting system of equations is not as constrained as in the two-element case, as the number of distinct partial information atoms grows much faster than the number of known mutual information terms. The general PID framework requires the introduction of more involved mathematical machinery."
      },
      {
        "blockId": "spya-aby2dp",
        "quote": "For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]. This sequence of numbers grows appallingly fast",
        "reasoning": "Depends on the same assumed idea about combinatorial explosion outstripping measurable quantities.",
        "start": 180,
        "blockText": "The PID framework has a number of limitations that potentially complicate its application in naturalistic settings. The most significant is the explosive growth of the PI lattice. For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]. This sequence of numbers grows appallingly fast: in the case of six parent neurons, there are 7,828,354 distinct PI atoms, the vast majority of which are difficult to interpret. Dedekind numbers greater than nine are currently unknown. Given that single neurons can receive inputs from very large numbers of upstream neurons, a “complete” description of the information dynamics of any individual neuron is completely intractable. This issue may be partially addressed by the development of heuristic measures of redundancy and synergy such as the O-information [65], which has been applied to information dynamics in networks of neurons [66] and human functional magnetic resonance imaging blood-oxygen-level-dependent (fMRI-BOLD) signals [67], although these measures typically trade completeness for scalability."
      }
    ]
  },
  {
    "id": "spya-gx5hzk",
    "name": "Information flow is not the same as information processing",
    "provenance": "introduced",
    "statement": "Measuring how much one neuron's activity predicts another's (transfer of information) is different from measuring how neurons combine multiple inputs into something new; the latter requires looking at joint, not just pairwise, dependencies.",
    "occurrences": [
      {
        "blockId": "spya-s0db2g",
        "quote": "Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources",
        "reasoning": "Directly introduces this distinction as the motivation for PID.",
        "start": 0,
        "blockText": "Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]. How does one examine information processing itself? We propose that one successful avenue is that of multivariate information decomposition [1]."
      },
      {
        "blockId": "spya-wer4cd",
        "quote": "Information transfer (discussed above) tells us about how the past of either source Xi informs the future of Y, but to understand “processing”, we are interested in how the interaction between the two source variables’ past influences the target’s future in a way that is not reducible to either source considered individually.",
        "reasoning": "Elaborates the same distinction.",
        "start": 0,
        "blockText": "Information transfer (discussed above) tells us about how the past of either source Xi informs the future of Y, but to understand “processing”, we are interested in how the interaction between the two source variables’ past influences the target’s future in a way that is not reducible to either source considered individually. This parsing is accomplished using the partial information decomposition (PID) framework [20]. In the next section, we cover the premise and operation of the PID framework. The following section illustrates the application of the PID framework with examples from our own work. In the final section we offer practical pointers for how to get started with using PID in new settings."
      }
    ]
  },
  {
    "id": "spya-h4f6yr",
    "name": "The whole can exceed or fall short of the sum of parts",
    "provenance": "introduced",
    "statement": "The joint information that multiple sources carry about a target need not equal the sum of what each source carries alone; it can be larger (synergy) or smaller (redundancy).",
    "occurrences": [
      {
        "blockId": "spya-h5dz45",
        "quote": "I(X;Y) 6= ∑ i=1 |X| I(Xi;Y).",
        "reasoning": "States the core inequality that motivates the whole decomposition.",
        "start": 959,
        "blockText": "Individual neurons receive inputs from from many “parent” neurons, which are “integrated” into a single “decision” by the target neuron, i.e., whether to fire an action potential or not. Exactly how individual neurons “compute” their future behavior as a function of their inputs is a long-standing question in computational and theoretical neurosciences. We can quantify the total amount of information the inputs provide about the decision state of the target neuron using the joint mutual information: I(X;Y) = ∑ x∈X ∑ y∈Y P(x, y)log2 P(y|x) P(y) (3) where X = {X1, . . . , XN} is the set of all pre-synaptic parent neurons and Y is the single post-synaptic target neuron. We can also compute the individual information that single parents provide about the target with the marginal mutual information I(Xi;Y). Interestingly, it cannot be assumed that the joint mutual information (the “whole”) is reducible to a sum of all its component marginal “parts”. I(X;Y) 6= ∑ i=1 |X| I(Xi;Y). (4)"
      },
      {
        "blockId": "spya-e94ury",
        "quote": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent.",
        "reasoning": "Defines synergy and redundancy directly from the inequality.",
        "start": 0,
        "blockText": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating “computation” on all of its inputs considered jointly (this is also sometimes referred to as “information modification” in the literature [19]). Conversely, if the whole is less than the sum of its parts, then there must be redundant information about Y instantiated multiple times over the parent neurons that is “double counted” when summing the marginals. The way that these pieces fit together is illustrated in Figure 1."
      }
    ]
  },
  {
    "id": "spya-g7v8bn",
    "name": "Densely interconnected hub neurons disproportionately drive network computation",
    "provenance": "introduced",
    "statement": "A small, densely mutually-connected subset of highly-connected neurons (a rich club) accounts for a greatly disproportionate share of both information propagation and synergistic computation in a network.",
    "occurrences": [
      {
        "blockId": "spya-bftp48",
        "quote": "20% of the neurons account for 70% of the information propagation in organotypic cortical cultures",
        "reasoning": "Introduces the disproportionate role of rich-club neurons in propagation.",
        "start": 737,
        "blockText": "The observation that information propagation correlates with information processing suggests that rich clubs may be dense cores of information processing. Rich clubs generally represent the set of best-connected nodes of a network that are mutually interconnected with a probability higher than that expected by chance [48]. The rich club coefficient quantifies just how much more densely connected a given set of nodes is than would be expected by chance. Rich clubs, in the context of the effective networks built from cortical circuit spiking recordings, are comprised of the neurons that propagate the most information (i.e., sending and receiving). By definition, rich clubs are disproportionately dense in information propagation: 20% of the neurons account for 70% of the information propagation in organotypic cortical cultures [49]."
      },
      {
        "blockId": "spya-fud8q3",
        "quote": "Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy.",
        "reasoning": "Extends the disproportionality claim specifically to synergistic computation.",
        "start": 524,
        "blockText": "PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation."
      }
    ]
  },
  {
    "id": "spya-rnd33n",
    "name": "Recurrent connectivity between inputs boosts synergy more than feedback from the target",
    "provenance": "introduced",
    "statement": "Triads where the two source neurons connect to each other show increased synergistic integration, whereas connections running back from the target to the sources do not increase, and may slightly decrease, synergy.",
    "occurrences": [
      {
        "blockId": "spya-sd9fzd",
        "quote": "triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy.",
        "reasoning": "States this specific structure-function relationship.",
        "start": 25,
        "blockText": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy."
      }
    ]
  },
  {
    "id": "spya-hf875y",
    "name": "Synergy peaks at intermediate, not maximal, similarity between input signals",
    "provenance": "introduced",
    "statement": "The amount of synergistic information two inputs produce about a target rises with their mutual correlation up to a point, then falls as the inputs become mostly redundant with each other, so synergy is maximized at an intermediate degree of similarity.",
    "occurrences": [
      {
        "blockId": "spya-ybmve2",
        "quote": "synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease",
        "reasoning": "States the non-monotonic relationship directly.",
        "start": 202,
        "blockText": "To test whether synergy increases indefinitely as mutual information grows at longer timescales, we explored a range extending well past the synaptic range (time bins up to 2.25 s wide). Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease (this level is marked by the vertical dotted line in Figure 4E). In the context of explaining the density of synergy in the rich club, the strong positive relationship between synergy and mutual information at synaptic timescales suggested that the activity of rich club neurons is generally more correlated than the activity of neurons outside the rich club. Indeed, rich clubs consist of a disproportionate number of inhibitory neurons with correlated spiking activity that synergistically predict the dynamics of the rest of the network [50]."
      },
      {
        "blockId": "spya-cs9fdy",
        "quote": "as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed.",
        "reasoning": "Explains the mechanism behind the non-monotonic pattern.",
        "start": 743,
        "blockText": "Leveraging the multiple outputs that PID offers, including redundancy as well as synergy, we were able to explore how the overall composition of information propagation varies across timescales [3]. As we lengthened the timescale, the total multivariate transfer entropy between the source neurons and the target neuron increased steadily across all timescales examined. As noted already, however, synergy increased only at the shorter timescales and decreased at the longer timescales. Observing the redundancy offered an explanation. Redundancy was positively related to mutual information at all timescales. Indeed, the slope relating the redundancy to mutual information became steeper at longer timescales (Figure 4E). This suggests that as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed."
      }
    ]
  },
  {
    "id": "spya-upzmu7",
    "name": "Statistical dependency structure does not by itself explain biological mechanism",
    "provenance": "introduced",
    "statement": "Finding that certain neurons are synergy-dominated or redundancy-dominated describes a pattern of statistical dependency but does not by itself tell you which biological features (neurotransmitters, wiring, cell type) produce that pattern.",
    "occurrences": [
      {
        "blockId": "spya-spdx0y",
        "quote": "while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated",
        "reasoning": "States this limitation explicitly as a caveat for interpreting PID results.",
        "start": 80,
        "blockText": "One important caveat to note with respect to PID applied to neural data is that while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated. Now that the existence of statistical synergies is well replicated, a natural future avenue of research might be to attempt to determine how particular biological aspects of neuronal function (e.g., neurotransmitter systems, neural architecture, etc.) produce redundant, unique, or synergistic computational dynamics."
      }
    ]
  },
  {
    "id": "spya-h0fwm9",
    "name": "An expected (averaged) information measure can be broken into contributions from single specific events",
    "provenance": "introduced",
    "statement": "Instead of only computing information measures as averages over all possible states, one can compute the information value for a single actual observed configuration of variables, producing a moment-by-moment time series instead of one overall summary number.",
    "occurrences": [
      {
        "blockId": "spya-j6s6fp",
        "quote": "So far, we have focused exclusively on decomposing the “expected” mutual information into partial information atoms.",
        "reasoning": "Sets up the introduced idea by contrasting prior expected-value approach with the local approach.",
        "start": 0,
        "blockText": "So far, we have focused exclusively on decomposing the “expected” mutual information into partial information atoms. Measures such as the redundancy, synergy, etc. are calculated over the entire probability distribution of states that the parents and target can adopt. While this is standard practice in most applications of information theory, the PID framework itself can also be localized to single configurations. Consider the definition of joint mutual information given in Equation (3). It can be seen that this is an expected value: I(X;Y) = EX,Y [ log2 P(y|x) P(y) ] (12)"
      },
      {
        "blockId": "spya-mgsce6",
        "quote": "We then define the local mutual information associated with the particular configurations X = x and Y = y as: i(x; y) = log2 P(y|x) P(y)",
        "reasoning": "Gives the formal introduction of the local (event-specific) version of the measure.",
        "start": 0,
        "blockText": "We then define the local mutual information associated with the particular configurations X = x and Y = y as: i(x; y) = log2 P(y|x) P(y) (13)"
      }
    ]
  }
]
```

## Candidate Y

```json
[
  {
    "id": "spya-jvqzub",
    "name": "Statistically inferred networks are treated as the real circuit wiring",
    "provenance": "assumed",
    "statement": "When a transfer-entropy-based 'effective network' labels a connection as feedforward, feedback, or recurrent, the article treats that label as describing actual synaptic or anatomical structure rather than merely a statistical inference from spike data.",
    "whyYouNeedIt": "The entire discussion of rich clubs, recurrent motifs, and feedback connections only has biological meaning if the inferred effective network is standing in for real circuit connectivity; the piece builds structural claims on this equivalence well before it later flags the inference as imperfect.",
    "occurrences": [
      {
        "blockId": "spya-sw5ukx",
        "quote": "We then rendered the single-unit-level functional recording into an effective network, capturing the microcircuit dynamics using transfer entropy.",
        "reasoning": "Converts a statistical inference (transfer entropy between spike trains) directly into 'the' network, which only supports later talk of rich clubs and connectivity motifs if that network is accepted as a stand-in for real wiring.",
        "start": 188,
        "blockText": "To gain traction on this problem, we used 512-channel multielectrode arrays to record hundreds of individual neurons in vitro from organotypic cultures derived from mouse cortical slices. We then rendered the single-unit-level functional recording into an effective network, capturing the microcircuit dynamics using transfer entropy. In our recordings, this revealed that about 0.4–1.0% of all possible directed connections between neurons were significant. From these, we then identified all triads consisting of two source neurons connecting to a common target neuron (totalling thousands of triads) and performed the full partial information decomposition into redundant, unique, and synergistic atoms. The numerous triads observable in a single recording make it possible to perform within-recording comparisons of the features that correlate with synergistic integration. This is illustrated in Figure 3."
      },
      {
        "blockId": "spya-xs5660",
        "quote": "Feedforward connections are those from the source neurons to the target neuron. Of the two possible feedforward connections from source neurons to a target, both must exist in any computational triad.",
        "reasoning": "Uses anatomical-sounding categories (feedforward, feedback, recurrent) to describe links that were actually derived statistically, presupposing the links correspond to real synaptic arrangements.",
        "start": 396,
        "blockText": "Understanding how connectivity patterns relate to synergistic integration may be useful for predicting how a network with a given topology might perform computationally. Connectivity motifs characterize and describe the different ways a fixed number of nodes can be connected. For example, in a three-element triad, the connectivity can be parsed into feedforward, feedback, and recurrent types. Feedforward connections are those from the source neurons to the target neuron. Of the two possible feedforward connections from source neurons to a target, both must exist in any computational triad. Feedback connections are those from the target back to the source neurons. There may be zero, one, or two of these in a computational triad. Recurrent connections are connections between the source neurons. Again, there may be zero, one, or two recurrent connections. The question for our analysis was whether synergistic integration was sensitive to the number of feedback or recurrent connections."
      },
      {
        "blockId": "spya-j4cy9j",
        "quote": "This matters because it has been shown that bivariate analyses overestimate the significance of bivariate edges [51].",
        "reasoning": "This caveat only makes sense as a caveat if the reader had been treating the inferred edges as reliable stand-ins for real connections in the preceding sections, which is exactly the assumption being flagged here after the fact.",
        "start": 294,
        "blockText": "There are a few important caveats to the empirical work described here that warrant caution and further attention. The first is that the functional networks from which triads were drawn and against which the synergy values were compared were generated from bivariate transfer entropy analyses. This matters because it has been shown that bivariate analyses overestimate the significance of bivariate edges [51]. A second caveat, related to the source of the data rather than the analyses, is that the processing we studied was in cortical cultures. This matters because it leaves open key questions about what we would observe if these analyses were performed in vivo. While organotypic cultures have been proven to share many of the key properties of uncultured cortical circuits (i.e., in the brain studied in vivo or via ex vivo histological analysis) [47], the demands placed on a circuit in the context of a behaving animal are certain to differ from those placed on cultures in vitro."
      }
    ]
  },
  {
    "id": "spya-xexe3n",
    "name": "Redundancy functions as a robustness mechanism for signal transmission",
    "provenance": "assumed",
    "statement": "When a brain circuit increases redundant (repeated) information rather than synergistic information, this is treated as a strategy for protecting a signal against corruption during transmission, in the same way engineered communication systems use redundancy for error correction.",
    "whyYouNeedIt": "The interpretation of increased redundancy during motor execution as a functional adaptation only holds if redundancy is assumed to serve a reliability-protecting purpose in neural signaling, an assumption borrowed from communication engineering rather than demonstrated from the neural data itself.",
    "occurrences": [
      {
        "blockId": "spya-t8fayf",
        "quote": "This increase in relative redundancy was interpreted as a response to the practical requirements of the task: during motor execution, the brain needs to send the “move” signal to distant muscles, and to ensure high-fidelity transmission the brain may duplicate information many times over (minimizing the risk of a single corrupted signal leading to erroneous behavior).",
        "reasoning": "Explains a shift in redundancy purely in terms of a presumed error-correction function, which is not something the information-theoretic measurement itself establishes.",
        "start": 432,
        "blockText": "The ability to assess how the structure of information processes changes in response to the demands of different tasks is a significant departure from the limitations of in vitro research. The researchers found that while brain activity was generally synergy-dominated (as opposed to redundancy-dominated), during movement execution (a reach-and-grasp action) the relative abundance of redundant information increased dramatically. This increase in relative redundancy was interpreted as a response to the practical requirements of the task: during motor execution, the brain needs to send the “move” signal to distant muscles, and to ensure high-fidelity transmission the brain may duplicate information many times over (minimizing the risk of a single corrupted signal leading to erroneous behavior). Similarly, different brain regions had different relative synergies during different tasks. For example, AIP (a pre-motor region) had the highest synergy during the fixation/cueing epoch, which then dropped off during movement, while M1 (the primary motor region) had the lowest synergy during the memory epoch, which then exploded during movement execution."
      },
      {
        "blockId": "spya-b32ecw",
        "quote": "These results show not only that synergistic information dynamics is a feature of ongoing, spontaneous neural activity but also that synergy seems to reflect behaviorally specific patterns of dynamical activity in the cortex.",
        "reasoning": "Generalizes from a statistical pattern to a claim about behavioral function, relying on the same unstated premise that information-theoretic quantities map onto functional roles in the circuit.",
        "start": 0,
        "blockText": "These results show not only that synergistic information dynamics is a feature of ongoing, spontaneous neural activity but also that synergy seems to reflect behaviorally specific patterns of dynamical activity in the cortex."
      }
    ]
  },
  {
    "id": "spya-xyy35s",
    "name": "Mutual information tracks similarity, transfer entropy tracks flow",
    "provenance": "introduced",
    "statement": "Mutual information is a symmetric, timeless measure of statistical dependence between two signals (functional connectivity), while transfer entropy measures how one signal's past reduces uncertainty about another's future beyond what the target's own past already explains (effective, directed connectivity).",
    "occurrences": [
      {
        "blockId": "spya-f6sbgx",
        "quote": "This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”",
        "reasoning": "Distinguishes mutual information's descriptive role from any claim about directed flow, which only matters if the reader keeps the functional/effective distinction in mind.",
        "start": 566,
        "blockText": "Mutual information [12] can measure the dependence in the spiking between two neurons: I(X;Y) := ∑ x∈X y∈Y P(x, y)log2 P(x|y) P(x) (1) where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal probability of X, and P(x|y) is the conditional probability X = x given that Y = y. I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13]. This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”"
      },
      {
        "blockId": "spya-p4pyuy",
        "quote": "Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation.",
        "reasoning": "States the contrast directly, giving the two measures separate interpretive roles that the rest of the review relies on when talking about 'flow' versus 'similarity'.",
        "start": 765,
        "blockText": "Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1), conditioned on Y’s own past (Yp): TE(X → Y) := (2) ∑ yt+1∈Y xp∈Xp yp∈Yp P(yt+1, yp, xp)log2 P(yt+1|xp, yp) P(yt+1|yp) TE(X → Y) is read as the transfer entropy from X’s past to Y’s future. It is important to note that Xp does not necessarily have to be a single moment or bin but can be a multi-dimensional and potentially non-uniform embedding [15–17]. TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation. In addition to measuring the magnitude of information flow between two neurons, in the special case of binary signals the TE can be modified to also provide a measure of excitation/inhibition balance using the sorted local transfer entropy [18]."
      }
    ]
  },
  {
    "id": "spya-enkedw",
    "name": "Joint information from many sources isn't the sum of parts",
    "provenance": "introduced",
    "statement": "The information that a group of input neurons jointly carries about a target neuron's future state is not simply the sum of the information each input carries on its own; the gap between the joint amount and that sum can be decomposed into pieces that are redundant (repeated across inputs) or synergistic (only visible when inputs are considered together).",
    "occurrences": [
      {
        "blockId": "spya-e94ury",
        "quote": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent.",
        "reasoning": "States the core inequality that motivates treating synergy and redundancy as distinct, nameable quantities rather than noise.",
        "start": 0,
        "blockText": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating “computation” on all of its inputs considered jointly (this is also sometimes referred to as “information modification” in the literature [19]). Conversely, if the whole is less than the sum of its parts, then there must be redundant information about Y instantiated multiple times over the parent neurons that is “double counted” when summing the marginals. The way that these pieces fit together is illustrated in Figure 1."
      },
      {
        "blockId": "spya-t02v4p",
        "quote": "it was not until the seminal work of Williams and Beer [1] that it was recognized how to algebraically decompose the total joint mutual information into the particular contributions of the parts (and higher-order ensembles of parts).",
        "reasoning": "Frames the decomposition itself as the key innovation, presupposing the whole/parts gap as the problem to be solved.",
        "start": 58,
        "blockText": "This inequality has been recognized for decades; however, it was not until the seminal work of Williams and Beer [1] that it was recognized how to algebraically decompose the total joint mutual information into the particular contributions of the parts (and higher-order ensembles of parts). Since its introduction, this framework, termed partial information decomposition, has been widely applied in fields from theoretical and computational neuroscience [9,21] to climate modeling [22] and sociology [23]."
      },
      {
        "blockId": "spya-h5jzvm",
        "quote": "Red(X₁, X₂;Y) is the information about Y that could be learned by observing X₁ or X₂, Unq(Xᵢ;Y) is the information about Y that could only be learned by observing Xᵢ, and Syn(X₁, X₂;Y) is the information about Y that can only be learned by observing the joint states of X₁ and X₂ together.",
        "reasoning": "Defines the four-way split that only makes sense once the whole-versus-sum gap has been accepted as meaningful and decomposable.",
        "start": 6,
        "blockText": "where Red(X₁, X₂;Y) is the information about Y that could be learned by observing X₁ or X₂, Unq(Xᵢ;Y) is the information about Y that could only be learned by observing Xᵢ, and Syn(X₁, X₂;Y) is the information about Y that can only be learned by observing the joint states of X₁ and X₂ together. This is illustrated in Figure 1."
      }
    ]
  },
  {
    "id": "spya-gmhdef",
    "name": "Redundant information has no single correct definition",
    "provenance": "introduced",
    "statement": "Shannon's classical theory specifies the total joint information and the individual contributions exactly, but leaves the split into redundant, unique, and synergistic parts underdetermined; any particular partial information decomposition analysis depends on which extra redundancy function the analyst chooses to adopt.",
    "occurrences": [
      {
        "blockId": "spya-bgsd4n",
        "quote": "Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each.",
        "reasoning": "States plainly that the decomposition is mathematically underdetermined, which is why competing redundancy measures exist at all.",
        "start": 257,
        "blockText": "The result is an underdetermined system of linear equations, with three known values (the mutual information terms) and four unknown values (the partial information terms). If any of the unknown terms can be defined, then the other three emerge “for free”. Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each. The most common approach is to define a redundancy function such as the original proposal of Imin [1] (for more on redundancy functions, see Section 4.3), although there have also been proposals that start with the unique information [24,25] or synergy [26,27]."
      },
      {
        "blockId": "spya-rc76qn",
        "quote": "To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks (such as only being defined for systems of a fixed size, only being amenable to discrete random variables, or requiring arbitrary thresholds).",
        "reasoning": "Reinforces that any reported synergy or redundancy value is conditional on a choice of measure, not a fixed fact about the data.",
        "start": 112,
        "blockText": "Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks (such as only being defined for systems of a fixed size, only being amenable to discrete random variables, or requiring arbitrary thresholds). There are, at present, close to a dozen competing redundancy functions (see [22,29,31–40]). In the absence of a single accepted measure, different contexts may require the choice of different functions. For example, having more than two predictors precludes the measures proposed in [24,31], while continuous data cannot be analyzed with the measures proposed in [24,40], and so on. The majority of the studies discussed in this paper used the original Imin measure proposed in [1], although this measure has been criticized for unintuitive behavior [29,39]. For a deeper discussion of the practical considerations, see Section 6."
      }
    ]
  },
  {
    "id": "spya-fy9x7g",
    "name": "A lattice of information atoms generalizes the two-source split",
    "provenance": "introduced",
    "statement": "Once a redundancy function is fixed, the possible ways any number of sources can jointly disclose information about a target can be arranged into a partially ordered lattice, and each unique 'atom' of information can be computed by Möbius inversion over that lattice.",
    "occurrences": [
      {
        "blockId": "spya-t8mg0s",
        "quote": "One of the key insights from Williams and Beer was that given a suitable measure of redundancy (which we will refer to as I∩(·)), it is possible to decompose the total joint mutual information into a finite set of unique, partial information atoms based on how all the elements of S share information about Y.",
        "reasoning": "Introduces the lattice-based generalization that extends the two-source redundant/unique/synergistic split to arbitrarily many sources.",
        "start": 0,
        "blockText": "One of the key insights from Williams and Beer was that given a suitable measure of redundancy (which we will refer to as I∩(·)), it is possible to decompose the total joint mutual information into a finite set of unique, partial information atoms based on how all the elements of S share information about Y. This idealized redundancy function must satisfy a number of axioms (for further discussion, see [1,29,30]). For our purposes, it is sufficient to assume that an idealized I∩(·) function exists."
      },
      {
        "blockId": "spya-m37w5y",
        "quote": "Given this partially ordered lattice structure and our redundancy function I∩(·), it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion",
        "reasoning": "States the specific mathematical mechanism (Möbius inversion over the lattice) that computes each atom, which is the generalized machinery promised earlier in the piece.",
        "start": 199,
        "blockText": "This can be read as indicating that one element of A (α) is said to precede another element (β) on the lattice if every element of β has an associated element in α that is a superset or equal to it. Given this partially ordered lattice structure and our redundancy function I∩(·), it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion:"
      }
    ]
  },
  {
    "id": "spya-ex0j0u",
    "name": "Rich clubs are disproportionate hubs of synergistic computation",
    "provenance": "introduced",
    "statement": "The densely interconnected 'rich club' neurons in a cortical circuit perform far more than their share of synergistic (higher-order, jointly-dependent) information processing compared to neurons outside the rich club.",
    "occurrences": [
      {
        "blockId": "spya-fud8q3",
        "quote": "Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B).",
        "reasoning": "States the core empirical claim that synergy is concentrated in rich-club triads, which underlies the article's framing of rich clubs as computational cores.",
        "start": 118,
        "blockText": "PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation."
      },
      {
        "blockId": "spya-fud8q3",
        "quote": "Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy.",
        "reasoning": "Quantifies just how disproportionate the concentration of synergy is, reinforcing the claim beyond the per-triad comparison.",
        "start": 524,
        "blockText": "PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation."
      }
    ]
  },
  {
    "id": "spya-sxg5ur",
    "name": "Recurrent wiring boosts synergy; feedback does not",
    "provenance": "introduced",
    "statement": "Among the connections forming a source-source-target computational unit, more connections between the two source neurons (recurrence) are associated with more synergistic integration, whereas connections running back from the target to the sources (feedback) show no reliable positive relationship with synergy.",
    "occurrences": [
      {
        "blockId": "spya-sd9fzd",
        "quote": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy.",
        "reasoning": "States the asymmetric relationship between two specific connectivity motifs and synergy that later sections build on to explain why rich clubs are synergy-dense.",
        "start": 0,
        "blockText": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy."
      },
      {
        "blockId": "spya-sd9fzd",
        "quote": "Finally, feedback connections were not significantly related to synergy.",
        "reasoning": "Confirms the negative result for feedback specifically, completing the asymmetric picture between recurrent and feedback wiring.",
        "start": 1152,
        "blockText": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy."
      }
    ]
  },
  {
    "id": "spya-f0ex9x",
    "name": "Synergy peaks at intermediate input correlation, then gives way to redundancy",
    "provenance": "introduced",
    "statement": "As the statistical similarity between two converging input neurons increases, the synergy they produce in a shared target first rises, peaks at a modest level of correlation, and then falls as redundancy takes over and dominates at high correlation.",
    "occurrences": [
      {
        "blockId": "spya-ybmve2",
        "quote": "Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease",
        "reasoning": "States the non-monotonic relationship between input similarity and synergy that is central to explaining why only moderately correlated inputs produce the most computation.",
        "start": 187,
        "blockText": "To test whether synergy increases indefinitely as mutual information grows at longer timescales, we explored a range extending well past the synaptic range (time bins up to 2.25 s wide). Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease (this level is marked by the vertical dotted line in Figure 4E). In the context of explaining the density of synergy in the rich club, the strong positive relationship between synergy and mutual information at synaptic timescales suggested that the activity of rich club neurons is generally more correlated than the activity of neurons outside the rich club. Indeed, rich clubs consist of a disproportionate number of inhibitory neurons with correlated spiking activity that synergistically predict the dynamics of the rest of the network [50]."
      },
      {
        "blockId": "spya-cs9fdy",
        "quote": "Redundancy was positively related to mutual information at all timescales. Indeed, the slope relating the redundancy to mutual information became steeper at longer timescales (Figure 4E).",
        "reasoning": "Shows the complementary trend in redundancy that explains why synergy's rise reverses once inputs become too similar.",
        "start": 536,
        "blockText": "Leveraging the multiple outputs that PID offers, including redundancy as well as synergy, we were able to explore how the overall composition of information propagation varies across timescales [3]. As we lengthened the timescale, the total multivariate transfer entropy between the source neurons and the target neuron increased steadily across all timescales examined. As noted already, however, synergy increased only at the shorter timescales and decreased at the longer timescales. Observing the redundancy offered an explanation. Redundancy was positively related to mutual information at all timescales. Indeed, the slope relating the redundancy to mutual information became steeper at longer timescales (Figure 4E). This suggests that as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed."
      }
    ]
  },
  {
    "id": "spya-qfuqp8",
    "name": "The number of information atoms explodes combinatorially",
    "provenance": "introduced",
    "statement": "As the number of input sources grows, the number of distinct partial information atoms grows according to the Dedekind numbers, a sequence that increases so fast that decomposing the inputs to even a modestly connected neuron becomes computationally intractable.",
    "occurrences": [
      {
        "blockId": "spya-aby2dp",
        "quote": "The most significant is the explosive growth of the PI lattice. For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30].",
        "reasoning": "Names the specific combinatorial law governing how fast the decomposition's complexity grows with the number of inputs.",
        "start": 116,
        "blockText": "The PID framework has a number of limitations that potentially complicate its application in naturalistic settings. The most significant is the explosive growth of the PI lattice. For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]. This sequence of numbers grows appallingly fast: in the case of six parent neurons, there are 7,828,354 distinct PI atoms, the vast majority of which are difficult to interpret. Dedekind numbers greater than nine are currently unknown. Given that single neurons can receive inputs from very large numbers of upstream neurons, a “complete” description of the information dynamics of any individual neuron is completely intractable. This issue may be partially addressed by the development of heuristic measures of redundancy and synergy such as the O-information [65], which has been applied to information dynamics in networks of neurons [66] and human functional magnetic resonance imaging blood-oxygen-level-dependent (fMRI-BOLD) signals [67], although these measures typically trade completeness for scalability."
      },
      {
        "blockId": "spya-aby2dp",
        "quote": "This sequence of numbers grows appallingly fast: in the case of six parent neurons, there are 7,828,354 distinct PI atoms, the vast majority of which are difficult to interpret.",
        "reasoning": "Gives a concrete number showing why a 'complete' decomposition is infeasible for realistically connected neurons, motivating the heuristic alternatives mentioned later.",
        "start": 302,
        "blockText": "The PID framework has a number of limitations that potentially complicate its application in naturalistic settings. The most significant is the explosive growth of the PI lattice. For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]. This sequence of numbers grows appallingly fast: in the case of six parent neurons, there are 7,828,354 distinct PI atoms, the vast majority of which are difficult to interpret. Dedekind numbers greater than nine are currently unknown. Given that single neurons can receive inputs from very large numbers of upstream neurons, a “complete” description of the information dynamics of any individual neuron is completely intractable. This issue may be partially addressed by the development of heuristic measures of redundancy and synergy such as the O-information [65], which has been applied to information dynamics in networks of neurons [66] and human functional magnetic resonance imaging blood-oxygen-level-dependent (fMRI-BOLD) signals [67], although these measures typically trade completeness for scalability."
      }
    ]
  }
]
```

## Candidate Z

```json
[
  {
    "id": "spya-d0a88e",
    "name": "Triad-level synergy sums up to network-wide computation",
    "provenance": "assumed",
    "statement": "The synergy values computed separately for thousands of individual two-source, one-target triads can be added together and compared across subsets of a network to characterize that network's overall, system-wide information processing.",
    "whyYouNeedIt": "Claims like 'rich club triads account for 88% of network-wide synergy' only follow if synergy computed triad-by-triad is a meaningful additive quantity at the scale of the whole network, which the triad-restricted method never itself demonstrates since full multi-source decomposition is intractable.",
    "occurrences": [
      {
        "blockId": "spya-fud8q3",
        "quote": "Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy.",
        "reasoning": "Treats a sum over many independently-computed triad synergies as a valid characterization of a single network-wide quantity, which requires assuming additivity across triads that the piece never justifies.",
        "start": 339,
        "blockText": "PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation."
      },
      {
        "blockId": "spya-q9gytb",
        "quote": "By far the most common approach to applying PID in neurosciences involves analyzing only triads, with two parents and a single target",
        "reasoning": "Restricting to triads is only a reasonable basis for system-level conclusions if triad-level results are assumed to generalize or aggregate to the network as a whole.",
        "start": 0,
        "blockText": "By far the most common approach to applying PID in neurosciences involves analyzing only triads, with two parents and a single target (for example, [2–4,20,28]); however, the PID framework is conceptually powerful enough to support any number of pre-synaptic elements. Unfortunately, in the case of three or more parents, the resulting system of equations is not as constrained as in the two-element case, as the number of distinct partial information atoms grows much faster than the number of known mutual information terms. The general PID framework requires the introduction of more involved mathematical machinery."
      }
    ]
  },
  {
    "id": "spya-czb5bv",
    "name": "Statistically inferred edges are treated as real circuit relations",
    "provenance": "assumed",
    "statement": "An effective network built purely from statistical dependency measures like transfer entropy is treated as though its edges correspond to genuine directed circuit relationships (feedforward, feedback, recurrent) that can be causally interpreted and measured for their effect on computation.",
    "whyYouNeedIt": "The claims that feedforward, feedback, and recurrent connections differentially predict synergy only make sense as claims about circuit structure and computation if the transfer-entropy-derived edges are standing in for real directed influence rather than mere statistical association; the article relies on this throughout its empirical sections before only briefly flagging the gap near the end.",
    "occurrences": [
      {
        "blockId": "spya-sw5ukx",
        "quote": "We then rendered the single-unit-level functional recording into an effective network, capturing the microcircuit dynamics using transfer entropy.",
        "reasoning": "Uses a purely statistical inference procedure and immediately calls its output 'microcircuit dynamics', presupposing the statistical edges track real circuit structure.",
        "start": 188,
        "blockText": "To gain traction on this problem, we used 512-channel multielectrode arrays to record hundreds of individual neurons in vitro from organotypic cultures derived from mouse cortical slices. We then rendered the single-unit-level functional recording into an effective network, capturing the microcircuit dynamics using transfer entropy. In our recordings, this revealed that about 0.4–1.0% of all possible directed connections between neurons were significant. From these, we then identified all triads consisting of two source neurons connecting to a common target neuron (totalling thousands of triads) and performed the full partial information decomposition into redundant, unique, and synergistic atoms. The numerous triads observable in a single recording make it possible to perform within-recording comparisons of the features that correlate with synergistic integration. This is illustrated in Figure 3."
      },
      {
        "blockId": "spya-j4cy9j",
        "quote": "the functional networks from which triads were drawn and against which the synergy values were compared were generated from bivariate transfer entropy analyses. This matters because it has been shown that bivariate analyses overestimate the significance of bivariate edges [51].",
        "reasoning": "This caveat only makes sense as a caveat if the preceding analyses had been treating the inferred edges as reliable structural facts, confirming the assumption was operative but unstated until this point.",
        "start": 133,
        "blockText": "There are a few important caveats to the empirical work described here that warrant caution and further attention. The first is that the functional networks from which triads were drawn and against which the synergy values were compared were generated from bivariate transfer entropy analyses. This matters because it has been shown that bivariate analyses overestimate the significance of bivariate edges [51]. A second caveat, related to the source of the data rather than the analyses, is that the processing we studied was in cortical cultures. This matters because it leaves open key questions about what we would observe if these analyses were performed in vivo. While organotypic cultures have been proven to share many of the key properties of uncultured cortical circuits (i.e., in the brain studied in vivo or via ex vivo histological analysis) [47], the demands placed on a circuit in the context of a behaving animal are certain to differ from those placed on cultures in vitro."
      }
    ]
  },
  {
    "id": "spya-aksnp4",
    "name": "Undirected similarity versus directed flow",
    "provenance": "introduced",
    "statement": "A measure of statistical dependence between two neurons' activity (like mutual information) only tells you they are related, corresponding to functional connectivity; only a directed, time-ordered measure (like transfer entropy) tells you one neuron's past is shaping another's future, corresponding to effective connectivity.",
    "occurrences": [
      {
        "blockId": "spya-f6sbgx",
        "quote": "It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as \"transfer\" or \"flow.\"",
        "reasoning": "States explicitly that mutual information cannot stand in for directed information flow.",
        "start": 626,
        "blockText": "Mutual information [12] can measure the dependence in the spiking between two neurons: I(X;Y) := ∑ x∈X y∈Y P(x, y)log2 P(x|y) P(x) (1) where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal probability of X, and P(x|y) is the conditional probability X = x given that Y = y. I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13]. This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”"
      },
      {
        "blockId": "spya-p4pyuy",
        "quote": "Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation.",
        "reasoning": "Names and contrasts the two kinds of connectivity that the rest of the article's methodology depends on distinguishing.",
        "start": 765,
        "blockText": "Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1), conditioned on Y’s own past (Yp): TE(X → Y) := (2) ∑ yt+1∈Y xp∈Xp yp∈Yp P(yt+1, yp, xp)log2 P(yt+1|xp, yp) P(yt+1|yp) TE(X → Y) is read as the transfer entropy from X’s past to Y’s future. It is important to note that Xp does not necessarily have to be a single moment or bin but can be a multi-dimensional and potentially non-uniform embedding [15–17]. TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation. In addition to measuring the magnitude of information flow between two neurons, in the special case of binary signals the TE can be modified to also provide a measure of excitation/inhibition balance using the sorted local transfer entropy [18]."
      }
    ]
  },
  {
    "id": "spya-uqp4ym",
    "name": "Whole information exceeds or falls short of the sum of its parts",
    "provenance": "introduced",
    "statement": "The information that a joint set of source neurons discloses about a target is not simply the sum of what each source discloses alone: if the joint information is larger than that sum, the sources are integrating information synergistically; if it is smaller, they are duplicating (redundant) information.",
    "occurrences": [
      {
        "blockId": "spya-h5dz45",
        "quote": "it cannot be assumed that the joint mutual information (the \"whole\") is reducible to a sum of all its component marginal \"parts\".",
        "reasoning": "States the core inequality that motivates the entire decomposition framework.",
        "start": 829,
        "blockText": "Individual neurons receive inputs from from many “parent” neurons, which are “integrated” into a single “decision” by the target neuron, i.e., whether to fire an action potential or not. Exactly how individual neurons “compute” their future behavior as a function of their inputs is a long-standing question in computational and theoretical neurosciences. We can quantify the total amount of information the inputs provide about the decision state of the target neuron using the joint mutual information: I(X;Y) = ∑ x∈X ∑ y∈Y P(x, y)log2 P(y|x) P(y) (3) where X = {X1, . . . , XN} is the set of all pre-synaptic parent neurons and Y is the single post-synaptic target neuron. We can also compute the individual information that single parents provide about the target with the marginal mutual information I(Xi;Y). Interestingly, it cannot be assumed that the joint mutual information (the “whole”) is reducible to a sum of all its component marginal “parts”. I(X;Y) 6= ∑ i=1 |X| I(Xi;Y). (4)"
      },
      {
        "blockId": "spya-e94ury",
        "quote": "If the left-hand side of Equation (4) (the \"whole\") is greater than the right-hand side (the sum of the \"parts\"), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics",
        "reasoning": "Explains that surplus-over-parts is interpreted as synergistic computation, the article's central explanatory move.",
        "start": 0,
        "blockText": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating “computation” on all of its inputs considered jointly (this is also sometimes referred to as “information modification” in the literature [19]). Conversely, if the whole is less than the sum of its parts, then there must be redundant information about Y instantiated multiple times over the parent neurons that is “double counted” when summing the marginals. The way that these pieces fit together is illustrated in Figure 1."
      }
    ]
  },
  {
    "id": "spya-m92436",
    "name": "A redundancy function builds the whole decomposition via the information lattice",
    "provenance": "introduced",
    "statement": "Once you specify a function that measures how much information is redundantly shared among any combination of sources, you can recursively compute every redundant, unique, and synergistic piece by subtracting out what is already accounted for by simpler combinations of sources below it on a partially ordered lattice.",
    "occurrences": [
      {
        "blockId": "spya-t8mg0s",
        "quote": "One of the key insights from Williams and Beer was that given a suitable measure of redundancy (which we will refer to as I∩(·)), it is possible to decompose the total joint mutual information into a finite set of unique, partial information atoms based on how all the elements of S share information about Y.",
        "reasoning": "Introduces the mechanism that turns a single redundancy measure into the full decomposition.",
        "start": 0,
        "blockText": "One of the key insights from Williams and Beer was that given a suitable measure of redundancy (which we will refer to as I∩(·)), it is possible to decompose the total joint mutual information into a finite set of unique, partial information atoms based on how all the elements of S share information about Y. This idealized redundancy function must satisfy a number of axioms (for further discussion, see [1,29,30]). For our purposes, it is sufficient to assume that an idealized I∩(·) function exists."
      },
      {
        "blockId": "spya-m37w5y",
        "quote": "Given this partially ordered lattice structure and our redundancy function I∩(·), it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion:",
        "reasoning": "States the recursive computational step (Möbius inversion over the lattice) that generalizes the two-source case to any number of sources.",
        "start": 199,
        "blockText": "This can be read as indicating that one element of A (α) is said to precede another element (β) on the lattice if every element of β has an associated element in α that is a superset or equal to it. Given this partially ordered lattice structure and our redundancy function I∩(·), it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion:"
      },
      {
        "blockId": "spya-aft2rx",
        "quote": "Intuitively, this can be understood as formalizing the notion that the information about Y that is only disclosed by the various Aᵢ ∈ α is that information that is not accessible in any simpler combination of sources lower down on the lattice.",
        "reasoning": "Explains the subtractive logic that makes the lattice-based decomposition work.",
        "start": 0,
        "blockText": "Intuitively, this can be understood as formalizing the notion that the information about Y that is only disclosed by the various Aᵢ ∈ α is that information that is not accessible in any simpler combination of sources lower down on the lattice. Representative example lattices for two and three predictor variables are shown in Figure 2. Finally, we can confirm that we have completed the decomposition by observing that:"
      }
    ]
  },
  {
    "id": "spya-tuqh5w",
    "name": "No single accepted measure of redundancy exists",
    "provenance": "introduced",
    "statement": "Because classical Shannon theory leaves the decomposition underdetermined, researchers must choose among nearly a dozen competing, non-equivalent redundancy functions, and this choice can change the resulting picture of synergy and redundancy.",
    "occurrences": [
      {
        "blockId": "spya-rc76qn",
        "quote": "Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed.",
        "reasoning": "Confirms that this is an open, unresolved practical issue a user of the framework must navigate.",
        "start": 0,
        "blockText": "Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks (such as only being defined for systems of a fixed size, only being amenable to discrete random variables, or requiring arbitrary thresholds). There are, at present, close to a dozen competing redundancy functions (see [22,29,31–40]). In the absence of a single accepted measure, different contexts may require the choice of different functions. For example, having more than two predictors precludes the measures proposed in [24,31], while continuous data cannot be analyzed with the measures proposed in [24,40], and so on. The majority of the studies discussed in this paper used the original Imin measure proposed in [1], although this measure has been criticized for unintuitive behavior [29,39]. For a deeper discussion of the practical considerations, see Section 6."
      }
    ]
  },
  {
    "id": "spya-y0u8aq",
    "name": "Densely interconnected hubs do disproportionately more computation",
    "provenance": "introduced",
    "statement": "Neurons belonging to a network's densely interconnected core (a rich club) and neurons with more recurrent connections among their inputs show substantially more synergistic integration than other neurons, so structural hubs are also computational hubs.",
    "occurrences": [
      {
        "blockId": "spya-fud8q3",
        "quote": "Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club",
        "reasoning": "States the empirical structure-function link between rich-club membership and synergy.",
        "start": 118,
        "blockText": "PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation."
      },
      {
        "blockId": "spya-sd9fzd",
        "quote": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy.",
        "reasoning": "Extends the structure-function finding to recurrent versus feedback connectivity motifs.",
        "start": 0,
        "blockText": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy."
      }
    ]
  },
  {
    "id": "spya-bqfux4",
    "name": "Synergy peaks at intermediate input correlation",
    "provenance": "introduced",
    "statement": "Synergistic integration is not maximized when source neurons are either completely independent or highly correlated; it peaks at an intermediate level of correlation between inputs and declines on either side, with redundancy taking over as correlation grows further.",
    "occurrences": [
      {
        "blockId": "spya-hkhpex",
        "quote": "The greater the mutual information between source neurons at the synaptic timescale, the greater the synergy [3].",
        "reasoning": "Establishes the rising portion of the relationship between source correlation and synergy.",
        "start": 450,
        "blockText": "In addition to questions about network topology, we also examined whether synergy varies based on the functional similarity of converging information streams. We tested whether there was a systematic correlation between the synergy of a triad and the mutual information in the source-neuron activities. Initially, we tested this for timescales in the synaptic range (<14 ms), consistent with the analyses described above. The result was unambiguous. The greater the mutual information between source neurons at the synaptic timescale, the greater the synergy [3]. More information processing occurs where similar information streams converge (Figure 4E, the three leftmost panels for synaptic timescales)."
      },
      {
        "blockId": "spya-ybmve2",
        "quote": "Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease",
        "reasoning": "Shows the non-monotonic, intermediate-peak shape that qualifies the simpler 'more correlation, more synergy' intuition.",
        "start": 187,
        "blockText": "To test whether synergy increases indefinitely as mutual information grows at longer timescales, we explored a range extending well past the synaptic range (time bins up to 2.25 s wide). Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease (this level is marked by the vertical dotted line in Figure 4E). In the context of explaining the density of synergy in the rich club, the strong positive relationship between synergy and mutual information at synaptic timescales suggested that the activity of rich club neurons is generally more correlated than the activity of neurons outside the rich club. Indeed, rich clubs consist of a disproportionate number of inhibitory neurons with correlated spiking activity that synergistically predict the dynamics of the rest of the network [50]."
      }
    ]
  },
  {
    "id": "spya-qfy235",
    "name": "The decomposition explodes combinatorially with more sources",
    "provenance": "introduced",
    "statement": "The number of distinct redundant/unique/synergistic atoms needed to fully decompose information from many sources grows according to the Dedekind numbers, a sequence that explodes so fast that complete decomposition becomes computationally intractable beyond a handful of sources.",
    "occurrences": [
      {
        "blockId": "spya-aby2dp",
        "quote": "For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]. This sequence of numbers grows appallingly fast: in the case of six parent neurons, there are 7,828,354 distinct PI atoms",
        "reasoning": "States the scaling law that limits the framework's applicability to systems with more than a few sources.",
        "start": 180,
        "blockText": "The PID framework has a number of limitations that potentially complicate its application in naturalistic settings. The most significant is the explosive growth of the PI lattice. For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]. This sequence of numbers grows appallingly fast: in the case of six parent neurons, there are 7,828,354 distinct PI atoms, the vast majority of which are difficult to interpret. Dedekind numbers greater than nine are currently unknown. Given that single neurons can receive inputs from very large numbers of upstream neurons, a “complete” description of the information dynamics of any individual neuron is completely intractable. This issue may be partially addressed by the development of heuristic measures of redundancy and synergy such as the O-information [65], which has been applied to information dynamics in networks of neurons [66] and human functional magnetic resonance imaging blood-oxygen-level-dependent (fMRI-BOLD) signals [67], although these measures typically trade completeness for scalability."
      }
    ]
  }
]
```
