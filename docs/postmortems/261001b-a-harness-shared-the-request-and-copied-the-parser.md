# A harness shared the request and copied the parser: parity proven for half the call

**Found 2026-10-01 by GPT Sol's decision review (D1) of the thinking-effort eval,
[plan 261001p](../plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md).
Never reached a reader: it is an eval bug, and it nearly decided a production setting.**

## What happened

The eval asked whether Hierarchy could run with thinking off. On the smoke article both draws
answered with one sentence of prose and then a valid tree:

> Looking at this structure, I'll trace the natural argument flow: …

The structure eval (`evals/hierarchy-structure/model-arms.ts` § `parseStructureResponse`) refused
both, and the result was written up as *"the shipping parser refused them, so Hierarchy stays at
`low`"*. That was false. Production reads the same answer with `parseJsonAnswer`
(`src/hierarchy.ts`), which takes the preamble in its stride. Sol ran the saved answer through
production's parse and `buildTree` and got a valid 85-node tree.

The subagent that built the harness had reported the parser as "the same as production's
(`stripFence` + `parseJsonFrom`)". I passed that on unchecked, and it reached the plan and the
research doc.

## The root cause

The structure eval was built on 2026-08-30 (`dd5f68abf`, `dc3fb7b67`) to measure exactly what
production runs.

- **The request is shared by construction.** `structureRequest` is exported from
  `src/hierarchy.ts`, and the eval calls it; `tests/hierarchy-structure-request-parity.test.ts` pins
  it.
- **The response parse was copied.** The eval spelled out production's recipe of the day,
  `parseJsonFrom(stripFence(raw))`.

On 2026-09-03, `e04e879df` ("A model's answer is not only its JSON, and eleven stages assumed it
was") moved eleven `src/` stages to `parseJsonAnswer`. That commit swept `src/` and nothing else.
The eval's copy stood still, and from that day it was stricter than production.

Nothing could notice: the parity test covers the request only, and an answer with no preamble parses
identically under both recipes. Two other evals carried the same copy:

- `evals/plain-words/run.ts` parsed a structure answer the old way.
- `evals/illustrated/run.ts`'s `--check` mode did too. Its comment even said "exactly as `parseJson`
  in src/illustrated.ts does it", which was true when written and false after `e04e879df`.

## The class

**Parity proven for half the call.** A harness that exists to measure production shares one half
of the seam (the request), copies the other (the response handling), and a parity test covers only
the shared half. When production moves the copied half, the harness keeps working, keeps passing,
and quietly measures a recipe nothing ships. It is the evals' version of "a copied constant drifts":
`hierarchy-prompt.ts` already records the same accident with an effort value
(`PRODUCTION_EFFORT`, exported after `arms.ts` typed `"high"` for eight days).

## The fix

- **Shipped:**
  - `src/hierarchy.ts` exports its parse as `parseStructureAnswer`. The structure eval and the
    plain-words eval call it, as they already call `structureRequest`.
  - `evals/illustrated/run.ts --check` uses `parseJsonAnswer`, the function production's
    `parseJson` wraps.
  - `tests/hierarchy-structure-eval.test.ts` has a preamble case, seen red before the fix.
  - The Hierarchy thinking-off arm was re-run through the corrected parser
    ([research 261001c](../investigations/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md) § Hierarchy).
- **Right for the long term:** every stage exports the one function that turns its raw answer into
  its artefact, and an eval reads answers only through it. The structure eval now does. The
  generator-driven harnesses (`evals/thinking-effort/`, `evals/sketch/`) already did, because they
  call the shipping generator end to end.

## What would have caught it, ranked by ease against value

1. **Call, never copy: when an eval needs production's handling of an answer, import it.** Free,
   and it would have prevented all three copies. It is now the pattern in the structure eval, and
   the export's comment says why.
2. **When a commit changes how `src/` reads model answers, grep `evals/` and `scripts/` for the old
   spelling in the same commit.** `e04e879df` named eleven stages and stopped at `src/`. One
   `grep -rn "parseJsonFrom(stripFence" evals scripts` would have found all three.
3. **Check a subagent's "same as production" against the production file before writing it down.**
   This is the memory "an unchecked brief claim becomes a source comment", met again; it is a habit
   rather than a check, and it is listed because it would have caught this instance in a minute.
4. *Rejected:* a generic parity test that runs every eval's parse against production's on a corpus
   of odd answers. It is heavier than item 1 and catches less: once the eval imports production's
   function, there is nothing left to compare.

---

Up: [postmortems.md](../project/postmortems.md)
