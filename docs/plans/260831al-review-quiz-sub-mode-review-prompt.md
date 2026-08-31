# Review: a "Quiz" sub-mode for Review

You are reviewing a **plan**, before a line of it is built. Be adversarial. The most valuable thing
you can find is a step that will appear to succeed while doing nothing, or a design we will have to
undo later.

Reply with numbered findings, each labelled BLOCKER / SHOULD FIX / CONSIDER, each naming the concrete
change you want. Say plainly if you think a whole stage is wrong.

You are read-only: do not edit any file. Useful files to read: `docs/project/review-mode.md`,
`docs/project/block-ids.md`, `src/converse.ts` (§ `REVIEW_SYSTEM`, `buildConverseMessages`),
`src/ideas.ts`, `src/explain.ts`, `src/web/useIdeas.ts`.

## The app

**Spideryarn** — an AI-assisted reading app. You paste a URL, a seven-stage pipeline ingests the
article, and a reading view shows the prose with a "band" beside it belonging to whichever of twelve
**modes** is on (glossary, summaries, ideas, timeline, quotes, search, diagram, chat, review, …).

Two facts about the codebase matter for this review:

1. **Every block of the article has a stable id** (`spya-k3m9qt`). Every feature addresses text by
   that id, never by offset or selector. When a model names ids, we validate every one of them
   against `blocks.json` and drop the ones it invented — a discipline the `ideas` and `search`
   stages already run, because models invent ids.
2. **Cached artefacts are pipeline steps.** `glossary`, `ideas`, `quotes`, `timeline` etc. each
   produce a durable artefact keyed by article, stamped with a fingerprint of (blocks + tree +
   metadata + prompt version + model), so we can tell whether it still describes the article. Some
   run on ingest; the expensive per-mode ones are off the default list and are run on demand by a
   button in the band, as a background job the client polls.

## Review mode today

The reader talks — or dictates — about what they took from the article, and the model shows them
where their account and the piece come apart. It is a **chat thread** under the hood: same table,
same store, same streaming route, same citation contract as chat, distinguished by
`ChatThread.kind: "chat" | "review"`, with a per-turn `ReviewStance`
(`balanced | respond | socratic | signposts`) stored on the assistant row.

Its prompt is the feature, and it was rewritten twice after cross-family review. The faults that
draft had, which the new prompt in this plan must not repeat:

- It treated the model's reading of the article as ground truth. There is now a long *"what you are
  and are not entitled to say"* section: a correction must be carried by a **quoted sentence that
  contradicts the reader by itself**; anything the model reached by reasoning is offered as the
  model's own view or not at all.
- It forbade grading and then listed the ingredients of a grade. "Yes, that's his move" points at a
  claim and is wanted; "that reading holds up well" is a verdict on the reader wearing a friendly
  face and is the sentence to delete.
- Absolutes in one section silently contradicted rules in another, and the model visibly
  half-obeyed both. There is now an explicit ranking: the entitlement rules, then the reader's own
  words, then the stance.
- Every quotation must carry the block id it came from.

## The proposal

**The plan is `docs/plans/260831al-review-quiz-sub-mode.md` — read it from the repo before
answering.** In short — a second sub-mode inside the Review band
where the *article* asks the questions:

- A new cached artefact + pipeline step `quiz`: ~12 short-answer questions, each with a
  model-written reference answer, the block ids the answer lives in, and two 1–5 integers `ease`
  and `value`. **We** sort by `ease + value`, not the model.
- A streamed, **stateless** `POST /api/quiz/:slug/mark` that takes `{ questionId, answer }` and
  replies "what you got, what's missing, where to look". Nothing is stored. This is the second
  deliberate exception to "LLM calls happen in the pipeline, not request handlers" (the first is
  explaining a reader's selection).
- UI: one question at a time by default, an option to reveal the whole ordered batch and pick, a
  collapsed "show the answer", dictation on the answer box. A new URL parameter `?review=quiz`.

## Decisions the owner has already made — do not re-litigate these, but do tell me if one of them
## makes the rest of the plan incoherent

- A quiz is **not** a conversation, so **not** a third `ThreadKind`. One question, one answer, one
  reply.
- Questions are a **cached per-article artefact**, not generated per session.
- Each question carries a **reference answer**, revealable by the reader.
- The reply says what you got / what's missing / where to look. **No score, no grade.**
- Attempts are **not stored** in v1. A reload starts fresh.
- Whole article, not scoped to where the reader is.

## What I want reviewed

1. **The mark prompt is the whole feature, and it is the part the plan says least about.** Given
   review-mode's four recorded prompt faults above, write me the specific instructions you would put
   in the quiz-marking prompt, and — more useful — name the sentences you predict the model will
   emit that we do not want. Where exactly is the line between *confirming a claim* (wanted) and
   *grading the reader* (banned), when the question has a right answer and the reader got it wrong?
   How should it behave when the reader's answer is right but the reference answer is wrong or
   partial? That case is the one I most expect to go badly.

2. **Ordering by `ease + value`.** Is a single blended sum the right rule for "easy-first-then-
   getting-harder, and central-or-important-first"? A hard-central question and an easy-peripheral
   one tie at 6 and we break towards central. Is that right, or should the list be interleaved some
   other way (e.g. strictly by ease, with value as tie-break)? Is asking a model for two 1–5
   integers per question going to produce anything with signal in it, or will it return 4s and 5s
   for everything — and if so, what would produce a real ordering?

3. **The reference answer.** Is committing to an answer at generation time actually better than
   working it out at mark time? It is written without the reader's attempt in view, which is the
   point — but it is also written by a cheaper/earlier call over the whole article, and it will
   sometimes be wrong. What is the failure mode when a stale-but-current artefact carries a wrong
   reference answer and the mark call defers to it?

4. **Statelessness.** Nothing about an attempt is written. Enumerate what that costs beyond the
   obvious "a reload loses your place" — anything about abuse, cost attribution, spend tracking,
   debugging a bad mark, or evaluating the feature later that we will regret not having a row for.
   Is there a cheap thing we could log now that is not a progress model?

5. **The stage boundaries.** Is each stage genuinely abandonable — would the tree make sense if we
   stopped there? Stage 1 lands an artefact nothing reads; stage 2 lands routes nothing calls. Is
   that the right cut, or should stage 1 include a crude end-to-end path so that the first thing we
   see is a real question and a real mark?

6. **The `?review=` parameter.** The project's rule is that view state lives in the URL and that a
   parameter which changes nothing on screen should not exist. Is a sub-mode parameter the right
   call, or is this telling us that Quiz should have been a thirteenth top-level mode after all?
   What breaks when `?review=quiz` and `?thread=<a review thread>` are both present?

7. **What will silently succeed.** The project has a documented history of things reporting success
   while doing nothing, with the obvious check agreeing because it shares an assumption with the
   code. Where in this plan is that most likely — and what check would catch it that a passing test
   suite would not?

8. **Anything we will have to undo.** Particularly: what does storing attempts later cost us if we
   ship the stateless version first? Is there a shape for v1 that keeps that door wider open at
   no extra cost now?

9. **Anything else that is wrong, missing, or over-built.** We prefer boring, and we prefer the
   simplest version first — tell me what to cut.
