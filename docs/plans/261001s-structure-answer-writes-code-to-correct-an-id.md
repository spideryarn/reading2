# A structure answer that writes code to correct an id

**Status:** plan, revised after GPT Sol's read-only review
([round 1](261001s-reviews/plan-review-sol-r1.md), verdict *rethink*) and the Overseer's
evidence on Sketch and Ideas. Greg, to the Overseer, 2026-10-01 ~23:00:

> yes let's address this properly. Maybe give it to GPT Sol with you as reviewer

The roles are reversed, at Greg's request. **GPT Sol builds each stage, and Claude (Opus) reviews
and runs the job**: Claude writes this plan, reads every hunk, runs the gates and commits.

Found by [261001p § Ledger](261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md),
"A structure answer that writes JavaScript". Postmortem:
[261001c](../postmortems/261001c-a-model-answer-patches-a-mistyped-id-with-code.md).

## What happens

The structure (hierarchy) call answers in JSON, and every node carries
`"range": ["<firstBlockId>", "<lastBlockId>"]`. Sometimes the answer contains this instead of a
string:

```
"range":["spya-y09vju","spya-zhzzzz".replace("zhzzzz","jcpyd5"),],
```

`parseJsonAnswer` (src/parse-json.ts) rejects the whole answer, so the stage fails. The reader
gets a Retry button, and the structure call has still been paid for.

## The evidence, checked rather than taken from the ledger

The kept raw answers hold **six** in-band edits across four failed answers. The first draft of
this plan counted three; Sol found the other three. Each id was resolved against the article's
body blocks with a scratch script.

| answer | field | expression | result |
|---|---|---|---|
| `toc9` analog #4 | **end** | `"spya-zhzzzz".replace("zhzzzz","jcpyd5")` | receiver invented; result index 57, the last block before the `h1` at 58 |
| `toc10` analog #0 | **end** | `"spya-c5z6sr".replace("spya-c5z6sr","spya-c5z6sr")` | **a no-op**; index 9 under a start of 15, so the range runs backwards |
| `toc10` analog #0 | **end** | `"spya-mrsvfu".replace("spya-mrsvfu","spya-qr9ra4")` | real to real: the model **changed its mind about a boundary**, it did not mend a typo |
| `toc10` analog #0 | **end** | `"spya-p6hwth".replace("spya-p6hwth","spya-vp5h33")` | real to real |
| `toc10` analog #2 | **end** | `"spya-zmnep5".replace("spya-zmnep5","spya-z6esvz")` | receiver invented |
| `after-2` ball lightning | **start** | `"spya-qtqp22".replace("spya-qtqp22","spya-nezgpv")` | a start |

Five of the six are **range ends**. One is a start.

**Production.** The jobs table only goes back to 2026-09-28, and the error the reader sees is
redacted, so the rate cannot be read from it. Sentry has six `MalformedJson` issues in 90 days. The
one inspected, SPIDERYARN-READING2-5S (2026-09-29), is the **quotes** stage; its shape is unknown,
because the message is withheld by design. Trajectory had the same habit with quote ids
([260928a](260928a-trajectory-mode-stage1-real-runs.md)).

The Overseer's thinking-effort eval
([research 261001c](../research/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md))
found malformed JSON at today's effort in **1 of 16 Ideas and 1 of 16 Sketch** answers, in a
different shape: `{"blockId": "spya-p4pyuy": "", …}`. Nothing retries those either.

## Root cause

1. **In-band revision.** A model writing JSON token by token cannot take back what it has
   written. When it decides an id is wrong, whether mistyped or a boundary it has reconsidered,
   the only way out it knows is to write the edit as code.
2. **The structure prompt asks for the field where that happens most.** The end of a section is
   "the block before the next section's start". The model has to work that out and then copy it
   from a paragraph it was not attending to. And the end is **redundant**: `planChildRanges`
   believes starts and computes every end. It reads the model's end in only two places — as a
   fallback split point when a start does not advance, and as the second claim in the
   boundary-fault telemetry. The scoped expansion prompt (src/hierarchy-expand.ts) **already asks
   for starts only** for exactly this reason. Its normaliser in src/hierarchy-cascade.ts says so,
   and it has given up the end fallback on purpose.
3. **One malformed answer is final.** The parser is all-or-nothing, which is right. But no stage
   that has failed this way draws again, so a sampling accident becomes a failed step.

**The class, named:** *an answer that edits itself in-band.* The model cannot backspace, so it
writes its correction as code inside a data format. A strict parser with no second draw then
turns a recoverable sampling slip into a failed step.

## Options, and the decision

| | what | verdict |
|---|---|---|
| **A. Parser repair** (evaluate `.replace`) | the first draft's choice | **Dropped.** Sol's F2: as a default it would make `{"text":"accurate".replace("accurate","invented")}` a valid tweet, with no block id involved. As an opt-in, the evidence still breaks it: one no-op landed on the wrong block, and two real-to-real edits are changes of mind, not repairs. Evaluating the edit would believe the model's second thought without knowing it was one. **No lenient repair, so no id can get through because of one.** |
| **B. Ask for starts only** | the shape src/hierarchy-expand.ts already uses | **Taken.** It removes the field behind five of the six edits, and it reuses a rule the codebase already holds. The cost is the end fallback. That is measured before the prompt changes (stage 1), not assumed. |
| **C. Labels or indices instead of ids** (Trajectory's fix) | | **Rejected.** It trades a sparse namespace for a dense one. Today a typo almost always names a block that does not exist, and is refused. An index typo names a different real block, and nothing can notice. That is a wrong id let through silently. |
| **D. One automatic re-draw on `MalformedJson`** (the Overseer's first suggestion) | | **Taken, as a shared helper.** It covers the residual start-edit in Structure and the Ideas and Sketch shapes. It repairs nothing, so it cannot let a wrong id through: a second draw is a fresh answer, checked exactly like the first. |
| **E. Structured outputs** (constrained decoding) | | **Not now.** Whether it works on our wire (OpenRouter's Messages route) is unverified, and it is its own piece of work. It is recorded as the next step if a re-draw proves not enough. |
| **F. A prompt line saying "never write code"** | | **Not done.** A request is not a guarantee, and B removes most of the occasions for it. |

**Why nothing here can let a wrong or invented id through.** Nothing parses leniently. B changes
what the model is asked for. Every start it writes is still resolved against the article's blocks
by `index.get`, and an id that is not a block still refuses with the precise existing error. D
draws a whole new answer and runs it through the same parse, build and `assertTreeSound`. The
only id-bearing values that ever reach the tree are ones the model wrote as plain strings, which
is true today.

**What the re-draw covers, and what it leaves.** It covers Structure (wave 1), Ideas and Sketch:
the three stages with measured failures. The helper is shared so that others can adopt it in one
line each. Quotes and the other `parseJsonAnswer` callers are listed for that and not changed
here. They have no measured rate, and every adoption is a per-stage cost decision: a second
structure call is about $0.15 and two minutes.

## Stages

Sol builds stages 1–3 with `--sandbox workspace-write` in this worktree. Each brief carries this
plan, the stage's scope and exclusions, red-first tests, the gates (`npm test` on the touched
files, `npm run typecheck`) and the house rules (no git commands that discard work, no commits).
Claude reviews every hunk, runs the gates, and commits.

### Stage 1 — a starts-only answer builds a tree (no prompt change)

- `ModelNode.range`'s end becomes optional on the *answer* path, so that `planChildRanges` takes
  a child with no end. In that case there is no end fallback and no end claim in the telemetry,
  exactly as `normaliseExpansion` in src/hierarchy-cascade.ts already behaves. **One derivation,
  not two:** reuse or share the cascade's rule rather than writing a third. Internal callers that
  have real ends (src/hierarchy-deepen.ts turns trees back into nodes) keep passing them.
- The root needs no range: it is the whole body.
- **Free offline evidence, before any prompt changes.** Write a script that takes every stored
  structure answer — the `hierarchy-structure` checkpoints in the local database (real answers,
  all of which built), plus the raw answers that stage 0 below keeps — and builds each tree twice:
  as today, and with every end deleted. Per answer, it reports children dropped, boundaries that
  moved, how often the end fallback fired, and the repaired-block counts.
  **Decision gate:** if deleting the ends drops or moves material numbers of sections, stop and
  rethink before stage 2.
- Tests, red first: a starts-only answer builds the same tree as a range answer whose ends agree
  with it; a colliding start drops the child and counts it; an invented start still refuses with
  the existing message.

### Stage 0 (running now, paid) — the before arm

`evals/paperwork/structure-parse.ts` now keeps **every** raw answer, not only failures.
Fresh `toc/10` draws: 40 on `analog-cognition` (four jobs, labels `before-a1`–`a4`; this is where
three of the four failures came from, so it is a stress arm and not a representative rate) and
10 each on `entropy-24-00930`, `scaling-hypothesis` and `source-spya-f550ta` (`before-o`).

### Stage 2 — the prompt asks for starts (`toc/11`), then the after arm

- `SYSTEM`'s OUTPUT block in src/hierarchy.ts asks for `"start": "<blockId>"` per node, with the
  wording src/hierarchy-expand.ts uses. `PROMPT_VERSION` becomes `toc/11`, with its history
  comment. New articles only, as with every `toc/` bump.
- Everything that reads the request's bytes moves with it: the parity test, the hoist pin, and the
  eval arms that slice `SYSTEM`. Sol finds these; the list is part of the review.
- **After arm:** the same draws as stage 0, on `toc/11`, separated in time by about an hour. Report
  per article: parse failures (with Fisher's exact against stage 0, plus the stage-0 sample's
  existing 48 answers as a second "before"), the shape of every remaining failure, dropped
  children, dropped headings, depth-1 part counts and repaired blocks. **Read every changed
  boundary by hand on two articles.** A tree that builds is not evidence that its boundaries are
  right.

### Stage 3 — one re-draw on a malformed answer, shared

- A small helper beside `parseJsonAnswer` (not inside it — the parser stays pure) that runs a
  draw, parses it, and on `MalformedJson` only — never on a refusal, a truncation, an abort or a
  call error — draws once more and parses that. Both calls are recorded and billed as ordinary
  calls (they already are, by `streamMessage`). The re-draw is logged with the source and the
  attempt number, and never the text. Feeding the parse error back to the model is **not** done:
  a re-draw is one request instead of a multi-turn one, and the labels stage shows a plain retry
  is enough for a sampling accident.
- Adopted in Structure wave 1 (src/hierarchy.ts: the call, `treeFrom`, the checkpoint written only
  after a draw that built, `structureUsage` summing both calls), Ideas, and Sketch.
- Tests, red first, per adopting stage: the first draw malformed and the second good gives a
  result and two recorded calls; both malformed gives `MalformedJson` exactly as today; a refusal
  or a truncation is not re-drawn.

### Stage 4 — postmortem, docs, and the hand-off

The postmortem (the five things). A line under postmortems.md. hierarchy.md's prompt versions.
The ledger entry in 261001p pointed here. Then the message to the Overseer.

## Done

- Structure asks for starts only, measured: parse failures before and after on ≥140 fresh answers,
  with no material loss of sections in the offline comparison or the after arm.
- A malformed answer in Structure, Ideas or Sketch is drawn once more before the reader sees a
  failure.
- No lenient parse anywhere, so nothing can let a wrong or invented id through. Every id still
  resolves against the blocks.
- Sol reviews this plan before the build. At each stage Sol builds and Claude reviews.

## Ledger

- **Plan review, round 1 (Sol, read-only): rethink.** F1 (six events, not three, and one is a
  start), F2 (a default repair lets a tweet's text through), F3 (logging is not a control, and the
  end fallback can carry a wrong end into the tree) and F4 (B is cheaper than claimed: expansion
  already does it) were all checked against the files and accepted. They are why A was dropped and
  B taken. F5 (parser spec) is moot without A. F6 (measurement) is folded into stages 1 and 2.
