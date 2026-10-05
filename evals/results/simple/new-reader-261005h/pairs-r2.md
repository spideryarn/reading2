# Pairs of summaries of the same piece

blind-id: aca158e311c2

Each pair is two summaries of one piece. You have not read the piece and are not given it. The sides are in a random order. Judge each pair on its own.

## P01

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This research paper asks whether a standard Transformer, changed as little as possible, can classify images as well as convolutional networks (CNNs). The trick is to cut each image into fixed-size squares called patches, flatten each one, and project it linearly into a vector, exactly like a token embedding. The authors call the result the Vision Transformer, or ViT, and train it to label images with supervision.

In vision, CNNs still dominate large-scale image recognition, even though Transformers have scaled to huge sizes in language. Earlier attempts to swap convolutions for attention used special attention patterns that need complex engineering to run fast on hardware accelerators. A plain Transformer, by contrast, can reuse scalable language-model code almost out of the box.

Like BERT, ViT puts an extra learnable token in front of the patches, and its final output serves as the image summary. Learned 1D position embeddings tell the model where each patch sits. The only built-in assumptions about images are the patch cutting and, when fine-tuning at higher resolution, stretching the position embeddings to the new grid. Names like ViT-L/16 mean the Large model (307M parameters) with 16-by-16-pixel patches; Base has 86M and Huge 632M.

The central finding is about data size. Trained on ImageNet's 1.3M images alone, ViT scores a few points below similar-sized ResNets, and Large does worse than Base. On ImageNet-21k (14M images) and Google's in-house JFT-300M (303M images), ViT catches up and then overtakes. On random JFT subsets, ViT-B/32 was much worse than ResNet50 at 9M images but better from 90M up. The authors conclude that a CNN's built-in assumptions help on small data, while large data lets the model learn those patterns itself.

Against the best CNNs, pre-trained on JFT-300M, ViT did well on both accuracy and cost. ViT-H/14 reached 88.55% on ImageNet and 77.63% on VTAB, a set of 19 tasks with 1,000 training examples each. It used 2.5k TPU core-days of pre-training, against 9.9k for the large ResNet called BiT-L, though training settings may also affect this gap. In a controlled comparison, ViT needed about 2 to 4 times less compute than ResNets for the same accuracy, and showed no sign of levelling off. Hybrids, which feed CNN feature maps into ViT, helped only for small models.

Looking inside, the learned position embeddings came to reflect the image's rows, columns and distances on their own. Some attention heads already looked across most of the image in the lowest layers, others stayed local, and the average span grew with depth. A first try at BERT-style self-supervision, predicting hidden patches, gave ViT-B/16 79.9% on ImageNet: 2% better than training from scratch, but 4% behind supervised pre-training.

The authors conclude that treating an image as a sequence of patches works surprisingly well when paired with large-scale pre-training. They say it matches or beats the state of the art on many image classification datasets while being relatively cheap to pre-train. Open problems they name are other vision tasks such as detection and segmentation, closing the self-supervised gap, and further scaling, which would likely help.

### Summary B

This research paper asks a simple question: can a standard Transformer, nearly unchanged from its text form, classify images well? The authors cut each image into small square patches and feed the patches in as if they were words. They call the result the Vision Transformer, or ViT, and train it to label images in a supervised way.

In computer vision, convolutional networks such as ResNets still dominated large-scale image recognition when this was written. Earlier attempts to bring attention into vision used special attention patterns that need complex engineering to run efficiently on hardware accelerators. Meanwhile, Transformers in language had scaled past 100 billion parameters with no sign of performance levelling off, and the authors wanted that scaling for images.

ViT flattens each patch and maps it with one learned linear layer; the outputs are called patch embeddings. Learned position embeddings, which tell the model where each patch sat, are added, and an extra learnable token, like BERT's [class] token, carries the final image representation. Models come in Base, Large and Huge sizes, from 86M to 632M parameters; ViT-L/16 means the Large model with 16×16-pixel patches.

The key finding concerns data size, because ViT lacks the built-in image assumptions of convolutions, such as locality. Trained on ImageNet's 1.3M images alone, ViT lands a few points below similar-sized ResNets, and ViT-Large even trails ViT-Base. With ImageNet-21k (14M images) the sizes draw level, and with JFT-300M, Google's in-house set of 303M images, ViT overtakes the ResNets. On random JFT subsets, ViT-B/32 does much worse than ResNet50 at 9M images but better at 90M and above.

The largest model, ViT-H/14 pre-trained on JFT-300M, reaches 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB. VTAB is a suite of 19 tasks with only 1,000 training examples each. The best earlier models, a large ResNet called BiT-L and an EfficientNet called Noisy Student, scored 87.54% and 88.4–88.5% on ImageNet. ViT-H/14 used 2.5k TPU core-days of pre-training, against 9.9k and 12.3k for those two. ViT-L/16 trained on public ImageNet-21k still does well and fits on one 8-core TPU in about 30 days.

A controlled study on JFT-300M compared 7 ResNets, 6 ViTs and 5 hybrids, which feed ResNet feature maps into a ViT. ViT needs about 2–4 times less compute than ResNets for the same accuracy, averaged over five datasets. Hybrids help slightly at small budgets, but the gap vanishes for larger models, and ViT shows no sign of levelling off. The authors warn that efficiency may also depend on training schedule, optimizer and weight decay, not only architecture.

Looking inside, the position embeddings learn the image's 2D layout on their own: nearby patches and patches in the same row or column get similar embeddings. The authors also measure attention distance, how far across the image each attention head gathers information, akin to a receptive field. Some heads span most of the image even in the lowest layers, others stay local, and the distance grows with depth.

A first try at self-supervision, predicting masked patches as BERT predicts masked words, gave ViT-B/16 79.9% on ImageNet. That is 2% above training from scratch but 4% behind supervised pre-training. Open challenges include detection, segmentation and closing that self-supervision gap. The conclusion: treat an image as a sequence of patches, pre-train at scale, and a standard Transformer matches or beats the best vision models while costing less to pre-train.

## P02

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a perspective essay by Michael Levin about what memory is for. He argues that memory exists to preserve salience, meaning what matters for acting next, rather than fidelity to exact details. He builds the case from examples across developmental biology, evolution, synthetic bioengineering and neuroscience, rather than from one new study. Borrowing from process philosophy and Buddhist thought, he treats the self as a process, not a thing.

The starting point is a paradox: a species that never changes dies out, but one that changes stops being itself. Any learning agent faces this, so Levin says it bears on engineering new intelligences, AI and artificial life. Bodies face it from inside too, since their own parts mutate, age, turn cancerous and get hijacked by other organisms. He claims that coping with this unreliable material is not a weakness but the origin of intelligence.

Levin pictures a mind as a series of Selflets: slices of the self, probably a few hundred milliseconds thick. Each memory is then a note left by a past Selflet, a message the present one must interpret. So confabulation, usually treated as a bug in brains and in AI, becomes a powerful feature. He calls this active rebuilding of memory content mnemonic improvisation.

Caterpillars largely rebuild their brains into butterflies, yet some learned associations survive, reworked from leaves to food in general for a new body. Brain extract from trained sea slugs, injected only near the relevant nerve tissue, changes the recipient's behavior. Reports of memories moving through heart or lung transplants are, he notes, still uncertain. An odorant injected into a frog egg makes the resulting animal seek that odor when foraging. Levin concludes that memory traces act less like stored records and more like a prompt, with decoding supplying the intelligence.

He extends this beyond brains with the bowtie architecture: rich information squeezed through a narrow bottleneck, then re-expanded, as in an autoencoder. An egg is such a bottleneck, rebuilding a body in a possibly different world with possibly mutated parts. Simple signals act as triggers: one voltage-altering drug grows tails in tadpoles but legs in froglets, never the reverse. Because compression strips out correlations, the stored trace looks random, so decoding must be creative.

Newts with enlarged cells still build kidney tubules of normal width, using fewer cells or even one cell bent around itself. Levin proposes species differ in their willingness to confabulate in body-building, from the rigidly wired worm C. elegans to flexible planarian flatworms. Planaria have very noisy genomes yet resist aging, cancer and injury, which simulations link to reliance on large-scale pattern completion. Since such capable parts hide genome quality from selection, he proposes an intelligence ratchet that keeps improving problem-solving machinery.

The most speculative section asks whether memories are themselves minimal agents, echoing William James: "thoughts are thinkers." Memories may also be cognitive glue, something that makes a self more than the sum of its parts. A rat that learns lever pressing brings food holds a memory no single cell has: paw cells feel the lever, gut cells get the reward. His group is training memories into gene-regulatory network models and measuring integrated information to test this.

Levin says he has stated the strongest version of these claims, and a moderate hybrid with the conventional view may prove more useful. His causal chain runs from unreliable parts, to repair skills in body-building, to behavioral intelligence. Underneath sits polycomputing: the same physical process serving different functions depending on who interprets it. His conclusion is that the self is a construction, an adaptive story holding parts together, kept alive by reinterpreting memories rather than preserving them.

### Summary B

This essay by biologist Michael Levin argues that memory works by preserving salience, not fidelity: it keeps what matters, not an exact record. It is a perspective piece built from examples in developmental biology, evolution, bioengineering and neuroscience, rather than a report of one new experiment. Its central claim is that living things constantly reinterpret and rewrite their memories to suit a changing body and world.

The starting point is a paradox: a species or self that never changes dies out, but one that changes seems to stop being itself. Levin says the puzzle rests on pure logic, so it applies to agents at every scale, from parts of cells to whole lineages. That, he says, makes it relevant to engineering new intelligences, from AI to artificial life. His answer, drawn from process philosophy and Buddhist thought, is to treat the self as an ongoing process rather than a fixed thing.

Levin pictures a mind as a series of Selflets: thin slices of the self, each probably a few hundred milliseconds long. Memories are then notes left by a past slice for a future one, and like any message they must be interpreted. So confabulation, usually treated as a bug in AI and in court witnesses, becomes a feature he calls mnemonic improvisation: actively rebuilding memory content to fit the present.

The evidence is a set of biological cases where information survives by being remapped to a new setting, not copied. Some trained caterpillars keep memories as butterflies, even though leaf-finding details are useless to a nectar-drinking flyer, so the lesson must be remapped. An odor molecule injected into a frog egg leads the grown animal to seek that odor when hunting food, so one cell must turn the cue into behavior. Newts engineered with much larger cells still build kidney tubes of normal width, using fewer cells, or even one cell bending around itself.

A recurring pattern is the bowtie architecture: data squeezed through a narrow middle and expanded again, as in an autoencoder. Each organism compresses into an egg that must re-inflate in a possibly different world, with possibly mutated parts. Because compression strips out correlations, the stored trace looks increasingly random, so decoding it must be creative, not just step-by-step deduction. Levin proposes that species differ in their willingness to confabulate while building a body, and that planarian flatworms, despite very noisy genomes, commit fully and regenerate best.

The most speculative step blurs the line between data and the minds holding them, echoing William James: "thoughts are thinkers." Levin asks whether memories could have minimal agency, helping shape the mind that will reuse them later. He also asks whether memories act as cognitive glue, binding parts into a self: a rat's lever-and-reward memory belongs to no single cell. Underneath all this is polycomputing: the same physical process can compute different things depending on who interprets it.

Levin says he has deliberately stated the strongest version of these claims, and that a more moderate hybrid may prove most useful. He admits nobody yet knows how this plasticity works. Proposed tests include moving pattern memories between planaria through tissue implants, for which only unpublished preliminary data exist, and transferring learned memories between gene-network models.

The conclusion is that the noise and unreliability of living matter is a feature: intelligence arose because of it, not in spite of it. Organisms that cannot handle novelty in their own parts and memories, not just their surroundings, are unlikely to persist. The self, on this view, is a construction: an adaptive story that holds parts together and guides action.

## P03

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This research paper asks a simple question: can a Transformer recognise what is in a picture without help from older image models? A Transformer is a kind of AI model built on attention, a step that lets every piece of the input weigh every other piece. The authors cut each image into small square patches and feed them in the way a language model takes in words. They call the result the Vision Transformer, or ViT.

In language tasks, Transformers have become the standard, and they have grown past 100 billion parameters with no sign of their gains levelling off. In vision, convolutional networks (CNNs) still dominate; these models slide small windows across an image to spot local patterns. Earlier tries at attention for images used special attention patterns that were hard to run fast on modern hardware.

The method stays very close to the original language Transformer. Each patch, for example 16 by 16 pixels, is flattened into a list of numbers and turned into a vector of fixed size. A learned position embedding, a code for where the patch sat, is added so location is not lost. An extra learned "classification token" joins the sequence, and its final state is used to decide the image's label.

The key idea is inductive bias: assumptions built into a model before it sees any data. CNNs assume that nearby pixels matter together and that a pattern means the same thing anywhere in the image. ViT has far fewer such assumptions and must learn spatial relations from scratch. Trained only on ImageNet, about 1.3 million images, it lands a few percentage points below similar-sized ResNets, a common CNN design.

The picture changes with much more training data, from 14 million to 300 million images. The best model reaches 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB, a set of 19 tasks, matching or beating the best earlier results. On a 9-million-image subset ViT-B/32 does much worse than ResNet50, but it does better on subsets of 90 million images or more. ViT uses roughly 2 to 4 times less computing power than ResNets to reach the same performance. Hybrids, which run a CNN before the Transformer, help small models slightly, but the gap vanishes for larger ones.

Looking inside, the authors find that the position embeddings learn the image's rows and columns by themselves. Some attention heads look across most of the image even in the first layers, while others stay local, much like early CNN layers. Overall, the model attends to the parts of an image that matter for naming it.

The authors note limits. Their lower training cost may come partly from other choices, such as the training schedule and optimizer, not just the design. Self-supervised training, learning without labels by guessing hidden patches, reached 79.9% on ImageNet, 2% above training from scratch but 4% behind labelled pre-training. Tasks like detection and segmentation remain untested.

The main conclusion is that large-scale training beats built-in assumptions. Treating an image as a sequence of patches works surprisingly well with large pre-training data, and is relatively cheap to pre-train. The authors expect that further scaling of ViT would likely improve performance.

### Summary B

This research paper asks whether a Transformer, a type of neural network built for language, can recognise what is in a picture with almost no changes. The authors cut each image into small square patches and feed them in the way words of a sentence would be fed in. They call the result the Vision Transformer, or ViT, and train it to label images.

In language, Transformers have become the standard tool, and they keep improving as models and datasets grow, with some passing 100 billion parameters. In vision, convolutional networks, or CNNs, still lead; they scan small windows across an image. Earlier attempts to bring attention into vision used special designs that were hard to run fast on modern chips. A plain Transformer could reuse the efficient tools already built for language.

Each patch, often 16 by 16 pixels, is flattened into a list of numbers and turned into a fixed-length vector by a learned linear step. A learned position code is added so the model knows where each patch came from. An extra learned "class token" is placed at the front, and its final state is used to decide the image's label.

The key idea is inductive bias: built-in assumptions about images, such as nearby pixels mattering together, which CNNs have and ViT mostly lacks. Trained on ImageNet, about 1.3 million images, ViT scores a few points below CNNs of similar size. With ImageNet-21k (14 million images) the gap closes, and with JFT-300M (303 million images) ViT pulls ahead. Tests on 9-million to 300-million-image subsets show ViT overfits small data more but wins from 90 million up.

After pre-training on lots of data, then fine-tuning, meaning extra training on a smaller target task, the main results are: The best model reaches 88.55% on ImageNet, 94.55% on CIFAR-100, and 77.63% across 19 VTAB tasks. It used 2.5k TPU core-days to pre-train, against 9.9k for the strongest CNN rival, BiT-L. In a controlled scaling study, ViT needed about 2 to 4 times less compute for the same accuracy, and showed no sign of levelling off.

Looking inside, the position codes learn the image's 2D layout by themselves, so nearby patches get similar codes. Some attention heads look across most of the image even in the first layers, while others stay local, rather like early CNN layers.

The authors note that training efficiency may also depend on choices like schedule and optimiser, not only the design. Self-supervised pre-training, learning by guessing hidden patches without labels, reached 79.9% on ImageNet, still 4% behind labelled pre-training. Applying ViT to tasks like finding and outlining objects remains to be done.

The conclusion is that a standard Transformer, treating an image as a sequence of patches, matches or beats top CNNs when pre-trained on large datasets. It does so while being relatively cheap to pre-train, and the authors expect further scaling to help.

## P04

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a review and theory paper about when cognitive control helps and when it hurts. Cognitive control here means the prefrontal cortex filtering raw input, keeping what serves the current goal and damping the rest. The authors propose a Matched Filter Hypothesis: performance is best when the amount of filtering matches what the task needs, not when filtering is maximal. The name borrows loosely from signal processing, where a matched filter best pulls a signal out of noise in a given setting.

The prefrontal cortex is usually treated as the seat of our most complex thinking, so more control looks like it should always be better. The authors argue a growing body of research shows otherwise. In one guessing task, one option pays off 75% of the time; adults pick it 75% of the time and win about 62.5%. Children pick it every time and win 75%, and some work links the adult habit to executive function.

The paper calls a state of reduced prefrontal activity "hypofrontality"; young children, whose frontal lobes are still maturing, are its natural example. High control should help tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Low control should help tasks that are implicit, reward-driven, non-verbal or intuitive, and too complex to hold in working memory. How well the filter matches can depend on age, genes, brain damage, doing a second task at once, or brain stimulation.

For learning, the authors gather evidence that less control can help. Adults doing a demanding second task at the same time learn hard-to-verbalize rules and motor sequences better. Disrupting the dorsolateral prefrontal cortex with magnetic pulses has been linked to better implicit motor learning. Children show less "blocking", where an already-learned cue stops a new cue from being learned, so they end up learning cue strengths more accurately. Given noisy artificial-language input, children produce only the most frequent form, while adults copy the noise.

The proposed reason is a tradeoff: control buys fast, accurate short-term performance at a long-term cost to what gets learned. The authors also point to competition between a prefrontal, rule-testing learning system and a striatal, habit-based one. For example, people with lower working memory capacity learn non-verbal category boundaries better.

For creativity, people inventing unusual uses for objects showed lower prefrontal and higher visual-area activity than people listing ordinary uses. A weak current that damps the left prefrontal cortex made people faster and more prolific at inventing new uses, with no such effect on control tasks. Children also resist functional fixedness, the trap of seeing an object only through its usual job. Still, judging whether an idea works likely needs control again, so creativity may cycle between the two states.

The authors flag real limits. Direct evidence in adults is sparse, and child advantages could come from differences other than an immature prefrontal cortex. Some learning, such as adapting when rewards switch, needs prefrontal function, so less control does not simply mean better learning. Creativity studies are few, and the exact neural mechanisms remain unspecified.

The takeaway: transforming input always has a cost, and a filter that helps under one set of conditions can harm under another. Cognitive control is best seen as a tool suited to some common problems, not an all-purpose optimizer for every task.

### Summary B

This is a review and theory paper about cognitive control: the brain's ability to hold goals, block distraction and override habits, largely supported by the prefrontal cortex (PFC). The authors propose the Matched Filter Hypothesis: performance is best when the amount of control matches what the task needs, not when control is maximal. They treat control as filtering, where the PFC keeps task-relevant input and discards the rest, borrowing the signal-processing idea of a filter tuned to extract signal from noise.

Most research on control focuses on what goes wrong when it is weak, such as young children's trouble switching to a new strategy. The authors argue that a growing body of work shows not all complex thinking benefits from control. They set out to describe when limited control is actually an advantage, focusing on learning and creativity.

High control should help tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Hypofrontality, a state of reduced PFC activity, should help tasks that are implicit, reward-based, nonverbal or intuitive, and too complex for working memory. The level of control reached depends on competition between the PFC and posterior or subcortical systems, such as sensory cortex and the basal ganglia. Age, brain damage, genes, doing two tasks at once and brain stimulation can all shift that balance.

For learning, the authors gather several lines of evidence that less control can help. When one option pays off 75% of the time, adults pick it 75% of the time and win 62.5%, while children pick it always and win 75%. Younger children show less blocking, where a known cue stops a new cue being learned, and less highlighting, where a later-learned link is overweighted. The authors read this as adults steering attention to cut errors fast, at the cost of a distorted picture of how strongly cues predict outcomes. In artificial-language studies with noisy input, children produce only the most frequent form, while adults reproduce the noise.

The authors also point to competing learning systems: a PFC-and-caudate system for explicit rules and a striatal system for procedural, habit-like learning. People with low working memory learn category boundaries that cannot be put into words better than high-capacity people do. People also fail to learn a boundary that is partly verbal and partly not, suggesting one system runs at a time. The mature PFC may push adults toward the explicit system even when it suits the problem poorly.

For creativity, the claim is that producing new ideas needs unfiltered perceptual detail, such as an object's shape or material. In an fMRI study, people inventing unusual uses for objects showed lower PFC and higher visual-area activity than people listing typical uses. Dampening left PFC with weak electrical current made people faster and more prolific at unusual uses, but not on control tasks. Children resist functional fixedness, being stuck on an object's usual use, though no study yet links this to PFC development. Creativity studies are few, and judging whether an idea works likely still needs PFC control.

The authors say the main open problem is the exact neural mechanism that matches the filter to the task. Less PFC does not steadily improve learning: reversal learning needs some PFC, and dopamine studies find an inverted-U relationship with performance. Children's advantages may also stem from other differences, such as knowledge or learned strategies, not weak PFC alone.

The unifying point is that transforming input has a cost: a filter useful under one set of rewards can hurt under another. Learning that prizes fast error reduction may pay later in less complete, less faithful knowledge. The authors conclude that cognitive control is a tool fitted to a subset of common problems, not an all-purpose optimizer.

## P05

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a lab experiment in rats about a simple question: does the brain need to be working while a rat rears up on its hind legs? The authors tested whether the hippocampus, a brain region long known to be essential for spatial memory, must be active during rearing for rats to remember places later. They switched off part of the hippocampus only during rearing and then measured memory.

Most research on how the hippocampus supports spatial memory looks at two moments: walking around, and quiet rest such as grooming or eating. Rearing is different: the rat stops and actively looks, sniffs and samples its surroundings from higher up. During rearing, the hippocampus shows strong 'theta', a regular 7–12 Hz brain rhythm tied to forming and recalling memories. Yet whether rearing matters for spatial memory was unknown.

Memory was tested on a maze with eight arms radiating from a central hub, using the delayed win-shift task. In the study phase, four random arms opened and each held food; after a four-minute delay, all eight opened, but only the four new arms had food. Two scores measured memory: percent correct, the share of the rat's first four arm choices that had food, and the total arms entered to find all four rewards.

To switch off the hippocampus, the team used optogenetics: a virus made neurons produce halorhodopsin, a protein that silences them when light shines on them. A 3D camera above the maze detected rearing and turned on a laser fed into the brain through implanted fibres, only during the study phase. Each rat ran three conditions: 'Off' with no light, 'Rear' with light during each rear, and 'Delay' with the same amount of light starting six seconds after each rear. A control group of seven rats got a virus without halorhodopsin, so the light could not silence their neurons; the main group had six rats.

The main findings were these. In the main group, percent correct fell from 77.7% with no light to 65.7% when the hippocampus was silenced during rearing. Those rats also needed more arm entries to find all the food, 6.5 versus 5.1. The 'Delay' condition did not significantly lower percent correct (72.0%), and arm entries showed only a borderline rise, 5.9 versus 5.1. Control rats showed no change in any condition, ruling out effects of the light itself, such as heat or distraction.

The authors name several limits. The six-second delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time. Nearly all rears were 'supported', with a front paw on a wall, so the study cannot compare this with free-standing rearing. It also cannot say whether every rear matters, or whether the same memory forming could happen during other looking behaviours, such as side-to-side head scanning.

Why might silencing during rearing hurt memory? The authors suggest rearing may help the rat update its inner model of its surroundings, here mainly to remember which arms opened today. Their conclusion is that dorsal hippocampus activity during rearing is important for spatial memory, making rearing a moment when the hippocampus encodes spatial memories.

### Summary B

This is a lab experiment in rats about rearing, when a rat stops and stands up on its hind legs to look and sniff around. The authors asked whether activity in the dorsal hippocampus, the upper part of a brain area needed for remembering places, matters during these moments. They hypothesized that rearing is a time when the hippocampus stores, or encodes, spatial memories.

Most research on how the hippocampus supports memory has looked at two states: walking around, and quiet rest such as grooming or eating. Rearing is common but little studied, even though it lets an animal take in more of distant cues and rises in new places. Rearing also comes with stronger 'high theta', a 7–12 Hz brain rhythm tied to memory, yet whether rearing matters for memory was unknown.

Rats learned a maze task called the delayed win-shift task, on a maze with eight arms spreading from a central hub. In the study phase, four random arms opened and held food; after a 4-minute delay, all eight opened, but only the four new arms held food. Memory was scored as percent correct, meaning how many of the first four choices had food, and as total arm entries needed to find all food.

To silence the hippocampus, the team used optogenetics: a virus made neurons carry halorhodopsin, a protein that shuts neurons down when light shines on them. A ceiling-mounted 3D camera detected rearing and switched on a laser through fibers implanted in the brain. Each rat ran three conditions: 'Off' with no light, 'Rear' with light during each rear, and 'Delay' with light of the same length starting 6 seconds late. Light was given only in the study phase, and a control group got a virus without halorhodopsin, to rule out effects of the light itself.

The main results compared each condition with 'Off'. In rats with halorhodopsin, 'Rear' lowered percent correct from 77.7% to 65.7%, a significant drop. Those rats also needed more arm entries on 'Rear' trials, 6.5 versus 5.1. Control rats showed no significant change, at 81.4% versus 83% correct. 'Delay' gave 72.0% correct, not a significant drop, and only a borderline rise in arm entries, 5.9 versus 5.1.

The authors name several limits, starting with the fact that the 6-second delay still overlapped about 35.5% of rearing time. Nearly all rears in the narrow arms were 'supported', with a paw on a wall, so the study cannot compare supported and free-standing rearing. It also cannot say whether every rear matters, or whether the same memory storing could happen during similar behaviors, such as side-to-side head scanning.

As a possible explanation, the authors suggest that silencing may have blocked updating of the rat's inner model of its surroundings. Because the rats knew the room well, this updating was likely about today's trial, like remembering where you parked your car today.

The authors conclude that dorsal hippocampus activity during rearing can be important for spatial memory, making rearing a time of memory storing. They say this directly supports an earlier idea that rearing can serve as a measure of hippocampal learning.

## P06

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a lab experiment on rats that asks one question. Does the hippocampus, a brain area needed for spatial memory, have to be working while a rat stands up on its hind legs? Standing up like this is called rearing, and the authors call it a form of attentive sampling: stopping to look and sniff around. Their idea was that rearing is a moment when the hippocampus stores, or encodes, spatial memories.

Most research on how the hippocampus supports spatial memory looks at times when animals walk or rest quietly. Rearing is common but barely studied, even though it lets an animal take in more of its surroundings, especially distant landmarks. Rearing also comes with a strong brain rhythm called theta, which earlier work links to forming and recalling memories. Still, no one had tested whether rearing actually matters for spatial memory.

Rats learned a task on a maze with eight arms, each with food at the end. In a study phase, only four arms opened; after a four-minute break, all eight opened, but food sat only in the four new arms. Memory was scored two ways: how many of the first four choices found food, and how many arm visits it took to find all four rewards.

The researchers used optogenetics: a virus made hippocampus cells carry a light-sensitive protein, halorhodopsin, that silences them when laser light shines through implanted fibres. A 3D ceiling camera spotted rearing in real time and switched the laser on, only during the study phase. Each rat ran three conditions: Off, with no light; Rear, with light during each rear; and Delay, with the same amount of light starting six seconds late. A control group got a virus without halorhodopsin, so light alone could not silence their cells.

The main results, from 6 experimental and 7 control rats, were these. Silencing during rearing cut correct choices from 77.7% to 65.7%, a statistically reliable drop. The same rats needed more arm visits to find all the food, 6.5 instead of 5.1. Control rats showed no change with the light, ruling out effects like heat or the light being distracting. The Delay condition caused no reliable drop in correct choices (72.0%), only a borderline rise in arm visits to 5.9.

The authors name several limits. The six-second delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time. Nearly all rears in the narrow maze had a paw on the wall, so the work cannot compare supported and unsupported rearing. It also cannot say whether every rear matters, or whether similar encoding could happen during other looking-around behaviours, such as side-to-side head scanning.

Why might silencing hurt memory? The authors suggest rearing may help the brain update its internal map of the surroundings. Because the rats already knew the maze well, any updating was likely about that day's events, like remembering where you parked today.

The authors conclude that hippocampus activity during rearing is important for spatial memory in this task. They argue rearing is a moment when the hippocampus encodes spatial memories, not just an idle pause.

### Summary B

This is a lab experiment in rats about rearing, when a rat stops and stands up on its hind legs to look around. It asks whether the hippocampus, a brain region needed for remembering places, must be active during rearing for the rat to form a spatial memory. To test this, the team briefly switched off the top part of the hippocampus only while rats reared, then checked their memory.

Most research on how the hippocampus supports spatial memory looks at times when animals walk around or rest quietly. Rearing is common but little studied, even though it lets the animal see and smell more of its surroundings, especially distant landmarks. During rearing, the hippocampus shows strong theta, a 7–12 Hz brain rhythm tied to storing and recalling memories. So rearing might be a key moment for memory, but nobody had tested whether it matters.

Rats learned a memory task on a maze with eight arms, each ending in a food cup. In the study phase, four random arms opened and held food; after a 4-minute break, all eight opened, with food only in the four new arms. Memory was scored as percent correct, the share of the first four choices that held food, and as total arm entries needed to find all food.

A ceiling 3D camera spotted rearing, and a laser silenced brain cells that carried halorhodopsin, a light-switched protein, in three study-phase conditions. Off: no light was delivered, giving each rat's normal performance. Rear: light came on during each rear and stayed on until it ended. Delay: light lasted the same time but started and stopped 6 seconds after each rear. A control group had only a glowing marker protein and no halorhodopsin, to rule out effects of light itself.

In halorhodopsin rats, Rear trials cut percent correct from 77.7% to 65.7% and raised arm entries from 5.1 to 6.5. Control rats showed no change: 83% versus 81.4% correct, and 5.2 arm entries either way. Delay trials did not significantly lower percent correct (72.0%), with only a borderline rise in arm entries (5.9, p = 0.05). The authors note the delayed light still overlapped about 35.5% of rearing time, so the two conditions were not fully separate.

Groups were small: six male rats with halorhodopsin and seven controls, and the experimenter knew each trial's condition. The narrow arms meant nearly all rears had a paw on a wall, so the study cannot compare this with free-standing rearing. It also cannot say which part of the hippocampus matters, whether every rear counts, or whether the same memory work could happen without rearing.

The authors suggest silencing may have stopped rats from updating their mental map of the room during rearing. Since the room was familiar, this updating likely concerned which arms were open that day, like remembering where you parked today. Their conclusion: hippocampal activity during rearing can be important for spatial memory, making rearing a moment when such memories are formed.

## P07

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how information is stored and read back accurately. Levin argues that living things instead keep salience, meaning what matters, rather than fidelity, meaning an exact copy. He draws on examples from brains, embryos, evolution and lab-built living systems.

The essay starts from a puzzle: if a creature never changes, it cannot learn, but if it changes, is it still the same self? Levin says this holds at every scale, from parts of cells to whole species, so it matters for building AI and new kinds of minds. His answer, borrowed from process philosophy and Buddhist ideas, is to see the self as an ongoing process, not a fixed thing.

In brains, he points to confabulation: the mind making up a fitting story to explain what happened. A patient made to laugh by a brain electrode says they thought of a joke, and the brain paints over the eye's blind spot. Levin pictures us as a series of Selflets, short slices of self perhaps a few hundred milliseconds long. Each engram, or memory trace, is then a note left by a past self, which the present self must interpret.

Some memories survive a caterpillar's brain being rebuilt into a butterfly's. Yet a lesson about leaves is useless to a nectar-drinking butterfly, so the memory must be remapped into a general idea like food. Brain extracts injected near a trained sea slug's nerves change its behaviour, and frogs from eggs injected with a smell later seek that smell. Levin concludes that engrams act less like stored files and more like prompts that the receiver interprets.

Beyond the brain, he sees a bowtie pattern everywhere: information squeezed into a small core, then expanded again in a new setting. A whole body is compressed into an egg, which must rebuild itself with possibly changed parts in a possibly different world. One voltage-changing drug makes tadpoles grow tails but older froglets grow legs, so the same signal is read by context. Newts with extra copies of their chromosomes and much larger cells still build normal-sized kidney tubes, using fewer cells.

Planarian flatworms have very noisy genomes yet resist ageing, cancer and injury, a century-old puzzle. Levin proposes they rely on large-scale pattern completion that overrides genetic details, a point supported by computer simulations. More broadly, he argues that unreliable living material is a feature: intelligence arose because of it, not in spite of it.

More speculatively, he asks whether memories help create the self that holds them, acting as a kind of glue. A rat's lever-and-reward memory belongs to no single cell, only to the whole rat. He even asks whether memories have a little agency of their own, echoing William James: thoughts are thinkers. Planned tests include moving learned memories between gene network models and moving pattern memories between flatworms.

Levin admits he has stated the strongest versions of these claims, and a more moderate middle view may prove more useful. His conclusion is that the self is a construction: an adaptive story that holds parts together and must be constantly repaired. For him, change drives intelligence, and every act can be seen as a message to a future self who will reinterpret it.

### Summary B

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how information is stored and read back accurately. Levin argues instead that memory preserves salience, meaning what matters, rather than fidelity, meaning exact detail. He calls the ability to rewrite memories and fit them to new bodies and settings mnemonic improvisation.

The essay starts from a puzzle: a species that never changes dies out, but one that changes also stops being what it was. Each of us faces this too, since learning means change. Levin says evolution solved it by treating the Self as a process, not a fixed thing. He says this matters for engineering new kinds of minds, including AI.

His argument builds from familiar cases of confabulation, where the mind reshapes memories to tell a coherent story. A patient made to laugh by a brain electrode often says they thought of a joke. Levin pictures the mind as a series of brief slices, which he calls Selflets, each perhaps a few hundred milliseconds long. Memories are then messages from past Selflets, and like all messages they must be interpreted.

Metamorphosis is his central example. Caterpillars largely rebuild their brains, yet some trained memories survive into the butterfly. A memory about which muscles to fire to reach leaves is useless to a flying nectar drinker, so it must be remapped to keep its point. Similarly, a frog grown from an egg injected with an odour molecule later seeks that odour when looking for food.

Levin argues the same reinterpretation happens in bodies, not just brains: One voltage-changing chemical, Monensin, makes tadpoles grow tails but young frogs grow legs, never the reverse. Tadpoles with no normal eyes but an eye placed on the tail can still learn visual tasks. Newts with far larger cells still build kidney tubes of normal width, using fewer cells or even one bent cell.

He links these cases through a bowtie architecture: rich information squeezed into a small core, then expanded again, as an animal is squeezed into an egg. Squeezed data looks increasingly random, so unpacking it must be creative, not just mechanical. He proposes species differ in their willingness to confabulate in building their bodies, with flatworms called planaria at the most flexible extreme.

More speculatively, Levin suggests memories may help hold a Self together. A rat learning that pressing a lever brings food forms a memory no single cell holds. Following William James's phrase "thoughts are thinkers," he asks whether memories might have a small degree of agency themselves. He admits he states the strongest version, and a more moderate middle view may prove more useful.

His conclusion is that the unreliability of living matter is a feature, not a bug. Planaria have the noisiest genome yet the best regeneration and cancer resistance, which he says supports this. Intelligence, he argues, grew from the constant need to reinterpret information as parts and surroundings change, making the Self an adaptive, ever-rebuilt story.

## P08

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how information is stored and read back accurately. Levin argues that living things instead keep salience, meaning what matters, rather than fidelity, meaning an exact copy. He draws on examples from brains, embryos, evolution and lab-built living systems.

The essay starts from a puzzle: if a creature never changes, it cannot learn, but if it changes, is it still the same self? Levin says this holds at every scale, from parts of cells to whole species, so it matters for building AI and new kinds of minds. His answer, borrowed from process philosophy and Buddhist ideas, is to see the self as an ongoing process, not a fixed thing.

In brains, he points to confabulation: the mind making up a fitting story to explain what happened. A patient made to laugh by a brain electrode says they thought of a joke, and the brain paints over the eye's blind spot. Levin pictures us as a series of Selflets, short slices of self perhaps a few hundred milliseconds long. Each engram, or memory trace, is then a note left by a past self, which the present self must interpret.

Some memories survive a caterpillar's brain being rebuilt into a butterfly's. Yet a lesson about leaves is useless to a nectar-drinking butterfly, so the memory must be remapped into a general idea like food. Brain extracts injected near a trained sea slug's nerves change its behaviour, and frogs from eggs injected with a smell later seek that smell. Levin concludes that engrams act less like stored files and more like prompts that the receiver interprets.

Beyond the brain, he sees a bowtie pattern everywhere: information squeezed into a small core, then expanded again in a new setting. A whole body is compressed into an egg, which must rebuild itself with possibly changed parts in a possibly different world. One voltage-changing drug makes tadpoles grow tails but older froglets grow legs, so the same signal is read by context. Newts with extra copies of their chromosomes and much larger cells still build normal-sized kidney tubes, using fewer cells.

Planarian flatworms have very noisy genomes yet resist ageing, cancer and injury, a century-old puzzle. Levin proposes they rely on large-scale pattern completion that overrides genetic details, a point supported by computer simulations. More broadly, he argues that unreliable living material is a feature: intelligence arose because of it, not in spite of it.

More speculatively, he asks whether memories help create the self that holds them, acting as a kind of glue. A rat's lever-and-reward memory belongs to no single cell, only to the whole rat. He even asks whether memories have a little agency of their own, echoing William James: thoughts are thinkers. Planned tests include moving learned memories between gene network models and moving pattern memories between flatworms.

Levin admits he has stated the strongest versions of these claims, and a more moderate middle view may prove more useful. His conclusion is that the self is a construction: an adaptive story that holds parts together and must be constantly repaired. For him, change drives intelligence, and every act can be seen as a message to a future self who will reinterpret it.

### Summary B

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how information is stored and read back reliably. Levin asks instead how living things reinterpret and rewrite memories to fit a self and a world that keep changing. His central claim is that memory preserves salience, meaning what matters, rather than fidelity, meaning exact details.

The essay starts from a puzzle: if a species never changes it dies out, but if it changes, the old species is gone. The same holds for a person who learns and grows. Levin says this puzzle faces agents at every scale, from cell parts to whole lineages, so it matters for AI and artificial life too. Living parts are also unreliable, prone to mutation, aging and cancer, and he argues this weakness is the very source of intelligence.

The essay argues from published examples rather than new experiments, including these: Caterpillars rebuild their brains into butterflies, yet keep some learned memories, which must be remapped from leaves to nectar to stay useful. An odour molecule injected into a frog egg leads the grown animal to seek that odour when looking for food. The brain invents content, such as a green flash between a yellow and a blue light, to tell a coherent story.

Levin pictures a mind as a series of Selflets: brief slices of self, each perhaps a few hundred milliseconds thick. A memory is then a message left by a past Selflet, which the present one must interpret. So confabulation, filling gaps with made-up but useful stories, is treated as a strength, not a bug.

He extends this beyond brains with the bowtie: information is squeezed into a small core, then expanded again in a new setting. An egg is one such core, re-expanding into a body that may meet a different world. One voltage-changing drug triggers tails in tadpoles but legs in froglets, so the same signal is read by context. Newts with giant cells still build normal kidney tubes, sometimes from a single cell bending around itself.

Planarian flatworms have very noisy genomes yet resist aging, cancer and injury, a century-old puzzle. Levin proposes they are most willing to confabulate in body-building, overriding genetic details with large-scale pattern completion. Because good repair hides bad genes from selection, evolution invests in these skills, an intelligence ratchet.

More speculatively, he asks whether memories themselves have a little agency, echoing William James: thoughts are thinkers. He suggests tests, such as training memories into gene networks to see if the whole system grows more unified. He admits he states the strongest version of these ideas, and a more moderate version may prove more useful.

His conclusion is that the Self is a construction: an adaptive story that holds parts together and must constantly be repaired. Organisms that cannot handle novelty in their own parts and memories are unlikely to persist. He closes by suggesting we treat each act as a message to a future self who will read it differently.

## P09

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a rat experiment asking whether hippocampal activity matters for spatial memory at one particular moment: when a rat rears up onto its hind legs. The authors switched off the dorsal (upper) hippocampus only during rearing, then tested memory later.

Most work on how the hippocampus supports spatial memory looks at two states: moving around, and quiet rest such as grooming or eating. Rearing is neither; the rat stops and actively samples its surroundings, gaining a wider view of distant cues. Rearing comes with strong 7–12 Hz theta rhythm in the hippocampus, a rhythm tied to memory encoding, yet its role in spatial memory was unknown.

Rats learned a delayed win-shift task on a maze with eight arms radiating from a hub. In the study phase, four random arms opened and each held food; after a 4-minute break, all eight opened, but food sat only in the four new arms. The hippocampus was silenced only during the study phase, so the test measured what had been stored.

Silencing used halorhodopsin, a light-driven pump that quiets neurons when lit, triggered by a ceiling-mounted 3D camera that detected rearing, under three conditions. Off: no light at all, giving each rat's baseline. Rear: the laser came on when rearing was detected and stayed on for the whole rear. Delay: the same amount of light, but switched on and off 6 seconds after the rear began and ended.

Six rats carried halorhodopsin; seven control rats got only a fluorescent marker, so light could not silence anything. In the halorhodopsin rats, the share of correct first four choices fell from 77.7% (Off) to 65.7% (Rear). They also needed more arm entries to find all the food: 6.5 versus 5.1. Control rats showed no change (81.4% versus 83%; 5.2 entries both ways).

The Delay condition asks whether timing matters or any silencing would hurt. Accuracy under Delay, 72.0%, was not significantly below Off, and extra arm entries (5.9) were only a borderline trend. The authors note the delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time.

The authors name several limits. The experimenter could not be blinded to condition, and the experimental group was tested before the controls. Narrow arms meant almost every rear involved leaning on a wall, so leaning and free-standing rears were not compared. The study cannot say which part of the hippocampus matters, whether every rear contributes, or whether the same encoding could happen without rearing.

The conclusion: rearing is a moment when the hippocampus encodes spatial memory, and silencing it then is enough to impair memory in this task. The authors suggest rearing may let the hippocampus update its internal model of the surroundings. Since the room was familiar, they think this updating supports memory for today's specific trial, like remembering where you parked today.

### Summary B

This is a rat experiment asking whether the hippocampus must be active while a rat rears for it to remember places later. Rearing means standing up on the hind legs to look and sniff around. The authors switched off the dorsal (upper) hippocampus only during rearing, then tested memory.

Most research on how the hippocampus builds spatial memory looks at two states: moving around, and quiet rest such as grooming or eating. Rearing is neither, and its role was unknown. It widens what the animal can see and smell, and increases in new places. It also comes with strong 7–12 Hz "high theta" rhythm in the hippocampus, a rhythm tied to memory, but theta studies usually ignore rearing.

The memory test was a delayed win-shift task on an 8-arm maze, where food sits at the end of each arm. In a study phase, four random arms opened; after a 4-minute break, all eight opened, with food only in the four new ones. A ceiling depth camera spotted rearing in real time and switched on a laser. The light activated halorhodopsin, a light-driven protein the authors put into hippocampal cells to silence them. Silencing happened only in the study phase, never at test.

Each rat ran three light conditions in shuffled order, one trial per day. "Off": no light, giving baseline performance. "Rear": light on for exactly as long as each rear lasted. "Delay": the same amount of light, but starting and stopping 6 seconds after each rear. A control group got only a glowing marker protein, no halorhodopsin, to rule out effects of light itself.

Memory was scored as percent correct (how many of the first four choices had food) and total arms entered to find all four. In silencing rats, percent correct fell from 77.7% (Off) to 65.7% (Rear), p = 0.02. Arms entered rose from 5.1 to 6.5, p < 0.0001. Control rats showed no change (81.4% versus 83%; 5.2 versus 5.2 arms).

The Delay condition did not significantly lower percent correct (72.0% versus 77.7%). It showed only a trend toward more arm entries (5.9 versus 5.1, p = 0.05). The authors note the delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time.

Samples were small: 6 silencing rats, all male, and 7 controls of both sexes, and the experimenter could not be blinded. Nearly all rears in the narrow maze had a paw on a wall, so the work cannot separate supported from unsupported rearing. It also cannot say whether every rear matters, which hippocampal subregion is key, or whether similar learning could happen without rearing.

The authors conclude that rearing is a moment when the hippocampus encodes spatial memory. They suggest silencing may have blocked updating of the rat's internal model of its surroundings. Since the maze was familiar, that update would likely be about today's open arms, not learning the room from scratch.

## P10

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how information is stored and read back accurately. Levin argues instead that memory preserves salience, meaning what matters, rather than fidelity, meaning exact detail. He calls the ability to rewrite memories and fit them to new bodies and settings mnemonic improvisation.

The essay starts from a puzzle: a species that never changes dies out, but one that changes also stops being what it was. Each of us faces this too, since learning means change. Levin says evolution solved it by treating the Self as a process, not a fixed thing. He says this matters for engineering new kinds of minds, including AI.

His argument builds from familiar cases of confabulation, where the mind reshapes memories to tell a coherent story. A patient made to laugh by a brain electrode often says they thought of a joke. Levin pictures the mind as a series of brief slices, which he calls Selflets, each perhaps a few hundred milliseconds long. Memories are then messages from past Selflets, and like all messages they must be interpreted.

Metamorphosis is his central example. Caterpillars largely rebuild their brains, yet some trained memories survive into the butterfly. A memory about which muscles to fire to reach leaves is useless to a flying nectar drinker, so it must be remapped to keep its point. Similarly, a frog grown from an egg injected with an odour molecule later seeks that odour when looking for food.

Levin argues the same reinterpretation happens in bodies, not just brains: One voltage-changing chemical, Monensin, makes tadpoles grow tails but young frogs grow legs, never the reverse. Tadpoles with no normal eyes but an eye placed on the tail can still learn visual tasks. Newts with far larger cells still build kidney tubes of normal width, using fewer cells or even one bent cell.

He links these cases through a bowtie architecture: rich information squeezed into a small core, then expanded again, as an animal is squeezed into an egg. Squeezed data looks increasingly random, so unpacking it must be creative, not just mechanical. He proposes species differ in their willingness to confabulate in building their bodies, with flatworms called planaria at the most flexible extreme.

More speculatively, Levin suggests memories may help hold a Self together. A rat learning that pressing a lever brings food forms a memory no single cell holds. Following William James's phrase "thoughts are thinkers," he asks whether memories might have a small degree of agency themselves. He admits he states the strongest version, and a more moderate middle view may prove more useful.

His conclusion is that the unreliability of living matter is a feature, not a bug. Planaria have the noisiest genome yet the best regeneration and cancer resistance, which he says supports this. Intelligence, he argues, grew from the constant need to reinterpret information as parts and surroundings change, making the Self an adaptive, ever-rebuilt story.

### Summary B

This is a perspective essay by biologist Michael Levin about what memory is for. He argues that memory's job is to keep salience, meaning what matters, rather than fidelity, meaning an exact copy of the past. He draws on examples from brains, embryos, evolution and bioengineering, from single cells up to societies.

The essay starts from a puzzle: if you never change you cannot grow, but if you change, does your old self still exist? Levin says this applies to any agent, from cell parts to whole species, so it matters for building new minds in AI and artificial life. His answer is to treat the self as a process, not a thing. Living parts mutate, age and break, so organisms must constantly reinterpret their own stored information, and he argues this is where intelligence comes from.

He first points to confabulation: the mind filling gaps by making up a fitting story. A patient whose brain electrode makes them laugh will say they remembered a joke, and the brain fills in the blind spot in our vision. Levin pictures us as a string of brief selves, which he calls Selflets, each perhaps a few hundred milliseconds long. An engram, a stored memory trace, is then a note left by a past self that the present self must interpret.

Several cases suggest memories get remapped to fit a new body, not just stored. Some trained memories survive a caterpillar's brain being rebuilt into a butterfly's, though the butterfly wants nectar, not leaves. Brain extract from trained sea slugs (Aplysia) changes behaviour in untrained ones even when injected only roughly near the nerve tissue. Injecting a smell molecule into a frog egg yields an animal that seeks that smell when looking for food.

Levin's central picture is the bowtie: rich information squeezed through a narrow middle, then expanded again by a receiver that adds context. An egg is such a squeeze, rebuilding a whole body from one cell. The same voltage-changing drug, Monensin, makes tadpoles grow tails but froglets grow legs, so the body reads one signal by context. Newts with huge cells still build normal kidney tubes, using fewer cells or even one cell bent around itself.

Planarian flatworms have very noisy genomes yet resist ageing, cancer and injury, a long-standing puzzle. Levin proposes they lean hardest on a willingness to confabulate in body-building, overriding genetic details with large-scale pattern completion, as computer simulations suggest. He calls this an intelligence ratchet: unreliable parts push evolution to favour clever repair over perfect parts.

More speculatively, he asks whether memories themselves have a little agency, echoing William James: thoughts are thinkers. He proposes tests, such as moving pattern memories between planaria, where preliminary data are unpublished. He admits he has stated the strongest version, and a more moderate middle view may prove most useful.

His conclusion is that the self is a construction: an adaptive story that holds parts together and is constantly repaired. Organisms that cannot handle novelty in their own parts and memories, he argues, will not persist, while change drives intelligence. He ends by framing every act as a message to a future self who will read it differently.

## P11

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This review article proposes a new idea about cognitive control: the brain's ability to stay on a goal by holding back distractions and habits. This ability is linked to the prefrontal cortex, the front part of the brain. The authors describe control as a filter that turns down or throws away some incoming information. They call their idea the Matched Filter Hypothesis: tasks go best when the amount of filtering matches what the task needs.

It matters because a growing body of research suggests more control is not always better. In one guessing task, one choice pays off 75% of the time. Adults pick it 75% of the time and win about 62.5% overall, while children pick it every time and win 75%. Some research links the adult habit to control, so here control may actually hurt.

The hypothesis sorts tasks into two kinds. High control suits tasks with clear rules, words or abstract ideas that fit in working memory, the small amount we can hold in mind at once. Low control suits tasks driven by what we sense, learned through reward or intuition, and too complex for working memory. How well a person matches control to a task may depend on age, genes, brain damage, or a brief disruption of the brain.

The first body of evidence comes from learning, where reduced frontal activity sometimes helps. Doing a second task at the same time helps adults learn rules they cannot put into words, and so does disrupting the front brain with magnetic pulses. Three-year-olds are less likely than four-year-olds to ignore a cue just because an earlier cue already predicted the outcome. Learning a made-up language from messy input, children keep only the most common form, while adults copy the noise.

The authors argue that control often buys quick accuracy now at a cost later. Ignoring some information cuts errors fast, but the ignored details are learned badly or forgotten. They also point to rival learning systems: one learns explicit rules using the frontal brain, another builds habits deep in the brain. Adults with low working memory learn hard-to-describe category boundaries better than high-memory adults.

The second body of evidence comes from creativity. People thinking up unusual uses for objects showed lower frontal activity and more activity in visual areas. A weak current that dampened the left front brain made people faster and produced more such uses. Children also get stuck less than adults on an object's usual purpose when solving puzzles. Still, judging whether an idea works likely needs control again, with the brain switching back and forth.

The authors name several limits. Children differ from adults in knowledge and other brain areas, so their advantages cannot be blamed on weak frontal activity alone. Some frontal function is essential, for example for relearning when rules flip, so less is not simply better. Creativity studies are few, patient results are mixed, and the brain mechanisms remain unspecified.

The main conclusion is that cognitive control is a tool fitted to some common problems, not a system that improves every task. Its failures, the authors argue, can bring real advantages in learning and creative thinking.

### Summary B

This is a review and theory paper about cognitive control: the brain's ability to steer thinking toward a goal and screen out distractions. The authors say this control comes mainly from the prefrontal cortex, the front part of the brain, which works like a filter on incoming information. They propose the Matched Filter Hypothesis, borrowing a term for a filter that best pulls a signal out of noise. Its claim is that performance is best when the amount of control matches what the task needs, not when control is simply high.

The prefrontal cortex is usually seen as essential for complex thought, and research on children mostly treats their weak control as a deficit. Yet a growing body of work shows that not all complex thinking benefits from control. In one guessing game, an option pays off 75% of the time. Adults pick it 75% of the time and win about 62.5%, while children pick it always and win 75%.

High control should help with tasks that are explicit, rule-based, verbal or abstract, and that fit in working memory, the small space for holding things in mind. Low control, which the authors call hypofrontality, should help with tasks that are implicit, driven by what you see, and too complex for working memory. How well the match works may depend on age, genes, brain damage, or short-term disruption such as a second task or brain stimulation. Some limits are fixed by biology, but people may sometimes shift their level of control through training, stimulation or drugs.

The learning evidence comes from earlier studies the authors bring together. Doing a second task at the same time helps adults learn rules they cannot put into words, and magnetic disruption of the prefrontal cortex improved hidden motor learning. Adults steer attention away from some cues to cut errors fast, which distorts what they learn; 3-year-olds show less of this than 4-year-olds. Given messy language input, adults copy the noise, while children produce only the most common form and so outperform adults.

For creativity, people thinking up unusual uses for objects showed less prefrontal activity and more activity in visual areas. Mild electric stimulation that dampened the left prefrontal cortex made people produce creative uses faster and in greater numbers. Jazz musicians showed low prefrontal activity while improvising, but not while playing well-practised pieces. Children also get stuck less than adults on seeing an object only by its usual use, though no study has yet tied this to brain development.

The authors admit direct evidence in adults is sparse, and children's advantages could come from other differences, such as knowledge or strategies. Studies of creativity are few, and some results conflict. Judging whether a new idea actually works likely needs the prefrontal cortex again, so creative work may switch back and forth between states. The exact brain mechanisms that set the right level of control remain unknown.

The unifying point is that filtering input always has a cost: it can speed up correct responses now but lose detail needed later. The authors conclude that cognitive control is a tool suited to some common challenges, not an all-purpose system that improves every task.

## P12

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This research paper asks a simple question: can a Transformer recognise what is in a picture without help from older image models? A Transformer is a kind of AI model built on attention, a step that lets every piece of the input weigh every other piece. The authors cut each image into small square patches and feed them in the way a language model takes in words. They call the result the Vision Transformer, or ViT.

In language tasks, Transformers have become the standard, and they have grown past 100 billion parameters with no sign of their gains levelling off. In vision, convolutional networks (CNNs) still dominate; these models slide small windows across an image to spot local patterns. Earlier tries at attention for images used special attention patterns that were hard to run fast on modern hardware.

The method stays very close to the original language Transformer. Each patch, for example 16 by 16 pixels, is flattened into a list of numbers and turned into a vector of fixed size. A learned position embedding, a code for where the patch sat, is added so location is not lost. An extra learned "classification token" joins the sequence, and its final state is used to decide the image's label.

The key idea is inductive bias: assumptions built into a model before it sees any data. CNNs assume that nearby pixels matter together and that a pattern means the same thing anywhere in the image. ViT has far fewer such assumptions and must learn spatial relations from scratch. Trained only on ImageNet, about 1.3 million images, it lands a few percentage points below similar-sized ResNets, a common CNN design.

The picture changes with much more training data, from 14 million to 300 million images. The best model reaches 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB, a set of 19 tasks, matching or beating the best earlier results. On a 9-million-image subset ViT-B/32 does much worse than ResNet50, but it does better on subsets of 90 million images or more. ViT uses roughly 2 to 4 times less computing power than ResNets to reach the same performance. Hybrids, which run a CNN before the Transformer, help small models slightly, but the gap vanishes for larger ones.

Looking inside, the authors find that the position embeddings learn the image's rows and columns by themselves. Some attention heads look across most of the image even in the first layers, while others stay local, much like early CNN layers. Overall, the model attends to the parts of an image that matter for naming it.

The authors note limits. Their lower training cost may come partly from other choices, such as the training schedule and optimizer, not just the design. Self-supervised training, learning without labels by guessing hidden patches, reached 79.9% on ImageNet, 2% above training from scratch but 4% behind labelled pre-training. Tasks like detection and segmentation remain untested.

The main conclusion is that large-scale training beats built-in assumptions. Treating an image as a sequence of patches works surprisingly well with large pre-training data, and is relatively cheap to pre-train. The authors expect that further scaling of ViT would likely improve performance.

### Summary B

This research paper asks whether a Transformer, a type of neural network that has become standard for language tasks, can recognise images with almost no changes. Instead of reading words, the model reads an image cut into small square patches, such as 16 by 16 pixels, and treats each patch like a word. The authors call it the Vision Transformer, or ViT, and test it on image classification: naming what an image shows.

In language, Transformers have grown past 100 billion parameters, the adjustable numbers inside a model, with no sign of performance levelling off. In vision, convolutional networks, or CNNs, still dominate, and the classic ResNet design remained the best for large-scale image recognition. Earlier attempts to bring attention into vision used special patterns that were hard to run efficiently on modern hardware. The paper sets out to show that this reliance on CNNs is not necessary.

Each patch is flattened into a list of numbers and turned into a fixed-length vector by a learned step. An extra learned item, the "classification token", joins the sequence of patches, and its final state is used to give the answer. The core operation, self-attention, lets every patch draw information from every other patch in the image. Unlike CNNs, ViT has little inductive bias: few built-in assumptions about images, such as nearby pixels belonging together. So it must learn how patches relate in space from scratch.

The authors first pre-train each model, meaning they train it on a large labelled image collection. They then fine-tune it, meaning they train it further on a smaller target task. They use three collections of growing size: ImageNet with 1.3 million images, ImageNet-21k with 14 million, and Google's in-house JFT-300M with 303 million. The main rivals are slightly modified ResNets, plus hybrids that feed a CNN's output into a Transformer.

The central question is how much training data ViT needs, and three results point the same way. Pre-trained only on ImageNet, ViT scores a few percentage points below ResNets of similar size, and larger ViT models do worse than smaller ones. With ImageNet-21k, large and small ViT models perform about the same, and only with JFT-300M do larger models show their full benefit and overtake ResNets. Trained on random parts of JFT-300M, ViT does much worse than a ResNet of similar cost with 9 million images, but better with 90 million or more.

Pre-trained on JFT-300M, the largest model, ViT-H/14, reaches 88.55% accuracy on ImageNet. It also scores 77.63% on VTAB, a set of 19 varied tasks with only 1,000 training examples each. Its pre-training took 2.5 thousand TPUv3-core-days, a measure of processor cores times days, against 9.9 thousand for the strongest earlier large ResNet. In a controlled comparison, ViT needed about 2 to 4 times less compute than ResNets to reach the same performance. The authors caution that training schedule, optimiser and similar settings may also affect this efficiency, not only the design.

Looking inside, some attention heads, the parallel attention units in each layer, already look across most of the image in the first layers. The paper names open problems, starting with trying ViT on other vision tasks such as detecting objects. A first try at self-supervised pre-training, where the model learns by guessing hidden patches without labels, reached 79.9% on ImageNet. That is still 4 points behind pre-training with labels, a gap the authors call large.

The authors conclude that large-scale training trumps inductive bias. A plain Transformer reading image patches matches or beats the best models on many image classification datasets, while being relatively cheap to pre-train. Because ViT showed no sign of levelling off in the sizes tried, they expect further scaling would likely improve it.

## P13

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This review asks how networks of brain cells actually process information, and presents one tool for studying it. The tool is partial information decomposition (PID), a way of splitting up what several input neurons tell us about a target neuron. The authors explain the method for newcomers and draw mostly on their own recent experiments.

Brains take in signals from the senses and turn them into useful behavior, but how that change happens is poorly understood. The authors name two old obstacles: too little data, and too few ways to analyse it. New recording tools now capture hundreds or thousands of neurons at once, so the data problem has eased. PID is offered as part of an answer to the analysis problem.

Mutual information, from information theory, measures how much knowing one neuron's activity cuts our uncertainty about another's. Transfer entropy measures how much one neuron's past helps predict another's next step, beyond what that neuron's own past already tells us. PID takes the information two source neurons give about a target and splits it into three kinds. Redundant information can be learned from either source, unique information from only one, and synergistic information only from both sources' joint pattern. The authors treat synergy as a sign of real processing, or computation.

In their main experiments, the authors grew thin slices of mouse brain cortex on a 512-channel electrode array and recorded hundreds of single neurons. Using transfer entropy, they mapped which neurons pass information to which, finding about 0.4–1.0% of possible links to be significant. They then ran PID on thousands of triads: two source neurons that both connect to one target. Across 25 recordings, synergy rose strongly with transfer entropy and was reliably about a quarter of it.

Comparing triads showed which network features go with more synergy. Triads inside rich clubs, the best-connected and densely interlinked neurons, had 2.7 times as much synergy and held about 88% of all synergy. Triads with two links between the source neurons had 50% more synergy than the simplest triads, while two links back from the target meant 10% less. Synergy grew as the two sources' activity became more alike, but peaked when their mutual information reached about 7% of its maximum, then fell.

A later study by Varley and colleagues recorded motor-area neurons in three macaque monkeys doing a task of seeing symbols, planning, remembering and reaching. It repeated key culture results, including a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply while the monkeys reached and grasped. The authors suggest the brain may copy the move signal many times so it reaches the muscles reliably.

The authors name several limits. Their networks came from pairwise transfer entropy, which overstates links, and from cultured tissue, which faces different demands than a behaving animal's brain. PID finds statistical patterns but does not explain the biology that makes a neuron synergistic or redundant. It also scales badly: with six input neurons there are 7,828,354 separate pieces of information to track.

The main conclusion is that neurons do not simply add up their inputs and fire past a threshold; they also respond to the pattern of inputs. How much synergy appears depends on a neuron's place in the network and on what the animal is doing. The authors see promise in newer versions of PID that track information moment by moment, or across several targets at once.

### Summary B

This review explains a math tool for studying how groups of neurons combine the signals they receive. The tool is called partial information decomposition, or PID. The authors give a beginner-friendly introduction, then show what it revealed in their own and others' experiments.

Brains take in signals from the world and turn them into useful behavior, but how circuits transform those signals is poorly understood. Two things held this research back: too little data, and too few ways to analyze it. New recording methods now capture hundreds or thousands of neurons at once, so the analysis problem is what remains.

Older measures can track information moving between neurons. One, transfer entropy, asks how much one neuron's past helps predict another's next moment, beyond what that neuron's own past already tells us. But such measures miss how two incoming streams interact. PID splits what two input neurons tell us about a target into three kinds: redundant (either input alone tells it), unique (only one input tells it), and synergistic. Synergy is information you only get from both inputs' joint pattern, and the authors treat it as a sign of real processing.

In their main experiments, the authors grew thin slices of mouse cortex in dishes and recorded hundreds of neurons with 512-electrode arrays. They mapped which neurons influence which, finding about 0.4 to 1.0% of possible links were significant. They then ran PID on thousands of triads: two source neurons feeding one target.

Several patterns showed where synergy is found. Synergy rose with the flow of information into a triad, and was reliably about a quarter of that flow. Triads in the rich club, the best-connected neurons that link heavily to each other, had 2.7 times more synergy and held about 88% of all synergy, despite containing under 40% of neurons. Triads with two links between the source neurons had 50% more synergy, while two links from target back to sources meant 10% less.

Synergy also grew when the two inputs fired more alike, but only up to a point. It peaked when their shared information was about 7% of the maximum; beyond that, the overlap became redundant instead. In monkeys doing a reaching task, activity was mostly synergistic, but redundancy rose sharply during movement. The authors suggest the brain may repeat the move signal many times to send it reliably.

The authors name several limits. Their networks were built from two-neuron-at-a-time measures that overstate links, and dish cultures face different demands than a behaving animal's brain. PID finds statistical patterns but does not explain the biology behind them. With more inputs, the pieces explode in number: six inputs give 7,828,354, mostly hard to interpret.

The main conclusion is that neurons do not simply add up their inputs; they also respond to particular input patterns. That processing depends on a neuron's place in its network and on what the animal is doing.

## P14

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how information is stored and read back reliably. Levin asks instead how living things reinterpret and rewrite memories to fit a self and a world that keep changing. His central claim is that memory preserves salience, meaning what matters, rather than fidelity, meaning exact details.

The essay starts from a puzzle: if a species never changes it dies out, but if it changes, the old species is gone. The same holds for a person who learns and grows. Levin says this puzzle faces agents at every scale, from cell parts to whole lineages, so it matters for AI and artificial life too. Living parts are also unreliable, prone to mutation, aging and cancer, and he argues this weakness is the very source of intelligence.

The essay argues from published examples rather than new experiments, including these: Caterpillars rebuild their brains into butterflies, yet keep some learned memories, which must be remapped from leaves to nectar to stay useful. An odour molecule injected into a frog egg leads the grown animal to seek that odour when looking for food. The brain invents content, such as a green flash between a yellow and a blue light, to tell a coherent story.

Levin pictures a mind as a series of Selflets: brief slices of self, each perhaps a few hundred milliseconds thick. A memory is then a message left by a past Selflet, which the present one must interpret. So confabulation, filling gaps with made-up but useful stories, is treated as a strength, not a bug.

He extends this beyond brains with the bowtie: information is squeezed into a small core, then expanded again in a new setting. An egg is one such core, re-expanding into a body that may meet a different world. One voltage-changing drug triggers tails in tadpoles but legs in froglets, so the same signal is read by context. Newts with giant cells still build normal kidney tubes, sometimes from a single cell bending around itself.

Planarian flatworms have very noisy genomes yet resist aging, cancer and injury, a century-old puzzle. Levin proposes they are most willing to confabulate in body-building, overriding genetic details with large-scale pattern completion. Because good repair hides bad genes from selection, evolution invests in these skills, an intelligence ratchet.

More speculatively, he asks whether memories themselves have a little agency, echoing William James: thoughts are thinkers. He suggests tests, such as training memories into gene networks to see if the whole system grows more unified. He admits he states the strongest version of these ideas, and a more moderate version may prove more useful.

His conclusion is that the Self is a construction: an adaptive story that holds parts together and must constantly be repaired. Organisms that cannot handle novelty in their own parts and memories are unlikely to persist. He closes by suggesting we treat each act as a message to a future self who will read it differently.

### Summary B

This is a perspective essay by biologist Michael Levin about what memory is for. He argues that memory's job is to keep salience, meaning what matters, rather than fidelity, meaning an exact copy of the past. He draws on examples from brains, embryos, evolution and bioengineering, from single cells up to societies.

The essay starts from a puzzle: if you never change you cannot grow, but if you change, does your old self still exist? Levin says this applies to any agent, from cell parts to whole species, so it matters for building new minds in AI and artificial life. His answer is to treat the self as a process, not a thing. Living parts mutate, age and break, so organisms must constantly reinterpret their own stored information, and he argues this is where intelligence comes from.

He first points to confabulation: the mind filling gaps by making up a fitting story. A patient whose brain electrode makes them laugh will say they remembered a joke, and the brain fills in the blind spot in our vision. Levin pictures us as a string of brief selves, which he calls Selflets, each perhaps a few hundred milliseconds long. An engram, a stored memory trace, is then a note left by a past self that the present self must interpret.

Several cases suggest memories get remapped to fit a new body, not just stored. Some trained memories survive a caterpillar's brain being rebuilt into a butterfly's, though the butterfly wants nectar, not leaves. Brain extract from trained sea slugs (Aplysia) changes behaviour in untrained ones even when injected only roughly near the nerve tissue. Injecting a smell molecule into a frog egg yields an animal that seeks that smell when looking for food.

Levin's central picture is the bowtie: rich information squeezed through a narrow middle, then expanded again by a receiver that adds context. An egg is such a squeeze, rebuilding a whole body from one cell. The same voltage-changing drug, Monensin, makes tadpoles grow tails but froglets grow legs, so the body reads one signal by context. Newts with huge cells still build normal kidney tubes, using fewer cells or even one cell bent around itself.

Planarian flatworms have very noisy genomes yet resist ageing, cancer and injury, a long-standing puzzle. Levin proposes they lean hardest on a willingness to confabulate in body-building, overriding genetic details with large-scale pattern completion, as computer simulations suggest. He calls this an intelligence ratchet: unreliable parts push evolution to favour clever repair over perfect parts.

More speculatively, he asks whether memories themselves have a little agency, echoing William James: thoughts are thinkers. He proposes tests, such as moving pattern memories between planaria, where preliminary data are unpublished. He admits he has stated the strongest version, and a more moderate middle view may prove most useful.

His conclusion is that the self is a construction: an adaptive story that holds parts together and is constantly repaired. Organisms that cannot handle novelty in their own parts and memories, he argues, will not persist, while change drives intelligence. He ends by framing every act as a message to a future self who will read it differently.

## P15

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This research paper asks whether a standard Transformer can recognise what is in an image without help from convolutional networks. A Transformer is a neural network design built on attention, where each piece of the input weighs up every other piece. Convolutional networks, or CNNs, are the usual design for images; they scan a picture with small local filters. The authors call their model the Vision Transformer, or ViT.

The paper's reason is that Transformers have taken over language processing. There, models are first trained on huge text collections and have grown past 100 billion parameters with no sign of levelling off. In vision, CNNs still lead. Earlier attempts to bring attention to images used special patterns that were hard to run fast on modern chips.

The method changes the standard Transformer as little as possible. The image is cut into square patches, for example 16 by 16 pixels, and each patch is treated like a word in a sentence. Each patch is flattened into a list of numbers and turned into a fixed-length vector, called a patch embedding. An extra learned classification token is added to the sequence, and its final output is used to give the image's label. The model is pre-trained on a large labelled dataset, then fine-tuned, meaning briefly retrained, on a smaller target task.

A key idea is inductive bias: assumptions built into a design before it sees any data. CNNs assume nearby pixels belong together and that a shifted object should give a shifted response. ViT has far fewer such assumptions; even its position embeddings, the numbers marking where each patch sat, start out knowing nothing about the 2D layout. Trained on ImageNet alone, about 1.3 million photos, ViT lands a few percentage points below similar-sized ResNets, a common kind of CNN.

To test how much data matters, the authors pre-trained on ImageNet, on ImageNet-21k with 14 million images, and on Google's in-house JFT-300M with 303 million. On ImageNet, larger ViT models did worse than smaller ones; on ImageNet-21k they were similar; only on JFT-300M did size pay off. On random slices of JFT, ViT-B/32 did much worse than ResNet50 with 9 million images, but better from 90 million up.

Pre-trained on JFT-300M, the largest model, ViT-H/14, reaches 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB, a suite of 19 varied tasks. It needed 2,500 TPUv3-core-days of computing time, against 9,900 for BiT-L, the best earlier CNN approach. The authors note that training schedule, optimizer and other settings, not only the design, may affect this efficiency.

In a controlled comparison of 18 models, ViT needed about 2 to 4 times less compute than ResNets for the same accuracy, and showed no sign of levelling off. Looking inside, the position embeddings learned the image's rows and columns by themselves. Some attention heads looked across most of the image even in the first layers, and the distance attended grew with depth.

The paper admits gaps. A first try at self-supervised training, where the model learns by guessing hidden patches without labels, reached 79.9% on ImageNet. That is 2% better than no pre-training but 4% behind supervised pre-training, and tasks like finding objects in images remain untested. The main conclusion: this simple approach works surprisingly well with pre-training on large datasets, matching or beating top CNNs while being relatively cheap to pre-train.

### Summary B

This research paper asks whether a Transformer, a type of neural network built for language, can recognise what is in a picture with almost no changes. The authors cut each image into small square patches and feed them in the way words of a sentence would be fed in. They call the result the Vision Transformer, or ViT, and train it to label images.

In language, Transformers have become the standard tool, and they keep improving as models and datasets grow, with some passing 100 billion parameters. In vision, convolutional networks, or CNNs, still lead; they scan small windows across an image. Earlier attempts to bring attention into vision used special designs that were hard to run fast on modern chips. A plain Transformer could reuse the efficient tools already built for language.

Each patch, often 16 by 16 pixels, is flattened into a list of numbers and turned into a fixed-length vector by a learned linear step. A learned position code is added so the model knows where each patch came from. An extra learned "class token" is placed at the front, and its final state is used to decide the image's label.

The key idea is inductive bias: built-in assumptions about images, such as nearby pixels mattering together, which CNNs have and ViT mostly lacks. Trained on ImageNet, about 1.3 million images, ViT scores a few points below CNNs of similar size. With ImageNet-21k (14 million images) the gap closes, and with JFT-300M (303 million images) ViT pulls ahead. Tests on 9-million to 300-million-image subsets show ViT overfits small data more but wins from 90 million up.

After pre-training on lots of data, then fine-tuning, meaning extra training on a smaller target task, the main results are: The best model reaches 88.55% on ImageNet, 94.55% on CIFAR-100, and 77.63% across 19 VTAB tasks. It used 2.5k TPU core-days to pre-train, against 9.9k for the strongest CNN rival, BiT-L. In a controlled scaling study, ViT needed about 2 to 4 times less compute for the same accuracy, and showed no sign of levelling off.

Looking inside, the position codes learn the image's 2D layout by themselves, so nearby patches get similar codes. Some attention heads look across most of the image even in the first layers, while others stay local, rather like early CNN layers.

The authors note that training efficiency may also depend on choices like schedule and optimiser, not only the design. Self-supervised pre-training, learning by guessing hidden patches without labels, reached 79.9% on ImageNet, still 4% behind labelled pre-training. Applying ViT to tasks like finding and outlining objects remains to be done.

The conclusion is that a standard Transformer, treating an image as a sequence of patches, matches or beats top CNNs when pre-trained on large datasets. It does so while being relatively cheap to pre-train, and the authors expect further scaling to help.

## P16

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This review explains a math tool for studying how groups of neurons combine the signals they receive. The tool is called partial information decomposition, or PID. The authors give a beginner-friendly introduction, then show what it revealed in their own and others' experiments.

Brains take in signals from the world and turn them into useful behavior, but how circuits transform those signals is poorly understood. Two things held this research back: too little data, and too few ways to analyze it. New recording methods now capture hundreds or thousands of neurons at once, so the analysis problem is what remains.

Older measures can track information moving between neurons. One, transfer entropy, asks how much one neuron's past helps predict another's next moment, beyond what that neuron's own past already tells us. But such measures miss how two incoming streams interact. PID splits what two input neurons tell us about a target into three kinds: redundant (either input alone tells it), unique (only one input tells it), and synergistic. Synergy is information you only get from both inputs' joint pattern, and the authors treat it as a sign of real processing.

In their main experiments, the authors grew thin slices of mouse cortex in dishes and recorded hundreds of neurons with 512-electrode arrays. They mapped which neurons influence which, finding about 0.4 to 1.0% of possible links were significant. They then ran PID on thousands of triads: two source neurons feeding one target.

Several patterns showed where synergy is found. Synergy rose with the flow of information into a triad, and was reliably about a quarter of that flow. Triads in the rich club, the best-connected neurons that link heavily to each other, had 2.7 times more synergy and held about 88% of all synergy, despite containing under 40% of neurons. Triads with two links between the source neurons had 50% more synergy, while two links from target back to sources meant 10% less.

Synergy also grew when the two inputs fired more alike, but only up to a point. It peaked when their shared information was about 7% of the maximum; beyond that, the overlap became redundant instead. In monkeys doing a reaching task, activity was mostly synergistic, but redundancy rose sharply during movement. The authors suggest the brain may repeat the move signal many times to send it reliably.

The authors name several limits. Their networks were built from two-neuron-at-a-time measures that overstate links, and dish cultures face different demands than a behaving animal's brain. PID finds statistical patterns but does not explain the biology behind them. With more inputs, the pieces explode in number: six inputs give 7,828,354, mostly hard to interpret.

The main conclusion is that neurons do not simply add up their inputs; they also respond to particular input patterns. That processing depends on a neuron's place in its network and on what the animal is doing.

### Summary B

This review asks how groups of brain cells actually process information, not just pass it along. It gives a beginner-friendly guide to a maths tool called partial information decomposition, or PID, and shows what it has found in real neurons. The authors draw mostly on their own studies and add their view of where the field should go.

The authors call understanding how brains process information a grand challenge of modern neuroscience. Two things held this work back. One was a lack of data, now eased by tools that record hundreds or thousands of neurons at once. The other was a lack of ways to analyse that data, which is the gap PID helps fill.

Older measures track how activity spreads from one neuron to another. The main one, transfer entropy, asks how much a source neuron's past helps predict a target's next step, beyond the target's own past. PID goes further by splitting what two source neurons tell us about a target into parts. Redundant information comes from either source, unique information from only one, and synergistic information only from both sources' joint pattern. The authors treat synergy as a sign of real processing, or computation.

In their lab work, the team grew slices of mouse brain cortex and recorded hundreds of neurons on 512-electrode grids. They mapped who drives whom using transfer entropy, finding about 0.4 to 1.0% of possible links significant. They then ran PID on thousands of triads: two source neurons feeding one target. Across 25 recordings, synergy rose with information flow and was reliably about a quarter of a triad's transfer entropy.

Three further patterns showed where synergy gathers. Triads inside the rich club, a core of best-connected neurons, had 2.7 times the synergy and held about 88% of it, despite under 40% of neurons. Triads with two links between the sources had 50% more synergy, while two links back from the target meant 10% less. Synergy grew as the two sources' activity became more alike, but peaked when that likeness reached about 7% of its maximum, then fell.

A study of three monkeys doing a reach-and-grasp task repeated many of these results in living animals. Activity was mostly synergy-led, but redundancy rose sharply during movement. The authors suggest the brain may copy the move signal many times so it reaches the muscles reliably.

The authors name clear limits. The slice studies used a two-neuron method known to overstate links, and brain slices in a dish do not face a behaving animal's demands. With six source neurons, PID yields 7,828,354 parts, so fully describing a real neuron is out of reach. PID also spots statistical patterns without explaining the biology that causes them.

The main conclusion is that neurons do not simply add up their inputs; they respond to the patterns those inputs form. How much synergy appears depends on a neuron's place in the network and on what the animal is doing.

## P17

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This review article asks when it helps to have strong "cognitive control": the brain's ability to stay on a goal, follow rules and block distractions. This ability is thought to depend heavily on the prefrontal cortex (PFC), the front part of the brain. The authors draw together research on learning and on creative thinking to propose a new idea, the Matched Filter Hypothesis.

It matters because cognitive control is usually seen as always good, yet growing evidence shows not all complex thinking benefits from it. One example is a choice task where one option pays off 75% of the time. Adults pick it 75% of the time and succeed about 62.5% of the time, while children pick it every time and succeed 75% of the time. Some research links the adult pattern to control processes, so control may actually hurt here.

The authors picture control as a filter that weakens or throws away incoming information, ideally the useless parts. Their hypothesis says performance is best when the strength of filtering matches what the task needs, not when control is simply high. Strong control should suit explicit, rule-based, abstract tasks that fit within working memory, the small amount we can hold in mind at once. "Hypofrontality", meaning reduced PFC activity, should suit implicit, stimulus-driven tasks too complex for working memory. Which state wins depends on competition between the PFC and other brain regions, shaped by age, brain health and individual differences.

In learning, the authors cite several cases where less control seems to help. Doing a second task at the same time helps adults learn rules that are hard to put into words, such as motor sequences. Disrupting part of the PFC with magnetic pulses through the scalp has been linked to better implicit motor learning. Children show less of the attention-based distortions in how cues are learned: 3-year-olds less than 4-year-olds, and 8- and 9-year-olds less than adults. Learning an artificial language from inconsistent input, children produce only the most frequent form, while adults copy the noise.

The authors also point to rival learning systems: a PFC-linked system for explicit rules and a deeper system, the striatum, for habits. Fitting this, people with lower working memory learn hard-to-describe category boundaries better than high-capacity people. Their general claim is that control buys quick accuracy now at a cost to complete, accurate learning later.

For creativity, people thinking up unusual uses for objects showed lower PFC activity and more activity in visual regions. Weak electrical currents that dampen the left PFC made people faster and more productive at inventing creative uses, but not at control tasks. Children also resist "functional fixedness", getting stuck on an object's usual use, better than adults, though no study ties this to PFC development. Still, judging whether an idea works likely needs control again, so creativity may involve rapid switching between states.

The authors name clear limits. The exact brain mechanisms that set the filter are not yet specified. Some PFC function is essential for some learning, and the PFC link to cue-learning distortions still needs testing in adults. Creativity studies are few, and patient results are inconsistent.

The main conclusion is that cognitive control is a tool suited to a subset of common challenges, not an all-purpose system for every problem. Its failures can have real advantages, especially for learning and creative thinking.

### Summary B

This article is a theory paper that reviews research on cognitive control: the brain's ability to stay on goal, follow rules and ignore distractions. It focuses on the prefrontal cortex, the front part of the brain, which is thought to work like a filter that turns down unhelpful information. The authors propose a Matched Filter Hypothesis: a task goes best when the amount of filtering fits what that task needs, not simply when filtering is strongest.

The prefrontal cortex is usually seen as essential for complex behaviour, yet a growing body of research suggests not all complex thinking benefits from its control. Children, whose prefrontal cortex matures late, sometimes beat adults. In a choice task where one option pays off 75% of the time, adults pick it 75% of the time and so win about 62.5% of the time. Children pick it every time and win 75%, and some research links the weaker adult strategy to cognitive control itself.

The hypothesis predicts which tasks suit which brain state. Strong control helps tasks that are rule-based, explicit, verbal or abstract, and that fit in working memory, the small amount we can hold in mind at once. Hypofrontality, meaning reduced prefrontal activity, helps tasks that are driven by the input, intuitive, and too complex for working memory. How well the filter matches a task may depend on age, genes, brain damage, doing a second task at once, or brain stimulation.

In learning, the authors gather several findings where less control helped. Adults doing a distracting second task at the same time better learned rules that are hard to put into words, such as movement sequences. Disrupting part of the prefrontal cortex with magnetic stimulation was linked to better learning of movements without awareness. Learning a made-up language from inconsistent input, adults copied the inconsistency, while children used only the most frequent form. After training to judge pictures by category, adults' memory for the pictures fell to chance, but children's did not.

The authors suggest control often buys quick accuracy at a later cost. In blocking, a link learned first stops people learning a newer cue that predicts the same outcome. Adults learn to look away from such cues, which cuts errors fast but distorts what they learn. The authors also cite evidence that a prefrontal rule-learning system competes with a habit-learning system deeper in the brain. For example, people with lower working memory learned category boundaries that cannot be put into words better than high-capacity people.

For creativity, adults thinking of unusual uses for objects, like a belt as a tourniquet, showed lower prefrontal activity and higher activity in visual areas. A weak electric current that dampened the left prefrontal cortex made people faster and more productive at this, but not at control tasks. Children also resist functional fixedness, the adult habit of seeing an object only by its usual use, such as a box as just a container. Studies of patients with left frontal damage, however, give mixed results.

The authors name clear limits. Judging whether a new idea is any good probably still needs control, with the brain switching back and forth many times. Some prefrontal function is essential for relearning when rules flip, so less control does not steadily mean better learning. Some links rest only on child studies and need testing in adults, and the exact brain mechanisms remain unknown.

The main conclusion is that cognitive control is a tool fitted to some common problems, not an all-purpose system suited to every task. The authors suggest the same idea may extend to decision making and to managing emotions.

## P18

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This review asks how groups of brain cells actually process information, not just pass it along. It gives a beginner-friendly guide to a maths tool called partial information decomposition, or PID, and shows what it has found in real neurons. The authors draw mostly on their own studies and add their view of where the field should go.

The authors call understanding how brains process information a grand challenge of modern neuroscience. Two things held this work back. One was a lack of data, now eased by tools that record hundreds or thousands of neurons at once. The other was a lack of ways to analyse that data, which is the gap PID helps fill.

Older measures track how activity spreads from one neuron to another. The main one, transfer entropy, asks how much a source neuron's past helps predict a target's next step, beyond the target's own past. PID goes further by splitting what two source neurons tell us about a target into parts. Redundant information comes from either source, unique information from only one, and synergistic information only from both sources' joint pattern. The authors treat synergy as a sign of real processing, or computation.

In their lab work, the team grew slices of mouse brain cortex and recorded hundreds of neurons on 512-electrode grids. They mapped who drives whom using transfer entropy, finding about 0.4 to 1.0% of possible links significant. They then ran PID on thousands of triads: two source neurons feeding one target. Across 25 recordings, synergy rose with information flow and was reliably about a quarter of a triad's transfer entropy.

Three further patterns showed where synergy gathers. Triads inside the rich club, a core of best-connected neurons, had 2.7 times the synergy and held about 88% of it, despite under 40% of neurons. Triads with two links between the sources had 50% more synergy, while two links back from the target meant 10% less. Synergy grew as the two sources' activity became more alike, but peaked when that likeness reached about 7% of its maximum, then fell.

A study of three monkeys doing a reach-and-grasp task repeated many of these results in living animals. Activity was mostly synergy-led, but redundancy rose sharply during movement. The authors suggest the brain may copy the move signal many times so it reaches the muscles reliably.

The authors name clear limits. The slice studies used a two-neuron method known to overstate links, and brain slices in a dish do not face a behaving animal's demands. With six source neurons, PID yields 7,828,354 parts, so fully describing a real neuron is out of reach. PID also spots statistical patterns without explaining the biology that causes them.

The main conclusion is that neurons do not simply add up their inputs; they respond to the patterns those inputs form. How much synergy appears depends on a neuron's place in the network and on what the animal is doing.

### Summary B

This review asks how groups of brain cells actually combine and transform the signals they receive. It introduces a math tool called partial information decomposition (PID), which splits the information several input neurons give about one target neuron into separate kinds. The authors aim it at readers inside and outside neuroscience, and they draw mostly on their own studies.

The authors call discovering how brains "process information" a grand challenge, since it is still poorly understood. Two things held this work back. Until recently there was too little data, but new recording methods now capture hundreds or thousands of neurons at once. There was also no good way to analyse such data, and the review presents PID as a partial answer.

Two older measures track how activity spreads between two neurons: mutual information, how much they fire in step, and transfer entropy, how much one's past predicts the other's future. PID goes further by asking how two inputs together inform a target. Redundant information is what either input alone would reveal, unique information comes from only one, and synergistic information appears only from both inputs' joint pattern. Ordinary information theory cannot fix these parts on its own, so analysts must pick a "redundancy measure", and about a dozen competing ones exist.

In their main studies, the authors grew thin slices of mouse cortex in dishes and recorded hundreds of neurons with 512-electrode arrays. They used transfer entropy to map which neurons drive which, finding only about 0.4 to 1.0 percent of possible links significant. They then ran PID on thousands of "triads": two source neurons both feeding one target.

Several patterns showed which triads carry the most synergy. Synergy was reliably about a quarter of the information flowing from sources to target, across 25 recordings. Triads in the "rich club", the best-connected, tightly linked core neurons, had 2.7 times more synergy; under 40 percent of neurons produced about 88 percent of all synergy. Triads with two links between the source neurons had 50 percent more synergy, while two links from target back to sources meant 10 percent less.

Synergy also depended on how alike the two inputs fired. It rose with similarity only up to a peak, at about 7 percent of the maximum possible shared information, then fell. Past that point, the shared signal seems to become redundant and to crowd out synergy.

A study in three monkeys doing a reaching task repeated key results, including a rich club and higher synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during movement, perhaps to send the "move" signal reliably to muscles.

The authors name limits: the culture work used pairwise maps known to overstate links, and dishes differ from living, behaving animals. PID shows statistical patterns, not the biological mechanisms behind them. It also scales badly, since six inputs already give 7,828,354 parts to sort out.

The main conclusion is that neurons do not simply add up inputs; they respond to particular patterns of them. This synergy is shaped by a neuron's network surroundings and the animal's behaviour, and the authors see extensions to moment-by-moment and multi-target analyses as promising next steps.

## P19

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This review explains how one tool from information theory can show how groups of neurons combine their inputs. The tool is partial information decomposition (PID), which splits what several inputs tell you about an output into separate kinds of information. It is an approachable overview, not an exhaustive survey, and it draws mainly on the authors' own recent studies.

The authors call understanding how brains "process information" a grand challenge for neuroscience. New recording methods now capture hundreds or thousands of neurons at sub-millisecond precision, so data is less scarce, but analysis methods have lagged. Transfer entropy measures how much one neuron's past helps predict another's next step, beyond what the target's own past already says. Mutual information and transfer entropy track how information flows, but not how separate streams interact to make something new.

Take two input neurons feeding one target, a group the authors call a triad. PID splits what they tell you about the target into redundant information (either input alone reveals it), unique information (only one does), and synergistic information. Synergy is information visible only in the two inputs' joint pattern, and the authors treat it as a measure of computation. Standard information theory leaves this split underdetermined, so you must pick a redundancy measure. About a dozen compete; most studies here used the original one, which has been criticized.

The authors recorded hundreds of neurons in slices of mouse cortex grown in dishes, mapped connections with transfer entropy, and ran PID on thousands of triads. Synergy tracked the information flowing into each triad, reliably running at about a quarter of the triad's transfer entropy. Rich clubs are tightly interlinked hubs of the best-connected neurons; triads inside them had 2.7 times the synergy of triads outside. Though under 40% of neurons were in the rich club, its triads produced about 88% of all synergy.

Wiring mattered too: triads with two links between the inputs had 50% more synergy than the simplest triads. Links from the target back to the inputs were not reliably related to synergy. Synergy rose as the two inputs' activity grew more alike, but peaked when their mutual information reached about 7% of its maximum. Past that point, redundancy kept rising and synergy fell, as if overly similar inputs just repeat each other.

A related study recorded motor areas in three macaque monkeys performing a task with recognition, planning, memory and movement phases. It repeated the rich club result and the extra synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during reaching and grasping, possibly to send the move signal reliably.

The authors name real limits. Simple pairwise transfer entropy overstates connections, and dish cultures may not behave like circuits in a living, behaving animal. PID finds statistical patterns, not the biological mechanisms behind them. It also scales badly: with six inputs there are 7,828,354 separate pieces of information, most hard to interpret.

The main conclusion is that neurons do not simply add up their inputs and fire past a threshold; they respond to particular input patterns. How much synergy they produce depends on their place in the network and on what the animal is doing. The authors point to moment-by-moment and multi-target versions of PID as promising next steps.

### Summary B

This review explains how a method called partial information decomposition (PID) can show how single neurons combine signals arriving from several inputs. It mixes a tutorial on the method with the authors' own lab results and a short look at future directions.

The authors call working out how brains process information a grand challenge of modern neuroscience. Two things held the field back: too little data, and too few ways to analyse it. New recording gear now captures hundreds or thousands of neurons at sub-millisecond resolution, which has largely eased the data problem. Transfer entropy, which measures how much one neuron's past predicts another's next state beyond that neuron's own past, tracks flow but not how input streams interact.

PID takes the information two input neurons jointly carry about a target neuron and splits it into parts. Redundant information could come from either input, unique information from only one, and synergistic information only from both inputs seen together. The authors treat synergy as their measure of real processing, or computation, by the target neuron. Standard information theory leaves this split underdetermined, with three known quantities and four unknowns, so a formula for redundancy must be chosen. About a dozen formulas compete; most studies here used the original one, Imin, which critics say behaves unintuitively.

The main evidence comes from organotypic cultures: slices of mouse cortex kept alive in nutrient fluid so their natural wiring patterns return. A 512-channel electrode array recorded hundreds of single neurons at millisecond precision. Transfer entropy mapped which neurons drive which, and only about 0.4–1.0% of possible connections were significant. The team then ran PID on each of thousands of triads: two source neurons feeding one common target.

Across these triads, three patterns stood out. Synergy rose with how much information flowed from sources to target, and was reliably about a quarter of that flow across 25 recordings. Triads in the rich club, the best-connected neurons that link to each other more than chance predicts, had 2.7 times the synergy and held about 88% of it. Two recurrent links, running between the two sources, meant 50% more synergy, while two feedback links from target to sources meant 10% less.

The authors also asked whether similar inputs boost synergy. At synaptic timescales, under 14 ms, more shared information between the two sources meant more synergy. Over time windows up to 2.25 s, synergy peaked when that shared information reached about 7% of its maximum, then fell. Redundancy kept rising instead, suggesting that inputs past a certain similarity simply repeat each other.

Later work by Varley and colleagues applied PID to motor-area recordings from three macaques doing a reaching task with planning and memory stages. Using a stricter, multivariate form of transfer entropy, it again found a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during the reach-and-grasp movement. The authors read this as the brain copying the move signal many times to make transmission reliable.

The culture networks were built with pairwise transfer entropy, which overstates connections, and cultures face different demands than a behaving animal. PID also reveals statistical patterns, not the biological mechanisms that cause them. Its parts multiply fast with more inputs: six input neurons already give 7,828,354 distinct pieces. Still, the authors conclude that neurons do not just add up inputs; they respond to input patterns, shaped by network position and behaviour.

## P20

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This review article proposes a new idea about cognitive control: the brain's ability to stay on a goal by holding back distractions and habits. This ability is linked to the prefrontal cortex, the front part of the brain. The authors describe control as a filter that turns down or throws away some incoming information. They call their idea the Matched Filter Hypothesis: tasks go best when the amount of filtering matches what the task needs.

It matters because a growing body of research suggests more control is not always better. In one guessing task, one choice pays off 75% of the time. Adults pick it 75% of the time and win about 62.5% overall, while children pick it every time and win 75%. Some research links the adult habit to control, so here control may actually hurt.

The hypothesis sorts tasks into two kinds. High control suits tasks with clear rules, words or abstract ideas that fit in working memory, the small amount we can hold in mind at once. Low control suits tasks driven by what we sense, learned through reward or intuition, and too complex for working memory. How well a person matches control to a task may depend on age, genes, brain damage, or a brief disruption of the brain.

The first body of evidence comes from learning, where reduced frontal activity sometimes helps. Doing a second task at the same time helps adults learn rules they cannot put into words, and so does disrupting the front brain with magnetic pulses. Three-year-olds are less likely than four-year-olds to ignore a cue just because an earlier cue already predicted the outcome. Learning a made-up language from messy input, children keep only the most common form, while adults copy the noise.

The authors argue that control often buys quick accuracy now at a cost later. Ignoring some information cuts errors fast, but the ignored details are learned badly or forgotten. They also point to rival learning systems: one learns explicit rules using the frontal brain, another builds habits deep in the brain. Adults with low working memory learn hard-to-describe category boundaries better than high-memory adults.

The second body of evidence comes from creativity. People thinking up unusual uses for objects showed lower frontal activity and more activity in visual areas. A weak current that dampened the left front brain made people faster and produced more such uses. Children also get stuck less than adults on an object's usual purpose when solving puzzles. Still, judging whether an idea works likely needs control again, with the brain switching back and forth.

The authors name several limits. Children differ from adults in knowledge and other brain areas, so their advantages cannot be blamed on weak frontal activity alone. Some frontal function is essential, for example for relearning when rules flip, so less is not simply better. Creativity studies are few, patient results are mixed, and the brain mechanisms remain unspecified.

The main conclusion is that cognitive control is a tool fitted to some common problems, not a system that improves every task. Its failures, the authors argue, can bring real advantages in learning and creative thinking.

### Summary B

This review article asks when it helps to have strong "cognitive control": the brain's ability to stay on a goal, follow rules and block distractions. This ability is thought to depend heavily on the prefrontal cortex (PFC), the front part of the brain. The authors draw together research on learning and on creative thinking to propose a new idea, the Matched Filter Hypothesis.

It matters because cognitive control is usually seen as always good, yet growing evidence shows not all complex thinking benefits from it. One example is a choice task where one option pays off 75% of the time. Adults pick it 75% of the time and succeed about 62.5% of the time, while children pick it every time and succeed 75% of the time. Some research links the adult pattern to control processes, so control may actually hurt here.

The authors picture control as a filter that weakens or throws away incoming information, ideally the useless parts. Their hypothesis says performance is best when the strength of filtering matches what the task needs, not when control is simply high. Strong control should suit explicit, rule-based, abstract tasks that fit within working memory, the small amount we can hold in mind at once. "Hypofrontality", meaning reduced PFC activity, should suit implicit, stimulus-driven tasks too complex for working memory. Which state wins depends on competition between the PFC and other brain regions, shaped by age, brain health and individual differences.

In learning, the authors cite several cases where less control seems to help. Doing a second task at the same time helps adults learn rules that are hard to put into words, such as motor sequences. Disrupting part of the PFC with magnetic pulses through the scalp has been linked to better implicit motor learning. Children show less of the attention-based distortions in how cues are learned: 3-year-olds less than 4-year-olds, and 8- and 9-year-olds less than adults. Learning an artificial language from inconsistent input, children produce only the most frequent form, while adults copy the noise.

The authors also point to rival learning systems: a PFC-linked system for explicit rules and a deeper system, the striatum, for habits. Fitting this, people with lower working memory learn hard-to-describe category boundaries better than high-capacity people. Their general claim is that control buys quick accuracy now at a cost to complete, accurate learning later.

For creativity, people thinking up unusual uses for objects showed lower PFC activity and more activity in visual regions. Weak electrical currents that dampen the left PFC made people faster and more productive at inventing creative uses, but not at control tasks. Children also resist "functional fixedness", getting stuck on an object's usual use, better than adults, though no study ties this to PFC development. Still, judging whether an idea works likely needs control again, so creativity may involve rapid switching between states.

The authors name clear limits. The exact brain mechanisms that set the filter are not yet specified. Some PFC function is essential for some learning, and the PFC link to cue-learning distortions still needs testing in adults. Creativity studies are few, and patient results are inconsistent.

The main conclusion is that cognitive control is a tool suited to a subset of common challenges, not an all-purpose system for every problem. Its failures can have real advantages, especially for learning and creative thinking.

## P21

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a lab experiment in rats about rearing, when a rat stops and stands up on its hind legs to look and sniff around. The authors asked whether activity in the dorsal hippocampus, the upper part of a brain area needed for remembering places, matters during these moments. They hypothesized that rearing is a time when the hippocampus stores, or encodes, spatial memories.

Most research on how the hippocampus supports memory has looked at two states: walking around, and quiet rest such as grooming or eating. Rearing is common but little studied, even though it lets an animal take in more of distant cues and rises in new places. Rearing also comes with stronger 'high theta', a 7–12 Hz brain rhythm tied to memory, yet whether rearing matters for memory was unknown.

Rats learned a maze task called the delayed win-shift task, on a maze with eight arms spreading from a central hub. In the study phase, four random arms opened and held food; after a 4-minute delay, all eight opened, but only the four new arms held food. Memory was scored as percent correct, meaning how many of the first four choices had food, and as total arm entries needed to find all food.

To silence the hippocampus, the team used optogenetics: a virus made neurons carry halorhodopsin, a protein that shuts neurons down when light shines on them. A ceiling-mounted 3D camera detected rearing and switched on a laser through fibers implanted in the brain. Each rat ran three conditions: 'Off' with no light, 'Rear' with light during each rear, and 'Delay' with light of the same length starting 6 seconds late. Light was given only in the study phase, and a control group got a virus without halorhodopsin, to rule out effects of the light itself.

The main results compared each condition with 'Off'. In rats with halorhodopsin, 'Rear' lowered percent correct from 77.7% to 65.7%, a significant drop. Those rats also needed more arm entries on 'Rear' trials, 6.5 versus 5.1. Control rats showed no significant change, at 81.4% versus 83% correct. 'Delay' gave 72.0% correct, not a significant drop, and only a borderline rise in arm entries, 5.9 versus 5.1.

The authors name several limits, starting with the fact that the 6-second delay still overlapped about 35.5% of rearing time. Nearly all rears in the narrow arms were 'supported', with a paw on a wall, so the study cannot compare supported and free-standing rearing. It also cannot say whether every rear matters, or whether the same memory storing could happen during similar behaviors, such as side-to-side head scanning.

As a possible explanation, the authors suggest that silencing may have blocked updating of the rat's inner model of its surroundings. Because the rats knew the room well, this updating was likely about today's trial, like remembering where you parked your car today.

The authors conclude that dorsal hippocampus activity during rearing can be important for spatial memory, making rearing a time of memory storing. They say this directly supports an earlier idea that rearing can serve as a measure of hippocampal learning.

### Summary B

This is a lab experiment on rats that asks one question. Does the hippocampus, a brain area needed for spatial memory, have to be working while a rat stands up on its hind legs? Standing up like this is called rearing, and the authors call it a form of attentive sampling: stopping to look and sniff around. Their idea was that rearing is a moment when the hippocampus stores, or encodes, spatial memories.

Most research on how the hippocampus supports spatial memory looks at times when animals walk or rest quietly. Rearing is common but barely studied, even though it lets an animal take in more of its surroundings, especially distant landmarks. Rearing also comes with a strong brain rhythm called theta, which earlier work links to forming and recalling memories. Still, no one had tested whether rearing actually matters for spatial memory.

Rats learned a task on a maze with eight arms, each with food at the end. In a study phase, only four arms opened; after a four-minute break, all eight opened, but food sat only in the four new arms. Memory was scored two ways: how many of the first four choices found food, and how many arm visits it took to find all four rewards.

The researchers used optogenetics: a virus made hippocampus cells carry a light-sensitive protein, halorhodopsin, that silences them when laser light shines through implanted fibres. A 3D ceiling camera spotted rearing in real time and switched the laser on, only during the study phase. Each rat ran three conditions: Off, with no light; Rear, with light during each rear; and Delay, with the same amount of light starting six seconds late. A control group got a virus without halorhodopsin, so light alone could not silence their cells.

The main results, from 6 experimental and 7 control rats, were these. Silencing during rearing cut correct choices from 77.7% to 65.7%, a statistically reliable drop. The same rats needed more arm visits to find all the food, 6.5 instead of 5.1. Control rats showed no change with the light, ruling out effects like heat or the light being distracting. The Delay condition caused no reliable drop in correct choices (72.0%), only a borderline rise in arm visits to 5.9.

The authors name several limits. The six-second delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time. Nearly all rears in the narrow maze had a paw on the wall, so the work cannot compare supported and unsupported rearing. It also cannot say whether every rear matters, or whether similar encoding could happen during other looking-around behaviours, such as side-to-side head scanning.

Why might silencing hurt memory? The authors suggest rearing may help the brain update its internal map of the surroundings. Because the rats already knew the maze well, any updating was likely about that day's events, like remembering where you parked today.

The authors conclude that hippocampus activity during rearing is important for spatial memory in this task. They argue rearing is a moment when the hippocampus encodes spatial memories, not just an idle pause.

## P22

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This research paper asks whether a Transformer, a type of neural network that has become standard for language tasks, can recognise images with almost no changes. Instead of reading words, the model reads an image cut into small square patches, such as 16 by 16 pixels, and treats each patch like a word. The authors call it the Vision Transformer, or ViT, and test it on image classification: naming what an image shows.

In language, Transformers have grown past 100 billion parameters, the adjustable numbers inside a model, with no sign of performance levelling off. In vision, convolutional networks, or CNNs, still dominate, and the classic ResNet design remained the best for large-scale image recognition. Earlier attempts to bring attention into vision used special patterns that were hard to run efficiently on modern hardware. The paper sets out to show that this reliance on CNNs is not necessary.

Each patch is flattened into a list of numbers and turned into a fixed-length vector by a learned step. An extra learned item, the "classification token", joins the sequence of patches, and its final state is used to give the answer. The core operation, self-attention, lets every patch draw information from every other patch in the image. Unlike CNNs, ViT has little inductive bias: few built-in assumptions about images, such as nearby pixels belonging together. So it must learn how patches relate in space from scratch.

The authors first pre-train each model, meaning they train it on a large labelled image collection. They then fine-tune it, meaning they train it further on a smaller target task. They use three collections of growing size: ImageNet with 1.3 million images, ImageNet-21k with 14 million, and Google's in-house JFT-300M with 303 million. The main rivals are slightly modified ResNets, plus hybrids that feed a CNN's output into a Transformer.

The central question is how much training data ViT needs, and three results point the same way. Pre-trained only on ImageNet, ViT scores a few percentage points below ResNets of similar size, and larger ViT models do worse than smaller ones. With ImageNet-21k, large and small ViT models perform about the same, and only with JFT-300M do larger models show their full benefit and overtake ResNets. Trained on random parts of JFT-300M, ViT does much worse than a ResNet of similar cost with 9 million images, but better with 90 million or more.

Pre-trained on JFT-300M, the largest model, ViT-H/14, reaches 88.55% accuracy on ImageNet. It also scores 77.63% on VTAB, a set of 19 varied tasks with only 1,000 training examples each. Its pre-training took 2.5 thousand TPUv3-core-days, a measure of processor cores times days, against 9.9 thousand for the strongest earlier large ResNet. In a controlled comparison, ViT needed about 2 to 4 times less compute than ResNets to reach the same performance. The authors caution that training schedule, optimiser and similar settings may also affect this efficiency, not only the design.

Looking inside, some attention heads, the parallel attention units in each layer, already look across most of the image in the first layers. The paper names open problems, starting with trying ViT on other vision tasks such as detecting objects. A first try at self-supervised pre-training, where the model learns by guessing hidden patches without labels, reached 79.9% on ImageNet. That is still 4 points behind pre-training with labels, a gap the authors call large.

The authors conclude that large-scale training trumps inductive bias. A plain Transformer reading image patches matches or beats the best models on many image classification datasets, while being relatively cheap to pre-train. Because ViT showed no sign of levelling off in the sizes tried, they expect further scaling would likely improve it.

### Summary B

This research paper asks whether a standard Transformer can recognise what is in an image without help from convolutional networks. A Transformer is a neural network design built on attention, where each piece of the input weighs up every other piece. Convolutional networks, or CNNs, are the usual design for images; they scan a picture with small local filters. The authors call their model the Vision Transformer, or ViT.

The paper's reason is that Transformers have taken over language processing. There, models are first trained on huge text collections and have grown past 100 billion parameters with no sign of levelling off. In vision, CNNs still lead. Earlier attempts to bring attention to images used special patterns that were hard to run fast on modern chips.

The method changes the standard Transformer as little as possible. The image is cut into square patches, for example 16 by 16 pixels, and each patch is treated like a word in a sentence. Each patch is flattened into a list of numbers and turned into a fixed-length vector, called a patch embedding. An extra learned classification token is added to the sequence, and its final output is used to give the image's label. The model is pre-trained on a large labelled dataset, then fine-tuned, meaning briefly retrained, on a smaller target task.

A key idea is inductive bias: assumptions built into a design before it sees any data. CNNs assume nearby pixels belong together and that a shifted object should give a shifted response. ViT has far fewer such assumptions; even its position embeddings, the numbers marking where each patch sat, start out knowing nothing about the 2D layout. Trained on ImageNet alone, about 1.3 million photos, ViT lands a few percentage points below similar-sized ResNets, a common kind of CNN.

To test how much data matters, the authors pre-trained on ImageNet, on ImageNet-21k with 14 million images, and on Google's in-house JFT-300M with 303 million. On ImageNet, larger ViT models did worse than smaller ones; on ImageNet-21k they were similar; only on JFT-300M did size pay off. On random slices of JFT, ViT-B/32 did much worse than ResNet50 with 9 million images, but better from 90 million up.

Pre-trained on JFT-300M, the largest model, ViT-H/14, reaches 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB, a suite of 19 varied tasks. It needed 2,500 TPUv3-core-days of computing time, against 9,900 for BiT-L, the best earlier CNN approach. The authors note that training schedule, optimizer and other settings, not only the design, may affect this efficiency.

In a controlled comparison of 18 models, ViT needed about 2 to 4 times less compute than ResNets for the same accuracy, and showed no sign of levelling off. Looking inside, the position embeddings learned the image's rows and columns by themselves. Some attention heads looked across most of the image even in the first layers, and the distance attended grew with depth.

The paper admits gaps. A first try at self-supervised training, where the model learns by guessing hidden patches without labels, reached 79.9% on ImageNet. That is 2% better than no pre-training but 4% behind supervised pre-training, and tasks like finding objects in images remain untested. The main conclusion: this simple approach works surprisingly well with pre-training on large datasets, matching or beating top CNNs while being relatively cheap to pre-train.

## P23

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a review and theory paper about cognitive control: the brain's ability to steer thinking toward a goal and screen out distractions. The authors say this control comes mainly from the prefrontal cortex, the front part of the brain, which works like a filter on incoming information. They propose the Matched Filter Hypothesis, borrowing a term for a filter that best pulls a signal out of noise. Its claim is that performance is best when the amount of control matches what the task needs, not when control is simply high.

The prefrontal cortex is usually seen as essential for complex thought, and research on children mostly treats their weak control as a deficit. Yet a growing body of work shows that not all complex thinking benefits from control. In one guessing game, an option pays off 75% of the time. Adults pick it 75% of the time and win about 62.5%, while children pick it always and win 75%.

High control should help with tasks that are explicit, rule-based, verbal or abstract, and that fit in working memory, the small space for holding things in mind. Low control, which the authors call hypofrontality, should help with tasks that are implicit, driven by what you see, and too complex for working memory. How well the match works may depend on age, genes, brain damage, or short-term disruption such as a second task or brain stimulation. Some limits are fixed by biology, but people may sometimes shift their level of control through training, stimulation or drugs.

The learning evidence comes from earlier studies the authors bring together. Doing a second task at the same time helps adults learn rules they cannot put into words, and magnetic disruption of the prefrontal cortex improved hidden motor learning. Adults steer attention away from some cues to cut errors fast, which distorts what they learn; 3-year-olds show less of this than 4-year-olds. Given messy language input, adults copy the noise, while children produce only the most common form and so outperform adults.

For creativity, people thinking up unusual uses for objects showed less prefrontal activity and more activity in visual areas. Mild electric stimulation that dampened the left prefrontal cortex made people produce creative uses faster and in greater numbers. Jazz musicians showed low prefrontal activity while improvising, but not while playing well-practised pieces. Children also get stuck less than adults on seeing an object only by its usual use, though no study has yet tied this to brain development.

The authors admit direct evidence in adults is sparse, and children's advantages could come from other differences, such as knowledge or strategies. Studies of creativity are few, and some results conflict. Judging whether a new idea actually works likely needs the prefrontal cortex again, so creative work may switch back and forth between states. The exact brain mechanisms that set the right level of control remain unknown.

The unifying point is that filtering input always has a cost: it can speed up correct responses now but lose detail needed later. The authors conclude that cognitive control is a tool suited to some common challenges, not an all-purpose system that improves every task.

### Summary B

This article is a theory paper that reviews research on cognitive control: the brain's ability to stay on goal, follow rules and ignore distractions. It focuses on the prefrontal cortex, the front part of the brain, which is thought to work like a filter that turns down unhelpful information. The authors propose a Matched Filter Hypothesis: a task goes best when the amount of filtering fits what that task needs, not simply when filtering is strongest.

The prefrontal cortex is usually seen as essential for complex behaviour, yet a growing body of research suggests not all complex thinking benefits from its control. Children, whose prefrontal cortex matures late, sometimes beat adults. In a choice task where one option pays off 75% of the time, adults pick it 75% of the time and so win about 62.5% of the time. Children pick it every time and win 75%, and some research links the weaker adult strategy to cognitive control itself.

The hypothesis predicts which tasks suit which brain state. Strong control helps tasks that are rule-based, explicit, verbal or abstract, and that fit in working memory, the small amount we can hold in mind at once. Hypofrontality, meaning reduced prefrontal activity, helps tasks that are driven by the input, intuitive, and too complex for working memory. How well the filter matches a task may depend on age, genes, brain damage, doing a second task at once, or brain stimulation.

In learning, the authors gather several findings where less control helped. Adults doing a distracting second task at the same time better learned rules that are hard to put into words, such as movement sequences. Disrupting part of the prefrontal cortex with magnetic stimulation was linked to better learning of movements without awareness. Learning a made-up language from inconsistent input, adults copied the inconsistency, while children used only the most frequent form. After training to judge pictures by category, adults' memory for the pictures fell to chance, but children's did not.

The authors suggest control often buys quick accuracy at a later cost. In blocking, a link learned first stops people learning a newer cue that predicts the same outcome. Adults learn to look away from such cues, which cuts errors fast but distorts what they learn. The authors also cite evidence that a prefrontal rule-learning system competes with a habit-learning system deeper in the brain. For example, people with lower working memory learned category boundaries that cannot be put into words better than high-capacity people.

For creativity, adults thinking of unusual uses for objects, like a belt as a tourniquet, showed lower prefrontal activity and higher activity in visual areas. A weak electric current that dampened the left prefrontal cortex made people faster and more productive at this, but not at control tasks. Children also resist functional fixedness, the adult habit of seeing an object only by its usual use, such as a box as just a container. Studies of patients with left frontal damage, however, give mixed results.

The authors name clear limits. Judging whether a new idea is any good probably still needs control, with the brain switching back and forth many times. Some prefrontal function is essential for relearning when rules flip, so less control does not steadily mean better learning. Some links rest only on child studies and need testing in adults, and the exact brain mechanisms remain unknown.

The main conclusion is that cognitive control is a tool fitted to some common problems, not an all-purpose system suited to every task. The authors suggest the same idea may extend to decision making and to managing emotions.

## P24

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a lab experiment in rats about a simple question: does the brain need to be working while a rat rears up on its hind legs? The authors tested whether the hippocampus, a brain region long known to be essential for spatial memory, must be active during rearing for rats to remember places later. They switched off part of the hippocampus only during rearing and then measured memory.

Most research on how the hippocampus supports spatial memory looks at two moments: walking around, and quiet rest such as grooming or eating. Rearing is different: the rat stops and actively looks, sniffs and samples its surroundings from higher up. During rearing, the hippocampus shows strong 'theta', a regular 7–12 Hz brain rhythm tied to forming and recalling memories. Yet whether rearing matters for spatial memory was unknown.

Memory was tested on a maze with eight arms radiating from a central hub, using the delayed win-shift task. In the study phase, four random arms opened and each held food; after a four-minute delay, all eight opened, but only the four new arms had food. Two scores measured memory: percent correct, the share of the rat's first four arm choices that had food, and the total arms entered to find all four rewards.

To switch off the hippocampus, the team used optogenetics: a virus made neurons produce halorhodopsin, a protein that silences them when light shines on them. A 3D camera above the maze detected rearing and turned on a laser fed into the brain through implanted fibres, only during the study phase. Each rat ran three conditions: 'Off' with no light, 'Rear' with light during each rear, and 'Delay' with the same amount of light starting six seconds after each rear. A control group of seven rats got a virus without halorhodopsin, so the light could not silence their neurons; the main group had six rats.

The main findings were these. In the main group, percent correct fell from 77.7% with no light to 65.7% when the hippocampus was silenced during rearing. Those rats also needed more arm entries to find all the food, 6.5 versus 5.1. The 'Delay' condition did not significantly lower percent correct (72.0%), and arm entries showed only a borderline rise, 5.9 versus 5.1. Control rats showed no change in any condition, ruling out effects of the light itself, such as heat or distraction.

The authors name several limits. The six-second delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time. Nearly all rears were 'supported', with a front paw on a wall, so the study cannot compare this with free-standing rearing. It also cannot say whether every rear matters, or whether the same memory forming could happen during other looking behaviours, such as side-to-side head scanning.

Why might silencing during rearing hurt memory? The authors suggest rearing may help the rat update its inner model of its surroundings, here mainly to remember which arms opened today. Their conclusion is that dorsal hippocampus activity during rearing is important for spatial memory, making rearing a moment when the hippocampus encodes spatial memories.

### Summary B

This is a lab experiment in rats about rearing, when a rat stops and stands up on its hind legs to look around. It asks whether the hippocampus, a brain region needed for remembering places, must be active during rearing for the rat to form a spatial memory. To test this, the team briefly switched off the top part of the hippocampus only while rats reared, then checked their memory.

Most research on how the hippocampus supports spatial memory looks at times when animals walk around or rest quietly. Rearing is common but little studied, even though it lets the animal see and smell more of its surroundings, especially distant landmarks. During rearing, the hippocampus shows strong theta, a 7–12 Hz brain rhythm tied to storing and recalling memories. So rearing might be a key moment for memory, but nobody had tested whether it matters.

Rats learned a memory task on a maze with eight arms, each ending in a food cup. In the study phase, four random arms opened and held food; after a 4-minute break, all eight opened, with food only in the four new arms. Memory was scored as percent correct, the share of the first four choices that held food, and as total arm entries needed to find all food.

A ceiling 3D camera spotted rearing, and a laser silenced brain cells that carried halorhodopsin, a light-switched protein, in three study-phase conditions. Off: no light was delivered, giving each rat's normal performance. Rear: light came on during each rear and stayed on until it ended. Delay: light lasted the same time but started and stopped 6 seconds after each rear. A control group had only a glowing marker protein and no halorhodopsin, to rule out effects of light itself.

In halorhodopsin rats, Rear trials cut percent correct from 77.7% to 65.7% and raised arm entries from 5.1 to 6.5. Control rats showed no change: 83% versus 81.4% correct, and 5.2 arm entries either way. Delay trials did not significantly lower percent correct (72.0%), with only a borderline rise in arm entries (5.9, p = 0.05). The authors note the delayed light still overlapped about 35.5% of rearing time, so the two conditions were not fully separate.

Groups were small: six male rats with halorhodopsin and seven controls, and the experimenter knew each trial's condition. The narrow arms meant nearly all rears had a paw on a wall, so the study cannot compare this with free-standing rearing. It also cannot say which part of the hippocampus matters, whether every rear counts, or whether the same memory work could happen without rearing.

The authors suggest silencing may have stopped rats from updating their mental map of the room during rearing. Since the room was familiar, this updating likely concerned which arms were open that day, like remembering where you parked today. Their conclusion: hippocampal activity during rearing can be important for spatial memory, making rearing a moment when such memories are formed.

## P25

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This review asks how networks of brain cells actually process information, and presents one tool for studying it. The tool is partial information decomposition (PID), a way of splitting up what several input neurons tell us about a target neuron. The authors explain the method for newcomers and draw mostly on their own recent experiments.

Brains take in signals from the senses and turn them into useful behavior, but how that change happens is poorly understood. The authors name two old obstacles: too little data, and too few ways to analyse it. New recording tools now capture hundreds or thousands of neurons at once, so the data problem has eased. PID is offered as part of an answer to the analysis problem.

Mutual information, from information theory, measures how much knowing one neuron's activity cuts our uncertainty about another's. Transfer entropy measures how much one neuron's past helps predict another's next step, beyond what that neuron's own past already tells us. PID takes the information two source neurons give about a target and splits it into three kinds. Redundant information can be learned from either source, unique information from only one, and synergistic information only from both sources' joint pattern. The authors treat synergy as a sign of real processing, or computation.

In their main experiments, the authors grew thin slices of mouse brain cortex on a 512-channel electrode array and recorded hundreds of single neurons. Using transfer entropy, they mapped which neurons pass information to which, finding about 0.4–1.0% of possible links to be significant. They then ran PID on thousands of triads: two source neurons that both connect to one target. Across 25 recordings, synergy rose strongly with transfer entropy and was reliably about a quarter of it.

Comparing triads showed which network features go with more synergy. Triads inside rich clubs, the best-connected and densely interlinked neurons, had 2.7 times as much synergy and held about 88% of all synergy. Triads with two links between the source neurons had 50% more synergy than the simplest triads, while two links back from the target meant 10% less. Synergy grew as the two sources' activity became more alike, but peaked when their mutual information reached about 7% of its maximum, then fell.

A later study by Varley and colleagues recorded motor-area neurons in three macaque monkeys doing a task of seeing symbols, planning, remembering and reaching. It repeated key culture results, including a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply while the monkeys reached and grasped. The authors suggest the brain may copy the move signal many times so it reaches the muscles reliably.

The authors name several limits. Their networks came from pairwise transfer entropy, which overstates links, and from cultured tissue, which faces different demands than a behaving animal's brain. PID finds statistical patterns but does not explain the biology that makes a neuron synergistic or redundant. It also scales badly: with six input neurons there are 7,828,354 separate pieces of information to track.

The main conclusion is that neurons do not simply add up their inputs and fire past a threshold; they also respond to the pattern of inputs. How much synergy appears depends on a neuron's place in the network and on what the animal is doing. The authors see promise in newer versions of PID that track information moment by moment, or across several targets at once.

### Summary B

This review asks how groups of brain cells actually combine and transform the signals they receive. It introduces a math tool called partial information decomposition (PID), which splits the information several input neurons give about one target neuron into separate kinds. The authors aim it at readers inside and outside neuroscience, and they draw mostly on their own studies.

The authors call discovering how brains "process information" a grand challenge, since it is still poorly understood. Two things held this work back. Until recently there was too little data, but new recording methods now capture hundreds or thousands of neurons at once. There was also no good way to analyse such data, and the review presents PID as a partial answer.

Two older measures track how activity spreads between two neurons: mutual information, how much they fire in step, and transfer entropy, how much one's past predicts the other's future. PID goes further by asking how two inputs together inform a target. Redundant information is what either input alone would reveal, unique information comes from only one, and synergistic information appears only from both inputs' joint pattern. Ordinary information theory cannot fix these parts on its own, so analysts must pick a "redundancy measure", and about a dozen competing ones exist.

In their main studies, the authors grew thin slices of mouse cortex in dishes and recorded hundreds of neurons with 512-electrode arrays. They used transfer entropy to map which neurons drive which, finding only about 0.4 to 1.0 percent of possible links significant. They then ran PID on thousands of "triads": two source neurons both feeding one target.

Several patterns showed which triads carry the most synergy. Synergy was reliably about a quarter of the information flowing from sources to target, across 25 recordings. Triads in the "rich club", the best-connected, tightly linked core neurons, had 2.7 times more synergy; under 40 percent of neurons produced about 88 percent of all synergy. Triads with two links between the source neurons had 50 percent more synergy, while two links from target back to sources meant 10 percent less.

Synergy also depended on how alike the two inputs fired. It rose with similarity only up to a peak, at about 7 percent of the maximum possible shared information, then fell. Past that point, the shared signal seems to become redundant and to crowd out synergy.

A study in three monkeys doing a reaching task repeated key results, including a rich club and higher synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during movement, perhaps to send the "move" signal reliably to muscles.

The authors name limits: the culture work used pairwise maps known to overstate links, and dishes differ from living, behaving animals. PID shows statistical patterns, not the biological mechanisms behind them. It also scales badly, since six inputs already give 7,828,354 parts to sort out.

The main conclusion is that neurons do not simply add up inputs; they respond to particular patterns of them. This synergy is shaped by a neuron's network surroundings and the animal's behaviour, and the authors see extensions to moment-by-moment and multi-target analyses as promising next steps.

