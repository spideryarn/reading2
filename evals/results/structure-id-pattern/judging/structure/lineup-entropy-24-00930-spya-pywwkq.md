# 4 candidates for "Revealing the Dynamics of Neural Information Processing with Multivariate Information Decomposition"

Each candidate is a table of contents that carves the article into sections a first-time reader would navigate by. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-entropy-24-00930-spya-pywwkq.md` beside this file.

## Candidate W

1. **Title, Authors and Abstract**
   gist: The title, authors, affiliations, abstract and keywords.
   opens: "Ehren L."
2. **1. Introduction**
   gist: How brains process information is poorly understood, and new recording technology has shifted the main obstacle from missing data to missing analysis methods.
   opens: "A grand challenge of modern neuroscience is to discover how brains “process information”."
3. **2. Tracking Information in Neural Circuits**
   gist: Studying information flow between neurons requires choices about data type, elements and time scale, and mutual information and transfer entropy measure dependence and directed flow respectively.
   opens: "When used to study neural circuit function, information theory analyzes knowledge about the activity of one or more neurons and reduces the uncertainty about the states of other neurons."
4. **3. Information Processing in Neural Circuits**
   gist: Information transfer cannot show how neurons combine several inputs, so multivariate decomposition is proposed to isolate the part produced by interaction between sources.
   opens: "Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]."
5. **4. PID: Partial Information Decomposition**
   gist: Partial information decomposition splits what inputs tell about a target into redundant, unique and synergistic parts, but it needs a chosen redundancy measure and a lattice for many inputs.
   opens: "In this section, we will dive into the details of partial information decomposition, with the aim of providing an accessible introduction to the framework and outlining the common technical concerns that a prospective analyst must address."
6. **5. PID in Action**
   gist: In cultured cortex, synergy tracks information propagation, concentrates in rich clubs, and rises with recurrent connections; in behaving monkeys it shifts with task demands.
   opens: "We next illustrate the application of information decomposition to the empirical study of neural information processing in biological circuits."
7. **6. Practical Considerations in PID**
   gist: Applying PID well means matching the redundancy measure to the data type, having enough data for the joint distribution, choosing software, and respecting limits on interpretation and scale.
   opens: "In this last section, we provide a basic orientation to the practicalities of performing analyses using the PID framework."
8. **7. Future Directions**
   gist: Promising extensions include local PID, which resolves information moment by moment, and multi-target decompositions that analyze how the past constrains the future.
   opens: "Research on the foundations of multivariate information theory and its application to complex systems is ongoing and forms an active field in its own right."
9. **8. Summary**
   gist: Synergy shows neurons respond to patterns of inputs, not just their sum, and depends on local network context and behavioral state.
   opens: "In this paper, we have aimed to provide an accessible introduction to the partial information decomposition framework [1] and shown how it can be applied to answer fundamental questions about information processing in neural circuits."
10. **Contributions, Funding and References**
   gist: Author contributions, funding, data availability, conflict statements and the reference list.
   opens: "Author Contributions: Conceptualization: E.L.N., T.F.V., S.P.S., and J.M.B.; original draft preparation: E.L.N."

Sampled deeper gists, each beside the prose it stands in for:
- gist: Mutual information captures undirected dependence between two neurons, while transfer entropy measures how one neuron's past predicts another's future, so only the latter tracks information propagation.
  prose: "2.2. Tracking Information Given two elements (e.g., neurons), one serving as an information source and another as a target receiving information from that source, the tools of information theory make it possible to track how neural activity propagates across a neural system. Information-theoretic tools such as mutual information [10] and transfer entropy [11] are well suited to this purpose. Mutua…"
- gist: The number of information atoms explodes with more inputs, and naive estimation from finite data biases entropy and mutual information, so null-model comparisons are needed.
  prose: "6.3. Practical Limitations of the PID Framework The PID framework has a number of limitations that potentially complicate its application in naturalistic settings. The most significant is the explosive growth of the PI lattice. For a system with k parent neurons, the number of distinct PI atoms is given by the kth Dedekind number (minus two) [30]. This sequence of numbers grows appallingly fast: i…"
- gist: The whole information that inputs carry about a target need not equal the sum of its parts; the gap reveals synergy when larger and redundancy when smaller.
  prose: "4. PID: Partial Information Decomposition In this section, we will dive into the details of partial information decomposition, with the aim of providing an accessible introduction to the framework and outlining the common technical concerns that a prospective analyst must address. We begin with a formal statement of the problem and build intuition by examining the special case of two parent neuron…"

## Candidate X

1. **Title, Authors, and Abstract**
   gist: Title block, authors, affiliations, abstract and keywords.
   opens: "Ehren L."
2. **1. Introduction**
   gist: How brains process information is poorly understood, and the study of it has been held back by limited data and analysis tools, which this review addresses.
   opens: "A grand challenge of modern neuroscience is to discover how brains “process information”."
3. **2. Tracking Information in Neural Circuits**
   gist: Information theory measures how knowing one neuron's activity reduces uncertainty about another's, after choosing data type, elements and time scale; transfer entropy captures directed flow.
   opens: "When used to study neural circuit function, information theory analyzes knowledge about the activity of one or more neurons and reduces the uncertainty about the states of other neurons."
4. **3. Information Processing in Neural Circuits**
   gist: Information transfer shows flow but not how neurons combine inputs into new information, so decomposing information from multiple sources is needed.
   opens: "Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]."
5. **4. PID: Partial Information Decomposition**
   gist: Total information from several inputs splits into redundant, unique and synergistic parts, defined through a lattice of sources and a chosen redundancy measure.
   opens: "In this section, we will dive into the details of partial information decomposition, with the aim of providing an accessible introduction to the framework and outlining the common technical concerns that a prospective analyst must address."
6. **5. PID in Action**
   gist: In cortical cultures and behaving monkeys, synergy rises with information flow, rich clubs, recurrent links and moderately similar inputs, and shifts with the task.
   opens: "We next illustrate the application of information decomposition to the empirical study of neural information processing in biological circuits."
7. **6. Practical Considerations in PID**
   gist: Applying PID requires matching the redundancy function to the data type, having enough data to estimate probabilities, and picking software, and results come with interpretive limits.
   opens: "In this last section, we provide a basic orientation to the practicalities of performing analyses using the PID framework."
8. **7. Future Directions**
   gist: Later extensions, such as moment-by-moment local analysis and multi-target decompositions, promise richer views of neural information dynamics.
   opens: "Research on the foundations of multivariate information theory and its application to complex systems is ongoing and forms an active field in its own right."
9. **8. Summary**
   gist: Synergy shows neurons respond to patterns of inputs rather than simply summing them, and it depends on local network structure and behavioral state.
   opens: "In this paper, we have aimed to provide an accessible introduction to the partial information decomposition framework [1] and shown how it can be applied to answer fundamental questions about information processing in neural circuits."

Sampled deeper gists, each beside the prose it stands in for:
- gist: Brains turn sensory input into adaptive behavior through many interacting neurons, but how that input is transformed is poorly understood, and many basic questions about it remain open.
  prose: "1. Introduction A grand challenge of modern neuroscience is to discover how brains “process information”. Though there is debate regarding what information processing means precisely, it is clear that brains take in sensory signals from the environment and use that information to generate adaptive behavior informed by their surroundings. The ways that sensory information is modified and transforme…"
- gist: Classic PID is the focus because of its wide use in neuroscience, but later advances extend the framework in useful ways.
  prose: "7. Future Directions Research on the foundations of multivariate information theory and its application to complex systems is ongoing and forms an active field in its own right. In this review, we have largely focused on “classic” PID, as proposed by Williams and Beer [1], due to its widespread application in neuroscience. There are, however, a number of later advances that extend the PID framewor…"
- gist: Neural activity is recorded either as continuous field signals or as discrete spikes, and the two need different information-theoretic approaches.
  prose: "2. Tracking Information in Neural Circuits When used to study neural circuit function, information theory analyzes knowledge about the activity of one or more neurons and reduces the uncertainty about the states of other neurons. While the overall intuition is conserved, the practical considerations can vary widely, depending on the type of data being analyzed. The properties of “neural activity” …"

## Candidate Y

1. **Title, Authors and Abstract**
   gist: The title, authors, affiliations, abstract and keywords.
   opens: "Ehren L."
2. **1. Introduction**
   gist: How brains process information is poorly understood, and new recording tools plus information theory now let researchers address it.
   opens: "A grand challenge of modern neuroscience is to discover how brains “process information”."
3. **2. Tracking Information in Neural Circuits**
   gist: Information theory can follow how activity spreads between neurons, once the data type, elements and timescale are chosen.
   opens: "When used to study neural circuit function, information theory analyzes knowledge about the activity of one or more neurons and reduces the uncertainty about the states of other neurons."
4. **3. Information Processing in Neural Circuits**
   gist: Transfer shows flow but not how streams combine, so multivariate decomposition is proposed to study processing itself.
   opens: "Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]."
5. **4. PID: Partial Information Decomposition**
   gist: Total information from inputs splits into redundant, unique and synergistic parts, which needs a redundancy measure and a lattice for many inputs.
   opens: "In this section, we will dive into the details of partial information decomposition, with the aim of providing an accessible introduction to the framework and outlining the common technical concerns that a prospective analyst must address."
6. **5. PID in Action**
   gist: In cortical cultures and behaving monkeys, synergy tracks information propagation, rich clubs, recurrent links and moderately correlated inputs, and shifts with task.
   opens: "We next illustrate the application of information decomposition to the empirical study of neural information processing in biological circuits."
7. **6. Practical Considerations in PID**
   gist: Using PID well requires matching the redundancy measure to the data type, having enough data, choosing tools, and recognizing its interpretive and computational limits.
   opens: "In this last section, we provide a basic orientation to the practicalities of performing analyses using the PID framework."
8. **7. Future Directions**
   gist: Later extensions of PID, including time-resolved local analysis and multi-target decomposition, promise richer views of neural dynamics.
   opens: "Research on the foundations of multivariate information theory and its application to complex systems is ongoing and forms an active field in its own right."
9. **8. Summary**
   gist: Synergy shows neurons respond to patterns of input rather than summing it, shaped by local network and behavior, pointing to broad future research.
   opens: "In this paper, we have aimed to provide an accessible introduction to the partial information decomposition framework [1] and shown how it can be applied to answer fundamental questions about information processing in neural circuits."
10. **Contributions, Funding and Disclosures**
   gist: Author contributions, funding, data availability and conflict-of-interest statements.
   opens: "Author Contributions: Conceptualization: E.L.N., T.F.V., S.P.S., and J.M.B.; original draft preparation: E.L.N."
11. **References**
   gist: The reference list.
   opens: ""

Sampled deeper gists, each beside the prose it stands in for:
- gist: Before analysis one must settle the kind of states (continuous or discrete), the elements and their connections, and the time bin size, since each limits what can be inferred.
  prose: "2. Tracking Information in Neural Circuits When used to study neural circuit function, information theory analyzes knowledge about the activity of one or more neurons and reduces the uncertainty about the states of other neurons. While the overall intuition is conserved, the practical considerations can vary widely, depending on the type of data being analyzed. The properties of “neural activity” …"
- gist: PID shows statistical dependencies between neurons but does not explain mechanistically why a neuron is synergy- or redundancy-dominated, which is a future research question.
  prose: "6.2. Interpreting PID Results as Neural Information Processing One important caveat to note with respect to PID applied to neural data is that while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated. Now that the existence of st…"
- gist: Mutual information shows undirected dependence between neurons, while transfer entropy uses a source's past to predict a target's future, so it measures directed propagation.
  prose: "2.2. Tracking Information Given two elements (e.g., neurons), one serving as an information source and another as a target receiving information from that source, the tools of information theory make it possible to track how neural activity propagates across a neural system. Information-theoretic tools such as mutual information [10] and transfer entropy [11] are well suited to this purpose. Mutua…"

## Candidate Z

1. **Title, Authors and Abstract**
   gist: Title block, authors, affiliations, abstract and keywords.
   opens: "Ehren L."
2. **Introduction**
   gist: How brains process information is poorly understood, and new recording tools now need better analysis methods, which this review offers through information theory.
   opens: "A grand challenge of modern neuroscience is to discover how brains “process information”."
3. **Tracking Information in Neural Circuits**
   gist: Information theory measures how knowing one neuron reduces uncertainty about another, once data type, elements and time scale are chosen; transfer entropy captures directed flow.
   opens: "When used to study neural circuit function, information theory analyzes knowledge about the activity of one or more neurons and reduces the uncertainty about the states of other neurons."
4. **Information Processing in Neural Circuits**
   gist: Information transfer shows flow but not how inputs combine, so decomposing information from several sources is needed to study processing itself.
   opens: "Information transfer captures the overall “flow” of information through the system; however, it is limited in its ability to reveal how different streams of information “interact” and how neurons produce novel or modified information from multiple sources [19]."
5. **PID: Partial Information Decomposition**
   gist: PID splits the information several inputs give about a target into redundant, unique and synergistic parts, needing a chosen redundancy measure.
   opens: "In this section, we will dive into the details of partial information decomposition, with the aim of providing an accessible introduction to the framework and outlining the common technical concerns that a prospective analyst must address."
6. **PID in Action**
   gist: In cortical cultures and macaques, synergy tracks information propagation, rich clubs, recurrent connections, moderately correlated inputs and behavioral task demands.
   opens: "We next illustrate the application of information decomposition to the empirical study of neural information processing in biological circuits."
7. **Practical Considerations in PID**
   gist: Applying PID requires matching redundancy measures to the data type, having enough data, choosing tools, and recognizing its limits in explanation and scale.
   opens: "In this last section, we provide a basic orientation to the practicalities of performing analyses using the PID framework."
8. **Future Directions**
   gist: Local, time-resolved PID and multi-target decompositions extend the framework to moment-by-moment dynamics and richer analyses.
   opens: "Research on the foundations of multivariate information theory and its application to complex systems is ongoing and forms an active field in its own right."
9. **Summary and Back Matter**
   gist: Synergy shows neurons respond to patterns rather than input totals, shaped by local network structure and behavior; closing notes list contributions, funding and references.
   opens: "In this paper, we have aimed to provide an accessible introduction to the partial information decomposition framework [1] and shown how it can be applied to answer fundamental questions about information processing in neural circuits."

Sampled deeper gists, each beside the prose it stands in for:
- gist: Many basic questions about neural information processing remain open, held back by a lack of data and a lack of suitable analysis tools.
  prose: "1. Introduction A grand challenge of modern neuroscience is to discover how brains “process information”. Though there is debate regarding what information processing means precisely, it is clear that brains take in sensory signals from the environment and use that information to generate adaptive behavior informed by their surroundings. The ways that sensory information is modified and transforme…"
- gist: PID shows statistical dependencies between neurons but not the biological mechanisms that make them synergy- or redundancy-dominated.
  prose: "6.2. Interpreting PID Results as Neural Information Processing One important caveat to note with respect to PID applied to neural data is that while it provides a powerful framework for recognizing statistical dependencies between neurons, it does not necessarily provide a mechanistic explanation for why particular neurons are synergy-dominated or redundancy-dominated. Now that the existence of st…"
- gist: Before analysis one must settle whether activity is continuous or discrete, which elements interact, and what time bin size to use, since each limits the inferences possible.
  prose: "2. Tracking Information in Neural Circuits When used to study neural circuit function, information theory analyzes knowledge about the activity of one or more neurons and reduces the uncertainty about the states of other neurons. While the overall intuition is conserved, the practical considerations can vary widely, depending on the type of data being analyzed. The properties of “neural activity” …"
