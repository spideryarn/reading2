# Pairs of summaries of the same piece

Each pair is two summaries of one piece, written for a reader about to read it. The sides are in a random order. Judge each pair on its own.

## P01

**The piece's headings, in order** ("Geometric Deep Learning Grids, Groups, Graphs, Geodesics, and Gauges", 47957 words):

- Geometric Deep Learning Grids, Groups, Graphs, Geodesics, and Gauges
- Contents
- Preface
- Notation
- 1 Introduction
- 2 Learning in High Dimensions
  - 2.1 Inductive Bias via Function Regularity
  - 2.2 The Curse of Dimensionality
- 3 Geometric Priors
  - 3.1 Symmetries, Representations, and Invariance
    - Symmetry groups
    - Group Actions and Group Representations
  - A group action
  - Invariant and Equivariant functions
  - 3.2 Isomorphisms and Automorphisms
  - Isomorphisms and Automorphisms
  - 3.3 Deformation Stability
  - Stability to signal deformations
  - Stability to domain deformations
  - 3.4 Scale Separation
  - Fourier Transform and Global invariants
  - Multiscale representations
  - Deformation stability of Multiscale representations:
  - Scale Separation Prior:
  - 3.5 The Blueprint of Geometric Deep Learning
  - Geometric Deep Learning Blueprint
  - Different settings of Geometric Deep Learning
- 4 Geometric Domains: the 5 Gs
  - 4.1 Graphs and Sets
  - 4.2 Grids and Euclidean spaces
  - Circulant matrices and Convolutions
  - Derivation of the discrete Fourier transform
    - Derivation of the continuous Fourier transform
  - 4.3 Groups and Homogeneous spaces
- 4. GEOMETRIC DOMAINS: THE 5 GS
  - Group convolution
  - Spherical convolution
  - 4.4 Geodesics and Manifolds
    - Riemannian manifolds
  - Scalar and Vector fields
  - Intrinsic gradient
  - Scalar and Vector fields
  - Intrinsic gradient
  - Parallel transport
  - Exponential map
  - Geodesic distances
  - Isometries
  - Intrinsic symmetries
  - Fourier analysis on Manifolds
  - Spectral Convolution on Manifolds
  - Spatial Convolution on Manifolds
- 4.5 Gauges and Bundles
  - Tangent bundles and the Structure group
  - Gauge Symmetries
  - 4.6 Geometric graphs and Meshes
  - Laplacian matrices
  - Spectral analysis on meshes
- 5 Geometric Deep Learning Models
  - 5.1 Convolutional Neural Networks
  - Efficient multiscale computation
  - Deep and Residual Networks
  - Normalisation
  - Data augmentation
  - 5.2 Group-equivariant CNNs
    - Discrete group convolution
  - Transform+Convolve approach
  - Spherical CNNs in the Fourier domain
- 5.3 Graph Neural Networks
- 5.4 Deep Sets, Transformers, and Latent Graph Inference
  - Empty edge set
  - Complete edge set
  - 5.5 Equivariant Message Passing Networks
    - Irreducible representations
    - Regular representations
  - 5.6 Intrinsic Mesh CNNs
    - Geodesic patches
    - Isotropic filters
    - Fixed gauge
    - Angular pooling
    - Gauge-equivariant filters
  - 5.7 Recurrent Neural Networks
    - SimpleRNNs
  - Translation equivariance in RNNs
  - 5.8 Long Short-Term Memory networks
    - Time warping invariance of gated RNNs
- 6 Problems and Applications
  - Chemistry and Drug Design
  - Drug Repositioning
  - Protein biology
  - Recommender Systems and Social Networks
  - Traffic forecasting
  - Graph neural networks
  - Object recognition
  - Game playing
  - Text and speech synthesis
  - Healthcare
  - Virtual and Augmented Reality
  - Virtual and Augmented Reality
- 7 Historic Perspective
  - Symmetry in Mathematics and Physics
  - Early Use of Symmetry in Machine Learning
  - Graph Neural Networks
  - Computational chemistry
  - Node embeddings
  - Probabilistic graphical models
  - The Weisfeiler-Lehman formalism
  - Higher-order methods
- 7. HISTORIC PERSPECTIVE
  - Signal processing and Harmonic analysis
  - Signal Processing on Graph and Meshes
- 7. HISTORIC PERSPECTIVE
  - Computer Graphics and Geometry Processing
  - Algorithmic reasoning
  - Geometric Deep Learning
  - Acknowledgements
- Bibliography
- BIBLIOGRAPHY
- BIBLIOGRAPHY
- BIBLIOGRAPHY

### Summary A

This long text tries to bring order to deep learning, the kind of AI built from neural networks with many layers. The authors say the field has a zoo of network designs for different kinds of data, but few shared principles. They want to derive these designs from two ideas: symmetry and invariance. A symmetry is a change that leaves something unchanged, and invariance means a result does not move under that change. They call this attempt Geometric Deep Learning.

The model is Felix Klein's Erlangen Programme of 1872, which unified many geometries by asking which transformations each one leaves unchanged. The authors argue deep learning now resembles nineteenth-century geometry: the same ideas get reinvented and renamed, which makes the field a nightmare to learn. A shared framework would give one body of maths for the main network types, called CNNs, RNNs, GNNs and Transformers. It would also give a recipe for building future networks that use known facts about the physical world.

The starting problem is the curse of dimensionality. Learning means guessing an unknown function from examples, and inputs like images have a huge number of dimensions, written d. If you only assume the function changes little when the input changes little, the examples needed grow exponentially with d. For even modest d, that can exceed the number of atoms in the universe. Simple networks escape only by assuming the function depends on a few basic summaries of the input, which real tasks like vision rarely allow.

The way out is structure in the domain, the space the data lives on, such as a grid of pixels or a network of nodes. An invariant function gives the same answer when the input is transformed, like a cat detector that ignores where the cat sits. An equivariant function's output moves along with the input, like a mask outlining objects that must shift when the image shifts. Symmetries are described as groups: sets of transformations that can be combined and undone.

Real data change in messier ways than exact symmetries, and small distortions can add up to big ones. So the authors ask for deformation stability: the output should change no more than how far a distortion is from a true symmetry. Describing a signal by its frequencies fails this test, changing by a fixed amount however small the distortion. Wavelets, which look at small patches at several scales, change only in proportion to the distortion. This leads to scale separation: handle local details first, then pass them to coarser versions of the domain.

Together these ideas give the Geometric Deep Learning Blueprint, a stack built from four kinds of block. A local equivariant layer looks at small neighbourhoods and respects the symmetry. A nonlinear step is needed, because a purely linear invariant function could only use something like an image's average colour. A coarsening step shrinks the domain, so later layers see wider areas. A final invariant layer pools everything into one answer.

The text then walks through five domains, the 5 Gs: grids, groups, graphs, geodesics and gauges. On graphs, node order is arbitrary, so the key symmetry is permutation, meaning any reordering of the nodes. On grids, convolution, sliding the same small filter everywhere, turns out to be the only linear operation that respects shifts. Groups cover spaces like the sphere, where every point looks the same, which matters for space data and molecules.

Geodesics refers to curved surfaces, or manifolds, which usually lack global symmetry, so a filter cannot simply slide around. Instead, networks should depend only on distances measured along the surface, so bending without stretching changes nothing. Filters also need a local reference frame, or gauge, and no natural choice exists, so gauge-equivariant designs work for any choice. The authors warn that frequency-based filters on graphs and meshes are very sensitive to small changes, so they generalise poorly across shapes.

The authors then show popular networks as instances of the blueprint. CNNs are convolutions plus pooling on grids, the earliest well-known example. GNNs come in three flavours, convolutional, attentional and message-passing, each able to express the one before. Transformers are attentional GNNs over a graph where every node links to every other.

Recurrent networks read sequences step by step, and respect time shifts only if their starting state is set in a special way. Asking a recurrent network to cope with time warping, sampling time faster or slower, yields exactly gated networks like the LSTM. The gates estimate how fast time is being warped. The authors note a limit: a network trained on one warping cannot directly transfer to another, though the class can fit both.

Applications include drug discovery, where a GNN helped find that Halicin, a diabetes candidate, is a potent antibiotic. The text also names limits, such as standard GNNs being no more powerful than a classic graph test that cannot tell some graphs apart. The main conclusion is that much of today's deep learning follows one recipe: a domain, its symmetries, and a few shared building blocks.

### Summary B

This is a long survey text by four researchers that tries to bring order to deep learning, the branch of AI built on large neural networks. It borrows an idea from Felix Klein, a 19th-century mathematician who defined each kind of geometry by its symmetries: the changes that leave its key properties unchanged. The authors call their version Geometric Deep Learning. They aim to derive many popular network designs from first principles of symmetry rather than treat them as separate inventions.

The authors say deep learning today looks like geometry did before Klein: a "zoo" of network designs with few shared principles. This makes it hard to see how methods relate, so the same ideas get reinvented and renamed in different fields. A shared framework would help people study the most successful designs together. It would also give a principled way to build physical knowledge into future designs.

The argument starts with a problem called the curse of dimensionality. When inputs have many numbers, or dimensions, the examples needed to learn a merely smooth function grow exponentially with that number. Even for modest dimensions, the sample count could exceed the number of atoms in the universe. The authors use a simple geometric example of a bumpy function over a high-dimensional space to make this point concrete. Real tasks like vision or chemistry have long-range patterns, so the escape must come from the structure of the data itself.

That structure comes from the domain the data lives on, such as the pixel grid of an image. The text names two guiding principles: symmetry and scale separation. A function is invariant if transforming the input, say shifting an image, leaves the answer unchanged, as in labelling a photo "cat". It is equivariant if the output shifts in the same way as the input, as an object outline should follow a moved object.

Exact symmetry is too strict for the messy real world, where objects bend and move separately. Small distortions cannot be treated as a symmetry group, because many small ones add up to a large one. Instead, the authors ask for deformation stability: small distortions should change the output only a little. They show that Fourier features, which split a signal into global waves, can change a lot however small the distortion. Wavelets, which split a signal into local pieces at different scales, change only in proportion to the distortion.

These ideas combine into what the authors call the Geometric Deep Learning Blueprint, a recipe of stacked building blocks. A local equivariant layer looks at small neighbourhoods and respects the domain's symmetry. A non-linear step is added, because a purely linear invariant function can only see the input's average, such as an image's mean colour. A coarsening step, called pooling, shrinks the domain so later layers see larger regions. A final global invariant layer turns everything into one answer that ignores the symmetry.

The text then walks through five kinds of domain, the "5 Gs": grids, groups, graphs, geodesics and gauges. On graphs, networks of nodes and links, nodes have no natural order, so functions must not depend on how nodes are numbered. On grids, the authors show that convolution, the core operation of image networks, follows directly from requiring shift symmetry. Groups covers domains like the sphere, where every point can be rotated onto every other.

Geodesics concerns manifolds, curved surfaces such as the shape of a body, which usually have no global symmetry. Here the useful symmetries are bendings that keep distances along the surface the same. The authors warn that some filters built from surface "frequencies" can change dramatically under tiny near-distance-preserving changes. Gauges are local reference directions; since surfaces have no single "up", good networks give the same result whichever local directions are chosen.

Finally, the authors match well-known designs to their domain and symmetry. Image networks, or CNNs, use grids and shifts; graph networks use permutations; Transformers act like graph networks on fully connected graphs. They sort graph networks into three types, each able to express the one before: convolution, attention, and message passing. They also argue that the gates in LSTMs, a memory network for sequences, are exactly what invariance to stretching or squeezing time requires.

The authors are open about limits. They do not claim to summarise all research, only to study well-known designs in depth. They note that common graph networks are no more powerful than a classic test that cannot tell a six-node ring from two triangles. The time-stretching result only guarantees an LSTM could fit each warped signal, possibly with very different settings, not transfer between them.

The text also surveys uses, such as a graph network that helped find Halicin, a diabetes drug candidate, to be a potent antibiotic. Another graph network now predicts travel times in Google Maps. The main conclusion is that a large class of current architectures fits one scheme and can be derived from common geometric principles. Methods differ mainly in their choice of domain, symmetry group and building-block details.

## P02

**The piece's headings, in order** ("Race (human categorization)", 16744 words):

- Race (human categorization)
  - Definition
  - Historical origins of racial classification
    - Colonialism
    - Early taxonomic models
    - Polygenism vs monogenism
  - Modern scholarship
    - Models of human evolution
    - Biological classification
      - Subspecies
      - Ancestrally differentiated populations (clades)
      - Clines
      - Genetically differentiated populations
      - Brazil
      - European Union
      - United States
  - Views across disciplines over time
    - Anthropology
      - United States
    - Biology, anatomy, and medicine
    - Sociology
  - Political and practical uses
    - Biomedicine
    - Law enforcement
      - Forensic anthropology
  - See also
  - Notes
  - References
  - Bibliography
  - Further reading
    - Popular press
  - External links
    - Official statements

### Summary A

This is an encyclopedia article about race as a way of sorting people into groups that a society sees as distinct. It traces where the idea came from, how scientists tested it, and how it is still used in law, medicine and policing. Its central claim is that modern science treats race as a social construct: an identity assigned by rules a society makes, not by biology. Different cultures draw different racial groups, and these lines can change over time.

The article says the idea of race is the foundation of racism, the belief that some races are superior to others. Even if race is socially made, most scholars agree it has real material effects, through preference and discrimination built into institutions. Racism has led to slavery and genocide, and racial groups with little power often find themselves excluded or oppressed.

The modern idea of race grew out of European colonial projects from the 16th to 18th centuries, which sorted people by skin color and body. The Atlantic slave trade gave Europeans a further reason to rank groups, to justify keeping Africans enslaved. In 1735 Carl Linnaeus split humans into four continental varieties, calling Europeans active and adventurous and Africans lazy and careless. Such schemes nearly always put white Europeans at the top and ranked other groups below.

From the 20th century, studies of human variation gave several reasons to doubt that races are natural biological groups. Traits change gradually across the map, in patterns called clines, so skin color shades from Europe into Africa with no clear boundary. Different traits change out of step: skin pigment fades away from the equator, while one blood-protein gene variant spreads out from particular spots in Africa. On average about 85% of genetic variation lies within local populations, about 7% between populations on one continent, and about 8% between continents.

In 2003 A. W. F. Edwards argued that combining many genetic markers can sort people into clusters that resemble traditional continental groups. Critics reply that the clusters depend on which populations a researcher chooses to sample in the first place. Sampling only Icelanders, Mayans and Maoris, for instance, would give three clusters, and everyone else would look like a mix of them. A 2007 study by Witherspoon and colleagues found that, even with hundreds of markers, people are often more similar to members of other populations than to their own.

The article is open that the debate goes on. Geneticist David Reich wrote that ancestry differences matching many racial groups are real; 67 scientists replied that his idea of race was flawed. Forensic anthropologists, who identify human remains, are often good at estimating a skeleton's race, which some take as proof that races exist. Norman Sauer argued instead that this only predicts which socially made category the person was placed in while alive.

Surveys show scientists' views have shifted over time. In a 1985 survey, 41% of physical anthropologists rejected the claim that humans have biological races. When the same survey was run in 1999, that figure had risen to 69%. A 2021 study of over 11,000 genetics papers found the word race in 22% of papers in the first decade studied, but only 5% in the latest.

In 2023 the US National Academies of Sciences, Engineering, and Medicine said researchers should not use race as a stand-in for human genetic variation. A 2019 statement by physical anthropologists says humans are not split biologically into distinct continental types, and that the idea arose in support of European colonialism. The article's conclusion is that race is not a natural biological division, yet as a social category it still shapes people's lives.

### Summary B

This Wikipedia article explains race as a way of sorting people into groups, based on shared physical or social traits, that a society treats as distinct. Its central claim is that modern science sees race as a social construct: an identity assigned by rules a society makes, not something built into our biology. Different cultures draw different racial groups, and these groupings change over time.

The article says the idea of race is the foundation of racism, the belief that some races are superior to others. Even as a social construct, race has real effects on people's lives, through institutions that favour some groups and discriminate against others. It links racism to tragedies including slavery and genocide.

The modern idea of race grew out of European colonial expansion between the 16th and 18th centuries, which sorted people by skin colour and other physical differences. In 1735 Carl Linnaeus split humans into four continental types, each tied to a temperament, calling Europeans active and Africans lazy. In 1775 Johann Blumenbach proposed five divisions, but noticed that each group shades into the next so that no limits can be marked between them.

The article gathers several kinds of genetic evidence against the idea of separate biological races. On average, about 85% of human genetic variation lies within local populations, about 7% between nearby populations, and about 8% between continents. Traits shift gradually across the map, along gradients called clines, and traits like skin colour and blood type do not line up, so one anthropologist concluded there are "no races, only clines." A 2015 study of 1,037 people in 52 populations found non-African groups nested inside African ones, and many regional groups are not separate family branches.

Some researchers argue the other side: by analysing many genetic markers at once, people can be sorted into clusters that resemble traditional continental groups. Critics reply that, even then, individuals are frequently more genetically similar to members of other populations than to members of their own. They also note that clusters depend on who is sampled: sample only Icelanders, Mayans and Maoris, and three neat clusters appear.

Forensic anthropologists, who identify human remains, still estimate race from skeletons, and one asked why they are so good at it if races don't exist. His answer was that they are predicting the social category a person was placed in while alive, not proving that races exist in nature. One method's average accuracy dropped from 85% to 33% when it was retested on Native Americans.

Scientists still disagree, and the article tracks this through surveys asking whether biological races exist in humans. Among American anthropologists, rejection rose from 1985 to 1999: from 41% to 69% of physical anthropologists, and from 53% to 80% of cultural ones. Views also differ by country: Chinese anthropologists widely used the race concept, while US scientists are encouraged to avoid it.

Societies draw racial lines in different ways. In the United States, the "one-drop rule" counted anyone with any known African ancestry as Black, regardless of appearance. In Brazil, race rested more on appearance than on descent, so full siblings could belong to different racial groups. The European Union rejects theories of separate human races but still uses the word in law, to protect people wrongly seen as another race.

In medicine, some researchers find racial data useful, but others warn that a gap in disease rates between social groups does not prove a genetic cause. In 2023 the US National Academies of Sciences, Engineering, and Medicine said researchers should not use race as a stand-in for human genetic variation. The article's main conclusion is that race has no built-in biological meaning, yet as a social category it shapes people's lives in real ways.

## P03

**The piece's headings, in order** ("Geometric Deep Learning Grids, Groups, Graphs, Geodesics, and Gauges", 47957 words):

- Geometric Deep Learning Grids, Groups, Graphs, Geodesics, and Gauges
- Contents
- Preface
- Notation
- 1 Introduction
- 2 Learning in High Dimensions
  - 2.1 Inductive Bias via Function Regularity
  - 2.2 The Curse of Dimensionality
- 3 Geometric Priors
  - 3.1 Symmetries, Representations, and Invariance
    - Symmetry groups
    - Group Actions and Group Representations
  - A group action
  - Invariant and Equivariant functions
  - 3.2 Isomorphisms and Automorphisms
  - Isomorphisms and Automorphisms
  - 3.3 Deformation Stability
  - Stability to signal deformations
  - Stability to domain deformations
  - 3.4 Scale Separation
  - Fourier Transform and Global invariants
  - Multiscale representations
  - Deformation stability of Multiscale representations:
  - Scale Separation Prior:
  - 3.5 The Blueprint of Geometric Deep Learning
  - Geometric Deep Learning Blueprint
  - Different settings of Geometric Deep Learning
- 4 Geometric Domains: the 5 Gs
  - 4.1 Graphs and Sets
  - 4.2 Grids and Euclidean spaces
  - Circulant matrices and Convolutions
  - Derivation of the discrete Fourier transform
    - Derivation of the continuous Fourier transform
  - 4.3 Groups and Homogeneous spaces
- 4. GEOMETRIC DOMAINS: THE 5 GS
  - Group convolution
  - Spherical convolution
  - 4.4 Geodesics and Manifolds
    - Riemannian manifolds
  - Scalar and Vector fields
  - Intrinsic gradient
  - Scalar and Vector fields
  - Intrinsic gradient
  - Parallel transport
  - Exponential map
  - Geodesic distances
  - Isometries
  - Intrinsic symmetries
  - Fourier analysis on Manifolds
  - Spectral Convolution on Manifolds
  - Spatial Convolution on Manifolds
- 4.5 Gauges and Bundles
  - Tangent bundles and the Structure group
  - Gauge Symmetries
  - 4.6 Geometric graphs and Meshes
  - Laplacian matrices
  - Spectral analysis on meshes
- 5 Geometric Deep Learning Models
  - 5.1 Convolutional Neural Networks
  - Efficient multiscale computation
  - Deep and Residual Networks
  - Normalisation
  - Data augmentation
  - 5.2 Group-equivariant CNNs
    - Discrete group convolution
  - Transform+Convolve approach
  - Spherical CNNs in the Fourier domain
- 5.3 Graph Neural Networks
- 5.4 Deep Sets, Transformers, and Latent Graph Inference
  - Empty edge set
  - Complete edge set
  - 5.5 Equivariant Message Passing Networks
    - Irreducible representations
    - Regular representations
  - 5.6 Intrinsic Mesh CNNs
    - Geodesic patches
    - Isotropic filters
    - Fixed gauge
    - Angular pooling
    - Gauge-equivariant filters
  - 5.7 Recurrent Neural Networks
    - SimpleRNNs
  - Translation equivariance in RNNs
  - 5.8 Long Short-Term Memory networks
    - Time warping invariance of gated RNNs
- 6 Problems and Applications
  - Chemistry and Drug Design
  - Drug Repositioning
  - Protein biology
  - Recommender Systems and Social Networks
  - Traffic forecasting
  - Graph neural networks
  - Object recognition
  - Game playing
  - Text and speech synthesis
  - Healthcare
  - Virtual and Augmented Reality
  - Virtual and Augmented Reality
- 7 Historic Perspective
  - Symmetry in Mathematics and Physics
  - Early Use of Symmetry in Machine Learning
  - Graph Neural Networks
  - Computational chemistry
  - Node embeddings
  - Probabilistic graphical models
  - The Weisfeiler-Lehman formalism
  - Higher-order methods
- 7. HISTORIC PERSPECTIVE
  - Signal processing and Harmonic analysis
  - Signal Processing on Graph and Meshes
- 7. HISTORIC PERSPECTIVE
  - Computer Graphics and Geometry Processing
  - Algorithmic reasoning
  - Geometric Deep Learning
  - Acknowledgements
- Bibliography
- BIBLIOGRAPHY
- BIBLIOGRAPHY
- BIBLIOGRAPHY

### Summary A

This is a long survey text, written like a short book, about how to design neural networks for data that has shape and structure. Its model is Felix Klein's Erlangen Programme from 1872, which treated geometry as the study of properties that stay unchanged under certain transformations. The authors apply that mindset to deep learning and call the result Geometric Deep Learning. Their aim is to derive many familiar network designs from first principles of symmetry, meaning changes that leave what matters unchanged.

The authors say deep learning today looks like geometry in the nineteenth century: a zoo of methods with few unifying principles. This makes it hard to see how methods relate, so the same ideas get reinvented and renamed in different fields. A shared framework, they argue, does two jobs. It explains why popular designs such as CNNs, RNNs, GNNs and Transformers work, and it gives a recipe for building future designs that build in physical knowledge.

The argument starts with a problem called the curse of dimensionality: learning from data with very many input numbers is generally hopeless. If all you know is that a function changes smoothly, the number of examples needed grows exponentially with the number of inputs. Even for modest input sizes, that could exceed the number of atoms in the universe. Simple networks can escape this only by assuming the answer depends on a few simple summaries of the input, which the authors call unrealistic for images, speech or chemistry.

The way out is to use structure in the data, which the authors call geometric priors: built-in assumptions about shape. They treat each input as a signal on a domain, like colours on a grid of pixels or features on the nodes of a network. A function is invariant if transforming the input leaves the output unchanged, as when a cat stays a cat after moving in a photo. It is equivariant if the output shifts in the same way as the input, as when a mask outlining objects follows them when the image moves.

Exact symmetry is not enough, because real data bends and warps in small ways that no clean rule describes. So the authors add deformation stability: a small distortion of the input should cause only a small change in the output. They show that the Fourier transform, which splits a signal into waves of different frequencies, can change a lot under even tiny distortions. Wavelets, which break signals into pieces local in both place and scale, stay stable, pointing to a second principle: handle detail scale by scale.

Combining symmetry, stability and scale gives what the authors call the Geometric Deep Learning Blueprint, stacked from a few building blocks. A local equivariant layer looks at small neighbourhoods and respects the symmetry. A nonlinearity, applied point by point, is needed because purely linear invariant functions can only see the average of the input. A coarsening or pooling step shrinks the domain so later layers see wider areas. A final global invariant layer collapses everything into an answer that ignores the symmetry.

The text then walks through five kinds of domain, the 5 Gs: grids, groups, graphs, geodesics and gauges. Graphs have no natural order of nodes, so functions on them must not depend on how nodes are numbered. On grids, the authors show that convolution, the sliding-filter operation in image networks, follows directly from requiring that shifting the input shifts the output. Groups cover spheres and rotations, geodesics cover curved surfaces measured by shortest paths, and gauges cover the arbitrary choice of local directions on those surfaces.

Many popular models then appear as one blueprint with different domains and symmetries. CNNs work on grids with shifts, GNNs on graphs with reordering of nodes, and Deep Sets on plain sets. Transformers are recast as attention-based GNNs on a graph where every item connects to every other. Most strikingly, demanding that a recurrent network handle stretched or squeezed time yields exactly the gates found in LSTMs.

A chapter of applications shows the ideas at work. A graph network helped find that Halicin, a molecule first meant for diabetes, is a potent antibiotic, even against some resistant bacteria. A graph network predicts travel times in Google Maps, and mesh-based networks were used to design proteins aimed at blocking a cancer-related interaction.

The authors are open about limits. They study selected well-known architectures in depth rather than summarising all research, and several topics are left to future work. They report that common GNNs can be no more powerful than a classic test for telling graphs apart, which fails on simple cases. And the LSTM result only says gated networks can fit each warped signal, not that one trained model transfers to a new warping.

The main conclusion is that a large class of deep learning architectures now in use fits one scheme and comes from common geometric principles. Methods differ mainly in their choice of domain, symmetry group and how they build the blocks. The authors hope this lens lets readers understand and design future architectures, not just memorise today's.

### Summary B

This is a long, textbook-style text that tries to bring order to deep learning, the branch of machine learning built on many-layered neural networks. The authors borrow an idea from 1872, when Felix Klein proposed treating geometry as the study of what stays unchanged under certain transformations, called symmetries. They call their version Geometric Deep Learning, and they aim to derive network designs from first principles of symmetry and invariance.

The authors say deep learning today resembles geometry in the 1800s: a zoo of network designs with few unifying principles. That makes it hard to see how methods relate, so the same ideas get reinvented and renamed in different fields. A shared framework, they argue, explains why successful designs work and gives a principled way to build future architectures not yet invented.

The starting point is supervised learning: guessing an unknown function from examples, where each input, such as an image, has a huge number of dimensions. If all we know is that the function is smooth, the examples needed grow exponentially with the number of dimensions. This is the curse of dimensionality; even for modest dimensions, the samples needed could exceed the number of atoms in the universe. The way out, the authors argue, is to exploit structure that data from the physical world already has.

They name two such structures, which they call geometric priors: symmetry and scale separation. A symmetry is a change that leaves something important unchanged; sliding a cat across a photo does not change that it shows a cat. All the symmetries of an object form a group: a set of changes that can be combined and undone. A function is invariant if its output ignores the change, and equivariant if its output changes in the same way as the input.

Exact symmetries are too strict for real data, where objects bend and different parts move in different directions. Small deformations do not form a group, so the authors ask instead for stability: small distortions should change the output only a little. They show that breaking a signal into global waves (the Fourier transform) fails this test, while wavelets, small patterns at several sizes, pass it. Scale separation means handling nearby interactions first, then passing results to coarser, zoomed-out versions of the data.

Combining these ideas gives what they call the Geometric Deep Learning Blueprint, a recipe stacked from a few repeating building blocks. A linear layer that is equivariant, so a shifted input gives a correspondingly shifted output. A non-linear step applied point by point, since a purely linear symmetric model could only use something as crude as an image's average colour. Local pooling, which coarsens the domain, much like shrinking an image to a lower resolution. A final invariant layer, called global pooling, that summarises everything into one answer.

The blueprint is applied to five kinds of domain, the 5 Gs: grids, groups, graphs, geodesics and gauges. On graphs, which are networks of nodes and links, nodes have no natural order, so answers must not depend on how nodes are numbered. On grids such as image pixels, demanding equivariance to shifts makes convolution, the sliding filter of image networks, appear naturally. Groups extend this to spheres with rotations; geodesics, shortest paths on curved surfaces, handle shapes that bend without stretching; gauges handle arbitrary local directions.

The authors are open about weak points in these constructions. Spectral methods, which filter graphs and meshes through a Fourier-like transform, are unstable: a tiny change to a shape can change the result dramatically. So they fail when a network is trained on one set of 3D shapes and tested on another, an approach one author himself introduced. On curved surfaces there is often no consistent way to choose local directions, which motivates designs that work for any choice.

The models part shows familiar architectures as cases of the blueprint: image networks (CNNs), rotation-aware CNNs, graph neural networks (GNNs), Transformers, molecule networks and mesh networks. GNN layers come in three flavours, convolutional, attentional and message-passing, and each can represent the one before it. Transformers turn out to be attentional GNNs on a graph where every item is linked to every other.

Recurrent neural networks, which read sequences one step at a time, get a surprising treatment. Requiring a model family to cope with time warping, a signal being sped up or slowed down, leads exactly to the gates used in LSTMs. The authors stress this is a weaker class invariance: a model trained on one warping cannot simply be reused on another.

Applications show the reach: a GNN helped reveal that Halicin, first meant for diabetes, is a potent antibiotic, even against resistant bacteria. A GNN now predicts travel times in Google Maps for several major cities. The main conclusion is that a large class of today's architectures can be derived from common geometric principles rather than treated as separate inventions.

## P04

**The piece's headings, in order** ("Race (human categorization)", 16744 words):

- Race (human categorization)
  - Definition
  - Historical origins of racial classification
    - Colonialism
    - Early taxonomic models
    - Polygenism vs monogenism
  - Modern scholarship
    - Models of human evolution
    - Biological classification
      - Subspecies
      - Ancestrally differentiated populations (clades)
      - Clines
      - Genetically differentiated populations
      - Brazil
      - European Union
      - United States
  - Views across disciplines over time
    - Anthropology
      - United States
    - Biology, anatomy, and medicine
    - Sociology
  - Political and practical uses
    - Biomedicine
    - Law enforcement
      - Forensic anthropology
  - See also
  - Notes
  - References
  - Bibliography
  - Further reading
    - Popular press
  - External links
    - Official statements

### Summary A

This is an encyclopedia article about race as a way of sorting people into groups that a society sees as distinct. It traces where the idea came from, how scientists tested it, and how it is still used in law, medicine and policing. Its central claim is that modern science treats race as a social construct: an identity assigned by rules a society makes, not by biology. Different cultures draw different racial groups, and these lines can change over time.

The article says the idea of race is the foundation of racism, the belief that some races are superior to others. Even if race is socially made, most scholars agree it has real material effects, through preference and discrimination built into institutions. Racism has led to slavery and genocide, and racial groups with little power often find themselves excluded or oppressed.

The modern idea of race grew out of European colonial projects from the 16th to 18th centuries, which sorted people by skin color and body. The Atlantic slave trade gave Europeans a further reason to rank groups, to justify keeping Africans enslaved. In 1735 Carl Linnaeus split humans into four continental varieties, calling Europeans active and adventurous and Africans lazy and careless. Such schemes nearly always put white Europeans at the top and ranked other groups below.

From the 20th century, studies of human variation gave several reasons to doubt that races are natural biological groups. Traits change gradually across the map, in patterns called clines, so skin color shades from Europe into Africa with no clear boundary. Different traits change out of step: skin pigment fades away from the equator, while one blood-protein gene variant spreads out from particular spots in Africa. On average about 85% of genetic variation lies within local populations, about 7% between populations on one continent, and about 8% between continents.

In 2003 A. W. F. Edwards argued that combining many genetic markers can sort people into clusters that resemble traditional continental groups. Critics reply that the clusters depend on which populations a researcher chooses to sample in the first place. Sampling only Icelanders, Mayans and Maoris, for instance, would give three clusters, and everyone else would look like a mix of them. A 2007 study by Witherspoon and colleagues found that, even with hundreds of markers, people are often more similar to members of other populations than to their own.

The article is open that the debate goes on. Geneticist David Reich wrote that ancestry differences matching many racial groups are real; 67 scientists replied that his idea of race was flawed. Forensic anthropologists, who identify human remains, are often good at estimating a skeleton's race, which some take as proof that races exist. Norman Sauer argued instead that this only predicts which socially made category the person was placed in while alive.

Surveys show scientists' views have shifted over time. In a 1985 survey, 41% of physical anthropologists rejected the claim that humans have biological races. When the same survey was run in 1999, that figure had risen to 69%. A 2021 study of over 11,000 genetics papers found the word race in 22% of papers in the first decade studied, but only 5% in the latest.

In 2023 the US National Academies of Sciences, Engineering, and Medicine said researchers should not use race as a stand-in for human genetic variation. A 2019 statement by physical anthropologists says humans are not split biologically into distinct continental types, and that the idea arose in support of European colonialism. The article's conclusion is that race is not a natural biological division, yet as a social category it still shapes people's lives.

### Summary B

This encyclopedia article is about race: sorting people into groups by shared physical or social traits, groups that a society treats as distinct. It asks whether those groups reflect real biological divisions, or whether societies make them up. Its answer, given early, is that modern science treats race as a social construct, an identity assigned by rules a society makes. The article then follows the idea through history, biology, several countries, several fields of study, and everyday uses.

Being made up does not make race harmless. Most scholars agree race has real effects on people's lives, through institutions that favour some groups and discriminate against others. Drawing racial lines has often meant ranking groups, as with the US one-drop rule, which kept anyone with any African ancestry out of the "white" group. The article links racism to great harm, including slavery and genocide.

The modern idea grew during European colonial expansion, alongside a new scientific habit of sorting nature into kinds. The Atlantic slave trade gave Europeans a further reason to rank groups, to justify keeping Africans enslaved. In 1735 Carl Linnaeus split humans into four continental varieties, calling Europeans active and adventurous and Africans crafty and lazy. In 1775 Johann Blumenbach named five races but proposed no ranking, and noted that one group blends into the next with no clear limit.

In biology, race usually means subspecies: a population cut off by geography and genetically distinct from others of its species. Human groups fail this test: they are not isolated, and their genetic differences are far smaller than those between comparable subspecies. On average about 85% of human genetic variation lies within local populations, about 7% between nearby populations, and about 8% between continents. Traits also shift gradually across the map, in slopes called clines, and different traits do not shift together. So the more traits early researchers measured, the more races they had to invent, until they concluded there were no clear-cut races.

Some researchers push back. A. W. F. Edwards argued in 2003 that combining many genetic markers, small spots in DNA that differ between people, can sort people into clusters resembling continental groups. Critics reply that the clusters depend on which populations get sampled: sample only Icelanders, Mayans and Maoris, and three different clusters appear. Witherspoon and colleagues found that, even using hundreds of markers, people are often more alike to members of other populations than to their own.

The article shows that different places draw racial lines in very different ways. Brazil sorts mainly by appearance rather than descent, so full siblings can belong to different racial groups. European anti-racism bodies reject theories of separate human races, yet keep the word in law so people seen as another race stay protected. The United States long counted anyone with one known Black ancestor as Black, while defining Native Americans by a share of ancestry.

Views also differ by field and have shifted over time. By 1999, 69% of physical anthropologists and 80% of cultural anthropologists rejected biological races, a substantial rise since 1985. A 2017 survey of 3,286 American anthropologists found agreement that biological races do not exist, but that race affects health through social experience. In 2023 the US National Academies said researchers should not use race as a stand-in for human genetic variation.

Race is still used in practice, and the article sets out the arguments. In medicine, supporters say racial categories give clues for diagnosis and help apply new genetic findings. Critics answer that a gap between socially defined groups need not be genetic, and that living conditions matter more than race for health. Experts who identify skeletons can often tell a person's ancestry, but Norman Sauer argued this predicts the social label they carried, not that races exist in nature.

The article's overall conclusion is that human variation is real but gradual and overlapping, and does not split into separate gene pools. A 2019 statement by physical anthropologists says race arose from, and supported, European colonialism, oppression and discrimination. Race is now widely seen as a pseudoscientific way of sorting people, and many writers prefer words like population, ethnic group or community.

## P05

**The piece's headings, in order** ("Race (human categorization)", 16744 words):

- Race (human categorization)
  - Definition
  - Historical origins of racial classification
    - Colonialism
    - Early taxonomic models
    - Polygenism vs monogenism
  - Modern scholarship
    - Models of human evolution
    - Biological classification
      - Subspecies
      - Ancestrally differentiated populations (clades)
      - Clines
      - Genetically differentiated populations
      - Brazil
      - European Union
      - United States
  - Views across disciplines over time
    - Anthropology
      - United States
    - Biology, anatomy, and medicine
    - Sociology
  - Political and practical uses
    - Biomedicine
    - Law enforcement
      - Forensic anthropology
  - See also
  - Notes
  - References
  - Bibliography
  - Further reading
    - Popular press
  - External links
    - Official statements

### Summary A

This Wikipedia article explains race as a way of sorting people into groups, based on shared physical or social traits, that a society treats as distinct. Its central claim is that modern science sees race as a social construct: an identity assigned by rules a society makes, not something built into our biology. Different cultures draw different racial groups, and these groupings change over time.

The article says the idea of race is the foundation of racism, the belief that some races are superior to others. Even as a social construct, race has real effects on people's lives, through institutions that favour some groups and discriminate against others. It links racism to tragedies including slavery and genocide.

The modern idea of race grew out of European colonial expansion between the 16th and 18th centuries, which sorted people by skin colour and other physical differences. In 1735 Carl Linnaeus split humans into four continental types, each tied to a temperament, calling Europeans active and Africans lazy. In 1775 Johann Blumenbach proposed five divisions, but noticed that each group shades into the next so that no limits can be marked between them.

The article gathers several kinds of genetic evidence against the idea of separate biological races. On average, about 85% of human genetic variation lies within local populations, about 7% between nearby populations, and about 8% between continents. Traits shift gradually across the map, along gradients called clines, and traits like skin colour and blood type do not line up, so one anthropologist concluded there are "no races, only clines." A 2015 study of 1,037 people in 52 populations found non-African groups nested inside African ones, and many regional groups are not separate family branches.

Some researchers argue the other side: by analysing many genetic markers at once, people can be sorted into clusters that resemble traditional continental groups. Critics reply that, even then, individuals are frequently more genetically similar to members of other populations than to members of their own. They also note that clusters depend on who is sampled: sample only Icelanders, Mayans and Maoris, and three neat clusters appear.

Forensic anthropologists, who identify human remains, still estimate race from skeletons, and one asked why they are so good at it if races don't exist. His answer was that they are predicting the social category a person was placed in while alive, not proving that races exist in nature. One method's average accuracy dropped from 85% to 33% when it was retested on Native Americans.

Scientists still disagree, and the article tracks this through surveys asking whether biological races exist in humans. Among American anthropologists, rejection rose from 1985 to 1999: from 41% to 69% of physical anthropologists, and from 53% to 80% of cultural ones. Views also differ by country: Chinese anthropologists widely used the race concept, while US scientists are encouraged to avoid it.

Societies draw racial lines in different ways. In the United States, the "one-drop rule" counted anyone with any known African ancestry as Black, regardless of appearance. In Brazil, race rested more on appearance than on descent, so full siblings could belong to different racial groups. The European Union rejects theories of separate human races but still uses the word in law, to protect people wrongly seen as another race.

In medicine, some researchers find racial data useful, but others warn that a gap in disease rates between social groups does not prove a genetic cause. In 2023 the US National Academies of Sciences, Engineering, and Medicine said researchers should not use race as a stand-in for human genetic variation. The article's main conclusion is that race has no built-in biological meaning, yet as a social category it shapes people's lives in real ways.

### Summary B

This Wikipedia article explains race as a way of sorting people into groups that a society sees as distinct, based on shared physical or social qualities. It traces where the idea came from, what biology and genetics say about it, and how it is still used in law, medicine and policing. Its starting point is that modern science sees race as a social construct: an identity given to people by rules that a society makes. Race is partly based on physical likeness within groups, but the article says it has no built-in biological meaning.

The article says the stakes are high because the concept of race is the basis of racism, the belief that some races are superior to others. Even as a social construct, most scholars agree that race has real effects on people's lives, through preference and discrimination built into institutions. The article links racism to slavery and genocide, and to groups with little power being shut out or oppressed.

The modern idea of race grew out of European colonial expansion from the 16th to 18th centuries, which sorted people by skin colour and body. The Atlantic slave trade gave Europeans a further reason to rank human groups, to justify keeping Africans enslaved. Early schemes mixed description with prejudice. In 1735 Linnaeus split humans into four continental varieties, calling Europeans active and adventurous and Africans crafty, lazy and careless.

A key argument against biological races is that human traits change gradually across geography, in patterns called clines. Skin colour, for example, shades from Europe down the Nile into Africa with no hint of a boundary. Different traits also vary independently of each other, which is called nonconcordant variation: skin colour follows one map, blood types another. So the more traits early anthropologists measured, the more races they needed, rising into the 30s and 50s, until they concluded there were no discrete races.

On average, about 85% of human genetic variation lies within local populations, about 7% between populations on one continent, and about 8% between continents. Diversity is greatest in Africa and falls with distance from it, so a single African population holds about all human diversity. In 2003 Edwards argued that combining many genetic markers lets researchers sort people into clusters resembling traditional continental groups. Critics reply that clusters depend on which populations researchers choose to sample: sample only Icelanders, Mayans and Maoris, and three clusters appear.

Surveys in the article show that views on race differ by field, country and time. In a 1985 US survey, 41% of physical anthropologists and 53% of cultural anthropologists rejected the idea of biological races in humans. When the same survey was repeated in 1999, those figures had risen to 69% and 80%. A 2003 study found race widely used as a biological concept by Chinese anthropologists, which one scholar linked to its role in social unity there.

Countries also draw the lines differently. The US "one-drop rule" counted anyone with any known African ancestry as Black, regardless of appearance. In Brazil, race rested more on appearance than descent, so full siblings could belong to different racial groups. European bodies reject theories of separate human races, yet keep the word in law so people seen as "another race" are still protected.

US health policy uses racial data to track health gaps, and some researchers hope race could help guide genetics-based medicine. Others warn that a gap between socially defined groups does not prove a genetic cause, and that living conditions matter most for health outcomes. Forensic anthropologists can often match a skeleton to a racial label, but Sauer argued this predicts the social label a person had, not that races exist in nature.

The article's overall conclusion is that race is not a sound way to describe human biological variation. In 2019 the American Association of Physical Anthropologists said humans are not divided biologically into distinct continental types, and tied race to European colonialism. In 2023 the US National Academies said researchers should not use race as a stand-in for human genetic variation, calling it "misleading and harmful". Yet the article stresses that race remains real as a social identity, with real effects on how people are treated.

## P06

**The piece's headings, in order** ("Geometric Deep Learning Grids, Groups, Graphs, Geodesics, and Gauges", 47957 words):

- Geometric Deep Learning Grids, Groups, Graphs, Geodesics, and Gauges
- Contents
- Preface
- Notation
- 1 Introduction
- 2 Learning in High Dimensions
  - 2.1 Inductive Bias via Function Regularity
  - 2.2 The Curse of Dimensionality
- 3 Geometric Priors
  - 3.1 Symmetries, Representations, and Invariance
    - Symmetry groups
    - Group Actions and Group Representations
  - A group action
  - Invariant and Equivariant functions
  - 3.2 Isomorphisms and Automorphisms
  - Isomorphisms and Automorphisms
  - 3.3 Deformation Stability
  - Stability to signal deformations
  - Stability to domain deformations
  - 3.4 Scale Separation
  - Fourier Transform and Global invariants
  - Multiscale representations
  - Deformation stability of Multiscale representations:
  - Scale Separation Prior:
  - 3.5 The Blueprint of Geometric Deep Learning
  - Geometric Deep Learning Blueprint
  - Different settings of Geometric Deep Learning
- 4 Geometric Domains: the 5 Gs
  - 4.1 Graphs and Sets
  - 4.2 Grids and Euclidean spaces
  - Circulant matrices and Convolutions
  - Derivation of the discrete Fourier transform
    - Derivation of the continuous Fourier transform
  - 4.3 Groups and Homogeneous spaces
- 4. GEOMETRIC DOMAINS: THE 5 GS
  - Group convolution
  - Spherical convolution
  - 4.4 Geodesics and Manifolds
    - Riemannian manifolds
  - Scalar and Vector fields
  - Intrinsic gradient
  - Scalar and Vector fields
  - Intrinsic gradient
  - Parallel transport
  - Exponential map
  - Geodesic distances
  - Isometries
  - Intrinsic symmetries
  - Fourier analysis on Manifolds
  - Spectral Convolution on Manifolds
  - Spatial Convolution on Manifolds
- 4.5 Gauges and Bundles
  - Tangent bundles and the Structure group
  - Gauge Symmetries
  - 4.6 Geometric graphs and Meshes
  - Laplacian matrices
  - Spectral analysis on meshes
- 5 Geometric Deep Learning Models
  - 5.1 Convolutional Neural Networks
  - Efficient multiscale computation
  - Deep and Residual Networks
  - Normalisation
  - Data augmentation
  - 5.2 Group-equivariant CNNs
    - Discrete group convolution
  - Transform+Convolve approach
  - Spherical CNNs in the Fourier domain
- 5.3 Graph Neural Networks
- 5.4 Deep Sets, Transformers, and Latent Graph Inference
  - Empty edge set
  - Complete edge set
  - 5.5 Equivariant Message Passing Networks
    - Irreducible representations
    - Regular representations
  - 5.6 Intrinsic Mesh CNNs
    - Geodesic patches
    - Isotropic filters
    - Fixed gauge
    - Angular pooling
    - Gauge-equivariant filters
  - 5.7 Recurrent Neural Networks
    - SimpleRNNs
  - Translation equivariance in RNNs
  - 5.8 Long Short-Term Memory networks
    - Time warping invariance of gated RNNs
- 6 Problems and Applications
  - Chemistry and Drug Design
  - Drug Repositioning
  - Protein biology
  - Recommender Systems and Social Networks
  - Traffic forecasting
  - Graph neural networks
  - Object recognition
  - Game playing
  - Text and speech synthesis
  - Healthcare
  - Virtual and Augmented Reality
  - Virtual and Augmented Reality
- 7 Historic Perspective
  - Symmetry in Mathematics and Physics
  - Early Use of Symmetry in Machine Learning
  - Graph Neural Networks
  - Computational chemistry
  - Node embeddings
  - Probabilistic graphical models
  - The Weisfeiler-Lehman formalism
  - Higher-order methods
- 7. HISTORIC PERSPECTIVE
  - Signal processing and Harmonic analysis
  - Signal Processing on Graph and Meshes
- 7. HISTORIC PERSPECTIVE
  - Computer Graphics and Geometry Processing
  - Algorithmic reasoning
  - Geometric Deep Learning
  - Acknowledgements
- Bibliography
- BIBLIOGRAPHY
- BIBLIOGRAPHY
- BIBLIOGRAPHY

### Summary A

This is a long survey text, written like a short book, about how to design neural networks for data that has shape and structure. Its model is Felix Klein's Erlangen Programme from 1872, which treated geometry as the study of properties that stay unchanged under certain transformations. The authors apply that mindset to deep learning and call the result Geometric Deep Learning. Their aim is to derive many familiar network designs from first principles of symmetry, meaning changes that leave what matters unchanged.

The authors say deep learning today looks like geometry in the nineteenth century: a zoo of methods with few unifying principles. This makes it hard to see how methods relate, so the same ideas get reinvented and renamed in different fields. A shared framework, they argue, does two jobs. It explains why popular designs such as CNNs, RNNs, GNNs and Transformers work, and it gives a recipe for building future designs that build in physical knowledge.

The argument starts with a problem called the curse of dimensionality: learning from data with very many input numbers is generally hopeless. If all you know is that a function changes smoothly, the number of examples needed grows exponentially with the number of inputs. Even for modest input sizes, that could exceed the number of atoms in the universe. Simple networks can escape this only by assuming the answer depends on a few simple summaries of the input, which the authors call unrealistic for images, speech or chemistry.

The way out is to use structure in the data, which the authors call geometric priors: built-in assumptions about shape. They treat each input as a signal on a domain, like colours on a grid of pixels or features on the nodes of a network. A function is invariant if transforming the input leaves the output unchanged, as when a cat stays a cat after moving in a photo. It is equivariant if the output shifts in the same way as the input, as when a mask outlining objects follows them when the image moves.

Exact symmetry is not enough, because real data bends and warps in small ways that no clean rule describes. So the authors add deformation stability: a small distortion of the input should cause only a small change in the output. They show that the Fourier transform, which splits a signal into waves of different frequencies, can change a lot under even tiny distortions. Wavelets, which break signals into pieces local in both place and scale, stay stable, pointing to a second principle: handle detail scale by scale.

Combining symmetry, stability and scale gives what the authors call the Geometric Deep Learning Blueprint, stacked from a few building blocks. A local equivariant layer looks at small neighbourhoods and respects the symmetry. A nonlinearity, applied point by point, is needed because purely linear invariant functions can only see the average of the input. A coarsening or pooling step shrinks the domain so later layers see wider areas. A final global invariant layer collapses everything into an answer that ignores the symmetry.

The text then walks through five kinds of domain, the 5 Gs: grids, groups, graphs, geodesics and gauges. Graphs have no natural order of nodes, so functions on them must not depend on how nodes are numbered. On grids, the authors show that convolution, the sliding-filter operation in image networks, follows directly from requiring that shifting the input shifts the output. Groups cover spheres and rotations, geodesics cover curved surfaces measured by shortest paths, and gauges cover the arbitrary choice of local directions on those surfaces.

Many popular models then appear as one blueprint with different domains and symmetries. CNNs work on grids with shifts, GNNs on graphs with reordering of nodes, and Deep Sets on plain sets. Transformers are recast as attention-based GNNs on a graph where every item connects to every other. Most strikingly, demanding that a recurrent network handle stretched or squeezed time yields exactly the gates found in LSTMs.

A chapter of applications shows the ideas at work. A graph network helped find that Halicin, a molecule first meant for diabetes, is a potent antibiotic, even against some resistant bacteria. A graph network predicts travel times in Google Maps, and mesh-based networks were used to design proteins aimed at blocking a cancer-related interaction.

The authors are open about limits. They study selected well-known architectures in depth rather than summarising all research, and several topics are left to future work. They report that common GNNs can be no more powerful than a classic test for telling graphs apart, which fails on simple cases. And the LSTM result only says gated networks can fit each warped signal, not that one trained model transfers to a new warping.

The main conclusion is that a large class of deep learning architectures now in use fits one scheme and comes from common geometric principles. Methods differ mainly in their choice of domain, symmetry group and how they build the blocks. The authors hope this lens lets readers understand and design future architectures, not just memorise today's.

### Summary B

This is a long survey text by four researchers that tries to bring order to deep learning, the branch of AI built on large neural networks. It borrows an idea from Felix Klein, a 19th-century mathematician who defined each kind of geometry by its symmetries: the changes that leave its key properties unchanged. The authors call their version Geometric Deep Learning. They aim to derive many popular network designs from first principles of symmetry rather than treat them as separate inventions.

The authors say deep learning today looks like geometry did before Klein: a "zoo" of network designs with few shared principles. This makes it hard to see how methods relate, so the same ideas get reinvented and renamed in different fields. A shared framework would help people study the most successful designs together. It would also give a principled way to build physical knowledge into future designs.

The argument starts with a problem called the curse of dimensionality. When inputs have many numbers, or dimensions, the examples needed to learn a merely smooth function grow exponentially with that number. Even for modest dimensions, the sample count could exceed the number of atoms in the universe. The authors use a simple geometric example of a bumpy function over a high-dimensional space to make this point concrete. Real tasks like vision or chemistry have long-range patterns, so the escape must come from the structure of the data itself.

That structure comes from the domain the data lives on, such as the pixel grid of an image. The text names two guiding principles: symmetry and scale separation. A function is invariant if transforming the input, say shifting an image, leaves the answer unchanged, as in labelling a photo "cat". It is equivariant if the output shifts in the same way as the input, as an object outline should follow a moved object.

Exact symmetry is too strict for the messy real world, where objects bend and move separately. Small distortions cannot be treated as a symmetry group, because many small ones add up to a large one. Instead, the authors ask for deformation stability: small distortions should change the output only a little. They show that Fourier features, which split a signal into global waves, can change a lot however small the distortion. Wavelets, which split a signal into local pieces at different scales, change only in proportion to the distortion.

These ideas combine into what the authors call the Geometric Deep Learning Blueprint, a recipe of stacked building blocks. A local equivariant layer looks at small neighbourhoods and respects the domain's symmetry. A non-linear step is added, because a purely linear invariant function can only see the input's average, such as an image's mean colour. A coarsening step, called pooling, shrinks the domain so later layers see larger regions. A final global invariant layer turns everything into one answer that ignores the symmetry.

The text then walks through five kinds of domain, the "5 Gs": grids, groups, graphs, geodesics and gauges. On graphs, networks of nodes and links, nodes have no natural order, so functions must not depend on how nodes are numbered. On grids, the authors show that convolution, the core operation of image networks, follows directly from requiring shift symmetry. Groups covers domains like the sphere, where every point can be rotated onto every other.

Geodesics concerns manifolds, curved surfaces such as the shape of a body, which usually have no global symmetry. Here the useful symmetries are bendings that keep distances along the surface the same. The authors warn that some filters built from surface "frequencies" can change dramatically under tiny near-distance-preserving changes. Gauges are local reference directions; since surfaces have no single "up", good networks give the same result whichever local directions are chosen.

Finally, the authors match well-known designs to their domain and symmetry. Image networks, or CNNs, use grids and shifts; graph networks use permutations; Transformers act like graph networks on fully connected graphs. They sort graph networks into three types, each able to express the one before: convolution, attention, and message passing. They also argue that the gates in LSTMs, a memory network for sequences, are exactly what invariance to stretching or squeezing time requires.

The authors are open about limits. They do not claim to summarise all research, only to study well-known designs in depth. They note that common graph networks are no more powerful than a classic test that cannot tell a six-node ring from two triangles. The time-stretching result only guarantees an LSTM could fit each warped signal, possibly with very different settings, not transfer between them.

The text also surveys uses, such as a graph network that helped find Halicin, a diabetes drug candidate, to be a potent antibiotic. Another graph network now predicts travel times in Google Maps. The main conclusion is that a large class of current architectures fits one scheme and can be derived from common geometric principles. Methods differ mainly in their choice of domain, symmetry group and building-block details.

