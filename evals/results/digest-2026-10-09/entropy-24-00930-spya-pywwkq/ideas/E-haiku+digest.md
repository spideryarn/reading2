# entropy-24-00930-spya-pywwkq — ideas — E-haiku+digest

## 1. Redundancy measure choice is unresolved and shapes results (assumed)

Because no single redundancy measure is agreed on, the split of information into redundant, unique and synergistic parts depends on which measure is chosen, so results from one measure are not automatically results about the system.

*Why you need it:* The article's empirical claims rest on the Imin measure, and it only matters that those findings could change under another measure if the reader already accepts that the decomposition is measure-dependent.

- spya-bgsd4n: "Unfortunately, classical Shannon information theory provides no unique solution to any of these, and so considerable work has been devoted to developing formal measures of each."
- spya-rc76qn: "The majority of the studies discussed in this paper used the original Imin measure proposed in [1], although this measure has been criticized for unintuitive behavior [29,39]."

## 2. Information flow is not information processing (introduced)

Measures of how information moves between neurons, such as mutual information and transfer entropy, do not show how separate input streams combine in a target neuron; that combination is a different quantity needing its own analysis.

- spya-s0db2g: "Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]."
- spya-wer4cd: "Information transfer (discussed above) tells us about how the past of either source Xi informs the future of Y, but to understand “processing”, we are interested in how the interaction between the two source variables’ past influences the target’s future in a way that is not reducible to either source considered individually."

## 3. Synergy is information only the inputs jointly provide (introduced)

Synergy is the part of what several inputs tell you about a target that no single input, and no sum of single inputs, provides; a whole larger than the sum of its parts signals it.

*Why you need it:* The later empirical claims about synergy only make sense once the reader holds this definition, which the article gives through the whole-versus-parts comparison.

- spya-e94ury: "If the left-hand side of Equation (4) (the “whole”) is greater than the right-hand side (the sum of the “parts”), then there is some information about Y that is disclosed by the joint state of all the neurons that is not disclosed by any individual parent."
- spya-h5jzvm: "Syn(X₁, X₂;Y) is the information about Y that can only be learned by observing the joint states of X₁ and X₂ together."

## 4. Synergy tracks feedforward and recurrent connectivity (introduced)

Synergy in a triad rises with the strength of the source-to-target (feedforward) connections and with connections among the source neurons (recurrent), while feedback from target to sources is not reliably linked to synergy.

- spya-kqkb58: "the amount of synergy observed in a given triad was reliably about a quarter of the transfer entropy for that triad [2]."
- spya-sd9fzd: "Using PID, we found that triads with more recurrent connections also had greater synergy [4]."
- spya-sd9fzd: "Finally, feedback connections were not significantly related to synergy."

## 5. Rich clubs concentrate information processing (introduced)

Densely interconnected high-traffic neurons (rich clubs) carry a disproportionate share of synergistic processing in cortical networks, so the best-connected core is where most computation happens.

- spya-fud8q3: "Numerically, the triads inside the rich clubs had 2.7 times the amount of synergy as the triads not in the rich club (Figure 4B)."
- spya-fud8q3: "Despite the fact that that less than 40% of the neurons were in the rich club, the rich club triads accounted for ∼88% of the network-wide synergy."

## 6. Synergy peaks at moderate input similarity (introduced)

Synergy rises as the activity of two converging inputs becomes more similar, but only up to a peak near 7% of the maximum possible mutual information; beyond that, redundancy takes over and synergy falls.

- spya-ybmve2: "Interestingly, synergy only increased up to a point. The peak in synergy occurred when the mutual information was about 7% of the maximal value, regardless of the timescale."
- spya-cs9fdy: "This suggests that as the similarity of the converging information grows past some point, it becomes redundant, and the total amount of synergistic output is suppressed."

## 7. Information decomposition needs data that scale with the number of inputs (introduced)

The data needed to estimate joint probabilities grow exponentially with the number of interacting neurons, and the number of PID parts grows even faster, so complete decomposition of a neuron with many inputs is impractical.

- spya-tz99zn: "For a system of binary elements such as spiking neurons, there are 2 k possible combinations of 0s and 1s."
- spya-aby2dp: "The most significant is the explosive growth of the PI lattice. For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]."

## 8. Synergy is a statistical dependence, not a mechanism (introduced)

PID shows that a neuron's output depends on its inputs jointly in ways beyond their sum, but it does not reveal the biological mechanism producing that pattern.

- spya-spdx0y: "while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated."

## 9. Local PID gives time-resolved information dynamics (introduced)

Because information can be computed for each specific configuration of states rather than only as an average, PID can yield a moment-by-moment profile of redundant, unique and synergistic information.

- spya-mczhkp: "In the context of neural recordings, the obvious application of this is the construction of a time-resolved, “informational time series”, where the particular redundant, synergistic, and unique modes of information sharing can be resolved for every moment in time."
