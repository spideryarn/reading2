# 4 candidates for "Analog Cognition and Consciousness"

Each candidate is the ideas a reader needs in order to get this article, each tied to the passages that carry it. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-analog-cognition-and-consciousness-4-28-26-spya-f03kqf.md` beside this file.

## Candidate W

```json
[
  {
    "id": "spya-ttsvs5",
    "name": "Fixed synaptic routing can't explain moment-to-moment flexibility",
    "provenance": "assumed",
    "statement": "If neural information were organized solely by which synapses connect which neurons, then redirecting a signal to a new purpose would require a controller that already knows and selectively recruits the exact synapses and neurons involved, which is implausible on the timescales cognition requires.",
    "whyYouNeedIt": "The whole case for needing a wave-based controller depends on readers accepting that synapse-level routing is too slow and too knowledge-hungry to do the job; without this the paper's motivation collapses.",
    "occurrences": [
      {
        "blockId": "spya-d73kfb",
        "quote": "That would require a control system to \"know\" which synapses and neurons were employed for any given neural representation and selectively coordinate them with subsecond precision, a seemingly implausible computational demand.",
        "reasoning": "States the assumption that synaptic rewiring/selection is too slow for flexible control, motivating the need for an alternative mechanism.",
        "start": 372,
        "blockText": "This is hard to reconcile with traditional models that view brain function as arising only from brief electrical impulses (“spikes”) transmitted through networks shaped by the synaptic connections between neurons. Spiking and synaptic connections are, of course, critical and fundamental. However, synaptic changes are likely too cumbersome for flexible top-down control. That would require a control system to “know” which synapses and neurons were employed for any given neural representation and selectively coordinate them with subsecond precision, a seemingly implausible computational demand."
      },
      {
        "blockId": "spya-dtnkkk",
        "quote": "Such flexible routing is difficult to reconcile with a purely connectionist framework based solely on changing synaptic weights.",
        "reasoning": "Relies on the reader accepting synaptic-weight-only routing as inherently inflexible.",
        "start": 210,
        "blockText": "A control system therefore has the challenge of dynamically routing signals through a dense web of overlapping networks, allowing the same neurons to contribute to different computations in different contexts. Such flexible routing is difficult to reconcile with a purely connectionist framework based solely on changing synaptic weights. A more computationally tractable mechanism seems to be needed. Neural oscillations, i.e., brain waves, could serve that role."
      }
    ]
  },
  {
    "id": "spya-m67h2g",
    "name": "Electric fields can move and merge independent of synapses",
    "provenance": "assumed",
    "statement": "Neurons' electric fields can influence neighboring neurons' membrane potentials directly, without needing a synaptic connection, and these fields can add together or cancel like physical waves.",
    "whyYouNeedIt": "The analog-computation and ephaptic-coupling arguments only work if field effects are treated as a real, independent causal channel on spiking, separate from synaptic transmission.",
    "occurrences": [
      {
        "blockId": "spya-bzqaf5",
        "quote": "Ephaptic coupling in the brain is the influence of neuronal electric fields on nearby neurons' membrane potentials, allowing interaction and coordination independent of synapses",
        "reasoning": "States the non-synaptic causal channel the later analog computing argument depends on.",
        "start": 156,
        "blockText": "Oscillatory fluctuations in extracellular electric fields have direct field effects on the intracellular potentials and spiking activity of nearby neurons. Ephaptic coupling in the brain is the influence of neuronal electric fields on nearby neurons’ membrane potentials, allowing interaction and coordination independent of synapses (Anastassiou and Koch, 2015; Chiang et al., 2019; Faber and Pereda, 2018; Han et al., 2020; Katz and Schmitt, 1940; Pinotsis and Miller, 2023; Schmidt et al., 2021a; Hunt and MacIver, 2026). For example, cerebellar Purkinje cells generate extracellular potentials that are large enough to drive synchrony in nearby cells, even when chemical synapses and gap junctions are blocked (Han et al., 2018). Externally applied electric fields with strength in the range of endogenous fields can modulate and propagate neural waves, alter spike timing, and synchronize neurons (Anastassiou et al., 2011; Fröhlich and McCormick, 2010; Jæger and Tveito, 2026; Radman et al., 2007; Ruffini et al., 2020; Schloetter et al., 2025). Because many cortical neurons operate with membrane potentials fluctuating near the spike threshold, even weak oscillatory extracellular fields can induce small subthreshold voltage changes that significantly modulate both spiking probability and spike timing in local populations of neurons (Buzsáki and Draguhn, 2004; Ladenbauer and Obermayer, 2019; Radman et al., 2007). Individual ephaptic interactions, when synchronized and summed across neurons, create effects large enough to shape and coordinate neuron spiking at the mesoscale (Goldwyn and Rinzel, 2016; Cunha et al., 2024). This feedback of electric field effects onto spiking activity can thus recruit neurons into an activated population, as well as spatially and temporally coordinate their activity."
      },
      {
        "blockId": "spya-vp5h33",
        "quote": "When waves meet, they naturally add together, cancel out, or form new patterns through their superposition and interference",
        "reasoning": "Assumes field superposition as a physical fact underlying the computation claim.",
        "start": 328,
        "blockText": "Analog computing uses continuous physical quantities, such as voltages or mechanical motion, to directly represent and solve mathematical problems (Bournez and Pouly, 2018; Hughes et al., 2019; Tzarouchis et al., 2025). Unlike digital systems that rely on binary on/off signals, analog systems combine information continuously. When waves meet, they naturally add together, cancel out, or form new patterns through their superposition and interference (Fig. 6). Simple examples like overlapping sine waves show how addition, subtraction, and thus filtering can"
      }
    ]
  },
  {
    "id": "spya-e6dgrs",
    "name": "Top-down control signals must be content-agnostic to be reusable",
    "provenance": "assumed",
    "statement": "For a control mechanism to flexibly apply to any task or representation, it must operate without needing to specify which particular neurons or synapses encode that content, acting on location or pattern rather than on identity.",
    "whyYouNeedIt": "The claim that the same control signal can be reused across arbitrary tasks depends on this principle; without it, the compositional reuse argument has no basis.",
    "occurrences": [
      {
        "blockId": "spya-gxyg0d",
        "quote": "It also allows for compositional reuse of the same control signals for any arbitrary information.",
        "reasoning": "Assumes content-agnostic control as the reason reuse is possible, without separately justifying why this follows.",
        "start": 283,
        "blockText": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information (Badre et al., 2021; Chandrasekaran et al., 2025; MacDowell et al., 2022). It also allows for compositional reuse of the same control signals for any arbitrary information. Conversely, the same neuronal population can be reused for any arbitrary task demands, simply by changing the control “stencil” imposed on it (Tafazoli et al., 2026; Xie et al., 2022). This flexible push-pull interaction between alpha/beta and gamma/spiking signals provides a mechanism by which control systems can dynamically organize and shape thought and action."
      }
    ]
  },
  {
    "id": "spya-xbjd9k",
    "name": "Population activity lives on a low-dimensional subspace",
    "provenance": "assumed",
    "statement": "Even though many individual neurons carry complex, mixed, noisy signals, the coordinated activity of the whole population can be described as moving through a much smaller set of effective dimensions, like a trajectory on a surface rather than scattering through the full space of possibilities.",
    "whyYouNeedIt": "The claim that waves 'pull' population trajectories smoothly through subspaces only makes sense if the reader already accepts that population activity is structured and low-dimensional rather than an unconstrained cloud of independent neurons.",
    "occurrences": [
      {
        "blockId": "spya-xphb7u",
        "quote": "population spiking tends to occupy a lower-dimensional \"subspace\" or \"manifold\" within the high-dimensional space defined by all possible population activity patterns",
        "reasoning": "Introduces but the later traveling-wave argument assumes this as settled background.",
        "start": 275,
        "blockText": "Mixed selectivity means that single neurons have access to a rich, high-dimensional set of nonlinear features. This information is spread across a population of neurons whose activity is not independent, but instead exhibits structured patterns of coordination. As a result, population spiking tends to occupy a lower-dimensional “subspace” or “manifold” within the high-dimensional space defined by all possible population activity patterns (Ebitz and Hayden, 2021). Note that neural coding can be both low-dimensional compared to the high-dimensional code implied by independent activity and high-dimensional compared to the low-dimensional code implied by “pure” unmixed selectivity. This is consistent with broad anatomical gradients in the cortex, which compress signals to create functional equivalences, establishing the anatomical"
      },
      {
        "blockId": "spya-ah94dx",
        "quote": "population spiking traces smooth trajectories through its activity subspace, consistent with the temporal evolution of a dynamical system",
        "reasoning": "Depends on readers already accepting subspace structure to make sense of 'trajectories'.",
        "start": 32,
        "blockText": "Notably, over short timescales, population spiking traces smooth trajectories through its activity subspace, consistent with the temporal evolution of a dynamical system (Churchland et al., 2012; Ebitz and Hayden, 2021; Vyas et al., 2020). Different sensory stimuli, cognitive operations, and behaviors follow distinct paths. Distractions may briefly nudge trajectories off course, but the population state usually returns smoothly, such that cortical neurons move together according to shared dynamics. As elaborated below (“Traveling Waves and Representational Change”), these smooth population trajectories may be related to wave dynamics. As traveling waves sweep continuously over the cortex, they may “pull” population spiking activity along, creating repeatable smooth trajectories (Batabyal et al., 2026)."
      }
    ]
  },
  {
    "id": "spya-fxkghd",
    "name": "Convergent large-scale effects despite different molecular causes implicate systems-level organization",
    "provenance": "assumed",
    "statement": "When very different drugs acting on different receptors all produce the same global pattern of brain activity and the same loss of consciousness, this suggests the relevant cause of consciousness lies at the level of large-scale dynamics rather than at the level of specific molecules or cell types.",
    "whyYouNeedIt": "The anesthesia section only supports the wave theory if the reader accepts that convergence onto one macroscopic pattern, despite differing microscopic mechanisms, points to the macroscopic pattern itself being causally central.",
    "occurrences": [
      {
        "blockId": "spya-k02vdw",
        "quote": "This suggests that consciousness depends less on specific receptors or cell types and more on the integrity of large-scale wave organization.",
        "reasoning": "States the inference but relies on the reader accepting the general logic of convergence-implies-causal-level, which is not separately argued.",
        "start": 173,
        "blockText": "The main point here is that different pharmacological routes of different drugs nonetheless converge on the same systems-level outcome: Slow, desynchronized cortical waves. This suggests that consciousness depends less on specific receptors or cell types and more on the integrity of large-scale wave organization."
      },
      {
        "blockId": "spya-wnqgmn",
        "quote": "Despite acting on different molecular targets, different anesthetic agents, such as propofol (GABAergic), ketamine (NMDAergic), and dexmedetomidine (alpha-2 adrenergic), all converge on similar large-scale electrical effects in the cortex",
        "reasoning": "Presents the convergence fact that the inference is built on.",
        "start": 0,
        "blockText": "Despite acting on different molecular targets, different anesthetic agents, such as propofol (GABAergic), ketamine (NMDAergic), and dexmedetomidine (alpha-2 adrenergic), all converge on similar large-scale electrical effects in the cortex (Bardon et al., 2025; Eisen et al., 2026). The mixed, low-amplitude higher-frequency activity of wakefulness transitions to high-power slow delta (~1–4 Hz) oscillations across frontal, parietal, and sensory regions. These slow waves are often temporally misaligned, disrupting coordinated communication. The result may be a destabilized, fragmented cortex."
      }
    ]
  },
  {
    "id": "spya-udzz0r",
    "name": "A single neuron's firing can mean different things in different contexts",
    "provenance": "introduced",
    "statement": "Many cortical neurons are not dedicated to one fixed function but instead change what their spiking signifies depending on context, a phenomenon called mixed selectivity.",
    "whyYouNeedIt": "This is the empirical anomaly that the whole wave-control theory is built to explain.",
    "occurrences": [
      {
        "blockId": "spya-x5m34h",
        "quote": "A neuron might spike to object A, but only when it was seen first, and to object B, but only when it is seen second.",
        "reasoning": "Directly introduces the concept with a concrete example.",
        "start": 319,
        "blockText": "contextual information (like order) with sensory inputs (like objects) and motor actions. In our example, this corresponds to selective spiking to objects that changes depending on the context of their sequence order (Fig. 2C), as we observed in many prefrontal neurons (Rigotti et al., 2013; Warden and Miller, 2007). A neuron might spike to object A, but only when it was seen first, and to object B, but only when it is seen second."
      },
      {
        "blockId": "spya-njs6ff",
        "quote": "nonlinear mixed selectivity seems to reflect a core computational principle",
        "reasoning": "States the idea as a general principle, not just an example.",
        "start": 660,
        "blockText": "Thus, these neurons embody the flexible, context-dependent behavior associated with higher cognition (Rigotti et al., 2013; Fusi et al., 2016; Tye et al., 2024). Modeling studies show that such neurons greatly expand a network’s computational power by providing a higher-order representational space (Rigotti et al., 2013; Fusi et al., 2016; Tye et al., 2024). Further, they also greatly expand a network’s capacity to store information because information is multiplexed across many multifunctional neurons rather than segregated into specialist neurons (Rigotti et al., 2013). But they are not merely the “icing on the cake” of cortical processing. Instead, nonlinear mixed selectivity seems to reflect a core computational principle (Johnston et al., 2020). They are prevalent in higher areas like prefrontal cortex (Abbass et al., 2025; Dang et al., 2022; Mouille et al., 2025; Parthasarathy et al., 2017; Warden and Miller, 2007) but also in primary sensory and motor cortex (Grunfeld and Likhtik, 2018; Kaufman et al., 2022; Kira et al., 2023; Tseng et al., 2022; Tye et al., 2024)."
      }
    ]
  },
  {
    "id": "spya-a7r2bx",
    "name": "Slow waves act as spatial stencils gating fast local signals",
    "provenance": "introduced",
    "statement": "Spatially patterned alpha/beta rhythms suppress gamma-band spiking in a location-specific way, so where sensory or motor information gets expressed depends on the interaction between random feedforward drive and this imposed suppression pattern.",
    "analogy": "Like a stencil held over a spray-painted surface: the same spray (feedforward drive) produces a different picture depending on which stencil is laid down first.",
    "occurrences": [
      {
        "blockId": "spya-gkfdys",
        "quote": "They function as temporary inhibitory \"stencils\" across the surface of cortex.",
        "reasoning": "Core statement of the mechanism.",
        "start": 238,
        "blockText": "strongest in deep (feedback) layers (Mendoza-Halliday et al., 2024). Spatial computing theory (Fig. 3) proposes that alpha/beta rhythms convey internally-generated signals whose spatial patterning reflects top-down information (Fig. 3A). They function as temporary inhibitory “stencils” across the surface of cortex. This regulates gamma and spiking in the feedforward and local recurrent circuits that carry sensory-related cognitive contents (Fig. 3B) and drive actions. Alpha/beta rhythms thus dampen or suppress gamma and associated spiking in targeted locations, creating a push-pull dynamic that determines where feedforward signals are suppressed. Feedforward signals are then permitted to emerge in the remaining “open” regions, where alpha/beta is weaker. Where spiking is expressed thus depends on the interaction between spatially random feedforward inputs and spatially organized alpha/beta suppression (Fig. 3C)."
      },
      {
        "blockId": "spya-gxyg0d",
        "quote": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information",
        "reasoning": "Explains why this solves the routing problem raised earlier.",
        "start": 0,
        "blockText": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information (Badre et al., 2021; Chandrasekaran et al., 2025; MacDowell et al., 2022). It also allows for compositional reuse of the same control signals for any arbitrary information. Conversely, the same neuronal population can be reused for any arbitrary task demands, simply by changing the control “stencil” imposed on it (Tafazoli et al., 2026; Xie et al., 2022). This flexible push-pull interaction between alpha/beta and gamma/spiking signals provides a mechanism by which control systems can dynamically organize and shape thought and action."
      }
    ]
  },
  {
    "id": "spya-ngc0kc",
    "name": "Analog wave interference as a form of computation",
    "provenance": "introduced",
    "statement": "Continuous physical quantities like overlapping wave amplitudes can carry out mathematical operations simply by interacting physically, all at once across space, rather than through sequential symbolic steps.",
    "analogy": "Like dropping two stones in a pond and reading the resulting ripple pattern as the answer, instead of calculating it digit by digit.",
    "occurrences": [
      {
        "blockId": "spya-vp5h33",
        "quote": "Analog computing uses continuous physical quantities, such as voltages or mechanical motion, to directly represent and solve mathematical problems",
        "reasoning": "States the idea directly.",
        "start": 0,
        "blockText": "Analog computing uses continuous physical quantities, such as voltages or mechanical motion, to directly represent and solve mathematical problems (Bournez and Pouly, 2018; Hughes et al., 2019; Tzarouchis et al., 2025). Unlike digital systems that rely on binary on/off signals, analog systems combine information continuously. When waves meet, they naturally add together, cancel out, or form new patterns through their superposition and interference (Fig. 6). Simple examples like overlapping sine waves show how addition, subtraction, and thus filtering can"
      },
      {
        "blockId": "spya-mgnqxk",
        "quote": "Because the wave interactions occur everywhere simultaneously, the computation is inherently parallel.",
        "reasoning": "Elaborates the core mechanism of analog computation.",
        "start": 330,
        "blockText": "Importantly, analog computing is computationally efficient. In an analog system, the physical medium itself evolves all at once. How the waves interact (e.g., their geometry, frequencies, and phase relationships) model the equation. The variables are all encoded as a continuous physical quantity in different phases of the wave. Because the wave interactions occur everywhere simultaneously, the computation is inherently parallel. An analog system does not loop through variables but settles into a solution as a whole. This is in contrast to digital computing, which is inherently sequential, solving problems one step at a time. Brain‑inspired neuromorphic hardware, motivated by the energy efficiency of biological neural systems, has shown that analog computation can improve energy efficiency over digital by more than an order of magnitude (Ambrogio et al., 2023; Ye et al., 2025)."
      }
    ]
  }
]
```

## Candidate X

```json
[
  {
    "id": "spya-zkr0s0",
    "name": "Population activity as a trajectory through a geometric state space",
    "provenance": "assumed",
    "statement": "A group of neurons' combined activity at any moment can be treated as a single point in a high-dimensional space, and over time this point traces a path; concepts like 'low-dimensional', 'subspace', 'orthogonal', and 'manifold' describe geometric properties of this path and the region it moves within.",
    "whyYouNeedIt": "The claims about mixed selectivity producing subspaces, orthogonal coding, and smooth trajectories only make sense if the reader already treats population firing as a geometric object rather than as a list of individual neurons' activity; the article never explains this translation.",
    "analogy": "Like tracking a flock of birds by the shape and path the whole flock traces, rather than by each bird's individual position.",
    "occurrences": [
      {
        "blockId": "spya-xphb7u",
        "quote": "population spiking tends to occupy a lower-dimensional “subspace” or “manifold” within the high-dimensional space defined by all possible population activity patterns",
        "reasoning": "Uses geometric vocabulary (subspace, manifold, dimensionality) as self-evident, which only works if the reader already maps population firing onto points in a space.",
        "start": 275,
        "blockText": "Mixed selectivity means that single neurons have access to a rich, high-dimensional set of nonlinear features. This information is spread across a population of neurons whose activity is not independent, but instead exhibits structured patterns of coordination. As a result, population spiking tends to occupy a lower-dimensional “subspace” or “manifold” within the high-dimensional space defined by all possible population activity patterns (Ebitz and Hayden, 2021). Note that neural coding can be both low-dimensional compared to the high-dimensional code implied by independent activity and high-dimensional compared to the low-dimensional code implied by “pure” unmixed selectivity. This is consistent with broad anatomical gradients in the cortex, which compress signals to create functional equivalences, establishing the anatomical"
      },
      {
        "blockId": "spya-ah94dx",
        "quote": "population spiking traces smooth trajectories through its activity subspace, consistent with the temporal evolution of a dynamical system",
        "reasoning": "Describes firing as a moving point tracing a path, a claim that presupposes the state-space framing rather than arguing for it.",
        "start": 32,
        "blockText": "Notably, over short timescales, population spiking traces smooth trajectories through its activity subspace, consistent with the temporal evolution of a dynamical system (Churchland et al., 2012; Ebitz and Hayden, 2021; Vyas et al., 2020). Different sensory stimuli, cognitive operations, and behaviors follow distinct paths. Distractions may briefly nudge trajectories off course, but the population state usually returns smoothly, such that cortical neurons move together according to shared dynamics. As elaborated below (“Traveling Waves and Representational Change”), these smooth population trajectories may be related to wave dynamics. As traveling waves sweep continuously over the cortex, they may “pull” population spiking activity along, creating repeatable smooth trajectories (Batabyal et al., 2026)."
      },
      {
        "blockId": "spya-ns23sq",
        "quote": "segregating different computations into independent (orthogonal) subspaces to minimize interference",
        "reasoning": "Relies on the notion of orthogonality between activity patterns, which is a geometric property that only has meaning under the assumed state-space view.",
        "start": 103,
        "blockText": "Structuring activity via subspace coding is thought to organize information processing, for example by segregating different computations into independent (orthogonal) subspaces to minimize interference (Fig. 4B) (Yoo and Hayden, 2020; Tang et al., 2020; Johnston et al., 2023; Libby and Buschman, 2021; Panichello and Buschman, 2021; Maggi and Humphries, 2022; Xie et al., 2022; Weber et al., 2023; Kaufman et al., 2014; Genkin et al., 2025). Spatial Computing theory also provides a potential neural mechanism for subspace coding. Alpha/beta control signals segregate spiking activity into partially overlapping active subsets, each of which exhibits structured patterns of correlation (Fig. 4A). This is essentially a description of the organization of spiking activity into orthogonal activation subspaces (Fig. 4B)."
      },
      {
        "blockId": "spya-qsz9ur",
        "quote": "Low-dimensional spiking trajectories in subspace can be seen as the spiking-level expression of broader wave-based control signals that impose global structure on neural activity.",
        "reasoning": "Connects wave control to population coding entirely through the unexplained geometric trajectory framing.",
        "start": 378,
        "blockText": "This framework reconciles two observations: Single neurons are noisy and context dependent, yet populations exhibit structured, low-dimensional behavior. Rather than independent units driven solely by local, specialized connections, cortical populations behave like a coordinated flock governed by shared dynamics. Brain waves offer a tractable mechanism for this coordination. Low-dimensional spiking trajectories in subspace can be seen as the spiking-level expression of broader wave-based control signals that impose global structure on neural activity."
      }
    ]
  },
  {
    "id": "spya-bt9f6g",
    "name": "Spikes and waves form one bidirectional system",
    "provenance": "introduced",
    "statement": "Brain waves are not just a byproduct of neuron firing (spiking); spiking creates the waves, and the waves in turn reach back and determine when and where spiking happens, forming a continuous feedback loop.",
    "occurrences": [
      {
        "blockId": "spya-z9g2s3",
        "quote": "Spikes shape brain waves, while the waves in turn influence when and where spikes occur.",
        "reasoning": "Makes explicit that causation runs both ways, not just from spikes to waves.",
        "start": 602,
        "blockText": "A biologically plausible mechanism may involve an emergent level of influence from electric field oscillations, i.e., brain waves. These waves reflect reverberating activity in neural circuits coordinated over millimeter-to-centimeter scales, providing a basic internal organization beyond simple feedforward reactions to the environment. Evolution could exploit this default organization by developing mechanisms that control oscillatory dynamics. Crucially, brain waves do not merely mirror spiking activity. They alter the electrical field environment that is itself critical for generating spikes. Spikes shape brain waves, while the waves in turn influence when and where spikes occur. We outline evidence for a complementary framework in which synaptic connections and spikes interact with brain wave dynamics to support the coordination and computation underlying cognition and consciousness."
      },
      {
        "blockId": "spya-f0dqyd",
        "quote": "This creates a feedback loop: Synapses shape spiking, spiking contributes to brain waves, and waves shape spiking.",
        "reasoning": "Spells out the loop as the mechanism linking synapses, spikes, and waves.",
        "start": 363,
        "blockText": "The idea is that synapses and brain waves play complementary roles (Fig 8). Synaptic connections, shaped by experience, store long‑term information and define potential activity patterns. When neurons fire spikes, they generate electric fields that influence nearby neurons through ephaptic coupling, i.e., electrical interaction without direct synaptic contact. This creates a feedback loop: Synapses shape spiking, spiking contributes to brain waves, and waves shape spiking. Spikes and gamma, by virtue of their higher frequency, represent higher‑resolution (smaller‑spatal scale) sensory and motor information. Lower‑frequency rhythms such as alpha/beta and theta instead exert larger‑scale control, organizing where sensory and motor spiking/gamma occur according to top‑down schemas, goals, plans, and memories."
      },
      {
        "blockId": "spya-tdqde5",
        "quote": "Synapses provide representational capacity for storing information, while brain waves determine which representations are active at any given moment.",
        "reasoning": "Assigns distinct complementary jobs to synapses and waves, the article's governing division of labor.",
        "start": 306,
        "blockText": "Moment‑to‑moment coordination underlying cognition and consciousness is thus dominated by brain waves rather than rapid synaptic changes. Different wave types coordinate activity at different scales: Slower waves can suppress some regions while enabling spiking in others, effectively routing information. Synapses provide representational capacity for storing information, while brain waves determine which representations are active at any given moment. Brain waves can thus help solve the binding problem by dynamically linking distributed neural representations into a unified conscious experience. Derived from knowledge stored in synapses, they filter and shape conscious perception and thought according to our internal models of the world. Their interactions can generate new brain states that update these models via top-down influences on spiking and synaptic plasticity."
      }
    ]
  },
  {
    "id": "spya-j9vs86",
    "name": "Multifunctional neurons replace one-neuron-one-function cortex",
    "provenance": "introduced",
    "statement": "Many cortical neurons do not have one fixed job; the same neuron's firing can mean different things depending on context, a property called mixed selectivity, so the cortex is not a set of separate specialist circuits.",
    "whyYouNeedIt": "Without this, the article's whole case against simple connectionist wiring and for a separate flexible control layer has no evidence to stand on.",
    "occurrences": [
      {
        "blockId": "spya-amx5qf",
        "quote": "Alternatively, many cortical neurons may be multifunctional, rather than specialized (Duncan and Miller, 2013, 2002).",
        "reasoning": "Introduces the claim that single neurons serve many roles rather than one fixed role.",
        "start": 670,
        "blockText": "This framework is not wrong, but it is incomplete. The connectionist approach was foundational and remains a good account of feedforward processing in the sensory cortex. But it cannot explain many observations. An early example was the consistent finding that any given task engages around a third of all neurons in the prefrontal cortex (Asaad et al., 2000; Freedman et al., 2001; Wallis et al., 2001; Xiang et al., 2025). Under the traditional connectionist model, this would imply that we can only learn about three different cognitive functions before essentially all prefrontal neurons have been “assigned a function”, and its computational capacity is saturated. Alternatively, many cortical neurons may be multifunctional, rather than specialized (Duncan and Miller, 2013, 2002). Subsequently, it was confirmed that many cortical (and subcortical) neurons do indeed multiplex different kinds of information in their activity (Asaad et al., 2000; Warden and Miller, 2007; Cromer et al., 2010; Akam and Kullmann, 2014; Lankarany et al., 2019; Ramakrishnan et al., 2017; Rigotti et al., 2013). This phenomenon has come to be called nonlinear “mixed selectivity” (Fusi et al., 2016; Rigotti et al., 2013; Tye et al., 2024)"
      },
      {
        "blockId": "spya-d6h3pv",
        "quote": "Mixed selectivity instead predicts that neurons reflect nonlinear combinations of variables, often integrating",
        "reasoning": "Defines mixed selectivity as the specific pattern of multifunctional firing being discussed.",
        "start": 389,
        "blockText": "To understand mixed selectivity, consider a task in which two objects and their order (first vs second) must be remembered (Fig. 2A) (Warden and Miller, 2007). Classical “pure” selectivity for object identity would predict similar neural responses to the same objects, regardless of their order in the sequence (Fig. 2B), as well as neurons whose sole function was to keep track of order. Mixed selectivity instead predicts that neurons reflect nonlinear combinations of variables, often integrating"
      },
      {
        "blockId": "spya-x5m34h",
        "quote": "A neuron might spike to object A, but only when it was seen first, and to object B, but only when it is seen second.",
        "reasoning": "Gives the concrete case showing a single neuron's meaning changes with context.",
        "start": 319,
        "blockText": "contextual information (like order) with sensory inputs (like objects) and motor actions. In our example, this corresponds to selective spiking to objects that changes depending on the context of their sequence order (Fig. 2C), as we observed in many prefrontal neurons (Rigotti et al., 2013; Warden and Miller, 2007). A neuron might spike to object A, but only when it was seen first, and to object B, but only when it is seen second."
      },
      {
        "blockId": "spya-fnm872",
        "quote": "This indicates the cortex is not a mosaic of isolated, specialized, circuits of specialized areas.",
        "reasoning": "Draws the larger conclusion that overlapping, non-modular organization follows from mixed selectivity.",
        "start": 173,
        "blockText": "Because mixed selectivity neurons blend sensory, motor, and contextual information, they are inherently multifunctional, sending different messages in different situations. This indicates the cortex is not a mosaic of isolated, specialized, circuits of specialized areas. This means that cortical neurons have the capacity to participate in multiple networks, shifting membership as needed."
      }
    ]
  },
  {
    "id": "spya-ju5jp9",
    "name": "Electric fields can move neurons without synapses",
    "provenance": "introduced",
    "statement": "Oscillating electric fields generated by neural activity directly nudge the voltage of nearby neurons and can trigger or suppress their firing, entirely apart from synaptic connections; this is called ephaptic coupling.",
    "analogy": "Like a radio signal reaching every receiver in range at once, instead of a letter that has to be carried along a fixed road to one address.",
    "occurrences": [
      {
        "blockId": "spya-bzqaf5",
        "quote": "Ephaptic coupling in the brain is the influence of neuronal electric fields on nearby neurons’ membrane potentials, allowing interaction and coordination independent of synapses",
        "reasoning": "States the direct, non-synaptic mechanism the article needs to make waves causally powerful rather than merely descriptive.",
        "start": 156,
        "blockText": "Oscillatory fluctuations in extracellular electric fields have direct field effects on the intracellular potentials and spiking activity of nearby neurons. Ephaptic coupling in the brain is the influence of neuronal electric fields on nearby neurons’ membrane potentials, allowing interaction and coordination independent of synapses (Anastassiou and Koch, 2015; Chiang et al., 2019; Faber and Pereda, 2018; Han et al., 2020; Katz and Schmitt, 1940; Pinotsis and Miller, 2023; Schmidt et al., 2021a; Hunt and MacIver, 2026). For example, cerebellar Purkinje cells generate extracellular potentials that are large enough to drive synchrony in nearby cells, even when chemical synapses and gap junctions are blocked (Han et al., 2018). Externally applied electric fields with strength in the range of endogenous fields can modulate and propagate neural waves, alter spike timing, and synchronize neurons (Anastassiou et al., 2011; Fröhlich and McCormick, 2010; Jæger and Tveito, 2026; Radman et al., 2007; Ruffini et al., 2020; Schloetter et al., 2025). Because many cortical neurons operate with membrane potentials fluctuating near the spike threshold, even weak oscillatory extracellular fields can induce small subthreshold voltage changes that significantly modulate both spiking probability and spike timing in local populations of neurons (Buzsáki and Draguhn, 2004; Ladenbauer and Obermayer, 2019; Radman et al., 2007). Individual ephaptic interactions, when synchronized and summed across neurons, create effects large enough to shape and coordinate neuron spiking at the mesoscale (Goldwyn and Rinzel, 2016; Cunha et al., 2024). This feedback of electric field effects onto spiking activity can thus recruit neurons into an activated population, as well as spatially and temporally coordinate their activity."
      },
      {
        "blockId": "spya-j7k4hu",
        "quote": "the speed of spike-based synaptic signalling is limited by conduction along axons and transmission across synapses. By contrast, changes in electric fields arise essentially concurrently with the underlying transmembrane currents",
        "reasoning": "Argues fields act faster than synaptic transmission, supporting their use for rapid control.",
        "start": 793,
        "blockText": "Neural organization and communication via electric fields potentially offers key advantages over traditional spiking and synaptic mechanisms. While spiking activity is itself very localized, the electric fields it helps create can spread across millimeters or more, due to correlated activity (Łęski et al., 2013; Xing et al., 2009). This could coordinate large cortical neighborhoods simultaneously. Individual spikes are brief, and cortical firing is sparse in space and time, with most neurons firing only a few spikes per second on average in brief bursts followed by longer periods of no spiking (Levenstein and Okun, 2023). In contrast, electric fields are continuous population activity and influence essentially all neurons within a local volume (Anastassiou and Koch, 2015). Further, the speed of spike-based synaptic signalling is limited by conduction along axons and transmission across synapses. By contrast, changes in electric fields arise essentially concurrently with the underlying transmembrane currents and spread through the local tissue at the speed of electromagnetic propagation, making them effectively instantaneous on neuronal timescales (Han et al., 2008; Schmidt et al., 2021b; Teleńczuk et al., 2017). This speed makes electric fields well suited for rapidly coordinating local activity (Pinotsis and Miller, 2023). Beyond effects at the level of spiking activity, electric field oscillations may also tune neural circuitry at a molecular level, improving network efficiency (Pinotsis et al., 2023)."
      },
      {
        "blockId": "spya-f59f0p",
        "quote": "These properties make oscillatory electric fields excellent candidates for rapid, large-scale control.",
        "reasoning": "Draws the conclusion that depends on fields physically affecting spiking independent of synapses.",
        "start": 0,
        "blockText": "These properties make oscillatory electric fields excellent candidates for rapid, large-scale control. They can align spike timing, activate or suppress ensembles, and flexibly route information across overlapping networks to support adaptive top-down control (Hunt and MacIver, 2026)."
      }
    ]
  },
  {
    "id": "spya-frdn0x",
    "name": "Alpha/beta rhythms act as spatial stencils that gate gamma spiking",
    "provenance": "introduced",
    "statement": "Slower alpha/beta waves spread across the cortex in specific spatial patterns that suppress faster gamma-band spiking in some locations while leaving other locations free to fire, and this push-pull pattern is what routes information to different places depending on context.",
    "occurrences": [
      {
        "blockId": "spya-hcav4k",
        "quote": "The \"Spatial Computing\" model builds on this idea by proposing how spatially-structured oscillations can exert flexible executive control over neural computation",
        "reasoning": "Introduces the named theory that spatial wave patterns, not synaptic rewiring, exert control.",
        "start": 0,
        "blockText": "The “Spatial Computing” model builds on this idea by proposing how spatially-structured oscillations can exert flexible executive control over neural computation (Lundqvist et al., 2023). It also exploits the distinct functional roles and push-pull relationship between gamma (~30–80 Hz) vs alpha and beta (~13–30 Hz) rhythms (see “Organization by Oscillations”)."
      },
      {
        "blockId": "spya-gkfdys",
        "quote": "Alpha/beta rhythms thus dampen or suppress gamma and associated spiking in targeted locations, creating a push-pull dynamic that determines where feedforward signals are suppressed.",
        "reasoning": "States the specific suppress/permit mechanism that is the theory's core claim.",
        "start": 473,
        "blockText": "strongest in deep (feedback) layers (Mendoza-Halliday et al., 2024). Spatial computing theory (Fig. 3) proposes that alpha/beta rhythms convey internally-generated signals whose spatial patterning reflects top-down information (Fig. 3A). They function as temporary inhibitory “stencils” across the surface of cortex. This regulates gamma and spiking in the feedforward and local recurrent circuits that carry sensory-related cognitive contents (Fig. 3B) and drive actions. Alpha/beta rhythms thus dampen or suppress gamma and associated spiking in targeted locations, creating a push-pull dynamic that determines where feedforward signals are suppressed. Feedforward signals are then permitted to emerge in the remaining “open” regions, where alpha/beta is weaker. Where spiking is expressed thus depends on the interaction between spatially random feedforward inputs and spatially organized alpha/beta suppression (Fig. 3C)."
      },
      {
        "blockId": "spya-gxyg0d",
        "quote": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information",
        "reasoning": "Explains why this mechanism solves the routing problem raised earlier about overlapping networks.",
        "start": 0,
        "blockText": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information (Badre et al., 2021; Chandrasekaran et al., 2025; MacDowell et al., 2022). It also allows for compositional reuse of the same control signals for any arbitrary information. Conversely, the same neuronal population can be reused for any arbitrary task demands, simply by changing the control “stencil” imposed on it (Tafazoli et al., 2026; Xie et al., 2022). This flexible push-pull interaction between alpha/beta and gamma/spiking signals provides a mechanism by which control systems can dynamically organize and shape thought and action."
      }
    ]
  },
  {
    "id": "spya-gxzd4r",
    "name": "Traveling waves drive switches between neural coding states",
    "provenance": "introduced",
    "statement": "Waves of inhibition and excitation that sweep across the cortical surface (traveling waves) are proposed to be the mechanism that shifts a population of neurons from one organized firing pattern to another, rather than just maintaining a single stable pattern.",
    "occurrences": [
      {
        "blockId": "spya-mrsvfu",
        "quote": "we propose that alpha/beta waves may constitute a control mechanism that transitions cortical population activity from one subspace to another.",
        "reasoning": "States directly that moving waves, not static ones, are proposed to drive representational change.",
        "start": 340,
        "blockText": "We propose that one role of traveling waves, particularly in the alpha/beta band, may be in instantiating state changes in neural coding. That is, by moving patterns of inhibition vs excitation across the surface of cortex, alpha/beta waves can alter which subsets of neurons are permitted to spike and their correlational structure. Thus, we propose that alpha/beta waves may constitute a control mechanism that transitions cortical population activity from one subspace to another. This can be thought of as a dynamic, spatiotemporal extension of Spatial Computing theory, Spatial Computing in motion. In our running example, we suggest traveling waves might be involved in transitioning activity between orthogonal subspaces for the objects presented in the two sequential orders (Fig. 5)."
      },
      {
        "blockId": "spya-qaza0y",
        "quote": "This hypothesis predicts that wave incidence should correlate with the overall temporal dynamics of population activity, but show little variation with specific sensory conditions.",
        "reasoning": "Gives the testable prediction that follows only if traveling waves cause state transitions.",
        "start": 0,
        "blockText": "This hypothesis predicts that wave incidence should correlate with the overall temporal dynamics of population activity, but show little variation with specific sensory conditions. This is broadly consistent with the aforementioned wave dynamics, and with the lack of clear differences in wave incidence or direction across task conditions. This hypothesis is also complementary to the traditional view of static beta oscillations as having a role in maintaining stable neural representations (Engel and Fries, 2010). This is usually taken to imply that the inverse situation, representational change, correlates with an overall reduction of beta rhythms. We suggest that this process, when viewed across a larger spatial region, is better characterized as a shift of beta from one spatial pattern to another, that is a spatiotemporal traveling wave."
      },
      {
        "blockId": "spya-gbpnax",
        "quote": "We propose this shift may be driven by alpha/beta traveling waves transitioning from one static pattern to the other.",
        "reasoning": "Restates the mechanism applied to the figure's concrete example of changing context.",
        "start": 280,
        "blockText": "Figure 5 – Spatiotemporal computing theory suggests traveling waves instantiate coding dynamics. Depicted is the transition between the alpha/beta control “stencil” for the first vs second sequential order context, and the resulting changes in the neural code for a given object. We propose this shift may be driven by alpha/beta traveling waves transitioning from one static pattern to the other."
      }
    ]
  },
  {
    "id": "spya-mvxekt",
    "name": "Waves compute by physically combining, not by stepping through instructions",
    "provenance": "introduced",
    "statement": "When two or more waves overlap, they add, cancel, or reshape each other according to physics, and this interaction itself carries out a calculation all at once across the whole area, unlike digital computing which works through steps one at a time.",
    "analogy": "Like ripples from two stones dropped in a pond merging into a new pattern instantly, rather than a calculator working out the sum one digit at a time.",
    "occurrences": [
      {
        "blockId": "spya-vp5h33",
        "quote": "When waves meet, they naturally add together, cancel out, or form new patterns through their superposition and interference",
        "reasoning": "States the physical basis of wave-based computation the article relies on.",
        "start": 328,
        "blockText": "Analog computing uses continuous physical quantities, such as voltages or mechanical motion, to directly represent and solve mathematical problems (Bournez and Pouly, 2018; Hughes et al., 2019; Tzarouchis et al., 2025). Unlike digital systems that rely on binary on/off signals, analog systems combine information continuously. When waves meet, they naturally add together, cancel out, or form new patterns through their superposition and interference (Fig. 6). Simple examples like overlapping sine waves show how addition, subtraction, and thus filtering can"
      },
      {
        "blockId": "spya-mgnqxk",
        "quote": "Because the wave interactions occur everywhere simultaneously, the computation is inherently parallel.",
        "reasoning": "Draws the contrast with sequential digital computation that motivates calling this 'analog computation'.",
        "start": 330,
        "blockText": "Importantly, analog computing is computationally efficient. In an analog system, the physical medium itself evolves all at once. How the waves interact (e.g., their geometry, frequencies, and phase relationships) model the equation. The variables are all encoded as a continuous physical quantity in different phases of the wave. Because the wave interactions occur everywhere simultaneously, the computation is inherently parallel. An analog system does not loop through variables but settles into a solution as a whole. This is in contrast to digital computing, which is inherently sequential, solving problems one step at a time. Brain‑inspired neuromorphic hardware, motivated by the energy efficiency of biological neural systems, has shown that analog computation can improve energy efficiency over digital by more than an order of magnitude (Ambrogio et al., 2023; Ye et al., 2025)."
      },
      {
        "blockId": "spya-prykb8",
        "quote": "Their wave summation would essentially compute an intersection of constraints, resulting in a unique spatiotemporal pattern of neural activation for every possible combination of contexts",
        "reasoning": "Applies the general wave-combination idea to a concrete cognitive example of combining two contexts.",
        "start": 318,
        "blockText": "As a simple concrete example, consider an extension to the previous task that requires combining control signals reflecting two distinct types of task context (Fig. 7A) (Warden and Miller, 2010). The idea is that each of these control signals would correspond to a distinct wave pattern across the cortex (Fig. 7B,C). Their wave summation would essentially compute an intersection of constraints, resulting in a unique spatiotemporal pattern of neural activation for every possible combination of contexts (Fig. 7B,C, right). Of course, this idea is not restricted to only simple combinations of control signals reflecting categorical variables. Waves might also be used to represent continuous physical quantities (e.g. speed, distance, spatial relationships) or mental constructs (e.g. value, emotion, social relationships). Their interactions might be used for neural computations underlying such complex cognitive functions as spatial causal reasoning or evaluating interpersonal relationships."
      }
    ]
  },
  {
    "id": "spya-qt9ev9",
    "name": "Anesthesia disrupts consciousness by disrupting wave organization, not just firing",
    "provenance": "introduced",
    "statement": "Different anesthetic drugs act on completely different molecular targets but all end up producing the same large-scale change: slow, poorly coordinated cortical waves, suggesting it is the organization of waves across the brain, not any particular receptor or cell type, that is tied to being conscious.",
    "occurrences": [
      {
        "blockId": "spya-m57373",
        "quote": "Anesthetics do not simply shut off the cortex. Instead, they profoundly alter wave dynamics",
        "reasoning": "Frames anesthesia as evidence about wave organization rather than mere silencing of neurons.",
        "start": 99,
        "blockText": "General anesthesia further supports a central role for brain waves in cognition and consciousness. Anesthetics do not simply shut off the cortex. Instead, they profoundly alter wave dynamics (Redinbaugh et al., 2020; Bastos et al., 2021)."
      },
      {
        "blockId": "spya-wnqgmn",
        "quote": "all converge on similar large-scale electrical effects in the cortex",
        "reasoning": "Shows that mechanistically distinct drugs produce one common wave outcome, the key evidence for the claim.",
        "start": 170,
        "blockText": "Despite acting on different molecular targets, different anesthetic agents, such as propofol (GABAergic), ketamine (NMDAergic), and dexmedetomidine (alpha-2 adrenergic), all converge on similar large-scale electrical effects in the cortex (Bardon et al., 2025; Eisen et al., 2026). The mixed, low-amplitude higher-frequency activity of wakefulness transitions to high-power slow delta (~1–4 Hz) oscillations across frontal, parietal, and sensory regions. These slow waves are often temporally misaligned, disrupting coordinated communication. The result may be a destabilized, fragmented cortex."
      },
      {
        "blockId": "spya-k02vdw",
        "quote": "This suggests that consciousness depends less on specific receptors or cell types and more on the integrity of large-scale wave organization.",
        "reasoning": "States the conclusion drawn from the convergence of diverse drugs on one wave pattern.",
        "start": 173,
        "blockText": "The main point here is that different pharmacological routes of different drugs nonetheless converge on the same systems-level outcome: Slow, desynchronized cortical waves. This suggests that consciousness depends less on specific receptors or cell types and more on the integrity of large-scale wave organization."
      }
    ]
  }
]
```

## Candidate Y

```json
[
  {
    "id": "spya-zxhpgc",
    "name": "Control without knowing synapse identities",
    "provenance": "assumed",
    "statement": "A control system that had to track and selectively coordinate specific synapses and neurons for each representation would face an implausible bookkeeping burden; flexible control must work without needing to identify which synapses encode what.",
    "whyYouNeedIt": "The argument against pure connectionist control and for wave-based mechanisms only holds if synaptic micromanagement is actually intractable at the relevant speed; otherwise synapses alone could do the job.",
    "occurrences": [
      {
        "blockId": "spya-d73kfb",
        "quote": "That would require a control system to \"know\" which synapses and neurons were employed for any given neural representation and selectively coordinate them with subsecond precision, a seemingly implausible computational demand.",
        "reasoning": "States the intractability but relies on the reader accepting synaptic-level control is inherently unscalable.",
        "start": 372,
        "blockText": "This is hard to reconcile with traditional models that view brain function as arising only from brief electrical impulses (“spikes”) transmitted through networks shaped by the synaptic connections between neurons. Spiking and synaptic connections are, of course, critical and fundamental. However, synaptic changes are likely too cumbersome for flexible top-down control. That would require a control system to “know” which synapses and neurons were employed for any given neural representation and selectively coordinate them with subsecond precision, a seemingly implausible computational demand."
      },
      {
        "blockId": "spya-gxyg0d",
        "quote": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information",
        "reasoning": "Presents waves as solving a problem whose severity depends on this assumed constraint.",
        "start": 0,
        "blockText": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information (Badre et al., 2021; Chandrasekaran et al., 2025; MacDowell et al., 2022). It also allows for compositional reuse of the same control signals for any arbitrary information. Conversely, the same neuronal population can be reused for any arbitrary task demands, simply by changing the control “stencil” imposed on it (Tafazoli et al., 2026; Xie et al., 2022). This flexible push-pull interaction between alpha/beta and gamma/spiking signals provides a mechanism by which control systems can dynamically organize and shape thought and action."
      }
    ]
  },
  {
    "id": "spya-sgt2hj",
    "name": "Neurons are reusable, multi-purpose components",
    "provenance": "introduced",
    "statement": "Individual cortical neurons do not have one fixed job; the same neuron can carry different kinds of information depending on context, and the brain reuses neurons across many computations rather than dedicating separate neurons to each function.",
    "occurrences": [
      {
        "blockId": "spya-amx5qf",
        "quote": "many cortical neurons may be multifunctional, rather than specialized",
        "reasoning": "Directly introduces the idea that neurons lack fixed dedicated roles.",
        "start": 685,
        "blockText": "This framework is not wrong, but it is incomplete. The connectionist approach was foundational and remains a good account of feedforward processing in the sensory cortex. But it cannot explain many observations. An early example was the consistent finding that any given task engages around a third of all neurons in the prefrontal cortex (Asaad et al., 2000; Freedman et al., 2001; Wallis et al., 2001; Xiang et al., 2025). Under the traditional connectionist model, this would imply that we can only learn about three different cognitive functions before essentially all prefrontal neurons have been “assigned a function”, and its computational capacity is saturated. Alternatively, many cortical neurons may be multifunctional, rather than specialized (Duncan and Miller, 2013, 2002). Subsequently, it was confirmed that many cortical (and subcortical) neurons do indeed multiplex different kinds of information in their activity (Asaad et al., 2000; Warden and Miller, 2007; Cromer et al., 2010; Akam and Kullmann, 2014; Lankarany et al., 2019; Ramakrishnan et al., 2017; Rigotti et al., 2013). This phenomenon has come to be called nonlinear “mixed selectivity” (Fusi et al., 2016; Rigotti et al., 2013; Tye et al., 2024)"
      },
      {
        "blockId": "spya-fnm872",
        "quote": "This means that cortical neurons have the capacity to participate in multiple networks, shifting membership as needed.",
        "reasoning": "Extends the multifunctionality claim to network membership.",
        "start": 272,
        "blockText": "Because mixed selectivity neurons blend sensory, motor, and contextual information, they are inherently multifunctional, sending different messages in different situations. This indicates the cortex is not a mosaic of isolated, specialized, circuits of specialized areas. This means that cortical neurons have the capacity to participate in multiple networks, shifting membership as needed."
      }
    ]
  },
  {
    "id": "spya-kqh24j",
    "name": "Electric fields can move faster and wider than spikes",
    "provenance": "introduced",
    "statement": "Because electric fields spread through tissue at the speed of electromagnetic propagation and influence all nearby neurons continuously, they can coordinate larger populations faster than spike-based synaptic transmission, which is slow, sparse, and localized.",
    "occurrences": [
      {
        "blockId": "spya-j7k4hu",
        "quote": "changes in electric fields arise essentially concurrently with the underlying transmembrane currents and spread through the local tissue at the speed of electromagnetic propagation, making them effectively instantaneous on neuronal timescales",
        "reasoning": "States the speed/breadth advantage of fields over spikes.",
        "start": 922,
        "blockText": "Neural organization and communication via electric fields potentially offers key advantages over traditional spiking and synaptic mechanisms. While spiking activity is itself very localized, the electric fields it helps create can spread across millimeters or more, due to correlated activity (Łęski et al., 2013; Xing et al., 2009). This could coordinate large cortical neighborhoods simultaneously. Individual spikes are brief, and cortical firing is sparse in space and time, with most neurons firing only a few spikes per second on average in brief bursts followed by longer periods of no spiking (Levenstein and Okun, 2023). In contrast, electric fields are continuous population activity and influence essentially all neurons within a local volume (Anastassiou and Koch, 2015). Further, the speed of spike-based synaptic signalling is limited by conduction along axons and transmission across synapses. By contrast, changes in electric fields arise essentially concurrently with the underlying transmembrane currents and spread through the local tissue at the speed of electromagnetic propagation, making them effectively instantaneous on neuronal timescales (Han et al., 2008; Schmidt et al., 2021b; Teleńczuk et al., 2017). This speed makes electric fields well suited for rapidly coordinating local activity (Pinotsis and Miller, 2023). Beyond effects at the level of spiking activity, electric field oscillations may also tune neural circuitry at a molecular level, improving network efficiency (Pinotsis et al., 2023)."
      },
      {
        "blockId": "spya-f59f0p",
        "quote": "These properties make oscillatory electric fields excellent candidates for rapid, large-scale control.",
        "reasoning": "Draws the conclusion that follows from the speed/breadth claim.",
        "start": 0,
        "blockText": "These properties make oscillatory electric fields excellent candidates for rapid, large-scale control. They can align spike timing, activate or suppress ensembles, and flexibly route information across overlapping networks to support adaptive top-down control (Hunt and MacIver, 2026)."
      }
    ]
  },
  {
    "id": "spya-fmtyq9",
    "name": "Suppression-based routing via spatial stencils",
    "provenance": "introduced",
    "statement": "Spatially patterned alpha/beta waves act like a stencil of inhibition over the cortex, letting feedforward gamma/spiking signals through only in the 'open' regions, so where information is expressed depends on the interaction between fixed feedforward drive and a changeable inhibitory pattern.",
    "occurrences": [
      {
        "blockId": "spya-gkfdys",
        "quote": "They function as temporary inhibitory \"stencils\" across the surface of cortex.",
        "reasoning": "States the stencil mechanism directly.",
        "start": 238,
        "blockText": "strongest in deep (feedback) layers (Mendoza-Halliday et al., 2024). Spatial computing theory (Fig. 3) proposes that alpha/beta rhythms convey internally-generated signals whose spatial patterning reflects top-down information (Fig. 3A). They function as temporary inhibitory “stencils” across the surface of cortex. This regulates gamma and spiking in the feedforward and local recurrent circuits that carry sensory-related cognitive contents (Fig. 3B) and drive actions. Alpha/beta rhythms thus dampen or suppress gamma and associated spiking in targeted locations, creating a push-pull dynamic that determines where feedforward signals are suppressed. Feedforward signals are then permitted to emerge in the remaining “open” regions, where alpha/beta is weaker. Where spiking is expressed thus depends on the interaction between spatially random feedforward inputs and spatially organized alpha/beta suppression (Fig. 3C)."
      },
      {
        "blockId": "spya-gxyg0d",
        "quote": "It also allows for compositional reuse of the same control signals for any arbitrary information.",
        "reasoning": "Develops the implication of reusable stencils for flexible control.",
        "start": 283,
        "blockText": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information (Badre et al., 2021; Chandrasekaran et al., 2025; MacDowell et al., 2022). It also allows for compositional reuse of the same control signals for any arbitrary information. Conversely, the same neuronal population can be reused for any arbitrary task demands, simply by changing the control “stencil” imposed on it (Tafazoli et al., 2026; Xie et al., 2022). This flexible push-pull interaction between alpha/beta and gamma/spiking signals provides a mechanism by which control systems can dynamically organize and shape thought and action."
      }
    ]
  },
  {
    "id": "spya-vmefz6",
    "name": "Mixed selectivity is gating, not fixed tuning",
    "provenance": "introduced",
    "statement": "Apparent context-dependent selectivity of a neuron can arise purely from whether a changing inhibitory wave pattern happens to cover that neuron in a given context, without the neuron having any innate preference for that context.",
    "whyYouNeedIt": "Without this, mixed selectivity would seem to require specially wired 'context neurons', undermining the wave-control account of flexible cognition.",
    "occurrences": [
      {
        "blockId": "spya-ectcj5",
        "quote": "the same neuron may receive many different sensory signals and may lie inside the inhibitory stencil in one context and outside it in another. This context-dependent gating can make a neuron effectively change its selectivity",
        "reasoning": "Directly states gating produces apparent selectivity changes.",
        "start": 446,
        "blockText": "Spatial Computing theory provides a straightforward, concrete way for nonlinear mixed selectivity to emerge from wave-based control acting on a large multifunctional population of neurons. Each goal or context creates a unique, temporary alpha/beta “stencil” that suppresses gamma and spiking in some locations while sparing others (e.g. first vs second sequence order in our example; Fig. 3A). Because the neurons have overlapping connectivity, the same neuron may receive many different sensory signals and may lie inside the inhibitory stencil in one context and outside it in another. This context-dependent gating can make a neuron effectively change its selectivity, producing the nonlinear mixed selectivity observed by many studies (Fig. 4A). This account predicts that prefrontal cortex neurons should exhibit spatial organization for goals and contexts, as suggested by recent work (Fang et al., 2025)."
      },
      {
        "blockId": "spya-ee45vr",
        "quote": "there is no requirement for specialized \"context neurons\" or \"object neurons\" with fixed tuning predicted by classical connectionists views of cortex",
        "reasoning": "Confirms the point that fixed tuning is unnecessary given gating.",
        "start": 14,
        "blockText": "In this view, there is no requirement for specialized “context neurons” or “object neurons” with fixed tuning predicted by classical connectionists views of cortex. Instead, mixed selectivity arises from the interaction between broadly responsive neurons and mesoscale wave patterns that control when and where spiking is expressed. Synaptic connectivity provides a rich representational space, while alpha/beta vs gamma dynamics determine which subpopulations are active under each condition, enabling flexible computation."
      }
    ]
  },
  {
    "id": "spya-xvt0at",
    "name": "Low-dimensional subspaces as a byproduct of shared control signals",
    "provenance": "introduced",
    "statement": "Population activity appears structured and low-dimensional not because of special wiring but because a shared wave-based control signal imposes common structure on many noisy, individually unreliable neurons simultaneously.",
    "occurrences": [
      {
        "blockId": "spya-qsz9ur",
        "quote": "Rather than independent units driven solely by local, specialized connections, cortical populations behave like a coordinated flock governed by shared dynamics.",
        "reasoning": "States that shared dynamics, not independent wiring, explain population-level structure.",
        "start": 154,
        "blockText": "This framework reconciles two observations: Single neurons are noisy and context dependent, yet populations exhibit structured, low-dimensional behavior. Rather than independent units driven solely by local, specialized connections, cortical populations behave like a coordinated flock governed by shared dynamics. Brain waves offer a tractable mechanism for this coordination. Low-dimensional spiking trajectories in subspace can be seen as the spiking-level expression of broader wave-based control signals that impose global structure on neural activity."
      },
      {
        "blockId": "spya-ns23sq",
        "quote": "Alpha/beta control signals segregate spiking activity into partially overlapping active subsets, each of which exhibits structured patterns of correlation",
        "reasoning": "Shows the mechanism generating subspace structure from control signals.",
        "start": 533,
        "blockText": "Structuring activity via subspace coding is thought to organize information processing, for example by segregating different computations into independent (orthogonal) subspaces to minimize interference (Fig. 4B) (Yoo and Hayden, 2020; Tang et al., 2020; Johnston et al., 2023; Libby and Buschman, 2021; Panichello and Buschman, 2021; Maggi and Humphries, 2022; Xie et al., 2022; Weber et al., 2023; Kaufman et al., 2014; Genkin et al., 2025). Spatial Computing theory also provides a potential neural mechanism for subspace coding. Alpha/beta control signals segregate spiking activity into partially overlapping active subsets, each of which exhibits structured patterns of correlation (Fig. 4A). This is essentially a description of the organization of spiking activity into orthogonal activation subspaces (Fig. 4B)."
      }
    ]
  },
  {
    "id": "spya-v7b9fx",
    "name": "Waves compute by physical superposition, not sequential steps",
    "provenance": "introduced",
    "statement": "When multiple wave patterns overlap in the cortex, their physical summation simultaneously performs a calculation across the whole affected area at once, unlike digital computation which proceeds step by step through variables.",
    "analogy": "It is like adding two ripples on a pond: the resulting ripple pattern at every point is computed instantly everywhere by the water itself, with no step-by-step procedure.",
    "occurrences": [
      {
        "blockId": "spya-mgnqxk",
        "quote": "Because the wave interactions occur everywhere simultaneously, the computation is inherently parallel. An analog system does not loop through variables but settles into a solution as a whole.",
        "reasoning": "States the core parallel/analog computation claim.",
        "start": 330,
        "blockText": "Importantly, analog computing is computationally efficient. In an analog system, the physical medium itself evolves all at once. How the waves interact (e.g., their geometry, frequencies, and phase relationships) model the equation. The variables are all encoded as a continuous physical quantity in different phases of the wave. Because the wave interactions occur everywhere simultaneously, the computation is inherently parallel. An analog system does not loop through variables but settles into a solution as a whole. This is in contrast to digital computing, which is inherently sequential, solving problems one step at a time. Brain‑inspired neuromorphic hardware, motivated by the energy efficiency of biological neural systems, has shown that analog computation can improve energy efficiency over digital by more than an order of magnitude (Ambrogio et al., 2023; Ye et al., 2025)."
      },
      {
        "blockId": "spya-prykb8",
        "quote": "Their wave summation would essentially compute an intersection of constraints, resulting in a unique spatiotemporal pattern of neural activation for every possible combination of contexts",
        "reasoning": "Applies the superposition-as-computation idea to a concrete task example.",
        "start": 318,
        "blockText": "As a simple concrete example, consider an extension to the previous task that requires combining control signals reflecting two distinct types of task context (Fig. 7A) (Warden and Miller, 2010). The idea is that each of these control signals would correspond to a distinct wave pattern across the cortex (Fig. 7B,C). Their wave summation would essentially compute an intersection of constraints, resulting in a unique spatiotemporal pattern of neural activation for every possible combination of contexts (Fig. 7B,C, right). Of course, this idea is not restricted to only simple combinations of control signals reflecting categorical variables. Waves might also be used to represent continuous physical quantities (e.g. speed, distance, spatial relationships) or mental constructs (e.g. value, emotion, social relationships). Their interactions might be used for neural computations underlying such complex cognitive functions as spatial causal reasoning or evaluating interpersonal relationships."
      }
    ]
  },
  {
    "id": "spya-rdva8a",
    "name": "Convergent wave disruption as the signature of lost consciousness",
    "provenance": "introduced",
    "statement": "Different anesthetic drugs acting on entirely different molecular receptors all produce the same large-scale shift toward slow, desynchronized cortical waves, suggesting consciousness depends on the organization of brain-wide wave activity rather than on any specific neurotransmitter system.",
    "occurrences": [
      {
        "blockId": "spya-wnqgmn",
        "quote": "Despite acting on different molecular targets, different anesthetic agents, such as propofol (GABAergic), ketamine (NMDAergic), and dexmedetomidine (alpha-2 adrenergic), all converge on similar large-scale electrical effects in the cortex",
        "reasoning": "States the convergence of diverse drugs on one wave signature.",
        "start": 0,
        "blockText": "Despite acting on different molecular targets, different anesthetic agents, such as propofol (GABAergic), ketamine (NMDAergic), and dexmedetomidine (alpha-2 adrenergic), all converge on similar large-scale electrical effects in the cortex (Bardon et al., 2025; Eisen et al., 2026). The mixed, low-amplitude higher-frequency activity of wakefulness transitions to high-power slow delta (~1–4 Hz) oscillations across frontal, parietal, and sensory regions. These slow waves are often temporally misaligned, disrupting coordinated communication. The result may be a destabilized, fragmented cortex."
      },
      {
        "blockId": "spya-k02vdw",
        "quote": "This suggests that consciousness depends less on specific receptors or cell types and more on the integrity of large-scale wave organization.",
        "reasoning": "Draws the explicit conclusion that wave organization, not receptor identity, underlies consciousness.",
        "start": 173,
        "blockText": "The main point here is that different pharmacological routes of different drugs nonetheless converge on the same systems-level outcome: Slow, desynchronized cortical waves. This suggests that consciousness depends less on specific receptors or cell types and more on the integrity of large-scale wave organization."
      }
    ]
  }
]
```

## Candidate Z

```json
[
  {
    "id": "spya-njvwbd",
    "name": "Information lives in patterns across populations, not single neurons",
    "provenance": "assumed",
    "statement": "What a piece of information 'means' in the brain is carried by the joint pattern of activity across many neurons together, not by which single neuron is active, so the same neuron can take part in different messages depending on the surrounding pattern.",
    "whyYouNeedIt": "Without this assumption, the description of a neuron spiking for object A only in one order and object B only in another would just look like noisy, inconsistent firing rather than evidence of a coherent, flexible code; the mixed-selectivity and subspace arguments only make sense if meaning is read off the population pattern.",
    "occurrences": [
      {
        "blockId": "spya-x5m34h",
        "quote": "A neuron might spike to object A, but only when it was seen first, and to object B, but only when it is seen second.",
        "reasoning": "Only counts as meaningful 'context-dependent selectivity' rather than noise if the reader already accepts that the neuron's contribution is read as part of a larger population code.",
        "start": 319,
        "blockText": "contextual information (like order) with sensory inputs (like objects) and motor actions. In our example, this corresponds to selective spiking to objects that changes depending on the context of their sequence order (Fig. 2C), as we observed in many prefrontal neurons (Rigotti et al., 2013; Warden and Miller, 2007). A neuron might spike to object A, but only when it was seen first, and to object B, but only when it is seen second."
      },
      {
        "blockId": "spya-xphb7u",
        "quote": "This information is spread across a population of neurons whose activity is not independent, but instead exhibits structured patterns of coordination.",
        "reasoning": "Takes for granted that information is a property of the joint pattern rather than of individual neurons, which the subspace argument depends on.",
        "start": 111,
        "blockText": "Mixed selectivity means that single neurons have access to a rich, high-dimensional set of nonlinear features. This information is spread across a population of neurons whose activity is not independent, but instead exhibits structured patterns of coordination. As a result, population spiking tends to occupy a lower-dimensional “subspace” or “manifold” within the high-dimensional space defined by all possible population activity patterns (Ebitz and Hayden, 2021). Note that neural coding can be both low-dimensional compared to the high-dimensional code implied by independent activity and high-dimensional compared to the low-dimensional code implied by “pure” unmixed selectivity. This is consistent with broad anatomical gradients in the cortex, which compress signals to create functional equivalences, establishing the anatomical"
      },
      {
        "blockId": "spya-ns23sq",
        "quote": "Structuring activity via subspace coding is thought to organize information processing, for example by segregating different computations into independent (orthogonal) subspaces to minimize interference",
        "reasoning": "Presupposes that computations are properties of population-level geometric structure, a claim never separately justified before being used.",
        "start": 0,
        "blockText": "Structuring activity via subspace coding is thought to organize information processing, for example by segregating different computations into independent (orthogonal) subspaces to minimize interference (Fig. 4B) (Yoo and Hayden, 2020; Tang et al., 2020; Johnston et al., 2023; Libby and Buschman, 2021; Panichello and Buschman, 2021; Maggi and Humphries, 2022; Xie et al., 2022; Weber et al., 2023; Kaufman et al., 2014; Genkin et al., 2025). Spatial Computing theory also provides a potential neural mechanism for subspace coding. Alpha/beta control signals segregate spiking activity into partially overlapping active subsets, each of which exhibits structured patterns of correlation (Fig. 4A). This is essentially a description of the organization of spiking activity into orthogonal activation subspaces (Fig. 4B)."
      }
    ]
  },
  {
    "id": "spya-n8cxkn",
    "name": "Consciousness requires binding distributed activity into one whole",
    "provenance": "assumed",
    "statement": "Conscious experience is treated as inherently a single, unified state, so that scattered activity across many neurons and regions must somehow be linked together into one whole for consciousness to occur at all.",
    "whyYouNeedIt": "The claim that waves 'solve the binding problem' and produce 'unified consciousness' only matters if you already accept that unity is the thing needing explanation in the first place; the article never argues for why consciousness must be unified, it simply builds its mechanism to deliver that unity.",
    "occurrences": [
      {
        "blockId": "spya-tdqde5",
        "quote": "Brain waves can thus help solve the binding problem by dynamically linking distributed neural representations into a unified conscious experience.",
        "reasoning": "Presents solving the binding problem as the payoff, which presupposes the reader already accepts unity as the target to be explained.",
        "start": 456,
        "blockText": "Moment‑to‑moment coordination underlying cognition and consciousness is thus dominated by brain waves rather than rapid synaptic changes. Different wave types coordinate activity at different scales: Slower waves can suppress some regions while enabling spiking in others, effectively routing information. Synapses provide representational capacity for storing information, while brain waves determine which representations are active at any given moment. Brain waves can thus help solve the binding problem by dynamically linking distributed neural representations into a unified conscious experience. Derived from knowledge stored in synapses, they filter and shape conscious perception and thought according to our internal models of the world. Their interactions can generate new brain states that update these models via top-down influences on spiking and synaptic plasticity."
      },
      {
        "blockId": "spya-m9exy5",
        "quote": "These wave interactions not only bind distributed neural populations into coherent states but also carry out computations that support flexible thought and control.",
        "reasoning": "Treats binding into coherent states as self-evidently the goal consciousness theories must achieve.",
        "start": 143,
        "blockText": "In this view, rhythmic electric fields unify and structure cortical activity, allowing analog computation to take place across space and time. These wave interactions not only bind distributed neural populations into coherent states but also carry out computations that support flexible thought and control. Consciousness, then, emerges when these dynamic wave patterns bring the cortex into an organized, globally integrated state, one that naturally links and influences widespread activity."
      }
    ]
  },
  {
    "id": "spya-n49epz",
    "name": "Spikes and waves form a two-way control loop",
    "provenance": "introduced",
    "statement": "Brain waves are not just a byproduct of neurons firing; they actively shape when and where neurons fire, while spiking in turn generates the waves, so the two continuously shape each other in both directions.",
    "occurrences": [
      {
        "blockId": "spya-z9g2s3",
        "quote": "Spikes shape brain waves, while the waves in turn influence when and where spikes occur.",
        "reasoning": "Makes explicit that causation runs both ways, not just from spikes to waves.",
        "start": 602,
        "blockText": "A biologically plausible mechanism may involve an emergent level of influence from electric field oscillations, i.e., brain waves. These waves reflect reverberating activity in neural circuits coordinated over millimeter-to-centimeter scales, providing a basic internal organization beyond simple feedforward reactions to the environment. Evolution could exploit this default organization by developing mechanisms that control oscillatory dynamics. Crucially, brain waves do not merely mirror spiking activity. They alter the electrical field environment that is itself critical for generating spikes. Spikes shape brain waves, while the waves in turn influence when and where spikes occur. We outline evidence for a complementary framework in which synaptic connections and spikes interact with brain wave dynamics to support the coordination and computation underlying cognition and consciousness."
      },
      {
        "blockId": "spya-f0dqyd",
        "quote": "This creates a feedback loop: Synapses shape spiking, spiking contributes to brain waves, and waves shape spiking.",
        "reasoning": "Restates the loop as the mechanism linking synapses, spikes, and waves in the final framework.",
        "start": 363,
        "blockText": "The idea is that synapses and brain waves play complementary roles (Fig 8). Synaptic connections, shaped by experience, store long‑term information and define potential activity patterns. When neurons fire spikes, they generate electric fields that influence nearby neurons through ephaptic coupling, i.e., electrical interaction without direct synaptic contact. This creates a feedback loop: Synapses shape spiking, spiking contributes to brain waves, and waves shape spiking. Spikes and gamma, by virtue of their higher frequency, represent higher‑resolution (smaller‑spatal scale) sensory and motor information. Lower‑frequency rhythms such as alpha/beta and theta instead exert larger‑scale control, organizing where sensory and motor spiking/gamma occur according to top‑down schemas, goals, plans, and memories."
      }
    ]
  },
  {
    "id": "spya-ma64e5",
    "name": "Multifunctional neurons break the one-neuron-one-function model",
    "provenance": "introduced",
    "statement": "Many cortical neurons do not have one fixed job; the same neuron's firing can mean different things depending on context, which is incompatible with a model where each neuron is permanently tuned to one stable feature.",
    "occurrences": [
      {
        "blockId": "spya-amx5qf",
        "quote": "Under the traditional connectionist model, this would imply that we can only learn about three different cognitive functions before essentially all prefrontal neurons have been \"assigned a function\", and its computational capacity is saturated.",
        "reasoning": "Shows the fixed-function model leading to an absurd capacity limit, motivating rejection of that model.",
        "start": 425,
        "blockText": "This framework is not wrong, but it is incomplete. The connectionist approach was foundational and remains a good account of feedforward processing in the sensory cortex. But it cannot explain many observations. An early example was the consistent finding that any given task engages around a third of all neurons in the prefrontal cortex (Asaad et al., 2000; Freedman et al., 2001; Wallis et al., 2001; Xiang et al., 2025). Under the traditional connectionist model, this would imply that we can only learn about three different cognitive functions before essentially all prefrontal neurons have been “assigned a function”, and its computational capacity is saturated. Alternatively, many cortical neurons may be multifunctional, rather than specialized (Duncan and Miller, 2013, 2002). Subsequently, it was confirmed that many cortical (and subcortical) neurons do indeed multiplex different kinds of information in their activity (Asaad et al., 2000; Warden and Miller, 2007; Cromer et al., 2010; Akam and Kullmann, 2014; Lankarany et al., 2019; Ramakrishnan et al., 2017; Rigotti et al., 2013). This phenomenon has come to be called nonlinear “mixed selectivity” (Fusi et al., 2016; Rigotti et al., 2013; Tye et al., 2024)"
      },
      {
        "blockId": "spya-njs6ff",
        "quote": "Thus, these neurons embody the flexible, context-dependent behavior associated with higher cognition",
        "reasoning": "States directly that context-dependent firing, not fixed tuning, is what underlies flexible cognition.",
        "start": 0,
        "blockText": "Thus, these neurons embody the flexible, context-dependent behavior associated with higher cognition (Rigotti et al., 2013; Fusi et al., 2016; Tye et al., 2024). Modeling studies show that such neurons greatly expand a network’s computational power by providing a higher-order representational space (Rigotti et al., 2013; Fusi et al., 2016; Tye et al., 2024). Further, they also greatly expand a network’s capacity to store information because information is multiplexed across many multifunctional neurons rather than segregated into specialist neurons (Rigotti et al., 2013). But they are not merely the “icing on the cake” of cortical processing. Instead, nonlinear mixed selectivity seems to reflect a core computational principle (Johnston et al., 2020). They are prevalent in higher areas like prefrontal cortex (Abbass et al., 2025; Dang et al., 2022; Mouille et al., 2025; Parthasarathy et al., 2017; Warden and Miller, 2007) but also in primary sensory and motor cortex (Grunfeld and Likhtik, 2018; Kaufman et al., 2022; Kira et al., 2023; Tseng et al., 2022; Tye et al., 2024)."
      },
      {
        "blockId": "spya-fnm872",
        "quote": "This indicates the cortex is not a mosaic of isolated, specialized, circuits of specialized areas.",
        "reasoning": "Draws the explicit conclusion against modular, fixed-function organization.",
        "start": 173,
        "blockText": "Because mixed selectivity neurons blend sensory, motor, and contextual information, they are inherently multifunctional, sending different messages in different situations. This indicates the cortex is not a mosaic of isolated, specialized, circuits of specialized areas. This means that cortical neurons have the capacity to participate in multiple networks, shifting membership as needed."
      }
    ]
  },
  {
    "id": "spya-vdmrn3",
    "name": "Electric fields move neurons without using synapses",
    "provenance": "introduced",
    "statement": "The electric fields that neural activity generates can directly push neighboring neurons toward or away from firing, through the tissue itself, without any synaptic connection being involved, and this happens essentially instantly compared to synaptic transmission.",
    "occurrences": [
      {
        "blockId": "spya-bzqaf5",
        "quote": "Ephaptic coupling in the brain is the influence of neuronal electric fields on nearby neurons' membrane potentials, allowing interaction and coordination independent of synapses",
        "reasoning": "Defines the synapse-free mechanism the rest of the argument depends on.",
        "start": 156,
        "blockText": "Oscillatory fluctuations in extracellular electric fields have direct field effects on the intracellular potentials and spiking activity of nearby neurons. Ephaptic coupling in the brain is the influence of neuronal electric fields on nearby neurons’ membrane potentials, allowing interaction and coordination independent of synapses (Anastassiou and Koch, 2015; Chiang et al., 2019; Faber and Pereda, 2018; Han et al., 2020; Katz and Schmitt, 1940; Pinotsis and Miller, 2023; Schmidt et al., 2021a; Hunt and MacIver, 2026). For example, cerebellar Purkinje cells generate extracellular potentials that are large enough to drive synchrony in nearby cells, even when chemical synapses and gap junctions are blocked (Han et al., 2018). Externally applied electric fields with strength in the range of endogenous fields can modulate and propagate neural waves, alter spike timing, and synchronize neurons (Anastassiou et al., 2011; Fröhlich and McCormick, 2010; Jæger and Tveito, 2026; Radman et al., 2007; Ruffini et al., 2020; Schloetter et al., 2025). Because many cortical neurons operate with membrane potentials fluctuating near the spike threshold, even weak oscillatory extracellular fields can induce small subthreshold voltage changes that significantly modulate both spiking probability and spike timing in local populations of neurons (Buzsáki and Draguhn, 2004; Ladenbauer and Obermayer, 2019; Radman et al., 2007). Individual ephaptic interactions, when synchronized and summed across neurons, create effects large enough to shape and coordinate neuron spiking at the mesoscale (Goldwyn and Rinzel, 2016; Cunha et al., 2024). This feedback of electric field effects onto spiking activity can thus recruit neurons into an activated population, as well as spatially and temporally coordinate their activity."
      },
      {
        "blockId": "spya-j7k4hu",
        "quote": "changes in electric fields arise essentially concurrently with the underlying transmembrane currents and spread through the local tissue at the speed of electromagnetic propagation, making them effectively instantaneous on neuronal timescales",
        "reasoning": "Establishes the speed advantage that makes field effects plausible for fast control, unlike synaptic routing.",
        "start": 922,
        "blockText": "Neural organization and communication via electric fields potentially offers key advantages over traditional spiking and synaptic mechanisms. While spiking activity is itself very localized, the electric fields it helps create can spread across millimeters or more, due to correlated activity (Łęski et al., 2013; Xing et al., 2009). This could coordinate large cortical neighborhoods simultaneously. Individual spikes are brief, and cortical firing is sparse in space and time, with most neurons firing only a few spikes per second on average in brief bursts followed by longer periods of no spiking (Levenstein and Okun, 2023). In contrast, electric fields are continuous population activity and influence essentially all neurons within a local volume (Anastassiou and Koch, 2015). Further, the speed of spike-based synaptic signalling is limited by conduction along axons and transmission across synapses. By contrast, changes in electric fields arise essentially concurrently with the underlying transmembrane currents and spread through the local tissue at the speed of electromagnetic propagation, making them effectively instantaneous on neuronal timescales (Han et al., 2008; Schmidt et al., 2021b; Teleńczuk et al., 2017). This speed makes electric fields well suited for rapidly coordinating local activity (Pinotsis and Miller, 2023). Beyond effects at the level of spiking activity, electric field oscillations may also tune neural circuitry at a molecular level, improving network efficiency (Pinotsis et al., 2023)."
      },
      {
        "blockId": "spya-f59f0p",
        "quote": "These properties make oscillatory electric fields excellent candidates for rapid, large-scale control.",
        "reasoning": "Draws the conclusion that this mechanism, not synapses, is suited to top-down control.",
        "start": 0,
        "blockText": "These properties make oscillatory electric fields excellent candidates for rapid, large-scale control. They can align spike timing, activate or suppress ensembles, and flexibly route information across overlapping networks to support adaptive top-down control (Hunt and MacIver, 2026)."
      }
    ]
  },
  {
    "id": "spya-ury9nh",
    "name": "Alpha/beta waves act as stencils gating gamma spiking",
    "provenance": "introduced",
    "statement": "Spatially patterned alpha/beta rhythms act like temporary stencils that suppress gamma-band spiking in some cortical locations while leaving others free, and this push-pull pattern determines where information gets expressed in neural firing at any moment.",
    "occurrences": [
      {
        "blockId": "spya-gkfdys",
        "quote": "They function as temporary inhibitory \"stencils\" across the surface of cortex.",
        "reasoning": "States the core stencil mechanism of the theory directly.",
        "start": 238,
        "blockText": "strongest in deep (feedback) layers (Mendoza-Halliday et al., 2024). Spatial computing theory (Fig. 3) proposes that alpha/beta rhythms convey internally-generated signals whose spatial patterning reflects top-down information (Fig. 3A). They function as temporary inhibitory “stencils” across the surface of cortex. This regulates gamma and spiking in the feedforward and local recurrent circuits that carry sensory-related cognitive contents (Fig. 3B) and drive actions. Alpha/beta rhythms thus dampen or suppress gamma and associated spiking in targeted locations, creating a push-pull dynamic that determines where feedforward signals are suppressed. Feedforward signals are then permitted to emerge in the remaining “open” regions, where alpha/beta is weaker. Where spiking is expressed thus depends on the interaction between spatially random feedforward inputs and spatially organized alpha/beta suppression (Fig. 3C)."
      },
      {
        "blockId": "spya-gxyg0d",
        "quote": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information",
        "reasoning": "Explains why this mechanism solves the routing problem raised earlier about mixed selectivity.",
        "start": 0,
        "blockText": "This scheme allows for flexible control over the neural expression of information in spiking, without the control system needing to know the precise neurons and synapses employed for any specific information (Badre et al., 2021; Chandrasekaran et al., 2025; MacDowell et al., 2022). It also allows for compositional reuse of the same control signals for any arbitrary information. Conversely, the same neuronal population can be reused for any arbitrary task demands, simply by changing the control “stencil” imposed on it (Tafazoli et al., 2026; Xie et al., 2022). This flexible push-pull interaction between alpha/beta and gamma/spiking signals provides a mechanism by which control systems can dynamically organize and shape thought and action."
      },
      {
        "blockId": "spya-ectcj5",
        "quote": "Each goal or context creates a unique, temporary alpha/beta \"stencil\" that suppresses gamma and spiking in some locations while sparing others",
        "reasoning": "Applies the stencil idea to explain why the same neuron changes its apparent selectivity across contexts.",
        "start": 189,
        "blockText": "Spatial Computing theory provides a straightforward, concrete way for nonlinear mixed selectivity to emerge from wave-based control acting on a large multifunctional population of neurons. Each goal or context creates a unique, temporary alpha/beta “stencil” that suppresses gamma and spiking in some locations while sparing others (e.g. first vs second sequence order in our example; Fig. 3A). Because the neurons have overlapping connectivity, the same neuron may receive many different sensory signals and may lie inside the inhibitory stencil in one context and outside it in another. This context-dependent gating can make a neuron effectively change its selectivity, producing the nonlinear mixed selectivity observed by many studies (Fig. 4A). This account predicts that prefrontal cortex neurons should exhibit spatial organization for goals and contexts, as suggested by recent work (Fang et al., 2025)."
      }
    ]
  },
  {
    "id": "spya-autbhp",
    "name": "Traveling waves move activity between coding states",
    "provenance": "introduced",
    "statement": "Waves of alpha/beta activity do not just sit in place; as they sweep across the cortex they can carry the population's pattern of activity from one organized state (subspace) to another, which is proposed as the mechanism behind representational change.",
    "occurrences": [
      {
        "blockId": "spya-mrsvfu",
        "quote": "we propose that alpha/beta waves may constitute a control mechanism that transitions cortical population activity from one subspace to another.",
        "reasoning": "States the core claim that traveling waves drive transitions between coding states.",
        "start": 340,
        "blockText": "We propose that one role of traveling waves, particularly in the alpha/beta band, may be in instantiating state changes in neural coding. That is, by moving patterns of inhibition vs excitation across the surface of cortex, alpha/beta waves can alter which subsets of neurons are permitted to spike and their correlational structure. Thus, we propose that alpha/beta waves may constitute a control mechanism that transitions cortical population activity from one subspace to another. This can be thought of as a dynamic, spatiotemporal extension of Spatial Computing theory, Spatial Computing in motion. In our running example, we suggest traveling waves might be involved in transitioning activity between orthogonal subspaces for the objects presented in the two sequential orders (Fig. 5)."
      },
      {
        "blockId": "spya-ah94dx",
        "quote": "As traveling waves sweep continuously over the cortex, they may \"pull\" population spiking activity along, creating repeatable smooth trajectories",
        "reasoning": "Links the wave-dragging mechanism to the smooth trajectories observed in population activity.",
        "start": 643,
        "blockText": "Notably, over short timescales, population spiking traces smooth trajectories through its activity subspace, consistent with the temporal evolution of a dynamical system (Churchland et al., 2012; Ebitz and Hayden, 2021; Vyas et al., 2020). Different sensory stimuli, cognitive operations, and behaviors follow distinct paths. Distractions may briefly nudge trajectories off course, but the population state usually returns smoothly, such that cortical neurons move together according to shared dynamics. As elaborated below (“Traveling Waves and Representational Change”), these smooth population trajectories may be related to wave dynamics. As traveling waves sweep continuously over the cortex, they may “pull” population spiking activity along, creating repeatable smooth trajectories (Batabyal et al., 2026)."
      },
      {
        "blockId": "spya-qr9ra4",
        "quote": "when prefrontal population spiking activity forms new representations (stimulus and movement onset) or transforms representations between orthogonal coding subspaces (memory delay)",
        "reasoning": "Ties the timing of observed traveling waves to the moments when representations are known to change.",
        "start": 982,
        "blockText": "In the motor system, beta rhythms, which are thought to act as a “brake” on movement, typically manifest as traveling waves. In the motor cortex, they are prominent during stable postures and while movements are withheld. They decrease prior to and during movement execution and rebound after movement cessation (Barone and Rossiter, 2021; Engel and Fries, 2010; Khanna and Carmena, 2017). Both the onset of beta rhythms evoked by a movement target (Rubino et al., 2006), and their offset just prior to movement onset (Balasubramanian et al., 2020; Best et al., 2016), have been shown to form a spatiotemporal wave across the surface of motor cortex. Likewise, in the prefrontal cortex, beta traveling waves are evoked by sensory stimuli and movement. They are also evident at the start of the “memory delay period” in working memory paradigms, when sensory information is loaded into working memory (Bhattacharya et al., 2022). These are also times, not coincidentally we suggest, when prefrontal population spiking activity forms new representations (stimulus and movement onset) or transforms representations between orthogonal coding subspaces (memory delay) (Parthasarathy et al., 2017; Stokes et al., 2013)."
      }
    ]
  },
  {
    "id": "spya-uw9a5d",
    "name": "Wave interference is itself a form of computation",
    "provenance": "introduced",
    "statement": "When multiple brain waves overlap, their combination (adding, canceling, forming new patterns) is not just a side effect but can perform genuine mathematical computation in parallel, the way physical analog computers solve equations through continuous interacting quantities.",
    "occurrences": [
      {
        "blockId": "spya-vp5h33",
        "quote": "When waves meet, they naturally add together, cancel out, or form new patterns through their superposition and interference",
        "reasoning": "States the physical basis of treating wave combination as computation.",
        "start": 328,
        "blockText": "Analog computing uses continuous physical quantities, such as voltages or mechanical motion, to directly represent and solve mathematical problems (Bournez and Pouly, 2018; Hughes et al., 2019; Tzarouchis et al., 2025). Unlike digital systems that rely on binary on/off signals, analog systems combine information continuously. When waves meet, they naturally add together, cancel out, or form new patterns through their superposition and interference (Fig. 6). Simple examples like overlapping sine waves show how addition, subtraction, and thus filtering can"
      },
      {
        "blockId": "spya-mgnqxk",
        "quote": "Because the wave interactions occur everywhere simultaneously, the computation is inherently parallel.",
        "reasoning": "Makes the explicit claim that this physical process constitutes genuine parallel computation, not mere coordination.",
        "start": 330,
        "blockText": "Importantly, analog computing is computationally efficient. In an analog system, the physical medium itself evolves all at once. How the waves interact (e.g., their geometry, frequencies, and phase relationships) model the equation. The variables are all encoded as a continuous physical quantity in different phases of the wave. Because the wave interactions occur everywhere simultaneously, the computation is inherently parallel. An analog system does not loop through variables but settles into a solution as a whole. This is in contrast to digital computing, which is inherently sequential, solving problems one step at a time. Brain‑inspired neuromorphic hardware, motivated by the energy efficiency of biological neural systems, has shown that analog computation can improve energy efficiency over digital by more than an order of magnitude (Ambrogio et al., 2023; Ye et al., 2025)."
      },
      {
        "blockId": "spya-prykb8",
        "quote": "Their wave summation would essentially compute an intersection of constraints, resulting in a unique spatiotemporal pattern of neural activation for every possible combination of contexts",
        "reasoning": "Gives a concrete worked case where wave summation is claimed to literally compute a result.",
        "start": 318,
        "blockText": "As a simple concrete example, consider an extension to the previous task that requires combining control signals reflecting two distinct types of task context (Fig. 7A) (Warden and Miller, 2010). The idea is that each of these control signals would correspond to a distinct wave pattern across the cortex (Fig. 7B,C). Their wave summation would essentially compute an intersection of constraints, resulting in a unique spatiotemporal pattern of neural activation for every possible combination of contexts (Fig. 7B,C, right). Of course, this idea is not restricted to only simple combinations of control signals reflecting categorical variables. Waves might also be used to represent continuous physical quantities (e.g. speed, distance, spatial relationships) or mental constructs (e.g. value, emotion, social relationships). Their interactions might be used for neural computations underlying such complex cognitive functions as spatial causal reasoning or evaluating interpersonal relationships."
      }
    ]
  }
]
```
