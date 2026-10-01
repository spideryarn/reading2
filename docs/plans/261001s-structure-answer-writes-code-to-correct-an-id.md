# A structure answer that writes code to correct an id

**Status:** plan, before review. Greg, to the Overseer, 2026-10-01 ~23:00, on the question of
whether to fix this:

> yes let's address this properly. Maybe give it to GPT Sol with you as reviewer

Roles are reversed at Greg's request: **GPT Sol builds each stage, Claude (Opus) is the reviewer
and engineering manager** — writes this plan, reads every hunk, runs the gates, commits.

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

`parseJsonAnswer` (src/parse-json.ts) rejects the whole answer, the stage fails, and the reader
gets a Retry button for an article that cost a full structure call.

## What was checked, rather than taken from the ledger

All three kept raw answers in `evals/results/paperwork/structure-parse/` were read, and the ids
resolved against `analog-cognition…-spya-f03kqf` (92 body blocks) with a scratch script:

| answer | the expression | evaluates to | where it lands |
|---|---|---|---|
| `toc9 #4` | `"spya-zhzzzz".replace("zhzzzz","jcpyd5")` | `spya-jcpyd5`, a real block | index 57, the last block before the `h1` at 58 — **the right end** |
| `toc10 #0` | `"spya-c5z6sr".replace("spya-c5z6sr","spya-c5z6sr")` — a no-op | `spya-c5z6sr`, a real block | index 9, but the range **starts at 15**: a backwards range, **the wrong end** |
| `toc10 #2` | `"spya-zmnep5".replace("spya-zmnep5","spya-z6esvz")` | `spya-z6esvz`, a real block | index 78, start 51: plausible, not verified |

Three things the ledger did not say:

1. **Every one is the second element of a `range` — the end id.** Never a start, never another
   field.
2. **The receiver is invented in two of three** (`spya-zhzzzz`, `spya-zmnep5` are not blocks), and
   the replacement is a real id. The model began typing an id, went wrong mid-token, and — unable
   to delete what it had written — patched it in-band with the one correction idiom it knows.
3. **One correction is a no-op and lands on the wrong block.** So "evaluate the expression" does
   not always recover the model's intent. This is the case Greg's constraint is about, and it
   exists in the data we already have.

Production: the jobs table only goes back to 2026-09-28 and the reader-facing error is redacted,
so the rate cannot be read from it. Sentry has six `MalformedJson` issues in 90 days; the one
inspected (SPIDERYARN-READING2-5S, 2026-09-29) is the **quotes** stage on `dongetal25`, shape
unknown because the message is withheld by design. Trajectory hit the same habit with quote ids
(`"spya-spya-xcg2ub".replace("spya-spya-","spya-")`,
[260928a](260928a-trajectory-mode-stage1-real-runs.md)). So it is a cross-stage habit, not a
hierarchy quirk.

## Root cause

Three layers, and the fix has to say which it addresses.

1. **The model is asked to copy random 11-character ids out of a long context, and one of them is
   a hard lookup.** A start is usually a heading — salient, easy to find. An end is "the block
   *before* the next section's start", which the model has to work out and then copy from a
   paragraph it was not attending to. All three failures are ends.
2. **An autoregressive model cannot retract.** Having emitted a wrong prefix, it patches in-band.
   In code-heavy training data the patch is a method call.
3. **The shared parser is all-or-nothing.** One malformed value in a redundant field costs the
   whole answer. `planChildRanges` in src/hierarchy.ts already says the end is redundant: *"a start
   is believed and every end is computed"* — the end is used only as a fallback split point when a
   start carries no information, and as the second claim in the boundary-fault telemetry.

**The class, named:** *an answer that edits itself in-band* — a model that cannot backspace writes
its correction as code inside a data format, and a strict parser turns a recoverable, often
redundant, slip into the loss of the whole answer.

## Options weighed

| | what | for | against |
|---|---|---|---|
| **A. Parser repair** | `parseJsonAnswer` recognises exactly `"<a>".replace("<b>","<c>")` (string literals only) in value position, evaluates it literally, reports the repair | fixes the class for all 20 callers at once; precedent is `dropTrailingCommas`, also reported; mechanical and testable red-first | a repaired id can be real and wrong (row 2 above) |
| **B. Stop asking for ends** | range becomes `"start": id`; ends derived, as they already are | removes the site of all three failures and half the ids copied | a prompt and schema change (`toc/11`) for hierarchy *and* hierarchy-expand; loses the end fallback GPT Sol found was needed (`[0,0] [0,4] [5,5]`) and half the boundary telemetry; needs a tree-quality eval, not just a parse count; fixes one stage only |
| **C. Show labels, not ids** (Trajectory's fix) | `[i]` indices or `B12` labels, mapped back | numbers are easy to copy | **trades a sparse namespace for a dense one**: today a typo almost always names a non-block and is refused; an index typo names a *different real block* and nothing can notice. That is exactly a wrong id let through silently |
| **D. Prompt line** "never write code" | one sentence | cheap | a request is not a guarantee; it moves `toc/` for every reader; unmeasurable at these rates without hundreds of calls |

**Decision: A, with the hierarchy-specific trust question answered by hierarchy, and B and C
passed over.**

- C is rejected on Greg's constraint directly: it converts loud failures into silent ones.
- B is the more radical root-cause fix for this one stage, but it costs a quality eval, touches two
  prompts and the tiling logic, and does nothing for quotes or trajectory-shaped callers. If, after
  A, the measurement shows a material rate of *wrong* repaired ends doing damage, B is the next
  step and this doc says so. Simpler first.
- D is not done: A makes it unnecessary for correctness, and a `toc/` bump has a reader cost.

## Why A cannot let an invented id through, and why a wrong one is not silent

This is the paragraph Greg asked for.

**It cannot invent anything.** The repair only ever turns an *already-invalid* answer into one
whose repaired value is a JSON string built from the model's own three literals. It never adds a
key, never changes structure, never touches a valid answer (a document that `JSON.parse` accepts
never reaches the repair). The result then goes through exactly the same check a string the model
had typed directly would: in hierarchy, `index.get(id)` in `planChildRanges` / `buildTree`, where an
id that is not a block refuses with the existing precise error. So an invented result — the
`.replace` that misses and leaves `spya-zhzzzz` — fails exactly as it does today. **The guarantee
is only as good as every caller's id resolution**, so stage 1 includes an audit: every
`parseJsonAnswer` caller that reads a block id from the answer must resolve it against the
article's blocks before use, and the audit lists each one with the line. A caller that does not is
a pre-existing bug (a typed invented id reaches it today), fixed in that stage or reported.

**A wrong-but-real id is possible, and is made loud, not prevented.** Row 2 proves it. Nothing can
tell a wrong real id from a right one in general — a typed one has the same property today. What
the repair adds is that we *know* the model doubted this value, so:

- Every repair is reported through `noteJsonRepair` (src/json-repair-log.ts), widened to say which
  repair ran and how many values it mended. Never the text.
- In hierarchy specifically, an end is the redundant claim: the start is believed, and a wrong end
  is measured by `recordBoundaryFaults` as a boundary fault with a size, which `HierarchyRun`
  already sums, the CLI prints, and the pipeline logs. Row 2's backwards end is also ineligible as
  a fallback split point (existing rule). So in the one stage where it has been observed, a wrong
  repaired end cannot move a boundary silently.
- A repaired value that is a *start* would be believed. Not observed in any answer; the eval below
  records which field every repair hit, so if starts begin to appear we will see it.

## Stages

### Stage 1 — the parser repair (Sol builds)

- `src/parse-json.ts`: a function, beside `dropTrailingCommas`, that scans the extracted span with
  a string-aware walk (the same care `objectEnd` takes — a `.replace(` inside a string literal is
  prose and must never be touched), finds a complete JSON string literal followed by optional
  whitespace, `.replace(`, a string literal, `,`, a string literal, `)`, and substitutes
  `JSON.stringify(result)`. Chains (`.replace(…).replace(…)`) apply left to right. **Literal
  semantics**: first occurrence, no `$&`/`$1` substitution patterns (do not call
  `String.prototype.replace` with a raw replacement string). Anything else — other methods,
  identifiers, concatenation, a non-literal argument — is left alone and the answer still fails
  as today.
- Applied in `parseJsonAnswer` only on the path that already failed `JSON.parse`, on the same span
  as the trailing-comma repair, and reported with the outcome (`accepted` / `still-invalid`).
- `src/json-repair-log.ts`: the report says which repair (`trailing-commas` / `string-replace`)
  and how many. Still no text.
- The caller audit described above, written into this doc.
- Tests, red first: the three real shapes above as fixtures (synthetic ids, not the article's prose);
  a `.replace(` inside a string value is untouched; a valid answer is untouched; a non-literal
  argument still throws `MalformedJson`; `$&` in the replacement is literal; the repair is reported
  and the message carries no text. And one hierarchy test: an answer whose end was repaired to a
  real-but-backwards id builds a tree and records a boundary fault.
- Gates: `npm test` on the touched test files, `npm run typecheck`.

### Stage 2 — measure before and after (Claude runs; paid)

`evals/paperwork/structure-parse.ts` gains: keep **every** raw answer under its label (they already
keep failures), and a free `rescore` subcommand that, for each kept answer, records production's
old verdict (the parser at the base commit, vendored or reproduced as plain `JSON.parse` + the
existing comma repair), the new parser's verdict, the repairs made and which field each hit, and
whether `buildTree` then builds a tree from it against the article's blocks, with its boundary
faults.

**Paired, on the same answers**, so before and after are not separated by sampling noise: the only
thing that differs is the parser. Draws: 60 on `analog-cognition` (three of the four failures seen,
roughly one answer in six) and 20 each on the three other corpus articles, ~120 structure calls at
`power: "standard"`, on the current `toc/10`. Expect roughly 8–15 repair events. The headline is
"N answers in M failed to parse before; K after; of the N, J built a tree; repaired ends were right
/ backwards / other", with the existing 48 answers (and their 4 kept failures) as a second sample.

Cost estimate: under $20 at ~$0.10–0.15 per call; recorded with the result.

### Stage 3 — postmortem and docs

`docs/postmortems/261001c-…` (the five things), a line under postmortems.md, and the ledger entry
in 261001p pointed here.

## Done

- Answers of the observed shape parse, the tree builds, every repair is reported, nothing invented
  gets through (tests and the audit say why), measured on ≥100 fresh answers.
- Stage review by Sol at the end of each stage (here: Sol builds, Claude reviews; plus Sol's
  read-only review of this plan first).

## Ledger

(filled in as stages land)
