# Fifth sweep, cluster 19: one helper for reading a Messages result

Up: [plans.md](../project/plans.md) ·
umbrella: [261003f-fifth-codebase-sweep-umbrella.md](261003f-fifth-codebase-sweep-umbrella.md)
(§ The clusters, row 19)

Every pipeline stage that calls a model on the Messages wire ends the same way: was the answer a
refusal, was it cut off at `max_tokens`, and if neither, join its text blocks into one string. That
sequence is written out by hand in every stage, copied from a neighbour. This plan puts it in one
function and moves the stages onto it. The evidence is finding D6 in
[261003b-fifth-sweep-data-and-pipeline.md](../investigations/261003b-fifth-sweep-data-and-pipeline.md)
and Opus's review of it in
[261003b-fifth-sweep-review-opus-on-data-and-pipeline.md](../investigations/261003b-fifth-sweep-review-opus-on-data-and-pipeline.md).

No reader has met a defect here today. The reason to do it is that the copies have already drifted
once: `src/illustrated.ts` threw its refusal undeclared from 2026-09-03 to 2026-10-04 (cluster 10,
`5ae9316e7`), so a reader saw the generic sentence instead of the refusal one. With one function,
that mistake has nowhere to be written.

## The census, re-run on 2026-10-04 against `origin/dev` at `1b91e6e88`

The audit said 30 copies in 17 files. Today it is **32 copies in 18 files** (`src/relations.ts` is
the eighteenth).

```sh
grep -rn 'is Anthropic.TextBlock' src --include=*.ts | awk -F: '{print $1}' | sort | uniq -c
# 18 files, 32 lines: two each in fourteen, one each in citations, labels, structure, structure-deepen
grep -rln 'stop_reason === "max_tokens"' src --include=*.ts   # the same 18 files
grep -rn 'wasRefused(' src --include=*.ts                      # the same 18, plus the definition
grep -rn 'type === "text"' src | grep -v 'is Anthropic.TextBlock'
# three hits, all Markdown AST nodes (citable.ts, web/Cited.tsx): no text-block read spelled another way
```

The 18 fall into two groups.

**Fifteen ordinary stages** throw on a refusal, throw on a truncation, and return the text:
`arc`, `citations`, `crossrefs`, `faq`, `glossary`, `ideas`, `illustrated`, `quiz`, `quotes`,
`relations`, `sketch`, `skim`, `timeline`, `tweets`, `structure`. Thirteen are the same block apart
from the stage name, the name of the budget variable and the comment; `citations` and `structure`
join the text first and pass its length. `structure` alone passes its own headroom
(`STRUCTURE_HEADROOM`). Two stage names are not the file name: `tweets` says "thread" and
`structure` says "table of contents".

**Three with their own control flow**, which stays as it is:

- `simple-summary` returns the failure with the call's `usage` instead of throwing, settles the
  `begun` gate its sibling calls wait on, and names the level in the refusal's log line.
- `labels` wraps a truncation in `BatchIncomplete` and retries the batch, on purpose untagged.
- `structure-deepen` throws `ExpansionTruncated`, and a plain `Error` for a refusal.

## What gets built

Two functions in `src/messages-stream.ts`, beside `wasRefused`:

```ts
/** Every text block of the answer, joined. Thinking blocks are not text. */
export function messageText(message: Anthropic.Message): string

/** The ordinary ending: a refusal throws, a truncation throws, otherwise the text. */
export function finishedText(
  message: Anthropic.Message,
  stage: string,
  maxTokens: number,
  answerTokens: number,
  headroom?: number,          // truncationFailure's own default
): string
```

`finishedText` is `wasRefused` → `stageFailure(MODEL_REFUSED, { authored })`, then `messageText`, then
`max_tokens` → `truncationFailure(stage, maxTokens, answerTokens, { outputTokens, answerChars }, headroom)`,
otherwise returning the joined text. Refusal is judged first, as every copy does today. The comment about `stop_details`
that eight stages carry moves onto the function, once.

The fifteen ordinary stages become one line each, `const raw = finishedText(message, "arc",
maxTokens, answerTokens)`. The three others replace their inline filter-and-join with
`messageText(message)` and keep everything else.

**Where it lives.** Opus suggested `src/token-budget.ts`, to avoid an edge from `messages-stream`
to `job-failure`. Checked today: `job-failure` imports only `messages.ts`, and `token-budget`
imports those two, so the edge makes no cycle. The helper's job is interpreting a Messages result,
not sizing a call, and `messages-stream.ts` is where a stage already gets its `message` and its
`wasRefused`, so it goes there. (An earlier draft also argued that `token-budget` should stay light
for the store's sake. Sol's plan review, PL-4, showed the store already reaches both modules, so
that argument is withdrawn.)

**Not built**, each for a reason:

- **A progress-throttle helper** (the `now - last < 500` idiom, 15 files). Repetition is shown, a
  defect is not, and both the finding and its review say skip it.
- **A non-throwing variant for `simple-summary`.** One caller, and its log line differs.
- **Declaring `structure-deepen`'s refusal.** Not a defect: the error becomes a `DeepenFailed`,
  which `src/structure.ts` catches, logs, and answers by keeping the tree wave 1 produced. It never
  reaches a job row or a reader, so there is no sentence to declare. Traced by me and, separately,
  by Sol's plan review.
- **A lint rule or source test banning the inline filter.** Considered at the end of stage 2: one
  line in the existing source scan in `tests/stop-details.test.ts` if it is that cheap.

## Stages

**Stage 1: the helper and its tests.** `messageText` and `finishedText`, with unit tests in
`tests/messages-stream.test.ts`: refusal by `stop_reason` and by `stop_details.type`, each carrying
`[ai-model-refused]` and a declared reader sentence; refusal wins over truncation; a truncation
names the stage and quotes both figures, the character count of the text blocks only, and the
headroom it was given; a clean answer joins text blocks in order and skips thinking blocks. Each
test is shown to fail against a wrong implementation (truncation judged first; thinking text
counted; headroom dropped). Nothing calls the helper yet. Done: tests green, mutations red.

**Stage 2: move the stages.** One commit: the replacement, the imports it orphans, and the two
tests that have to move with it (Sol's plan review, PL-1 and PL-2). `tests/stop-details.test.ts`
counts `stageFailure(MODEL_REFUSED` sites and wants more than ten; four are left, so its non-vacuity
check is restated, and a second scan guards literal content reads in modules importing the
Messages gateway or SDK. It parses property access and destructuring rather than relying on a text-block
type annotation; indirect imports and dynamic keys are outside its scope.
`tests/illustrated-run.test.ts` replaces the whole module with a
two-export mock and toggles a fake `wasRefused`; it keeps the real module and hands back a message
that really is a refusal. One thing is not strictly mechanical and is accepted: Illustrated's
`briefMs` timer now stops after the text is joined rather than before (PL-3), a difference of
microseconds in a figure that measures a model call.
Before it, a characterisation check that the behavioural tests covering these stages
(`tests/stop-details.test.ts`, `tests/step-failure-seam.test.ts`, the per-stage run tests) are green
on the unchanged tree, and after it that they are still green. Done: the census greps return only
`src/messages-stream.ts`, plus the three named exceptions for `max_tokens` and `wasRefused`;
`npm test` and `npm run typecheck` pass.

**Stage 3: docs.** `architecture.md` § Shared code (server) says today that "there is no helper for
that sequence yet"; it gets the helper's name. The umbrella row gets what landed and the commit.

## Review

GPT Sol on this plan, read-only, before stage 1. GPT Sol on the code after stage 2, write-capable,
with the scoped diff and the census output.

## What landed

All three stages, 2026-10-04.

- **Stage 1, `0cd280739`.** `messageText` and `finishedText` in `src/messages-stream.ts`, seven
  tests, five mutations shown red.
- **Stage 2, `5b63cdd8f`.** Fifteen stages call `finishedText`; `simple-summary`, `labels` and
  `structure-deepen` take `messageText`. 32 copies of the text-block filter became one. The two
  tests moved with it, and the doc line (stage 3) went in the same commit.
- **Sol's code review, in the commit after.** No P0 or P1; it compared all 18 files before and
  after and found no observable change beyond the accepted timer. It fixed one P2 itself (CR-1):
  my source scan looked for the `Anthropic.TextBlock` annotation, which a hand-written read does not
  need, so six ordinary spellings passed it. The scan now parses the file and looks for a read of
  `.content` in any module that imports the gateway or the SDK. Its write-up, naming the class, is
  [261004f](../postmortems/261004f-an-optional-type-annotation-cannot-defend-a-content-read.md).
  Two stale passages it reported (CR-4, CR-5) are fixed in the same commit:
  `evals/paperwork/structure-parse.ts` and `docs/project/ai-gateway.md` § The one thing still open.

**Left, on purpose.** Five hand-written reads under `evals/` and `scripts/`
(`evals/embedding-retrieval.ts`, `evals/paperwork/structure-parse.ts`,
`evals/structure-whole-document/model-arms.ts`, `scripts/spike-book-structure.ts`,
`scripts/spike-expand-section.ts`). They are outside this cluster's files, and Sol's reading is
that their error handling and measurements differ enough that `finishedText` would change what
they do. `messageText` would fit, and is a five-line follow-up for whoever is next in those files.

**Gates.** `npm run typecheck` green. `npm test` on stage 2: 32,925 passed, 4 failed, all four in
files that need `npm run build` or `npm run build:fleet`, which a fresh worktree does not have;
after building, those five files pass.
