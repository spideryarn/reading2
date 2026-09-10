# Review prompt: the reader study protocol (260910a)

You are reviewing a **document**, not code: a user-study protocol for Spideryarn, an AI-assisted
reading app, which the founder (Greg) will run himself with a handful of readers. Do not edit any
file. Read-only review.

## Read

1. The protocol under review:
   `docs/research/260910a-reader-study-protocol-do-the-reading-tools-help-understanding.md`
2. Its brief: `docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md`, section
   "P — test the product's purpose before adding more modes", and "Read this before taking a stage".
3. `docs/project/vision.md` (intent, principles, anti-goals) and `docs/project/open-questions.md` § Q6.
4. For factual claims about the product the protocol relies on: `docs/project/privacy.md`
   (§ Deleting an article, for good), `docs/project/billing.md` (free allowance of three ingests),
   `docs/project/experimental-features.md` (which modes are hidden by default),
   `docs/project/public-shelf.md` (sharing lists an article publicly), `docs/project/comments.md`.

## Constraints the protocol must respect (from the brief)

- Greg recruits and consents; no agent contacts readers.
- No telemetry project, no code changes, no model-based scoring, no answers or grades stored in the
  product, no automatic summaries or completion scores. Outcome is reconstructing and interrogating an
  argument, not time-in-app/clicks/completion.
- Two comparable passages, counterbalanced Spideryarn vs ordinary prose; 3–5 readers, formative.
- Tasks: find a claim and its evidence, explain a key term in the author's sense, name an
  uncertainty/counterargument, reconstruct the argument without the article; optional later recall.
- Human-authored rubrics. Observe whether generated text leads back to evidence; record interruptions
  (mode choice, missing glossary explanations, poor figures).
- Must say: what is measured and how, what counts as helping or not, how many readers and which
  articles, what readers are told, consent text, Greg's step-by-step; and name the simpler design
  passed over.

## The conclusion I would least like to be wrong about

That the **decision rules in "What would count"** are sound: that with four readers, a paired
within-reader comparison, a 10-percentage-point threshold on reconstruction in 3 of 4 readers, and a
"warning" triggered by 2 of 4 readers, are sensible pre-registered rules that neither over-claim nor
are so strict or noisy that any result is uninterpretable — and that the passage confound is handled
by the rotation. Push hardest there.

Second: that the **consent text** is honest and complete for a UK sole trader running informal user
research on a live product whose project docs are in a public repository — in particular whether it
over-promises on deletion (check against privacy.md).

Third: task-order contamination — reconstruction is closed-book before the open-book questions; is
anything else leaking between the two conditions or between tasks?

## Also check

- Methodological flaws a UX researcher or cognitive psychologist would flag (demand characteristics,
  novelty, blinding, scoring reliability, ceiling/floor, time budget realism for 3,000–4,000 words in
  15 minutes).
- Any claim about the product that is false against the docs listed above.
- Anything that violates the vision's anti-goals or the brief's constraints.
- Places that are unclear to Greg as the person following it step by step.
- Where it is too long: what could be cut without loss.

## Answer format

Findings ranked P0 (would make the study misleading or the consent dishonest) / P1 (should fix
before running) / P2 (worth improving). For each: the section, the problem, why, and a concrete
proposed rewrite. Then a one-paragraph overall verdict. Say explicitly if you found nothing at a level.
