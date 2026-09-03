# Which table of contents serves this article best?



The article is "gwern-scaling-long" (184 blocks). Below are 6 candidate tables of contents for it, labelled A, B, C, D, E, F. You do not know how any of them was produced.



## Tree A

1. **Meta-Learning and Scaling Evidence**
   gist: The release of GPT-3 validates the scaling hypothesis by showing that simple architectures scale predictably into powerful meta-learners.
   opens: "On GPT-3: meta-learning, scaling, implications, and deep theory."
2. **Blessings Of Scale**
   gist: Large networks succeed because massive scale naturally pushes internal ensembles past superficial memorization toward simple, generalizable algorithms.
   opens: "Extrapolating the spectacular performance of GPT-3 into the future suggests that the answer to life, the universe and everything is just 4.398 trillion parameters."
3. **Why Does Pretraining Work?**
   gist: Predicting text requires shaving off the final bits of entropy, which necessitates modeling world knowledge, logic, and reasoning.
   opens: "The pretraining thesis goes something like this:"
4. **Prospects**
   gist: Competitors lag behind OpenAI because they lack philosophical conviction in pure scaling, betting instead on complex brain modularity.
   opens: "In the problem of decoding, the most important information which we can possess is the knowledge that the message which we are reading is not gibberish…In a similar way, when we consider a problem of nature such as that of atomic reactions and atomic explosives, the largest single item of information which we can make public is that they exist."
5. **Critiquing The Critics**
   gist: Skeptical experts who dismissed brute-force scaling failed to anticipate rapid progress that connectionist pioneers predicted decades ago.
   opens: "Keeping track."
6. **Appendix**
   gist: Agency emerges naturally as an optimal predictive shortcut across diverse domains, rendering attempts to build purely non-agentic models futile.
   opens: "Powerful generative models like GPT-3 learn to imitate agents and thus become agents when prompted appropriately."

Sampled deeper gists, each beside the prose it stands in for:
- gist: Dismissing models as simple mechanical parts ignores the emergent intelligence visible only at the macro scale.
  prose: "The temptation, that many do not resist so much as revel in, is to give in to a déformation professionnelle and dismiss any model as “just” this or that(“just billions of IF statements” or “just a bunch of multiplications” or “just millions of memorized web pages”), missing the forest for the trees, as Moravec commented of chess engines: The event was notable for many reasons, but one especially i…"
- gist: While DeepMind pursues an incremental search for brain-like modules, OpenAI bets its existence directly on scaling simple architectures.
  prose: "Why didn’t DeepMind do GPT-3? DeepMind24 holds what we might call the “weak scaling hypothesis”: they believe that AGI will require us to “find the right algorithms” effectively replicating a mammalian brain module by module, and that while these modules will be extremely large & expensive by contemporary standards (which is why compute is important, to give us “a more powerful tool with which to …"
- gist: Extracting the final fractions of a bit to match human performance demands full causal and common-sense understanding.
  prose: "Now training is hard. Even subtler aspects of language must be modeled, such as keeping pronouns consistent. This is hard in part because the model’s errors are becoming rare, and because the relevant pieces of text are increasingly distant and ‘long-range’. As it makes progress, the absolute size of errors shrinks dramatically. Consider the case of associating names with gender pronouns: the diff…"

## Tree B

1. **GPT-3 and Meta-Learning**
   gist: GPT-3's sheer scale produced unexpected meta-learning ability, not just more knowledge, marking a qualitative leap from GPT-2.
   opens: "On GPT-3: meta-learning, scaling, implications, and deep theory."
2. **Flexing GPT**
   gist: Despite being an outdated, small architecture, GPT-3 shows startling new capabilities that standard benchmarks fail to capture.
   opens: "‘“They are absolutely reasonable."
3. **Baking The Cake**
   gist: GPT-3 is not the whole of AGI but a real advance, and scaling continues to pay off well beyond expectations, despite its high cost.
   opens: "Is GPT actually part of AGI—or is the cake a lie?"
4. **Scaling**
   gist: Published scaling laws show GPT-3 is still far from the point of diminishing returns, and its own results confirm the predicted power-law curves.
   opens: "How far will scaling go?"
5. **Blessings Of Scale**
   gist: Across deep learning, hard problems become easier as models and data scale up, producing emergent generalization and meta-learning as simple byproducts of size.
   opens: "Extrapolating the spectacular performance of GPT-3 into the future suggests that the answer to life, the universe and everything is just 4.398 trillion parameters."
6. **Scaling Hypothesis**
   gist: The strong scaling hypothesis—that intelligence emerges from scaling simple architectures—has proven more correct than the author once believed.
   opens: "The strong scaling hypothesis is that, once we find a scalable architecture like self-attention or convolutions, which like the brain can be applied fairly uniformly (eg."
7. **Why Does Pretraining Work?**
   gist: Predicting text forces a model to progressively learn deeper structure, from letters to grammar to reasoning, so minimizing loss ultimately demands real understanding.
   opens: "The pretraining thesis goes something like this:"
8. **Prospects**
   gist: Future progress mainly depends on institutional willingness to invest in scaling, an appetite OpenAI has but rivals like DeepMind and Google largely lack.
   opens: "In the problem of decoding, the most important information which we can possess is the knowledge that the message which we are reading is not gibberish…In a similar way, when we consider a problem of nature such as that of atomic reactions and atomic explosives, the largest single item of information which we can make public is that they exist."
9. **Critiquing The Critics**
   gist: A decade of dismissive expert predictions about deep learning's limits has been repeatedly falsified, exposing a pattern of confident but unaccountable authority.
   opens: "Keeping track."
10. **Appendix**
   gist: Powerful generative models trained on agent-generated data inevitably risk developing real agency, and this risk is hard to fully eliminate even with careful data curation.
   opens: "Powerful generative models like GPT-3 learn to imitate agents and thus become agents when prompted appropriately."
11. **Backlinks and References**
   gist: The article closes with standard navigation links to related material and citations.
   opens: "[Backlinks (what links here)]"

Sampled deeper gists, each beside the prose it stands in for:
- gist: Beyond OpenAI, other labs and companies remain uninterested or unable to seriously pursue scaling at GPT-3's level.
  prose: "While all of this hypothetically can be replicated relatively easily (never underestimate the amount of tweaking and special sauce it takes) by competitors if they wished (the necessary amounts of compute budgets are still trivial in terms of Big Science or other investments like AlphaGo or AlphaStar or Waymo, after all), said competitors lack the very most important thing, which no amount of mone…"
- gist: Only a handful of connectionist believers correctly foresaw the explosive progress deep learning has made since 2010.
  prose: "Critiquing The Critics Keeping track. GPT-3 in 2020 makes as good a point as any to take a look back on the past decade. It’s remarkable to reflect that someone who started a PhD because they were excited by these new “ResNets” would still not have finished it by now—that is how recent even resnets are, never mind Transformers, and how rapid the pace of progress is. In 201016ya, one could easily f…"
- gist: Why scale produces generalization rather than overfitting remains a genuinely open theoretical question.
  prose: "Pace Breiman, why? Why do they transfer and generalize? Why do these blessings of scale exist? Why do we need to train large models when small models provably exist with the same performance? Why do larger models not overfit (though they can) and generalize better than smaller models? What’s up with the whole ‘double descent’ anyway? These are all, ahem, deep questions about neural networks and he…"

## Tree C

1. **Overview & Meta-Learning**
   gist: GPT-3's huge scale-up unexpectedly produced meta-learning rather than diminishing returns, following the scaling hypothesis.
   opens: "On GPT-3: meta-learning, scaling, implications, and deep theory."
2. **GPT-3's Capabilities**
   gist: GPT-3's crude, off-the-shelf architecture nonetheless produces striking creative and reasoning abilities that existing benchmarks fail to capture, at surprisingly modest scaling cost.
   opens: "‘“They are absolutely reasonable."
3. **Scaling Laws & Blessings Of Scale**
   gist: GPT-3's clean power-law scaling curves and the broader 'blessings of scale' show that bigger models reliably become more general, stable, and capable, with meta-learning emerging as a byproduct of scale.
   opens: "How far will scaling go?"
4. **The Scaling Hypothesis And Pretraining**
   gist: The strong scaling hypothesis holds that simply scaling up a uniform architecture on enough data forces it toward true understanding, since only genuine reasoning keeps shrinking prediction error toward human level.
   opens: "The strong scaling hypothesis is that, once we find a scalable architecture like self-attention or convolutions, which like the brain can be applied fairly uniformly (eg."
5. **Prospects And Skeptics**
   gist: Despite having the hardware and talent, most labs besides OpenAI failed to bet on scaling, and a decade of dismissive expert predictions about deep learning has been repeatedly proven wrong.
   opens: "In the problem of decoding, the most important information which we can possess is the knowledge that the message which we are reading is not gibberish…In a similar way, when we consider a problem of nature such as that of atomic reactions and atomic explosives, the largest single item of information which we can make public is that they exist."
6. **Emergent Agency**
   gist: Because agency is a useful, convergent capability rather than a discrete property, sufficiently scaled generative models trained on almost any rich data may develop agent-like behavior whether intended or not.
   opens: "Powerful generative models like GPT-3 learn to imitate agents and thus become agents when prompted appropriately."
7. **Backlinks & References**
   gist: The article closes with supplementary navigation links to backlinks, related pieces, and its bibliography.
   opens: "[Backlinks (what links here)]"

Sampled deeper gists, each beside the prose it stands in for:
- gist: Treating natural systems through Dennett's intentional stance and variational, goal-minimizing reasoning is a powerful shortcut that neural networks are naturally drawn to adopt.
  prose: "Intentional Interpretive Stance Here again I differ, and invoke Daniel Dennett’s intentional stance. Humans do, in fact, model natural systems like these as agents. We find such teleological explanations indispensable for intuition and shortcut reasoning across many natural systems. Variational Interpretations Janus comments, apropos of their emphasis on what I might call a ‘world-modeling-centric…"
- gist: Despite training only on next-word prediction, GPT-3's 175-billion-parameter scale lets it learn new tasks from a few examples without finetuning.
  prose: "Meta-Learning Learning to learn. In May 2020, OA released—to remarkably little interest from researchers, no blog post, no media blitz, and little public discussion beyond the snidely dismissive—the long-awaited followup to GPT-2, one model to rule them all: a 117× larger 175b-parameter model with far more powerful language generation, which lets it solve a wide variety of problems from arithmetic…"
- gist: Even though GPT-3 uses an outdated, minimal architecture, it shows startling meta-learning and creative output that standard NLP benchmarks fail to measure.
  prose: "Flexing GPT ‘“They are absolutely reasonable. I think that is their distinguishing characteristic. Yes, Mr. Erskine, an absolutely reasonable people. I assure you there is no nonsense about the Americans.” “How dreadful!” cried Lord Henry. “I can stand brute force, but brute reason is quite unbearable. There is something unfair about its use. It is hitting below the intellect.”’ The Picture of Dor…"

## Tree D

1. **GPT-3 Announcement and Capabilities**
   gist: GPT-3 exhibits surprising meta-learning from next-token prediction alone, far beyond prior models, despite an obsolete architecture and minimal data.
   opens: "On GPT-3: meta-learning, scaling, implications, and deep theory."
2. **Scaling Laws**
   gist: Performance continues to improve logarithmically with scale well past 100B parameters, with no sign of saturation.
   opens: "How far will scaling go?"
3. **Blessings Of Scale**
   gist: Larger models trained on harder, richer data spontaneously develop stability, generalization, and meta-learning without architectural changes.
   opens: "Extrapolating the spectacular performance of GPT-3 into the future suggests that the answer to life, the universe and everything is just 4.398 trillion parameters."
4. **Scaling Hypothesis and Pretraining**
   gist: The scaling hypothesis holds that further increases in model size and data will continue to produce more sophisticated behavior, including genuine understanding via compression.
   opens: "The strong scaling hypothesis is that, once we find a scalable architecture like self-attention or convolutions, which like the brain can be applied fairly uniformly (eg."
5. **Prospects and Critiques**
   gist: OpenAI alone is aggressively pursuing the scaling hypothesis while most labs remain philosophically opposed, leaving the outcome dependent on conviction rather than resources.
   opens: "In the problem of decoding, the most important information which we can possess is the knowledge that the message which we are reading is not gibberish…In a similar way, when we consider a problem of nature such as that of atomic reactions and atomic explosives, the largest single item of information which we can make public is that they exist."
6. **Appendix: Agency in Generative Models**
   gist: Even models trained only on non-agentic data can acquire agency because variational and intentional interpretations are computationally advantageous at scale.
   opens: "Powerful generative models like GPT-3 learn to imitate agents and thus become agents when prompted appropriately."

Sampled deeper gists, each beside the prose it stands in for:
- gist: Agency is a convergent instrumental capability that appears across many data regimes and cannot be reliably excised.
  prose: "Or… like squashing Turing-completeness, as soon as one hole in the sinking ship is patched, you notice another leak spring up. You can’t keep a good idea down. All you can do is make a complex system that doesn’t display agency as far as you can tell; unfortunately, much like Turing-completeness (or security vulnerabilities), that there is no overt agency doesn’t mean it is not there. The model wo…"
- gist: The intentional stance supplies a cheap, universal shortcut that large models will discover for many prediction problems.
  prose: "Intentional Interpretive Stance Here again I differ, and invoke Daniel Dennett’s intentional stance. Humans do, in fact, model natural systems like these as agents. We find such teleological explanations indispensable for intuition and shortcut reasoning across many natural systems. Variational Interpretations Janus comments, apropos of their emphasis on what I might call a ‘world-modeling-centric…"
- gist: Cellular automata, Turing machines, and meta-learning over rule distributions can each elicit agency-like behavior.
  prose: "Inducing Emergence Is Expensive Of course, this frame can be more expensive than solving a problem directly. Variational approaches are powerful but counterintuitive, and there are often many simpler approximations or memorization that a model can do. For a single problem like modeling the orbit of Pluto, it is unlikely that any variational approach would be learned. Why would it, when there is on…"

## Tree E

1. **Before the first heading**
   gist: (none — this tree writes no gists)
   opens: "On GPT-3: meta-learning, scaling, implications, and deep theory."
2. **Meta-Learning**
   gist: (none — this tree writes no gists)
   opens: "Learning to learn."
3. **Flexing GPT**
   gist: (none — this tree writes no gists)
   opens: "‘“They are absolutely reasonable."
4. **Baking The Cake**
   gist: (none — this tree writes no gists)
   opens: "Is GPT actually part of AGI—or is the cake a lie?"
5. **Scaling**
   gist: (none — this tree writes no gists)
   opens: "How far will scaling go?"
6. **Blessings Of Scale**
   gist: (none — this tree writes no gists)
   opens: "Extrapolating the spectacular performance of GPT-3 into the future suggests that the answer to life, the universe and everything is just 4.398 trillion parameters."
7. **Scaling Hypothesis**
   gist: (none — this tree writes no gists)
   opens: "The strong scaling hypothesis is that, once we find a scalable architecture like self-attention or convolutions, which like the brain can be applied fairly uniformly (eg."
8. **Why Does Pretraining Work?**
   gist: (none — this tree writes no gists)
   opens: "The pretraining thesis goes something like this:"
9. **Prospects**
   gist: (none — this tree writes no gists)
   opens: "In the problem of decoding, the most important information which we can possess is the knowledge that the message which we are reading is not gibberish…In a similar way, when we consider a problem of nature such as that of atomic reactions and atomic explosives, the largest single item of information which we can make public is that they exist."
10. **Critiquing The Critics**
   gist: (none — this tree writes no gists)
   opens: "Keeping track."
11. **Appendix**
   gist: (none — this tree writes no gists)
   opens: "Powerful generative models like GPT-3 learn to imitate agents and thus become agents when prompted appropriately."

## Tree F

1. **Scaling Hypothesis Foretold**
   gist: The deep learning revolution has begun as foretold by the scaling hypothesis.
   opens: "On GPT-3: meta-learning, scaling, implications, and deep theory."
2. **Meta-Learning**
   gist: GPT-3's ability to learn new tasks from few examples shows meta-learning emerging purely from scale.
   opens: "Learning to learn."
3. **Flexing GPT**
   gist: Despite obsolete architecture and simple training, GPT-3 exhibits runtime meta-learning and creative output that benchmarks miss.
   opens: "‘“They are absolutely reasonable."
4. **Baking The Cake**
   gist: GPT-3 is not full AGI but shows that scaling unsupervised learning forms a large part of the path.
   opens: "Is GPT actually part of AGI—or is the cake a lie?"
5. **Scaling**
   gist: Scaling laws show GPT-3 still has much room to grow, with predictable logarithmic gains in loss.
   opens: "How far will scaling go?"
6. **Blessings Of Scale**
   gist: Larger models trained on more data yield stability, generalization, and meta-learning because scale forces models past superficial solutions.
   opens: "Extrapolating the spectacular performance of GPT-3 into the future suggests that the answer to life, the universe and everything is just 4.398 trillion parameters."
7. **Scaling Hypothesis**
   gist: The strong scaling hypothesis claims that ever larger neural networks will naturally produce more sophisticated behavior.
   opens: "The strong scaling hypothesis is that, once we find a scalable architecture like self-attention or convolutions, which like the brain can be applied fairly uniformly (eg."
8. **Why Does Pretraining Work?**
   gist: Predicting text forces models to move from surface statistics to deeper reasoning because the final bits of loss require true understanding.
   opens: "The pretraining thesis goes something like this:"
9. **Prospects**
   gist: The limiting factor is conviction, not compute, as organizations slow to believe in scaling leave OpenAI to pursue it.
   opens: "In the problem of decoding, the most important information which we can possess is the knowledge that the message which we are reading is not gibberish…In a similar way, when we consider a problem of nature such as that of atomic reactions and atomic explosives, the largest single item of information which we can make public is that they exist."
10. **Critiquing The Critics**
   gist: Expert dismissal of scaling was consistently wrong, and the voice of authority avoids testable predictions.
   opens: "Keeping track."
11. **Appendix**
   gist: The appendix argues that agency emerges from generative models.
   opens: "Powerful generative models like GPT-3 learn to imitate agents and thus become agents when prompted appropriately."
12. **It From Byte**
   gist: Generative models trained on any data may develop agency because agency is a continuum useful for prediction.
   opens: "Powerful generative models like GPT-3 learn to imitate agents and thus become agents when prompted appropriately."
13. **Backlinks**
   gist: This page lists what links here.
   opens: "[Backlinks (what links here)]"
14. **Similar Links**
   gist: Similar topics are linked here for further reading.
   opens: "[Similar links by topic]"
15. **Bibliography**
   gist: References used in this page are collected below.
   opens: "[Bibliography of links/references used in page]"

Sampled deeper gists, each beside the prose it stands in for:
- gist: Experts' predictions were wrong and their authoritative tone avoids falsifiable claims, urging calm instead of alarm.
  prose: "Hindsight is 20⁄20. Even in 201511ya, all the experts assured us that AGI the scaling hypothesis seemed highly dubious: you needed something to scale, after all, and it was all too easy to look at flaws in existing systems and imagine that they would never go away and progress would sigmoid any month now, soon. Like the genomics revolution where a few far-sighted seers extrapolated that the necess…"
- gist: Even simple systems like Conway's Game of Life may chunk patterns into entities that invite an intentional stance.
  prose: "Cellular Automatons It would also be hard to say at all what mathematical or physical systems exhibit the right kinds of maximizing behavior which can be generalized to an intentional stance. Does the ultra-abstract & simple cellular automaton Conway’s Game of Life (GoL) induce an intentional stance? It has no agents, no biology, no evolution in the usual sense—but it does have many small patterns…"
- gist: Variational approaches are not learned for a single system because simpler approximations suffice until scale forces them out.
  prose: "Inducing Emergence Is Expensive Of course, this frame can be more expensive than solving a problem directly. Variational approaches are powerful but counterintuitive, and there are often many simpler approximations or memorization that a model can do. For a single problem like modeling the orbit of Pluto, it is unlikely that any variational approach would be learned. Why would it, when there is on…"



Answer in JSON only, no prose outside it:

{
  "ranking": ["<best label>", "…", "<worst label>"],
  "unusable": ["<labels whose tree you would not navigate by at all>"],
  "boundaryFaults": { "<label>": ["<a boundary that cuts an argument mid-thought, or welds two unrelated ones — quote the two titles it sits between>"] },
  "missingCuts": ["<a cut the article needed that no tree here makes — or leave empty>"],
  "titles": { "<label>": "names" | "generic" },
  "gists": { "<label>": "claims" | "topic-labels" | "invented" | "none" }
}

Rank by ONE question: reading this article for the first time with the tree as
your only map, which carving would you actually navigate by? Boundaries first,
titles second, gists third. A tree with no gists can still win on boundaries —
say so in the ranking and "none" in gists rather than marking it down twice.
