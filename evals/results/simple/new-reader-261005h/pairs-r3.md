# Pairs of summaries of the same piece

blind-id: f885c15cddb6

Each pair is two summaries of one piece. You have not read the piece and are not given it. The sides are in a random order. Judge each pair on its own.

## P01

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

This paper asks whether a standard Transformer, with almost no changes, can classify images as well as convolutional networks. The trick is to cut an image into fixed-size patches, such as 16×16 pixels, and feed them in like word tokens. The model, called Vision Transformer (ViT), is pre-trained on large labelled image sets and then transferred to smaller benchmarks.

The authors note that convolutional networks still dominate vision, even as Transformers have taken over NLP. Earlier efforts to replace convolutions with attention used specialised attention patterns that had not been scaled well on modern accelerators. Sticking to the original Transformer means scalable NLP architectures, and their efficient implementations, work almost out of the box.

Each patch is flattened and linearly projected to the model width, giving what the paper calls patch embeddings. A learnable class token, like BERT's [class] token, is prepended, and its final state feeds the classification head. The authors stress that ViT has much less image-specific inductive bias, meaning built-in assumptions about images, than CNNs do. In ViT, 2D structure enters only when cutting patches and when resizing position embeddings for higher-resolution fine-tuning; everything else is learned.

That missing bias shapes the central finding: ViT needs a lot of data. Trained on ImageNet's 1.3M images without strong regularization, it lands a few points below ResNets of similar size. With ImageNet-21k (14M images) or the in-house JFT-300M (303M images), ViT overtakes the ResNet baselines. On random JFT subsets, ViT-B/32 does much worse than a comparable ResNet50 at 9M images, but better from 90M up.

The best model, ViT-H/14 on JFT-300M, reaches 88.55% on ImageNet, 94.55% on CIFAR-100, and 77.63% on VTAB, a suite of 19 low-data tasks. The smaller ViT-L/16 beats the BiT-L ResNet on every task, using 0.68k TPUv3-core-days (cores times days of training) against 9.9k. A ViT-L/16 pre-trained on public ImageNet-21k also does well, and fits on a standard 8-core cloud TPUv3 in about 30 days. The authors caution that pre-training efficiency may also depend on schedule, optimizer and weight decay, not only architecture.

A controlled study on JFT-300M compared 7 ResNets, 6 ViTs and 5 hybrids, which feed ResNet feature maps into a Transformer. ViT needed about 2 to 4 times less compute than ResNets to reach the same performance, averaged over 5 datasets. Hybrids edged out ViT at small budgets, but the gap vanished for larger models, which the authors found somewhat surprising. ViT showed no sign of saturating within the range tried.

Looking inside the trained model shows that it learns image structure on its own. Position embeddings come to encode 2D layout: nearby patches, and patches in the same row or column, get similar embeddings. Some attention heads already span most of the image in the lowest layers, while others stay local, much like early convolutions. Attention distance, roughly a CNN's receptive field size, grows with depth, and the model attends to regions relevant for classification.

A first try at self-supervision, masking patches as BERT masks words, got ViT-B/16 to 79.9% on ImageNet. That is 2% better than training from scratch, but still 4% behind supervised pre-training. Named challenges are detection and segmentation, better self-supervised methods, and further scaling, which would likely improve results. The conclusion: a standard Transformer reading an image as a sequence of patches works surprisingly well with large-scale pre-training, and is relatively cheap to pre-train.

## P02

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This essay by biologist Michael Levin argues that memory works by preserving salience, not fidelity: it keeps what matters, not an exact record. It is a perspective piece built from examples in developmental biology, evolution, bioengineering and neuroscience, rather than a report of one new experiment. Its central claim is that living things constantly reinterpret and rewrite their memories to suit a changing body and world.

The starting point is a paradox: a species or self that never changes dies out, but one that changes seems to stop being itself. Levin says the puzzle rests on pure logic, so it applies to agents at every scale, from parts of cells to whole lineages. That, he says, makes it relevant to engineering new intelligences, from AI to artificial life. His answer, drawn from process philosophy and Buddhist thought, is to treat the self as an ongoing process rather than a fixed thing.

Levin pictures a mind as a series of Selflets: thin slices of the self, each probably a few hundred milliseconds long. Memories are then notes left by a past slice for a future one, and like any message they must be interpreted. So confabulation, usually treated as a bug in AI and in court witnesses, becomes a feature he calls mnemonic improvisation: actively rebuilding memory content to fit the present.

The evidence is a set of biological cases where information survives by being remapped to a new setting, not copied. Some trained caterpillars keep memories as butterflies, even though leaf-finding details are useless to a nectar-drinking flyer, so the lesson must be remapped. An odor molecule injected into a frog egg leads the grown animal to seek that odor when hunting food, so one cell must turn the cue into behavior. Newts engineered with much larger cells still build kidney tubes of normal width, using fewer cells, or even one cell bending around itself.

A recurring pattern is the bowtie architecture: data squeezed through a narrow middle and expanded again, as in an autoencoder. Each organism compresses into an egg that must re-inflate in a possibly different world, with possibly mutated parts. Because compression strips out correlations, the stored trace looks increasingly random, so decoding it must be creative, not just step-by-step deduction. Levin proposes that species differ in their willingness to confabulate while building a body, and that planarian flatworms, despite very noisy genomes, commit fully and regenerate best.

The most speculative step blurs the line between data and the minds holding them, echoing William James: "thoughts are thinkers." Levin asks whether memories could have minimal agency, helping shape the mind that will reuse them later. He also asks whether memories act as cognitive glue, binding parts into a self: a rat's lever-and-reward memory belongs to no single cell. Underneath all this is polycomputing: the same physical process can compute different things depending on who interprets it.

Levin says he has deliberately stated the strongest version of these claims, and that a more moderate hybrid may prove most useful. He admits nobody yet knows how this plasticity works. Proposed tests include moving pattern memories between planaria through tissue implants, for which only unpublished preliminary data exist, and transferring learned memories between gene-network models.

The conclusion is that the noise and unreliability of living matter is a feature: intelligence arose because of it, not in spite of it. Organisms that cannot handle novelty in their own parts and memories, not just their surroundings, are unlikely to persist. The self, on this view, is a construction: an adaptive story that holds parts together and guides action.

### Summary B

This is a perspective essay by Michael Levin, arguing from examples rather than reporting a new experiment. Its claim is that memory exists to preserve salience, what matters, rather than fidelity, the exact details. Agents must keep reinterpreting their own memories to fit a changing body and world. Levin draws on developmental biology, evolution, synthetic bioengineering and neuroscience, and applies the idea from cells to societies.

The starting point is a paradox: a self that never changes cannot learn, but a self that changes seems to stop existing. Levin says this puzzle applies to any agent at any scale, so it bears on AI, artificial life and engineering new minds. He argues that biology's unreliable parts are not a flaw but the origin of intelligence. He calls the ability to rewrite and remap memories onto new bodies and contexts "mnemonic improvisation".

The evidence comes from cases where a memory survives a radical change of body. Some memories survive the caterpillar-to-butterfly rebuild, yet a leaf-finding memory must be remapped to make sense for a nectar-drinking flier. Brain extract from trained Aplysia sea slugs, injected only near the right tissue, still changes the recipient's behaviour. An odorant injected into a frog egg yields an animal that seeks that smell when hunting for food.

From this, Levin suggests engrams, stored memory traces, act less like records and more like prompts, with the decoder doing most of the work. Recall itself rewrites memory, and confabulation is everyday, as when the brain invents an in-between green flash between yellow and blue lights. He wants the bad name of confabulation, including in AI, revised toward adaptive sense-making.

The unifying picture is the bowtie: squeeze rich data through a narrow bottleneck, then re-inflate it, as an autoencoder does. An egg compresses a whole organism, and language compresses one brain's state for another. Because good compression makes the code look random, decoding in new contexts must be creative, not purely deductive. Newts with huge cells still build normal kidney tubules, even using a single bent cell, by switching mechanisms.

Planaria, flatworms with the noisiest genome, regenerate best and resist cancer, which Levin reads as intelligence arising from an unreliable substrate. More speculatively, he proposes that memories themselves may have minimal agency, so "thoughts are thinkers". Memories held by no single cell, like a rat linking lever and reward, might help glue the collective self together.

Planned tests include moving pattern memories between planaria, with only unpublished preliminary data so far, and nicotine-addiction memories into rats. Levin admits the mechanism of this plasticity is unknown. He states claims in their strongest form and says a more moderate hybrid view may prove more useful.

The conclusion: life constantly repairs and defends the self because the self is a construction, an embodied story holding parts together. Real observers commit to meaning over accurate detail, and Levin says such capacities need not be biological and could be engineered.

## P03

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

This is a rat experiment asking whether the hippocampus must be active while a rat rears for it to remember places later. Rearing means standing up on the hind legs to look and sniff around. The authors switched off the dorsal (upper) hippocampus only during rearing, then tested memory.

Most research on how the hippocampus builds spatial memory looks at two states: moving around, and quiet rest such as grooming or eating. Rearing is neither, and its role was unknown. It widens what the animal can see and smell, and increases in new places. It also comes with strong 7–12 Hz "high theta" rhythm in the hippocampus, a rhythm tied to memory, but theta studies usually ignore rearing.

The memory test was a delayed win-shift task on an 8-arm maze, where food sits at the end of each arm. In a study phase, four random arms opened; after a 4-minute break, all eight opened, with food only in the four new ones. A ceiling depth camera spotted rearing in real time and switched on a laser. The light activated halorhodopsin, a light-driven protein the authors put into hippocampal cells to silence them. Silencing happened only in the study phase, never at test.

Each rat ran three light conditions in shuffled order, one trial per day. "Off": no light, giving baseline performance. "Rear": light on for exactly as long as each rear lasted. "Delay": the same amount of light, but starting and stopping 6 seconds after each rear. A control group got only a glowing marker protein, no halorhodopsin, to rule out effects of light itself.

Memory was scored as percent correct (how many of the first four choices had food) and total arms entered to find all four. In silencing rats, percent correct fell from 77.7% (Off) to 65.7% (Rear), p = 0.02. Arms entered rose from 5.1 to 6.5, p < 0.0001. Control rats showed no change (81.4% versus 83%; 5.2 versus 5.2 arms).

The Delay condition did not significantly lower percent correct (72.0% versus 77.7%). It showed only a trend toward more arm entries (5.9 versus 5.1, p = 0.05). The authors note the delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time.

Samples were small: 6 silencing rats, all male, and 7 controls of both sexes, and the experimenter could not be blinded. Nearly all rears in the narrow maze had a paw on a wall, so the work cannot separate supported from unsupported rearing. It also cannot say whether every rear matters, which hippocampal subregion is key, or whether similar learning could happen without rearing.

The authors conclude that rearing is a moment when the hippocampus encodes spatial memory. They suggest silencing may have blocked updating of the rat's internal model of its surroundings. Since the maze was familiar, that update would likely be about today's open arms, not learning the room from scratch.

## P04

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This review explains how one branch of information theory can show how groups of neurons combine their inputs. Its central tool is partial information decomposition (PID), which splits the information several inputs give about an output into separate kinds. The authors aim at newcomers inside and outside neuroscience, and they draw mostly on their own recent studies.

The authors call working out how brains process information a grand challenge, and say little is known about how sensory signals get transformed. They name two past barriers: too little data, and no good way to analyse it. New electrical and optical recordings of hundreds or thousands of neurons have largely removed the first barrier. Measures of information flow, such as transfer entropy, still cannot show how separate streams interact, and PID is offered as the fix.

Take two input neurons feeding one target. PID divides what they jointly tell us about the target into three parts. Redundant information is what either input alone reveals, unique information comes from just one of them, and synergy appears only from both together. The authors treat synergy as a sign of the target doing a real computation on its combined inputs. Standard information theory cannot pin these parts down, so a separate definition of redundancy must be chosen.

The main studies used 512-channel electrode arrays to record hundreds of neurons in cultured slices of mouse cortex. Transfer entropy linked neurons into a network, with only 0.4 to 1.0% of possible connections proving significant. PID was then run on thousands of triads, each two source neurons feeding one target. Across 25 recordings, synergy tracked feedforward information flow closely, landing at about a quarter of each triad's transfer entropy.

Three patterns describe where synergy collects in these cultures. Triads inside the rich club, the tightly linked core of busiest neurons, had 2.7 times more synergy; under 40% of neurons produced about 88% of all synergy. Two links between the source neurons meant 50% more synergy, while two links back from the target meant 10% less. Synergy grew as the sources' activity became more alike, peaking near 7% of maximum shared information; past that, redundancy took over.

A follow-up recorded motor areas in three macaques during a multi-step task, using a stricter multivariate network method. It again found a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during reaching and grasping, perhaps to send the movement signal reliably.

The authors list limits: the culture networks came from pairwise analyses, which overstate connections, and cultures differ from behaving animals. No redundancy measure is widely agreed, and the one most of these studies used has been criticised. The number of parts explodes with more inputs: six source neurons give 7,828,354 parts. PID also finds statistical patterns without explaining the biology behind them.

The main conclusion is that neurons do not simply add up inputs and fire past a threshold; they respond to input patterns. How much synergy appears depends on a neuron's place in the network and on the animal's behaviour. The authors point to moment-by-moment and multi-target versions of PID as promising next steps.

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

## P05

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

This review explains how a method called partial information decomposition (PID) can show how single neurons combine signals arriving from several inputs. It mixes a tutorial on the method with the authors' own lab results and a short look at future directions.

The authors call working out how brains process information a grand challenge of modern neuroscience. Two things held the field back: too little data, and too few ways to analyse it. New recording gear now captures hundreds or thousands of neurons at sub-millisecond resolution, which has largely eased the data problem. Transfer entropy, which measures how much one neuron's past predicts another's next state beyond that neuron's own past, tracks flow but not how input streams interact.

PID takes the information two input neurons jointly carry about a target neuron and splits it into parts. Redundant information could come from either input, unique information from only one, and synergistic information only from both inputs seen together. The authors treat synergy as their measure of real processing, or computation, by the target neuron. Standard information theory leaves this split underdetermined, with three known quantities and four unknowns, so a formula for redundancy must be chosen. About a dozen formulas compete; most studies here used the original one, Imin, which critics say behaves unintuitively.

The main evidence comes from organotypic cultures: slices of mouse cortex kept alive in nutrient fluid so their natural wiring patterns return. A 512-channel electrode array recorded hundreds of single neurons at millisecond precision. Transfer entropy mapped which neurons drive which, and only about 0.4–1.0% of possible connections were significant. The team then ran PID on each of thousands of triads: two source neurons feeding one common target.

Across these triads, three patterns stood out. Synergy rose with how much information flowed from sources to target, and was reliably about a quarter of that flow across 25 recordings. Triads in the rich club, the best-connected neurons that link to each other more than chance predicts, had 2.7 times the synergy and held about 88% of it. Two recurrent links, running between the two sources, meant 50% more synergy, while two feedback links from target to sources meant 10% less.

The authors also asked whether similar inputs boost synergy. At synaptic timescales, under 14 ms, more shared information between the two sources meant more synergy. Over time windows up to 2.25 s, synergy peaked when that shared information reached about 7% of its maximum, then fell. Redundancy kept rising instead, suggesting that inputs past a certain similarity simply repeat each other.

Later work by Varley and colleagues applied PID to motor-area recordings from three macaques doing a reaching task with planning and memory stages. Using a stricter, multivariate form of transfer entropy, it again found a rich club and more synergy in highly connected neurons. Activity was mostly synergy-dominated, but redundancy rose sharply during the reach-and-grasp movement. The authors read this as the brain copying the move signal many times to make transmission reliable.

The culture networks were built with pairwise transfer entropy, which overstates connections, and cultures face different demands than a behaving animal. PID also reveals statistical patterns, not the biological mechanisms that cause them. Its parts multiply fast with more inputs: six input neurons already give 7,828,354 distinct pieces. Still, the authors conclude that neurons do not just add up inputs; they respond to input patterns, shaped by network position and behaviour.

## P06

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

This is a review and theory paper about when cognitive control helps and when it hurts. Cognitive control here means the prefrontal cortex filtering raw input, keeping what serves the current goal and damping the rest. The authors propose a Matched Filter Hypothesis: performance is best when the amount of filtering matches what the task needs, not when filtering is maximal. The name borrows loosely from signal processing, where a matched filter best pulls a signal out of noise in a given setting.

The prefrontal cortex is usually treated as the seat of our most complex thinking, so more control looks like it should always be better. The authors argue a growing body of research shows otherwise. In one guessing task, one option pays off 75% of the time; adults pick it 75% of the time and win about 62.5%. Children pick it every time and win 75%, and some work links the adult habit to executive function.

The paper calls a state of reduced prefrontal activity "hypofrontality"; young children, whose frontal lobes are still maturing, are its natural example. High control should help tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Low control should help tasks that are implicit, reward-driven, non-verbal or intuitive, and too complex to hold in working memory. How well the filter matches can depend on age, genes, brain damage, doing a second task at once, or brain stimulation.

For learning, the authors gather evidence that less control can help. Adults doing a demanding second task at the same time learn hard-to-verbalize rules and motor sequences better. Disrupting the dorsolateral prefrontal cortex with magnetic pulses has been linked to better implicit motor learning. Children show less "blocking", where an already-learned cue stops a new cue from being learned, so they end up learning cue strengths more accurately. Given noisy artificial-language input, children produce only the most frequent form, while adults copy the noise.

The proposed reason is a tradeoff: control buys fast, accurate short-term performance at a long-term cost to what gets learned. The authors also point to competition between a prefrontal, rule-testing learning system and a striatal, habit-based one. For example, people with lower working memory capacity learn non-verbal category boundaries better.

For creativity, people inventing unusual uses for objects showed lower prefrontal and higher visual-area activity than people listing ordinary uses. A weak current that damps the left prefrontal cortex made people faster and more prolific at inventing new uses, with no such effect on control tasks. Children also resist functional fixedness, the trap of seeing an object only through its usual job. Still, judging whether an idea works likely needs control again, so creativity may cycle between the two states.

The authors flag real limits. Direct evidence in adults is sparse, and child advantages could come from differences other than an immature prefrontal cortex. Some learning, such as adapting when rewards switch, needs prefrontal function, so less control does not simply mean better learning. Creativity studies are few, and the exact neural mechanisms remain unspecified.

The takeaway: transforming input always has a cost, and a filter that helps under one set of conditions can harm under another. Cognitive control is best seen as a tool suited to some common problems, not an all-purpose optimizer for every task.

## P07

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a perspective essay by biologist Michael Levin about what memory is for. Most memory research asks how data is stored and read back reliably; Levin instead asks how agents reinterpret and rewrite memories to fit a changing self and world. His core claim is that memory preserves salience, meaning what matters, rather than fidelity to the original details. He frames this with a paradox: a species or person that never changes cannot learn, yet one that changes seems to stop being itself.

Levin says the paradox rests on pure logic, so it applies at every scale, from parts of cells to whole lineages, and to AI and artificial life. He argues that confabulation, usually treated as a bug in AI and in court witnesses, is actually a deep and useful feature of living systems. Biology, he says, solved the paradox by treating the Self as a process, not a fixed thing.

The argument draws on published studies rather than new experiments, and several show memory surviving radical change. Some trained memories survive a caterpillar's brain being rebuilt into a butterfly's, though leaf-related details are useless to a nectar drinker, so the lesson must be remapped. In Aplysia sea slugs, brain extract from trained animals, injected only near the right nervous tissue, still changes the recipient's behavior. An odorant injected into a frog egg leads the grown animal to seek that odor when looking for food. Levin reads these engrams, or memory traces, as less like stored records and more like prompts, with the decoding doing the hard work.

He generalizes this as a bowtie architecture: complex states squeezed into a compact code, then re-expanded, as in an autoencoder. An egg is such a bottleneck, re-inflating into a body that may meet a different world with different parts. Because good compression removes correlations, the code looks increasingly random, so decoding it must be creative, not just deductive. So the same voltage-changing drug, Monensin, triggers tails to grow in tadpoles but legs in froglets.

Newts engineered with extra chromosomes and larger cells still build kidney tubes of normal width, using fewer cells, or one huge cell bending around itself. Planarian flatworms have very noisy genomes yet resist aging, cancer and injury; Levin credits a strong willingness to confabulate in body shape. Because competent parts hide genome flaws from selection, he argues, evolution invests in competency, creating an intelligence ratchet driven by unreliable matter.

The most speculative step blurs data and processor: memories might have minimal agency, echoing William James's line that "thoughts are thinkers". He also asks whether memories act as cognitive glue: a rat's lever-reward memory belongs to no single cell, only to the whole animal. He proposes that consciousness may be felt uncertainty about one's own memories and internal states.

Levin says he deliberately gave the strongest versions of these claims, and a more moderate hybrid with the conventional view may prove more useful. He flags claims of memory transfer via heart or lung transplants as uncertain. Proposed tests include moving memories between gene-network models and moving nicotine addiction from human donors through Anthrobots into rats.

Levin concludes that the Self is a construction: an adaptive story that holds parts together and lets them navigate problems. Organisms that cannot handle novelty in their own parts and memories, not just their surroundings, will not be evolvable. Real observers are committed to meaning over accurate detail, and he holds that this capacity need not be biological and likely can be engineered.

### Summary B

This is a perspective essay by biologist Michael Levin, built on examples from developmental biology, evolution, bioengineering and neuroscience rather than new experiments. Its claim is that memory exists to preserve salience, meaning what matters for acting, not fidelity to the original details. Levin coins "mnemonic improvisation" for an agent's ability to rewrite stored information and remap it onto new bodies and contexts. He argues this happens at every scale, from cells to whole lineages.

The essay starts from a paradox: a self that never changes cannot learn, but a self that changes seems to stop being itself. Levin says this rests on pure logic, so it applies to any agent, including engineered intelligences, AI and artificial life. His answer, echoing process philosophy and Buddhist thought, is to treat the self as an ongoing process, not a fixed thing. Biology, he argues, already bet on this, because its own parts mutate, age, get cancer and get hijacked by other organisms.

Levin pictures a mind as a series of "Selflets", thin slices of self each probably a few hundred milliseconds long. Memories are then notes left by a past slice for a future one, and like any message they must be interpreted. So confabulation, usually treated as a bug in brains and AI, is recast as a core feature of sense-making.

The biological cases he leans on show information being reinterpreted, not just stored. Some caterpillar memories survive metamorphosis, yet a leaf-eater's specific lessons only help a nectar-drinking butterfly if generalised and remapped. An odorant injected into a frog egg leads the grown animal to seek that odour when looking for food. Newts with much larger cells still build normal-width kidney tubes, using fewer cells, or one huge cell bending around itself.

The unifying pattern is what he calls a bowtie architecture: rich data squeezed through a narrow bottleneck, then re-expanded, as in an autoencoder. An organism shrinking into one egg and rebuilding a body is his prime example. Good compression strips correlations, so the stored trace looks increasingly random, and decoding it without metadata must be creative, not just deductive. Planarian flatworms have very noisy genomes yet resist ageing, cancer and injury; he proposes they override genetic details with large-scale pattern completion.

The boldest step questions the line between passive data and the minds that use it, following William James's phrase "thoughts are thinkers". Memories, as active patterns, might have minimal agency and help shape the mind that later reads them. He also asks whether memories act as "cognitive glue", binding parts into a whole self: a rat's lever-reward link belongs to no single cell. His lab is testing this by training memories into gene-regulatory network models and measuring whether the system becomes more integrated.

Levin says he states the strongest version on purpose, and a more moderate middle view may prove most useful. He admits nobody yet knows how this plasticity works. He also flags reports of memories carried by heart or lung transplants as uncertain.

His conclusion is that intelligence arose because of, not despite, unreliable biological material. This works through polycomputing: the same physical process serving different functions depending on which agent interprets it. He says the lessons should inform truly bio-inspired AI, and that the self is a construction: a working story holding parts together.

## P08

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

This is a theory-and-review paper arguing that strong cognitive control is not always better. The authors treat the prefrontal cortex as a filter that weakens information judged irrelevant, so behaviour fits the current goal. Borrowing loosely from signal processing, they propose a Matched Filter Hypothesis: performance is best when the amount of filtering matches what the task needs.

The usual view treats prefrontal control as the engine of complex thought, and most developmental work studies children's control deficits. Yet a growing body of work finds that not all complex cognition benefits from control, and children sometimes beat adults. In a choice task where one option pays off 75% of the time, adults pick it 75% of the time, for 62.5% success. Children pick it every time and reach 75%, and adult matching may draw on executive function.

High control should help tasks that are explicit, rule-based, verbal or abstract, and that fit within working memory. Hypofrontality, meaning reduced prefrontal activity, should help tasks that are implicit, stimulus-driven, hard to abstract, or too complex for working memory. The outcome reflects competition between prefrontal cortex and posterior or subcortical systems, such as sensorimotor cortex and the basal ganglia. Age, genes, brain damage, dual-task conditions and brain stimulation can all shift that balance.

For learning, the review gathers several lines of evidence. A secondary task helps adults learn rules they cannot put into words, and magnetic stimulation disrupting dorsolateral prefrontal cortex improved implicit motor learning. Retrieval-induced forgetting, where practising some items suppresses related ones, shrinks when prefrontal resources are taxed by a secondary task. Adults learn to look away from uninformative cues, cutting errors fast but distorting what they learn; 3-year-olds show less of this blocking than 4-year-olds. Given noisy artificial-language input, children produce only the most frequent form, while adults reproduce the noise.

The authors link this to competing learning systems. Prefrontal cortex and the caudate support explicit, rule-based learning, while the putamen supports habit-like procedural learning; caudate activity falls as putamen activity rises. Adults with low working memory capacity learn non-verbalizable category boundaries better than high-capacity adults. The mature prefrontal cortex may bias people toward the explicit system even when it fits the problem poorly.

Creativity is the second test case, since open-ended tasks may need raw perceptual detail that filtering discards. People generating unusual uses for objects showed lower prefrontal and higher visual-area activity than people generating typical uses. Inhibitory stimulation over left prefrontal cortex made people faster and more prolific at creative uses, but not on control tasks. Children also resist functional fixedness, the adult habit of seeing an object only by its usual function. Judging whether an idea works likely needs control again, so creative work may cycle between the two states.

The authors flag clear limits. Child advantages could stem from knowledge, strategies or other maturing brain regions, not only weak prefrontal control. Reversal learning needs some prefrontal function, and dopamine studies suggest an inverted-U relationship, so less control is not simply better. Creativity studies are few, patient findings are inconsistent, and the neural mechanism that sets the filter remains unspecified.

The unifying point is that transforming input has a cost: strategies that cut errors quickly can lose fidelity and completeness over time. The authors suggest the idea extends to complex multi-feature decisions and to emotion regulation. They conclude that cognitive control is a tool suited to some common challenges, not an all-purpose optimiser for every problem.

## P09

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

This research paper asks whether a standard Transformer, changed as little as possible, can classify images as well as convolutional networks (CNNs). The trick is to cut each image into fixed-size squares called patches, flatten each one, and project it linearly into a vector, exactly like a token embedding. The authors call the result the Vision Transformer, or ViT, and train it to label images with supervision.

In vision, CNNs still dominate large-scale image recognition, even though Transformers have scaled to huge sizes in language. Earlier attempts to swap convolutions for attention used special attention patterns that need complex engineering to run fast on hardware accelerators. A plain Transformer, by contrast, can reuse scalable language-model code almost out of the box.

Like BERT, ViT puts an extra learnable token in front of the patches, and its final output serves as the image summary. Learned 1D position embeddings tell the model where each patch sits. The only built-in assumptions about images are the patch cutting and, when fine-tuning at higher resolution, stretching the position embeddings to the new grid. Names like ViT-L/16 mean the Large model (307M parameters) with 16-by-16-pixel patches; Base has 86M and Huge 632M.

The central finding is about data size. Trained on ImageNet's 1.3M images alone, ViT scores a few points below similar-sized ResNets, and Large does worse than Base. On ImageNet-21k (14M images) and Google's in-house JFT-300M (303M images), ViT catches up and then overtakes. On random JFT subsets, ViT-B/32 was much worse than ResNet50 at 9M images but better from 90M up. The authors conclude that a CNN's built-in assumptions help on small data, while large data lets the model learn those patterns itself.

Against the best CNNs, pre-trained on JFT-300M, ViT did well on both accuracy and cost. ViT-H/14 reached 88.55% on ImageNet and 77.63% on VTAB, a set of 19 tasks with 1,000 training examples each. It used 2.5k TPU core-days of pre-training, against 9.9k for the large ResNet called BiT-L, though training settings may also affect this gap. In a controlled comparison, ViT needed about 2 to 4 times less compute than ResNets for the same accuracy, and showed no sign of levelling off. Hybrids, which feed CNN feature maps into ViT, helped only for small models.

Looking inside, the learned position embeddings came to reflect the image's rows, columns and distances on their own. Some attention heads already looked across most of the image in the lowest layers, others stayed local, and the average span grew with depth. A first try at BERT-style self-supervision, predicting hidden patches, gave ViT-B/16 79.9% on ImageNet: 2% better than training from scratch, but 4% behind supervised pre-training.

The authors conclude that treating an image as a sequence of patches works surprisingly well when paired with large-scale pre-training. They say it matches or beats the state of the art on many image classification datasets while being relatively cheap to pre-train. Open problems they name are other vision tasks such as detection and segmentation, closing the self-supervised gap, and further scaling, which would likely help.

## P10

The reader says of themselves: "CTO of a small software company. Background in cognitive science and machine learning; I build products on large language models every day." They have not read the piece.

### Summary A

This is a rat experiment asking whether the hippocampus must be active while a rat rears, meaning stands up on its hind legs to look around. The authors switched off the dorsal (upper) hippocampus only during rearing, then checked whether the rats' spatial memory suffered.

Most work on how the hippocampus supports spatial memory has looked at two states: moving around, and quiet rest such as grooming or eating. Rearing is common but little studied, and the paper argues it lets an animal take in more of distant cues and room boundaries. Rearing also comes with strong 7–12 Hz "high theta" rhythm in the hippocampus, a rhythm tied to memory, yet whether rearing matters for memory was unknown.

Rats ran a "delayed win-shift" task on a maze with eight arms radiating from a hub. In a study phase, four random arms opened with food; after a 4-minute break, all eight opened, and food sat only in the four new arms. The hippocampus carried halorhodopsin, a light-driven pump that silences neurons when lit. A 3D camera above the maze detected rearing in real time and fired a laser into the brain, but only during the study phase.

Each rat ran three light conditions, one trial a day, in shuffled order. In "Off", no light was delivered, giving baseline performance. In "Rear", light was on for exactly the length of each rear. In "Delay", light lasted just as long but started and stopped 6 seconds after the rear, so total silencing matched without lining up with rearing. A control group carried only a glowing marker protein, not the silencing pump, to rule out effects of light itself.

In the six analysed experimental rats, "percent correct", the share of the first four test choices that found food, fell from 77.7% (Off) to 65.7% (Rear). They also needed more arm visits to find all the food: 6.5 versus 5.1. Delay gave 72.0% correct, not a reliable drop, and only a borderline rise in arm visits to 5.9. The seven control rats showed no effect in any condition.

The authors flag limits: the 6-second delay still overlapped about 35.5% of rearing time, so Delay was not fully separated from rearing. Nearly all rears were braced against a wall, and the study cannot say whether free-standing rears differ. It also cannot say whether every rear matters, or whether the same memory storing could happen without rearing.

Why might silencing hurt? The authors suggest rearing may update the brain's internal model of the surroundings, and silencing may have blocked that. Since the rats already knew the room well, any updating was likely about today's open arms, kept apart from earlier days.

The conclusion: rearing is a period when the hippocampus stores spatial memories, and disrupting it then is enough to impair memory in this task. The authors say this directly supports an earlier proposal that rearing can serve as a behavioural marker of hippocampal learning.

### Summary B

This is an experimental study in rats that asks one question: does hippocampal activity while a rat rears up on its hind legs matter for spatial memory? The authors switched off the dorsal (upper) hippocampus only during rearing, then tested whether the rats could remember where they had been.

Most work on how the hippocampus supports spatial memory looks at two kinds of moments: walking around, and quiet rest such as grooming or eating. Rearing is common but little studied, even though it widens what the animal can see and smell and increases in new environments. It also comes with strong 7–12 Hz theta rhythm in the hippocampus, a brain wave tied to memory, so its role was an open gap.

Rats ran an 8-arm maze task called delayed win-shift: four arms open with food, a 4-minute break, then all eight open with food only in the four new arms. To silence neurons, the team used optogenetics: a virus made hippocampal cells produce halorhodopsin, a protein that shuts the cell down when hit by light. A 3D depth camera above the maze detected rearing in real time and triggered the laser, but only during the first, study phase.

Each rat ran three light conditions, in random order, one trial per day. Off: no light at all, giving each rat's baseline. Rear: light on for exactly the length of each detected rear. Delay: the same amount of light, but switched on and off 6 seconds after each rear. A control group got a virus with only a glowing marker and no halorhodopsin, to rule out effects of light or surgery alone.

In the six experimental rats, silencing during rearing dropped correct first choices from 77.7% to 65.7%, a significant fall. They also needed more arm visits to find all the food, 6.5 versus 5.1. The seven control rats showed no change in any condition. The Delay condition gave no significant drop in accuracy (72.0%) and only a borderline rise in arm visits (5.9, p = 0.05). The authors note the delay did not fully separate light from rearing: the laser still overlapped about 35.5% of rearing time.

The study cannot say whether rears with forepaws against a wall differ from free-standing ones; nearly all rears here were the supported kind. It also cannot tell whether every rear matters, or whether the same memory storing could happen through other looking-around behaviours. The experimenter could not be blind to condition, since the light made each condition obvious.

The authors suggest rearing may be when the hippocampus updates its internal model of the surroundings using distant visual cues. Because the maze was long familiar, this was likely not building a map from scratch but tagging today's arms against interference from past trials. Their conclusion: rearing is a moment when the hippocampus stores spatial memory, and disrupting it then is enough to impair that memory.

