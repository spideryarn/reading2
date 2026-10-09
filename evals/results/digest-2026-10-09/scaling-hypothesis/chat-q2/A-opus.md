# scaling-hypothesis — chat-q2 — A-opus

> What does Gwern mean when he says agency can come from data, and what is the weakest step in his argument that a model trained only to predict text can end up behaving as an agent?

Gwern means that agency is something a model can pick up simply by learning to predict. The model is never rewarded for pursuing goals. In the plain case, text written by humans is full of people planning and acting. A model that predicts that text is doing "behavioral cloning", which means copying the behaviour recorded in examples. So it learns models of many agents, which a prompt can make it play [spya-mkbrjp spya-cw7jg4].

He then goes further and says agency can arise even from non-human data. His reason is that treating a system as "wanting" something is often the cheapest way to predict it. A river can be described as seeking the lowest path, and a gliding pattern in Conway's Game of Life can be treated as a thing that moves through empty space [spya-ehe426 spya-c874v8]. He even suggests that inferring the rules a Turing machine is following may be a basic form of "theory of mind", the ability to model what someone else intends [spya-fx68sk spya-usu3q6]. The appendix's own summary lists these routes [spya-cwwvxw].

The weakest step, in my judgement (this is my reading, not the article's), is the identity claim: "A sufficiently accurate simulation of an agent just is an agent" [spya-nkzwpu]. Everything after it leans on it, and it is asserted rather than argued.

- His evidence that the model is an agent is that it produces a plan when prompted, or that it acts when people wire it to a robot as in SayCan [spya-cw7jg4 spya-fm6pfc]. My inference is that the goal-directed loop there is partly supplied by the humans who build the system around the model.
- When critics' definitions would exclude such systems, he proposes dropping the word "agent" altogether [spya-fm6pfc]. That sidesteps the dispute instead of settling it.
- Janus objects that the agent framing is an "epicycle", a needless add-on to a simpler picture [spya-e23u6n]. Gwern replies with an analogy to heliocentrism, not with evidence [spya-g2v6ry].

The extension to physics data is a second, softer gap, and Gwern admits it himself. He calls the question of when agency emerges "an empirical matter" [spya-nxp8hh] and says such capabilities "need to pay their way" before a model will learn them [spya-dbrxu8].
