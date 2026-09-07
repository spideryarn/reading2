# Publish refusal reason kinds — permanent, transient

**2026-09-07.** `PublishRefused` carries `readonly reasons: readonly string[]` and nothing else, so
no caller can tell a refusal that will never come out differently from one that genuinely will. The
consequence, on 2026-09-05, was four refusals on one article in thirteen minutes, each after its
paid model call had completed, each telling the reader *"a step that stops like this often comes
out differently on a second attempt — so trying again is worth a go"*, and each costing real money:
$0.0378, $0.0348, $0.2454, $0.0365. The failure was deterministic, permanent, and charged.

This is item 3 and item 4 of *What would have caught it, ranked* in
[260905f](../postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md),
and the first and third bullets of *Recorded, not built* in
[260905_2105](../user-feedback/260905_2105-debate-and-glossary-did-not-finish.md).

## What done looks like

- A reader who hits a **permanent** refusal is told it is a fault that has been recorded, and is
  **not** offered a button that will spend another model call to fail identically.
- A reader who hits a **moved-base conflict** still gets the retry, because for them retrying
  genuinely works: something else published while their draft was being written, and starting again
  from what is there is exactly the remedy.
- A red test first, for **both** branches, watched failing before anything is fixed.
- The same defect in a second file — `src/pdf-read.ts:782`, a bare
  `new Error("OPENROUTER_API_KEY is not set — …")` flowing into the retryable path — given an
  explicit permanent reason, with its own red-then-green regression test.
- The convention *tightening an invariant over stored data is a migration* written down where
  conventions of that kind live, and linked from the postmortem.

## What is already there, and is doing the work

Almost all of the machinery exists. This change is small because it plugs
`PublishRefused` into seams that are already load-bearing:

- [`src/messages.ts`](../../src/messages.ts) — `FailureKind` is `retry | ours | bug | blocked`,
  `RETRYABLE` says which offer a button, `CODE_KINDS` maps a registered bracketed code to a kind,
  and `stepGaveUp` writes the four generic sentences.
- [`src/job-failure.ts`](../../src/job-failure.ts) — `failureKindOf(err)` reads a `failureKind`
  field off a thrown value, `readerFailureOf(err, step)` reads a `readerFailure` off it, and both
  fall back to `retry` when nobody said. `stageFailure` is how a stage sets them.
- [`src/jobs.ts`](../../src/jobs.ts) — `recordFailureKind(job, failureKindOf(err) ?? "retry")` and
  `endingSentence`, which appends `RETRY_IS_SAFE` or `RETRY_WILL_NOT_HELP` according to
  `jobWorthRetrying`. Both doors a refusal can come out of already consult these.

So `PublishRefused` does not need a new mechanism. It needs to **say which kind it is**, in the
field the existing seams already read.

## The design

### One discriminator, two values, on the constructor

```ts
export type RefusalKind = "permanent" | "transient";

export class PublishRefused extends Error {
  readonly status = 409;
  readonly reasons: readonly string[];
  /** For monitoring — see § What Sentry gets. */
  readonly code: string | undefined;
  /** Read by failureKindOf / readerFailureOf in src/job-failure.ts. */
  readonly failureKind: FailureKind;
  readonly readerFailure: ReaderFacingFailure;
  constructor(slug: string, refusal: RefusalKind, reasons: readonly string[]) { … }
}
```

**Required, not defaulted**, and positioned second so every existing call site is a compile error
until somebody has decided. That is the *let the types catch it* rule in `CLAUDE.md`, and it is
worth the eight edits: a default would silently give the next throw site whichever answer happened
to be safer to type.

**`refusal` is not kept as a field.** ⟨Sol⟩ The discriminator's job is done at the throw site, and
`failureKind` and `code` are already two copies of the answer; a third would be state nothing reads.

`refusal` is not `FailureKind` and must not be collapsed into it. `FailureKind` answers *what should
the card do*; `refusal` answers *is this door ever going to open*. The mapping is one line and lives
in the constructor:

| `refusal` | `failureKind` | reader sentence |
|---|---|---|
| `permanent` | `bug` | `PUBLICATION_REFUSED`, `[jb-publish-refused]` |
| `transient` | `retry` | `PUBLICATION_MOVED_ON`, `[jb-publish-moved]` |

### Two kinds only — what was deliberately not built

The postmortem's list could support an eight-member enum: no blocks, no tree, tree problems, no
hierarchy run, hierarchy running, hierarchy errored, hash mismatch, moved base, reserved slug,
slug taken, no such article, wrong article, already published. **None of that is built.** Every one
of those is a diagnostic sentence already, and it already reaches the log through `err.reasons`
(`src/jobs.ts` § `endAsStorageFailure`). What no caller could get was the single bit that decides
whether to charge the reader again, so that is the only bit added. Per-reason reader copy would be
thirteen sentences nobody asked for, twelve of which say the same thing.

### Classifying the existing eight throw sites

| site | `refusal` | why |
|---|---|---|
| `pg-revisions.ts` § `lockOrCreateArticle`, reserved slug | `permanent` | the slug is the request; it will be refused identically for ever |
| `lockOrCreateArticle`, slug belongs to another reader | `permanent` | a known limit of the install, not a blip |
| `publishRevisionIn`, there is no such article | `permanent` | the row is gone; publishing cannot make one |
| `publishRevisionIn`, revision does not exist | `permanent` | same |
| `publishRevisionIn`, revision belongs to another article | `permanent` | same |
| `publishRevisionIn`, revision is already `published`/`failed` | `permanent` | see below |
| `publishRevisionIn`, moved base | `transient` | **the case the brief names**: something published under this draft, and starting again from what is there is the remedy |
| `publishRevisionIn`, `reasonsNotToPublish` | **both** — `permanent` when the input was carried forward, `transient` otherwise | see § The one site that is not a constant, below |

**`revision ${id} is already ${status}` was written `transient` first, and Sol's review of this plan
turned it round.** The transient reading was that a retry mints a fresh draft — `openOrBeginJobDraft`
replaces a recorded pointer whose revision is no longer a `draft` — so the next attempt gets past
the line. True, and the wrong question. Reaching it at all means the lifecycle is in the state that
path exists to prevent, and both ways in are the harm this change is about: if the revision is
already `published`, a retry buys a second model call for work **already on the shelf**; if it is
`failed`, something settled the draft under a live claim. The classification was also inconsistent
with its own two neighbours — a missing revision can equally be re-minted by a new job, and that one
is `permanent` — and `PUBLICATION_MOVED_ON`'s sentence, *something else finished while this was
working*, is simply false here. The cost is stated rather than hidden: one withheld button, on a
state nothing ordinary produces.

### The one site that is not a constant

**`reasonsNotToPublish` was `permanent` for every reason, and Sol's review of the code turned that
round too — this time on a mechanism the plan had simply got wrong.**

The plan's argument was: every reason there is about an artefact an earlier step wrote, and Retry
skips every step that finished, so a retry reads the identical rows back. The second clause is true
and the conclusion does not follow. **A failed attempt's draft is discarded and its artefacts go
with it**, so the next attempt's freshness checks find nothing and correctly re-run
([ingest-queue.md § What makes a failure permanent](../project/ingest-queue.md)). The case that
makes it expensive is a **first ingest** whose `hierarchy` draws a tree `checkTree` rejects: there
is no base, nothing is carried, nothing is copied forward, and the next draw may well be sound —
while `permanent` would withhold the button *and* `retryJob`'s own gate (it refuses a job
`jobWorthRetrying` says no to), leaving the reader no route to that article at all. That is the
worse of the two mistakes, and it was one line from shipping.

The honest distinction is one the function **already computes**: `publicationInputUnchanged`, the
boolean that drives the carried-forward exemption.

> **A refusal about input this draft *carried* cannot come out differently; a refusal about input it
> *made* can.**

- **Carried** — blocks and tree are exactly the base's. The next attempt mints a fresh draft off the
  same base, and `beginDraftIn` copies `revision_blocks` *and* `revision_step_runs` — `status` and
  `input_hash` included — so it meets the identical refusal. That is a **permanently wedged
  article**: every mode refused, for ever, at a model call a go. `checkTree`'s own problems are
  exempted before they reach the throw when the input is carried, but the `hierarchy` run's status
  and hash are not, and a poisoned run row on the base wedges an article exactly as a poisoned tree
  did. This is the `nagel-bat` shape and it is what `bug` is for.
- **Not carried** — the draft built or altered the pair, so another go is a fresh draw. `retry`.

One boolean, two kinds, no enum, and the two store-level tests differ in exactly that boolean.

The postmortem's workaround — *re-run the `hierarchy` step* — is a **re-run**, not a retry, and the
two are different (`stageFailure` § *Claiming a kind that is not `retry`*). A `bug`-kinded failure
is what gets somebody to go and do it.

### What Sentry gets, and the code that is deliberately **not** appended

Postmortem item 3 asks for *"enough of a bracketed code to survive `sanitise` and reach Sentry,
without the prose"*. There is a trap here that the codebase has already fallen into once.

`authored` in [`src/monitoring-scrub.ts`](../../src/monitoring-scrub.ts) does **not** ask *is there
a code*; it treats a registered code as **proof that we wrote the whole string**, and then
`sanitise` forwards the message verbatim. `PublishRefused.message` is
`Refusing to publish "<slug>": <reasons>` — and the slug is a path segment derived from the
article's own **title**, while `reasons` is an unrestricted `string[]` any future caller may fill
from anywhere. **So appending `[jb-publish-refused]` to `err.message` would sell that certificate to
all of it** — the identical mistake that lived in `stageFailure` for six hours on 2026-09-03,
written up in `src/job-failure.ts` § *The detail goes on verbatim*.

> **The first draft of this argument rested on a false premise, and Sol caught it.** It said a
> `checkTree` *reason* can quote a nav label. It cannot: `src/tree-invariants.ts` routes the
> nav-label complaint through `warn` into `advice`, and states as an invariant that no `problems`
> string carries article prose. The postmortem and this brief both repeat the claim; it is the
> conclusion that survives, not the evidence, and a note resting on a false premise is one somebody
> disproves and then deletes.

So:

- `PublishRefused.message` stays exactly as it is — free-text diagnostic, log only, withheld from
  Sentry, which is correct.
- The bracketed code goes on the **reader's** sentence, which is authored copy with no
  interpolation, carried on `readerFailure` where `readerFailureOf` will find it. That is the
  copy.md-shaped half of item 3.
- The **monitoring** half is a `readonly code` property. `SAFE_PROPS` in `monitoring-scrub.ts`
  already forwards `code` as a Sentry tag, and `SAFE_ERROR_PROPS` in `src/log.ts` puts it on the log
  line — a fixed slug of our own, no prose, no interpolation. So a `PublishRefused` in Sentry stops
  being an indistinguishable `message_withheld: True` stack and starts carrying
  `code=jb-publish-refused`, which is the thing that would have made two occurrences read as *one
  article permanently off the air* rather than as noise.

Two registered codes, both `jb-` because a job is what failed (copy.md § *The prefix says which
thing failed*):

- `[jb-publish-refused]` → `bug`
- `[jb-publish-moved]` → `retry`

`tests/messages.test.ts` round-trips every message in `src/messages.ts` through `kindOfMessage` and
asserts `CODE_KINDS`' keys are exactly the codes the file's messages carry, so both halves are
enforced rather than remembered.

### `src/pdf-read.ts:782`

```ts
if (!key) throw new Error("OPENROUTER_API_KEY is not set — see docs/project/setup-dev.md.");
```

A missing API key is a permanent misconfiguration, and a bare `Error` carries no kind — so
`failureKindOf` returns `undefined`, `readerFailureOf` falls back to `retry`, and the reader is
offered a button that starts a PDF read which cannot call a model. `NOT_CONFIGURED`
(`src/messages.ts`, kind `ours`, `[ai-not-set-up]`) is already the right sentence and already says
*"It needs somebody with access to finish setting it up; trying again will not help"* —
`src/anthropic-call.ts:103` is the existing precedent. The fix is one line:

```ts
if (!key)
  throw stageFailure(NOT_CONFIGURED, {
    authored: "OPENROUTER_API_KEY is not set — see docs/project/setup-dev.md.",
  });
```

`{ authored }` is honest here: every character is ours, nothing is interpolated, so the diagnostic
reaches Sentry as well as the log.

`ours` rather than `bug`, because `ours` is *this app is misconfigured, stop and tell somebody* —
which is precisely what a missing key is — and both withhold the button.

### The convention

> **Tightening an invariant over stored data is a migration.** Sweep the rows in the same commit,
> or say in the commit message why not.

**It was already written down, and nobody could find it** — ⟨Sol⟩ one sentence at the end of a
paragraph about the publication gate in [database.md](../project/database.md), inside a section
about the store's history. That is a fact with a home and no address. It becomes its own section in
the same file, the buried sentence becomes a link to it, and the postmortem links there too. One
home, and one that can be cited.

## Deferred, named rather than inherited

**A preflight, so the money is not spent before the gate is consulted.** This is the second bullet
of *Recorded, not built*, and it is **not** built here. `reasonsNotToPublish` runs against a draft
that already holds the step's output; consulting it before the model call would need the step's
planned **write set** — otherwise the gate would refuse on the strength of an inherited tree and
block the very `hierarchy` step whose job is to repair it. That is a real design question about how
a step declares what it intends to write, and it is not a line of code. Left for its own plan.

**Per-reason reader copy.** See § *Two kinds only* above.

**A sweep of the stored trees.** The producer was fixed on 2026-09-05 and the publication gate now
exempts a carried-forward tree, so a bad rung is reported rather than fatal. Migrating the rows is
still the right thing under the new convention, and it is a separate change with its own risk to
real reader data — `CLAUDE.md` § *Real data belongs to the reader*.

## Stages

1. **Red tests.** `tests/store-publish-guards.test.ts` gains two cases — a carried-forward *changed*
   tree (permanent) and a moved base (transient) — asserting the kind, the `failureKind` that
   `failureKindOf` reports, and `readerFailureOf`'s sentence by **code**, not by prose (copy.md).
   A third, in `tests/pdf-read*.test.ts` or a new file, for the missing key. Watch all three fail.
2. **Implement.** `src/messages.ts` (two messages, two `CODE_KINDS` rows), `src/store/pg-revisions.ts`
   (the class and the eleven call sites), `src/pdf-read.ts` (one line). `src/jobs.ts` is expected to
   need **no change at all** — that is the point of plugging into the existing seams — and any edit
   there stays targeted, because another session owns that file later tonight.
3. **Docs.** The convention in `database.md`, a link from the postmortem, and a line in
   `docs/project/ingest-queue.md` if it describes the failures Retry is not offered under.
4. **Review.** GPT Sol on the plan, and again on the diff. `npm test`, `npm run typecheck`,
   `npm run check`.

## Assumptions, since there is nobody to ask

- **Nothing outside this repo constructs `PublishRefused`.** Eight throw sites, all in
  `src/store/pg-revisions.ts` — two in `lockOrCreateArticle`, six in `publishRevisionIn` — plus one
  construction in `tests/step-failure-seam.test.ts`.
- **`code` is free on `PublishRefused`.** Verified rather than assumed, and Sol re-checked it:
  `guardDbStore` lets anything carrying a numeric `status` through before it interprets database
  codes, SQLSTATE recognition takes exactly five uppercase alphanumerics so `jb-publish-refused`
  cannot masquerade as one, `src/routes.ts` checks `status` before its `ENOENT` fallback, and
  `src/log.ts` forwards `code` only as an allowlisted field.
- **`refusal` rather than `kind`** as the parameter name, because `kind` is already `FailureKind`'s
  word three files away, and two meanings of `kind` on one error is how the next reader gets it
  wrong.
- **A class declaring `failureKind` and `readerFailure` is the intended use of that seam, not an
  abuse of it.** ⟨Sol⟩ `KindedError`'s "nothing outside this file should read the property" binds
  *consumers*, who must go through `failureKindOf` / `readerFailureOf`; `TooLongForOnePass`
  (`src/token-budget.ts`) is the precedent for a typed error declaring the fields itself, including
  why `stageFailure` is not the answer when the class is `instanceof`-significant.

## What Sol's plan review changed, in order

1. **`already ${status}` flipped to `permanent`** — § Classifying, above. The one High finding.
2. **The nav-label premise was wrong** — § What Sentry gets. The design stands; its evidence did not.
3. **The tests did not prove the persisted door.** `readerFailureOf` and `failureKindOf` on a
   hand-built error prove the error's shape, not the row. `endAsStorageFailure` never reads
   `readerFailure` — it writes `COULD_NOT_PUBLISH` and then appends *"Trying again is safe"* or
   *"Trying again will not help"* from `jobWorthRetrying`, so that clause is where the outage's
   false promise physically lived. `tests/step-failure-seam.test.ts` now pins the persisted
   `failure_kind` column and the clause, and its `persisted()` helper had to start selecting the
   column at all.
4. **Eight throw sites, not eleven**, and the convention already existed.
5. **`readonly refusal` dropped**, as unread state.

**One finding not taken.** Sol called the `ingest-queue.md` edit speculative and suggested cutting
it. It is not speculative: that file owns § *The failures Retry is not offered under*, whose
two-column table is precisely the list of what can and cannot come out differently, and the
publication door was missing from it — two rows and a short paragraph, in the doc that owns the
fact.

## What Sol's code review changed, in order

The second review, weighted higher, and it earned the weighting: its top finding was a bug the plan
review could not have found, because the wrong reasoning had not been written down as code yet.

1. **`reasonsNotToPublish` was `permanent` for every reason, and that would have cost a reader an
   article.** § The one site that is not a constant, above. It is now the carried-forward boolean,
   and both branches have a store-level test that differs in nothing else.
2. **The two `lockOrCreateArticle` refusals cannot persist their new kind** — recorded, not fixed,
   see § Known limits below.
3. **`PUBLICATION_REFUSED` overclaimed.** It opened *"This finished its work"*, false for the two
   refusals raised while the draft is being *opened*, before any step runs; and promised *"Nothing
   was published and your library is unchanged"*, false for the branch refusing a revision that is
   *already published*. One sentence standing in for eight throw sites may claim only what is true
   at all of them. Reworded.
4. **The PDF test did not test its own `{ authored }` claim.** Both new cases stayed green under
   the bare-string form of `stageFailure`, which changes exactly one thing — `sanitise` withholds
   the diagnostic — and neither looked at `sanitise`. A third case drives it, and the mutation
   reddens two.
5. **The nav-label premise had propagated.** Corrected in `src/messages.ts`, `tests/job-failure.test.ts`,
   the postmortem and the feedback note, so the false evidence does not outlive the review that
   disproved it.

## Known limits, recorded rather than fixed

**A refusal raised while the draft is being opened never records its kind.** ⟨Sol⟩ When
`lockOrCreateArticle` refuses — a reserved slug, or one that belongs to another reader —
`src/jobs.ts`'s recovery obtains a session by calling the same operation again, which throws the
same refusal, so `endAsStorageFailure` is never entered. No `failure_kind` is stored, the `/advance`
request escapes as a raw 409, the job stays `running`, and `settleExpired` eventually ends it as a
retryable `INTERRUPTED`. Neither the kind nor the `code` reaches anything.

Not fixed here, for two reasons. It is a **pre-existing** property of that recovery — the comment
above it already says *"when it fails too, the original goes out, and that is the honest answer"* —
rather than anything this change introduced; and repairing it means editing `src/jobs.ts`, which
another session owns tonight, for two branches Sol judges unreachable through today's allocation
checks (`enqueue` answers 404 for a slug this reader does not own, and `isReservedSlug` is checked
at minting). What the classification does buy on those branches is correctness the day they *are*
reached by a legacy, raced or internally constructed job — the kind is right at the throw, and only
the recording of it is missing.
