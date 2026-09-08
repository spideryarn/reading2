# Adversarial fixtures: the shapes four postmortems each asked for

**Started 2026-09-08**, from the audit of all 89 files in `docs/postmortems/` that extracted ~230
prevention recommendations and found ~90 unbuilt. This was its top-ranked item, because one fixture
set closes an open recommendation in **four** postmortems at once. Each of the four independently
concluded the same thing: *the corpus never had this shape, so the bug was invisible*.

The argument for doing a fixture ahead of the other eighty-nine is in
[260905b § T2.1](260905b-improve-the-codebase-third-sweep.md): the raw-NUL-byte class recurred three
times across two sweeps while it was a paragraph in a doc, and stopped recurring the day it became a
test. That plan is also careful about the limits of its own evidence, and this one inherits the
caveat — a fixture that survives longer than a paragraph in a doc is not the same claim as a fixture
that will catch the next bug. Fixtures rot too; they just rot louder.

## The four, and what each asked for

| postmortem | the shape it asked for | why it was invisible |
|---|---|---|
| [260830a](../postmortems/260830a-the-article-with-one-heading.md) | one-word blocks, an article whose only heading is its title, an old-HTML page | every fixture in the repo was well-formed modern HTML with real headings |
| [260830e](../postmortems/260830e-nav-labels-asked-58-got-57.md) | a hostile **article**, not merely a hostile model response | every test of the label path synthesises the *model's* answer |
| [260831b](../postmortems/260831b-the-audit-that-recomputed-the-old-definition.md) | a tracked fixture with a supplement block | the only article in the database had zero, so stored and actual "agreed by having nothing to disagree about" |
| [260905d](../postmortems/260905d-a-new-tree-invariant-met-a-nine-day-old-local-artefact-and-reddened-a-gate.md) | a stored tree carrying a shape a later invariant forbids | the rule was proven against the corpus and the corpus was never swept |

[260905f](../postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md) is
260905d's production sibling — the same rule, but it wedged roughly one article in twenty for at
least eleven hours, each retry paying for a model call before being refused. It is the sharper
statement of the class and is read here as part of the fourth ask.

## What is already closed, measured before designing anything

**Reported first and honestly, because three of the four have moved since they were written**, and a
plan that rebuilds a closed thing is worse than no plan. Each line below was checked against this
tree on 2026-09-08, not taken from the postmortem's own words.

| ask | status today | evidence |
|---|---|---|
| 260831b — a tracked fixture with a supplement block | **closed** | `openai-huggingface` carries one (index 93 of 95, 103 words); `store-shelf-reads.test.ts` seeds `test-shelf-corpus-supplement` from it, and its projection now selects `treatment` with the cast |
| 260830e — the message that read as arithmetic | **closed** | `renderShortfall` now says *"left out paragraph 4"* with a noun |
| 260905d/f — a publish over a base whose tree is invalid | **closed** | the first of three cases in `store-publish-guards.test.ts` |
| 260905d/f — `checkTree` says so about a restated rung | **closed** | `tests/tree-redundant-rung.test.ts`, both ends: `buildTree` splices, `checkTree` reports |
| 260830a — `buildTree` drops an unbacked `sourceHeading` rather than throwing | **closed** | `src/hierarchy.ts` § the keepable-heading helper, reported in `BuildReport.droppedHeadings`; generic coverage in `tests/hierarchy-repairs.test.ts` |

**The `buildTree` row is one I missed and GPT Sol found**, and it is worth saying why rather than
quietly adding it. I measured the *symptoms* — does the splitter still emit fragments, does the
message still read as arithmetic — and inferred the rest of each postmortem's status from its own
"what is still open" section. That is exactly the mistake
[260905d](../postmortems/260905d-a-new-tree-invariant-met-a-nine-day-old-local-artefact-and-reddened-a-gate.md)
names in its own closing lesson: a deferral is a claim, and it decays. Recommendation 2 of 260830a
was written as an open proposal and had been built in the meantime. The correction changed what got
built here — see § What the review changed.

And what is **still open**, which is what this plan builds against:

| ask | status | evidence |
|---|---|---|
| 260830a — stage 3 emits no one-word gistable fragment | **open** | `splitIntoBlocks` on old-HTML shape still yields `["[1]", "[", "1"]`, all `gistable: true` and all `isStructural: true` |
| 260830a — an article whose only heading is its title | **open as a fixture** | a page with an `<h1>` and a `<b>Notes</b>` yields **one** heading block against the two a reader sees; nothing in `tests/` ran the pipeline over such a page |
| 260830a — the error names the text at the missing ordinal | **open** | `renderShortfall` names the ordinal, never the text at it |
| 260830e — a hostile *article* | **open** | a stripped-media page still produces `"or"` as a labellable block; every existing test of this path synthesises the model's answer instead |
| 260831b — the corpus **keeps** its supplement block | **open** | nothing asserts it; the day `openai-huggingface` is regenerated without one, the audit silently goes vacuous again — the corpus README's own *"named slugs are not coverage"* hole, one rung down |
| 260905d — run the invariant over the corpus | **open for four of five slugs** | `fixture-corpus.test.ts` runs `checkTree` on `constitution` **only** (line 497) |

**The `splitBlocks` gap, found while measuring and recorded rather than fixed.** The corpus's one
supplement block sits at index 93 of 95, so it is not a trailing run and `splitBlocks` returns
`groups: 0`. The block is enough to make the *word-count* audit non-vacuous — which is what 260831b
asked for and why that row reads closed — but it exercises no grouping, so `appendSupplement`,
`supplementNodes` and `supplementIndex` have no corpus witness. That is a real coverage gap and it is
**not** this plan's to close: it wants a supplement *tail*, which means either a sixth slug or
re-cutting an existing one, and re-cutting a slug that five suites pin properties on is exactly the
kind of change that should not ride along inside a fixture plan. Written down here so it is not
rediscovered from scratch.

## What is being built

Two files and three small additions, and deliberately nothing else.

1. **`tests/fixtures/adversarial-shapes.ts`** — the fixture set: two named HTML shapes and a block
   builder, each **named for the shape it carries**, with a comment naming the postmortem that asked
   for it and what broke. The comments are **pointers, not summaries** — one home per fact, and a
   fixture header repeating a postmortem is a second copy of the project's history to keep in step.
   No article prose: every fixture is invented text in the shape of the real thing, the rule
   260830a's own reproduction used.
2. **`tests/adversarial-shapes.test.ts`** — the tests, running the real functions
   (`splitIntoBlocks`, `buildTree`, `planBatches`, `checkTree`) over them.
3. **`tests/labels-shortfall.test.ts`** — one new describe running the **real `generateLabels`**
   over a batch that genuinely contains an unlabellable block. That file already tells 260830e's
   story in its header and already owns the scripted-transport harness; what it lacked was a hostile
   *input*, since every existing case builds nine-word blocks that are all labellable.
4. **`tests/fixture-corpus.test.ts`** — two additions: `openai-huggingface` keeps its supplement
   block (260831b), and **every** tracked tree passes `checkTree`, not just `constitution`
   (260905d item 1, its own cheapest ranked recommendation).
5. **`tests/fixtures/data-root/README.md`** — the supplement property added to the
   `openai-huggingface` row, since that file claims to list every property each slug is kept for.

### Why a separate fixture module rather than a sixth corpus slug

`npm run worktree:setup` copies `tests/fixtures/data-root/` into every worktree's `data/`, and
`store-parity` and `store-roundtrip` enumerate `data/*` and **publish each article's stored tree
verbatim in `beforeAll`**. A slug carrying a deliberately-invalid tree would therefore take 408 tests
down at suite level in every worktree on the box — which is precisely the failure 260905d is *about*,
recreated on purpose. The adversarial shapes are held as fixture *builders* instead, consumed by the
tests that want them, and the tracked corpus stays publishable.

**The simpler option passed over:** adding the shapes to `tests/labels-batching.test.ts` and
`tests/hierarchy-build.test.ts` as extra cases, with no new files at all.

The argument for the module is **discoverability and reuse**, and it is worth stating that narrowly,
because the first draft of this plan claimed something bigger and wrong: that a module of builders
"is a corpus" in the sense the postmortems meant. It is not. A corpus is articles the pipeline runs
over; this is two HTML strings and a block builder. What it actually buys is that the hostile-article
case in `tests/labels-shortfall.test.ts` imports the same `STRIPPED_MEDIA_LEAD_INS` these tests use —
so the two files cannot drift into disagreeing about what the shape is — and that the next postmortem
wanting a hostile article finds one by name. GPT Sol's correction.

### The permanently-red problem, and how this plan avoids it

260830a wrote three assertions, watched them go red, and then **deliberately did not commit them** —
their fixes are unapplied, so committing would have left the gate permanently red, "and a
permanently-red test is one everybody learns to ignore." That reasoning still holds and this plan
does not overturn it.

So where the defect is still open, the test **pins the current behaviour** rather than asserting the
desired behaviour, under a comment saying so in as many words: *this is what we do today, it is
wrong, here is the postmortem, and when stage 3 is fixed this test goes red — that is the signal, not
a regression.*

**An exact pin, not `it.fails` and not `it.todo`.** `it.fails` turns *any* throw or assertion failure
into a pass, so a defect quietly changing into a *different* defect would stay green — which is the
failure mode this whole tier exists to refuse. `it.todo` is weaker still, because it does not run.
An exact pin has three useful properties: the current failure mode stays observable, a **partial**
improvement reddens it and forces somebody to look, and a complete fix reddens it and prompts
inversion to the desired assertion.

**What a pin does not do is last for ever, and the first draft of this plan overclaimed it.** It said
a characterisation test "cannot rot". It can: the assertion can go semantically stale while still
passing, if the shape it describes stops being the shape that matters. What it does is keep the exact
current failure mode observable. GPT Sol's correction, and worth keeping on the record in a document
whose whole subject is checks that quietly stop meaning anything.

For the record, since the brief asks how each was made to fail: the desired assertions — *no gistable
one-word fragment*, *no unlabellable block in a batch* — were run first and **were red**, exactly as
260830a reported them. What is committed is the same fixture with the assertion turned into a pin,
not the same fixture made green by a production fix.

Where the code handles the shape correctly, the test asserts the real thing and is proved by
mutation.

## How each fixture is made to fail

**The whole tier exists because of [silent-success.md](../reusable/silent-success.md)**, so this
table is the deliverable as much as the fixtures are. Filled in as each stage lands — a row saying
"passes" with no mutation beside it has not been done.

**All ten done, each watched red and then watched green again.** Every `src/` mutation was
reverted by editing the text back and confirmed with `git diff --stat -- src/` returning nothing; the
two corpus mutations were backed up as plain file copies and restored the same way, confirmed with
`git status --porcelain -- tests/fixtures/` showing only the new untracked module. No `git checkout`,
`restore`, `stash` or `reset` was used at any point — those are forbidden here and there is no second
copy of anybody's work in this tree.

| # | assertion | the mutation | what went red |
|---|---|---|---|
| 1 | old HTML — exactly one heading block, the title | the splitter treats `<b>` as a heading | `expected [ 'The Need To Read', 'Notes' ] to deeply equal [ 'The Need To Read' ]` |
| 2 | old HTML — `buildTree` drops the unbacked `Notes` claim, counts it, and the tree then passes `checkTree` | the keepable-heading helper returns `kept: claim` unconditionally, i.e. the behaviour before the repair | `the unbacked claim is counted, not silently lost: expected [] to have a length of 1` |
| 3 | old HTML — the **splitter** emits one-word blocks claiming prose of their own (**pin**) | producer-side: a one-word block becomes non-gistable | `expected [] to deeply equal [ '[1]', '[', '1' ]` |
| 4 | old HTML — a fragment *is* asked for a nav label (**pin**) | same as 3 | `expected [] to deeply equal [ '[1]', '[', '1' ]` |
| 5 | stripped media — an emptied paragraph never reaches a batch | `isStructural` stops consulting `gistable` | `expected [ {…}, …(2) ] to deeply equal []` |
| 6 | stripped media — a bare one-word lead-in *is* asked for a label (**pin**) | same as 3 | `expected [] to deeply equal [ 'or' ]` |
| 7 | hostile article — the re-ask names the unlabellable paragraph | `renderShortfall` drops the noun, the nounless wording that cost an hour | the re-ask no longer matches `/paragraph 4\b/` |
| 8 | hostile article — the batch is accepted and the drop named when the paragraph is refused twice | `droppedBudget` returns 0, i.e. the state of the world before the fix | the run throws instead of accepting |
| 9 | corpus — `openai-huggingface` keeps its supplement block | strip its one `treatment: "supplement"`, which is what regenerating the slug would do | `openai-huggingface has no supplement block… expected 0 to be greater than 0` |
| 10 | corpus — no tracked tree publication would refuse | splice a rung restating its root into `todo/tree.json` | `expected [ …(5) ] to deeply equal []` |

| 11 | the fixture module mints ids the id format accepts | none needed — an earlier draft of the module **actually failed this**, minting `spya-adv001` under a comment explaining that `1` is not in the alphabet | found by review, not by the suite |

**Mutation 3 is the one worth reading twice, and its first version was wrong.** The pins originally
read the fragments through `isStructural`, and were reddened by tightening that predicate — which
looked like the strongest possible evidence, because tightening `isStructural` is *nearly* 260830a's
recommendation 3. It is not: the postmortem is explicit that labellability wants a **sixth predicate**
in `block-policy.ts` rather than a widened `isStructural`, because widening drags search, reading time
and embedding along with it. Worse, reading a **producer** defect through a **policy** predicate meant
a policy change alone would redden the pin, and the pin's own message would then have told the next
agent that stage 3 was fixed and 260830a item 4 could be struck — closing an open item that was still
open. The pins now split: one reads `gistable` straight off the splitter, the others read what reaches
a batch, and both are reddened by a producer-side mutation. GPT Sol's stage review found this.

**Mutations 9 and 10 also reddened two guards I did not write** — the publish-stamp check and the
`output/` byte-parity check both noticed the corrupted corpus. Not the point of the exercise, but
worth recording: the corpus is better defended than the two gaps suggested, and the gaps were
specific rather than general.

**One correctness fix has no mutation behind it, and that is stated rather than papered over.**
Anchoring the `Notes` child's range to the block's own index (rather than counting back from the end)
does not change today's result — the claim is dropped either way. It changes *why*: before the fix the
range did not contain the `Notes` block at all, so the claim was dropped for being out of range, and
the test would have gone on passing after `<b>` became a real heading. That is a false-pass being
closed, which a mutation cannot demonstrate, only reasoning can. Also GPT Sol's finding.

**One assertion in the file is a fixture-integrity guard rather than a behaviour assertion**, and is
labelled as such: *"leaves an empty paragraph where each stripped cell was"* fails if the fixture
stops carrying the shape, which is what it is for. It is reddened by editing the fixture, not by
mutating `src/`, and it earns its place because the two assertions either side of it are meaningless
if the emptied paragraphs quietly stop existing. Recorded here rather than dressed up as something
stronger.

## Stages

Each ends with a GPT Sol review, per the brief and
[engineering-manager.md](../reusable/engineering-manager.md).

- **Stage 1 — the plan.** This document, to Sol before anything is built.
- **Stage 2 — the fixture module and the two block-level shapes** (260830a, 260830e), with the
  mutation evidence for each.
- **Stage 3 — the corpus guards** (260905d, 260831b): the named supplement guard, the corpus-wide
  `checkTree` sweep, and the README property that says why the slug is kept.
- **Stage 4 — land.** Merge `origin/dev` again, full `npm test` and `npm run typecheck`, push to
  `dev`.

## What the review changed

GPT Sol reviewed the plan before anything was built (`gpt-5.6-sol`, effort high, 2026-09-08 01:20).
Four blocking findings, all four checked against the code rather than taken on trust, **and all four
correct**:

1. **The heading fixture was the wrong shape.** 260830a is about an article with *one* heading — its
   title — and the fixture produced **zero**, which I had talked myself into calling "sharper". It
   was not sharper, it was a different case. The `<h1>` is in, and the assertion is now *exactly one
   heading block, and `Notes` survives as text*.
2. **`buildTree` already repairs the unbacked `sourceHeading`.** So the planned test — hand-build a
   tree, watch `checkTree` refuse it — would have re-tested a validator branch that
   `tests/tree-redundant-rung.test.ts` and others already cover, while saying nothing about what the
   pipeline does with *this article*. Replaced with a test that runs `buildTree` over the real block
   list and asserts the claim is dropped, counted in `droppedHeadings`, and the resulting tree
   passes `checkTree`.
3. **`planBatches` alone is not the label pipeline**, and the brief asked for the pipeline. The
   hostile *input* stopped one function short of the behaviour 260830e is about. Now there is a
   scripted `generateLabels` case over a batch that really contains an unlabellable block.
4. **The supplement guard must name `openai-huggingface`.** An existential *"some slug has a
   supplement"* stays green if that slug loses its one and another gains one — and the audit it
   protects seeds specifically from that slug, so the guard would pass for a reason unrelated to the
   thing it guards. That is the same shape as the bug it is guarding against, which is why it is
   worth this much text.

And one thing was **cut**: a `restatedRungTree` fixture and two tests over it, which duplicated
`tests/tree-redundant-rung.test.ts` § *checkTree rejects a rung that restates its parent* — a file I
had read earlier in the session and then built alongside anyway. 260905d's remaining ask is the
corpus sweep, not a second synthetic rung.

Sol also confirmed independently, by running it, that all five tracked trees pass `checkTree` today,
which was the one addition that could have reddened a gate in every worktree on this box.

## Deferred, and named rather than left implied

- **The error message that shows the *text* at the missing ordinal** (260830a). `renderShortfall`
  names the ordinal and now calls it a paragraph, which was 260830e's fix; it still does not show
  what is *at* the ordinal, which is what turns "missing 6, 14, 17, 20" into "four footnote markers"
  without a human going to look. Not built here: it is a change to a production error path, not a
  fixture, and this plan is scoped to `tests/`.
- **The supplement-tail gap** — the corpus exercises supplement *word counts* but no supplement
  *grouping*, because its one supplement block is stranded at index 93 of 95 rather than trailing.
  Closing it means a sixth slug or re-cutting an existing one, and re-cutting a slug five suites pin
  properties on should not ride along inside a fixture plan.
- **The two stage-3 defects themselves** — pinned, not fixed. See the assumptions below.

## Assumptions and decisions, recorded because nobody can be asked

Greg is asleep and the brief says to put questions here rather than in chat.

1. **Characterisation over aspiration** for the open stage-3 defect — pinned by three tests, which
   are one root defect and its two downstream witnesses rather than three faults. Per the section
   above. The
   alternative — committing 260830a's three assertions as written and leaving the gate red — is
   refused by the postmortem that wrote them.
2. **No sixth corpus slug**, per the section above. This also keeps the plan inside `tests/` and
   fixtures, which the brief asks for while several sessions are live in extraction and hierarchy.
3. **No fix to the stage 3 fragment defect.** The brief forbids it and 260830a is explicit that the
   real fix moves block ids — half of `greatwork`'s 330 — and so needs the stage's owner and Greg.
   [block-ids.md](../project/block-ids.md) is the contract it would break.
4. **The `splitBlocks` supplement-tail gap is recorded, not closed** — see above.
5. **`isStructural` is left alone.** 260830a's recommendation 3 would invalidate eight of ten stored
   trees on the phantom-row rule; it needs a migration decision, which is Greg's.
