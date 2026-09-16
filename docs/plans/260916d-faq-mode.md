# FAQ — the questions a careful reader puts to this piece, and where it answers them

A new mode in the band between the spine and the prose, behind the experimental switch.

Asked for by an admin through the Feedback button, 2026-09-12 08:19Z
([SPIDERYARN-READING2-3A](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3A), on
`entropy-24-00930-spya-bmvfyb`, build `607b57a0`; Overseer queue `qi-n8xswawn`):

> Add FAQ (frequently asked questions) mode as a new experimental features mode.

An admin's request is built without debating whether; simplest-first decides how
([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)). The run is
unattended, so decisions and assumptions are written here rather than asked in chat.

**Revised after GPT Sol's plan review** ([review](260916d-faq-mode-review-sol.md), ledger at the
foot). The first draft had a collapsed model-written answer, an `unsettled` status and inherited ids;
all three are gone.

## What an FAQ is, in this product

The obvious FAQ — *"What is this article about? What are the main points?"* with a paragraph under
each — is a summary wearing question marks, and it is [vision.md](../project/vision.md)'s anti-goal
exactly: it replaces the reading. Fable was asked what an FAQ should be for a reader who is trying to
read deeply (2026-09-16), and this plan takes its answer:

**The questions a careful first-time reader would put to this piece while reading it — the "wait,
but…" moments — and the passages where the piece itself responds to each.** It is vision.md's
*Interrogate*, pre-computed: every row is a door back into the prose.

What belongs, roughly in order of value:

- **An objection the piece anticipates** — *"But doesn't X contradict Y?"* → where the author deals
  with it.
- **A move that needs clarifying** — *"Why say A here when B was just conceded?"*
- **A relation** — *"How does X bear on Y?"* → the two passages, and the reader connects them.
- **An implication** — *"Does this commit the author to Z?"* → where the piece says so, or comes
  closest.

What does not: whole-piece questions (*what is it about*, *what are the main points*) that a gist or
Summary answers; a question whose whole answer is one term's definition (Glossary); recall trivia
(Quiz); anything only the open web can answer (Chat); a tour of the sections, one question each. The
prompt's rule: *skip any question a reader could answer by reading the passage in front of them — ask
the one they would have after reading it.*

### How it differs from its neighbours — the line each card must hold

| Mode | Who asks | What the answer is |
|---|---|---|
| **Quiz** | the article asks *you*, afterwards | your answer, marked — it tests recall |
| **Ideas** | nobody asks | the propositions you must hold to get the piece |
| **Glossary** | nobody asks | a word's meaning |
| **Chat** | *you*, now, your own question | a model's answer, streamed, per question |
| **FAQ** | the questions a careful reader would likely ask it, while reading | **passages of the article**, verbatim and checked; which passage answers which question is the model's reading |

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
 │  ▇▇▇▇       ├──────────────────────────────┤                          │
 │             │ Does the argument depend on  │                          │
 │             │ the system being isolated?   │                          │
 │             │  ┃ "we will assume …"  ¶ →   │                          │
 │             ├──────────────────────────────┤                          │
 │             │ foot: the words are the      │                          │
 │             │ article's, checked; which    │                          │
 │             │ passage answers which        │                          │
 │             │ question is the model's      │                          │
 │             │ reading.                     │                          │
 └─────────────┴──────────────────────────────┴──────────────────────────┘
```

- **One model pass over the article, stored once**, like Ideas — a pipeline step `faq` in
  `STEP_ORDER`, not in `DEFAULT_INGEST_STEPS`, started by opening the mode (`useAutoRun`), and in
  `FORCE_ONLY_WHEN_NAMED` so an earlier forced step does not buy a model call (Sol F9). Messages
  wire, the capable model, `high` effort. **The request is Ideas' byte for byte up to the
  breakpoint** — `articleWithIds(meta, blocks.filter(isBodyEvidence))` first, carrying the cache
  breakpoint, then FAQ's instructions — so it joins the `ideas`/`timeline`/`quiz`/`sketch` cache
  group and sits beside them in `STEP_ORDER`; `prompt-caching.md` and the `STEP_ORDER` comments that
  name the group are updated (Sol F11, F14). The user message carries the tree skeleton, as Ideas'
  does; the freshness hash is `articleWithIdsFingerprint(blocks, tree, meta)` with the **real
  nullable meta** in both the stage and the step stamp. **No profile** in prompt or stamp in v1.
- **A re-run replaces. No inherited ids** (Sol F6): nothing addresses a question yet — no `?faq=`,
  no per-question reader state — so ids are minted fresh per run (`mintUniqueId`, for React keys),
  and inheritance arrives with the first durable consumer, as Quiz decided.
- **Per question**: `id`, `question` (one sentence, the article's own terms, ≤ 200 chars) and
  `passages`, 1–3 of `{blockId, quote, start}` with each quote ≤ 300 chars. **No written answer**
  (Sol F2, Fable) and **no status** (Sol F1).
- **Every passage is verified the Citations way** (Sol F4): the id must be a block in the body
  evidence, `findQuote(block.text, quote, undefined, "spaced")` must find it in *that* block, and
  what is stored is `block.text.slice(start, end)` — the article's characters, never the model's. An
  overlong quote is dropped, never truncated. Passages are deduplicated on `{blockId, start, end}`
  and sorted into document order.
- **A question with no surviving passage is dropped whole** (`unanchored`). Questions are
  deduplicated on normalised text before the cap. Counts go on the artefact (`unknownIds`,
  `unquoted`, `tooLong`, `duplicate`, `unanchored`, `overCap`, `malformed`), and the stage logs them.
- **Three empty outcomes, each tested** (Sol F8): an answer with no `questions` array fails; a
  non-empty array that validation empties fails with the counts in the message and writes nothing; a
  deliberate `[]` is accepted and drawn as *"The model found no questions worth asking this piece"*,
  because the prompt says fewer is fine and means it.
- **Order: reading order** — a question ranks by its earliest surviving passage, independent of the
  model's array order, index as tie-break; fixed at write time (Sol F12). "Most frequently asked
  first" would be a fiction — nobody asked.
- **Quantity: at most `MAX_QUESTIONS = 12`**, the only hard number. The prompt offers a word-derived
  *upper* budget (one per ~600 body words, ≤ 12), says zero or fewer is valid, and forbids covering
  the sections one by one (Sol F5). No scores and no threshold bar: there is no honest number to sort
  by.
- **The answer budget** is `base + MAX_QUESTIONS × per-question`, derived from the field caps above
  and fed to `budgetFor` (Sol F10).
- **The row**: the question, then its passages, each a verbatim quote with the existing block jump
  ([`BlockRef`](../../src/web/BlockRef.tsx)). **The honest promise** (Sol F3), on the card and in the
  band's foot: the words shown are the article's, checked; *which passage answers which question is
  the model's reading.*
- **Behind the experimental switch** — a new mode on an unmeasured prompt. **Owner-only** for v1: a
  visitor gets the explanatory band, as Citations does.
- **No passage marks in the prose, no `?faq=` selection param** — `NO_FOUND` in `selectPassages`,
  like Citations v1. The jump reaches the passage.

### The one product call made here: no written answer

The first draft kept a collapsed, model-written short answer under each question, on the grounds that
Greg asked for an *FAQ* and a list of questions with no answer written anywhere might read as a
broken one. **Fable and GPT Sol both argued against it independently**, and this plan now agrees: the
passages *are* the answer; a written one is generated text standing in for prose the view could show
([vision.md § Principles](../project/vision.md#principles) 1), and "may not say anything the passages
do not support" is a request to the model that nothing here can check. Quiz's reference answer is not
a precedent, because it is shown only after the reader has written their own. A reader who still does
not get it has Chat one press away.

If Greg wants a written answer after using it, it is one optional field, one disclosure and a prompt
paragraph — named here so it is his call rather than an inheritance. The same goes for *questions the
piece leaves open* (the dropped `unsettled` status), which wants its own label as an explicitly
interpretive feature.

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
   its adapter; `FORCE_ONLY_WHEN_NAMED`; the migration — `drizzle-kit generate` makes the column and
   the snapshot, **then the step-name CHECK is widened by hand** in that migration and in the literal
   in `src/db/schema.ts`, because Drizzle cannot see a CHECK (Sol F7), with
   `tests/db-step-constraint.test.ts` run; `src/faq.ts` (prompt, parse, verification, reading order,
   `PROMPT_VERSION`); the GET route and `CACHEABLE`; the export put-chain; the cost category; the
   cache-group docs and comments. The Citations stage-1 commit `85631f9b` is the file list to follow.
   Tests, red first where there is behaviour: an invented id dropped; a paraphrased quote dropped; a
   split-word quote (`fall a part`) rejected while curly punctuation is accepted and stored as the
   article's characters; an overlong quote dropped; a question with no surviving passage dropped;
   duplicate questions and passages merged; a later-first response put into reading order; the cap;
   the three empty outcomes; the stamp and the stage agreeing on the fingerprint, including with no
   metadata; `faq` not forced by an earlier forced step. **A real run** on two local articles, with
   what it produced written below and each row classified as FAQ, Summary, Ideas, Quiz or unsupported.
2. **The mode** (client) — `MODES` and every client total
   ([new-mode.md § The client](../project/new-mode.md#the-client)) and the test tables it lists as
   going red without a type error; `useFaq` on `useOrderedRead`/`useStepJob`/`useAutoRun`;
   `FaqPanel` in `ModeSurface`; `experimental: true` and `BEHIND_THE_SWITCH`; the card's two
   sentences written to [§ The card on the button](../project/new-mode.md#the-card-on-the-button);
   `docs/project/faq.md`, its line under reading-view-overview.md, and the row in
   experimental-features.md. The Citations stage-2 commit `abde65f7` is the file list. Done when the
   typecheck and the scoped suite are green and a browser run (a Sonnet subagent, Playwright on the
   box) shows the list, a jump landing, and the button absent with the switch off.

   **Each of stages 1 and 2 ends with its own write-capable GPT Sol code review** (Sol F13): scoped
   tests and typecheck, commit, review, read its diff, gates again, commit its fixes.
3. **Full suite and bookkeeping** — the full suite once through `scripts/tmux-job.ts` (load under
   20), the note in `docs/user-feedback/`, push to `dev`.

## Deferred, not forgotten

- **A written short answer**, and **questions the piece leaves open** — § The one product call.
- **Inherited question ids**, with the first thing that addresses a question.
- **Ask about this** — a per-row button that opens an anchored Chat with the question pre-filled. The
  natural v1.1; the plumbing exists.
- **Marks in the prose and a `?faq=` selection**, and the questions waiting in the gutter at their
  passage.
- **The reader's profile** shaping which questions are asked (Ideas does this; it adds a stamp input
  and a staleness sentence).
- **Visitors** on a public-readable article — a projection and the four places new-mode.md lists.
- **Real FAQs** — the questions readers actually asked in comments, fed back in.

## Review ledger — GPT Sol on the plan, 2026-09-16 (findings-only)

| ID | Sev | Finding | Outcome |
|---|---|---|---|
| F1 | P1 | `unsettled` cannot make the claim its UI makes | accepted — status removed, deferred as its own feature |
| F2 | P1 | the collapsed short answer is the wrong v1 | accepted — Fable agreed; no answer field |
| F3 | P1 | "found and checked" overstates it | accepted — the promise is scoped on the card and the foot |
| F4 | P1 | Ideas' validator is forgiving and keeps the model's string | accepted — `"spaced"` and the article's slice |
| F5 | P2 | the density invites padding | accepted — 12 is the only hard number, no minimum |
| F6 | P2 | id inheritance has no consumer | accepted — deferred |
| F7 | P1 | Drizzle will not widen the CHECK | accepted — by hand, and the test named |
| F8 | P1 | empty outcomes undefined | accepted — three outcomes, `[]` valid |
| F9 | P2 | `FORCE_ONLY_WHEN_NAMED` | accepted |
| F10 | P2 | field caps and budget | accepted |
| F11 | P2 | cache and freshness inputs | accepted — stated above |
| F12 | P2 | ordering and dedupe | accepted |
| F13 | P2 | a review per stage | accepted |
| F14 | P3 | cache-group docs go stale | accepted |

## Progress

- 2026-09-16 — plan written; Fable consulted on the product shape; GPT Sol's plan review (approve
  with changes), all fourteen findings taken and the plan revised.
- 2026-09-16 — **stage 1 built** (server: types, step, migration `20260916150539_faq`, `src/faq.ts`,
  `GET /api/faq/:slug`, `CACHEABLE`, export, `tests/faq.test.ts` plus rows in the registration
  tests), not yet committed. One deviation from F7: `drizzle-kit generate` *did* emit the
  DROP/ADD CHECK pair, from the hand-widened literal in `src/db/schema.ts`. Merged duplicates:
  a repeated question's passages join the first copy's. Real runs through `scripts/stage.ts`,
  local database, `claude-sonnet-5`, prompt `faq/1`, answer budget 5,524 tokens:

  | Article | questions | passages | dropped | out tokens | FAQ / Summary / Ideas / Quiz / unsupported |
  |---|---|---|---|---|---|
  | noema-mythology-of-conscious-ai (essay) | 9 | 13 | 2 unquoted | 3,180 | 9 / 0 / 0 / 0 / 0 |
  | spider-silk (Wikipedia) | 5 | 9 | none | 2,850 | 3 / 0 / 0 / 1 (borderline) / 1 (partly) |

  No summary-shaped rows, so the prompt was not iterated.
- 2026-09-16 — stage 1 committed `b31d8b87`; **GPT Sol code review 1**
  ([findings](260916d-faq-mode-code-review-1-findings.md), [answer](260916d-faq-mode-code-review-1-sol.md))
  fixed five things in-stage, committed `301101e6`: a statement without a question mark no longer
  survives as a question (prompt `faq/2`), malformed passage fields count as `malformed`, and three
  comment/test corrections. Sol judged the cap-before-reading-order cut, the shared `overCap`
  counter and the 150s step budget deliberate rather than defects. Postgres tests were run by us
  before its fixes ([results](260916d-faq-mode-stage1-test-results.txt)); `faq.test.ts` after.
- 2026-09-16 — **stage 2 built and committed** `0e947eb4`: `useFaq`, `FaqPanel`, `FaqBand`, every
  client total, `docs/project/faq.md`. Icon `BadgeQuestionMark`, placed after Citations in the bar —
  both unset by Greg. Aliases leave out `questions`, which would tie with Chat's `question` in the
  command bar. **GPT Sol code review 2**
  ([findings](260916d-faq-mode-code-review-2-findings.md), [answer](260916d-faq-mode-code-review-2-sol.md))
  fixed four things, committed `418a3d57`: a read-only retry for a failed GET, questions as `h2`,
  and a test that tells the unforced run from the forced one (its mutation of every button to
  forced left the original 13 tests green). Its D3 card rewrite was taken in part: it rightly
  dropped the sentence the band's foot already says, but its replacement was about ordering only,
  and the second sentence now leads with *no answer is written*, which is the half a press would not
  tell a reader expecting an FAQ. Two rounds of review in total, one per stage; no finding
  overruled.
- 2026-09-16 — **browser check** (Sonnet subagent, Playwright on the box, the seeded account, the
  Noema essay's stage-1 FAQ): the button and its two-sentence card with the switch on; nine
  questions with quoted passages; a jump landing the passage at the top of the viewport; the foot
  and a dropped-count line; the button gone in Summary with the switch off and back when on; no
  page errors and nothing FAQ-related in the console; no horizontal overflow at 390px. The
  *older version of the prompt* banner showed, correctly, because the run was `faq/1`.
- 2026-09-16 — **full suite once**, through `scripts/tmux-job.ts` on `418a3d57` (which contains
  `origin/dev` at `a40aa270`): 1137 files passed, 9 failed, 24,571 tests passed. The nine are the
  same nine [260916c](260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md) recorded the same
  day in another worktree, and none touches a file this plan changed: the two fresh-worktree bundle
  tests (`cold-start-lazy-imports`, `pdf-bundle-trace`, no `api-dist/`); six fleet and Overseer
  suites failing on the missing `tools/fleet/web/dist` build; and `overseer-standing-jobs`, whose
  feedback-sweep pin disagrees with an edit to `feedback-reports.md` that only Greg can re-authorise.
  Every mode, dock, visitor, store, route-contract and doc-links suite passed.
- 2026-09-16 — **finished**: the note is
  [260912_0819-faq-mode.md](../user-feedback/260912_0819-faq-mode.md), ending *shipped*; pushed to
  `dev`. Not deployed — production is Greg's.
