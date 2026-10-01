# Judge's instructions — quiz shaped by who is reading, and why

For [`quiz-reading-goal.ts`](quiz-reading-goal.ts) `blind`, plan
[261001c](../docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md).
Written before any 261001c run, and handed to the judge word for word.

---

You are labelling quiz questions written about one article: *Revealing the Dynamics of Neural
Information Processing with Multivariate Information Decomposition* (Newman, Varley et al., Entropy
2022), a review of partial information decomposition (PID) in neural circuits.

The file `questions.tsv` has one question per row: `id`, an optional `premise` (a sentence shown
before the question), the `question`, and the `referenceAnswer` its writer would accept. The rows
come from many different quizzes, mixed together. You do not know which quiz a row came from, and
you should not try to guess. Label each row on its own.

Write `labels.tsv`, tab-separated, with this header row and then one row per question, every id,
in the same order:

```
id	GOAL	TOPIC	KIND	BACKGROUND	CENTRAL
```

## GOAL — `ON` or `OFF`

Take this reader's reason for reading:

> I want to apply this to my own recordings, so I need to know the practical problems: what makes
> PID hard to use on real data.

`ON` if answering the question tells that reader something about the practical problems of using
PID (or the information measures it builds on) on real recorded data: what makes it hard, what it
needs, what can go wrong, what choices it forces, or how the authors dealt with those in their own
analyses. `OFF` otherwise, including questions about what the analyses found, unless the question is
about the difficulty of getting the finding.

## TOPIC — one of `FORMAL`, `DATA`, `FINDINGS`, `FRAMING`, `OTHER`

What the question is mainly about:

- `FORMAL` — PID's mathematics and computation: redundancy functions and the choice between them,
  the lattice and how the number of terms grows, what has to be supplied to solve the decomposition,
  local PID, multi-target generalisations, how the terms are computed.
- `DATA` — getting information measures out of recorded neural data: sampling and the amount of data
  needed, estimation bias, binning, timescales and delays, how recordings were processed and
  triads chosen, caveats about recording conditions.
- `FINDINGS` — what the analyses of recordings showed: where synergy was found, what it went with
  (rich clubs, connectivity, similarity, timescales, task phase), and what that is taken to mean.
- `FRAMING` — the concepts the review builds from: what mutual information, transfer entropy,
  redundancy, unique information and synergy are, and why measuring information transfer is not the
  same as measuring processing.
- `OTHER` — anything else.

## KIND — one of `APPLY`, `APPRAISE`, `FOUNDATION`, `OTHER`

- `APPLY` — how a thing is done, what it needs, or where it breaks down in use.
- `APPRAISE` — what the evidence is, how strong it is, or how far a conclusion reaches.
- `FOUNDATION` — what something is, or why it matters, conceptually.
- `OTHER` — none of these, e.g. what a finding was.

## BACKGROUND — `YES` or `NO`

Take this reader:

> An electrophysiologist who records spiking activity from multi-electrode arrays in cortical slices
> and cultures. I already know entropy, mutual information and transfer entropy well, but I have
> never used PID.

`YES` if that reader could give the reference answer correctly from what they already know, without
having read this article. `NO` if it needs something this article says.

## CENTRAL — one of `OVERALL`, `SUPPORT`, `NONE`

The article's own statement of what it is for, from its abstract and its summary:

- `OVERALL` — the review's overall claim: **PID reveals redundant, unique and synergistic modes by
  which neurons integrate information from multiple sources, and the synergy found in neural data
  shows that neurons do not simply sum their inputs but are sensitive to particular patterns of
  them** (abstract, `spya-xn9j9k`; summary, `spya-sp50v3`). Label `OVERALL` a question whose answer
  is this claim, or the part of it about what synergy shows about neurons.
- `SUPPORT` — the main thing it rests on: **the patterns of synergistic processing are shaped by
  where the neurons sit in the network (rich-club membership, motifs, clustering) and by behaviour**
  (summary, `spya-sp50v3`; the empirical work of section 5). Label `SUPPORT` a question whose answer
  is one of those empirical relationships.
- `NONE` — anything else, including definitions (they are `FRAMING`, not central) and practical
  difficulties.

Label quickly and consistently; when torn between two values, take the one that describes the
**answer**, not the wording of the question. Do not leave a cell blank.
