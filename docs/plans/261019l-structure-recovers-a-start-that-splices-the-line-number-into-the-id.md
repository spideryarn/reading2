# Structure recovers a start that splices the line number into the id

**Status:** built. Revision 3 folds in GPT Sol's two read-only reviews: [r1](261019l-plan-review-sol.md)
(*revise*) and [r2](261019l-plan-review-r2-sol.md) (*revise* — uniqueness before the window, the
checkpoint gate, a first answer with no time left for a re-ask, a drop must leave two children; all
four taken and pinned by a test). Where revision 2's text below disagrees with
src/start-ranges.ts, the code and [structure-step.md](../project/structure-step.md) are current.

**Checked against the real answers**, 2026-10-19: the four repro answers through the new parser over
the production body — runs 2 and 3 build on a first answer (`root > child 9: line-number`); runs 1
and 4 refuse a first answer and build on the last, each dropping one sub-section (`3 > 3`, `3 > 2`).
Under today's code all four refuse.

Feedback: spya-c09nnb (#627, SPIDERYARN-READING2-KP) and spya-e2vxrw (#628, SPIDERYARN-READING2-KQ),
both from Greg, 2026-10-19, about one article a new reader imported that evening. Overseer queue item
`qi-emc5tnty`.

> A new user (Adrian de Froment) just imported an article - why didn't it auto-generate standard
> stuff, e.g. highlighted-quotes?

> Why didn't the Structure finish building for the article that Adrian just imported? You can read
> the production database.

— Greg, 2026-10-19

**They are one bug.** Structure never finished, and every mode that reads the structure (Quotes,
Ideas, Simple, Tweets, Bibliography) refused with `jb-no-structure`. Once a fourth Structure attempt
at 20:04 succeeded, every one of those modes generated itself within three minutes. So the second
report is the first one seen from another mode.

Postmortem: [261019d](../postmortems/261019d-a-line-number-spliced-into-a-block-id-cost-the-whole-tree.md).

## What happened, from production (read-only)

The article is a 648-block PDF, *Review of the Evidence of Sentience in Cephalopod Molluscs and
Decapod Crustaceans* (slug `…-spya-fd0ger`), imported 19:36 UTC. Fetch, extract, blocks and the
headings-first outline all finished by 19:41. Then the full Structure step failed three times:

| job | when | the two answers inside the step | cost |
|---|---|---|---|
| `spya-f0fan0` | 19:41, on arrival | both refused; the second at `root > child 9: start not a block id (a 14-character string)` | $0.59 |
| `spya-vnrcrx` | 19:47, reader pressed Retry | the same, `root > child 9`, 14 characters | $0.60 |
| `spya-amg7y2` | 19:49, Retry again | `root > child 3 > child 2`, 13 characters | $0.55 |
| `spya-g3sz0k` | 20:04, Retry a third time | succeeded, 55 sections | — |

Between them, seven Quotes/Ideas/Simple/Tweets/Bibliography jobs failed in under 15 ms each with
`jb-no-structure`. Vercel's `step failed: structure` lines are the source for the error text.

## The cause

I re-sent the exact production request (`wholeDocumentRequest` over the same 648 blocks, read from
`revision_blocks`) four times from the box. **Every one of the four answers contained a start that
is not a block id**, and every one stopped at `end_turn` with **zero thinking tokens**:

| run | output tokens | bad starts | where |
|---|---|---|---|
| 1 | 7,169 | `"x"`, `"spya-582"` | 3 > 3 (a heading that exists), 9 > 1 (a first child) |
| 2 | 7,314 | `"spya-76k5k8x"`, `"spya-582xcf0dz"` | 3 > 1 (a first child), 9 |
| 3 | 1,309 | `"spya-582"` | 9 |
| 4 | 8,340 | `"spya-76bd1a"`, `"spya-582xcf"` | 3 > 2, 9 |

The prompt renders each block as one line, `[582] spya-xcf0dz <h1>: PART VI. EVIDENCE GAPS`
(`renderBlocks`, src/structure-prompt.ts). **The model is splicing the line number into the id**:
`spya-` + `582` + `xcf0dz`, or a prefix of it, or the number alone. Block 582 is Part VI's heading,
and production's 14-character refusal at `root > child 9` has exactly the length and position of
`spya-582xcf0dz` — production withholds the string itself, so that is a strong inference, not an
observation. ⟨Sol, finding 9⟩ Block 76 is
"Our framework", and `spya-76k5k8x` is `76` + most of `k5k8pf`.

Why now: Structure has run at effort `low` with a JSON schema since 261001s, and that combination
does no thinking at all (261001s measured the same: *"at `low`, adapting to the schema, the model
chose to skip thinking altogether"*). Copying 60 opaque ids out of a 113k-token prompt without
thinking is where a fault like this lives — a correlation, not a measured cause. `"x"` and
`spya-76bd1a` are a second, rarer kind of fault that is not a splice.

**How common.** Since 2026-10-03, 5 of 28 Structure jobs in production needed the in-step re-ask
(`ai_calls`, two `structure` calls on one job): three were this article, two were arXiv papers that
succeeded on the second answer.

**Why one bad id cost everything.** `deriveStartRanges` (src/start-ranges.ts) resolves the whole
sibling set before planning it, and refuses the whole answer on the first id that is not in
`blocks.json`. So one boundary out of ~60 throws away the tree, the step re-asks once with the same
odds, and the reader becomes the retry loop at $0.55–0.60 a press. Two of the eight bad starts above
were **first children**, whose start the derivation discards anyway — it pins the first child to the
parent's start — and those refused the answer all the same.

## The fix: recover a splice, and degrade rather than fail on the last answer

Recovery is **opt-in**: a new `unresolvedStarts` option on `parseWholeDocumentAnswer` →
`modelNodeFromStarts` → `deriveStartRanges`, `"refuse"` by default. So the scoped cascade
(`SCOPED_START_POLICY`), the long-document slices (which also use `WHOLE_DOCUMENT_START_POLICY` but
pass no `BuildReport`, ⟨Sol 5⟩) and every eval keep today's behaviour exactly. Only
`generateStructure`'s `treeFrom` opts in.

For a child whose `start` is not a block id:

1. **A first child is not asked** (`"recover"` and `"recover-or-drop"`). Its start is pinned to the
   parent's start whatever it says — the whole-document policy already clamps and pins every first
   child, and the heading snap skips `k = 0` — so it gets the parent's start and nothing is recorded.
   (Run 2's `spya-76k5k8x`, run 1's `spya-582`.) ⟨Sol 7 agrees.⟩
2. **The line number it spliced in** (`"recover"` and `"recover-or-drop"`). The string is `spya-`, a
   run of digits, then the rest. Try **every** split of the digit run into a line number `N` (no
   leading zero) and a remainder; a split is a candidate when `N` is a block of this sibling set's
   window and the remainder plus the rest is a prefix, possibly empty, of block `N`'s six
   characters. **Exactly one candidate**, or no recovery. The window is the independent evidence:
   strictly after the previous resolved start (or the parent's start), strictly before the next
   start that resolved as a real id (or at most the parent's end). So a recovered start can never
   reorder or leave its parent, and it is the line the model was copying from, `[N] spya-<six>`.
   Covers `spya-582xcf0dz`, `spya-582xcf` and `spya-582`.
   **Where this differs from Sol's review:** Sol (finding 3) would accept only the full splice and
   leave bare `spya-N` to the re-ask. Bare `spya-582` was 2 of the 7 bad starts in four runs, and with
   it refused only 1 of the 4 answers builds; with the window it is not a guess from digits alone but
   a position that also has to fit between its neighbours.
3. **Otherwise, on the first answer, the answer is refused as today** (`"recover"`), and the in-step
   re-ask runs. ⟨Sol 2⟩
4. **On the last answer only** (`"recover-or-drop"`: the re-ask, and a replayed checkpoint), an
   unrecoverable child is dropped with its subtree, its blocks going to the previous kept sibling —
   **if the answer-wide loss stays within one in ten of its non-first starts (at least one)**.
   Past that it is refused as today. The trade, named: a tree with one section folded into its
   neighbour, against no tree and every mode refusing. Before this change the reader got the second.
   (A replayed checkpoint uses the same mode because only an answer that built is ever stored, so
   it builds again identically.)

Rule 3 of revision 1, recovering from a `sourceHeading`, is **removed**: matching a heading
anywhere between two siblings is weaker evidence than the snap's one-block-back rule. ⟨Sol 1⟩

**Every recovery and every drop is counted** ⟨Sol 6⟩. `BuildReport.unresolvedStarts:
{ where, outcome: "line-number" | "dropped" }[]` — required, so every constructor is made to say
it; merged wherever the other fields are; dropped ones are also in `droppedChildren`, which they
are. `StructureRun` gains `startsRecovered` and `startsDropped`, logged on the step's line beside
`droppedChildren`. `treeFrom`'s failure message, which today lists mended boundaries only when
`repairs` is non-empty, also lists recovered starts, so a first answer that recovered one splice and
then refused on another says both before the re-ask.

**No `PROMPT_VERSION` bump** ⟨Sol 10⟩. The checkpoint is written only after an answer builds, so every
stored answer resolved every start, and reads the same under the new modes. What changes is which
fresh answers build; that is what a version bump would protect, and there is nothing stored to
protect it from.

### What it would have done here

Production's two logged refusals at `root > child 9` recover by rule 2 to block 582, Part VI (window
487–594). Of my four repro answers, as a **first** answer:

| run | bad starts | outcome |
|---|---|---|
| 1 | `"x"` at 3 > 3; `spya-582` as the first child of 9 | refused on `"x"` → re-ask; as a last answer, 3 > 3 dropped |
| 2 | `spya-76k5k8x` first child; `spya-582xcf0dz` at 9 | **builds**, nothing lost |
| 3 | `spya-582` at 9 | **builds**, nothing lost |
| 4 | `spya-76bd1a` at 3 > 2 (76 is in the window but its id is `k5k8pf`); `spya-582xcf` at 9 | refused → re-ask; as a last answer, 3 > 2 dropped |

So half of first answers build outright, and a step — two answers — fails only if the second answer
loses more than one start in ten. The reader would have had Structure at about 19:43, and the arrival
modes after it.

## The tests, red first

`tests/structure-step-invented-starts.test.ts`, new:

- full, prefix and bare splices resolve to block `N`; a remainder that is not block `N`'s prefix does
  not; a candidate outside the window does not; two candidate splits do not;
- a first child's invented start builds, nested too, and its `sourceHeading` does not move it;
- `"recover"` refuses an unrecoverable later start with today's message; `"recover-or-drop"` drops
  it, lists it in `droppedChildren` and `unresolvedStarts`, and refuses past the one-in-ten budget;
- the default (`"refuse"`) and the scoped policy refuse every one of these exactly as now.

And in the step: a `generateStructure` test with a fake first answer that refuses and a second that
needs a drop, asserting the run's `startsDropped`.

## Passed over

- **Change the prompt** — drop `[i]`, or put the id first, or raise `effort` so the model thinks.
  This is the upstream cause, and probably the better long-term lever, but it is a prompt change to
  every article's Structure call: it moves the checkpoint key for everyone, `[i]` is load-bearing in
  the scoped prompt ("numbered from 0 and its prompt says so"), and effort is a cost and latency
  trade 261001s settled with an eval. It needs the structure eval run, not a feedback fix. **Deferred
  as its own queue item**, with this evidence.
- **Constrain `start` to an enum of the block ids in the schema.** `assertNoBlockIdEnums` exists to
  forbid exactly that (grammar size on a 1,000-block book).
- **Only drop, never decode.** Simpler by one rule, but it would fold Part VI into Part V on every
  attempt for this article, because the model makes the same splice every time.
- **Let the modes run over the headings-first outline when the full structure failed.** That would
  have answered the first report on its own, but it is a product change to what every mode reads,
  and with the step no longer refusing it is the rarer case. Not built; named here.
- **Extend recovery to the scoped cascade and the long-document slices.** Its refusals feed `ExpansionRefused` and a per-section
  retry that the whole-document call does not have, so the trade is different. Not seen failing here; the slices would also need their reports carried through `SlicesOutcome` ⟨Sol 5⟩.

## Stages

One stage: the kernel change, the option threaded through, the report field and its log line, the
tests, the doc
([structure-step.md](../project/structure-step.md) § "The one thing it loses, and what still throws"
says an invented id is "still refused"; it becomes the four rules), the postmortem, then the GPT Sol
code review.
