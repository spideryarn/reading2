# AI headings — inventing structure for articles that don't have it

**The most instructive story in that codebase.** It is the same problem as our
[Q1](../open-questions.md#q1) — where does the hierarchy come from when the article is a flat wall
of `<p>`? They built it, twice, reversing a decision in between, and then found a real bug in the
version that shipped. All three stages are written down.

Read this before touching [hierarchy.md § Building the tree over a flat article](../hierarchy.md#building-the-tree-over-a-flat-article).

## What it does

The reader opens a long article with no subheads. The tool proposes headings and inserts them into
the document — as real, reversible edits to the stored document, not as an overlay. The reader sees
each round of proposals and chooses "continue improving" or "finish".

Reference doc: `docs/reference/TOOL_STRUCTURE_HEADINGS.md`.

## How it was built

An LLM returns a list of **operations** — insert, replace, remove — each addressed to an element id
in the document, together with its own account of what it just did and what it plans to do next:

```json
{
  "operations": [
    { "action": "insert", "insertNewBeforeExistingId": "[ID]",
      "content": { "tag_name": "h3", "content": "A new heading title at level 3" } },
    { "action": "replace", "targetId": "[ID]",
      "content": { "tag_name": "h2", "content": "Improved heading text" } },
    { "action": "remove", "targetId": "[ID]" }
  ],
  "more_changes_required": true,
  "iteration_summary": "Added H1 document title, established 3 major H2 sections…",
  "iteration_plan": "Next iteration will focus on subdividing the lengthy methodology section…",
  "safety_check": { "current_iteration": 0, "total_operations_so_far": 6,
                    "max_iterations_reached": false }
}
```

Operations are applied through the reversible-mutations framework
(`MUTATIONS_DOCUMENT_CONTENT_REVERSIBLE_TRANSFORMS.md`), so a trashcan reverts them.

**`iteration_summary` and `iteration_plan` are the good idea here.** The model says, in its own
words, what it changed and what it would do with another round — and *that* is what the reader
decides on when offered Continue or Finish. The alternative, a bare "keep going?", asks the reader to
judge a process they cannot see. Any iterative generation we build should make the model narrate its
own next move.

The caps are in `lib/config.ts`: `MAX_HEADING_OPERATIONS_PER_ITERATION: 10`, `MAX_ITERATIONS: 10`,
and `AUTO_ITERATE_HEADINGS: true` — auto-progression is live rather than planned. Note the drift:
their reference doc and the planning doc both say **5** iterations, the shipped config says **10**.
Another instance of [check the code, not the doc](process-and-docs.md#129-reference-documents-and-what-that-costs).

The density rule is prompt guidance, not enforcement: *"Target approximately 200 words between
headings"*, and *"Add H3+ sub-headings where sections exceed ~400 words"*. The `density_analysis`
object described in the discarded level-by-level plan was never built, so nothing measures whether
the model complied.

## The design that was chosen, then abandoned

`docs/conversations/250628c_conversation_hierarchical_heading_generation_approach.md` records Greg
choosing **level-by-level** generation — H1 and H2 together, then H3, then H4 — over an
operation-limited alternative. The reasoning was good and evidence-backed:

- A University of Washington readability finding that **~200 words between headings** is about
  right, and that heading at paragraph frequency (~100 words) is "tied for worst" for comprehension —
  worse online than in print.

  **Treat this as unverified.** It appears in that repo exactly once, as a name-check —
  *"University of Washington research by Bartell, Schultz, and Spyridakis tested heading frequency
  effects on comprehension"* — with no title, no URL, and no DOI, in a conversation transcript. It
  may well be real; nobody checked. If we lean on the number, check it first, and note the
  contrast with the properly cited typography research ([typography.md](typography.md)), where the
  papers are named and findable.
- Academic work suggesting hierarchical generation beats flat generation.

The operation-limited alternative was **explicitly rejected** at this point, on the grounds of
"unpredictable hierarchy, unclear stopping criteria". Both objections were correct.

Then the level-by-level plan
(`docs/planning/discarded/250628b_hierarchical_heading_generation_implementation.md`) was sent to o3
for critique *before* implementation, and the critique killed it. Not because the design was wrong,
but because it assumed infrastructure that did not exist:

- mutation persistence was not finished — the doc itself said "Storage currently disabled"
- no concurrency or locking plan
- no cache-invalidation contract
- UI complexity creep: the existing panel was ~350 lines and the new design implied badges, density
  stats, cancel, auto-progress

o3's verdict was "sound direction, over-ambitious for the current infrastructure — ship a smaller
first milestone."

## The reversal

They then implemented the operation-limited approach they had just rejected
(`docs/planning/250629b_iterative_heading_generation_operation_limited.md`), described in the plan
as the "key simplification": constrain by **operation count** rather than by level, and put the
hierarchical intent in the prompt as *guidance* rather than in the code as *enforcement*.

That is the version live today.

## And it still shipped a real bug

A later cross-model review
(`docs/planning/250704a_conversation_ai_headings_critique_from_o3_pro_without_claude.md`) found two
faults in the shipped code:

1. **Regeneration appended `Date.now()` to ids**, so running it again *accumulated* headings instead
   of replacing them. To the user this looked like an infinite loop.
2. **Insertion-order and skip-level validation produced false positives**, because the model was
   never shown the already-mutated document on each iteration — it was validating operations against
   a document state that no longer existed.

Both were fixed. Both are the shape of bug our
[silent-success.md](../../reusable/silent-success.md) is about: the code reported success on every
round, and every round made things worse.

## What we take from this

**Four lessons, in descending order of value.**

1. **One-shot structuring of a long unstructured article was not good enough.** That is the finding
   underneath the whole saga, and it is direct evidence about our
   [Q1](../open-questions.md#q1). They ended on iterate-with-a-cap and a human deciding when to
   stop. Our stage 4 currently does a single pass ([`src/toc.ts`](../../../src/hierarchy.ts)) — if the
   trees come back with arbitrary-feeling boundaries, this is the known next move rather than a
   surprise.
2. **The ~200-words-between-headings figure is a usable target, once verified.** Our tree aims at a
   branching factor of ~5–9 ([granularity-zoom.md § Where the tree comes from](../granularity-zoom.md#where-the-tree-comes-from));
   that is a shape constraint, and this is a density constraint. They are checkable against each
   other on a real article, and disagreement between them is informative. Our leaf level is
   per-block, so the relevant comparison is at the section level: 8,275 words over 36 sections in
   the test article is ~230 words a section, which lands almost exactly on their target — reassuring,
   and arrived at independently.
3. **Critique the plan before implementing it, with a different model.** Both times, an external
   critique caught something real. We already have [`scripts/run-codex.ts`](../../../scripts/run-codex.ts)
   for this — see [codex-cli-as-subagent.md](../../reusable/codex-cli-as-subagent.md) and
   [process-and-docs.md § The critique habit](process-and-docs.md#the-critique-habit-worth-stealing).
4. **Don't design against infrastructure you haven't built.** The good design lost to the mediocre
   one because persistence and cache invalidation weren't ready. Ours are: the pipeline stages write
   JSON artefacts and cache on a content hash ([architecture.md](../architecture.md)), which is
   precisely the thing they were missing.

## Where our architecture is already ahead

**We never mutate the article.** Their headings tool edits the stored document, which is what forced
the mutations framework, the reversibility, the id churn, and the duplicate-id accumulation bug.

Our tree is a *separate artefact* over an immutable block list — `tree.json` beside `blocks.json`
([architecture.md § Pipeline](../architecture.md#pipeline)) — and headings we invent are node
`title`s, not elements inserted into the prose
([hierarchy.md](../hierarchy.md#headings-verbatim-unless-genuinely-uninformative)).
Regenerating is `npm run toc`, which rewrites one file wholesale. The entire class of bug they hit
cannot occur here, and it cost us nothing to avoid — it fell out of the pipeline being stages over
artefacts.

That is worth stating plainly because it is the strongest argument in this whole folder for the
boring architecture.

## See also

- [overview.md](overview.md) — the map to that codebase
- [structure-panel.md](structure-panel.md) — how the resulting tree was *displayed*, which is the closer cousin to our zoom
- [../hierarchy.md](../hierarchy.md) — our tree, its schema and its generation prompt
- [../open-questions.md#q1](../open-questions.md#q1) — where our hierarchy comes from, still open
- [borrow-list.md](borrow-list.md) — where this sits in the priority order
