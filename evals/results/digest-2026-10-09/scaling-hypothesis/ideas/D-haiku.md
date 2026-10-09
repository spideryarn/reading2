# scaling-hypothesis — ideas — D-haiku

## 1. Stacking layers to scale a model is not enough (assumed)

Simply enlarging a neural network and its training data is a sound route to capability, because the required algorithms emerge from the scale itself rather than needing hand design.

*Why you need it:* The argument that GPT-3 is a win for scaling and that others should scale only holds if no special architecture is needed; the piece presents this as the lesson rather than defending it.

- spya-ypbup8: "In fact, one may not even need complicated attention mechanisms at scale, as fully-connected networks—hard to get much simpler than them!—work surprisingly well for many tasks."

## 2. Next-word prediction forces understanding of the world (assumed)

Predicting the next token well across enough human text requires modelling the causes, logic, and people behind that text, so sufficiently low prediction loss amounts to genuine understanding.

*Why you need it:* The argument that the final bits of loss must come from reasoning and theory of mind only goes through if good prediction and understanding are the same thing; the piece takes this step without defending it.

- spya-g3b5y7: "For a language model, the truth is that which keeps on predicting well—because truth is one and error many."
- spya-nhgv5g: "how could we say that it doesn’t truly understand everything?"

## 3. Scaling curves as predictable power laws (introduced)

Loss falls along smooth power-law curves as compute, data, and parameters grow, so future capability can be extrapolated, which makes scaling more like statistics than like unpredictable AI breakthroughs.

- spya-s8rx6n: "Nothing in the raw metrics reported on"
- spya-asr663: "its scaling continues to be roughly logarithmic/power-law, as it was for much smaller models & as forecast"
- spya-asr663: "The predictability of scaling is striking, and makes scaling models more like statistics than AI."

## 4. Scale makes hard problems easier than small ones (introduced)

For deep learning, larger models, data, and compute make problems easier to solve rather than harder, reversing the usual research pattern where small things are hard and large things impossible.

- spya-sfkxh8: "The blessings of scale is the observation that for deep learning, hard problems are easier to solve than easy problems—everything gets better as it gets larger (in contrast to the usual outcome in research, where small things are hard and large things impossible)."
- spya-ypbup8: "just simply training a big model on a lot of data induces better properties like meta-learning without even the slightest bit of that architecture being built in"

## 5. Pretraining as a progression from letters to meaning (introduced)

A model trained only to predict the next character climbs through successive stages: letter frequencies, then words, then syntax, then meaning, with each stage yielding smaller but harder-won gains.

- spya-r465ug: "Early on in training, a model learns the crudest levels"
- spya-s3g2e7: "The next thing is picking up associations among words."

## 6. Hardware overhang means the bottleneck is will, not machines (introduced)

Capable hardware often exists long before anyone is allowed or willing to use it for a given research direction, so progress is limited by organisational conviction more than by compute.

- spya-ad5qgy: "while supercomputers of the necessary power would exist long before the connectionist revolution began, no one would be allowed to use them"
- spya-khnsat: "The existence of the hardware overhang implies that the limiting factor here is less hardware than human"

## 7. Expert forecasts of AI stagnation were repeatedly wrong (introduced)

Confident predictions by established researchers that scaling would plateau were falsified by later results, and those experts did not revise their views, so their assurances carry little weight.

- spya-m9r8zx: "And they were wrong. I am aware of few issuing a mea culpa or reflecting on it."
- spya-b93jbz: "all the experts assured us that AGI the scaling hypothesis seemed highly dubious"

## 8. Agency is a continuum, not a discrete property (introduced)

Agency is not a special immaterial ingredient but a graded capability built from ordinary parts, so it can appear in models that were never trained on explicit agents.

- spya-mkbrjp: "I argue no: agency is not discrete or immaterial, but an ordinary continuum of capability"
- spya-jn3pv0: "All ‘agency’ is constructed of non-agentic bits like atoms."

## 9. Agency can be induced by imitating agents (introduced)

A generative model trained to imitate human text learns models of many agents, so it can act as an agent when prompted, which makes filtering data an insufficient safety strategy.

- spya-nkzwpu: "A sufficiently accurate simulation of an agent just is an agent."

## 10. Intentional stance as a useful shortcut (introduced)

Treating a system as if it wants to optimise some global quantity is a predictively useful shortcut that is mathematically equivalent to step-by-step simulation but much easier to use.

- spya-ehe426: "It is both true, predictively useful, and mathematically equivalent to the other way of formulating it"
