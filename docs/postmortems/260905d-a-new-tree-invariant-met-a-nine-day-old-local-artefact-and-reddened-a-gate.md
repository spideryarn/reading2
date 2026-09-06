# A new tree invariant met a nine-day-old local artefact, and reddened a gate

**Found 2026-09-05**, by a [get-ready-to-deploy.md](../reusable/get-ready-to-deploy.md) sweep, in
the shared primary checkout. `npm run check`'s test gate was red: `tests/store-parity.test.ts` and
`tests/store-roundtrip.test.ts` both died in `beforeAll`, before a single assertion, with

```
PublishRefused: Refusing to publish "source": n0054 → n0055: covers its parent's whole range,
so one rung finer restates the same blocks instead of compressing them
```

Two suites, 408 tests, all of them skipped behind one setup failure.

**Nothing was wrong with the code, and nothing was wrong with the rule.** The tree was wrong, and
it had been wrong for nine days with nothing to notice.

## What happened

`c8e2cc7e` "Two rules over one tree, and a rung that said the same thing twice" (2026-09-05 01:48)
added an invariant to [`src/tree-invariants.ts`](../../src/tree-invariants.ts): an internal node may
not cover its parent's whole range, because then one rung finer restates the same blocks instead of
compressing them. It is enforced in three places, and one of them is `reasonsNotToPublish` in
[`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) — publication refuses a tree that
fails it.

`data/source/tree.json` on this box was generated on **2026-08-26 23:05**, ten days before the rule
existed, and contained exactly that shape:

| node | depth | blocks | children | title |
|---|---|---|---|---|
| `n0054` | 1 | 39–40 | `[n0055]` | References and Author Bio |
| `n0055` | 2 | **39–40** | `[n0056, n0057]` | Author Biography |

`n0055` restates `n0054`. Block 39 is the `References` heading and block 40 is the author bio, so
the rung's title described only half of what it covered — the tree was not merely redundant, it was
mislabelled, which is the fault the rule was written to name.

Both suites pin themselves to the working `data/` directory on purpose
([`tests/store-parity.test.ts:330`](../../tests/store-parity.test.ts)), enumerate `data/*`, and
publish each article's stored `tree.json` verbatim. `data/` is gitignored.

## Why nobody saw it

**The rule was proven against the corpus, and the corpus was not repaired.** The plan behind the
change, [260904d-deepen-fat-sections.md](../plans/260904d-deepen-fat-sections.md), did the audit and
wrote the number down:

> Over the 103 saved trees the new rule finds exactly 35 restated rungs across 10 trees and nothing
> else: no false positive on any of the 208 benign one-block sections and none on any supplement.
> Rebuilt through the new `buildTree`, all 35 collapse, none survives, and no tree's leaf layer
> changes.

That is a correctness proof for the rule. It is also, read the other way, a statement that thirty-five
violating rungs were sitting on disk when the refusal shipped — and the plan drew no consequence from
it, because it was asking whether the rule was right, not what the rule would do to what already
existed.

**And the work was done in a worktree, where the evidence does not exist.** `.worktreeinclude` copies
`.env.local` and `.env` and nothing else, so a worktree starts with an empty `data/` and fills it from
its own runs — all of them post-rule, all of them clean, because `collapseRestatedRungs` in
[`src/hierarchy.ts`](../../src/hierarchy.ts) splices this shape out at build time. The commit was
green where it was written and red only in the primary. Greg's Mac would most likely have been green
too.

## The class

**An invariant added without migrating the corpus it will judge.** The new rule is checked against
existing data to prove it does not over-fire, the check finds real violations, and that finding is
recorded as evidence *for the rule* rather than as work to do. The rule then ships with a refusal
attached, and the pre-existing violations become failures at whatever moment something next tries to
publish them. The tell is a plan that says "and all of them collapse when rebuilt" without a stage
that rebuilds them.

A second class rides along, and it is the reason the first one went unnoticed for a day:
**a gate whose verdict depends on un-versioned local state.** `store-parity` and `store-roundtrip`
read gitignored `data/`, so the gate answers a different question on every machine. Red here, green
in fifteen worktrees, green on the Mac, and no two people can reproduce each other's result. It is a
[silent-success.md](../reusable/silent-success.md) shape inverted: not a check that passes while
doing nothing, but a check whose passing means nothing in particular.

## The next morning it happened again, and it was not the same thing — 2026-09-06

The 01:35 sweep found `tests/store-parity.test.ts` red again, and the first diagnosis written here
was wrong. It is left on the record because the way it was wrong is the more useful half.

**What it looked like.** The Postgres library listed 10 articles where the on-disk corpus has 12.
The two missing, `revistes-ub-30977` and `source-2`, both carry `archived_at` set on **2026-08-27**
— ten days before the run, on this box, by somebody doing an ordinary thing. That reads exactly
like the bug above: an assertion meeting local state older than itself. It was written up as a
second instance of the same class.

**What it actually was.** GPT Sol refused that write-up and was right. The suite *itself* recreates
those archive flags moments before asserting: `seedShelfFromFiles(slug)` runs for every loaded
article ([store-parity.test.ts:362](../../tests/store-parity.test.ts)) and writes all five shelf
columns from each `data/<slug>/shelf.json`, `null` included and deliberately so — its own comment
says leaving a key absent would let a previous run's `archivedAt` survive, "the exact failure mode
the parity suite exists to rule out". Both files still carry an `archivedAt`. So the database state
was not stale; it was seeded from disk by the test, on that run, on purpose.

**The real cause is a regression, and it came in with Stage G.** Until 2026-09-05 the assertion
compared two *listings* — filesystem against Postgres — and both ends excluded archived articles,
because that is what a library listing does. `86a4ef7c` deleted the filesystem store and replaced
that end with `slugs`: every directory holding blocks and a tree, which excludes nothing. An
archived article thereby became a slug the assertion demanded and the query is correct to withhold.
Green in every worktree, because a worktree has none of those gitignored directories to ask about;
red only in the primary, which is the same asymmetry as the bug above and the only thing the two
share.

**Fixed in this sweep**, in `tests/store-parity.test.ts`, by partitioning rather than excluding: the
active slugs must be exactly the active shelf and the archived slugs exactly the archived shelf,
each read from the same `shelf.json` the suite seeded from. That is stronger than the assertion it
replaces and much stronger than naming the two articles — dropping an archived article from
Postgres altogether would now fail, where an exclusion would have passed. 108 passed, 0 failed.

**The lesson is about the shape of the first answer, not about shelves.** "Old local state met a new
assertion" was available, familiar, fitted every visible fact, and was wrong. It was reached by
reading the database and the calendar and never reading the fifteen lines of test setup directly
above the failure. A diagnosis that explains the evidence is not thereby correct, and the sign of
this particular error is comfort: it arrived already matching a postmortem written the day before.
What broke it open was a reviewer asking for the code path rather than the symptom.

## What would have caught it

Ranked by ease and by value, which here are not the same order.

1. **Cheapest, and it would have caught this exact bug: run the new invariant over `data/` and
   `evals/` as part of the change, and fix what it finds.** The plan already ran that scan — it
   printed 35. The missing step was a stage that acted on the number rather than quoting it. A
   one-line addition to any plan that adds an invariant: *the corpus is migrated in the same
   commit, or the reason it need not be is written down.*
2. **Highest value, and already tracked and ranked: get the file readers onto `dataRoot()`.** The
   comment at `tests/store-parity.test.ts:319-330` names the blocker, and
   `tests/fixture-corpus.test.ts:255-266` names it more precisely and more damningly — **five**
   readers hold `const ROOT = path.resolve(import.meta.dirname, "..")` at module scope
   (`src/comments.ts:35`, `src/chat.ts:51`, `src/searches.ts:50`, `src/shelf.ts:45`), so
   `SPIDERYARN_DATA_ROOT` does not move them and they read the laptop's `data/` whatever a test
   sets. That is **ranked silent failure 1** in
   [260901b-committed-fixture-corpus.md](../plans/260901b-committed-fixture-corpus.md), observed
   rather than predicted: pointed at the corpus, `loadComments("writes")` returned the laptop's
   eleven comments instead of the fixture's three.

   **This got more expensive within hours of being written, and the note is the point.** When the
   sentence above was drafted on 2026-09-05 it went on to say the sweep was cheap, because
   `dataRoot()` already existed, already read the override, and its own doc-comment already forbade
   exactly this hoisting. That is no longer true: `src/store/data-root.ts` was **deleted the same
   evening** by `86a4ef7c` "Stage G: the filesystem store is gone", and `SPIDERYARN_DATA_ROOT` is
   now referenced nowhere in `src/` at all. Twelve files under `tests/` still mention the name, but
   only one still assigns it (`tests/pipeline-slug-claim.test.ts:102`); the rest are comments
   describing a mechanism that no longer exists. Verified 2026-09-06. The readers are still there,
   still hoisted, still reading the laptop's `data/` whatever a test sets — and there are **five**
   of them, not four, because the fifth is worse and easy to miss:

   ```
   src/comments.ts:33         const ROOT = path.resolve(import.meta.dirname, "..")
   src/chat.ts:56             const ROOT = path.resolve(import.meta.dirname, "..")
   src/searches.ts:50         const ROOT = path.resolve(import.meta.dirname, "..")
   src/shelf.ts:51            const ROOT = path.resolve(import.meta.dirname, "..")
   src/glossary-lookups.ts:66 const ROOT = process.cwd()
   ```

   `process.cwd()` is not the same bug as the other four. Theirs is fixed relative to the module and
   merely ignores the override; this one moves with whatever directory the process happened to start
   in, so it reads a different `data/` depending on where you typed the command. The paragraph above
   said "five" and then listed four, which is how it stayed unnoticed.

   So the bug is unchanged and the remedy has to be rebuilt rather than reused. Whoever picks this
   up should know they are introducing the override, not adopting it — and should check first
   whether these four readers ought to exist at all now that the filesystem store is gone, since
   deleting a file reader beats parameterising one. That question is genuinely open here; it is not
   a recommendation dressed as one.

   Until it lands, a gate result from a worktree is not evidence about the primary and vice versa.
3. **A repair path for a stored tree, not only for a proposed one.** `collapseRestatedRungs` fixes
   trees at build time, from a model proposal. Nothing fixes a tree that is already stored: grep
   `src/` and `src/store/` and there is no such path. So an article whose tree was published before
   2026-09-05, when nothing checked for this, can meet `PublishRefused` on its next job. Locally the
   incidence was 1 tree in 18. **This is unaudited on production** — the sweep could not reach the
   production database from the box — and it is the one item here with a plausible reader-facing
   consequence, so it wants Greg running the query: any `revisions.tree` holding a node whose child
   has children and an identical `range`.

   **Who trips it, precisely.** Every job that does not run `hierarchy` carries the stored tree
   forward — `tree` is `"carry"` in `REVISION_CARRY_POLICY` ([`pg-revisions.ts:238`](../../src/store/pg-revisions.ts))
   — so arc, glossary, ideas, quotes, timeline, quiz, sketch and tweets can each end in
   `PublishRefused` on a bad tree. Shelf and comment edits cannot: they never publish a revision.

   **What heals it is narrower than it looks.** A *forced* re-extraction or an explicit `hierarchy`
   run rebuilds through `collapseRestatedRungs` and fixes the tree. A plain re-run does not:
   `hierarchy` deliberately has no `stamp` ([`pipeline.ts:2027`](../../src/pipeline.ts)), so
   `stepIsDone` skips it whenever tree, labels and blocks are present. "Run it again" is not the
   workaround; "run it again with `force`" is.

   **The obvious remedy is the wrong one.** A splice applied *on publish* comes too late, and this
   is the part worth reading twice. A job copies the tree into its draft first
   ([`beginDraftIn`](../../src/store/pg-revisions.ts)), the step then stamps its generated artefact
   with that tree's `structureHash` — `articleFingerprint` is literally
   `hashBlocks(blocks).structureHash(tree).…` ([`source-hash.ts:455`](../../src/source-hash.ts)) —
   and only at settle does `publishRevisionIn` validate. Splice at that last moment and every
   artefact in the revision, the one just generated included, is instantly stale against the tree
   it was stamped against: the repair would quietly manufacture the staleness it was meant to end.
   The repair has to land **before any step reads the draft** — a one-time migration of the
   affected stored revisions, which is the cleaner fix, or normalisation inside `beginDraftIn`.
   Note that a `Tree`-level splice is new code either way: `collapseRestatedRungs` works on
   `ModelNode` proposals and there is no `Tree` → `ModelNode` converter in the repo.

   Found by GPT Sol reviewing this postmortem on 2026-09-05 and confirmed against the code on
   2026-09-06; the "splice on publish" sentence that stood here before said the opposite.

## What was actually done, 2026-09-05

Only the local repair, because only the local data was broken. `n0055` was spliced into `n0054` —
the rung discarded, its two leaves lifted to stand in its place, the parent keeping its own title and
gist — which is precisely what `collapseRestatedRungs` does at build time. `npx tsx src/validate-tree.ts
data/source` then reported `✓ structure is sound`, and both suites went green: 408 passed.

A re-run of `npm run hierarchy source` would have fixed it too, and was not used: it costs a model
call and renumbers every node to repair one rung. The backup of the original file is in the sweep's
scratchpad, and `data/source` is in any case a duplicate ingest of `data/source-2`, the same article
taken 26 minutes later, whose tree has no redundant rung.

Nothing in the repository changed for this. That is the point of the entry: the bug was in a file
git has never seen, and the lasting fix is items 1–3 above.
