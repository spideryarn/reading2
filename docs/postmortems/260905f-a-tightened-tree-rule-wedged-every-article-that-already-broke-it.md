# A tightened tree rule wedged every article that already broke it

**2026-09-05.** For about eleven hours, an article whose already-published tree had one particular
shape could not publish **anything at all** — no glossary, no quotes, no debate, no mode of any kind
— and every attempt completed and paid for its model call before being refused. Roughly one article
in twenty. Reported by Greg as two separate feature failures
([SPIDERYARN-READING2-28](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-28) and
[-29](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-29)); they were one bug.

## What the reader saw

Four refusals on `nagel-bat` in thirteen minutes, across two different features:

| time (UTC) | job | step | model spend, thrown away |
|---|---|---|---|
| 20:53:11 | `spya-wq9bz4` | glossary | $0.0378 |
| 21:01:19 | `spya-cdzhx8` | glossary | $0.0348 |
| 21:04:26 | `spya-jgq5pz` | debate | **$0.2454** |
| 21:05:54 | `spya-nf5qqk` | glossary | $0.0365 |

Each one said *"…did not finish. … a step that stops like this often comes out differently on a
second attempt — so trying again is worth a go."* Every word of that was false here. The failure was
deterministic, it was permanent, and each retry cost money.

## The root cause

`c8e2cc7e`, this morning — *"Two rules over one tree, and a rung that said the same thing twice"* —
added a rule to `checkTree` ([`src/tree-invariants.ts`](../../src/tree-invariants.ts) § the
whole-range branch): a non-leaf child may not cover exactly its parent's block range.

The rule is right. Its comment even anticipates the retroactive reach, and reads it as a feature:

> Silent here until 2026-09-05, and the silence was a gap rather than a decision … `buildTree` now
> splices these away (src/hierarchy.ts § `collapseRestatedRungs`); this is what says so for every
> *other* producer of a tree, **and for the ones already stored**.

The producer was fixed. **The stored data was not**, and nothing migrated it. And then two existing
facts turned a detection into an outage:

1. `beginDraftIn` ([`pg-revisions.ts:823`](../../src/store/pg-revisions.ts)) copies the base
   revision's tree into every draft **verbatim**. A glossary step's draft carries the published tree
   whether or not it ever looks at it.
2. `reasonsNotToPublish` runs **the whole of** `checkTree` at **every** publication.

So the glossary step, which does not touch the tree, was refused for the tree's sake — and would be
refused again for ever, because nothing in that loop ever rebuilds the tree.

## The class, named

**An invariant tightened over already-stored data, with no migration for the data it retroactively
invalidates** — multiplied by **a whole-artefact gate applied at every partial publication.**

Either alone is survivable. A retroactive invariant with no gate is a warning; a whole-artefact gate
over data that was always valid is just strict. Together they convert "we found a flaw in 5% of
trees" into "5% of articles are off the air, and finding out costs $0.25 a go".

The money is the part worth staring at: **the gate is consulted after the model call, not before.**
Every one of these four failures was a completed, paid, correct piece of work discarded at the door.

## Blast radius, measured

Local database, 38 articles with a published tree, 9,720 nodes scanned by a parent/child range-equality
query: **2 bad rungs across 2 articles** — `claudes-constitution-spya-cr8bzk` (n0052→n0053) and
`source` (n0054→n0055). `nagel-bat` in production is a third instance found independently, so the
shape is not an artefact of the local data. Production could not be queried from the box that
diagnosed this: its Supabase connection is `http://127.0.0.1:54361`, the local stack.

## The workaround, which needed no deploy

**Re-run the `hierarchy` step on the affected article.** `buildTree` applies `collapseRestatedRungs`
([`src/hierarchy.ts:1657`](../../src/hierarchy.ts)), so the newly built tree does not have the shape,
and its own publication passes. This was true throughout the incident and nobody knew it, because the
refusal text never reached the reader or Sentry.

## Why nobody could see it

The refusal reason was in the Vercel runtime log and **nowhere else**. `sanitise`
([`src/monitoring-scrub.ts:213`](../../src/monitoring-scrub.ts)) withholds any error message that
does not end in a bracketed code, which is correct — `checkTree` problems can quote nav labels, which
are article prose ([logging.md](../project/logging.md)). But the consequence is that a `PublishRefused`
arrives in Sentry as `message_withheld: True` and a stack trace, and two occurrences of it look like
noise rather than one article permanently off the air.

`jobs.ts:1502` attaches `reasons` to the log line on the storage-failure door only; the door that
actually fired is `runStep`'s catch, which logs `errorFields(err)`.

## The fix

Tracked in [260905i](../plans/260905i-two-job-races-a-brain-icon-and-finding-more-quotes.md).
Reproduced first, in `tests/store-publish-guards.test.ts`, and watched red for the right sentence:

```
PublishRefused: Refusing to publish "test-publish-guards": n0 → n1: covers its parent's whole range…
```

## What would have caught it, ranked

1. **A test that publishes a draft over a base whose tree is invalid.** There was none —
   `store-publish-guards.test.ts` tested the guard, never the copy-forward. Cheapest by far, and it is
   now the first of the three cases added.
2. **A convention: tightening an invariant over stored data is a migration.** Either sweep the stored
   rows in the same commit, or state in the commit why not. `c8e2cc7e` knew it applied "for the ones
   already stored" and stopped there.
3. **Reason codes on `PublishRefused`.** Enough of a bracketed code to survive `sanitise` and reach
   Sentry, without the prose. Eleven hours of this were invisibility, not breakage.
4. **A permanent-versus-transient distinction on step failure.** `[jb-step-again]` should not be
   reachable from a refusal that cannot come out differently. This is the one that stops the *next*
   permanent failure charging a reader four times to learn nothing.
