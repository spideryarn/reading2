# Sweep the defects we recorded rather than fixed

Greg, 2026-09-03, after the quiz band-spread postmortem
([260903c](../postmortems/260903c-quiz-band-quota-refused-a-good-batch-and-its-error-reached-the-reader.md)):

> One thing worth carrying forward from the postmortem, since it applies beyond this bug:
> `truncatedMessage` was correctly diagnosed, written up, and deliberately left — and the identical
> mistake was made eight days later by someone who could have read that note. **A written-down defect
> with an unchanged default is a defect with a paper trail, not a mitigation.** There are a few other
> "recorded rather than fixed" notes in the docs; they're probably worth a sweep at some point.

## The job

Two halves, and the second is the one that matters.

1. **Find and fix** the other places where this tree records a defect and leaves it in place.
2. **Decide what, if anything, to build** so that the next deferral cannot be a sentence — and be
   willing to conclude the answer is "nothing".

## What is already known before the sweep starts

**The class was already named, one day earlier, and it did not hold.**
[260902e](../postmortems/260902e-a-comment-that-named-the-latent-hole-and-left-it-latent.md) ends:

> the moment you write "the same problem exists over there", you have done the hard part — finding
> it — and stopped one step short.

That postmortem's own recommendation *was* built, and built well:
`tests/routes.test.ts` § "no PATCH route answers a malformed body with a 500" is table-driven over
seven routes. So this repo does act on its postmortems. The question is which recommendations it
drops, and whether the ones it drops share a shape.

**There is a reusable doc for the sibling class**, and it is a good one:
[written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) — prose that is *wrong*.
This class is the opposite and arguably worse: **the prose is right, and being right is what makes
it look handled.** `copy.md` described the leak accurately for eight days.

**This plan's own parent postmortem has a "Still open" section with three items.** Writing the
sweep while leaving those is the failure mode, in this document, today.

## The design question, and Fable's answer

Asked whether to build (A) a `docs/known-defects.md` register with a consistency test, (B) no
machinery — just fix things and change the writing convention, or (C) something else.

Fable's verdict was **(C), smaller than either**, and it reframed the problem in a way I accept:
*"recorded-not-fixed" is not one class, it is three shapes, and only one is helped by a marker.*

1. **A cheap sibling left unfixed** (the PATCH `null` body). Nothing needed recording — the author
   needed to finish. What worked was the genre test in the same commit.
2. **A wrong default, correctly diagnosed as structural** (`truncatedMessage`). *A register cannot
   touch this one.* The quiz author did not fail to find a note; they wrote fresh code that fell into
   the default, and **fresh code consults nothing**. What retired it was Stage 2 making the
   undeclared case safe. The lesson is not "record it better" — it is that **a wrong default is not a
   deferrable defect, because it re-creates itself.**
3. **A deferral with a named trigger** (the quiz cap: "watch for `dropped.overCap` non-zero on a run
   that also failed on bands"). The trigger is prose.

On the register, which I also leaned against: it is the disease, and for a sharper reason than
"it relieves pressure" —

> A register makes recording the *sanctioned endpoint* of finding a bug. It institutionalises the
> exact substitution the postmortems describe.

and it fails on shape 2, the case that motivated it, because that recurrence path never reads any
doc.

### The rule that replaces it — Fable's version, then Sol's correction

Fable proposed **a deferral must leave behind something that runs**, in two forms: a `DEFECT:`-named
test pinning today's behaviour, or an observable trigger. It flagged its own weakness — a pinned test
is *pressure-neutral*, firing when the defect is **fixed** rather than when it **matters**.

**Sol rejected the pinned test outright, and its argument is stronger than the weakness Fable
conceded:**

> It remains green while the defect harms readers. It goes red when somebody fixes the defect. It
> converts a known defect into suite-approved expected behaviour. That is not merely
> pressure-neutral; it risks **normalising** the defect.

That is decisive, and the `DEFECT:` convention is dropped. Sol's replacement:

> A deferred live defect must either be **fixed**, be **explicitly accepted as a product
> limitation**, or emit a **harm-coupled signal into a channel with a named consumer and action**.

with three qualifications worth more than the rule itself:

- **A log line is not observable merely because it exists.** (This retires half of Fable's second
  form, and it is the exact reason `src/pipeline.ts:1736`'s "one query away" fallback fails.)
- A Sentry breadcrumb may never be seen unless another event occurs.
- **The signal must correspond to the harmful consequence, not to a proxy for it.**

Vitest's `test.fails` was separately considered and rejected — it passes on *any* throw, so a test
failing for an unrelated reason still reports the defect as pinned
([silent-success.md](../reusable/silent-success.md)).

### And no new machinery yet

Sol's scope verdict, which I accept and which supersedes the convention half of this plan:

> For this alpha, I would build **no new universal machinery yet**. Fix the confirmed defects,
> distinguish defects from accepted limitations in postmortems, and revisit tooling only after two or
> three real deferrals reveal a common executable shape.

So Stage 4's `docs/reusable/` edits are **dropped**, not merely deferred for approval. Two models
independently talked this plan out of building a mechanism, by different routes, and the second
falsified the first's replacement. That is the finding: **there is no cheap general control here, and
three separate attempts to invent one produced a register, a convention, and a normalising test.**

### Fable's census was not reliable, and that is itself evidence

Of the four code sites it named, two were **already fixed** and say so in the same sentence —
`src/openrouter-stream.ts:289` ("Latent rather than live today … and **fixed** because the next
caller will not know that") and `src/jobs.ts:872` ("`computed` was dropped here **until
2026-09-02**"). A scanner reads "latent" and "was dropped" as live deferrals. This is a second,
independent argument against any grep-driven register: **the corpus it would index is mostly
history.**

## What the evidence actually said, and how it changed the job

Three trawls: `docs/project/` + `docs/reusable/`, the 57 postmortems' preventions against the code,
and the source comments.

**The postmortem audit proposed a mechanism, and GPT Sol falsified it. Both are recorded here,
because the retraction is more useful than the claim was.**

The audit reported that of ~50 postmortems recommending a prevention, the **top-ranked one was built
in about 44**, and concluded the failure is *positional* — "top item lands, everything below it does
not; an item a postmortem itself marked as deferred has essentially never landed."

**Sol spot-checked four postmortems and got a mixed picture, not a positional one.** The decisive
counterexample is `260901d`, which the audit had cited as its own strongest evidence: **#1 is open,
#3 landed, #4 is open** — a lower recommendation landing while the top one did not, which is the
inverse of the claim. `260902c-laptop` landed all five. `260903c-cache` has all five open.

What survives: **"the first recommendation often lands"** is plausible. **"The failure is
positional"** and **"deferred items essentially never land"** are not established, and the rule I drew
from them — *do items 2-and-below in the same commit or not at all* — does not follow. Establishing
it properly would need the full census preserved with explicit definitions of "recommendation",
"top-ranked", "built" and a follow-up cutoff. That is not this plan's job, and the claim is withdrawn
rather than weakened.

Sol also caught the plan contradicting itself on this point: Stage 2 proposed `260830d`'s
*lower-ranked* test-count guard while that postmortem's two named long-term fixes remain open —
`src/web/params.ts:26` still value-imports component modules.

**What this means for the job:** there is no clever positional intervention to build. There is a list
of real defects, and fixing them is the work.

Two further findings worth carrying:

- **The class is the corpus's most-repeated finding.** Ten postmortems name it. It already has a
  reusable doc, `written-down-is-not-checked.md`, written *before* four of those recurred against it.
  `260902b` had already drawn the conclusion this plan reaches: *"the prevention cannot be another
  paragraph… The only prevention that works here is mechanical."*
- **Naming the class does not confer immunity.** `260902c-claude`: *"the first version of this check
  made the same mistake it was written to catch."* `260903c-cache`: *"The fix for the previous
  instance of this class introduced this one."* This plan should expect to contain an instance of its
  own subject.

**One reported finding, recorded properly rather than explained away.** The audit flagged
`tests/step-failure-seam.test.ts` as order-dependent. Sol then reported it failing 5-of-7 in its own
sandbox. The first draft of this plan said "contention is the likeliest explanation" — Sol was right
that asserting that was this plan's own anti-pattern, so here is the evidence instead.

- **Worktree** `worktree-recorded-not-fixed`, merged to `origin/dev` at `c43cf551`. Local Supabase up,
  `data/` writable.
- `npx vitest run tests/step-failure-seam.test.ts` → **7 passed**.
- The same, plus `article-cache-group`, `token-budget`, `store-seams-have-two-implementations` — the
  exact combination reported → **44 passed**.
- `REQUIRE_POSTGRES=1 npx vitest run …`, which is how `scripts/check.ts:108` runs the gate →
  **7 passed**.
- Sol's run: **5 failed, 2 passed**, in a harness that by its own statement **cannot write to the
  checkout**. Its five failures are all consistent with a store that cannot persist — two are "no
  file on disk for job" outright, and the three semantic ones (a declared `MODEL_REFUSED` returning
  the generic sentence, `failureKind: "blocked"` reading back `undefined`, a stopped run ending
  `"error"` rather than `"cancelled"`) are what reading back an absent record produces.

**Unresolved, and a real finding regardless of the flake:** the test reads `data/` directly at
`tests/step-failure-seam.test.ts:109` while driving the store through public `enqueue`/`getJob`. The
comment gives a good reason — under the filesystem store `getJob` returns a `structuredClone` of the
in-memory index, so asserting against it would assert about the object this process just built. But
that makes the test non-hermetic and couples it to one store. It passes under `REQUIRE_POSTGRES=1`
today; **why** it passes has not been established, and a guard whose mechanism is not understood is
one nobody will trust the next time it goes red.

## Final scope, after Greg's review and Sol's

Greg, 2026-09-03, on being shown the twelve-item version: *"It seems like a lot!?"* — and he was
right. Sol independently cut it to roughly the same set. **What is actually being built is five
fixes**, dispatched in parallel to Opus subagents on disjoint file sets:

| | File | Why it is worth doing |
| --- | --- | --- |
| 1 | `scripts/db-export.ts` | The rollback script silently exports the wrong database |
| 2 | `src/pdf-read.ts` | A crash mid-write loses a PDF's provenance for every later run |
| 3 | `src/store/pg-comments.ts` | One line; consistency and defence in depth |
| 4 | `src/quiz.ts` + `260827b` | An invisible trigger, and a stale "not built" note |
| 5 | `src/web/App.tsx` + `styles.css` | A 12px band where the mode panel covers the prose |

Everything else in the stages below is **withdrawn, dropped, or moved out**, each with its reason in
place. The withdrawn items are struck through rather than deleted: this plan's subject is what happens
when a defect's record and its resolution drift apart, so its own retractions stay legible.

**And the biggest finding is not in that table.** Content extraction silently dropping headings,
tables and math is larger than everything above put together, and it gets its own named plan rather
than a line in a queue.

## Stages

Each ends green and committable. Ordered so that the substance lands before the convention, because
a convention shipped ahead of the fixes would be this plan committing its own subject.

### Stage 1 — finish the genres

Every item here is a defect **whose fix already exists elsewhere in this tree** and was applied to
the siblings and not to this one. That is 260902e's shape exactly: the hard part — finding it — is
done, and somebody stopped one step short. Each fix is small; the value is that they are live.

1. **`scripts/db-export.ts` has the `DATABASE_URL` trap, and it is the rollback script.**
   Six of eleven `db-*.ts` call `resolveTargetUrl()` and print a `Target:` line; this one calls only
   `loadEnvLocal()`. Point it at the remote to take a pre-incident backup and it silently exports the
   laptop's stale local database, printing success throughout. `database.md:985` names `db:export` as
   sharing the trap in as many words. Sharpest detail: its own header carefully refuses to overwrite
   `data/` by accident — it worries about writing to the wrong *place* and never about reading from
   the wrong *database*. **Grep the whole genre**, including the four other `db-*.ts` at zero.
2. **`pgCommentStore` is not guarded at its export** — `260901d`'s #1, self-labelled *"Not done
   here"*. `src/store/pg-comments.ts:127` exports a raw object literal; `pg-jobs.ts:1319` and
   `pg-uploads.ts:240` wrap theirs in `guardDbStore`.
   **Severity corrected downwards, by me, against the audit that raised it.** The audit said reader
   409s and 404s arrive as 500s today. They do not: `src/store/index.ts:354` wraps it at the
   composition root, `CommentIdTaken` carries `readonly status = 409`, and `mayPassThrough` returns
   true for any error with a numeric `status`. The audit checked that `pg-comments.ts` lacked the
   wrapper and never checked whether the composition root supplied it. **This is defence in depth and
   a consistency fix, not a live reader bug** — the value is that a future caller importing
   `pgCommentStore` directly gets no guard, and that `tests/store-comments.test.ts` currently asserts
   against a different object from the one production builds. One line. Keep it; do not oversell it.
   **It was not one line, and the second line was the interesting one.** The store then arrives at
   the composition root already wrapped, and a second wrapper is not a no-op — `scrubDbError` has
   nothing to copy an *errno* onto, so `ECONNRESET` stops answering `isTransient` and the reader's
   *"try again"* becomes *"a bug"*, which `src/jobs.ts` persists as `bug` and which removes the Retry
   button. The first fix asked `isGuardedStore` inside `guarded()` (`src/store/index.ts`);
   [Sol's review](260903e-stage1-review-sol.md) finding 2 pointed out that this protects one
   composition path and leaves every other caller able to double-wrap, so **`guardDbStore` itself is
   now idempotent** and `guarded()` is back to its one-line form. Sol also rejected the alternative
   of copying a raw errno onto `.code`: it collides with the `ENOENT`/route-404 reading that
   `db-errors.ts` already warns about.
3. **`src/pdf-read.ts:1524` — any non-empty bytes count as done.** The emblematic instance:
   `260828e` wrote *"Left alone on purpose… the clearest evidence available that the rule above wants
   to be a rule and not a fix"* — six days ago, same file, unchanged. A crash mid-write leaves a
   truncated `raw.json` that the guard reads as "already done" for ever after, so the object never
   reaches the bucket.
   **Severity corrected downwards after Sol's review of the built code**, and the correction belongs
   in the record: this first said "a permanent trap: an article that can never be read again". Wrong
   twice over — `readRaw`'s `null` stopped meaning *assume HTML* on 2026-08-31, and the run that hits
   this still extracts from bytes it holds in memory. What is actually lost is **provenance on every
   later run**: `articleMetadata` can no longer say where the document came from. A permanent quiet
   loss, but of the source record rather than the article.
   **And the overstatement was mine rather than inherited**, which is worth getting right in a
   document about unchecked claims. I first wrote that I had taken it from `260828e`'s title — but
   that title is about the *chunk cache*, a different artefact, and its body says of **this**
   instance, in as many words: *"it is a silent wrong rather than a permanent trap."* The source was
   more careful than the summary of it. That is the ordinary way a claim inflates: not by anyone
   lying, but by a second writer compressing a hedge out of a sentence they did not re-read.
4. **~~`recentHistory`'s `usable()` filters `interrupted` and never `stopped`.~~ Withdrawn — see
   below.** Kept in the plan rather than deleted, because it is the plan's own instance of its
   subject and deleting it would hide that.
5. **~~Five SSE hooks leak the connection on unmount.~~ Moved out — a lifecycle audit, not a chore.**
   The count is right (`useCriteria`, `useClaims`, `useComments`, `useSearch`, `useChat` hold no
   `AbortController`; `useMirror` and `useQuiz` do), but Sol showed they are not one omission:
   **`src/web/useChat.ts:357` says the controller and stream outlive the hook on purpose, so a pending
   stop still reaches the server** — aborting on unmount would reverse documented behaviour.
   `useClaims` prevents stale writes while letting the old stream run, which is a third decision
   again. Each needs deciding individually, after answering "which streams should survive panel
   closure", and that is its own piece of work. **Third trawl false positive in this stage.**
6. **`src/web/layout.ts:482` — a 12px band where JS and CSS disagree.** With `?spine=0`, `fitMode()`'s
   crossover (832) and `styles.css:10824`'s hard-coded `@media (max-width: 843px)` fall on opposite
   sides between 832 and 843px: the function hands the band 288–299px and squeezes the table to make
   room, while the stylesheet widens the same band to the whole window and lays it over the article it
   just made space for. Measured, not reasoned. Ordinary desktop widths.
   **Do not fix this by spreading `proseBeside`.** Exactly one component takes it
   (`App.tsx:2815` → `OutlinePanel`), and the comment forbids extending that pattern: *"deliberately
   not with a fourth hand-copied breakpoint — a second conditional query would be a third thing to
   keep in step, and the whole reason `tests/spine-width.test.ts` exists is that there are already too
   many."* The named fix is to stop the stylesheet guessing — `App.tsx` already writes `--mode-w` from
   `fit.modeW`, so it writes the *fact* as a class or data attribute derived from `fit.modeW === 0`
   and the covering rules key off that instead of off a width. That deletes a moving part rather than
   adding one, and it retires the genre instead of extending it. **Needs a real browser check**, in a
   Sonnet subagent, at 830/838/845px with and without `?spine=0`.

### ~~Stage 2 — the cheap gates that were recommended and never built~~ — dropped

Three guards proposed, all three dropped on review, and the reasoning is worth keeping because two of
them looked obviously right to me.

1. **~~A repo-wide conflict-marker check~~** (`260903b` #3, *"the widest fix, and the one not yet
   done"*). Sol: this belongs in a small tooling plan rather than bolted onto a defect sweep. Fair —
   it is a new gate, and new gates are the machinery this plan already decided not to add on impulse.
2. **~~A guard on the count of collected tests~~** (`260830d`). Sol argued an exact count is
   maintenance tax and that the real fix is the import chain the same postmortem named — and then
   caught the plan contradicting itself, since I was proposing that postmortem's *lower-ranked* item
   while its two named long-term fixes stay open (`src/web/params.ts:26` still value-imports
   component modules). Dropping it.
3. **~~Fail the lint gate when biome discards its own config~~** (`linting.md:101`). Same tooling-plan
   argument. The detection command is written down in the doc and still unwired, so this remains a
   genuine live instance of the class — recorded here honestly rather than pretended away.

### Stage 3 — make the surviving deferrals leave something that runs

Not "record them better" — give each an executable form, per the rule above, and delete the ones that
cannot have one.

1. **The quiz cap's trigger is invisible at the point it fires.** `src/quiz.ts:517` defers the bug
   and says to watch for `dropped.overCap` non-zero on a run that also failed on bands. The
   spread-gate diagnostic 130 lines below reports easy/medium/hard counts and **not `overCap`**. One
   field. This comment is mine, from yesterday, which is the plan containing its own subject as
   predicted.
2. **Partial block-id loss is not flagged, and the block ids are the one contract.**
   `src/pipeline.ts:1736`: *"A partial loss — 5 of 139 survive — is just as real and is still not
   flagged, because any cutoff would be a guess and a guessed alarm gets ignored… so that case is
   one query away instead."* The reasoning against a threshold is **right** and I am not proposing
   one. What is wrong is the mitigation: a query nobody runs, offered three lines below the same
   comment's own verdict that *"a line in a log nobody is tailing is not a defence."*
   My proposal was that a partial loss is a **fact, not a threshold** — `carried < before.size` needs
   no cutoff — so surface it. **Sol showed that is still the wrong signal**, and gave the right one:

   > `carried < before.size` is an objective fact. It is **not objectively a defect.** A legitimate
   > article edit, deleted paragraph, changed extraction result, or substantially rewritten block can
   > all remove an old ID.

   A generic alarm on partial loss would fire on every ordinary article change and become noise —
   which is what the original comment was protecting against, so the comment was more right than I
   gave it credit for. The threshold-free policy that *is* correct couples the signal to the harm:

   1. Compute the old ids absent from the candidate revision.
   2. **Intersect them with ids actually referenced by persisted reader data** — comments, notes,
      highlights, questions.
   3. Empty intersection → publish, and keep the carried/minted measurement.
   4. One or more real reader anchors would detach → refuse automatic publication and surface which
      records are affected.

   No guessed percentage: **zero affected anchors versus at least one.** Sol also corrected my
   wording — this does not "destroy reader data"; the comment survives and *detaches* from current
   prose, and the distinction decides whether the answer is refusal or recovery UI.
   **This is a design stage of its own, not an item in this sweep.** If the anchor intersection turns
   out to be wider than it looks, the current behaviour stays until that design is ready.
3. **~~Pin the genuine remaining deferrals with `DEFECT:` tests.~~ Dropped** — the convention was
   rejected above.
   Its one candidate was falsified too: `src/collect-assets.ts:52` was reported as able to *"burst
   ~400 requests at one host"*. It cannot. There is a **process-global concurrency gate admitting
   two**, and the existing test already proves only two leave after the deadline and that the gate
   drains to zero. Up to 400 attempts *over time* is not a burst. As Sol put it, a pinned test here
   *"would institutionalise a defect that has not been demonstrated"* — which is the convention
   failing on the only example anyone offered for it.
4. **Correct the "not built" note that has gone stale in the safe direction.** `260827b` says the
   client env vars need *"a build-stamped sentinel, and that is not built"* — `scripts/build-stamp.ts:145`
   now refuses the build without them, tested. The mirror image of the class: prose recording an
   absence that has since been filled.

### Stage 4 — the postmortem, the docs, and the next plan

The convention is gone (see above), so what remains is:

1. **The postmortem** for the class itself, in `docs/postmortems/`. Its most useful content is not the
   class — ten postmortems already name that — but the three retractions this run produced: a
   positional theory that four spot-checks falsified, a register that fails on the case that
   motivated it, and a pinned-test convention that would normalise the defects it recorded.
2. **`docs/project/` updates** for everything the five fixes changed, in the same stage as the change.
3. **A named plan for content extraction**, because "top of the next sweep" is a paper deferral and
   that is the whole subject of this document.

No `docs/reusable/` edits. Nothing to approve.

## What actually landed

Five fixes, built in parallel on disjoint files, every diff read by me, then a GPT Sol review that
issued one **no-ship** and one **revise**. Both were acted on before anything was committed.

| | What shipped |
| --- | --- |
| `scripts/db-export.ts` | `resolveTargetUrl({ shellWins: true })` **and** `process.env.DATABASE_URL = url` — the assignment is the fix, because this script builds no pool and `src/db/client.ts:73` and `src/store/blobs.ts:318` read the variable for themselves. A sibling-shaped fix that only printed `Target:` would have announced one database and exported another. New `tests/db-export-target.test.ts` asserts a *downstream consumer* saw the value. The other four unresolved `db-*.ts` were each argued individually and none needs it. |
| `src/pdf-read.ts` | `alreadyKept()` parses and applies the shared `whyUnusable("raw", …)` check, so a truncated `raw.json` is treated as absent. Mutation-tested in both directions. The write is still not atomic, deliberately: the corruption is now self-healing rather than permanent. |
| `src/store/pg-comments.ts` | Guarded at its export. **This was not one line.** |
| `src/store/db-errors.ts` | `guardDbStore` is now **idempotent**, which is where the invariant belongs. |
| `src/quiz.ts` | `overCap` in the diagnostic, in the `{ authored }` channel so it reaches Sentry at all. |
| `src/web/App.tsx` + `styles.css` | `@media (max-width: 843px)` replaced by a `band-covers` class written from `fit.modeW === 0`. **The stylesheet stops deriving a fact it cannot see**, deleting a moving part rather than adding a fifth copy of a number. |

### The two things Sol stopped

**No-ship — the `overCap` diagnostic asserted a cause it cannot support.** It claimed a non-zero
count meant the deferred cap bug *"manufacturing this failure rather than the model"*. `overCap`
counts raw elements the loop **never examined**, which may be malformed, duplicate, unanchored or
another `medium`. Reproduced: twelve valid `easy` plus one malformed `{ band: "hard" }` gives
`overCap: 1`, `malformed: 0`, and a sentence blaming our own cap for a batch it cost nothing. **The
test could not have caught it** — it wrote `overCap: 4` into the counters by hand. It now overflows
the cap for real, and includes the junk-tail case asserting the diagnostic claims nothing. The
sentence says only what the number supports: how much of the answer went unread.

**Revise — idempotence was in the wrong place.** It went into `guarded()` at the composition root,
which protects one path and leaves every other caller able to double-wrap. Moved into `guardDbStore`
itself; `src/store/index.ts` is back to its one-line form. And the test named *"must not be wrapped
twice"* **deliberately wrapped twice and asserted the broken classification** — a characterization
test that would have stayed green if the fix were reverted. Replaced with a real regression test
(`toBe` identity, and `ECONNRESET` still `STORAGE_BUSY` after two wraps), watched red first.

Worth keeping: double-wrapping was never harmless, and `db-errors.ts` said it was. `scrubDbError`
copies a SQLSTATE onto the error it returns and has nothing to copy an **errno** onto, so a second
pass turned `STORAGE_BUSY` — *wait a few seconds* — into `STORAGE_FAILED` — *a bug; trying again will
not help* — which `src/jobs.ts` persists as `bug`, taking the Retry button off a connection blip.
Probing the obvious case misleads you, because the SQLSTATE cases *do* survive. Sol rejected copying
the errno through, and it was right: the wrapper being idempotent is cleaner than carrying transport
metadata on a scrubbed error.

### Left for Greg, not decided here

- **Two comment-store refusals changed meaning** once the tests met the guarded object:
  `needs the attempt` and `must end an answer` are plain `Error`s thrown before any query, so they now
  get the generic scrubbed sentence. **That was already true of every request production served** —
  only the test could not see it, because it imported the raw object. Whether they should carry a
  `status` and pass through changes reader-facing copy, so it is a product call.
- **`database.md`'s trap heading now overstates its own body**, and CLAUDE.md deep-links its anchor,
  so renaming it is one approved set under
  [edit-important-docs.md](../reusable/edit-important-docs.md).

## Six instances of the subject, produced while writing about the subject

Recorded together because the pattern is the finding. Nobody here lacked the knowledge; the class is
named in ten postmortems and two reusable docs, and it kept happening anyway.

1. **`src/quiz.ts`, mine, yesterday.** I wrote a comment saying the band-spread diagnostic *"goes to
   the log and to Sentry"*. It went only to the log. Measured this run: as free text the string is
   `withheld: true` and the numbers never arrive. A confident sentence about a channel I did not
   check.
2. **`src/quiz.ts`, mine, yesterday.** The deferral names `dropped.overCap` as the trigger to watch,
   and that number appeared nowhere in the only line that fires when it fires.
3. **This plan, Stage 1 item 4.** I proposed a one-line fix that a comment forty lines from the
   function forbids, because I trusted a subagent's report over the code — one section after writing
   down that a scanner cannot tell a live deferral from a settled decision.
4. **A subagent's own verification, this run.** It ran `npm test | tail -60`, read
   `[exited with code 0]`, and caught itself: that is `tail`'s status, not vitest's. This is
   [260831c](../postmortems/260831c-the-exit-status-that-belonged-to-tee.md), a postmortem this repo
   already has — and the same mistake I made last session piping `run-codex` through `tail`. Its own
   words: *"This plan's own subject, in the check I ran to verify the plan's own subject."*
5. **`src/quiz.ts`, mine, this run — the fix for (2).** Having put `overCap` into the diagnostic, I
   made the sentence explain it: *"a non-zero over-cap count is the deferred bug in `toQuestions`
   manufacturing this failure rather than the model, and is the thing to fix"*. False. `overCap`
   counts elements the loop **never examined**, so they may be malformed, duplicate, unanchored or
   another `medium`. Sol reproduced it in one line — twelve good questions plus a malformed tail item
   gives `overCap: 1`, `malformed: 0`, and a diagnostic blaming our own cap for a batch it cost
   nothing (`260903e-stage1-review-sol.md` § 1). **The test could not catch it**, because it wrote
   `overCap: 4` into the counters by hand instead of overflowing the cap: it pinned the wording and
   never met the meaning. Now it overflows the cap for real, and the sentence says only what the
   number supports — how much of the answer went unread.

6. **This plan's own severity claim, mine, this run.** It called the `pdf-read` defect "a permanent
   trap: an article that can never be read again". `260828e`, the source I was summarising, says of
   that same instance: *"it is a silent wrong rather than a permanent trap."* The original was
   careful; the summary was not. Two of the three assertions in my version were independently false
   as well — `readRaw`'s `null` stopped meaning *assume HTML* on 2026-08-31, and the run that hits
   this still extracts from bytes held in memory. Caught by Sol at the stage review. Nobody
   exaggerated on purpose: a hedge was compressed out by a second writer who did not re-read the
   first.

The instructive part is that **(1), (2), (5) and (6) were written by someone who had just read the
postmortem naming the class, and (4) by an agent whose brief was that class.** (5) is worse than
that: it was written *by this plan*, as the fix for (2), and shipped past a test the same hand wrote
— a test that fed the code its own answer. Whatever the control is, it is
not knowing about it. Which is the argument this plan already accepted from Sol against building a
convention, arriving a second time by a different road.

## How much of the trawls survived my own check

I verified all six Stage 1 items against the code myself. **Two of six were materially wrong**, both
in the same direction — a subagent read a doc or a postmortem describing a defect, confirmed the
described symptom was *absent from the file it names*, and did not check whether something else
supplied it:

- **Item 4 withdrawn entirely** (the `stopped`/`interrupted` filter) — the "one line away" fix would
  have introduced a fabrication the code comment forty lines away explicitly warns against.
- **Item 2's severity cut** (the comment store) — reported as live 500s to readers; the composition
  root has guarded it since the incident.

Add the two already noted in Fable's census, and the raw hit rate across everything automated that
looked at this question is roughly two-thirds. **Nothing in this plan should be built from a
subagent's report without the file being opened.** That is not a complaint about the subagents — they
found things I would not have — it is the reason the orchestrator reads the diffs.

## The plan's own instance of its subject, caught before it shipped

Stage 1 item 4 said `recentHistory` should exclude `stopped` turns the way it excludes `interrupted`
ones, and that *"the sibling exclusion is one line away"*. **That would have been a bug**, and
`src/converse.ts:1166` says why, in a comment written for exactly this reader:

> `interrupted` is excluded, and that is the opposite of what `stopped` … A stopped answer's text is
> what the reader read, so it belongs in history. An interrupted one's is not … which is the
> fabrication `stopped`'s own rule exists to avoid. Recommended by Fable, 2026-08-31.

The doc that raised it (`chat-tools.md:582`) is **not** stale and the defect is real — a stopped
preamble is replayed to the model as a complete four-word answer *with nothing saying it was cut
short*. But both halves are true at once: do not drop the text, and do not present it as complete.
That is why the doc says the fix *"wants thinking about rather than patching, because 'was it
stopped' is a fourth thing for that function to know about a turn."* It is a shape-3 deferral, not a
sibling's fix left unapplied, and it moves out of scope below.

**How it got in:** a trawling subagent read the doc, did not read the code comment forty lines from
the function it named, and reported a small fix. I put it in the plan on that report. This is the
same failure the plan already recorded about Fable's census two sections up — *a scanner cannot tell
a live deferral from a settled decision* — and it recurred inside the document making the point,
one section later, against an author who had just written it down. Which is the whole thesis, and is
why the fixes are the plan and the convention is the tail.

## Found, real, and deliberately out of scope

Named here so the next reader does not have to re-find them — **and each is now on this list precisely
because leaving it in prose is the thing this plan is about.** My first draft said this section would
be "top of the queue for the next weekly sweep". Sol pointed out that is another paper deferral, and
it is: a queue nobody owns is a sentence. So the first item below gets a **named plan** instead, and
the rest are honestly just recorded.

- **Content extraction silently drops headings, tables and math** (`content-extraction.md:134`,
  *"The rest is not fixed… nothing reports it"*). 13 of 15 fixture pages lose 10%+ of some structural
  element; Wikipedia's *Transformer* loses all 188 `<math>` elements; 87 of 328 blocks on one article
  are ≤6 characters and all `gistable`, so bracket-citations become TOC entries. This corrupts the
  granularity-zoom tree, which is the feature the app exists for. **Large**, two plans already spiked
  it, and it deserves its own job rather than a stage in this one. Sol's ranking, passed to Greg
  rather than decided here: *"If priorities force a choice, I would do content extraction before the
  new defect-convention machinery."* The machinery is now dropped outright, so the comparison is
  against this sweep — and on measured reader impact this is the larger piece by some distance.
- **One corrupt article directory blanks the whole shelf** (`logging.md:805`, *"deliberately left
  alone: only the logging changed"*). `src/api.ts:1498` still throws the whole listing on one bad
  row. **Medium**, and a product call — dropping one card silently is not obviously better than
  failing loudly.
- **`durationMs` in the spend ledger** (`ai-gateway.md:490`) — *"produced a wrong number in three
  separate workstreams on one day"*, and in two of them the wrong number reached a committed
  document. The correct formula exists only as prose. **Small/medium**, and the purest instance in
  the corpus after the ones being fixed; it is out only because it is agent-facing, not
  reader-facing.
- **Exercise the deployed credential at deploy time** (`260828d`), **the `process.env`-vs-`EXPECTED`
  static check** (`260827b`), **wiring `check-owner-identity.ts` into deploy** (`260828f`). Three
  small deploy-path guards. Out because this worktree cannot deploy and I would be shipping guards I
  cannot watch run once.
- **The env warning reads as the opposite of what happens.** Noticed while verifying the `db-export`
  fix: `loadEnvLocal` prints *"[env] .env.local overrode DATABASE_URL from the shell environment"*,
  and the very next line is `Target: <the shell's URL>`, because `resolveTargetUrl({ shellWins: true })`
  then overrides for `DATABASE_URL` alone. Both lines are true and they look contradictory. It is
  **pre-existing and consistent** — `db-migrate` and `db-check` print the same pair — and the
  documented rule already resolves it, since CLAUDE.md tells every agent to read the `Target:` line.
  Left alone deliberately: `src/env.ts:84` is shared by every script and its warning is carefully
  argued, so a special case there is gold-plating. Recorded because "it looked confusing and I moved
  on" is how the next person loses twenty minutes.
- **A stopped preamble comes back as a complete answer** (`chat-tools.md:582`) — the withdrawn Stage 1
  item 4, above. Real, and it needs `recentHistory` to learn a fourth thing about a turn rather than a
  one-line exclusion. **Medium**, and the smallest honest version — marking the replayed turn as cut
  short — changes what the model is sent, which is a product call rather than a chore.
- **`saidNothing()` cannot tell "never tried" from "spent its tool budget"** (`chat-tools.md:595`,
  *"Not built"*) and **chat stop does not interrupt a tool call in flight** (`chat-tools.md:575`,
  bounded at 20s). Both real, both low stakes by their own docs' admission.

## What this plan will not do

- Build `docs/known-defects.md`, a marker-to-register consistency test, or an AST gate on deferral
  wording. Argued above.
- Touch the product deferrals the sweep turns up. A deferred *feature* is "simplest version first"
  working as written, not an instance of this class. Fable's read that the generic self-retry in
  `src/jobs.ts` belongs here was wrong for that reason, and it is dropped from the argument.

## ~~Approval gate~~ — no longer needed

This plan originally proposed two `docs/reusable/` edits, which would have gone through
[edit-important-docs.md](../reusable/edit-important-docs.md). The convention they carried was dropped
on Sol's review, so there is nothing to approve and no rule-wording is being changed.

Worth noting for the postmortem: the gate would have worked. The mechanism this plan nearly shipped
was stopped by a cross-family review, not by any check — which is also how `260902e` was found, and
is the honest answer to "what catches this class": **another model reading the plan before it is
built.** That is already the house rule; it does not need a new one.
