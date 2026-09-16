# FAQ — the questions a careful reader puts to this piece, and where it answers them

A new mode in the band between the spine and the prose, behind the experimental switch.

Asked for by an admin through the Feedback button, 2026-09-12 08:19Z
([SPIDERYARN-READING2-3A](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3A), on
`entropy-24-00930-spya-bmvfyb`, build `607b57a0`; Overseer queue `qi-n8xswawn`):

> Add FAQ (frequently asked questions) mode as a new experimental features mode.

An admin's request is built without debating whether; simplest-first decides how
([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)). The run is
unattended, so decisions and assumptions are written here rather than asked in chat.

## What an FAQ is, in this product

The obvious FAQ — *"What is this article about? What are the main points?"* with a paragraph under
each — is a summary wearing question marks, and it is [vision.md](../project/vision.md)'s anti-goal
exactly: it replaces the reading. Fable was asked what an FAQ should be for a reader who is trying to
read deeply (2026-09-16), and this plan takes its answer:

**The questions a careful first-time reader would put to this piece while reading it — the "wait,
but…" moments — and where the piece itself answers each one.** It is vision.md's *Interrogate*,
pre-computed: every row is a door back into the prose.

What belongs, roughly in order of value:

- **An objection the piece anticipates** — *"But doesn't X contradict Y?"* → where the author deals
  with it.
- **A move that needs clarifying** — *"Why say A here when B was just conceded?"*
- **A relation** — *"How does X bear on Y?"* → the two passages, and the reader connects them.
- **An implication** — *"Does this commit the author to Z?"*
- **"Does the piece say anything about Z?"** — the one kind whose honest answer can be *no*.

What does not: whole-piece questions (*what is it about*, *what are the main points*) that a gist or
Summary answers; a question whose whole answer is one term's definition (Glossary); recall trivia
(Quiz); anything only the open web can answer (Chat). The prompt's rule: *skip any question a reader
could answer by reading the passage in front of them — ask the one they would have after reading it.*

### How it differs from its neighbours — the line each card must hold

| Mode | Who asks | What the answer is |
|---|---|---|
| **Quiz** | the article asks *you*, afterwards | your answer, marked — it tests recall |
| **Ideas** | nobody asks | the propositions you must hold to get the piece |
| **Glossary** | nobody asks | a word's meaning |
| **Chat** | *you*, now, your own question | a model's answer, streamed, per question |
| **FAQ** | the questions *you would likely* ask it, while reading | **the article's own passages**, found and checked; free to reopen |

FAQ never marks the reader and never writes for the author.

## What v1 is

```
  FAQ MODE — same spine, same article, the band is a list of questions

 ┌─────────────┬──────────────────────────────┬──────────────────────────┐
 │  ▇▇▇▇▇▇▇▇   │ If entropy only increases,   │  … a closed system can   │
 │  ▇▇▇▇▇      │ how can a fridge get colder? │  lower its local entropy │
 │  ▇▇▇        │  ┃ "a closed system can      │  only by exporting more  │
 │  ▇▇▇▇▇▇▇    │  ┃  lower its local entropy" │  to its surroundings …   │
 │  ▇▇         │    ¶ jump →                  │                          │
 │  ▇▇▇▇       │  ▸ Show a short answer       │                          │
 │             ├──────────────────────────────┤                          │
 │             │ Does the argument depend on  │                          │
 │             │ the system being isolated?   │                          │
 │             │  NOT SETTLED IN THE PIECE    │                          │
 │             │  The model could not find    │                          │
 │             │  where the piece answers     │                          │
 │             │  this. Nearest it comes:     │                          │
 │             │  ┃ "we will assume …"  ¶ →   │                          │
 │             ├──────────────────────────────┤                          │
 │             │ foot: 12 questions · 2 were  │                          │
 │             │ dropped: their passages were │                          │
 │             │ not in the article           │                          │
 └─────────────┴──────────────────────────────┴──────────────────────────┘
```

- **One model pass over the article, stored once**, like Ideas — a pipeline step `faq` in
  `STEP_ORDER`, not in `DEFAULT_INGEST_STEPS`, started by opening the mode (`useAutoRun`). Messages
  wire, `articleWithIds`, the capable model, `high` effort — which puts it in the
  `ideas`/`timeline`/`quiz`/`sketch` cache group, so it sits beside them in `STEP_ORDER`. A re-run
  **replaces**; question ids are inherited on an unchanged normalised question text (Ideas'
  `idsByName` shape). No *find more*.
- **Per question**: `question` (one sentence, the article's own terms), `status`
  (`answered` | `unsettled`), `passages` (1–3 of `{blockId, quote, start}`), and `answer` (one or two
  plain sentences, **optional**, only for `answered`).
- **Every passage is verified** — the id must be a block in the article, and the quote must be found
  in *that* block by `findQuote` — the discipline `validateOccurrences` in
  [`src/ideas.ts`](../../src/ideas.ts) already has, drop-and-count. **A question with no surviving
  passage is dropped whole** (`unanchored`). Counts go on the artefact and the band's foot says how
  many were dropped, never why in detail.
- **Order: reading order**, by the first passage's document position, fixed at write time. "Most
  frequently asked first" would be a fiction — nobody asked.
- **Quantity**: one per ~600 body words, clamped 4–12, capped at `MAX_QUESTIONS = 12`; fewer is fine.
  No scores and no threshold bar: there is no honest number to sort by here, and a tighter prompt is
  the cheaper fix if the list bloats.
- **The row**: the question; its passages, each a verbatim quote with the existing block jump
  ([`BlockRef`](../../src/web/BlockRef.tsx)); for `answered`, a collapsed **Show a short answer**
  disclosure; for `unsettled`, the heading *"The model could not find where the piece settles
  this"* over the nearest passages — **never** *"the piece does not answer this"*, because absence is
  a model claim wearing real block ids (the lesson of [ideas.md](../project/ideas.md) § It is a
  hypothesis).
- **Behind the experimental switch** — a new mode on an unmeasured prompt. **Owner-only** for v1: a
  visitor gets the explanatory band, as Citations does.
- **No passage marks in the prose, no `?faq=` selection param** — `NO_FOUND` in `selectPassages`,
  like Citations v1. The jump is enough to reach the passage.

### The one product call made here: the short answer, collapsed

Fable recommended **no written answer at all** — the answer *is* the passage — on the grounds that a
model-written answer is the confident-claim surface the anti-goals name. That is the purer version.
It was not taken whole, because Greg asked for an *FAQ*, and a list of questions with no answer
anywhere is likely to read as a broken one. The compromise keeps the passage first and the words
second:

- the passages are always shown, and come **before** the answer;
- the answer is **collapsed** behind *Show a short answer*, the shape Quiz already uses for its
  reference answer, so the reader meets the question and the author's words before any of ours;
- it is one or two sentences, written to the house rule — *plainer than the article, never further
  from it* — and it may not say anything the quoted passages do not support;
- an `unsettled` question has no answer field at all; the validator drops one if the model writes it.

If Greg finds even the collapsed answer too much, deleting it is one field and one disclosure. The
purer version was the one passed over, not forgotten.

## The simpler options passed over

- **No model call — mine the article's own headings phrased as questions.** Free, and most articles
  have no such headings; it cannot produce the anticipated objection, which is the valuable kind.
- **Chat with a pre-filled "suggest questions" prompt.** No new artefact, but it streams afresh on
  every open, pays every time, stores nothing to jump from, and is a chatbot answering rather than
  the article answering.
- **Questions only, no passages** (a list of prompts to think about). Cheaper to validate, but a
  question with no way back to the page fails vision.md § Principles 4.

## Stages

1. **The artefact and the step** (server) — `FaqQuestion`/`Faq` types in `src/types.ts`,
   `ArtifactKind` `faq`, `StepName` `faq`, and every total the compiler asks for
   ([new-mode.md § The artefact](../project/new-mode.md#the-artefact-if-the-mode-shows-one)):
   `SHAPE`, `STAMP_SOURCE`, `STEP_BUDGET_MS`, `STEPS`, `STEP_ORDER`, `TASK_TIER`, `TASK_WIRE`,
   `MODEL_ENV_VAR`, `STAGE_EFFORT`, `ARTICLE_RENDERER`, `REVISION_CARRY_POLICY`, `ArticleReader` and
   its adapter; the migration (a column on `article_revisions` and the step-name CHECK, generated by
   `drizzle-kit generate`); `src/faq.ts` (prompt, parse, verification, reading order, id inheritance,
   `PROMPT_VERSION`); the GET route and `CACHEABLE`; the export put-chain; the cost category. The
   Citations stage-1 commit `85631f9b` is the file list to follow. Tests, red first where there is
   behaviour: an invented id dropped, a paraphrased quote dropped, a question with no surviving
   passage dropped, an `unsettled` question's answer stripped, reading order, the cap, id
   inheritance on an unchanged question and not on a changed article. **A real run** on two local
   articles, with what it produced written below.
2. **The mode** (client) — `MODES` and every client total
   ([new-mode.md § The client](../project/new-mode.md#the-client)) and the test tables it lists as
   going red without a type error; `useFaq` on `useOrderedRead`/`useStepJob`/`useAutoRun`;
   `FaqPanel` in `ModeSurface`; `experimental: true` and `BEHIND_THE_SWITCH`; the card's two
   sentences written to [§ The card on the button](../project/new-mode.md#the-card-on-the-button);
   `docs/project/faq.md`, its line under reading-view-overview.md, and the row in
   experimental-features.md. The Citations stage-2 commit `abde65f7` is the file list. Done when the
   typecheck and the scoped suite are green and a browser run (a Sonnet subagent, Playwright on the
   box) shows the list, a jump landing, the disclosure opening, and the button absent with the switch
   off.
3. **Review, full suite, bookkeeping** — GPT Sol code review (write-capable), the full suite once
   through `scripts/tmux-job.ts`, the note in `docs/user-feedback/`, push to `dev`.

## Deferred, not forgotten

- **Ask about this** — a per-row button that opens an anchored Chat with the question pre-filled. The
  natural v1.1; the plumbing exists.
- **Marks in the prose and a `?faq=` selection**, and the questions waiting in the gutter at their
  passage.
- **The reader's profile** shaping which questions are asked (Ideas does this; it adds a stamp input
  and a staleness sentence).
- **Visitors** on a public-readable article — a projection and the four places new-mode.md lists.
- **Real FAQs** — the questions readers actually asked in comments, fed back in.

## Progress

- 2026-09-16 — plan written; Fable consulted on the product shape.
