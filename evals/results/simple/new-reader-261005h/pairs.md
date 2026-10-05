# Pairs of summaries of the same piece

blind-id: 5282e304d7d2

Each pair is two summaries of one piece. You have not read the piece and are not given it. The sides are in a random order. Judge each pair on its own.

## P01

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is an experimental study in rats that asks one question: does hippocampal activity while a rat rears up on its hind legs matter for spatial memory? The authors switched off the dorsal (upper) hippocampus only during rearing, then tested whether the rats could remember where they had been.

Most work on how the hippocampus supports spatial memory looks at two kinds of moments: walking around, and quiet rest such as grooming or eating. Rearing is common but little studied, even though it widens what the animal can see and smell and increases in new environments. It also comes with strong 7–12 Hz theta rhythm in the hippocampus, a brain wave tied to memory, so its role was an open gap.

Rats ran an 8-arm maze task called delayed win-shift: four arms open with food, a 4-minute break, then all eight open with food only in the four new arms. To silence neurons, the team used optogenetics: a virus made hippocampal cells produce halorhodopsin, a protein that shuts the cell down when hit by light. A 3D depth camera above the maze detected rearing in real time and triggered the laser, but only during the first, study phase.

Each rat ran three light conditions, in random order, one trial per day. Off: no light at all, giving each rat's baseline. Rear: light on for exactly the length of each detected rear. Delay: the same amount of light, but switched on and off 6 seconds after each rear. A control group got a virus with only a glowing marker and no halorhodopsin, to rule out effects of light or surgery alone.

In the six experimental rats, silencing during rearing dropped correct first choices from 77.7% to 65.7%, a significant fall. They also needed more arm visits to find all the food, 6.5 versus 5.1. The seven control rats showed no change in any condition. The Delay condition gave no significant drop in accuracy (72.0%) and only a borderline rise in arm visits (5.9, p = 0.05). The authors note the delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time.

The study cannot say whether rears with forepaws against a wall differ from free-standing ones; nearly all rears here were the supported kind. It also cannot tell whether every rear matters, or whether the same memory storing could happen through other looking-around behaviours. The experimenter could not be blind to condition, since the light made each condition obvious.

The authors suggest rearing may be when the hippocampus updates its internal model of the surroundings using distant visual cues. Because the maze was long familiar, this was likely not building a map from scratch but tagging today's arms against interference from past trials. Their conclusion: rearing is a moment when the hippocampus stores spatial memory, and disrupting it then is enough to impair that memory.

### Summary B

This is a lab experiment in rats about the hippocampus, the brain region long known to be needed for spatial memory. It asks one question: does hippocampal activity matter while a rat is rearing, meaning standing up on its hind legs to look around? The authors silenced the hippocampus only during rearing and checked whether the rat's memory of where it had been got worse.

Most research on how the hippocampus builds spatial memory looks at two kinds of moment: walking around, and quiet rest such as grooming or eating. Rearing is common but little studied, and its role in memory was unknown. There were hints it might matter: rearing widens what the animal can see and smell, and it goes with strong 7–12 Hz theta, a brain rhythm tied to memory encoding.

Rats were trained on a delayed win-shift task in a maze with eight arms radiating from a central hub. In the study phase, four random arms opened, each with food at the end; after a four-minute break, all eight opened, but only the four new arms held food. To silence the hippocampus, the authors used optogenetics: they made neurons carry halorhodopsin, a light-driven pump that shuts the cell down when lit through implanted fibers. A ceiling-mounted 3D camera detected rearing in real time and switched the light on, only during the study phase.

Each rat ran many trials, one per day, under three light conditions in shuffled order. Off: no light at all, giving the rat's normal performance. Rear: light on for exactly as long as each rear lasted. Delay: the same amount of light, but starting and stopping six seconds after each rear, to test whether timing mattered. A control group got the same fibers and light but no halorhodopsin, so light alone could not silence anything.

Memory was scored as percent correct, the share of a rat's first four test choices that found food. In the six experimental rats, silencing during rearing cut percent correct from 77.7% with light off to 65.7%. They also needed more arm visits to find all four rewards: 6.5 versus 5.1. The seven control rats showed no change (83% versus 81.4%; 5.2 visits either way).

The Delay condition did not significantly lower percent correct (72.0% versus 77.7%), with only a borderline rise in arm visits (5.9 versus 5.1). The authors note the six-second shift was imperfect: the light still overlapped about 35.5% of rearing time.

The authors list open questions: which part of the hippocampus matters, and whether every rear contributes. They did not separate rears with the paws resting on a wall from free-standing ones; in the narrow arms, almost all were the wall-supported kind. They also cannot say whether the same encoding could happen without rearing. Since the rats knew the maze well, any updating was likely of today's trial, not building a map from scratch.

The conclusion is that rearing is a moment when the hippocampus encodes spatial memory, and disrupting it then is enough to impair memory. The authors suggest, without testing it, that silencing may have blocked rearing's role in updating the brain's internal model of the surroundings.

## P02

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This Google Research paper asks whether a plain Transformer, the architecture behind today's language models, can classify images without any convolutional network. Its answer is the Vision Transformer, or ViT: an image is cut into small square patches, and each patch is treated like a word token. With enough training data, ViT matches or beats the best convolutional networks while needing less compute to train.

The authors start from language, where Transformers trained on huge text corpora keep improving with size, with no sign of leveling off. Vision, by contrast, still relied on ResNet-style convolutional networks. Earlier efforts to replace convolutions with attention used special attention patterns that were hard to run fast on modern accelerator chips. Sticking to the standard Transformer means the efficient tools built for language can be reused almost as they are.

Each patch, often 16 by 16 pixels, is flattened and passed through one learned linear layer, giving a patch embedding. As in BERT, an extra learnable class token is placed in front, and the encoder's output for it is what the classifier reads. Learned position embeddings, vectors marking each patch's place, start out knowing nothing of the 2D layout. So ViT has far less built-in inductive bias than a CNN: no locality or translation equivariance wired into every layer.

To see how much data this needs, the authors trained Base, Large and Huge sizes, written like ViT-L/16 for Large with 16-pixel patches. Pre-training sets grew from ImageNet to ImageNet-21k to JFT-300M, a Google in-house set of about 300 million images. On ImageNet alone, Large ViTs did worse than Base ones and ResNets beat ViT; only with JFT-300M did ViT overtake. On random JFT subsets, ViT-B/32 did much worse than a similar-cost ResNet at 9 million images, but better from 90 million up.

After pre-training and then fine-tuning on smaller benchmarks, ViT compared well with the best earlier models. The best model, ViT-H/14, reached 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB, a suite of 19 tasks. ViT-L/16 beat BiT-L, a large ResNet trained on the same JFT data, on every task, using 0.68k versus 9.9k TPUv3-core-days, a count of chip cores times training days. ViT-L/16 pre-trained on the public ImageNet-21k set still scored 85.30% on ImageNet.

A controlled study compared ViT, ResNets and hybrids, where a ResNet feeds its feature maps into ViT, by accuracy against training compute. ViT needed about 2 to 4 times less compute for the same accuracy, hybrids helped only at small budgets, and ViT had not leveled off. Inside the model, position embeddings learned the image's row-and-column layout. Some attention heads looked across the whole image even in the first layers, the distance attended grew with depth, and attention fell on regions relevant to the label.

The authors caution that training efficiency may depend on schedule, optimizer and weight decay, not just on architecture. A first try at self-supervised training, predicting hidden patches as BERT predicts masked words, gave ViT-B/16 79.9% on ImageNet. That is 2 points above no pre-training but 4 behind supervised pre-training, and tasks like detection and segmentation remain untested.

The main conclusion: reading an image as a sequence of patches with a standard Transformer works surprisingly well when paired with large-scale pre-training. ViT matches or beats the state of the art while being relatively cheap to pre-train, and the authors expect further scaling would likely improve it.

### Summary B

This paper asks whether a standard Transformer, with almost no changes, can classify images as well as convolutional networks. The trick is to cut an image into fixed-size patches, such as 16×16 pixels, and feed them in like word tokens. The model, called Vision Transformer (ViT), is pre-trained on large labelled image sets and then transferred to smaller benchmarks.

The authors note that convolutional networks still dominate vision, even as Transformers have taken over NLP. Earlier efforts to replace convolutions with attention used specialised attention patterns that had not been scaled well on modern accelerators. Sticking to the original Transformer means scalable NLP architectures, and their efficient implementations, work almost out of the box.

Each patch is flattened and linearly projected to the model width, giving what the paper calls patch embeddings. A learnable class token, like BERT's [class] token, is prepended, and its final state feeds the classification head. The authors stress that ViT has much less image-specific inductive bias, meaning built-in assumptions about images, than CNNs do. In ViT, 2D structure enters only when cutting patches and when resizing position embeddings for higher-resolution fine-tuning; everything else is learned.

That missing bias shapes the central finding: ViT needs a lot of data. Trained on ImageNet's 1.3M images without strong regularization, it lands a few points below ResNets of similar size. With ImageNet-21k (14M images) or the in-house JFT-300M (303M images), ViT overtakes the ResNet baselines. On random JFT subsets, ViT-B/32 does much worse than a comparable ResNet50 at 9M images, but better from 90M up.

The best model, ViT-H/14 on JFT-300M, reaches 88.55% on ImageNet, 94.55% on CIFAR-100, and 77.63% on VTAB, a suite of 19 low-data tasks. The smaller ViT-L/16 beats the BiT-L ResNet on every task, using 0.68k TPUv3-core-days (cores times days of training) against 9.9k. A ViT-L/16 pre-trained on public ImageNet-21k also does well, and fits on a standard 8-core cloud TPUv3 in about 30 days. The authors caution that pre-training efficiency may also depend on schedule, optimizer and weight decay, not only architecture.

A controlled study on JFT-300M compared 7 ResNets, 6 ViTs and 5 hybrids, which feed ResNet feature maps into a Transformer. ViT needed about 2 to 4 times less compute than ResNets to reach the same performance, averaged over 5 datasets. Hybrids edged out ViT at small budgets, but the gap vanished for larger models, which the authors found somewhat surprising. ViT showed no sign of saturating within the range tried.

Looking inside the trained model shows that it learns image structure on its own. Position embeddings come to encode 2D layout: nearby patches, and patches in the same row or column, get similar embeddings. Some attention heads already span most of the image in the lowest layers, while others stay local, much like early convolutions. Attention distance, roughly a CNN's receptive field size, grows with depth, and the model attends to regions relevant for classification.

A first try at self-supervision, masking patches as BERT masks words, got ViT-B/16 to 79.9% on ImageNet. That is 2% better than training from scratch, but still 4% behind supervised pre-training. Named challenges are detection and segmentation, better self-supervised methods, and further scaling, which would likely improve results. The conclusion: a standard Transformer reading an image as a sequence of patches works surprisingly well with large-scale pre-training, and is relatively cheap to pre-train.

## P03

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a perspective essay by biologist Michael Levin about what memory is for. He argues that memory preserves salience, meaning what matters about an experience, rather than fidelity, meaning its exact details. He builds the case from examples in developmental biology, evolution, bioengineering and neuroscience, not from a single new experiment. His name for the skill of rewriting memories to fit new bodies and situations is mnemonic improvisation.

The essay starts from a puzzle the author calls the persistence paradox. A species that never changes dies out, but one that changes stops being what it was; the same holds for a person who learns. Levin says this puzzle faces agents at every scale, from parts of cells to whole lineages, so it matters for building AI and artificial life too. His answer, shared with process philosophy and Buddhist thought, is to treat the Self as an ongoing process rather than a fixed thing.

Confabulation, the mind's habit of making up a story to fill gaps, is usually seen as a flaw. For example, a patient laughs when a brain electrode fires, then says they were thinking of a joke. Levin pictures each of us as a series of Selflets, brief slices of self probably a few hundred milliseconds thick. An engram, the physical trace a memory leaves, is then a note from a past Selflet that the present one must interpret, like any message.

Several cases suggest that memories are remapped, not just stored. Some memories survive a caterpillar becoming a butterfly, though a leaf-eating crawler's details are useless to a nectar-drinking flier; the lesson, roughly "food", carries over. Brain extract from trained sea slugs, injected only near the right nerve tissue, still changes a naive slug's behavior. An odor molecule injected into a frog egg leads the grown animal to seek that odor when hunting food, so engrams act more like prompts than recordings.

Levin links this to a bowtie pattern: information is squeezed into a small form, then expanded and reinterpreted at the other end. An egg is such a squeeze, rebuilding a whole body that may meet a new world with changed parts. Bodies do the same reinterpreting: one voltage-changing drug makes tadpoles grow tails but froglets grow legs. Newts with giant cells still build normal-width kidney tubes, sometimes from one cell bending around itself.

Planarian flatworms have very noisy genomes yet resist aging, cancer and injury, with the best regeneration. Levin proposes they rely most on large-scale pattern completion over genetic details, a willingness to confabulate in body-building. He argues intelligence arose because of, not in spite of, unreliable living material.

More speculatively, he asks whether memories help hold a self together, since a rat's lever-and-reward memory belongs to no single cell. He also wonders if memories have a little agency of their own, echoing William James: "thoughts are thinkers". He admits he has given the strongest version of these claims, and a more moderate middle view may prove more useful.

The conclusion is that organisms unable to handle change in their own parts and memories are unlikely to persist. The Self is a construction: an adaptive story that holds parts together and lets them solve problems. Levin ends by inviting readers to treat each act as a message to a future self, knowing it will be reinterpreted.

### Summary B

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how information is stored and read back reliably. Levin asks instead how living things reinterpret and rewrite memories to fit a self and a world that keep changing. His central claim is that memory preserves salience, meaning what matters, rather than fidelity, meaning exact details.

The essay starts from a puzzle: if a species never changes it dies out, but if it changes, the old species is gone. The same holds for a person who learns and grows. Levin says this puzzle faces agents at every scale, from cell parts to whole lineages, so it matters for AI and artificial life too. Living parts are also unreliable, prone to mutation, aging and cancer, and he argues this weakness is the very source of intelligence.

The essay argues from published examples rather than new experiments, including these: Caterpillars rebuild their brains into butterflies, yet keep some learned memories, which must be remapped from leaves to nectar to stay useful. An odour molecule injected into a frog egg leads the grown animal to seek that odour when looking for food. The brain invents content, such as a green flash between a yellow and a blue light, to tell a coherent story.

Levin pictures a mind as a series of Selflets: brief slices of self, each perhaps a few hundred milliseconds thick. A memory is then a message left by a past Selflet, which the present one must interpret. So confabulation, filling gaps with made-up but useful stories, is treated as a strength, not a bug.

He extends this beyond brains with the bowtie: information is squeezed into a small core, then expanded again in a new setting. An egg is one such core, re-expanding into a body that may meet a different world. One voltage-changing drug triggers tails in tadpoles but legs in froglets, so the same signal is read by context. Newts with giant cells still build normal kidney tubes, sometimes from a single cell bending around itself.

Planarian flatworms have very noisy genomes yet resist aging, cancer and injury, a century-old puzzle. Levin proposes they are most willing to confabulate in body-building, overriding genetic details with large-scale pattern completion. Because good repair hides bad genes from selection, evolution invests in these skills, an intelligence ratchet.

More speculatively, he asks whether memories themselves have a little agency, echoing William James: thoughts are thinkers. He suggests tests, such as training memories into gene networks to see if the whole system grows more unified. He admits he states the strongest version of these ideas, and a more moderate version may prove more useful.

His conclusion is that the Self is a construction: an adaptive story that holds parts together and must constantly be repaired. Organisms that cannot handle novelty in their own parts and memories are unlikely to persist. He closes by suggesting we treat each act as a message to a future self who will read it differently.

## P04

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a review and theory paper about when the brain's top-down control helps and when it hurts. The authors treat cognitive control, driven largely by the prefrontal cortex (PFC), as a filter that keeps task-relevant input and discards the rest. Borrowing loosely from signal processing, they propose a Matched Filter Hypothesis (MFH): performance is best when the amount of filtering matches what the task needs.

The standard view links PFC to the most complex cognition, so more control looks like it should always be better. The authors argue that a growing body of research shows otherwise. In one probabilistic choice task, adults match probabilities and expect 62.5% success, while children always pick the best option and expect 75%. Some probability matching may involve executive function, so control can paradoxically make adults worse here.

The MFH predicts high control helps tasks that are explicit, rule-based, abstract, and small enough to hold in working memory. Low control, called hypofrontality, helps tasks that are implicit, stimulus-driven, hard to abstract, and too complex for working memory. The level reached depends on competition between PFC and posterior or subcortical systems, shaped by age, genes, brain damage, dual tasks or brain stimulation. How the brain picks the right level is deliberately set aside.

For learning, the paper gathers mostly indirect evidence that less control can help. A distracting second task helps adults learn hard-to-verbalise rules, motor sequences and decision boundaries; disrupting dorsolateral PFC with magnetic stimulation improved implicit motor learning. Three-year-olds show less blocking than four-year-olds, and 8–9-year-olds less highlighting than adults: attention shifts that cut errors fast but distort learned associations. Adult language learners' "frozen" word forms improve when a concurrent task taxes working memory.

The authors link this to competing learning systems: a PFC/caudate model-based system reliant on working memory versus a striatal model-free one. Low-working-memory learners beat high-capacity ones at nonverbalisable decision boundaries. Their summary: control buys short-term accuracy at a long-term cost to how faithful and complete the learning is.

For creativity, people inventing new uses for objects showed lower PFC activity and higher visual-area activity than people giving typical uses. Inhibitory stimulation over left PFC made creative use generation faster and more productive, but not control tasks. Children also resist functional fixedness, being stuck on an object's usual use, though no study has tied this to PFC development.

The authors name clear limits. Child advantages cannot be pinned on low PFC alone, since children also differ in knowledge and strategies. Reversal learning needs some PFC, and dopamine studies suggest an inverted-U, not a straight line. Creativity studies are few, patient results are inconsistent, and judging ideas likely needs control again.

The unifying point is that transforming input has a cost: a useful filter under one set of conditions is harmful under another. The authors conclude that cognitive control is a tool adapted to a subset of challenges, not an all-purpose optimiser.

### Summary B

This is a theory-and-review paper arguing that strong cognitive control is not always better. The authors treat the prefrontal cortex as a filter that weakens information judged irrelevant, so behaviour fits the current goal. Borrowing loosely from signal processing, they propose a Matched Filter Hypothesis: performance is best when the amount of filtering matches what the task needs.

The usual view treats prefrontal control as the engine of complex thought, and most developmental work studies children's control deficits. Yet a growing body of work finds that not all complex cognition benefits from control, and children sometimes beat adults. In a choice task where one option pays off 75% of the time, adults pick it 75% of the time, for 62.5% success. Children pick it every time and reach 75%, and adult matching may draw on executive function.

High control should help tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Hypofrontality, meaning reduced prefrontal activity, should help tasks that are implicit, stimulus-driven, hard to abstract, or too complex for working memory. The outcome reflects competition between prefrontal cortex and posterior or subcortical systems, such as sensorimotor cortex and the basal ganglia. Age, genes, brain damage, dual-task conditions and brain stimulation can all shift that balance.

For learning, the review gathers several lines of evidence. A secondary task helps adults learn rules they cannot put into words, and magnetic stimulation disrupting dorsolateral prefrontal cortex improved implicit motor learning. Retrieval-induced forgetting, where practising some items suppresses related ones, shrinks when prefrontal resources are taxed by a secondary task. Adults learn to look away from uninformative cues, cutting errors fast but distorting what they learn; 3-year-olds show less of this blocking than 4-year-olds. Given noisy artificial-language input, children produce only the most frequent form, while adults reproduce the noise.

The authors link this to competing learning systems. Prefrontal cortex and the caudate support explicit, rule-based learning, while the putamen supports habit-like procedural learning; caudate activity falls as putamen activity rises. Adults with low working memory capacity learn non-verbalizable category boundaries better than high-capacity adults. The mature prefrontal cortex may bias people toward the explicit system even when it fits the problem poorly.

Creativity is the second test case, since open-ended tasks may need raw perceptual detail that filtering discards. People generating unusual uses for objects showed lower prefrontal and higher visual-area activity than people generating typical uses. Inhibitory stimulation over left prefrontal cortex made people faster and more prolific at creative uses, but not on control tasks. Children also resist functional fixedness, the adult habit of seeing an object only by its usual function. Judging whether an idea works likely needs control again, so creative work may cycle between the two states.

The authors flag clear limits. Child advantages could stem from knowledge, strategies or other maturing brain regions, not only weak prefrontal control. Reversal learning needs some prefrontal function, and dopamine studies suggest an inverted-U relationship, so less control is not simply better. Creativity studies are few, patient findings are inconsistent, and the neural mechanism that sets the filter remains unspecified.

The unifying point is that transforming input has a cost: strategies that cut errors quickly can lose fidelity and completeness over time. The authors suggest the idea extends to complex multi-feature decisions and to emotion regulation. They conclude that cognitive control is a tool suited to some common challenges, not an all-purpose optimiser for every problem.

## P05

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a perspective essay by Michael Levin, arguing from examples rather than reporting a new experiment. Its claim is that memory exists to preserve salience, what matters, rather than fidelity, the exact details. Agents must keep reinterpreting their own memories to fit a changing body and world. Levin draws on developmental biology, evolution, synthetic bioengineering and neuroscience, and applies the idea from cells to societies.

The starting point is a paradox: a self that never changes cannot learn, but a self that changes seems to stop existing. Levin says this puzzle applies to any agent at any scale, so it bears on AI, artificial life and engineering new minds. He argues that biology's unreliable parts are not a flaw but the origin of intelligence. He calls the ability to rewrite and remap memories onto new bodies and contexts "mnemonic improvisation".

The evidence comes from cases where a memory survives a radical change of body. Some memories survive the caterpillar-to-butterfly rebuild, yet a leaf-finding memory must be remapped to make sense for a nectar-drinking flier. Brain extract from trained Aplysia sea slugs, injected only near the right tissue, still changes the recipient's behaviour. An odorant injected into a frog egg yields an animal that seeks that smell when hunting for food.

From this, Levin suggests engrams, stored memory traces, act less like records and more like prompts, with the decoder doing most of the work. Recall itself rewrites memory, and confabulation is everyday, as when the brain invents an in-between green flash between yellow and blue lights. He wants the bad name of confabulation, including in AI, revised toward adaptive sense-making.

The unifying picture is the bowtie: squeeze rich data through a narrow bottleneck, then re-inflate it, as an autoencoder does. An egg compresses a whole organism, and language compresses one brain's state for another. Because good compression makes the code look random, decoding in new contexts must be creative, not purely deductive. Newts with huge cells still build normal kidney tubules, even using a single bent cell, by switching mechanisms.

Planaria, flatworms with the noisiest genome, regenerate best and resist cancer, which Levin reads as intelligence arising from an unreliable substrate. More speculatively, he proposes that memories themselves may have minimal agency, so "thoughts are thinkers". Memories held by no single cell, like a rat linking lever and reward, might help glue the collective self together.

Planned tests include moving pattern memories between planaria, with only unpublished preliminary data so far, and nicotine-addiction memories into rats. Levin admits the mechanism of this plasticity is unknown. He states claims in their strongest form and says a more moderate hybrid view may prove more useful.

The conclusion: life constantly repairs and defends the self because the self is a construction, an embodied story holding parts together. Real observers commit to meaning over accurate detail, and Levin says such capacities need not be biological and could be engineered.

### Summary B

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how data is stored and read back reliably; Levin instead asks how agents reinterpret and rewrite memories to fit a changing self and world. His core claim is that memory preserves salience, meaning what matters, rather than fidelity to the original details. He frames this with a paradox: a species or person that never changes cannot learn, yet one that changes seems to stop being itself.

Levin says the paradox rests on pure logic, so it applies at every scale, from parts of cells to whole lineages, and to AI and artificial life. He argues that confabulation, usually treated as a bug in AI and in court witnesses, is actually a deep and useful feature of living systems. Biology, he says, solved the paradox by treating the Self as a process, not a fixed thing.

The argument draws on published studies rather than new experiments, and several show memory surviving radical change. Some trained memories survive a caterpillar's brain being rebuilt into a butterfly's, though leaf-related details are useless to a nectar drinker, so the lesson must be remapped. In Aplysia sea slugs, brain extract from trained animals, injected only near the right nervous tissue, still changes the recipient's behavior. An odorant injected into a frog egg leads the grown animal to seek that odor when looking for food. Levin reads these engrams, or memory traces, as less like stored records and more like prompts, with the decoding doing the hard work.

He generalizes this as a bowtie architecture: complex states squeezed into a compact code, then re-expanded, as in an autoencoder. An egg is such a bottleneck, re-inflating into a body that may meet a different world with different parts. Because good compression removes correlations, the code looks increasingly random, so decoding it must be creative, not just deductive. So the same voltage-changing drug, Monensin, triggers tails to grow in tadpoles but legs in froglets.

Newts engineered with extra chromosomes and larger cells still build kidney tubes of normal width, using fewer cells, or one huge cell bending around itself. Planarian flatworms have very noisy genomes yet resist aging, cancer and injury; Levin credits a strong willingness to confabulate in body shape. Because competent parts hide genome flaws from selection, he argues, evolution invests in competency, creating an intelligence ratchet driven by unreliable matter.

The most speculative step blurs data and processor: memories might have minimal agency, echoing William James's line that "thoughts are thinkers". He also asks whether memories act as cognitive glue: a rat's lever-reward memory belongs to no single cell, only to the whole animal. He proposes that consciousness may be felt uncertainty about one's own memories and internal states.

Levin says he deliberately gave the strongest versions of these claims, and a more moderate hybrid with the conventional view may prove more useful. He flags claims of memory transfer via heart or lung transplants as uncertain. Proposed tests include moving memories between gene-network models and moving nicotine addiction from human donors through Anthrobots into rats.

Levin concludes that the Self is a construction: an adaptive story that holds parts together and lets them navigate problems. Organisms that cannot handle novelty in their own parts and memories, not just their surroundings, will not be evolvable. Real observers are committed to meaning over accurate detail, and he holds that this capacity need not be biological and likely can be engineered.

## P06

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This review explains a method for measuring how neurons combine information, and surveys what it has revealed so far. The method is partial information decomposition (PID), which splits the information several input neurons carry about one target neuron into separate parts. The authors call understanding how brains process information a grand challenge, long held back by too little data and too few analysis tools. Existing measures such as transfer entropy, which asks how much one neuron's past predicts another's next state, track flow but not how streams interact.

PID is easiest to see with two source neurons feeding one target. Their information about the target splits into redundant parts (either source alone tells you), unique parts (only one tells you) and synergistic parts (only both together tell you). The authors treat synergy as their measure of real processing, or computation, by the target. No single way to measure redundancy is accepted, and close to a dozen compete. Most studies here used the original one, called Imin, even though it has been criticised for odd behaviour.

In the authors' main experiments, thin slices of mouse cortex were grown in culture on a 512-electrode array, recording hundreds of single neurons. They used transfer entropy to map which neurons influenced which; only 0.4–1.0% of possible links were significant. They then ran PID on thousands of triads: two source neurons that both link to one shared target.

Comparing triads within each recording gave three main patterns. Synergy rose with the information flowing from sources to target, reliably at about a quarter of that flow, across 25 recordings. Triads in the rich club, well-connected neurons that link to each other unusually densely, had 2.7 times the synergy and produced about 88% of it. Triads with two links between their sources had 50% more synergy than the simplest triads, while two links back from the target meant 10% less.

The team also asked whether similar inputs boost synergy. At fast timescales under 14 ms, more mutual information between the two sources meant more synergy. With time bins up to 2.25 s wide, synergy peaked when that mutual information was about 7% of its maximum, then fell. Redundancy kept rising instead, suggesting that inputs past some level of similarity simply repeat each other.

Varley and colleagues applied the approach to three macaques doing a task with phases for recognising a symbol, planning, remembering and moving. Using a stricter, multivariate way to build the network, they still found a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during the reach-and-grasp movement. The authors read this as the brain copying the "move" signal so it reaches the muscles reliably.

The authors name several limits. The mouse networks came from pairwise transfer entropy, which overstates links, and cultures face different demands than circuits in a behaving animal. PID reveals statistical patterns, not the biology that causes them. It also scales badly: six input neurons already give 7,828,354 distinct parts, most hard to interpret.

The main conclusion is that neurons do not just add up inputs and fire past a threshold; they respond to particular input patterns. Where synergy appears depends on a neuron's place in the network and on what the animal is doing. The authors point to extensions, such as tracking PID moment by moment, as promising next steps.

### Summary B

This review explains how one tool from information theory can show how neurons combine signals from several inputs. The tool is partial information decomposition (PID), a way of splitting up what several sources tell you about a target. It is an approachable overview rather than an exhaustive survey, and it leans on the authors' own lab work.

The authors call working out how brains process information a grand challenge, and say we barely understand how sensory signals get transformed. They name two past obstacles: too little data, and too few ways to analyse it. New recording kit that captures hundreds or thousands of neurons has eased the first, so they argue PID helps with the second.

Take two neurons feeding one target, and the mutual information that both together carry about the target's next state. PID splits it into redundant information (either input alone reveals it), unique information (only one input does), and synergistic information (only the joint pattern does). The authors treat synergy as their measure of processing, or computation. The maths is underdetermined, with three known terms and four unknowns, so one needs a redundancy formula. About a dozen compete; most studies here used the original one, called Imin, which has been criticised for odd behaviour.

In the main studies, 512-channel electrode arrays recorded hundreds of single neurons in cultured slices of mouse cortex. The team mapped connections with transfer entropy, which measures how much one neuron's past predicts another's next move beyond that neuron's own past. Only 0.4–1.0% of possible links were significant, yet that left thousands of triads: two source neurons sharing one target.

Comparing triads within each recording turned up three patterns. Synergy tracked the information flowing from sources to target, and was reliably about a quarter of a triad's transfer entropy. Triads in the rich club, a densely interlinked core of the best-connected neurons, had 2.7 times the synergy; under 40% of neurons produced about 88% of it. Two links between the sources gave 50% more synergy, while two links from the target back to the sources gave 10% less.

Synergy also rose when the two sources fired in more similar ways, but only up to a point. It peaked when their shared information was about 7% of the maximum, whatever the time window. Past that peak, redundancy kept climbing, suggesting very similar inputs mostly repeat each other.

The authors flag two caveats: their pairwise network method overstates links, and cultures are not working brains. A study of three macaques doing a reaching task used a stricter network method and repeated the rich-club and synergy findings. Activity was mostly synergy-dominated, but redundancy rose sharply during movement, perhaps to make sure the move signal got through.

PID has hard limits: with six inputs there are 7,828,354 pieces, so fully describing a real neuron is intractable. Simple estimates from limited data overstate mutual information, so careful comparison against chance is needed. And PID finds statistical patterns without explaining the biology that causes them.

The main conclusion is that neurons do not just add up inputs and fire past a threshold; they respond to particular input patterns. Where that synergy appears depends on a neuron's place in the network and on what the animal is doing. The authors point to moment-by-moment PID and versions with several targets as promising next steps.

## P07

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a lab experiment in rats asking one question: does the hippocampus need to be active while a rat rears up on its hind legs for spatial memory to form? The authors silenced the dorsal (upper) hippocampus only during rearing, then tested memory a few minutes later. They report that this selectively impaired memory.

Most work on how the hippocampus supports spatial memory studies two states: moving around, and quiet rest such as grooming or eating. Rearing is a third state, a pause to actively sample the surroundings, which may give a better view of distant cues and boundaries. Rearing comes with strong 7–12 Hz "high theta" rhythm in the hippocampus, a rhythm tied to memory encoding. Yet whether rearing matters for memory had never been tested.

Rats ran a delayed win-shift task on an eight-arm maze. In the study phase, four random arms opened with food; after a 4-minute delay, all eight opened, and only the four unvisited arms held food. A ceiling depth camera detected rearing in real time and switched on a laser. The laser activated halorhodopsin, a light-driven protein that silences neurons, only during the study phase. Three conditions were compared within each rat: laser Off, laser during Rear, and laser Delayed 6 seconds but lasting as long as the rear. A control group carried only a fluorescent marker, with no silencing protein.

The main results, for six experimental rats and seven controls: Silencing during rearing cut correct first choices from 77.7% to 65.7%, a significant drop. Rats also needed more arm entries to find all food, 6.5 versus 5.1. Control rats showed no effect of light, ruling out heating or visual distraction from the laser. The Delay condition gave no significant drop in accuracy (72.0%), only a borderline rise in arm entries (5.9, p = 0.05). The authors note the delayed laser still overlapped about 35.5% of rearing time, so the two conditions were not cleanly separated.

The experimenter could not be blinded to condition, and the experimental group was all male. Nearly all rears were "supported", with a forepaw on the wall, so the study cannot speak to unsupported rearing. It also cannot say whether every rear matters, or whether the same encoding could happen during other scanning behaviours.

The authors suggest silencing may block updating of an internal model of the environment during rearing. Since the rats knew the maze well, any updating is likely trial-specific: telling today's open arms apart from earlier days, like remembering where you parked today.

The conclusion is that rearing is a period when the hippocampus encodes spatial memory. The authors say this directly supports an earlier hypothesis by Lever and colleagues that rearing is a behavioural marker of hippocampal learning.

### Summary B

This is a rat experiment asking whether hippocampal activity matters for spatial memory at one particular moment: when a rat rears up onto its hind legs. The authors switched off the dorsal (upper) hippocampus only during rearing, then tested memory later.

Most work on how the hippocampus supports spatial memory looks at two states: moving around, and quiet rest such as grooming or eating. Rearing is neither; the rat stops and actively samples its surroundings, gaining a wider view of distant cues. Rearing comes with strong 7–12 Hz theta rhythm in the hippocampus, a rhythm tied to memory encoding, yet its role in spatial memory was unknown.

Rats learned a delayed win-shift task on a maze with eight arms radiating from a hub. In the study phase, four random arms opened and each held food; after a 4-minute break, all eight opened, but food sat only in the four new arms. The hippocampus was silenced only during the study phase, so the test measured what had been stored.

Silencing used halorhodopsin, a light-driven pump that quiets neurons when lit, triggered by a ceiling-mounted 3D camera that detected rearing, under three conditions. Off: no light at all, giving each rat's baseline. Rear: the laser came on when rearing was detected and stayed on for the whole rear. Delay: the same amount of light, but switched on and off 6 seconds after the rear began and ended.

Six rats carried halorhodopsin; seven control rats got only a fluorescent marker, so light could not silence anything. In the halorhodopsin rats, the share of correct first four choices fell from 77.7% (Off) to 65.7% (Rear). They also needed more arm entries to find all the food: 6.5 versus 5.1. Control rats showed no change (81.4% versus 83%; 5.2 entries both ways).

The Delay condition asks whether timing matters or any silencing would hurt. Accuracy under Delay, 72.0%, was not significantly below Off, and extra arm entries (5.9) were only a borderline trend. The authors note the delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time.

The authors name several limits. The experimenter could not be blinded to condition, and the experimental group was tested before the controls. Narrow arms meant almost every rear involved leaning on a wall, so leaning and free-standing rears were not compared. The study cannot say which part of the hippocampus matters, whether every rear contributes, or whether the same encoding could happen without rearing.

The conclusion: rearing is a moment when the hippocampus encodes spatial memory, and silencing it then is enough to impair memory in this task. The authors suggest rearing may let the hippocampus update its internal model of the surroundings. Since the room was familiar, they think this updating supports memory for today's specific trial, like remembering where you parked today.

## P08

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

This is a perspective essay by Michael Levin, arguing from examples rather than reporting a new experiment. Its claim is that memory exists to preserve salience, what matters, rather than fidelity, the exact details. Agents must keep reinterpreting their own memories to fit a changing body and world. Levin draws on developmental biology, evolution, synthetic bioengineering and neuroscience, and applies the idea from cells to societies.

The starting point is a paradox: a self that never changes cannot learn, but a self that changes seems to stop existing. Levin says this puzzle applies to any agent at any scale, so it bears on AI, artificial life and engineering new minds. He argues that biology's unreliable parts are not a flaw but the origin of intelligence. He calls the ability to rewrite and remap memories onto new bodies and contexts "mnemonic improvisation".

The evidence comes from cases where a memory survives a radical change of body. Some memories survive the caterpillar-to-butterfly rebuild, yet a leaf-finding memory must be remapped to make sense for a nectar-drinking flier. Brain extract from trained Aplysia sea slugs, injected only near the right tissue, still changes the recipient's behaviour. An odorant injected into a frog egg yields an animal that seeks that smell when hunting for food.

From this, Levin suggests engrams, stored memory traces, act less like records and more like prompts, with the decoder doing most of the work. Recall itself rewrites memory, and confabulation is everyday, as when the brain invents an in-between green flash between yellow and blue lights. He wants the bad name of confabulation, including in AI, revised toward adaptive sense-making.

The unifying picture is the bowtie: squeeze rich data through a narrow bottleneck, then re-inflate it, as an autoencoder does. An egg compresses a whole organism, and language compresses one brain's state for another. Because good compression makes the code look random, decoding in new contexts must be creative, not purely deductive. Newts with huge cells still build normal kidney tubules, even using a single bent cell, by switching mechanisms.

Planaria, flatworms with the noisiest genome, regenerate best and resist cancer, which Levin reads as intelligence arising from an unreliable substrate. More speculatively, he proposes that memories themselves may have minimal agency, so "thoughts are thinkers". Memories held by no single cell, like a rat linking lever and reward, might help glue the collective self together.

Planned tests include moving pattern memories between planaria, with only unpublished preliminary data so far, and nicotine-addiction memories into rats. Levin admits the mechanism of this plasticity is unknown. He states claims in their strongest form and says a more moderate hybrid view may prove more useful.

The conclusion: life constantly repairs and defends the self because the self is a construction, an embodied story holding parts together. Real observers commit to meaning over accurate detail, and Levin says such capacities need not be biological and could be engineered.

## P09

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This paper asks whether a standard Transformer, with almost no changes, can classify images as well as convolutional networks. The trick is to cut an image into fixed-size patches, such as 16×16 pixels, and feed them in like word tokens. The model, called Vision Transformer (ViT), is pre-trained on large labelled image sets and then transferred to smaller benchmarks.

The authors note that convolutional networks still dominate vision, even as Transformers have taken over NLP. Earlier efforts to replace convolutions with attention used specialised attention patterns that had not been scaled well on modern accelerators. Sticking to the original Transformer means scalable NLP architectures, and their efficient implementations, work almost out of the box.

Each patch is flattened and linearly projected to the model width, giving what the paper calls patch embeddings. A learnable class token, like BERT's [class] token, is prepended, and its final state feeds the classification head. The authors stress that ViT has much less image-specific inductive bias, meaning built-in assumptions about images, than CNNs do. In ViT, 2D structure enters only when cutting patches and when resizing position embeddings for higher-resolution fine-tuning; everything else is learned.

That missing bias shapes the central finding: ViT needs a lot of data. Trained on ImageNet's 1.3M images without strong regularization, it lands a few points below ResNets of similar size. With ImageNet-21k (14M images) or the in-house JFT-300M (303M images), ViT overtakes the ResNet baselines. On random JFT subsets, ViT-B/32 does much worse than a comparable ResNet50 at 9M images, but better from 90M up.

The best model, ViT-H/14 on JFT-300M, reaches 88.55% on ImageNet, 94.55% on CIFAR-100, and 77.63% on VTAB, a suite of 19 low-data tasks. The smaller ViT-L/16 beats the BiT-L ResNet on every task, using 0.68k TPUv3-core-days (cores times days of training) against 9.9k. A ViT-L/16 pre-trained on public ImageNet-21k also does well, and fits on a standard 8-core cloud TPUv3 in about 30 days. The authors caution that pre-training efficiency may also depend on schedule, optimizer and weight decay, not only architecture.

A controlled study on JFT-300M compared 7 ResNets, 6 ViTs and 5 hybrids, which feed ResNet feature maps into a Transformer. ViT needed about 2 to 4 times less compute than ResNets to reach the same performance, averaged over 5 datasets. Hybrids edged out ViT at small budgets, but the gap vanished for larger models, which the authors found somewhat surprising. ViT showed no sign of saturating within the range tried.

Looking inside the trained model shows that it learns image structure on its own. Position embeddings come to encode 2D layout: nearby patches, and patches in the same row or column, get similar embeddings. Some attention heads already span most of the image in the lowest layers, while others stay local, much like early convolutions. Attention distance, roughly a CNN's receptive field size, grows with depth, and the model attends to regions relevant for classification.

A first try at self-supervision, masking patches as BERT masks words, got ViT-B/16 to 79.9% on ImageNet. That is 2% better than training from scratch, but still 4% behind supervised pre-training. Named challenges are detection and segmentation, better self-supervised methods, and further scaling, which would likely improve results. The conclusion: a standard Transformer reading an image as a sequence of patches works surprisingly well with large-scale pre-training, and is relatively cheap to pre-train.

### Summary B

This research paper asks whether a standard Transformer, with almost no changes, can classify images as well as convolutional networks (CNNs). The trick is to treat an image like a sentence: cut it into fixed-size patches, such as 16×16 pixels, and use each patch as a token. Each patch is flattened and passed through a learned linear projection, and position embeddings are added. As in BERT, an extra learnable class token is prepended, and its final state feeds the classifier. The authors call the model the Vision Transformer, or ViT.

The paper notes that CNNs still dominate vision, and ResNet-style models remain state of the art in large-scale image recognition. Earlier attention models for images either kept a CNN around or used specialised attention patterns. Those patterns needed complex engineering to run efficiently on hardware accelerators. By staying close to the original Transformer, ViT can reuse scalable language-model architectures and their fast implementations almost out of the box.

ViT has far less inductive bias than a CNN, meaning fewer built-in assumptions about images. CNNs assume nearby pixels belong together, and that a pattern means the same thing wherever it appears. ViT uses the 2D layout only when cutting patches and when stretching position embeddings for higher-resolution fine-tuning. So, trained on ImageNet alone (1.3M images) without strong regularisation, it lands a few percentage points below ResNets of similar size.

To test how much data matters, the authors pre-trained on ImageNet, ImageNet-21k (14M images) and the in-house JFT-300M (303M images). Large ViTs did worse than base ViTs on ImageNet, matched them on ImageNet-21k, and only pulled ahead on JFT-300M. On random JFT subsets, ViT-B/32 did much worse than a similar-cost ResNet50 at 9M images, but better at 90M and above. The authors read this as built-in assumptions helping on small data, while large data lets the model learn the patterns itself.

The largest model, ViT-H/14 pre-trained on JFT-300M, reached 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB. VTAB is a set of 19 varied tasks, each with only 1,000 training examples. Pre-training took 2.5k TPUv3-core-days (cores used times days of training), against 9.9k for the best ResNet and 12.3k for Noisy Student. The authors caution that schedule, optimiser and weight decay also affect this efficiency, not just the architecture.

A controlled study of ResNets, ViTs and hybrids (CNN features fed in as patches), all pre-trained on JFT-300M, showed three patterns. ViT used about 2 to 4 times less compute than ResNets to reach the same performance. Hybrids beat pure ViT at small compute budgets, but the gap vanished for larger models. ViT showed no sign of levelling off within the range tried.

Looking inside, the learned position embeddings recover the image's 2D layout, with rows, columns and distance showing up on their own. This explains why hand-built 2D position schemes gave no gains. Some attention heads look across most of the image even in the first layers, while others stay local, perhaps acting like early convolutions.

A first try at self-supervised pre-training, by predicting masked patches as BERT predicts masked words, gave ViT-B/16 79.9% on ImageNet. That is 2% better than training from scratch but 4% behind supervised pre-training. Open challenges named are detection, segmentation, better self-supervision and further scaling. The main conclusion: large-scale training trumps inductive bias, so a plain Transformer matches or beats top CNNs at lower pre-training cost.

## P10

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a lab experiment in rats asking one question: does the hippocampus need to be active while a rat rears up on its hind legs for spatial memory to form? The authors silenced the dorsal (upper) hippocampus only during rearing, then tested memory a few minutes later. They report that this selectively impaired memory.

Most work on how the hippocampus supports spatial memory studies two states: moving around, and quiet rest such as grooming or eating. Rearing is a third state, a pause to actively sample the surroundings, which may give a better view of distant cues and boundaries. Rearing comes with strong 7–12 Hz "high theta" rhythm in the hippocampus, a rhythm tied to memory encoding. Yet whether rearing matters for memory had never been tested.

Rats ran a delayed win-shift task on an eight-arm maze. In the study phase, four random arms opened with food; after a 4-minute delay, all eight opened, and only the four unvisited arms held food. A ceiling depth camera detected rearing in real time and switched on a laser. The laser activated halorhodopsin, a light-driven protein that silences neurons, only during the study phase. Three conditions were compared within each rat: laser Off, laser during Rear, and laser Delayed 6 seconds but lasting as long as the rear. A control group carried only a fluorescent marker, with no silencing protein.

The main results, for six experimental rats and seven controls: Silencing during rearing cut correct first choices from 77.7% to 65.7%, a significant drop. Rats also needed more arm entries to find all food, 6.5 versus 5.1. Control rats showed no effect of light, ruling out heating or visual distraction from the laser. The Delay condition gave no significant drop in accuracy (72.0%), only a borderline rise in arm entries (5.9, p = 0.05). The authors note the delayed laser still overlapped about 35.5% of rearing time, so the two conditions were not cleanly separated.

The experimenter could not be blinded to condition, and the experimental group was all male. Nearly all rears were "supported", with a forepaw on the wall, so the study cannot speak to unsupported rearing. It also cannot say whether every rear matters, or whether the same encoding could happen during other scanning behaviours.

The authors suggest silencing may block updating of an internal model of the environment during rearing. Since the rats knew the maze well, any updating is likely trial-specific: telling today's open arms apart from earlier days, like remembering where you parked today.

The conclusion is that rearing is a period when the hippocampus encodes spatial memory. The authors say this directly supports an earlier hypothesis by Lever and colleagues that rearing is a behavioural marker of hippocampal learning.

### Summary B

This is an experimental study in rats that asks one question: does hippocampal activity while a rat rears up on its hind legs matter for spatial memory? The authors switched off the dorsal (upper) hippocampus only during rearing, then tested whether the rats could remember where they had been.

Most work on how the hippocampus supports spatial memory looks at two kinds of moments: walking around, and quiet rest such as grooming or eating. Rearing is common but little studied, even though it widens what the animal can see and smell and increases in new environments. It also comes with strong 7–12 Hz theta rhythm in the hippocampus, a brain wave tied to memory, so its role was an open gap.

Rats ran an 8-arm maze task called delayed win-shift: four arms open with food, a 4-minute break, then all eight open with food only in the four new arms. To silence neurons, the team used optogenetics: a virus made hippocampal cells produce halorhodopsin, a protein that shuts the cell down when hit by light. A 3D depth camera above the maze detected rearing in real time and triggered the laser, but only during the first, study phase.

Each rat ran three light conditions, in random order, one trial per day. Off: no light at all, giving each rat's baseline. Rear: light on for exactly the length of each detected rear. Delay: the same amount of light, but switched on and off 6 seconds after each rear. A control group got a virus with only a glowing marker and no halorhodopsin, to rule out effects of light or surgery alone.

In the six experimental rats, silencing during rearing dropped correct first choices from 77.7% to 65.7%, a significant fall. They also needed more arm visits to find all the food, 6.5 versus 5.1. The seven control rats showed no change in any condition. The Delay condition gave no significant drop in accuracy (72.0%) and only a borderline rise in arm visits (5.9, p = 0.05). The authors note the delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time.

The study cannot say whether rears with forepaws against a wall differ from free-standing ones; nearly all rears here were the supported kind. It also cannot tell whether every rear matters, or whether the same memory storing could happen through other looking-around behaviours. The experimenter could not be blind to condition, since the light made each condition obvious.

The authors suggest rearing may be when the hippocampus updates its internal model of the surroundings using distant visual cues. Because the maze was long familiar, this was likely not building a map from scratch but tagging today's arms against interference from past trials. Their conclusion: rearing is a moment when the hippocampus stores spatial memory, and disrupting it then is enough to impair that memory.

## P11

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a review and theory paper about cognitive control: the brain's ability to steer thought toward a goal, largely credited to the prefrontal cortex. The authors treat control as filtering: keeping task-relevant information and weakening or discarding the rest. They propose the Matched Filter Hypothesis (MFH): performance is best when the amount of filtering matches what the task needs, not simply when control is high.

The prefrontal cortex is usually seen as essential for complex behavior, yet a growing body of research shows that not all complex thinking benefits from control. The authors want readers to see control as a tool suited to some common problems, not an all-purpose optimizer for every problem.

High control should help tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Low control should help tasks that are implicit, reward-driven, nonverbal or intuitive, and too complex for working memory to hold. The paper calls reduced prefrontal activity hypofrontality; it occurs in young children, after brain damage, under a demanding second task, or with brain stimulation. One example: when an option pays off 75% of the time, adults pick it 75% of the time and win 62.5%, while children pick it always and win 75%.

The learning evidence mostly shows control buying quick accuracy at a long-term cost. Adults learned hard-to-verbalize rules, motor sequences and category boundaries better while a second task taxed their prefrontal resources. Adults learn to steer attention away from some cues to cut errors fast, which distorts what they learn about those cues; young children show less of this. Learning an artificial language from inconsistent input, adults copied the noise, while children produced only the most frequent form and did better.

The authors also describe competing learning systems: a prefrontal one for explicit rules and a striatal one for habits and procedures. People with lower working memory capacity were better than high-capacity people at learning category boundaries that cannot be put into words. The mature prefrontal cortex may push adults toward the explicit system even when it fits the problem poorly.

In brain scans, people inventing unusual uses for objects showed lower prefrontal and higher visual-area activity than people giving typical uses. Dampening left prefrontal activity with weak electrical current made people produce creative uses faster and in greater number. Children also resist functional fixedness, the adult habit of seeing an object only by its usual use, though no study has tied this directly to brain development. Judging whether a new idea actually works likely still needs prefrontal control.

The authors set aside how the brain chooses the right level of control, and call the exact neural mechanisms a major open challenge. Some prefrontal function is needed to relearn after the rules flip, and dopamine studies often find that both too little and too much hurt performance. Creativity studies are few, and some patient findings are inconsistent.

The main conclusion is that less control can be an advantage for data-driven tasks best handled by sensory and subcortical brain systems. The authors expect the idea to reach decision making too, where unconscious processing may beat deliberation once options have more features than working memory holds.

### Summary B

This is a review and theory paper about cognitive control: the prefrontal cortex's job of filtering incoming sensory information toward the response that best fits current goals. The authors propose a Matched Filter Hypothesis (MFH), named loosely after the signal-processing filter that best pulls a signal out of noise in a given context. Its claim is that performance is best when the level of control matches how much filtering the task actually needs, not when control is simply high.

The authors argue this matters because control is usually treated as always helpful, and research on children mostly catalogues their control deficits. Yet children sometimes beat adults. When one option pays off 75% of the time, adults pick it 75% of the time, for 62.5% expected success, while children pick it always and reach 75%. Some work links adults' probability matching to executive function, so control may hurt here.

Under the MFH, strong control suits tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Hypofrontality, meaning reduced prefrontal activity and so less filtering, suits implicit, reward-based or intuitive tasks whose representations exceed working memory. The balance comes from competition between prefrontal cortex and posterior or subcortical systems, shaped by age, brain health and individual differences. The paper sets aside how the brain chooses its control level.

The learning evidence the authors gather points the same way. Taxing control with a second task helps adults learn rules they cannot put into words, and magnetic disruption of dorsolateral prefrontal cortex improved implicit motor learning. Retrieval-induced forgetting, where practising some items suppresses related unpractised ones, shrinks under a secondary task. Blocking, where an earlier cue stops a new cue from being learned, is weaker in 3-year-olds than 4-year-olds, and children show less of a related bias than adults. Given noisy artificial-language input, children produce only the most frequent form, while adults reproduce the noise.

The authors tie this to competing learning systems: a prefrontal and caudate system for model-based, rule-like learning, and a putamen system for model-free, habitual learning. Learners with low working memory are better at learning decision boundaries that cannot be put into words. The common theme is that control buys short-term accuracy at a long-term cost to the fidelity and completeness of what is learned.

For creativity, the MFH predicts that generating ideas benefits from less filtering of raw perceptual detail. People inventing unusual uses for objects showed lower prefrontal and higher visual-area activity than people listing typical uses. Mild electrical stimulation that dampens left prefrontal cortex sped up creative-use generation and increased the number of ideas. Children resist functional fixedness, the adult habit of seeing an object only in terms of its intended use. Judging whether an idea works likely needs prefrontal control again, perhaps through rapid cycling between states.

The authors flag clear limits. Direct adult evidence is sparse, and children's advantages cannot be pinned on hypofrontality alone, since children also differ in knowledge and strategy. Less prefrontal function does not improve learning in a straight line; reversal learning needs some, and dopamine shows an inverted-U relation with performance. Creativity studies are few and sometimes inconsistent, and the neural mechanisms remain unspecified.

The authors suggest the idea extends to decision making, where unconscious processing may win when relevant features far exceed working memory, and to emotion regulation. Their conclusion is that cognitive control is a tool adapted to a subset of common challenges, not an all-purpose optimizer suited to every problem.

## P12

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a review and theory paper about cognitive control: the prefrontal cortex's job of filtering incoming sensory information toward the response that best fits current goals. The authors propose a Matched Filter Hypothesis (MFH), named loosely after the signal-processing filter that best pulls a signal out of noise in a given context. Its claim is that performance is best when the level of control matches how much filtering the task actually needs, not when control is simply high.

The authors argue this matters because control is usually treated as always helpful, and research on children mostly catalogues their control deficits. Yet children sometimes beat adults. When one option pays off 75% of the time, adults pick it 75% of the time, for 62.5% expected success, while children pick it always and reach 75%. Some work links adults' probability matching to executive function, so control may hurt here.

Under the MFH, strong control suits tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Hypofrontality, meaning reduced prefrontal activity and so less filtering, suits implicit, reward-based or intuitive tasks whose representations exceed working memory. The balance comes from competition between prefrontal cortex and posterior or subcortical systems, shaped by age, brain health and individual differences. The paper sets aside how the brain chooses its control level.

The learning evidence the authors gather points the same way. Taxing control with a second task helps adults learn rules they cannot put into words, and magnetic disruption of dorsolateral prefrontal cortex improved implicit motor learning. Retrieval-induced forgetting, where practising some items suppresses related unpractised ones, shrinks under a secondary task. Blocking, where an earlier cue stops a new cue from being learned, is weaker in 3-year-olds than 4-year-olds, and children show less of a related bias than adults. Given noisy artificial-language input, children produce only the most frequent form, while adults reproduce the noise.

The authors tie this to competing learning systems: a prefrontal and caudate system for model-based, rule-like learning, and a putamen system for model-free, habitual learning. Learners with low working memory are better at learning decision boundaries that cannot be put into words. The common theme is that control buys short-term accuracy at a long-term cost to the fidelity and completeness of what is learned.

For creativity, the MFH predicts that generating ideas benefits from less filtering of raw perceptual detail. People inventing unusual uses for objects showed lower prefrontal and higher visual-area activity than people listing typical uses. Mild electrical stimulation that dampens left prefrontal cortex sped up creative-use generation and increased the number of ideas. Children resist functional fixedness, the adult habit of seeing an object only in terms of its intended use. Judging whether an idea works likely needs prefrontal control again, perhaps through rapid cycling between states.

The authors flag clear limits. Direct adult evidence is sparse, and children's advantages cannot be pinned on hypofrontality alone, since children also differ in knowledge and strategy. Less prefrontal function does not improve learning in a straight line; reversal learning needs some, and dopamine shows an inverted-U relation with performance. Creativity studies are few and sometimes inconsistent, and the neural mechanisms remain unspecified.

The authors suggest the idea extends to decision making, where unconscious processing may win when relevant features far exceed working memory, and to emotion regulation. Their conclusion is that cognitive control is a tool adapted to a subset of common challenges, not an all-purpose optimizer suited to every problem.

### Summary B

This is a theory-and-review paper arguing that strong cognitive control is not always better. The authors treat the prefrontal cortex as a filter that weakens information judged irrelevant, so behaviour fits the current goal. Borrowing loosely from signal processing, they propose a Matched Filter Hypothesis: performance is best when the amount of filtering matches what the task needs.

The usual view treats prefrontal control as the engine of complex thought, and most developmental work studies children's control deficits. Yet a growing body of work finds that not all complex cognition benefits from control, and children sometimes beat adults. In a choice task where one option pays off 75% of the time, adults pick it 75% of the time, for 62.5% success. Children pick it every time and reach 75%, and adult matching may draw on executive function.

High control should help tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Hypofrontality, meaning reduced prefrontal activity, should help tasks that are implicit, stimulus-driven, hard to abstract, or too complex for working memory. The outcome reflects competition between prefrontal cortex and posterior or subcortical systems, such as sensorimotor cortex and the basal ganglia. Age, genes, brain damage, dual-task conditions and brain stimulation can all shift that balance.

For learning, the review gathers several lines of evidence. A secondary task helps adults learn rules they cannot put into words, and magnetic stimulation disrupting dorsolateral prefrontal cortex improved implicit motor learning. Retrieval-induced forgetting, where practising some items suppresses related ones, shrinks when prefrontal resources are taxed by a secondary task. Adults learn to look away from uninformative cues, cutting errors fast but distorting what they learn; 3-year-olds show less of this blocking than 4-year-olds. Given noisy artificial-language input, children produce only the most frequent form, while adults reproduce the noise.

The authors link this to competing learning systems. Prefrontal cortex and the caudate support explicit, rule-based learning, while the putamen supports habit-like procedural learning; caudate activity falls as putamen activity rises. Adults with low working memory capacity learn non-verbalizable category boundaries better than high-capacity adults. The mature prefrontal cortex may bias people toward the explicit system even when it fits the problem poorly.

Creativity is the second test case, since open-ended tasks may need raw perceptual detail that filtering discards. People generating unusual uses for objects showed lower prefrontal and higher visual-area activity than people generating typical uses. Inhibitory stimulation over left prefrontal cortex made people faster and more prolific at creative uses, but not on control tasks. Children also resist functional fixedness, the adult habit of seeing an object only by its usual function. Judging whether an idea works likely needs control again, so creative work may cycle between the two states.

The authors flag clear limits. Child advantages could stem from knowledge, strategies or other maturing brain regions, not only weak prefrontal control. Reversal learning needs some prefrontal function, and dopamine studies suggest an inverted-U relationship, so less control is not simply better. Creativity studies are few, patient findings are inconsistent, and the neural mechanism that sets the filter remains unspecified.

The unifying point is that transforming input has a cost: strategies that cut errors quickly can lose fidelity and completeness over time. The authors suggest the idea extends to complex multi-feature decisions and to emotion regulation. They conclude that cognitive control is a tool suited to some common challenges, not an all-purpose optimiser for every problem.

## P13

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This is a lab experiment in rats about rearing, the moment when a rat stops moving and stands up on its hind legs to look around. The hippocampus is a brain region that rats and other animals need to remember places. The study asks whether hippocampus activity during rearing matters for that memory.

Most research on how the hippocampus supports spatial memory looks at two moments: walking around, and quiet rest such as grooming or eating. Rearing is common but little studied, even though it lets a rat see and smell more of its surroundings, especially distant landmarks. During rearing, the hippocampus shows stronger "high theta", a rhythm of brain activity at 7 to 12 cycles per second that earlier work links to memory. Still, no one had tested whether rearing itself matters for spatial memory.

The rats did a memory task on a maze with eight arms spreading out from a central hub. In the study phase, four arms opened and held food; after a four-minute break, all eight opened, but food sat only in the other four. Memory was scored two ways: the percent of the first four test choices that found food, and the total arm visits needed to find all four.

To switch off the upper (dorsal) hippocampus on cue, the team used optogenetics: a virus made nerve cells produce halorhodopsin, a protein that silences them when light shines. A 3D camera above the maze spotted each rear and turned on a laser shining into the brain. Each rat ran three conditions: Off, with no light; Rear, with light during each rear; and Delay, with light of the same length starting 6 seconds after each rear. Light was only ever given in the study phase, and a control group got a virus with a glowing marker but no halorhodopsin.

With 6 rats in the main group and 7 controls, the results were: In the main group, silencing during rearing cut percent correct from 77.7% in Off to 65.7%, a significant drop. The same rats needed more arm visits in Rear than in Off, 6.5 versus 5.1. In the Delay condition, percent correct fell only to 72.0%, not a significant change, and arm visits rose to 5.9, just at the edge of significance. Control rats showed no effect in any condition, so light or heat alone did not cause the drop.

The authors name several limits. The 6-second delay did not fully separate light from rearing; the laser still overlapped about 35.5% of rearing time. Almost every rear had a forepaw on a wall, so the study cannot compare this with free-standing rearing. It also cannot say whether every rear matters, or whether the same memory work could happen without rearing.

The authors suggest silencing may have blocked the hippocampus from updating its inner model of the surroundings during rearing. Since the rats knew the maze well, this update is likely about today's open arms, like remembering where you parked today. Their conclusion: rearing is a moment when the hippocampus encodes spatial memory, and disrupting it then is enough to impair that memory.

### Summary B

This is a lab experiment on rats that asks one question. Does the hippocampus, a brain area needed for spatial memory, have to be working while a rat stands up on its hind legs? Standing up like this is called rearing, and the authors call it a form of attentive sampling: stopping to look and sniff around. Their idea was that rearing is a moment when the hippocampus stores, or encodes, spatial memories.

Most research on how the hippocampus supports spatial memory looks at times when animals walk or rest quietly. Rearing is common but barely studied, even though it lets an animal take in more of its surroundings, especially distant landmarks. Rearing also comes with a strong brain rhythm called theta, which earlier work links to forming and recalling memories. Still, no one had tested whether rearing actually matters for spatial memory.

Rats learned a task on a maze with eight arms, each with food at the end. In a study phase, only four arms opened; after a four-minute break, all eight opened, but food sat only in the four new arms. Memory was scored two ways: how many of the first four choices found food, and how many arm visits it took to find all four rewards.

The researchers used optogenetics: a virus made hippocampus cells carry a light-sensitive protein, halorhodopsin, that silences them when laser light shines through implanted fibres. A 3D ceiling camera spotted rearing in real time and switched the laser on, only during the study phase. Each rat ran three conditions: Off, with no light; Rear, with light during each rear; and Delay, with the same amount of light starting six seconds late. A control group got a virus without halorhodopsin, so light alone could not silence their cells.

The main results, from 6 experimental and 7 control rats, were these. Silencing during rearing cut correct choices from 77.7% to 65.7%, a statistically reliable drop. The same rats needed more arm visits to find all the food, 6.5 instead of 5.1. Control rats showed no change with the light, ruling out effects like heat or the light being distracting. The Delay condition caused no reliable drop in correct choices (72.0%), only a borderline rise in arm visits to 5.9.

The authors name several limits. The six-second delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time. Nearly all rears in the narrow maze had a paw on the wall, so the work cannot compare supported and unsupported rearing. It also cannot say whether every rear matters, or whether similar encoding could happen during other looking-around behaviours, such as side-to-side head scanning.

Why might silencing hurt memory? The authors suggest rearing may help the brain update its internal map of the surroundings. Because the rats already knew the maze well, any updating was likely about that day's events, like remembering where you parked today.

The authors conclude that hippocampus activity during rearing is important for spatial memory in this task. They argue rearing is a moment when the hippocampus encodes spatial memories, not just an idle pause.

## P14

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a lab experiment in rats about the hippocampus, the brain region long known to be needed for spatial memory. It asks one question: does hippocampal activity matter while a rat is rearing, meaning standing up on its hind legs to look around? The authors silenced the hippocampus only during rearing and checked whether the rat's memory of where it had been got worse.

Most research on how the hippocampus builds spatial memory looks at two kinds of moment: walking around, and quiet rest such as grooming or eating. Rearing is common but little studied, and its role in memory was unknown. There were hints it might matter: rearing widens what the animal can see and smell, and it goes with strong 7–12 Hz theta, a brain rhythm tied to memory encoding.

Rats were trained on a delayed win-shift task in a maze with eight arms radiating from a central hub. In the study phase, four random arms opened, each with food at the end; after a four-minute break, all eight opened, but only the four new arms held food. To silence the hippocampus, the authors used optogenetics: they made neurons carry halorhodopsin, a light-driven pump that shuts the cell down when lit through implanted fibers. A ceiling-mounted 3D camera detected rearing in real time and switched the light on, only during the study phase.

Each rat ran many trials, one per day, under three light conditions in shuffled order. Off: no light at all, giving the rat's normal performance. Rear: light on for exactly as long as each rear lasted. Delay: the same amount of light, but starting and stopping six seconds after each rear, to test whether timing mattered. A control group got the same fibers and light but no halorhodopsin, so light alone could not silence anything.

Memory was scored as percent correct, the share of a rat's first four test choices that found food. In the six experimental rats, silencing during rearing cut percent correct from 77.7% with light off to 65.7%. They also needed more arm visits to find all four rewards: 6.5 versus 5.1. The seven control rats showed no change (83% versus 81.4%; 5.2 visits either way).

The Delay condition did not significantly lower percent correct (72.0% versus 77.7%), with only a borderline rise in arm visits (5.9 versus 5.1). The authors note the six-second shift was imperfect: the light still overlapped about 35.5% of rearing time.

The authors list open questions: which part of the hippocampus matters, and whether every rear contributes. They did not separate rears with the paws resting on a wall from free-standing ones; in the narrow arms, almost all were the wall-supported kind. They also cannot say whether the same encoding could happen without rearing. Since the rats knew the maze well, any updating was likely of today's trial, not building a map from scratch.

The conclusion is that rearing is a moment when the hippocampus encodes spatial memory, and disrupting it then is enough to impair memory. The authors suggest, without testing it, that silencing may have blocked rearing's role in updating the brain's internal model of the surroundings.

### Summary B

This is a rat experiment asking whether the hippocampus must be active while a rat rears, meaning stands up on its hind legs to look around. The authors switched off the dorsal (upper) hippocampus only during rearing, then checked whether the rats' spatial memory suffered.

Most work on how the hippocampus supports spatial memory has looked at two states: moving around, and quiet rest such as grooming or eating. Rearing is common but little studied, and the paper argues it lets an animal take in more of distant cues and room boundaries. Rearing also comes with strong 7–12 Hz "high theta" rhythm in the hippocampus, a rhythm tied to memory, yet whether rearing matters for memory was unknown.

Rats ran a "delayed win-shift" task on a maze with eight arms radiating from a hub. In a study phase, four random arms opened with food; after a 4-minute break, all eight opened, and food sat only in the four new arms. The hippocampus carried halorhodopsin, a light-driven pump that silences neurons when lit. A 3D camera above the maze detected rearing in real time and fired a laser into the brain, but only during the study phase.

Each rat ran three light conditions, one trial a day, in shuffled order. In "Off", no light was delivered, giving baseline performance. In "Rear", light was on for exactly the length of each rear. In "Delay", light lasted just as long but started and stopped 6 seconds after the rear, so total silencing matched without lining up with rearing. A control group carried only a glowing marker protein, not the silencing pump, to rule out effects of light itself.

In the six analysed experimental rats, "percent correct", the share of the first four test choices that found food, fell from 77.7% (Off) to 65.7% (Rear). They also needed more arm visits to find all the food: 6.5 versus 5.1. Delay gave 72.0% correct, not a reliable drop, and only a borderline rise in arm visits to 5.9. The seven control rats showed no effect in any condition.

The authors flag limits: the 6-second delay still overlapped about 35.5% of rearing time, so Delay was not fully separated from rearing. Nearly all rears were braced against a wall, and the study cannot say whether free-standing rears differ. It also cannot say whether every rear matters, or whether the same memory storing could happen without rearing.

Why might silencing hurt? The authors suggest rearing may update the brain's internal model of the surroundings, and silencing may have blocked that. Since the rats already knew the room well, any updating was likely about today's open arms, kept apart from earlier days.

The conclusion: rearing is a period when the hippocampus stores spatial memories, and disrupting it then is enough to impair memory in this task. The authors say this directly supports an earlier proposal that rearing can serve as a behavioural marker of hippocampal learning.

## P15

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This review asks how groups of brain cells, or neurons, actually combine and transform the signals they receive. It introduces a math tool called partial information decomposition (PID), which splits apart the different ways several input neurons can inform one receiving neuron. It also summarizes the authors' own experiments using the tool.

The authors call understanding how brains process information a grand challenge of modern neuroscience. Two things held it back: too little data, and no good way to analyze it. New recording devices now capture hundreds or thousands of neurons at once, so the data problem has eased. PID is offered as a partial answer to the analysis problem.

The starting tool is transfer entropy: how much one neuron's past helps predict another neuron's next step, beyond what that neuron's own past predicts. This tracks information flowing, but not how two streams combine. PID takes two inputs and one target and splits what they tell us about the target into parts. Redundant information is what either input alone reveals, unique information comes from only one input, and synergy appears only when both inputs are seen together.

The authors grew slices of mouse cortex and recorded hundreds of neurons with a 512-channel electrode array. Using transfer entropy, they found that only 0.4–1.0% of possible neuron-to-neuron links were significant. They then ran PID on thousands of triads, meaning two source neurons feeding one target neuron. Across 25 recordings, synergy in a triad was reliably about a quarter of its transfer entropy.

Several features of a triad predicted how much synergy it showed. Triads in the rich club, the best-connected neurons that link to each other more than chance, had 2.7 times more synergy; under 40% of neurons produced about 88% of all synergy. Triads with two links between the source neurons had 50% more synergy than the simplest triads, while two links back from target to sources meant 10% less. Synergy rose as the two sources fired more alike, but peaked when their shared information was about 7% of the maximum, then fell as redundancy took over.

A later study recorded movement-related brain areas in three macaque monkeys doing a reach-and-grasp task. It repeated key results, including a rich club and more synergy in well-connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during movement, possibly to send the move signal reliably.

The authors name limits: analyzing links two neurons at a time can overstate them, and cultured slices are not working brains. PID shows statistical patterns, not the biological cause behind them. The number of parts explodes with more inputs: six input neurons give 7,828,354 parts, making a full account of a real neuron impossible. There is also no agreed way to measure redundancy, which the whole method depends on.

The main conclusion is that neurons do not just add up their inputs; they respond to particular patterns of input. How much synergy they show depends on their place in the network and on what the animal is doing. The authors see promise in newer versions of PID that track moment-to-moment changes or handle several targets at once.

### Summary B

This review asks how groups of brain cells actually process information, not just pass it along. It gives a beginner-friendly guide to a maths tool called partial information decomposition, or PID, and shows what it has found in real neurons. The authors draw mostly on their own studies and add their view of where the field should go.

The authors call understanding how brains process information a grand challenge of modern neuroscience. Two things held this work back. One was a lack of data, now eased by tools that record hundreds or thousands of neurons at once. The other was a lack of ways to analyse that data, which is the gap PID helps fill.

Older measures track how activity spreads from one neuron to another. The main one, transfer entropy, asks how much a source neuron's past helps predict a target's next step, beyond the target's own past. PID goes further by splitting what two source neurons tell us about a target into parts. Redundant information comes from either source, unique information from only one, and synergistic information only from both sources' joint pattern. The authors treat synergy as a sign of real processing, or computation.

In their lab work, the team grew slices of mouse brain cortex and recorded hundreds of neurons on 512-electrode grids. They mapped who drives whom using transfer entropy, finding about 0.4 to 1.0% of possible links significant. They then ran PID on thousands of triads: two source neurons feeding one target. Across 25 recordings, synergy rose with information flow and was reliably about a quarter of a triad's transfer entropy.

Three further patterns showed where synergy gathers. Triads inside the rich club, a core of best-connected neurons, had 2.7 times the synergy and held about 88% of it, despite under 40% of neurons. Triads with two links between the sources had 50% more synergy, while two links back from the target meant 10% less. Synergy grew as the two sources' activity became more alike, but peaked when that likeness reached about 7% of its maximum, then fell.

A study of three monkeys doing a reach-and-grasp task repeated many of these results in living animals. Activity was mostly synergy-led, but redundancy rose sharply during movement. The authors suggest the brain may copy the move signal many times so it reaches the muscles reliably.

The authors name clear limits. The slice studies used a two-neuron method known to overstate links, and brain slices in a dish do not face a behaving animal's demands. With six source neurons, PID yields 7,828,354 parts, so fully describing a real neuron is out of reach. PID also spots statistical patterns without explaining the biology that causes them.

The main conclusion is that neurons do not simply add up their inputs; they respond to the patterns those inputs form. How much synergy appears depends on a neuron's place in the network and on what the animal is doing.

## P16

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a perspective essay by biologist Michael Levin, built on examples from developmental biology, evolution, bioengineering and neuroscience rather than new experiments. Its claim is that memory exists to preserve salience, meaning what matters for acting, not fidelity to the original details. Levin coins "mnemonic improvisation" for an agent's ability to rewrite stored information and remap it onto new bodies and contexts. He argues this happens at every scale, from cells to whole lineages.

The essay starts from a paradox: a self that never changes cannot learn, but a self that changes seems to stop being itself. Levin says this rests on pure logic, so it applies to any agent, including engineered intelligences, AI and artificial life. His answer, echoing process philosophy and Buddhist thought, is to treat the self as an ongoing process, not a fixed thing. Biology, he argues, already bet on this, because its own parts mutate, age, get cancer and get hijacked by other organisms.

Levin pictures a mind as a series of "Selflets", thin slices of self each probably a few hundred milliseconds long. Memories are then notes left by a past slice for a future one, and like any message they must be interpreted. So confabulation, usually treated as a bug in brains and AI, is recast as a core feature of sense-making.

The biological cases he leans on show information being reinterpreted, not just stored. Some caterpillar memories survive metamorphosis, yet a leaf-eater's specific lessons only help a nectar-drinking butterfly if generalised and remapped. An odorant injected into a frog egg leads the grown animal to seek that odour when looking for food. Newts with much larger cells still build normal-width kidney tubes, using fewer cells, or one huge cell bending around itself.

The unifying pattern is what he calls a bowtie architecture: rich data squeezed through a narrow bottleneck, then re-expanded, as in an autoencoder. An organism shrinking into one egg and rebuilding a body is his prime example. Good compression strips correlations, so the stored trace looks increasingly random, and decoding it without metadata must be creative, not just deductive. Planarian flatworms have very noisy genomes yet resist ageing, cancer and injury; he proposes they override genetic details with large-scale pattern completion.

The boldest step questions the line between passive data and the minds that use it, following William James's phrase "thoughts are thinkers". Memories, as active patterns, might have minimal agency and help shape the mind that later reads them. He also asks whether memories act as "cognitive glue", binding parts into a whole self: a rat's lever-reward link belongs to no single cell. His lab is testing this by training memories into gene-regulatory network models and measuring whether the system becomes more integrated.

Levin says he states the strongest version on purpose, and a more moderate middle view may prove most useful. He admits nobody yet knows how this plasticity works. He also flags reports of memories carried by heart or lung transplants as uncertain.

His conclusion is that intelligence arose because of, not despite, unreliable biological material. This works through polycomputing: the same physical process serving different functions depending on which agent interprets it. He says the lessons should inform truly bio-inspired AI, and that the self is a construction: a working story holding parts together.

### Summary B

This is a perspective essay by biologist Michael Levin about what memory is for. Most research asks how memories are stored and read back accurately; Levin argues that agents must keep reinterpreting and rewriting them as they and their world change. His slogan is that memory preserves salience, not fidelity: what a memory means for the agent, not its exact details. He draws on developmental biology, evolution and bioengineering as well as neuroscience.

Levin starts from a paradox: a species or self that never changes cannot learn, but one that changes seems to stop being itself. His answer, echoing process philosophy and Buddhist ideas, is to treat the self as an ongoing process rather than a fixed thing. Living parts are unreliable: they mutate, age, turn cancerous and get hijacked by other organisms. He claims this unreliability is not a flaw but the source of intelligence, which matters for anyone engineering new kinds of minds.

The first evidence is human confabulation, recast as a feature rather than a bug. Patients made to laugh by brain stimulation say they thought of a joke, and the brain fills in the blind spot and back-dates invented colours. Levin pictures a mind as a series of Selflets, slices of self perhaps a few hundred milliseconds thick. Each memory is then a note left by a past Selflet, which the present one must interpret like a message from someone else.

Caterpillars largely dismantle their brains, yet butterflies keep some trained memories, though a lesson about leaves is useless to a nectar drinker. So the memory must be generalised and remapped onto a new body, not merely stored. Brain extract from trained sea slugs, injected roughly near an untrained slug's nervous tissue, changes its behaviour. An odour molecule injected into a frog egg makes the grown animal seek that odour when looking for food. Levin concludes that memory traces act less like recordings and more like prompts, with the receiver doing the interpreting.

He generalises this as a bowtie architecture: rich information squeezed through a narrow bottleneck, then re-expanded, as in an autoencoder. Each animal compresses itself into an egg, which must rebuild a body from possibly mutated parts in a possibly different world. Newts with much larger cells still build normal-width kidney tubules, from fewer cells or even one cell bending around itself. Planaria, flatworms with very noisy genomes, are highly regenerative and cancer-resistant, which Levin attributes to overriding genetic details with large-scale pattern completion.

The boldest claim is that memories may themselves have a small degree of agency. Following William James's line that "thoughts are thinkers", Levin asks whether thought patterns actively help minds remap and use them. He also proposes memories as cognitive glue binding parts into a whole: a rat's lever-reward memory belongs to no single cell, only the rat. His lab is training memories into gene-regulatory network models to see whether the system becomes more integrated.

The essay argues from examples and analogy, and Levin says he deliberately states the strongest version of his claims. He allows that a more moderate middle position may prove most useful. Some cited evidence is shaky; reported memory transfer through heart or lung transplants is called uncertain. Proposed tests include moving pattern memories between planaria, with only unpublished preliminary data so far, and moving nicotine addiction from human donors into rats.

Levin traces a chain: behavioural intelligence grew from problem-solving in body building, which damage and mutation made necessary. That creativity rests on polycomputing, where one physical process serves different functions depending on which of many layered agents interprets it. Unlike computers built to store data faithfully for one reading, biology commits to reinterpreting on the fly. His conclusion is that the self life defends is a construction: an adaptive story that holds parts together and guides action.

## P17

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

This is a review paper that gathers past research and proposes a new idea about cognitive control: the brain's ability to steer thinking and action toward a goal. Much of this ability depends on the prefrontal cortex, the front part of the brain. The authors picture it as a filter that keeps useful information and weakens or discards the rest. Their idea is called the Matched Filter Hypothesis: performance is best when the amount of filtering matches what the task needs.

The common view treats more control as better, but the authors say a growing body of research shows that not every kind of thinking benefits from it. Take a guessing game where one choice pays off 75% of the time. Adults pick it 75% of the time and win about 62.5% of rounds; children pick it every time and win 75%. Since adults' habit may involve control, here control seems to hurt.

The hypothesis says high control suits tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory, the small amount we can hold in mind at once. Low control suits tasks that are implicit, driven by rewards, intuitive, or too complex for working memory. The authors call reduced prefrontal activity "hypofrontality" and argue it helps such tasks by letting more raw information through. How well a person matches control to a task may depend on age, genes, brain damage, a second task, or brain stimulation.

For learning, the authors gather several lines of evidence. Doing a second task at the same time, or briefly dampening part of the prefrontal cortex with magnetic pulses, helped adults learn some hard-to-put-into-words rules and movements. In "blocking", an early-learned cue stops people learning a later one; 3-year-olds show less blocking than 4-year-olds, fitting the idea that control speeds learning but distorts it. Learning a made-up language from messy input, adults copied the mess, while children used only the most frequent form and did better.

Creativity shows a similar pattern when ideas must come from raw features like shape or material. People inventing unusual uses for objects showed lower prefrontal activity and more activity in visual areas. A weak electrical current that dampened the left prefrontal cortex made people produce creative uses faster and in greater number. Children also get stuck less than adults on an object's usual purpose, though no study has tied this to brain development. Judging whether an idea actually works, however, likely needs control again.

The authors name clear limits. Children's learning advantages cannot be blamed on weaker prefrontal function alone, since children also differ in knowledge and strategies. Some prefrontal function is essential, so less is not always better, and the brain mechanisms behind the matching remain unknown. Studies on creativity are few, and direct evidence in adults is sparse.

The core lesson is that filtering input always has a cost: it can help in one situation and harm in another. The authors conclude that cognitive control is a tool suited to some common challenges, not an all-purpose system for every problem.

## P18

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a review of how one tool from multivariate information theory can show how groups of neurons process information. The tool is partial information decomposition (PID), which splits what several inputs tell you about a target into separate parts. The authors draw mostly on their own lab's work and present it as an approachable overview, not an exhaustive survey.

The authors call working out how brains process information a grand challenge, and say how sensory information gets transformed is poorly understood. Two things held the field back: too little data, and too few ways to analyse it. New recording technology now captures hundreds or thousands of neurons at sub-millisecond resolution, which largely fixes the data problem. Measures of information flow show how much passes between neurons, but not how separate streams combine into something new.

Take two input neurons feeding one target, and the information they jointly carry about its next state. PID splits it into redundant information (either input alone reveals it), unique information (only one input does), and synergy (only both together do). The authors treat synergy as their measure of real processing or computation. The maths leaves three known values and four unknowns, so you must choose a definition of redundancy. About a dozen rival definitions exist; most studies here used the original one, called Imin, which critics say can behave unintuitively.

The lab grew slices of mouse cortex and recorded hundreds of neurons with 512-electrode arrays. They mapped who drives whom using transfer entropy, a measure of how much one neuron's past predicts another's next step. Only 0.4–1.0% of possible connections were significant, but that still gave thousands of two-input triads to analyse. Across 25 recordings, a triad's synergy tracked its information flow, reliably at about a quarter of its transfer entropy.

Three patterns linked synergy to how the network is wired and how it fires. Triads in the rich club, a tightly linked core of well-connected neurons, had 2.7 times more synergy; under 40% of neurons produced about 88% of it. Two links between the inputs meant 50% more synergy, while two links from target back to inputs meant 10% less. Synergy peaked when the inputs' mutual information was about 7% of its maximum; past that, inputs became mostly redundant.

A follow-up study recorded motor areas in three macaque monkeys during a multi-step reaching task. It repeated key results from the slices, including a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during the reach itself. The authors read this as the brain possibly copying the move signal to make transmission reliable.

The authors name clear limits: the slice networks used pairwise methods known to overstate connections, and slices are not behaving animals. PID finds statistical patterns but does not explain the biology that produces them. It also scales badly: six inputs give 7,828,354 distinct parts, most hard to interpret.

The main conclusion is that neurons do not just add up their inputs and fire past a threshold. They respond to particular patterns of input, and how much they do depends on their place in the network and on the animal's behaviour.

### Summary B

This review explains how one branch of information theory can show how groups of neurons combine their inputs. Its central tool is partial information decomposition (PID), which splits the information several inputs give about an output into separate kinds. The authors aim at newcomers inside and outside neuroscience, and they draw mostly on their own recent studies.

The authors call working out how brains process information a grand challenge, and say little is known about how sensory signals get transformed. They name two past barriers: too little data, and no good way to analyse it. New electrical and optical recordings of hundreds or thousands of neurons have largely removed the first barrier. Measures of information flow, such as transfer entropy, still cannot show how separate streams interact, and PID is offered as the fix.

Take two input neurons feeding one target. PID divides what they jointly tell us about the target into three parts. Redundant information is what either input alone reveals, unique information comes from just one of them, and synergy appears only from both together. The authors treat synergy as a sign of the target doing a real computation on its combined inputs. Standard information theory cannot pin these parts down, so a separate definition of redundancy must be chosen.

The main studies used 512-channel electrode arrays to record hundreds of neurons in cultured slices of mouse cortex. Transfer entropy linked neurons into a network, with only 0.4 to 1.0% of possible connections proving significant. PID was then run on thousands of triads, each two source neurons feeding one target. Across 25 recordings, synergy tracked feedforward information flow closely, landing at about a quarter of each triad's transfer entropy.

Three patterns describe where synergy collects in these cultures. Triads inside the rich club, the tightly linked core of busiest neurons, had 2.7 times more synergy; under 40% of neurons produced about 88% of all synergy. Two links between the source neurons meant 50% more synergy, while two links back from the target meant 10% less. Synergy grew as the sources' activity became more alike, peaking near 7% of maximum shared information; past that, redundancy took over.

A follow-up recorded motor areas in three macaques during a multi-step task, using a stricter multivariate network method. It again found a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during reaching and grasping, perhaps to send the movement signal reliably.

The authors list limits: the culture networks came from pairwise analyses, which overstate connections, and cultures differ from behaving animals. No redundancy measure is widely agreed, and the one most of these studies used has been criticised. The number of parts explodes with more inputs: six source neurons give 7,828,354 parts. PID also finds statistical patterns without explaining the biology behind them.

The main conclusion is that neurons do not simply add up inputs and fire past a threshold; they respond to input patterns. How much synergy appears depends on a neuron's place in the network and on the animal's behaviour. The authors point to moment-by-moment and multi-target versions of PID as promising next steps.

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

This is a review of how one tool from multivariate information theory can show how groups of neurons process information. The tool is partial information decomposition (PID), which splits what several inputs tell you about a target into separate parts. The authors draw mostly on their own lab's work and present it as an approachable overview, not an exhaustive survey.

The authors call working out how brains process information a grand challenge, and say how sensory information gets transformed is poorly understood. Two things held the field back: too little data, and too few ways to analyse it. New recording technology now captures hundreds or thousands of neurons at sub-millisecond resolution, which largely fixes the data problem. Measures of information flow show how much passes between neurons, but not how separate streams combine into something new.

Take two input neurons feeding one target, and the information they jointly carry about its next state. PID splits it into redundant information (either input alone reveals it), unique information (only one input does), and synergy (only both together do). The authors treat synergy as their measure of real processing or computation. The maths leaves three known values and four unknowns, so you must choose a definition of redundancy. About a dozen rival definitions exist; most studies here used the original one, called Imin, which critics say can behave unintuitively.

The lab grew slices of mouse cortex and recorded hundreds of neurons with 512-electrode arrays. They mapped who drives whom using transfer entropy, a measure of how much one neuron's past predicts another's next step. Only 0.4–1.0% of possible connections were significant, but that still gave thousands of two-input triads to analyse. Across 25 recordings, a triad's synergy tracked its information flow, reliably at about a quarter of its transfer entropy.

Three patterns linked synergy to how the network is wired and how it fires. Triads in the rich club, a tightly linked core of well-connected neurons, had 2.7 times more synergy; under 40% of neurons produced about 88% of it. Two links between the inputs meant 50% more synergy, while two links from target back to inputs meant 10% less. Synergy peaked when the inputs' mutual information was about 7% of its maximum; past that, inputs became mostly redundant.

A follow-up study recorded motor areas in three macaque monkeys during a multi-step reaching task. It repeated key results from the slices, including a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during the reach itself. The authors read this as the brain possibly copying the move signal to make transmission reliable.

The authors name clear limits: the slice networks used pairwise methods known to overstate connections, and slices are not behaving animals. PID finds statistical patterns but does not explain the biology that produces them. It also scales badly: six inputs give 7,828,354 distinct parts, most hard to interpret.

The main conclusion is that neurons do not just add up their inputs and fire past a threshold. They respond to particular patterns of input, and how much they do depends on their place in the network and on the animal's behaviour.

## P20

The reader is a bright first-year university student who has not studied this field. They have not read the piece.

### Summary A

This research paper asks whether a Transformer, a type of neural network built for language, can recognise what is in a picture with almost no changes. The authors cut each image into small square patches and feed them in the way words of a sentence would be fed in. They call the result the Vision Transformer, or ViT, and train it to label images.

In language, Transformers have become the standard tool, and they keep improving as models and datasets grow, with some passing 100 billion parameters. In vision, convolutional networks, or CNNs, still lead; they scan small windows across an image. Earlier attempts to bring attention into vision used special designs that were hard to run fast on modern chips. A plain Transformer could reuse the efficient tools already built for language.

Each patch, often 16 by 16 pixels, is flattened into a list of numbers and turned into a fixed-length vector by a learned linear step. A learned position code is added so the model knows where each patch came from. An extra learned "class token" is placed at the front, and its final state is used to decide the image's label.

The key idea is inductive bias: built-in assumptions about images, such as nearby pixels mattering together, which CNNs have and ViT mostly lacks. Trained on ImageNet, about 1.3 million images, ViT scores a few points below CNNs of similar size. With ImageNet-21k (14 million images) the gap closes, and with JFT-300M (303 million images) ViT pulls ahead. Tests on 9-million to 300-million-image subsets show ViT overfits small data more but wins from 90 million up.

After pre-training on lots of data, then fine-tuning, meaning extra training on a smaller target task, the main results are: The best model reaches 88.55% on ImageNet, 94.55% on CIFAR-100, and 77.63% across 19 VTAB tasks. It used 2.5k TPU core-days to pre-train, against 9.9k for the strongest CNN rival, BiT-L. In a controlled scaling study, ViT needed about 2 to 4 times less compute for the same accuracy, and showed no sign of levelling off.

Looking inside, the position codes learn the image's 2D layout by themselves, so nearby patches get similar codes. Some attention heads look across most of the image even in the first layers, while others stay local, rather like early CNN layers.

The authors note that training efficiency may also depend on choices like schedule and optimiser, not only the design. Self-supervised pre-training, learning by guessing hidden patches without labels, reached 79.9% on ImageNet, still 4% behind labelled pre-training. Applying ViT to tasks like finding and outlining objects remains to be done.

The conclusion is that a standard Transformer, treating an image as a sequence of patches, matches or beats top CNNs when pre-trained on large datasets. It does so while being relatively cheap to pre-train, and the authors expect further scaling to help.

### Summary B

This research paper from Google asks whether image recognition really needs convolutional neural networks (CNNs), the network design that has long dominated computer vision. Instead, it tests a plain Transformer, the design now standard in language processing, applied to images with as few changes as possible. The authors call their model the Vision Transformer, or ViT.

In language work, Transformers are first pre-trained on huge text collections, then fine-tuned, or adjusted, on smaller tasks. They have grown past 100 billion parameters with no sign of performance levelling off. In vision, CNNs still lead, and earlier attempts to replace them used special attention patterns that have not scaled well on modern hardware. If a standard Transformer works, existing efficient language tools can be reused almost out of the box.

The trick is to cut each image into fixed-size square patches, for example 16 by 16 pixels, and treat each patch like a word. Each patch becomes a list of numbers, and a learned position embedding, a code marking where the patch sits, is added to it. An extra learnable "classification token" goes at the front, and its final state is used to decide what the image shows. A name like ViT-L/16 means the Large model with 16-by-16 patches; smaller patches mean longer sequences and more computing.

The paper's central idea is inductive bias: assumptions about images that are built into a model's design. CNNs build in that nearby pixels belong together and that a pattern means the same wherever it appears; ViT builds in very little of this. So ViT must learn how patches relate in space from the data itself. Trained only on ImageNet, a standard set of 1.3 million labelled photos, ViT scores a few percentage points below ResNets, a common CNN, of similar size.

Two experiments tested how much training data ViT needs. Pre-trained on ImageNet, then ImageNet-21k (14 million images), then Google's private JFT-300M (303 million), larger ViT models only clearly beat smaller ones on JFT-300M. On random slices of JFT-300M, ViT-B/32 did much worse than a similarly priced ResNet50 on 9 million images, but better from 90 million upward.

After pre-training on JFT-300M, the best model, ViT-H/14, reached 88.55% accuracy on ImageNet, 94.55% on CIFAR-100, and 77.63% on VTAB, a suite of 19 small-data tasks. The previous best CNNs, BiT-L and Noisy Student, scored 87.54% and about 88.5% on ImageNet. ViT-H/14 took 2.5 thousand TPUv3-core-days of Google chip time to pre-train, against 9.9 thousand and 12.3 thousand for those two. The authors caution that training schedule, optimizer and similar settings may also affect this efficiency.

A controlled comparison found ViT needs roughly 2 to 4 times less compute than ResNets for the same performance. Hybrids, which feed CNN features into ViT, helped at small budgets, but the gap vanished for larger models, and ViT showed no sign of levelling off. Inside the model, the position embeddings came to reflect the image's rows and columns. Some attention heads already took in most of the image in the lowest layers.

A first try at self-supervised pre-training, learning without labels by hiding patches and predicting them, gave 79.9% on ImageNet: 2% above no pre-training, 4% below labelled pre-training. The paper names open challenges: applying ViT to detection and segmentation, and closing that self-supervised gap. Its conclusion is that large-scale training trumps inductive bias: given enough data, a standard Transformer matches or beats top CNNs while being relatively cheap to pre-train. The authors expect further scaling would likely improve it more.

## P21

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This review explains a method for measuring how neurons combine information, and surveys what it has revealed so far. The method is partial information decomposition (PID), which splits the information several input neurons carry about one target neuron into separate parts. The authors call understanding how brains process information a grand challenge, long held back by too little data and too few analysis tools. Existing measures such as transfer entropy, which asks how much one neuron's past predicts another's next state, track flow but not how streams interact.

PID is easiest to see with two source neurons feeding one target. Their information about the target splits into redundant parts (either source alone tells you), unique parts (only one tells you) and synergistic parts (only both together tell you). The authors treat synergy as their measure of real processing, or computation, by the target. No single way to measure redundancy is accepted, and close to a dozen compete. Most studies here used the original one, called Imin, even though it has been criticised for odd behaviour.

In the authors' main experiments, thin slices of mouse cortex were grown in culture on a 512-electrode array, recording hundreds of single neurons. They used transfer entropy to map which neurons influenced which; only 0.4–1.0% of possible links were significant. They then ran PID on thousands of triads: two source neurons that both link to one shared target.

Comparing triads within each recording gave three main patterns. Synergy rose with the information flowing from sources to target, reliably at about a quarter of that flow, across 25 recordings. Triads in the rich club, well-connected neurons that link to each other unusually densely, had 2.7 times the synergy and produced about 88% of it. Triads with two links between their sources had 50% more synergy than the simplest triads, while two links back from the target meant 10% less.

The team also asked whether similar inputs boost synergy. At fast timescales under 14 ms, more mutual information between the two sources meant more synergy. With time bins up to 2.25 s wide, synergy peaked when that mutual information was about 7% of its maximum, then fell. Redundancy kept rising instead, suggesting that inputs past some level of similarity simply repeat each other.

Varley and colleagues applied the approach to three macaques doing a task with phases for recognising a symbol, planning, remembering and moving. Using a stricter, multivariate way to build the network, they still found a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during the reach-and-grasp movement. The authors read this as the brain copying the "move" signal so it reaches the muscles reliably.

The authors name several limits. The mouse networks came from pairwise transfer entropy, which overstates links, and cultures face different demands than circuits in a behaving animal. PID reveals statistical patterns, not the biology that causes them. It also scales badly: six input neurons already give 7,828,354 distinct parts, most hard to interpret.

The main conclusion is that neurons do not just add up inputs and fire past a threshold; they respond to particular input patterns. Where synergy appears depends on a neuron's place in the network and on what the animal is doing. The authors point to extensions, such as tracking PID moment by moment, as promising next steps.

### Summary B

This review explains how one branch of information theory can show how groups of neurons combine their inputs. Its central tool is partial information decomposition (PID), which splits the information several inputs give about an output into separate kinds. The authors aim at newcomers inside and outside neuroscience, and they draw mostly on their own recent studies.

The authors call working out how brains process information a grand challenge, and say little is known about how sensory signals get transformed. They name two past barriers: too little data, and no good way to analyse it. New electrical and optical recordings of hundreds or thousands of neurons have largely removed the first barrier. Measures of information flow, such as transfer entropy, still cannot show how separate streams interact, and PID is offered as the fix.

Take two input neurons feeding one target. PID divides what they jointly tell us about the target into three parts. Redundant information is what either input alone reveals, unique information comes from just one of them, and synergy appears only from both together. The authors treat synergy as a sign of the target doing a real computation on its combined inputs. Standard information theory cannot pin these parts down, so a separate definition of redundancy must be chosen.

The main studies used 512-channel electrode arrays to record hundreds of neurons in cultured slices of mouse cortex. Transfer entropy linked neurons into a network, with only 0.4 to 1.0% of possible connections proving significant. PID was then run on thousands of triads, each two source neurons feeding one target. Across 25 recordings, synergy tracked feedforward information flow closely, landing at about a quarter of each triad's transfer entropy.

Three patterns describe where synergy collects in these cultures. Triads inside the rich club, the tightly linked core of busiest neurons, had 2.7 times more synergy; under 40% of neurons produced about 88% of all synergy. Two links between the source neurons meant 50% more synergy, while two links back from the target meant 10% less. Synergy grew as the sources' activity became more alike, peaking near 7% of maximum shared information; past that, redundancy took over.

A follow-up recorded motor areas in three macaques during a multi-step task, using a stricter multivariate network method. It again found a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during reaching and grasping, perhaps to send the movement signal reliably.

The authors list limits: the culture networks came from pairwise analyses, which overstate connections, and cultures differ from behaving animals. No redundancy measure is widely agreed, and the one most of these studies used has been criticised. The number of parts explodes with more inputs: six source neurons give 7,828,354 parts. PID also finds statistical patterns without explaining the biology behind them.

The main conclusion is that neurons do not simply add up inputs and fire past a threshold; they respond to input patterns. How much synergy appears depends on a neuron's place in the network and on the animal's behaviour. The authors point to moment-by-moment and multi-target versions of PID as promising next steps.

## P22

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a perspective essay by biologist Michael Levin about what memory is for. Most research asks how memories are stored and read back accurately; Levin argues that agents must keep reinterpreting and rewriting them as they and their world change. His slogan is that memory preserves salience, not fidelity: what a memory means for the agent, not its exact details. He draws on developmental biology, evolution and bioengineering as well as neuroscience.

Levin starts from a paradox: a species or self that never changes cannot learn, but one that changes seems to stop being itself. His answer, echoing process philosophy and Buddhist ideas, is to treat the self as an ongoing process rather than a fixed thing. Living parts are unreliable: they mutate, age, turn cancerous and get hijacked by other organisms. He claims this unreliability is not a flaw but the source of intelligence, which matters for anyone engineering new kinds of minds.

The first evidence is human confabulation, recast as a feature rather than a bug. Patients made to laugh by brain stimulation say they thought of a joke, and the brain fills in the blind spot and back-dates invented colours. Levin pictures a mind as a series of Selflets, slices of self perhaps a few hundred milliseconds thick. Each memory is then a note left by a past Selflet, which the present one must interpret like a message from someone else.

Caterpillars largely dismantle their brains, yet butterflies keep some trained memories, though a lesson about leaves is useless to a nectar drinker. So the memory must be generalised and remapped onto a new body, not merely stored. Brain extract from trained sea slugs, injected roughly near an untrained slug's nervous tissue, changes its behaviour. An odour molecule injected into a frog egg makes the grown animal seek that odour when looking for food. Levin concludes that memory traces act less like recordings and more like prompts, with the receiver doing the interpreting.

He generalises this as a bowtie architecture: rich information squeezed through a narrow bottleneck, then re-expanded, as in an autoencoder. Each animal compresses itself into an egg, which must rebuild a body from possibly mutated parts in a possibly different world. Newts with much larger cells still build normal-width kidney tubules, from fewer cells or even one cell bending around itself. Planaria, flatworms with very noisy genomes, are highly regenerative and cancer-resistant, which Levin attributes to overriding genetic details with large-scale pattern completion.

The boldest claim is that memories may themselves have a small degree of agency. Following William James's line that "thoughts are thinkers", Levin asks whether thought patterns actively help minds remap and use them. He also proposes memories as cognitive glue binding parts into a whole: a rat's lever-reward memory belongs to no single cell, only the rat. His lab is training memories into gene-regulatory network models to see whether the system becomes more integrated.

The essay argues from examples and analogy, and Levin says he deliberately states the strongest version of his claims. He allows that a more moderate middle position may prove most useful. Some cited evidence is shaky; reported memory transfer through heart or lung transplants is called uncertain. Proposed tests include moving pattern memories between planaria, with only unpublished preliminary data so far, and moving nicotine addiction from human donors into rats.

Levin traces a chain: behavioural intelligence grew from problem-solving in body building, which damage and mutation made necessary. That creativity rests on polycomputing, where one physical process serves different functions depending on which of many layered agents interprets it. Unlike computers built to store data faithfully for one reading, biology commits to reinterpreting on the fly. His conclusion is that the self life defends is a construction: an adaptive story that holds parts together and guides action.

### Summary B

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how data is stored and read back reliably; Levin instead asks how agents reinterpret and rewrite memories to fit a changing self and world. His core claim is that memory preserves salience, meaning what matters, rather than fidelity to the original details. He frames this with a paradox: a species or person that never changes cannot learn, yet one that changes seems to stop being itself.

Levin says the paradox rests on pure logic, so it applies at every scale, from parts of cells to whole lineages, and to AI and artificial life. He argues that confabulation, usually treated as a bug in AI and in court witnesses, is actually a deep and useful feature of living systems. Biology, he says, solved the paradox by treating the Self as a process, not a fixed thing.

The argument draws on published studies rather than new experiments, and several show memory surviving radical change. Some trained memories survive a caterpillar's brain being rebuilt into a butterfly's, though leaf-related details are useless to a nectar drinker, so the lesson must be remapped. In Aplysia sea slugs, brain extract from trained animals, injected only near the right nervous tissue, still changes the recipient's behavior. An odorant injected into a frog egg leads the grown animal to seek that odor when looking for food. Levin reads these engrams, or memory traces, as less like stored records and more like prompts, with the decoding doing the hard work.

He generalizes this as a bowtie architecture: complex states squeezed into a compact code, then re-expanded, as in an autoencoder. An egg is such a bottleneck, re-inflating into a body that may meet a different world with different parts. Because good compression removes correlations, the code looks increasingly random, so decoding it must be creative, not just deductive. So the same voltage-changing drug, Monensin, triggers tails to grow in tadpoles but legs in froglets.

Newts engineered with extra chromosomes and larger cells still build kidney tubes of normal width, using fewer cells, or one huge cell bending around itself. Planarian flatworms have very noisy genomes yet resist aging, cancer and injury; Levin credits a strong willingness to confabulate in body shape. Because competent parts hide genome flaws from selection, he argues, evolution invests in competency, creating an intelligence ratchet driven by unreliable matter.

The most speculative step blurs data and processor: memories might have minimal agency, echoing William James's line that "thoughts are thinkers". He also asks whether memories act as cognitive glue: a rat's lever-reward memory belongs to no single cell, only to the whole animal. He proposes that consciousness may be felt uncertainty about one's own memories and internal states.

Levin says he deliberately gave the strongest versions of these claims, and a more moderate hybrid with the conventional view may prove more useful. He flags claims of memory transfer via heart or lung transplants as uncertain. Proposed tests include moving memories between gene-network models and moving nicotine addiction from human donors through Anthrobots into rats.

Levin concludes that the Self is a construction: an adaptive story that holds parts together and lets them navigate problems. Organisms that cannot handle novelty in their own parts and memories, not just their surroundings, will not be evolvable. Real observers are committed to meaning over accurate detail, and he holds that this capacity need not be biological and likely can be engineered.

## P23

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a review and theory paper about when the brain's top-down control helps and when it hurts. The authors treat cognitive control, driven largely by the prefrontal cortex (PFC), as a filter that keeps task-relevant input and discards the rest. Borrowing loosely from signal processing, they propose a Matched Filter Hypothesis (MFH): performance is best when the amount of filtering matches what the task needs.

The standard view links PFC to the most complex cognition, so more control looks like it should always be better. The authors argue that a growing body of research shows otherwise. In one probabilistic choice task, adults match probabilities and expect 62.5% success, while children always pick the best option and expect 75%. Some probability matching may involve executive function, so control can paradoxically make adults worse here.

The MFH predicts high control helps tasks that are explicit, rule-based, abstract, and small enough to hold in working memory. Low control, called hypofrontality, helps tasks that are implicit, stimulus-driven, hard to abstract, and too complex for working memory. The level reached depends on competition between PFC and posterior or subcortical systems, shaped by age, genes, brain damage, dual tasks or brain stimulation. How the brain picks the right level is deliberately set aside.

For learning, the paper gathers mostly indirect evidence that less control can help. A distracting second task helps adults learn hard-to-verbalise rules, motor sequences and decision boundaries; disrupting dorsolateral PFC with magnetic stimulation improved implicit motor learning. Three-year-olds show less blocking than four-year-olds, and 8–9-year-olds less highlighting than adults: attention shifts that cut errors fast but distort learned associations. Adult language learners' "frozen" word forms improve when a concurrent task taxes working memory.

The authors link this to competing learning systems: a PFC/caudate model-based system reliant on working memory versus a striatal model-free one. Low-working-memory learners beat high-capacity ones at nonverbalisable decision boundaries. Their summary: control buys short-term accuracy at a long-term cost to how faithful and complete the learning is.

For creativity, people inventing new uses for objects showed lower PFC activity and higher visual-area activity than people giving typical uses. Inhibitory stimulation over left PFC made creative use generation faster and more productive, but not control tasks. Children also resist functional fixedness, being stuck on an object's usual use, though no study has tied this to PFC development.

The authors name clear limits. Child advantages cannot be pinned on low PFC alone, since children also differ in knowledge and strategies. Reversal learning needs some PFC, and dopamine studies suggest an inverted-U, not a straight line. Creativity studies are few, patient results are inconsistent, and judging ideas likely needs control again.

The unifying point is that transforming input has a cost: a useful filter under one set of conditions is harmful under another. The authors conclude that cognitive control is a tool adapted to a subset of challenges, not an all-purpose optimiser.

### Summary B

This is a review and theory paper about cognitive control: the brain's ability to hold goals, block distraction and override habits, largely supported by the prefrontal cortex (PFC). The authors propose the Matched Filter Hypothesis: performance is best when the amount of control matches what the task needs, not when control is maximal. They treat control as filtering, where the PFC keeps task-relevant input and discards the rest, borrowing the signal-processing idea of a filter tuned to extract signal from noise.

Most research on control focuses on what goes wrong when it is weak, such as young children's trouble switching to a new strategy. The authors argue that a growing body of work shows not all complex thinking benefits from control. They set out to describe when limited control is actually an advantage, focusing on learning and creativity.

High control should help tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Hypofrontality, a state of reduced PFC activity, should help tasks that are implicit, reward-based, nonverbal or intuitive, and too complex for working memory. The level of control reached depends on competition between the PFC and posterior or subcortical systems, such as sensory cortex and the basal ganglia. Age, brain damage, genes, doing two tasks at once and brain stimulation can all shift that balance.

For learning, the authors gather several lines of evidence that less control can help. When one option pays off 75% of the time, adults pick it 75% of the time and win 62.5%, while children pick it always and win 75%. Younger children show less blocking, where a known cue stops a new cue being learned, and less highlighting, where a later-learned link is overweighted. The authors read this as adults steering attention to cut errors fast, at the cost of a distorted picture of how strongly cues predict outcomes. In artificial-language studies with noisy input, children produce only the most frequent form, while adults reproduce the noise.

The authors also point to competing learning systems: a PFC-and-caudate system for explicit rules and a striatal system for procedural, habit-like learning. People with low working memory learn category boundaries that cannot be put into words better than high-capacity people do. People also fail to learn a boundary that is partly verbal and partly not, suggesting one system runs at a time. The mature PFC may push adults toward the explicit system even when it suits the problem poorly.

For creativity, the claim is that producing new ideas needs unfiltered perceptual detail, such as an object's shape or material. In an fMRI study, people inventing unusual uses for objects showed lower PFC and higher visual-area activity than people listing typical uses. Dampening left PFC with weak electrical current made people faster and more prolific at unusual uses, but not on control tasks. Children resist functional fixedness, being stuck on an object's usual use, though no study yet links this to PFC development. Creativity studies are few, and judging whether an idea works likely still needs PFC control.

The authors say the main open problem is the exact neural mechanism that matches the filter to the task. Less PFC does not steadily improve learning: reversal learning needs some PFC, and dopamine studies find an inverted-U relationship with performance. Children's advantages may also stem from other differences, such as knowledge or learned strategies, not weak PFC alone.

The unifying point is that transforming input has a cost: a filter useful under one set of rewards can hurt under another. Learning that prizes fast error reduction may pay later in less complete, less faithful knowledge. The authors conclude that cognitive control is a tool fitted to a subset of common problems, not an all-purpose optimizer.

## P24

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This Google research paper tests whether a plain Transformer, with almost no changes, can classify images as well as convolutional networks (CNNs). Their model, the Vision Transformer (ViT), cuts an image into small square patches, such as 16x16 pixels, and treats each patch like a word token. It is trained with labels, in the usual supervised way, to sort images into classes.

The authors point out that language models have scaled past 100B parameters with no sign of performance levelling off. In vision, CNN-style ResNets still led large-scale recognition, and earlier attention-only models used special attention patterns that ran poorly on modern hardware. Keeping the standard Transformer means existing, efficient language-model code can be reused almost unchanged.

Each patch is flattened and passed through one learned linear layer, giving what the paper calls patch embeddings. An extra learned [class] token goes at the front, as in BERT, and its final output is used to predict the class. When fine-tuning on larger images, patch size stays fixed, so sequences get longer and the learned position embeddings are stretched to fit.

ViT lacks the built-in assumptions CNNs have about images, such as nearby pixels mattering most and shifted objects looking the same. Trained on ImageNet alone, 1.3M images, it lands a few points below similar-sized ResNets. On ImageNet-21k, a public set of 14M images, they roughly match; on JFT-300M, Google's in-house set of 303M images, ViT pulls ahead. On random subsets of JFT, a small ViT did much worse than ResNet50 at 9M images but better from 90M up.

The biggest model, ViT-H/14 (the "Huge" size with 14x14 patches), pre-trained on JFT-300M, gave these results: It reached 88.55% on ImageNet and 94.55% on CIFAR-100. It scored 77.63% on VTAB, a set of 19 tasks with only 1,000 training examples each. Pre-training took 2.5k TPU core-days, against 9.9k for BiT-L, a large ResNet, and 12.3k for Noisy Student. A smaller model trained only on ImageNet-21k could be trained on one 8-core cloud TPU in about 30 days.

A controlled study found ViT needs about 2 to 4 times less compute than ResNets for the same accuracy. Hybrids, which feed CNN feature maps into the Transformer, help at small budgets, but the gap vanishes for larger models, and ViT showed no sign of levelling off. The learned position embeddings come to encode the 2D layout of the image on their own. Some attention heads already look across most of the image in the first layers, and how far heads look grows with depth.

The authors caution that the compute savings may also reflect training schedule, optimizer and weight decay, not only the architecture. A first try at self-supervised training, hiding patches and predicting their colour, gave 79.9% on ImageNet: 2 points above training from scratch, 4 below supervised pre-training. Tasks like object detection and segmentation were left untested.

The conclusion is that treating an image as a sequence of patches works surprisingly well when paired with very large pre-training datasets. ViT matches or beats the best CNNs on many benchmarks while being fairly cheap to pre-train, and the authors expect further scaling to help.

### Summary B

This Google Research paper asks whether a plain Transformer, the architecture behind today's language models, can classify images without any convolutional network. Its answer is the Vision Transformer, or ViT: an image is cut into small square patches, and each patch is treated like a word token. With enough training data, ViT matches or beats the best convolutional networks while needing less compute to train.

The authors start from language, where Transformers trained on huge text corpora keep improving with size, with no sign of leveling off. Vision, by contrast, still relied on ResNet-style convolutional networks. Earlier efforts to replace convolutions with attention used special attention patterns that were hard to run fast on modern accelerator chips. Sticking to the standard Transformer means the efficient tools built for language can be reused almost as they are.

Each patch, often 16 by 16 pixels, is flattened and passed through one learned linear layer, giving a patch embedding. As in BERT, an extra learnable class token is placed in front, and the encoder's output for it is what the classifier reads. Learned position embeddings, vectors marking each patch's place, start out knowing nothing of the 2D layout. So ViT has far less built-in inductive bias than a CNN: no locality or translation equivariance wired into every layer.

To see how much data this needs, the authors trained Base, Large and Huge sizes, written like ViT-L/16 for Large with 16-pixel patches. Pre-training sets grew from ImageNet to ImageNet-21k to JFT-300M, a Google in-house set of about 300 million images. On ImageNet alone, Large ViTs did worse than Base ones and ResNets beat ViT; only with JFT-300M did ViT overtake. On random JFT subsets, ViT-B/32 did much worse than a similar-cost ResNet at 9 million images, but better from 90 million up.

After pre-training and then fine-tuning on smaller benchmarks, ViT compared well with the best earlier models. The best model, ViT-H/14, reached 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB, a suite of 19 tasks. ViT-L/16 beat BiT-L, a large ResNet trained on the same JFT data, on every task, using 0.68k versus 9.9k TPUv3-core-days, a count of chip cores times training days. ViT-L/16 pre-trained on the public ImageNet-21k set still scored 85.30% on ImageNet.

A controlled study compared ViT, ResNets and hybrids, where a ResNet feeds its feature maps into ViT, by accuracy against training compute. ViT needed about 2 to 4 times less compute for the same accuracy, hybrids helped only at small budgets, and ViT had not leveled off. Inside the model, position embeddings learned the image's row-and-column layout. Some attention heads looked across the whole image even in the first layers, the distance attended grew with depth, and attention fell on regions relevant to the label.

The authors caution that training efficiency may depend on schedule, optimizer and weight decay, not just on architecture. A first try at self-supervised training, predicting hidden patches as BERT predicts masked words, gave ViT-B/16 79.9% on ImageNet. That is 2 points above no pre-training but 4 behind supervised pre-training, and tasks like detection and segmentation remain untested.

The main conclusion: reading an image as a sequence of patches with a standard Transformer works surprisingly well when paired with large-scale pre-training. ViT matches or beats the state of the art while being relatively cheap to pre-train, and the authors expect further scaling would likely improve it.

## P25

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This research paper asks whether a standard Transformer, with almost no changes, can classify images as well as convolutional networks (CNNs). The trick is to treat an image like a sentence: cut it into fixed-size patches, such as 16×16 pixels, and use each patch as a token. Each patch is flattened and passed through a learned linear projection, and position embeddings are added. As in BERT, an extra learnable class token is prepended, and its final state feeds the classifier. The authors call the model the Vision Transformer, or ViT.

The paper notes that CNNs still dominate vision, and ResNet-style models remain state of the art in large-scale image recognition. Earlier attention models for images either kept a CNN around or used specialised attention patterns. Those patterns needed complex engineering to run efficiently on hardware accelerators. By staying close to the original Transformer, ViT can reuse scalable language-model architectures and their fast implementations almost out of the box.

ViT has far less inductive bias than a CNN, meaning fewer built-in assumptions about images. CNNs assume nearby pixels belong together, and that a pattern means the same thing wherever it appears. ViT uses the 2D layout only when cutting patches and when stretching position embeddings for higher-resolution fine-tuning. So, trained on ImageNet alone (1.3M images) without strong regularisation, it lands a few percentage points below ResNets of similar size.

To test how much data matters, the authors pre-trained on ImageNet, ImageNet-21k (14M images) and the in-house JFT-300M (303M images). Large ViTs did worse than base ViTs on ImageNet, matched them on ImageNet-21k, and only pulled ahead on JFT-300M. On random JFT subsets, ViT-B/32 did much worse than a similar-cost ResNet50 at 9M images, but better at 90M and above. The authors read this as built-in assumptions helping on small data, while large data lets the model learn the patterns itself.

The largest model, ViT-H/14 pre-trained on JFT-300M, reached 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB. VTAB is a set of 19 varied tasks, each with only 1,000 training examples. Pre-training took 2.5k TPUv3-core-days (cores used times days of training), against 9.9k for the best ResNet and 12.3k for Noisy Student. The authors caution that schedule, optimiser and weight decay also affect this efficiency, not just the architecture.

A controlled study of ResNets, ViTs and hybrids (CNN features fed in as patches), all pre-trained on JFT-300M, showed three patterns. ViT used about 2 to 4 times less compute than ResNets to reach the same performance. Hybrids beat pure ViT at small compute budgets, but the gap vanished for larger models. ViT showed no sign of levelling off within the range tried.

Looking inside, the learned position embeddings recover the image's 2D layout, with rows, columns and distance showing up on their own. This explains why hand-built 2D position schemes gave no gains. Some attention heads look across most of the image even in the first layers, while others stay local, perhaps acting like early convolutions.

A first try at self-supervised pre-training, by predicting masked patches as BERT predicts masked words, gave ViT-B/16 79.9% on ImageNet. That is 2% better than training from scratch but 4% behind supervised pre-training. Open challenges named are detection, segmentation, better self-supervision and further scaling. The main conclusion: large-scale training trumps inductive bias, so a plain Transformer matches or beats top CNNs at lower pre-training cost.

### Summary B

This research paper asks a simple question: can a standard Transformer, nearly unchanged from its text form, classify images well? The authors cut each image into small square patches and feed the patches in as if they were words. They call the result the Vision Transformer, or ViT, and train it to label images in a supervised way.

In computer vision, convolutional networks such as ResNets still dominated large-scale image recognition when this was written. Earlier attempts to bring attention into vision used special attention patterns that need complex engineering to run efficiently on hardware accelerators. Meanwhile, Transformers in language had scaled past 100 billion parameters with no sign of performance levelling off, and the authors wanted that scaling for images.

ViT flattens each patch and maps it with one learned linear layer; the outputs are called patch embeddings. Learned position embeddings, which tell the model where each patch sat, are added, and an extra learnable token, like BERT's [class] token, carries the final image representation. Models come in Base, Large and Huge sizes, from 86M to 632M parameters; ViT-L/16 means the Large model with 16×16-pixel patches.

The key finding concerns data size, because ViT lacks the built-in image assumptions of convolutions, such as locality. Trained on ImageNet's 1.3M images alone, ViT lands a few points below similar-sized ResNets, and ViT-Large even trails ViT-Base. With ImageNet-21k (14M images) the sizes draw level, and with JFT-300M, Google's in-house set of 303M images, ViT overtakes the ResNets. On random JFT subsets, ViT-B/32 does much worse than ResNet50 at 9M images but better at 90M and above.

The largest model, ViT-H/14 pre-trained on JFT-300M, reaches 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on VTAB. VTAB is a suite of 19 tasks with only 1,000 training examples each. The best earlier models, a large ResNet called BiT-L and an EfficientNet called Noisy Student, scored 87.54% and 88.4–88.5% on ImageNet. ViT-H/14 used 2.5k TPU core-days of pre-training, against 9.9k and 12.3k for those two. ViT-L/16 trained on public ImageNet-21k still does well and fits on one 8-core TPU in about 30 days.

A controlled study on JFT-300M compared 7 ResNets, 6 ViTs and 5 hybrids, which feed ResNet feature maps into a ViT. ViT needs about 2–4 times less compute than ResNets for the same accuracy, averaged over five datasets. Hybrids help slightly at small budgets, but the gap vanishes for larger models, and ViT shows no sign of levelling off. The authors warn that efficiency may also depend on training schedule, optimizer and weight decay, not only architecture.

Looking inside, the position embeddings learn the image's 2D layout on their own: nearby patches and patches in the same row or column get similar embeddings. The authors also measure attention distance, how far across the image each attention head gathers information, akin to a receptive field. Some heads span most of the image even in the lowest layers, others stay local, and the distance grows with depth.

A first try at self-supervision, predicting masked patches as BERT predicts masked words, gave ViT-B/16 79.9% on ImageNet. That is 2% above training from scratch but 4% behind supervised pre-training. Open challenges include detection, segmentation and closing that self-supervision gap. The conclusion: treat an image as a sequence of patches, pre-train at scale, and a standard Transformer matches or beats the best vision models while costing less to pre-train.

