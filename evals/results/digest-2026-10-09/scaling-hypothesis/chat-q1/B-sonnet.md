# scaling-hypothesis — chat-q1 — B-sonnet

> How do the scaling hypothesis and the claim that pretraining on next-token prediction forces a model towards real world understanding relate to each other? Are they separate claims, or does one depend on the other?

They are separate claims that support each other, though the article never states the relationship in one place. The pretraining thesis is about what the objective demands: to predict text very well, a model has to learn logic, causality and the rest, because "nothing less than true understanding will suffice for ideal prediction" [spya-g3b5y7]. The scaling hypothesis is about how you get there: once you have a scalable architecture, you "simply train ever larger NNs" and sophisticated behaviour emerges as the easiest way to optimise the tasks and data [spya-m3gtj6].

The pretraining thesis does not entail the scaling hypothesis. The author calls it "logically impeccable" but unconvincing, because nothing shows a model would reach that low loss in practice. It might need more text than exists, or models too small to get past surface patterns, or a different architecture [spya-e5n86h spya-faees7]. He says it "would've worked fine" and only lacked enough compute and data [spya-s0h95g]. In other words, the scaling evidence is what turned the thesis from a theoretical argument into a working one.

The dependence runs the other way only partly. The scaling hypothesis isn't tied to text prediction: the article lists scaling benefits in reinforcement learning, image models, and robotics [spya-ypbup8]. But for GPT-3 the two work together. Scale matters because the objective leaves "the hard things" once easy statistics are exhausted [spya-h74fhr], and a big model trained on enough data is pushed past lazy memorising sub-models toward ones that actually generalise [spya-vkkfzh spya-wq498y].

My inference is that the first claim says why the target is worth reaching, and the second says why you can reach it by brute size.

The article also separates a "strong" scaling hypothesis from DeepMind's "weak" one, which holds that scale helps but the right algorithms must still be found piece by piece [spya-vr9q2p]. The pretraining thesis fits the strong version better, since it implies one simple objective is enough.
