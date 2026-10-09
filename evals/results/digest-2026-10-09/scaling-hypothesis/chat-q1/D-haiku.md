# scaling-hypothesis — chat-q1 — D-haiku

> How do the scaling hypothesis and the claim that pretraining on next-token prediction forces a model towards real world understanding relate to each other? Are they separate claims, or does one depend on the other?

They are separate claims, but the pretraining claim only pays off under scaling, so the second leans on the first. The article's own text supports the separation and the dependence.

The scaling hypothesis is the broader claim: once a scalable architecture is found, "ever larger NNs" will produce "ever more sophisticated behavior" [spya-m3gtj6]. The pretraining thesis is narrower. It argues that a model trained only to predict the next piece of text must learn logic, causality and the rest of what the text encodes, because "truth is one and error many" [spya-h74fhr spya-g3b5y7]. The article calls this "logically impeccable" but says it "never struck me as convincing" [spya-e5n86h].

The dependence shows up where the pretraining argument needs a model that reaches very low loss. Its conclusion, that a model reaching that loss "truly understands everything", is an if-then [spya-nhgv5g]. Whether a model can get there depends on size and data. The article's account of why small models fail is that they memorize or learn surface patterns, and only large models can be pushed past that [spya-uknzzk spya-vkkfzh]. The article's listed doubts are mostly about scale: the text might not exist, or models might need "100 orders of magnitude" more size [spya-faees7].

My inference is that the pretraining thesis is a claim about what happens at scale, so it inherits the scaling hypothesis's uncertainty. The article does not state this dependence in those words.
