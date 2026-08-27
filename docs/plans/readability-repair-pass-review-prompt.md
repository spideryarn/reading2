# Review request — a second-stage model over Mozilla Readability

You are reviewing a **plan**, before it is built. Read `docs/plans/readability-repair-pass.md` in
this repo first; it is short. Then read enough of the code and docs to check its claims:

- `src/extract.ts` — stage 2 as it is today (Readability + jsdom)
- `docs/project/content-extraction.md` — the stage's doc
- `docs/project/block-ids.md` — the contract the plan claims design C breaks
- `docs/project/original-version/extraction.md` — prior art, including a fidelity harness we were told to rebuild
- `evals/README.md` and `evals/pdf/README.md` — how evals are built here, and the trap ("the golds do not exist") the plan says it is avoiding
- `src/models.ts` — the two model tiers; `openai/gpt-5.6-luna` is the quick one, `anthropic/claude-sonnet-5` the capable one
- `src/pdf-read.ts` — the closest existing thing: a model reading a document, with a check that can fail

Context you need: this is a reading app. Stage 2 turns a fetched web page into `article.html`;
stage 3 mints stable ids on its blocks and everything downstream (table of contents, summaries,
notes, scroll position) addresses text by those ids. Re-extracting an article must preserve them.
Prose fidelity matters — the product's whole premise is helping someone read what the author
actually wrote, not a tidied version of it.

## What I want from you

Be specific and be adversarial. I would rather hear that the premise is wrong than get a tidy list
of agreements. In particular:

1. **Is the premise even true?** Does Readability fail often enough, on the kind of long-form
   article this app is for, to be worth a model pass? If your honest answer is "the failures are
   rare and the ones that matter are the loud ones", say so — that changes the whole plan.

2. **The inventory idea** (flatten the raw DOM to `id | tag | depth | chars | kept? | snippet`, and
   let the model judge rows instead of reading the document). Where does that lose the information
   the decision actually needs? Concretely: name a failure mode from the T/B/W/S/D table that the
   inventory *cannot* represent, and say what the row would have to carry instead. I am especially
   unsure about (a) deciding "kept?" by looking the normalised text up in Readability's output —
   what breaks that, given Readability rewrites and unwraps nodes? and (b) whether dropping
   attributes and class names is throwing away the single strongest signal rather than a
   distraction.

3. **Design B (repair by reference).** Is "the model returns node ids and deterministic code copies
   the nodes" actually safe, or does it just move the failure? What can a wrong `insert-after` do
   to a document that a wrong sentence could not? Is there a third design I have not thought of —
   in particular, anything that changes Readability's *inputs* (pre-cleaning the DOM, tuning
   `charThreshold`, per-domain rules) rather than post-processing its outputs, which would be
   cheaper and deterministic and which the plan does not consider at all.

4. **The eval methodology.** Typed assertions instead of full-text golds — is that enough to detect
   a real improvement, or will it be so coarse that both arms score 90% and the experiment answers
   nothing? How many fixtures before a difference means anything? How would you make the run
   trustworthy given each arm calls a model and the answers vary run to run? And: what should the
   scorer's *unit* be — the whole article, a block, a character?

5. **Anything I have got backwards**, including in the six-mode taxonomy and in the reasons for
   ruling out design C.

Answer in prose with headed sections. Where you disagree, say what you would do instead and what
evidence would settle it. If you think the plan should be smaller, say what to cut.
