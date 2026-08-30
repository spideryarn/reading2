# The message that looked like an inconsistency, and the paragraph that said "or"

**2026-08-30.** Greg pasted
<https://writings.stephenwolfram.com/2026/07/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected/>
into the Add box on production. It fetched, extracted and split fine — 244 blocks — then stopped at
stage 4 with:

> **Building the table of contents**
> The nav labels for one section failed twice. First attempt: *Nav labels: this call asked for 58
> labels and got 57, missing 4. Nothing has been written.* After a retry with double the reasoning
> allowance: *Nav labels: this call asked for 58 labels and got 57, missing 4. Nothing has been
> written.*

Two things about that are worth a document. The numbers do not appear to add up — and they do. And
the retry, at twice the reasoning allowance, produced not a similar failure but a **byte-identical**
one.

## The first hour went to a sentence

`58 − 57 = 1`, so "missing 4" reads as an arithmetic contradiction, and the obvious explanation is
that some of the returned labels were for ids nobody asked about. The investigation was briefed to
find out which — duplicates, hallucinated ids, or ids from another batch.

All three were wrong, and the code rules each of them out:

```
src/labels.ts:840   `, missing ${missing.slice(0, 5).join(", ")}`
```

**`missing` is a list of paragraph ordinals, not a count.** "missing 4" means *the label for
paragraph number 4 was absent*. One label out of 58. `asked` is `batch.blocks.length`, `got` is
`seen.size`, and the three numbers were consistent all along.

The other two hypotheses die on paths that would have produced different text: a duplicate ordinal
throws *"paragraph N was labelled twice"* long before this message, and an out-of-range ordinal
appends *", and N were not asked for"*, which the production string does not contain. An existing
test, `tests/labels-batching.test.ts:440`, already asserted `/missing 2, 4/` for a two-missing
case — the reading was written down, in the repo, the whole time.

**A message is a user interface, and this one had one plural and no noun.** `missing 2, 4` reads
correctly; `missing 4` reads as a number. The wording cost an hour of investigation and a wrong
hypothesis in a brief, on an error path that is *only* ever read when somebody is already confused.

## What actually happened

Stages 1–3 make no model calls, so they were re-run on the live URL for nothing. They reproduced
production exactly — 167.8 KB fetched, 244 blocks, 244 ids minted, 0 reused.

Of those 244 blocks, **80 are Wolfram Language code cells, and stage 3 leaves an empty non-gistable
`<p>` where each one was.** What that does to the prose around them is the bug:

```
  S#50  <p> "Sometimes it's less obvious, but it still seems fairly clear that nothing can escape…"
   -    <p> ""                                  ← a stripped code cell
  S#51  <p> "But what about in a case like this:"
   -    <p> ""                                  ← a stripped code cell
  S#52  <p> "It looks awfully similar to the cases we saw above…"
```

Fifteen blocks are left as bare lead-ins pointing at nothing. One of them is the single word **"or"**.

The label prompt asks for 6–20 words that are *"a CLAIM or a MOVE, not a topic label"*, and forbids
introducing any fact that is not in the paragraph. For `"But what about in a case like this:"` those
two instructions are **jointly unsatisfiable** — the case *was* the image, and the image is gone. The
model cannot write a claim without inventing one, and it is told not to invent one.

**So it skipped the paragraph, which is the compliant answer.** Then the batch check demanded all 58,
found 57, and threw away a call that had done its job 57 times.

## Why the retry was identical

Not caching: prompt caching caches input, never completions. Not a changed prompt: `batchFingerprint`
deliberately excludes `max_tokens`, so the retry sent the same bytes. And the retry's one change —
doubling `LABEL_HEADROOM` — raises a ceiling nothing was near, because this was never a truncation.
Truncation throws a different message.

**The failure is a property of one line of the input, not of sampling.** A retry could only ever
reproduce it. That is worth stating because "retry with more headroom" is a reasonable-looking
response to a batch that came back short, and here it is guaranteed to spend money and fail
identically.

This is the **third** recorded instance of the shape. `src/labels.ts:60` documents a batch returning
41 of 42, twice, at `effort: "medium"`. The pattern was in the file's own header and had not been
connected to a policy.

## The root cause, and where it actually lives

**The label pass is where it was caught; stage 3 is where it comes from.** A block whose entire text
is "or" is not a paragraph, and nothing downstream can make it one — not the ToC, not reading time,
not search, not zoom. This article is the second independent witness for item **F** in
[opening-an-article-before-the-toc.md](../research/opening-an-article-before-the-toc.md) § 8: stage 3
promoting sentence fragments to blocks. That item is blocked because merging a fragment
re-identifies its neighbour, which moves block ids — [the one contract](../../CLAUDE.md) — so it
needs the stage's owner and Greg.

Until then, the right behaviour is to stop discarding a paid call that succeeded 57 times out of 58.

## The commit, and the argument that was true when it was written

Both halves arrived together in `051bc0a`, *"Split the nav labels out of the tree, and take headings
from the block"* (2026-08-26) — the message wording, and `COVERAGE_FLOOR`.

`COVERAGE_FLOOR` was **tightened from 0.95 to 1** in that commit, and its comment says why:

> There is no longer a path by which a block is legitimately unlabelled.

That was a reasonable claim at the time and it is what makes this interesting. The exact-set check in
`parseLabels` had just been added, so anything less than 100% really was unreachable — *through that
path*. What nobody could see was that the same commit had made the floor depend on a second, unstated
assumption: **that every block the splitter emits can be described in 6–20 words.** An article that
turns 80 images into empty paragraphs breaks that assumption without going near the check that was
being reasoned about.

**A constant justified by "this cannot happen" is only as good as the enumeration behind it**, and
the enumeration here covered the code and not the data.

## The fix nearly introduced something worse

Worth recording, because it was found by somebody going to look rather than by anything going red,
and because **the instruction that would have caused it was mine.**

The fix accepts a batch that came back one or two labels short. The brief for it said so and said
nothing about `detectShift` — the guard that catches the one wrong answer `parseLabels` cannot see,
where the model labels the right *number* of paragraphs and every label is about the paragraph
**next** to the one it names. A majority vote over the set catches it; nothing else can.

`detectShift` runs in `runBatch` **after** the parse. On a short answer **the parse throws first, so
the shift check never runs at all.** So partial-accept, as briefed, would have created a path where
labels are kept having passed no check that could see the failure — reachable only on the answers
most likely to be strange, since a model that has lost its place is exactly the kind that also comes
back short.

The agent wrote the test rather than reasoning about it, and watched `generateLabels` **resolve**
with nineteen confident labels each describing the following paragraph. No gap. Nothing red. A green
suite and a table of contents that is wrong about every row it has.

`acceptGap` now runs `detectShift` on exactly the set it is about to keep, and throws rather than
declining, because *"the model lost its place"* is a better thing to put in front of a reader than
*"it failed twice"*. A mutation probe pins that one line: delete it, and only the truncated-re-ask
test goes red.

> **To be precise, because the difference matters: this was a hole the repair would have opened, not
> a bug that has been shipping.** Before this change a short answer always threw, so `detectShift`
> running after the parse was harmless — the batch died either way. The partial accept is what
> creates a path on which a short answer *survives*, and that was the one path with no shift check
> on it. **No reader's article has been affected.** The correction came from the agent that built
> it, against my own summary, which had blurred the two.

**The general shape, and it is the same one as § "the message" above:** the danger was in the
**check**, not in the code. A guard that runs on the success path leaves the failure path unguarded,
and the failure path is where the strange answers are. See
[guard-the-catch-too](../reusable/silent-success.md) territory — a staleness guard on the success
path leaves the same bug alive in the error path.

A second guard was written at the same time and **deleted within the hour** because no fixture could
make it fail: it refused a rescue when the merged shift check had already found a shift, and the two
label sets differ by at most the budget, which cannot move a majority vote. A clause nothing can
redden is a clause nobody can maintain, and deleting it was the right call.

## What would have caught the class

- **A test with a hostile article, not a hostile response.** Every existing test of this path
  synthesises the *model's* answer. None asks what happens when the *input* contains a block that
  cannot be labelled under the prompt's own rules. The corpus had no article with stripped media, and
  the one in the repo (`noema`) is deliberately unstructured, not deliberately fragmented.
- **Counting what is dropped, not just refusing to drop it.** The fix accepts a bounded shortfall,
  and the thing that makes that safe is not the bound — it is that the count is reported. An
  unlabelled leaf renders as *nothing*, so without a number this becomes a
  [silent success](../reusable/silent-success.md) the day the bound is raised.
- **Reading the error's own test before theorising about the error.** `tests/labels-batching.test.ts`
  asserted `missing 2, 4` and settled the arithmetic question in one line. The brief that sent an
  agent hunting for hallucinated ids was written without it.
