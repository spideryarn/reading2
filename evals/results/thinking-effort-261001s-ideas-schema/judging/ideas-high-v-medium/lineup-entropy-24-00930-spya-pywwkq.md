# 4 candidates for "Revealing the Dynamics of Neural Information Processing with Multivariate Information Decomposition"

Each candidate is the ideas a reader needs in order to get this article, each tied to the passages that carry it. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-entropy-24-00930-spya-pywwkq.md` beside this file.

## Candidate W

```json
[
  {
    "id": "spya-bujg2d",
    "name": "Undirected dependency versus directed influence between neurons",
    "provenance": "assumed",
    "statement": "A measure of how much knowing one variable's state reduces uncertainty about another's current state (an undirected, instantaneous dependency) is a fundamentally different quantity from a measure of how one variable's past states shape another's future beyond what the target's own history already explains (a directed, time-ordered influence).",
    "whyYouNeedIt": "The argument for needing transfer entropy, and later PID, depends on recognizing that mutual information alone cannot speak to directional flow or computation; without already holding the distinction between dependency and directed influence, the move from mutual information to transfer entropy to PID looks arbitrary rather than necessary.",
    "occurrences": [
      {
        "blockId": "spya-f6sbgx",
        "quote": "It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as \"transfer\" or \"flow.\"",
        "reasoning": "The passage asserts a limitation of mutual information that only makes sense if the reader already separates 'dependency' from 'directed flow' as distinct concepts.",
        "start": 626,
        "blockText": "Mutual information [12] can measure the dependence in the spiking between two neurons: I(X;Y) := ∑ x∈X y∈Y P(x, y)log2 P(x|y) P(x) (1) where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal probability of X, and P(x|y) is the conditional probability X = x given that Y = y. I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13]. This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”"
      },
      {
        "blockId": "spya-p4pyuy",
        "quote": "Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity",
        "reasoning": "This contrast presumes the reader already holds the undirected/directed distinction in order to grasp why two different tools are needed at all.",
        "start": 765,
        "blockText": "Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1), conditioned on Y’s own past (Yp): TE(X → Y) := (2) ∑ yt+1∈Y xp∈Xp yp∈Yp P(yt+1, yp, xp)log2 P(yt+1|xp, yp) P(yt+1|yp) TE(X → Y) is read as the transfer entropy from X’s past to Y’s future. It is important to note that Xp does not necessarily have to be a single moment or bin but can be a multi-dimensional and potentially non-uniform embedding [15–17]. TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation. In addition to measuring the magnitude of information flow between two neurons, in the special case of binary signals the TE can be modified to also provide a measure of excitation/inhibition balance using the sorted local transfer entropy [18]."
      }
    ]
  },
  {
    "id": "spya-krfeda",
    "name": "A neuron's firing is a statistical decision computed over joint input states",
    "provenance": "assumed",
    "statement": "A target neuron's choice to fire or not can be treated as a variable whose uncertainty is reduced by the joint pattern of its presynaptic inputs' past activity, so that 'computation' is modeled as the amount by which joint input states shrink uncertainty about that future firing decision.",
    "whyYouNeedIt": "The entire motivation for using PID on triads of neurons depends on treating spiking as a 'decision' reducible via information-theoretic uncertainty, a framing that is never argued for but without which the setup of sources, target, and 'past states reducing uncertainty about future state' would not make sense as a model of neural computation.",
    "occurrences": [
      {
        "blockId": "spya-h5dz45",
        "quote": "Individual neurons receive inputs from from many \"parent\" neurons, which are \"integrated\" into a single \"decision\" by the target neuron, i.e., whether to fire an action potential or not.",
        "reasoning": "Frames firing as a decision problem, a framing the PID formalism is then built on without justifying why firing should be modeled this way.",
        "start": 0,
        "blockText": "Individual neurons receive inputs from from many “parent” neurons, which are “integrated” into a single “decision” by the target neuron, i.e., whether to fire an action potential or not. Exactly how individual neurons “compute” their future behavior as a function of their inputs is a long-standing question in computational and theoretical neurosciences. We can quantify the total amount of information the inputs provide about the decision state of the target neuron using the joint mutual information: I(X;Y) = ∑ x∈X ∑ y∈Y P(x, y)log2 P(y|x) P(y) (3) where X = {X1, . . . , XN} is the set of all pre-synaptic parent neurons and Y is the single post-synaptic target neuron. We can also compute the individual information that single parents provide about the target with the marginal mutual information I(Xi;Y). Interestingly, it cannot be assumed that the joint mutual information (the “whole”) is reducible to a sum of all its component marginal “parts”. I(X;Y) 6= ∑ i=1 |X| I(Xi;Y). (4)"
      },
      {
        "blockId": "spya-u5ra3d",
        "quote": "we are interested in knowing how the past states of X1 and X2 reduce our uncertainty about the future state of Y",
        "reasoning": "Only makes sense as a model of neural computation if one already accepts that uncertainty-reduction about firing is what 'processing information' means for a neuron.",
        "start": 321,
        "blockText": "Multivariate information decomposition is a branch of information theory that endeavors to dissect out the atoms of information processing from a system of interacting units. Consider the simplest case of two neurons (X1 and X2) that jointly synapse onto a target Y. To understand how Y processes input from the sources, we are interested in knowing how the past states of X1 and X2 reduce our uncertainty about the future state of Y. To understand this, we must know: 1. The future state of Y (Yt+1); 2. The past state of the target Y (Yp); 3. The past state of X1 (X1p); 4. The past state of X2 (X2p)."
      }
    ]
  },
  {
    "id": "spya-c5tya3",
    "name": "Synergy as the irreducible 'more' of combined inputs",
    "provenance": "introduced",
    "statement": "The information that the joint state of several source neurons gives about a target can be strictly greater than the sum of what each source gives alone; this surplus is synergistic information and marks a genuine combination, not just addition, of inputs.",
    "occurrences": [
      {
        "blockId": "spya-h5dz45",
        "quote": "it cannot be assumed that the joint mutual information (the \"whole\") is reducible to a sum of all its component marginal \"parts\"",
        "reasoning": "States the inequality that synergy is built on.",
        "start": 829,
        "blockText": "Individual neurons receive inputs from from many “parent” neurons, which are “integrated” into a single “decision” by the target neuron, i.e., whether to fire an action potential or not. Exactly how individual neurons “compute” their future behavior as a function of their inputs is a long-standing question in computational and theoretical neurosciences. We can quantify the total amount of information the inputs provide about the decision state of the target neuron using the joint mutual information: I(X;Y) = ∑ x∈X ∑ y∈Y P(x, y)log2 P(y|x) P(y) (3) where X = {X1, . . . , XN} is the set of all pre-synaptic parent neurons and Y is the single post-synaptic target neuron. We can also compute the individual information that single parents provide about the target with the marginal mutual information I(Xi;Y). Interestingly, it cannot be assumed that the joint mutual information (the “whole”) is reducible to a sum of all its component marginal “parts”. I(X;Y) 6= ∑ i=1 |X| I(Xi;Y). (4)"
      },
      {
        "blockId": "spya-e94ury",
        "quote": "If the left-hand side of Equation (4) (the \"whole\") is greater than the right-hand side (the sum of the \"parts\"), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent.",
        "reasoning": "Defines synergy directly from the whole-exceeds-parts inequality.",
        "start": 0,
        "blockText": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating “computation” on all of its inputs considered jointly (this is also sometimes referred to as “information modification” in the literature [19]). Conversely, if the whole is less than the sum of its parts, then there must be redundant information about Y instantiated multiple times over the parent neurons that is “double counted” when summing the marginals. The way that these pieces fit together is illustrated in Figure 1."
      },
      {
        "blockId": "spya-pjdgu6",
        "quote": "the joint state of X1 and X2 can account for the activity of Y to some degree. This information is not accounted for by either source independently",
        "reasoning": "Figure caption restates synergy as information only visible in the joint state.",
        "start": 716,
        "blockText": "Figure 1. The total information contained in the activity of two source neurons X1 and X2 about the activity of a target neuron Y consists of multiple parts. This total information, I(X1, X2;Y), is represented by the outermost oval. Contained within this total is the information that X1 and X2 each independently carry about Y, represented by the red circle for I(X1;Y) and the blue circle for I(X2;Y). These independent sources can carry redundant information, represented by the overlapping striped section labeled Red(X1, X2;Y). The non-redundant information each source neuron accounts for is the unique information Unq(X1;Y) and Unq(X2;Y). Finally, and most relevantly for the study of information processing, the joint state of X1 and X2 can account for the activity of Y to some degree. This information is not accounted for by either source independently and is the synergistic information that X1 and X2 carry about Y, i.e., Syn(X1, X2;Y). The purple space making up the difference between what is included in the I(X1;Y) and I(X2;Y) circles and the total information I(X1, X2;Y) represents Syn(X1, X2;Y)."
      }
    ]
  },
  {
    "id": "spya-cq3hzg",
    "name": "PID splits total shared information into redundant/unique/synergistic atoms via a lattice",
    "provenance": "introduced",
    "statement": "Given a measure of redundancy, the total information that any set of sources carries about a target can be uniquely broken into non-overlapping pieces (redundant, unique to each source, and synergistic among subsets), arranged on a partially ordered lattice and recovered via Mobius inversion.",
    "occurrences": [
      {
        "blockId": "spya-t02v4p",
        "quote": "it was not until the seminal work of Williams and Beer [1] that it was recognized how to algebraically decompose the total joint mutual information into the particular contributions of the parts (and higher-order ensembles of parts)",
        "reasoning": "States the core decomposition claim.",
        "start": 58,
        "blockText": "This inequality has been recognized for decades; however, it was not until the seminal work of Williams and Beer [1] that it was recognized how to algebraically decompose the total joint mutual information into the particular contributions of the parts (and higher-order ensembles of parts). Since its introduction, this framework, termed partial information decomposition, has been widely applied in fields from theoretical and computational neuroscience [9,21] to climate modeling [22] and sociology [23]."
      },
      {
        "blockId": "spya-m37w5y",
        "quote": "it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion",
        "reasoning": "Gives the mechanism (Mobius inversion) by which atom values are computed.",
        "start": 281,
        "blockText": "This can be read as indicating that one element of A (α) is said to precede another element (β) on the lattice if every element of β has an associated element in α that is a superset or equal to it. Given this partially ordered lattice structure and our redundancy function I∩(·), it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion:"
      }
    ]
  },
  {
    "id": "spya-sp5gwv",
    "name": "Redundancy cannot be derived from Shannon theory alone",
    "provenance": "introduced",
    "statement": "Classical information theory leaves the four PID quantities underdetermined given only the three mutual-information equations, so some extra, non-unique choice of redundancy function must be imposed before synergy and unique information can be computed.",
    "occurrences": [
      {
        "blockId": "spya-rc76qn",
        "quote": "To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks",
        "reasoning": "Shows the consequence: many competing, non-equivalent redundancy functions exist because none is forced by the math.",
        "start": 112,
        "blockText": "Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks (such as only being defined for systems of a fixed size, only being amenable to discrete random variables, or requiring arbitrary thresholds). There are, at present, close to a dozen competing redundancy functions (see [22,29,31–40]). In the absence of a single accepted measure, different contexts may require the choice of different functions. For example, having more than two predictors precludes the measures proposed in [24,31], while continuous data cannot be analyzed with the measures proposed in [24,40], and so on. The majority of the studies discussed in this paper used the original Imin measure proposed in [1], although this measure has been criticized for unintuitive behavior [29,39]. For a deeper discussion of the practical considerations, see Section 6."
      }
    ]
  },
  {
    "id": "spya-adr2jj",
    "name": "Synergy concentrates in network rich clubs",
    "provenance": "introduced",
    "statement": "The densely interconnected 'rich club' of highly-connected neurons accounts for a hugely disproportionate share of a circuit's synergistic (computational) activity relative to its size.",
    "occurrences": [
      {
        "blockId": "spya-fud8q3",
        "quote": "the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club",
        "reasoning": "Directly reports the concentration of synergy in rich-club triads.",
        "start": 222,
        "blockText": "PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation."
      },
      {
        "blockId": "spya-fud8q3",
        "quote": "Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy",
        "reasoning": "Quantifies the disproportionate share of computation located in the rich club.",
        "start": 524,
        "blockText": "PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation."
      }
    ]
  },
  {
    "id": "spya-dbscf6",
    "name": "Recurrent connectivity, not feedback, drives extra synergy",
    "provenance": "introduced",
    "statement": "Triads with more connections between the two source neurons (recurrence) show higher synergy, whereas connections running back from the target to the sources (feedback) do not reliably increase and may slightly reduce synergy.",
    "occurrences": [
      {
        "blockId": "spya-sd9fzd",
        "quote": "triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy",
        "reasoning": "States the differential effect of recurrent versus feedback connections on synergy.",
        "start": 25,
        "blockText": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy."
      }
    ]
  },
  {
    "id": "spya-ztsw7f",
    "name": "Synergy peaks at intermediate, not maximal, input similarity",
    "provenance": "introduced",
    "statement": "As the correlation between two converging input streams increases, synergy first rises but then falls once the inputs become too similar, with synergy maximal at a modest, not high, level of shared information; beyond that point redundancy dominates instead.",
    "occurrences": [
      {
        "blockId": "spya-ybmve2",
        "quote": "the peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease",
        "reasoning": "States the non-monotonic relationship directly.",
        "start": 240,
        "blockText": "To test whether synergy increases indefinitely as mutual information grows at longer timescales, we explored a range extending well past the synaptic range (time bins up to 2.25 s wide). Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease (this level is marked by the vertical dotted line in Figure 4E). In the context of explaining the density of synergy in the rich club, the strong positive relationship between synergy and mutual information at synaptic timescales suggested that the activity of rich club neurons is generally more correlated than the activity of neurons outside the rich club. Indeed, rich clubs consist of a disproportionate number of inhibitory neurons with correlated spiking activity that synergistically predict the dynamics of the rest of the network [50]."
      },
      {
        "blockId": "spya-cs9fdy",
        "quote": "synergy increased only at the shorter timescales and decreased at the longer timescales. Observing the redundancy offered an explanation. Redundancy was positively related to mutual information at all timescales.",
        "reasoning": "Explains the fall in synergy as a takeover by redundancy once inputs are sufficiently correlated.",
        "start": 398,
        "blockText": "Leveraging the multiple outputs that PID offers, including redundancy as well as synergy, we were able to explore how the overall composition of information propagation varies across timescales [3]. As we lengthened the timescale, the total multivariate transfer entropy between the source neurons and the target neuron increased steadily across all timescales examined. As noted already, however, synergy increased only at the shorter timescales and decreased at the longer timescales. Observing the redundancy offered an explanation. Redundancy was positively related to mutual information at all timescales. Indeed, the slope relating the redundancy to mutual information became steeper at longer timescales (Figure 4E). This suggests that as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed."
      }
    ]
  },
  {
    "id": "spya-useksm",
    "name": "Synergy/redundancy balance shifts with task demands",
    "provenance": "introduced",
    "statement": "The relative amounts of synergistic versus redundant information carried by a circuit are not fixed properties of anatomy but change with the behavioral phase, with redundancy rising when reliable, duplicated signal transmission is needed (e.g., during movement execution).",
    "occurrences": [
      {
        "blockId": "spya-t8fayf",
        "quote": "while brain activity was generally synergy-dominated (as opposed to redundancy-dominated), during movement execution (a reach-and-grasp action) the relative abundance of redundant information increased dramatically",
        "reasoning": "Directly states the task-dependent shift from synergy to redundancy.",
        "start": 216,
        "blockText": "The ability to assess how the structure of information processes changes in response to the demands of different tasks is a significant departure from the limitations of in vitro research. The researchers found that while brain activity was generally synergy-dominated (as opposed to redundancy-dominated), during movement execution (a reach-and-grasp action) the relative abundance of redundant information increased dramatically. This increase in relative redundancy was interpreted as a response to the practical requirements of the task: during motor execution, the brain needs to send the “move” signal to distant muscles, and to ensure high-fidelity transmission the brain may duplicate information many times over (minimizing the risk of a single corrupted signal leading to erroneous behavior). Similarly, different brain regions had different relative synergies during different tasks. For example, AIP (a pre-motor region) had the highest synergy during the fixation/cueing epoch, which then dropped off during movement, while M1 (the primary motor region) had the lowest synergy during the memory epoch, which then exploded during movement execution."
      },
      {
        "blockId": "spya-t8fayf",
        "quote": "during motor execution, the brain needs to send the \"move\" signal to distant muscles, and to ensure high-fidelity transmission the brain may duplicate information many times over",
        "reasoning": "Gives the functional interpretation linking redundancy to reliable signal transmission.",
        "start": 542,
        "blockText": "The ability to assess how the structure of information processes changes in response to the demands of different tasks is a significant departure from the limitations of in vitro research. The researchers found that while brain activity was generally synergy-dominated (as opposed to redundancy-dominated), during movement execution (a reach-and-grasp action) the relative abundance of redundant information increased dramatically. This increase in relative redundancy was interpreted as a response to the practical requirements of the task: during motor execution, the brain needs to send the “move” signal to distant muscles, and to ensure high-fidelity transmission the brain may duplicate information many times over (minimizing the risk of a single corrupted signal leading to erroneous behavior). Similarly, different brain regions had different relative synergies during different tasks. For example, AIP (a pre-motor region) had the highest synergy during the fixation/cueing epoch, which then dropped off during movement, while M1 (the primary motor region) had the lowest synergy during the memory epoch, which then exploded during movement execution."
      }
    ]
  }
]
```

## Candidate X

```json
[
  {
    "id": "spya-cqd98j",
    "name": "Total information is not just the sum of its parts",
    "provenance": "assumed",
    "statement": "The combined information that several variables carry about an outcome cannot generally be found by adding up what each variable carries on its own; interaction effects can make the whole larger or smaller than that sum.",
    "whyYouNeedIt": "The entire motivation for decomposing information into redundant, unique, and synergistic pieces only makes sense if the reader already grants that simple summation of individual mutual informations can fail; otherwise Equation (4) looks like an odd curiosity rather than the reason the whole framework exists.",
    "occurrences": [
      {
        "blockId": "spya-h5dz45",
        "quote": "Interestingly, it cannot be assumed that the joint mutual information (the “whole”) is reducible to a sum of all its component marginal “parts”.",
        "reasoning": "The claim is stated almost in passing as 'interesting' rather than argued for, relying on the reader accepting nonadditivity of information as plausible from the outset.",
        "start": 814,
        "blockText": "Individual neurons receive inputs from from many “parent” neurons, which are “integrated” into a single “decision” by the target neuron, i.e., whether to fire an action potential or not. Exactly how individual neurons “compute” their future behavior as a function of their inputs is a long-standing question in computational and theoretical neurosciences. We can quantify the total amount of information the inputs provide about the decision state of the target neuron using the joint mutual information: I(X;Y) = ∑ x∈X ∑ y∈Y P(x, y)log2 P(y|x) P(y) (3) where X = {X1, . . . , XN} is the set of all pre-synaptic parent neurons and Y is the single post-synaptic target neuron. We can also compute the individual information that single parents provide about the target with the marginal mutual information I(Xi;Y). Interestingly, it cannot be assumed that the joint mutual information (the “whole”) is reducible to a sum of all its component marginal “parts”. I(X;Y) 6= ∑ i=1 |X| I(Xi;Y). (4)"
      },
      {
        "blockId": "spya-s0db2g",
        "quote": "it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources",
        "reasoning": "This framing presupposes that interaction among information streams is a real, distinct phenomenon worth separating out, which is exactly the non-additivity premise.",
        "start": 93,
        "blockText": "Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]. How does one examine information processing itself? We propose that one successful avenue is that of multivariate information decomposition [1]."
      }
    ]
  },
  {
    "id": "spya-bu0bhe",
    "name": "Statistical dependency structure is treated as a window onto actual neural computation",
    "provenance": "assumed",
    "statement": "Patterns of redundant, unique, and synergistic statistical dependency among recorded neurons are taken to reflect real information-processing operations the circuit is performing, not merely incidental correlational structure.",
    "whyYouNeedIt": "Without granting that these statistical quantities track genuine computation, findings like 'rich clubs process more information' or 'synergy reflects task demands' would just be redescriptions of correlation patterns rather than claims about what circuits are doing, which is how the empirical sections are written.",
    "occurrences": [
      {
        "blockId": "spya-q09pga",
        "quote": "we focus on recent applications of PID to activity recorded from systems of spiking biological neurons and on how this statistical framework can provide insights into the nature of “computation” in cortical circuits",
        "reasoning": "Frames purely statistical decomposition results as insight into computation, which requires assuming the statistics track real processing.",
        "start": 6,
        "blockText": "Here, we focus on recent applications of PID to activity recorded from systems of spiking biological neurons and on how this statistical framework can provide insights into the nature of “computation” in cortical circuits. In the next section, we introduce the intuition behind PID in more detail, before building to the full mathematical definition and discussing the various technical desiderata that an aspiring researcher must consider when applying a PID analysis to their own data."
      },
      {
        "blockId": "spya-b32ecw",
        "quote": "synergy seems to reflect behaviorally specific patterns of dynamical activity in the cortex",
        "reasoning": "Draws a conclusion about behavior and cortical function from statistical synergy values, presupposing the statistic indexes real processing rather than coincidence.",
        "start": 133,
        "blockText": "These results show not only that synergistic information dynamics is a feature of ongoing, spontaneous neural activity but also that synergy seems to reflect behaviorally specific patterns of dynamical activity in the cortex."
      },
      {
        "blockId": "spya-spdx0y",
        "quote": "while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation",
        "reasoning": "This late caveat only makes sense as a corrective if the preceding sections had been implicitly treating statistical synergy as more than mere dependency, i.e., as processing.",
        "start": 80,
        "blockText": "One important caveat to note with respect to PID applied to neural data is that while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated. Now that the existence of statistical synergies is well replicated, a natural future avenue of research might be to attempt to determine how particular biological aspects of neuronal function (e.g., neurotransmitter systems, neural architecture, etc.) produce redundant, unique, or synergistic computational dynamics."
      }
    ]
  },
  {
    "id": "spya-ufv2j8",
    "name": "Flow versus integration: transfer entropy vs mutual information",
    "provenance": "introduced",
    "statement": "Mutual information measures undirected statistical dependence between two signals (functional connectivity), while transfer entropy measures how much a source's past reduces uncertainty about a target's future beyond the target's own history (effective connectivity, i.e. directed information flow).",
    "occurrences": [
      {
        "blockId": "spya-f6sbgx",
        "quote": "It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables",
        "reasoning": "States the limitation of mutual information relative to directed flow.",
        "start": 626,
        "blockText": "Mutual information [12] can measure the dependence in the spiking between two neurons: I(X;Y) := ∑ x∈X y∈Y P(x, y)log2 P(x|y) P(x) (1) where P(x, y) is the probability distribution of the joint state of X and Y, P(x) is the marginal probability of X, and P(x|y) is the conditional probability X = x given that Y = y. I(X;Y) measures how our ability to correctly infer the state of X changes, depending on whether we are accounting for (potentially) shared dependencies with Y. It can be thought of as a nonlinear correlation between two patterns of activity [3,13]. This similarity is related to functional connectivity [14]. It does not, however, quantify information transfer between the neurons, as it is an undirected measure that describes the instantaneous dependency between two variables and has no notion of the time-directed structure that we intuitively understand as “transfer” or “flow.”"
      },
      {
        "blockId": "spya-p4pyuy",
        "quote": "Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity",
        "reasoning": "Directly draws the distinction that organizes the rest of the article's toolkit.",
        "start": 765,
        "blockText": "Transfer entropy [11] is well suited to measuring how much the past activity of one neuron (e.g., Xp) accounts for the immediate future activity of another neuron (e.g., Yt+1), conditioned on Y’s own past (Yp): TE(X → Y) := (2) ∑ yt+1∈Y xp∈Xp yp∈Yp P(yt+1, yp, xp)log2 P(yt+1|xp, yp) P(yt+1|yp) TE(X → Y) is read as the transfer entropy from X’s past to Y’s future. It is important to note that Xp does not necessarily have to be a single moment or bin but can be a multi-dimensional and potentially non-uniform embedding [15–17]. TE is understood as quantifying how much the past of the source variable reduces our uncertainty about the future of the target variable, after accounting for information disclosed by the target variable’s own past (autocorrelation). Whereas mutual information is a measure of functional connectivity, transfer entropy measures effective connectivity [14]. In other words, transfer entropy provides a measure of information propagation. In addition to measuring the magnitude of information flow between two neurons, in the special case of binary signals the TE can be modified to also provide a measure of excitation/inhibition balance using the sorted local transfer entropy [18]."
      }
    ]
  },
  {
    "id": "spya-mcyucb",
    "name": "Synergy as the signature of computation",
    "provenance": "introduced",
    "statement": "When the joint information that multiple neurons' past activity carries about a target's future exceeds what any of them carry individually, that extra, only-jointly-available information is called synergy, and it marks a form of genuine integration rather than simple summation.",
    "occurrences": [
      {
        "blockId": "spya-e94ury",
        "quote": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent.",
        "reasoning": "This passage introduces synergy as the core explanatory construct of the whole review.",
        "start": 0,
        "blockText": "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent. In this case, the system exhibits synergistic dynamics, and the target neuron can be thought of as performing a kind of integrating “computation” on all of its inputs considered jointly (this is also sometimes referred to as “information modification” in the literature [19]). Conversely, if the whole is less than the sum of its parts, then there must be redundant information about Y instantiated multiple times over the parent neurons that is “double counted” when summing the marginals. The way that these pieces fit together is illustrated in Figure 1."
      }
    ]
  },
  {
    "id": "spya-b6y8nw",
    "name": "A redundancy measure is the missing piece that fixes the whole decomposition",
    "provenance": "introduced",
    "statement": "Because the equations relating joint and marginal mutual informations to redundant, unique, and synergistic parts are underdetermined, defining any one of these quantities (conventionally redundancy) algebraically determines all the others.",
    "occurrences": [
      {
        "blockId": "spya-bgsd4n",
        "quote": "The result is an underdetermined system of linear equations, with three known values (the mutual information terms) and four unknown values (the partial information terms). If any of the unknown terms can be defined, then the other three emerge \"for free\".",
        "reasoning": "This states the logical structure that makes a chosen redundancy function the linchpin of any PID analysis.",
        "start": 0,
        "blockText": "The result is an underdetermined system of linear equations, with three known values (the mutual information terms) and four unknown values (the partial information terms). If any of the unknown terms can be defined, then the other three emerge “for free”. Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each. The most common approach is to define a redundancy function such as the original proposal of Imin [1] (for more on redundancy functions, see Section 4.3), although there have also been proposals that start with the unique information [24,25] or synergy [26,27]."
      },
      {
        "blockId": "spya-rc76qn",
        "quote": "Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed.",
        "reasoning": "Reinforces that the whole decomposition hinges on an unsettled choice of redundancy function.",
        "start": 0,
        "blockText": "Applying PID analyses to real data requires some notion of redundant information (I∩(·)) to be operationalized. To date, no single universally accepted measure has been proposed. All measures have their own trade-offs and drawbacks (such as only being defined for systems of a fixed size, only being amenable to discrete random variables, or requiring arbitrary thresholds). There are, at present, close to a dozen competing redundancy functions (see [22,29,31–40]). In the absence of a single accepted measure, different contexts may require the choice of different functions. For example, having more than two predictors precludes the measures proposed in [24,31], while continuous data cannot be analyzed with the measures proposed in [24,40], and so on. The majority of the studies discussed in this paper used the original Imin measure proposed in [1], although this measure has been criticized for unintuitive behavior [29,39]. For a deeper discussion of the practical considerations, see Section 6."
      }
    ]
  },
  {
    "id": "spya-j6bu7n",
    "name": "The partial information lattice decomposes information into non-overlapping atoms",
    "provenance": "introduced",
    "statement": "By ordering all subsets of sources that could disclose information about a target into a lattice (excluding subset-redundant combinations) and applying Mobius inversion with a chosen redundancy function, the total joint information can be split into a complete set of non-overlapping 'atoms' representing every distinct mode of information-sharing.",
    "occurrences": [
      {
        "blockId": "spya-t8mg0s",
        "quote": "it is possible to decompose the total joint mutual information into a finite set of unique, partial information atoms based on how all the elements of S share information about Y",
        "reasoning": "States the general lattice-based decomposition that extends the two-source intuition to arbitrary numbers of sources.",
        "start": 130,
        "blockText": "One of the key insights from Williams and Beer was that given a suitable measure of redundancy (which we will refer to as I∩(·)), it is possible to decompose the total joint mutual information into a finite set of unique, partial information atoms based on how all the elements of S share information about Y. This idealized redundancy function must satisfy a number of axioms (for further discussion, see [1,29,30]). For our purposes, it is sufficient to assume that an idealized I∩(·) function exists."
      },
      {
        "blockId": "spya-m37w5y",
        "quote": "Given this partially ordered lattice structure and our redundancy function I∩(·), it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion",
        "reasoning": "Describes the mechanism (Mobius inversion over the lattice) that produces the atomic decomposition.",
        "start": 199,
        "blockText": "This can be read as indicating that one element of A (α) is said to precede another element (β) on the lattice if every element of β has an associated element in α that is a superset or equal to it. Given this partially ordered lattice structure and our redundancy function I∩(·), it is possible to recursively quantify the value of every partial information atom (Π(α)) via Mobius inversion:"
      }
    ]
  },
  {
    "id": "spya-n9f2mu",
    "name": "Rich clubs are disproportionate hubs of information processing",
    "provenance": "introduced",
    "statement": "The small, densely interconnected set of highest-degree neurons in a network (the rich club) accounts for a much larger share of synergistic computation than its size would predict, because it combines high information propagation with high connectivity among its own members.",
    "occurrences": [
      {
        "blockId": "spya-fud8q3",
        "quote": "Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy.",
        "reasoning": "Directly presents the empirical finding that defines this idea.",
        "start": 524,
        "blockText": "PID allowed us to test whether triads inside the rich club have greater synergy than those outside the rich club [2]. Unambiguously, rich club triads processed more information than triads outside rich clubs. Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B). Due to rich clubs having a high density of triads and rich club triads having a greater synergy per triad, a majority of the network-wide synergy was accounted for by rich club triads. Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy. We also found that there was a strong positive correlation between the rich club coefficient and the average synergy produced by rich club triads, suggesting that the rich club structure itself was related to the amount of computation."
      },
      {
        "blockId": "spya-bftp48",
        "quote": "Rich clubs, in the context of the effective networks built from cortical circuit spiking recordings, are comprised of the neurons that propagate the most information",
        "reasoning": "Sets up why rich clubs would be expected to be computational hotspots, motivating the later empirical test.",
        "start": 457,
        "blockText": "The observation that information propagation correlates with information processing suggests that rich clubs may be dense cores of information processing. Rich clubs generally represent the set of best-connected nodes of a network that are mutually interconnected with a probability higher than that expected by chance [48]. The rich club coefficient quantifies just how much more densely connected a given set of nodes is than would be expected by chance. Rich clubs, in the context of the effective networks built from cortical circuit spiking recordings, are comprised of the neurons that propagate the most information (i.e., sending and receiving). By definition, rich clubs are disproportionately dense in information propagation: 20% of the neurons account for 70% of the information propagation in organotypic cortical cultures [49]."
      }
    ]
  },
  {
    "id": "spya-xgem67",
    "name": "Recurrent connectivity boosts synergy more than feedback does",
    "provenance": "introduced",
    "statement": "Among the connection types in a converging triad, additional recurrent connections between the two source neurons increase synergistic integration, while feedback connections from the target back to the sources do not reliably increase it and may even reduce it.",
    "occurrences": [
      {
        "blockId": "spya-sd9fzd",
        "quote": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy.",
        "reasoning": "States the core comparative finding about connection types and synergy.",
        "start": 0,
        "blockText": "Using PID, we found that triads with more recurrent connections also had greater synergy [4]. Feedback connections were less predictive of synergy but tended to correlate with reduced synergy. Numerically, in comparison to the simplest computational triads (those with no feedback or recurrent connections), triads with two recurrent connections and no feedback connections had 50% more synergy (Figure 4C). Triads with two feedback connections but no recurrent connections had 10% less synergy than the simplest computational triads. Modeling the synergy based on feedforward, feedback, and recurrent connection strengths instead of the numbers of connections, using multiple linear regression, revealed a similar pattern (Figure 4). The feedforward connections were found to be positively correlated with synergy and accounted for the most variance. The recurrent connections also were positively correlated, though they accounted for a smaller amount of the variance than the feedforward beta weights. This may be related to another prior finding that synergy is greater downstream of neurons that propagate information to many target neurons [28]. Finally, feedback connections were not significantly related to synergy. The finding that greater synergy is found in triads with greater connectivity between source neurons offers some perspective into why rich club triads are synergy-dense. Not only are rich club triads likely to have strong feedforward connections, they are also likely to have additional connections, including recurrent connections, that add to the overall synergy."
      }
    ]
  },
  {
    "id": "spya-ufda4u",
    "name": "Synergy peaks at intermediate input correlation, not maximal correlation",
    "provenance": "introduced",
    "statement": "Synergy between two converging inputs rises with their mutual correlation only up to a point; beyond a certain degree of similarity (around 7% of maximal possible shared information in these recordings), further correlation increases redundancy instead and suppresses synergy.",
    "occurrences": [
      {
        "blockId": "spya-ybmve2",
        "quote": "The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease",
        "reasoning": "States the non-monotonic relationship central to this empirical finding.",
        "start": 240,
        "blockText": "To test whether synergy increases indefinitely as mutual information grows at longer timescales, we explored a range extending well past the synaptic range (time bins up to 2.25 s wide). Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale. Past this level, the synergy began to decrease (this level is marked by the vertical dotted line in Figure 4E). In the context of explaining the density of synergy in the rich club, the strong positive relationship between synergy and mutual information at synaptic timescales suggested that the activity of rich club neurons is generally more correlated than the activity of neurons outside the rich club. Indeed, rich clubs consist of a disproportionate number of inhibitory neurons with correlated spiking activity that synergistically predict the dynamics of the rest of the network [50]."
      },
      {
        "blockId": "spya-cs9fdy",
        "quote": "as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed",
        "reasoning": "Explains the mechanism behind the non-monotonic pattern.",
        "start": 743,
        "blockText": "Leveraging the multiple outputs that PID offers, including redundancy as well as synergy, we were able to explore how the overall composition of information propagation varies across timescales [3]. As we lengthened the timescale, the total multivariate transfer entropy between the source neurons and the target neuron increased steadily across all timescales examined. As noted already, however, synergy increased only at the shorter timescales and decreased at the longer timescales. Observing the redundancy offered an explanation. Redundancy was positively related to mutual information at all timescales. Indeed, the slope relating the redundancy to mutual information became steeper at longer timescales (Figure 4E). This suggests that as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed."
      }
    ]
  }
]
```

## Candidate Y

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

## Candidate Z

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
