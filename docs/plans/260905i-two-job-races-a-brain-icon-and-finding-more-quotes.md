# Two job races, a brain icon, and finding more quotes

Batch four of the feedback-reports loop. Four reports, all Greg's, all from one reading session on
`nagel-bat` between 20:50 and 21:06 UTC on 2026-09-05, all against production build `6f563997`.

| | Sentry | what it is | size |
|---|---|---|---|
| 25 | [SPIDERYARN-READING2-25](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-25) | "For the Remember mode button, use a brain icon" | one line |
| 27 | [SPIDERYARN-READING2-27](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-27) | "Add a button in Quotes mode to find more" | small feature |
| 28 | [SPIDERYARN-READING2-28](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-28) | "Debate mode didn't work. Asking the web did not finish." | production bug |
| 29 | [SPIDERYARN-READING2-29](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-29) | glossary re-find: "Finding the terms did not finish." | production bug |

**28 and 29 are one report, not two.** Both are `[jb-step-again]` — the reader-facing copy for a job
step that stopped — and there is an error sitting between them:
[SPIDERYARN-READING2-26](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-26),
`PublishRefused`, status 409, `step: glossary`, `slug: nagel-bat`, **two occurrences**, 20:51:00 and
21:01:19. One reading session, one article, two steps, two refusals.

## The hypothesis, stated before it is checked

`publishRevisionIn` (src/store/pg-revisions.ts) refuses when
`draft.basedOnRevisionId !== article.currentRevisionId` — *"something else published while this draft
was being written, and publishing now would discard it"*. That guard is right, and it was put there
deliberately (GPT Sol, finding 1 of `260901d-stage3-code-review-sol.md`).

So the suspicion is **not that the guard is wrong**. It is that **two reader-triggered steps ran
against one article at the same time**, which the guard then correctly refused — and the reader saw
two modes die for a reason that is nobody's fault and that a retry silently fixes. If that is what
happened, the bug is upstream: whatever is supposed to stop two steps racing on one slug.

The alternative, which has to be ruled out rather than assumed away: the two refusals are unrelated
to each other, and one of them is a stale draft from a deploy.

**Whichever it is, `message_withheld: True` means the refusal's `reasons` list did not reach Sentry**,
so the diagnosis cannot be read off the issue — it has to come from the code and from a reproduction.

## What "the simplest version" means for each

- **25** — change the icon. There is no smaller version.
- **27** — Greg asks for a button that finds more quotes. The pipeline already has a quotes step with
  a `MAX_QUOTES` and a suggestion count; the simplest version is a button that re-runs it asking for
  more, not a new incremental-append mechanism.
- **28 / 29** — root-cause first, fix second, and if the fix is large, ship the smallest thing that
  stops a reader losing work and defer the rest explicitly.

## Stages

- **A** — diagnose the two refusals. Read-only. Produces the root cause, the class it belongs to, and
  the ranked options.
- **B** — report 25, the brain icon.
- **C** — report 27, finding more quotes.
- **D** — the fix that comes out of A, with a postmortem under `docs/postmortems/`.


## Stage B — report 25, the brain icon. Done.

`icon: Speech` → `icon: Brain` in `MODES_UI` (`src/web/Dock.tsx`). `Speech` was the mode's *method*
— the reader talks — and Chat sits next to it doing the same thing, so a speech bubble was working
twice in a row of eighteen icons. `Brain` names the subject instead. No test: nothing pins any other
mode's icon, and the exhaustiveness check in the same file already guarantees every mode has one.

## Stage C — report 27, "a button in Quotes mode to find more". Already built.

The button exists (`Foot` in `QuotesPanel.tsx`, **Choose them again**, offered unconditionally), and
**he knows it exists** — yesterday he read that same panel foot and asked us to delete the
`generator · version` line above it. So this is not discoverability.

He meant *more*, not *again*. That shipped ninety minutes before he filed this, in `260905g`:
`MAX_QUOTES` 16 → 32 and the suggestion doubled to one per 300 words. He was on production
`6f563997`, which does not have it. `PROMPT_VERSION` → `quotes/3` means every existing list will wear
the *"chosen by an earlier version of the prompt"* banner with the button under it, and pressing it
returns roughly double.

**Fable arbitrated** between closing it, renaming the label, and building append, and picked closing
it. Two rejections worth keeping:

- **"Find more" as a label** is a lie on an article already at the target, and a version conditional
  on the `outdated` banner is honest only by coincidence — it works today because *this* prompt bump
  happened to be the count, and the next bump makes it wrong again.
- **Append** reverses `quotes.md` § *It replaces. It does not append.* and needs back the
  forbidden-list machinery that was removed on purpose.

**The falsifier, recorded:** if he files it a third time after the deploy, on an article already at
`quotes/3`, then "more" means *beyond the prompt's target* and the right build is a count control —
a re-run with a raised target, still replace-not-append. On the second filing, not this one.

## Stage A — reports 28 and 29. It is one bug, it is live, and we shipped it today.

**The hypothesis at the top of this doc was wrong.** Two mode jobs cannot race on one article: the
claim path refuses any slug that already has a `running` row (`blockedByAnother`,
`src/store/pg-jobs.ts:400`), inside the `queue_state` lock, with a `jobs_one_running_per_slug`
constraint behind it (`src/db/schema.ts:2051`). The delegated diagnosis walked the pause and requeue
paths and could not construct an interleaving.

**The refusal text was never in Sentry** — `sanitise` (`src/monitoring-scrub.ts:213`) withholds any
message without a bracketed code, which is right, because `checkTree` reasons can carry nav labels.
It *is* in the Vercel runtime log, on `step failed: <step> — nagel-bat`. Fetched, and it is the same
sentence every time:

> `Refusing to publish "nagel-bat": n0002 → n0003: covers its parent's whole range, so one rung finer
> restates the same blocks instead of compressing them (granularity-zoom.md#the-tree)`

**Four refusals, not two**, all on `nagel-bat`, all with the same reason:

| time (UTC) | job | step | wasted |
|---|---|---|---|
| 20:53:11 | `spya-wq9bz4` | glossary | $0.0378 |
| 21:01:19 | `spya-cdzhx8` | glossary | $0.0348 |
| 21:04:26 | `spya-jgq5pz` | **debate** | **$0.2454** |
| 21:05:54 | `spya-nf5qqk` | glossary | $0.0365 |

Every one did its paid model call, finished it, and then threw the answer away at publication. The
reader was told *"trying again is worth a go"* four times, and each try cost money and could not
possibly have worked.

### The cause, and it is ours, from this morning

The rule that refused is `tree-invariants.ts:352`, and `git log -S` puts it in **`c8e2cc7e`, today**
— *"Two rules over one tree, and a rung that said the same thing twice"*. `c8e2cc7e` is an ancestor
of the deployed build `6f563997`. Its own comment says what happened, and says it as though it were
a feature:

> Silent here until 2026-09-05, and the silence was a gap rather than a decision … `buildTree` now
> splices these away (src/hierarchy.ts § `collapseRestatedRungs`); this is what says so for every
> *other* producer of a tree, **and for the ones already stored**.

New trees are fixed at the producer. **Already-stored trees were not, and nothing migrated them.**
And because `beginDraftIn` copies the base tree into every draft verbatim
(`src/store/pg-revisions.ts:823`), and `reasonsNotToPublish` runs the whole of `checkTree` at every
publication, an article whose *published* tree has a restated rung can no longer publish **anything**
— glossary, quotes, debate, ideas, any mode at all — for ever, at a cost per attempt.

### The blast radius, measured rather than guessed

Against the local database, 38 articles with a published tree, **9,720 nodes scanned**:

```
bad rungs: 2      bad articles: 2      (claudes-constitution-spya-cr8bzk n0052→n0053, source n0054→n0055)
```

Roughly **one article in twenty**. Production could not be queried from this box — the Supabase MCP
here is `http://127.0.0.1:54361`, the local stack, which is why `nagel-bat` was not in it. But
`nagel-bat` is a third instance, found the other way, so the shape is not a local artefact.

### The class

**An invariant tightened over data already stored, with no migration for the data it retroactively
invalidates** — compounded by **a whole-artefact gate applied at every partial publication**: the
glossary step does not touch the tree, and is refused for the tree's sake.

### The fix this doc proposes, before it is reviewed

**A publication should be gated on the tree it *changes*, not on the tree it merely carries
forward.** If a draft's tree is byte-identical to the one the article is already serving, its
problems are pre-existing, they are already in front of readers, and refusing a glossary list does
not protect anybody from them — it only takes the glossary away too. Record them; do not refuse.

Any publication that *builds or alters* a tree stays fully gated, which is where the gate was always
aimed, and re-running `hierarchy` still repairs the article because `buildTree` now splices the shape
away.

This fixes the class, not the instance: the next tightened invariant will not wedge anybody.

**The two things that must not be lost:** the failure is *permanent*, so `[jb-step-again]` is a lie
that costs money, and the money is spent *before* the gate is consulted. Both are recorded below as
follow-ups whatever the fix turns out to be.

### Stage D as built

**The reproduction came first, and it was red for the production sentence.** Three cases added to
`tests/store-publish-guards.test.ts`, which tested the guard and had never tested the copy-forward.
The published tree is poisoned by `UPDATE` — which is exactly what the invariant change did to it,
and the only way to get such a tree, since the guard refuses to publish one:

```
PublishRefused: Refusing to publish "test-publish-guards": n0 → n1: covers its parent's whole range,
so one rung finer restates the same blocks instead of compressing them (granularity-zoom.md#the-tree)
```

**The comparison is one boolean, computed by Postgres.** `treeCarriedUnchanged` asks
`d.tree is not distinct from b.tree` across the draft and its base; neither tree crosses the wire, and
`jsonb` equality is over the normalised value, so key order cannot make an untouched tree look edited
— which a `JSON.stringify` comparison would get wrong. It is safe to ask against
`draft.basedOnRevisionId` because the branch immediately above has *just proved*, under the article
lock, that it equals `article.currentRevisionId`. No base means `false`: everything is new, so
everything is checked.

**The exemption is narrow on purpose.** Only `checkTree`'s problems, and only when the tree is
unchanged. The `hierarchy` status and `input_hash` checks are untouched; so is "no blocks", so is
"no tree". Widening it is a decision for the review, not a default.

**And it is not silence.** A carried-forward tree that `checkTree` rejects is logged at `warn` with
the problems and a pointer to the repair, because the problems are what `sanitise` withholds from
Sentry and somebody has to be able to find out.

**Perturbed, not just watched pass.** Making `treeCarriedUnchanged` return `true` unconditionally
turns *"still refuses a bad tree that this draft actually changed"* red — so that case is
discriminating rather than decorative. Restored, six of six green; 190 further tests across nine
publish-touching files green.

### The workaround that existed all along

**Re-running the `hierarchy` step repairs an affected article with no deploy at all.** `buildTree`
applies `collapseRestatedRungs` (`src/hierarchy.ts:1657`), so the rebuilt tree does not have the
shape and publishes normally. This was true throughout the eleven hours, and nobody could know it,
because the refusal text reached neither the reader nor Sentry.

### Recorded, not built

- **The reader is told to retry a permanent failure.** `[jb-step-again]` is reachable from a refusal
  that cannot come out differently, and each retry costs a model call. A permanent-vs-transient
  distinction on step failure is the change that stops the *next* one charging four times to learn
  nothing.
- **The money is spent before the gate is consulted.** All four failures were completed, paid, correct
  pieces of work discarded at the door. Fixing this means pre-flighting the gate, which is a real
  design question rather than a tweak.
- **Reason codes on `PublishRefused`**, so a bracketed code survives `sanitise` and reaches Sentry
  without the prose. Eleven hours of this were invisibility, not breakage.
- **A convention: tightening an invariant over stored data is a migration.** Sweep the rows in the
  same commit, or say in the commit why not.

### The review, and the hole it found before this shipped

[260905i-publish-gate-review-sol.md](260905i-publish-gate-review-sol.md). Sol's opening line is the
finding, and it is a real one:

> The serious flaw is that the proposal compares only the tree, while `checkTree` validates the
> `(blocks, tree)` pair. As currently drafted, it can publish a newly invalid revision.

**Verified rather than accepted.** `checkTree` reads `b.kind` (`src/tree-invariants.ts:167`, `:300`),
and `hashBlocks` fingerprints `id`, `text`, `role` and `treatment` — **not** `kind`. So a draft could
leave the tree byte-identical, change one block's `kind`, cause a fresh `checkTree` failure, and be
waved through by both the exemption *and* the hierarchy hash check. That is a laundering path, and
the first draft of this fix had it. (Sol's own example used `gistable`; `checkTree` does not read
that one. The class was right, the field was not.)

**Fixed:** `publicationInputUnchanged` now compares the blocks too, as a symmetric `EXCEPT ALL` over
`CARRIED_BLOCK_COLUMNS` — the same exhaustive inventory `beginDraftIn` copies with, so a new block
column joins the comparison by existing rather than by being remembered. Still one boolean over the
wire. `EXCEPT ALL` rather than `EXCEPT` so the set operator cannot dedupe a difference away.

**Pinned, and the pin was perturbed.** A new case — *"withholds the exemption from a draft that
changed its blocks"* — asserts the mechanism rather than one synthesised failure. Deleting the block
comparison turns exactly that one test red and leaves the other six green.

**The second finding, also taken:** the `warn` was inside the transaction, so a later rollback — a
lost fence, a failed settlement — would have left the log announcing a publication that never
happened. That is the precise mistake the note above `logPublication` was written about. The problems
now come back on `PublishRevisionResult.carriedTreeProblems` and are logged after the caller's commit.

**Where the review was taken but narrowed:**

- Sol asked for **all** `checkTree` problems to be grandfathered rather than the restated-rung rule
  alone. That is what was built — the exemption is over `checkTree`'s output as a whole, conditional
  on exact equality of the pair. Sol's list of what must **stay** unconditional matches what was
  left alone: no blocks, no tree, a missing `hierarchy` run, a `running`/`error` `hierarchy` run, and
  the `input_hash` check. The dangerous one it names is the third: *"a hierarchy attempt can fail
  while leaving the copied tree byte-for-byte unchanged"*, and exempting that would publish the
  residue of a failed tree-owning operation.
- **"Builds versus alters"** — Sol is right that exact equality cannot distinguish a `hierarchy` run
  that rebuilds an identical tree from a step that never touched it. Proving *built here* needs a
  provenance marker on the tree-writing seam. **Not built**, and the wording changed instead: the
  policy is now stated as state-based, and the case is hypothetical, because `collapseRestatedRungs`
  means a rebuild cannot reproduce an invalid tree.

**Where the review was not taken:** it asks for a preflight over inherited publication prerequisites
before the paid call. That is the right shape and it is a design job, not a tweak — it has to know the
step's planned write set, or an invalid inherited tree would block the very `hierarchy` step whose
purpose is to repair it. Recorded above, not built. Sol agrees on the ordering: *"Neither follow-up is
more important than restoring publication availability."*

Its answer to *what would have caught this* is one sentence, and it is now the first case in the file:

> Publish an unrelated draft copied from a currently served revision whose tree violates the newly
> added invariant.

## Decisions and assumptions taken without asking

- **The exemption is narrow, and widening it is a decision rather than a default.** Only `checkTree`'s
  problems, only when the blocks *and* the tree are exactly the base's. Everything else in
  `reasonsNotToPublish` stays unconditional. The one Sol names as dangerous to exempt is the
  `hierarchy` run's status: *"a hierarchy attempt can fail while leaving the copied tree byte-for-byte
  unchanged"*, and exempting it would publish the residue of a failed tree-owning operation.
- **No backfill.** Sol calls one *"worth doing after the gate fix"*, and it would stop the warnings
  repeating — but it does not fix the class, and re-running `hierarchy` on an affected article does it
  by hand today. Greg's instruction on the previous batch was *"Don't worry about backfill"*; a sweep
  is easy to add later and easy to get wrong now.
- **Production could not be queried.** The Supabase MCP on this box is `http://127.0.0.1:54361`, the
  local stack — which is why `nagel-bat` was not in it, and why the blast-radius number is local.
  Production *runtime logs* were reachable through the Vercel MCP, and that is where the refusal text
  came from.
- **Reports 28 and 29 are one note, not two.** Same cause, same fix, ninety seconds apart, and
  splitting it would have meant writing the diagnosis twice and inviting the reader to believe there
  were two bugs.
- **Report 29's first sentence is not a request.** *"These were written before entries said where each
  half came from…"* is Greg explaining why he pressed retry, not asking for anything. Taken at face
  value; the glossary's two-part format already exists and the retry is what failed.
- **The `warn` names the repair.** *"re-run hierarchy to repair it"* — because the whole cost of this
  incident was that the person looking at it could not find out what to do, and a log line that
  reports a problem without its remedy is the same failure one layer up.
