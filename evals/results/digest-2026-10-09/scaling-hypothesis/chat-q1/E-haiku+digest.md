# scaling-hypothesis — chat-q1 — E-haiku+digest

> How do the scaling hypothesis and the claim that pretraining on next-token prediction forces a model towards real world understanding relate to each other? Are they separate claims, or does one depend on the other?

They are separate claims, but the article links them, and the link runs mainly one way.

The scaling hypothesis is about size: once a suitable architecture exists, training ever larger networks makes ever more sophisticated behaviour appear [spya-m3gtj6]. The pretraining thesis is about the training goal: predicting human text well enough requires modelling logic, causes and what people believe, since "truth is one and error many" [spya-h74fhr] [spya-g3b5y7]. Nothing in the thesis by itself says a real model will reach that point.

Scale is where the two meet. The author first says the thesis "never struck me as convincing," and he worries that models might be too small or that the scaling curves might not cooperate [spya-e5n86h] [spya-faees7]. He then concludes it would have worked, but only with "more compute & data than anyone was willing to risk" [spya-s0h95g]. So the practical case for the thesis depends on scale.

The article's account of how scale does this is the sub-model argument: a small model can afford to memorize, but at Internet scale memorizing becomes too costly, so a general rule such as arithmetic becomes the cheapest fit [spya-vkkfzh]. The author offers this as a suggestion, not a tested result [spya-jg69cy].

The dependence does not run both ways. The scaling examples include Dactyl, CoinRun and AlphaZero, which do not rest on next-token prediction [spya-ypbup8]. So scaling could hold even if the pretraining thesis were false.

My inference: the pretraining thesis says what a scaled model should learn, and scaling is the mechanism meant to make that happen. The article also admits that lower prediction error does not tell us which abilities will follow [spya-f6zupy], so even a successful scale-up would not settle what the model understands.
