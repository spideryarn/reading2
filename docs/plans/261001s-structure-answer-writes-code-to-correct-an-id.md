# A structure answer that writes code to correct an id — and structured outputs for every JSON call

**Status:** plan, revision 3. It folds in GPT Sol's two read-only reviews
([r1](261001s-reviews/plan-review-sol-r1.md) "rethink", [r2](261001s-reviews/plan-review-sol-r2.md)
"revise before building"), the Overseer's evidence on Sketch and Ideas, and Greg's two follow-ups.
Greg, to the Overseer, 2026-10-01 ~23:00:

> yes let's address this properly. Maybe give it to GPT Sol with you as reviewer

> don't these models have a JSON mode that ensures they produce valid JSON? Or what's the issue with
> them producing broken output?

> Ok, and if it turns out that this will help, let's ask that session to check all modes that
> require structured output, and to add something to relevant docs (e.g. new-mode.md or docs about
> calling AI) to ensure that we always do this going forwards. And then potentially if that works,
> we can turn down the thinking level in some cases?

The roles are reversed, at Greg's request: **GPT Sol builds each stage, and Claude (Opus) reviews
and runs the job.** Claude writes this plan, reads every hunk, runs the gates, commits, and pushes
each stage to `dev`.

Found by [261001p § Ledger](261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md).
Postmortem: written in stage 4, under `docs/postmortems/` (not linked until it exists).

## What happens

The structure (hierarchy) call answers in JSON, and every node carries
`"range": ["<firstBlockId>", "<lastBlockId>"]`. Sometimes the answer contains this instead of a
string:

```
"range":["spya-y09vju","spya-zhzzzz".replace("zhzzzz","jcpyd5"),],
```

`parseJsonAnswer` rejects it, so the stage fails. The reader gets a Retry button, and the call has
still been billed. Ideas and Sketch break their JSON in other ways
([research 261001c](../research/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md):
1 in 16 each at today's effort, and Ideas 10 in 16 below `high`).

## The evidence

**Six in-band edits in four failed answers** (kept raw answers in
`evals/results/paperwork/structure-parse/` and `…/after-2/`):

| answer | field | expression | receiver | result |
|---|---|---|---|---|
| `toc9` analog #4 | end | `"spya-zhzzzz".replace("zhzzzz","jcpyd5")` | invented | real; the block before the next `h1` |
| `toc10` analog #0 | end | `"spya-c5z6sr".replace("spya-c5z6sr","spya-c5z6sr")` | real | **a no-op**; the range runs backwards |
| `toc10` analog #0 | end | `"spya-mrsvfu".replace("spya-mrsvfu","spya-qr9ra4")` | real | real: **a change of mind**, not a typo |
| `toc10` analog #0 | end | `"spya-p6hwth".replace("spya-p6hwth","spya-vp5h33")` | real | real |
| `toc10` analog #2 | end | `"spya-zmnep5".replace("spya-zmnep5","spya-z6esvz")` | invented | real |
| `after-2` ball lightning | **start** | `"spya-qtqp22".replace("spya-qtqp22","spya-nezgpv")` | — | — |

Five of the six are range **ends**. Membership was checked for the first, second and fifth rows.
The full per-event classification Sol asked for in round 1 (derived-boundary agreement, semantic
plausibility) is **not needed for the decision**, because no parse repair is being built. It is
left undone on purpose (r2 G8).

**Production.** Sentry has six `MalformedJson` issues in 90 days. The one inspected,
SPIDERYARN-READING2-5S (2026-09-29), is the **quotes** stage, so this is not only Structure. The
jobs table goes back only to 2026-09-28, and its error text is redacted.

**Structured outputs on our wire, probed 2026-10-01** (`evals/paperwork/_probe-structured.ts`, not
committed; the structure request for `entropy-24-00930`, Sonnet 5 via OpenRouter's Messages route):

| request | result |
|---|---|
| `output_config.format` with a **recursive** `$ref` tree schema | **400**, upstream: *"Circular reference detected … Self-referencing … definitions are not supported."* So OpenRouter does pass the format through to Anthropic. |
| a schema **unrolled to the prompt's three levels**, effort `low`, ×2 | 200, `end_turn`, parses. **Thinking tokens 0 and 0**, 50 s and 40 s, about 4,400 output tokens. Input +971 tokens (the schema). |
| the **same request without a format** (control), effort `low`, ×2 | **Thinking tokens 7,829 and 6,737**, 107 s and 92 s, about 13,000 output tokens. |
| the unrolled schema at effort **`high`**, ×2 | Thinking tokens 33,044 and 29,650; 313 s and 279 s. |

So: it works on our wire with the models we use, and streaming and adaptive thinking both still
work. **But at `low`, adapting to the schema, the model chose to skip thinking altogether, twice.**
That is a quality risk, and it has to be measured rather than assumed in either direction. The
thinking-effort eval found Structure with thinking *off* dropped far more of the author's headings.
The structure call has no cache breakpoint, so nothing here tested caching. **Changing
`output_config.format` invalidates a prompt cache** (Anthropic's structured-outputs docs), and
`sharesArticleCache` in src/pipeline.ts groups stages by effort and renderer only. So the schema's
identity becomes a third cache-compatibility dimension before any cache-sharing stage gets a
schema (r3 H2; [prompt-caching.md](../project/prompt-caching.md)). Anthropic's current Sonnet
guidance also warns that structured outputs at low or medium effort can skip thinking, and suggests
a line asking the model to think the problem through first (r3 H3).

**What a schema guarantees, and what it does not.** It guarantees syntax and shape: no
`.replace(…)`, no stray value, every required field present. It does not guarantee that an id is
right. Under a schema, a model that has started a wrong id can no longer write a correction, so it
has to finish the string. The result is an invented id, which `index.get` refuses (a loud failure,
and a whole failed article in Structure), or a wrong real id, which nothing can detect. **So every
id-resolution check stays exactly as it is.** And no schema may constrain an id field with an
`enum` of the article's ids: that would force a mistyped prefix to finish as *some* real id, which
is exactly a wrong id let through silently.

## Root cause

1. **In-band revision.** A model writing JSON token by token cannot take back what it has written.
   When it decides an id is wrong, whether mistyped or a boundary it has reconsidered, it writes the
   edit as code.
2. **We ask for JSON in prose, and nothing enforces it.** Six smaller jobs already use strict
   structured outputs on the chat-completions wire (`src/paper-metadata.ts`, `src/pdf-authors.ts`,
   `src/pdf-figure-locate.ts`, `src/pdf-frontmatter.ts`, `src/pdf-read.ts`,
   `src/shelf-terms/model-scores.ts`, as of `origin/dev` merged 2026-10-01). The pipeline's big calls do not, and no
   doc records a decision either way.
3. **Structure asks for the field where the edit happens.** The end of a section is redundant: the
   start is believed and the end is computed, as src/hierarchy-expand.ts already does. Yet it is the
   hardest id to produce.

**The class, named:** *an unconstrained JSON answer.* A model that cannot backspace writes its
correction, or its slip, into a data format that nothing constrains, and a strict parser then
turns a sampling accident into a failed step.

## Decision

| option | verdict |
|---|---|
| **Structured outputs** (`output_config.format`, strict JSON schema) | **The primary fix, for every JSON call that fits.** It removes the whole class at the source, for every shape (`.replace`, Ideas' stray value, Sketch's), with no repair code. It is measured on Structure first (stage 2), then surveyed and rolled out (stage 3). |
| **Starts-only Structure** | **Taken, together with the schema.** Under a schema, an end that would have been corrected in-band becomes an invented id instead, and the whole article fails. Removing the end removes five of the six occasions. src/hierarchy-expand.ts already works this way. |
| Parser repair (evaluate `.replace`) | **Dropped** (r1 F2, F3): as a default it would let a tweet's invented text through, and the evidence shows that a correction is sometimes a change of mind or a no-op. |
| Labels or indices instead of ids | **Rejected**: a dense namespace turns a typo into a different real block, silently. |
| One automatic re-draw on `MalformedJson` | **Not built.** A schema should make `MalformedJson` impossible except on a refusal or a truncation, and neither of those is a re-draw case. If stage 2 or 3 measures a residual, it comes back as its own stage with r2 G4 and G5 as its contract: return per-attempt usage, never checkpoint the first raw answer, an admission rule against `deadlineAt`, and observed size-dependent costs (a 142-page structure call is about $2 and 508 s, not $0.15). |
| A prompt line saying "never write code" | Not done: a schema enforces what a line would only ask. |

**What the safety claim is, stated narrowly** (r2 G2): no parser repair creates or accepts a
value. A model held to a string can still write an invented id, and the resolver, not the schema,
refuses it: every id is still resolved with `index.get`, and an invented start refuses with
today's error. **A wrong-but-real start remains possible, exactly as it
is today.** Only structural measurement and human review catch it, and nothing here makes it more
likely. The one design that would make it more likely, an id `enum`, is forbidden above.

## Stages

Each stage: Sol builds with `--sandbox workspace-write` in this worktree, briefed with this plan,
the scope and its exclusions, red-first tests, the gates (`npm test` on the touched files,
`npm run typecheck`) and the house rules (no git command that discards work, no commits). Claude
reads every hunk, runs the gates, commits, merges `origin/dev`, and pushes. The cross-family
check is Sol's build read by Claude, plus a read-only Sol review of anything Claude wrote or
changed itself.

**Every paid eval opens `collectSpend`** with `scopeKind: "eval"` (r2 G3), as
`evals/paperwork/run.ts` does, and records run id, calls, cost and unpriced state beside its
results. The stage-0 before arm below ran without it, so its spend is missing from the ledger: about
70 Sonnet structure calls, estimated at $10–15. That is said here rather than hidden.

### Stage 0 (done, paid) — the `toc/10` before arm

`evals/paperwork/structure-parse.ts` keeps **every** raw answer now. Fresh `toc/10` draws: 40 on
`analog-cognition` (labels `before-a1`–`a4`; a stress arm, never presented as a population rate)
and 10 each on `entropy-24-00930`, `scaling-hypothesis` and `source-spya-f550ta` (`before-o`).
**Result:** `analog-cognition` **2 in 40** answers malformed; the other three articles 0 in 30. Both failures were `.replace` on a
range **end** — `"spya-zj9hxx".replace("spya-zj9hxx","spya-dnv2tp")` and, again,
`"spya-p6hwth".replace("spya-p6hwth","spya-vp5h33")` — so seven of the eight events seen so far are
ends.

### Stage 1 — the schema seam for the Messages wire, and Structure's starts-only converter (no prompt change)

Built on a tree that already has `origin/dev` merged into it (r3 H1). So the thinking-effort harness,
Sketch's move to `low` and the six chat-wire schema users are all in front of the builder.

- **A pure, non-mutating validator over Anthropic's supported schema subset**, run whenever a format
  is built, not only in tests (r3 H4). It refuses:
  - direct and indirect `$ref` cycles, and external refs (local acyclic refs are allowed);
  - any object, at any depth, without `additionalProperties: false`. That includes objects under
    `properties`, `items`, `$defs`/`definitions`, `anyOf` and `allOf`;
  - `minLength`, `maxLength`, `minimum`, `maximum`, `multipleOf` and unsupported array constraints;
  - regexes outside the supported subset;
  - optional and union counts beyond a stated ceiling.

  **And no `enum` on a field that carries a block id.** That is part of the helper's contract, with
  a test over every schema we ship.
- **One wire adapter, for the Messages wire only** (r3 H5). It sets `output_config.format =
  {type: "json_schema", schema}` and composes with `effort`. Its tests:
  - an explicit effort plus a format both survive unchanged;
  - a high-power adaptive call still gains `effort: "high"` through `messagesWireBody`, without
    losing the format;
  - a standard-power call keeps the format and gains no effort.

  The six chat-wire users are left as they are. A chat adapter is written only if stage 3 moves a
  chat call. It would reuse the same validator and keep each job's name, `strict: true` and
  `require_parameters` routing.
- **Structure's starts-only answer type and converter** (r2 G1, r3 H7). `ModelNode.range` stays
  `[string, string]`. A separate answer type, with no range on `root` and a `start` on each child, is
  converted at the `treeFrom` boundary into ordinary `ModelNode`s for `buildTree`. The kernel that
  turns starts into ranges is extracted from `normaliseExpansion` and shared, with the
  whole-document policy written out wherever the two differ. Direct tests:
  - nested derivation;
  - a start outside its parent, first or later (clamped here, refused in the scoped call);
  - duplicate and non-increasing starts;
  - the heading snap;
  - one-child input, and a set that collapses to one child after drops;
  - root and body bounds;
  - no mutation of the answer object.

  The evals that parse structure answers call the same converter once the wire changes in stage 2:
  `evals/hierarchy-structure/model-arms.ts`, `evals/paperwork/run.ts`, `evals/plain-words/run.ts`,
  `evals/paperwork/structure-parse.ts`, and the thinking-effort harness if it parses one.
- **The live `toc/10` path is unchanged, byte for byte.** The parity and hoist pins stay green, and
  an existing ranged checkpoint replays to the identical tree.
- **Offline replay, free.** Every retained `toc/10` answer that builds today — the 70 stage-0 raws
  and the local database's `hierarchy-structure` checkpoints — is built twice: as today, and with
  its ends deleted, through the converter. The gate (r2 G7):
  - zero newly unbuildable answers;
  - zero additional dropped children;
  - zero lost authored headings;
  - an identical flattened `(depth, title, range)` tree for ≥ 99 % of answers (with fewer than 100,
    zero unexplained changes).

  Claude reads every tree that is not identical. **If it fails, stop and rethink.**

### Stage 2 — Structure on `toc/11`: starts-only and schema-constrained, measured

- SYSTEM's OUTPUT asks for `start`, worded as src/hierarchy-expand.ts words it. The request carries
  the three-level unrolled schema through the stage-1 adapter. `PROMPT_VERSION` becomes `toc/11`.
  The pins that move (r2 G6): the parity test, the hoist pin and its digest, and
  `EXPANSION_PROMPT_STAMP` (`toc/10+expand/7` becomes `toc/11+expand/7`). So **every existing
  deepening checkpoint misses once**, which is accepted. Plus a test that a `toc/10` structure
  checkpoint is not resumed under `toc/11`.
- **Validity arm, paid, with spend recorded.** The stage-0 draws again (40/10/10/10), on `toc/11` at
  production effort (`low`). Reported per article: parse failures with exact intervals, refusals on
  invented starts, dropped children, dropped authored headings, depth-1 part counts, thinking
  tokens, cost and duration. **Gate:** zero refusals on invented starts and zero dropped children.
- **Quality, pre-registered (r3 H3).** The thinking-effort harness's rule, unchanged:
  - the eight articles, two draws per arm (`toc/10` at `low` as the base, `toc/11` at `low` as the
    candidate), one blind lineup per article;
  - Sol ranks and Opus scores, giving U per article;
  - a clear loss is a mean U ≤ 1.1 and a possible loss is up to 1.5, with the worse judge winning;
  - Hierarchy's stricter structural gates apply as well.

  **A loss stops shipping.** If `toc/11` at `low` loses, the next arm is `toc/11` at `low` plus
  Anthropic's think-first line, and only after that `medium`. The cost and quality numbers go to
  Greg, and production effort is not changed without him.

### Stage 3a — the survey (read-only, Sol)

A matrix, in this doc, of **every model call that expects JSON back**:

- `parseJsonAnswer` and `parseJsonFrom` callers that parse a model's answer. Not the parsers of
  stored data, such as src/shelf.ts, src/chat.ts, src/comments.ts, src/searches.ts and
  src/glossary-lookups.ts;
- the chat-wire `response_format` users;
- any other `JSON.parse` of model text.

Its columns (r3 H6): the wire; model and effort; provider support; whether it streams and parses
partially; cache group; shape, and whether it is recursive; tools or plugins (web search);
refusal and truncation handling; prefill; cold-schema latency; any eval; and the verdict — fits,
or does not fit and why.

Already expected not to fit without a probe:

- src/debate.ts: a schema together with `openrouter:web_search` is unmeasured;
- src/citation-find.ts and src/source-guess-run.ts: the search annotations are the security
  witness;
- src/dig-deeper.ts, for the same reason;
- src/referee-candidates.ts: it streams reader-visible prose around a hidden shortlist.

src/citations.ts is ordinary JSON, and its name does not exclude it. src/search.ts needs proof that
`hitExtractor` still emits hits before completion.

### Stage 3b — the migrations, in small commits, observed failures first

Each one gets the schema through the adapter, a red-first test that the request carries it, and
the existing refusal and truncation checks kept before the parse.

**Cache-group identity comes first.** `sharesArticleCache` gains the schema as a dimension, or
stages with different schemas are declared incompatible. Red-first grouping tests, and one paid
writer/reader check that asserts non-zero cache reads (r3 H2).

1. **Ideas**, with its lower-effort re-test in the same draws (r3 H8): the harness at `high`
   (today) against `medium` and `low`, all under the schema. It reports validity, cost, duration
   and the panel's verdict. Production effort does not change; that is Greg's call on the numbers.
2. **Sketch**, now at `low`: a same-effort before/after quality panel, because a schema at `low`
   may switch its thinking off.
3. **Quotes** (the Sentry event), with a validity count from its eval.
4. The remaining Messages-wire calls that fit, grouped by cache group.
5. The chat-wire calls that fit, through a chat adapter over the same validator.

### Stage 4 — the rule, the postmortem, the hand-off

- **The rule, in one home.** That is docs/project/ai-gateway.md or prompting-guide.md, whichever
  owns how we call a model; the other signposts it. Every call that expects JSON uses a strict
  schema through the adapter, and:
  - no `enum` of ids;
  - ids are still resolved;
  - recursion is unrolled;
  - the schema is part of cache compatibility;
  - at low effort, check that thinking still happens.
- **docs/project/mode.md**, an entry-point rule doc, gets a checklist line. It is **proposed
  only**, as before and after wording in the hand-off, for Greg's approval
  ([edit-important-docs.md](../reusable/edit-important-docs.md)).
- The postmortem's five things, a line under postmortems.md, the 261001p ledger pointed here, and
  hierarchy.md's prompt versions.
- The message to the Overseer, with the plain-words answer to Greg's question.

## Done

- Structure is on `toc/11`, starts-only and schema-constrained. It is measured before and after,
  and passes the pre-registered quality rule, or the trade goes to Greg.
- Every JSON call is either on a schema or named with its reason. The rule is written in one home,
  and the mode.md line is proposed.
- Ideas' lower-effort re-test is reported, with no production change.
- No lenient parse anywhere. Ids are still resolved, and there is no `enum` of ids.
- Each stage is committed and pushed to `dev` as it lands.

## Ledger

- **Plan review r1 (Sol): rethink.** F1–F4 checked and accepted: parser repair dropped, starts-only
  taken.
- **Plan review r2 (Sol): revise before building.** All eight accepted. G1 is the converter seam;
  G2 narrows the safety claim; G3 is spend in evals (the stage-0 arm missed it, said above); G4 and
  G5 become the re-draw contract if one is ever built; G6 is the pin list; G7 is the gates; G8 is
  left undone on purpose.
- **Scope widened** after r2 by Greg's questions (via the Overseer): structured outputs first, a
  survey of every JSON call, the rule written down, and the lower-effort re-test. The probe above
  is the evidence that structured outputs work on our wire. Revision 3 is reviewed read-only by
  Sol before stage 1 is built. Per the two-rounds rule this is a review of new scope, not a third
  round on the old.
- **Plan review r3 (Sol, new scope): revise before building.** No P0s, and all eight findings
  accepted:
  - H1: `origin/dev` is merged before stage 1 (done, the merge under `34509bc09`). There are six
    chat-wire schema users, not three.
  - H2: the schema's identity is a cache dimension. Arc and Tweets do not share a cache, which the
    plan had wrong.
  - H3: the quality rule is pre-registered; the think-first line comes before `medium`; Sketch gets
    a quality panel too.
  - H4: a runtime validator over the whole supported subset.
  - H5: a Messages-only adapter, and a chat one only if it is needed.
  - H6: the survey's columns and the calls expected not to fit.
  - H7: direct converter tests, and "a schema cannot invent an id" corrected.
  - H8: the survey split out, and Ideas' effort re-test folded into its migration.

  Revision 4 is not sent for another plan round. Per the two-rounds rule Claude settles it, and
  stage 1's build is the next check.
- **Stage 1 landed (built by Sol, reviewed by Claude).** New modules: `src/messages-structured-output.ts`
  (validator and Messages adapter), `src/start-ranges.ts` (the shared kernel; `normaliseExpansion`
  now calls it, and its tests are unchanged and green), `src/hierarchy-starts.ts` (the converter,
  not yet wired in), and `evals/paperwork/structure-starts-replay.ts`. Claude ran typecheck and
  nine test files (249 green), broke the clamp policy deliberately and saw two converter tests go
  red, and restored a comment the extraction had dropped (why the first claim is range-checked).
  Not yet verified: the validator's "documented" ceilings of 24 optional and 16 union parameters.
  - **Offline replay: 91 of 94 identical, one extra dropped child — the gate as written fails, and
    is overruled with the reason.** Every stage-0 answer (68 that parse) and 23 of 26 local
    checkpoints replay identically. The three that differ are all books of over 2,000 blocks
    (`m1-kuhn`, and two `evaldeepen` book checkpoints), whose depth-1 ranges contradict each other
    by hundreds of blocks: in `m1-kuhn` the 22nd chapter claims blocks 49–82 after the 21st began
    at 905. Today's end fallback keeps such a chapter by hanging it after its predecessor's end, so
    a title and gist written about blocks 49–82 land on blocks 927–2045. Starts-only drops it and
    lets the predecessor run on. Both trees are wrong. Dropping is the honest one, and it is the
    choice `normaliseExpansion` already made on purpose. This is the one fault the end fallback
    exists for, observed only on answers that are already degenerate. It goes to Sol's stage-2
    brief to challenge.
