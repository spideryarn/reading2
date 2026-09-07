# Debate and glossary "did not finish" — one bug, and it was ours from this morning

**[SPIDERYARN-READING2-28](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-28)** and
**[-29](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-29)** · reported 2026-09-05 21:05 and
21:06 UTC · *fixed; postmortem written*

## What Greg said

> Debate mode didn't work. / Asking the web did not finish…

> These were written before entries said where each half came from. Finding them again splits each
> one into what the article means and what the model knows. / Retry / Finding the terms did not
> finish…

Two reports, two features, ninety seconds apart. **One bug.**

## It was not the feature. It was the door.

Both steps did their work. Both finished their model call. Both were then refused at publication,
with the same sentence, which reached neither of them:

> Refusing to publish "nagel-bat": n0002 → n0003: covers its parent's whole range, so one rung finer
> restates the same blocks instead of compressing them

**Four times in thirteen minutes**, and the debate one had already spent **$0.2454**:

| time | step | spent, then discarded |
|---|---|---|
| 20:53:11 | glossary | $0.0378 |
| 21:01:19 | glossary | $0.0348 |
| 21:04:26 | debate | $0.2454 |
| 21:05:54 | glossary | $0.0365 |

Each one told him *"trying again is worth a go"*. That was false in every particular: the failure was
deterministic, permanent, and charged.

## The cause

`c8e2cc7e`, **this morning**, added a rule to `checkTree` — no rung may restate its parent's whole
range — and fixed the producer in the same commit. It left the trees already stored alone.

`beginDraftIn` copies the base tree into every draft verbatim, and the publication gate runs the whole
of `checkTree` every time. So an article whose *published* tree had that shape could no longer publish
**anything**: glossary, quotes, debate, ideas, any mode, for ever. Measured on the local database:
**2 bad rungs across 38 articles**, 9,720 nodes scanned. About one in twenty.

## The fix

**A publication is judged on the input it changes, not the input it carries forward.** A glossary
step's draft holds the tree the article is *already serving*; refusing it protects nobody from that
tree and only takes the glossary away too.

Narrow on purpose: only `checkTree`'s problems, and only when the blocks **and** the tree are exactly
the base's. The `hierarchy` status and hash checks are untouched — GPT Sol's review names the
`running`/`error` one as the check where an exemption would be genuinely dangerous, because a failed
tree-building attempt leaves the copied tree unchanged.

**Sol also found a hole in the first draft before it shipped:** comparing only the tree would let a
draft change a block's `kind`, cause a *fresh* tree problem, and be waved through — `hashBlocks` does
not fingerprint `kind`. The comparison now covers the blocks too.

## The thing worth knowing for next time

**The workaround existed all along, with no deploy: re-run the structure step.** `buildTree` splices
the shape away, so the rebuilt tree publishes normally. Nobody could know that, because the refusal
text reached neither the reader nor Sentry — `sanitise` withholds any message without a bracketed
code, correctly, since the refusal's message wraps its reasons in the article's own slug. It was in
the Vercel runtime log and nowhere else.

## Recorded, not built

- ~~**The reader is told to retry a permanent failure**, and each retry costs a model call.
  `PublishRefused` needs reason kinds so a tree-invalid refusal is a bug rather than a retry, while a
  moved-base conflict stays retryable.~~ **Built 2026-09-07**,
  [260907a](../plans/260907a-publish-refusal-reason-kinds-permanent-vs-transient.md).
- **The money is spent before the gate is consulted.** Fixing that means a preflight, which has to
  know the step's planned write set — otherwise an invalid inherited tree would block the very
  `hierarchy` step that repairs it.
- ~~**A convention:** tightening an invariant over stored data is a migration. Sweep the rows in the
  same commit, or say in the commit why not.~~ **Written down 2026-09-07**, in
  [database.md](../project/database.md#tightening-an-invariant-over-stored-data-is-a-migration).

Full write-up:
[260905f](../postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md).
