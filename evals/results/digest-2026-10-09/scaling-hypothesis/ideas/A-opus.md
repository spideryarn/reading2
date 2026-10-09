# scaling-hypothesis — ideas — A-opus

## 1. Power-law scaling: fixed fractional gains cost multiplying compute (assumed)

When loss falls as a power law of compute, each further multiplying of compute, say 1000 times more, cuts the loss by roughly the same fraction. So progress is steady and predictable on a logarithmic axis, but every equal step costs far more than the last.

*Why you need it:* The forecasts, such as GPT-3 halving GPT-2's loss and a further 100–1000 times more compute giving about a 30% drop, and the claim that the curves have not bent, only make sense if the reader knows what a power-law curve implies about cost and diminishing returns.

- spya-asr663: "its scaling continues to be roughly logarithmic/power-law, as it was for much smaller models & as forecast"
- spya-edr6mj: "if the scaling curve continues for another 3 orders or so of compute (100–1000×) before crossing over and hitting harder diminishing returns, the cross-entropy loss will drop to ~1.24"
- spya-x3c389: "every additional 0.1 bit decrease comes at a steeper cost and takes more time."
- spya-kc39vs: "If we see such striking gains in halving the validation loss but with so far left to go"

## 2. In deep learning, bigger problems are easier (introduced)

For neural networks, making the model, data, compute and task bigger and more varied tends to make learning faster, steadier and more general. Small setups get stuck on narrow tricks; large, varied ones push the network into general skills such as meta-learning, meaning learning how to pick up a new task from a few examples.

- spya-sfkxh8: "The blessings of scale is the observation that for deep learning, hard problems are easier to solve than easy problems—everything gets better as it gets larger"
- spya-sfkxh8: "The bigger the neural net/compute/data/problem, the faster it learns, the better it learns, the stabler it learns, and so on."
- spya-ypbup8: "Or in Procgen or CoinRun, training on hundreds of levels trains agents to solve levels individually and worsens performance on other levels, but at thousands of levels, they begin to generalize to unseen levels."
- spya-evn08w: "If you have a system that has memory, and the function of that memory is shaped by reinforcement learning, and this system is trained on a series of interrelated tasks, this is going to happen. You can’t stop it."

## 3. Cheap shortcuts win until the data outgrows them (introduced)

A big network holds countless possible sub-solutions, and their average favours simple ones. Memorizing or surface-level shortcuts are learned first because they are cheapest. Only when the data is too large and varied to memorize does the truly general rule, such as real arithmetic, become the simplest thing that fits.

*Why you need it:* This explains why capabilities appear suddenly at scale rather than gradually, and why small models seem to lack them.

*Analogy:* A student who memorizes past exam answers does fine until the exam bank becomes too large to memorize, at which point actually learning the method becomes the less effortful path.

- spya-grkhs8: "They function as an ensemble: even though there are countless overfit sub-models inside the single big model, they all average out, leading to a preference for simple solutions."
- spya-uknzzk: "sub-models which memorize pieces of the data, or latch onto superficial features, learn quickest and are the easiest to represent internally."
- spya-vkkfzh: "but it can’t possibly memorize all the instances of arithmetic (implicit or explicit) in GPT-3’s Internet-scale dataset. If a memorizing sub-model tried to do so, it would become extremely large and penalized."
- spya-dbrxu8: "They need rich enough models to compute them feasibly, enough data to force them out of easier solutions (which will fail on a few rare datapoints), and enough training"

## 4. Strong versus weak scaling hypothesis (introduced)

The strong version says that once you have an architecture that scales, simply making it bigger and training it on more will produce ever more sophisticated behaviour without new inventions. The weak version agrees that scale matters but holds that intelligence still needs many separate, hand-designed brain-like modules built piece by piece.

*Why you need it:* The contrast explains why labs with similar resources behave so differently.

- spya-m3gtj6: "we can simply train ever larger NNs and ever more sophisticated behavior will emerge naturally as the easiest way to optimize for all the tasks & data."
- spya-vr9q2p: "they believe that AGI will require us to “find the right algorithms” effectively replicating a mammalian brain module by module"
- spya-arrq35: "is making a startup-like bet that they know an important truth which is a secret: “the scaling hypothesis is true!”"

## 5. Predicting human output means modelling the minds behind it (introduced)

Human text and video are a by-product of human reasoning, causality, history and goals. A model trained to predict that output well must learn those underlying things, including models of the people, real or fictional, who would produce it.

- spya-h74fhr: "we constantly emit large amounts of structured data, which implicitly rely on logic, causality, object permanence, history—all of that good stuff."
- spya-h74fhr: "A model learning to predict must learn to understand all of that to get the best performance"
- spya-cw7jg4: "it learns generative models of many agents, real or fictional."

## 6. The last fractions of prediction error hold the intelligence (introduced)

Most of a text predictor's error is removed by simple statistics such as letter frequencies and spelling. The tiny remainder, often less than a hundredth of a bit per character (the unit for how surprised the model is by each letter), comes from rare cases that only reasoning, common sense and understanding of people can predict. So small drops in loss near the end can mean large gains in ability.

- spya-rz8jsm: "the second model would attain a lower average error of barely <0.02 bits per character!"
- spya-kmyg3w: "The implication here is that the final few bits are the most valuable bits, which require the most of what we think of as intelligence."
- spya-g3b5y7: "nothing less than true understanding will suffice for ideal prediction."
- spya-u2vxzs: "One only has to make a single bad decision, out of a lifetime of millions of discrete decisions, to wind up in jail or dead."

## 7. Belief, not hardware, is the bottleneck (introduced)

Once the needed computers already exist and are affordable, which the piece calls a hardware overhang, what decides who builds a breakthrough is whether anyone is convinced it will work. Knowing a problem has an answer changes how hard people attack it.

- spya-khnsat: "The existence of the hardware overhang implies that the limiting factor here is less hardware than human"
- spya-pmtc3q: "Once you have [those two], then there is a third thing is that is needed—and that is conviction."
- spya-cn4vbh: "Once a scientist attacks a problem which he knows to have an answer, his entire attitude is changed."
- spya-eexw9k: "said competitors lack the very most important thing, which no amount of money or GPUs can ever cure: the courage of their convictions."

## 8. Succeeding at AI must look like 'just X' (introduced)

Explaining intelligence means showing it is made of simple parts that are not themselves intelligent. So calling a model 'just multiplications' or 'just memorized pages' is not a criticism: it describes what any success would have to look like.

- spya-mpden3: "dismiss any model as “just” this or that"
- spya-ay4yw7: "Showing that some task requiring intelligence can be solved by a well-defined algorithm with no ‘intelligence’ is precisely what success must look like!"
- spya-ta3e6d: "A human brain, too, does not exhibit the intelligence under a neurobiologist’s microscope that it does participating in a lively conversation."

## 9. Statements unchanged by the truth carry no information (introduced)

If an expert would say the same reassuring thing whether a claim were true or false, the statement tells you nothing about the claim. It serves social purposes such as calm and respectability (it is phatic, meaning talk for social effect rather than to inform). The test of a real forecast is that it makes falsifiable, checkable predictions and names what would change the forecaster's mind.

- spya-kdcvq7: "There is, however, a certain tone of voice the bien pensant all speak in, whose sound is the same whether right or wrong"
- spya-zyncdd: "The voice does not issue any numerical predictions (which could be falsified)."
- spya-b93jbz: "What specific task, what specific number, would convince you otherwise?"

## 10. Agency is a matter of degree and hard to rule out (introduced)

Being an agent, something that pursues goals, is not an on-or-off property but a continuum, and a good enough simulation of an agent is an agent. Because treating things as goal-seekers is useful for prediction in so many settings, a powerful model may develop agency even without agent data. Not seeing agency is no proof it is absent.

- spya-nkzwpu: "A sufficiently accurate simulation of an agent just is an agent."
- spya-ueb3d2: "agency is not a discrete thing, but a continuum, which is a convergent instrumental drive / emergent capability because it is useful even for understanding “non-agentic” things."
- spya-msngfz: "Agency may be like Turing-completeness: even in settings free of selection or optimization, it is a capability too useful and too convergent to guarantee its absence."
- spya-jrm0w9: "that there is no overt agency doesn’t mean it is not there."
