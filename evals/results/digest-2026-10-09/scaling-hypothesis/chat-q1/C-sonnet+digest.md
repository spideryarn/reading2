# scaling-hypothesis — chat-q1 — C-sonnet+digest

> How do the scaling hypothesis and the claim that pretraining on next-token prediction forces a model towards real world understanding relate to each other? Are they separate claims, or does one depend on the other?

They are separate claims, and the article treats them that way. They fit together because each covers a gap the other leaves open.

The pretraining thesis is about what a good enough predictor must contain. If a model matched humans at predicting text, it would need causality, commonsense and theory of mind to do it [spya-g3b5y7], and it is hard to say it "doesn't truly understand" [spya-nhgv5g]. But the article calls this "logically impeccable" yet unconvincing, because it says nothing about whether training can actually reach that loss. The data might not exist, the models might be too small, or the architecture might be wrong [spya-e5n86h spya-faees7].

The scaling hypothesis fills that gap. It says that once you have a uniform, scalable architecture, simply training bigger models makes sophisticated behaviour emerge [spya-m3gtj6]. The author settles the pretraining question with this kind of evidence: "apparently, it would've worked fine," and it just needed more compute and data than anyone risked [spya-s0h95g]. The sub-model account then explains the mechanism. Scale and data push the model past memorizing shortcuts toward general solutions [spya-uknzzk spya-vkkfzh].

The dependence runs mostly one way. The scaling hypothesis does not need the pretraining thesis. Its examples include image models, game agents and robot control, none of which are text prediction [spya-ypbup8]. The pretraining thesis, on the other hand, only becomes practically interesting if scaling carries you toward low loss.

My inference is that the link is also loose in the other direction. The article admits it cannot say what capabilities each drop in loss will buy: "I don't know" [spya-f6zupy]. So scaling shows the loss keeps falling, and the pretraining thesis says low loss implies understanding. The step between them is argued, not demonstrated.

The author also changed his mind on the two at different points. He was skeptical of scaling advocates in the 2000s [spya-emqjaa] and of the pretraining thesis even later [spya-e5n86h].
