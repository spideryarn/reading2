# Feedback reports, batch three

Nine reports arrived on the morning of 2026-09-05, all within an hour, all from Greg while reading
[*A Landscape of Consciousness*](https://www.spideryarn.com/read/lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz).
The process is [feedback-reports.md](../project/feedback-reports.md); this is the run.

**Every one is from an admin, so § Who sent it says build it** — no debate about whether it is worth
doing, because the person who decides that is the person who filed it. What is left to judge is
*how much*: [simplest version first](../project/vision.md#simpler-first), with the deferred rest
named here rather than quietly dropped.

This is an unattended run, so questions, decisions and assumptions land in this file, not in chat.

## The reports

Nine to begin with; four more (1T, 1V, 1W, 1X) arrived two hours later while the first wave was
still running, from a second article. Thirteen in total.

| id | kind | one line |
|---|---|---|
| [1H](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1H) | suggestion | a `/contact` page, and links to it |
| [1J](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1J) | problem | dictation transcribes the ums and ahs |
| [1K](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1K) | suggestion | `[mic-offline]`: disable the button up front, offer Retry after |
| [1M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1M) | problem | the interface feels sluggish on a really long article |
| [1N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1N) | suggestion | the thank-you should match the kind, and Close should be instant |
| [1P](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1P) | suggestion | enlarged Illustrated diagram: the prompt text beside it, scrolling on its own |
| [1Q](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1Q) | problem | clicking a comment chip opens a *new* comment instead of the one that is there |
| [1R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1R) | suggestion | mark a comment made by the ? button as a request-for-explanation |
| [1S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1S) | suggestion | that explanation should teach: summary first, then analogy or worked example |
| [1T](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1T) | suggestion | the Design link belongs in /admin, not on the logged-in homepage |
| [1V](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1V) | suggestion | Summary mode should ask Socratic questions that send you back to the text |
| [1W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1W) | suggestion | reopening an article should put you back where you were |
| [1X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1X) | problem | a comment asking for evidence did not search the web |

## How they were grouped

Not one agent per report — **one agent per set of files**, because three worktrees editing
`CommentDialog.tsx` is three merge conflicts. Three at a time at most
([feedback-reports.md § The run](../project/feedback-reports.md#the-run)).

- **Wave 1**
  - **1Q + 1R + 1S** — all three are the gutter's ? button and the comment it makes. 1Q is where you
    land, 1R is what gets stored, 1S is what comes back. One agent, one story.
    → [260905c-gutter-comment-chip-explanation-metadata-and-prompt.md](260905c-gutter-comment-chip-explanation-metadata-and-prompt.md).
    The chip in 1Q turned out to be the **chat** button, not the comment bookmark, and each press of
    it was minting a fresh conversation rather than opening the ones it counted.
  - **1J + 1K** — both dictation, both `src/web/useDictation*.ts` and the transcription route.
  - **1H + 1N** — a new page and a dialog's copy. Unrelated to each other, but small, and neither
    collides with anything else in the wave.
- **Wave 2**
  - **1P** — Illustrated / Lightbox, on its own.
  - **1M** — the sluggishness. Measure before touching anything; a symptom is a lead, not a
    diagnosis.
  - **1T + 1W** — two small pieces of client state: a link that moves, and a view that should be
    where you left it.
- **Wave 3**
  - **1V** — the Summary prompt, once nothing else is editing prompts.

**1X went to the wave-1 comments agent mid-flight**, rather than waiting for a slot, because it lands
in [`src/explain.ts`](../../src/explain.ts) — the same file that agent is already rewriting for 1S.
Two worktrees editing one system prompt is a conflict you can see coming.

That file also makes 1X more interesting than it reads. Model-invoked web search is *already there*:
its header records Greg asking for it on 2026-08-25, "but encourage the model to ask for it unless
it's very sure". So the capability exists and did not fire — a bug or a too-weak encouragement, not a
feature request. The same file already records one round of exactly this, where the working shape and
the broken one "look fine in a dialog", which is why the first mistake survived.

## Decisions and assumptions taken without asking

Recorded here because there is nobody in the chat to ask.

1. **1S is a prompt change, not a feature.** "Drawing on pedagogical techniques" could be a whole
   explain-mode. The afternoon-sized version is the wording of the prompt behind the ? button plus
   whatever structure the response already supports. Anything that needs new UI is deferred.
2. **1K's on-device fallback is deferred.** Apple Speech via the Web Speech API is a second
   transcription path with its own permissions, its own failure modes and no server record of what
   was said. The report itself scopes it as "and/or any other improvements" — so the two concrete
   asks (disable when offline, Retry after) ship and the fallback is written up, not built.
3. **1M gets a measurement first and a fix only if the measurement names one.** If the profile says
   the cost is spread across everything, the honest ending is a write-up rather than a speculative
   optimisation.
4. **1Q's shape is Fable's call**, as the report asks. GPT Sol reviews it for simplicity, also as the
   report asks.

## What actually happened

**All thirteen shipped and resolved**, in five agents over one afternoon; the queue and
[awaiting-approval.md](../user-feedback/awaiting-approval.md) are both empty, and there are thirteen
notes in `docs/user-feedback/` dated `260905_`. Nothing was declined and nothing is waiting on Greg
as a report — the decisions left for him are listed at the end.

**Four reports turned out not to be the thing they described.** That is the pattern of the batch, and
it is an argument for reproducing before fixing rather than for readers writing better reports:

- **1Q named the wrong chip.** The orange bookmark was innocent; the blue one is the chat button —
  and the fault was worse than reported. On a chip advertising "3 already", three presses took the
  count 1→2→3: every attempt to *reach* a conversation was creating another.
- **1K's `[mic-offline]` was one code over two different sentences** — the recogniser dropping
  mid-speech, and the upload failing afterwards — which is exactly why the report had an "if" in
  front of each half. It could not pick a branch because the four characters could not.
- **1N's "delay" was not slowness.** Close cleared the form and shut the dialog in the same React
  commit, so the browser painted an empty feedback box for one frame in place of the thank-you.
- **1M's cost was script, not layout** — 60.4% against 3.0%, the *opposite* of the 2026-09-03 scroll
  finding, which would have sent anyone following the existing precedent to the wrong place.

**And two of the three assumptions taken up front were wrong in the same direction** — the work was
in a different place than the brief guessed:

1. **1S was a prompt change, as assumed.** Right.
2. **1X's brief pointed at [`src/explain.ts`](../../src/explain.ts). That file is not on the chat
   path.** The header this batch read so confidently is about a different surface. What was actually
   wrong: the tool did reach the wire, production logged the turn as `searches:0`, and **the model
   was offered the search and declined — because chat's prompt discourages what explain's
   encourages.** Two prompts pulling opposite ways, which no amount of staring at `explain.ts` would
   have shown.
3. **1V could not be done as asked at all.** *There is no prompt that generates Summary mode.* The
   panel draws the stage-4 `gist`, which is rendered in ten other places and fed back into later
   structure waves as context. Editing it would have turned shelf blurbs into questions and degraded
   the trees the cascade builds. So the question became a separate field on the node, drawn in
   Summary mode alone — built differently on purpose, and the reasoning is in that report's note.

**The cross-family reviews paid for themselves four times**, each catching something a plan-stage
review could not have:

- a restore that would have **fired a paid model call** when a reader reopened an article (1W);
- `proposalFromTree` not carrying `question`, so deepening one section **wiped every question in the
  article** — reproduced, four before and zero after (1V);
- "Try again" silently losing the teaching prompt (1R);
- and on dictation, *do not ship* with four findings, three reproduced by calling the code — `100 Ah`
  and `Er` deleted as fillers, `--help` becoming `-help`.

**Greg's mid-run offer of `GOOGLE_API_KEY` or `OPENAI_API_KEY` was investigated and declined**, which
is the outcome worth recording because it stops the next agent reopening it: Google's `mode: "smart"`
strips fillers but bundles that with restructuring speech into lists and resolving self-corrections;
OpenAI has no filler parameter at all; and neither gives zero data retention on an ordinary paid key,
which would break the promise printed on the button. `ai-gateway.md` is untouched because nothing
switched.

### What is left for Greg

Nothing here blocks anything, and none of it is a report:

1. **Existing articles show no Socratic question until their hierarchy is re-run**
   (`npm run hierarchy -- <slug> --force`). Nothing backfills. Whether to sweep the library is his.
2. **Whether those questions pull their weight at all**, once seen on screen — several are tight
   paraphrases of their own gist in interrogative form, and the agent that built them said so rather
   than hiding it. They have never been rendered in a real browser; the panel tests are jsdom.
3. **The backfill of existing "?" presses** is a heuristic `UPDATE` over real readers' words, so it
   is deliberately his to run and not an agent's.
4. **`/design` stays open to any signed-in reader.** The link moved to `/admin`; drawing a link was
   never a gate, and the page reads no data. Gating it is a separate decision.
5. **Mode switching is faster, not fast** — Hierarchy still costs ~2.8s on a 2,046-block article, and
   the remainder is forced synchronous layout. Measured and written up, deliberately unbuilt: the
   tempting fix caches row offsets, and a stale cache points the reader at the wrong section.
6. Two smaller things the agents surfaced: `MIN_SELECTION_CHARS = 8` drops short selections with no
   feedback, and two plan docs share the letter `260905c`, which `plan-name.ts` cannot detect.

## A red on `dev` that is not this batch's

`tests/store-migration-registry.test.ts` fails on `dev`, and it reproduces alone, so it is not the
box:

```
tests/jobs.test.ts: 10 of its top-level blocks account for no mutation, and the record allows 9
```

A block — `describe("unrunnableStepPlan")` — was added to `tests/jobs.test.ts` and the registry record
was not updated to match. **It arrived with `aa941484`, Stage A**, not with Stage E's `cbb903d0` as
this doc first said; the correction is below, and it is the second time on this one red that an
attribution was reached for rather than derived.

**Left deliberately unfixed here, and then fixed by somebody with better evidence.** The two ways to
make it green are to annotate the new block with a `**Mutation.**` or an honest `**No mutation.**`
header, or to raise the allowance from 9 to 10. The second defeats the guard, and the first seemed to
require knowing whether that block deserves a mutation test — which is the work the registry exists to
force onto the person who added it. So this batch left the red standing as the forcing function.

**That was the wrong call, and the annotation the other session wrote is right.** It annotated the
block rather than raising the allowance, and the judgement — "no mutation involving the store: no
store reaches this block" — is *readable off the four `it`s* rather than guessed, which is the
distinction this batch got wrong.

### The reason first given for that, and retracted

~~The session in `worktree-deepen-fat-sections` hit the same red holding the missing test in its
hands: the rule `unrunnableStepPlan` enforces is asserted only against the pure function, and nothing
asserts that `enqueue` throws — found out the expensive way, because `evals/deepen/`'s free
`--dry-run` asks for `["fetch","extract","blocks"]`, so every phase threw at `enqueue`, zero jobs
were created, and `npm test` stayed green throughout.~~

**None of that was true of the repo, and it is struck rather than deleted so the correction is
legible.** `tests/jobs.test.ts:1260` — *"refuses a blocks-only job at the door rather than stranding
the article"* — drives `enqueue` and asserts both the throw and the 400, and its comment already
names the trap it exists to close. Verified here, not taken on report: `git log -S` puts the
predicate, the `enqueue` call, the pure-function block and that wiring test all in **`aa941484`**
alone, one commit. The dry-run breakage was real but the bug was in its caller;
`["fetch","extract","blocks"]` is refused correctly and by design.

The retraction is `626cead3`, on `dev`; the `stage-e-unrunnable-untested` anchor is kept so existing
links still land.

**How the false claim was reached is worth more than the claim was**, and there are two instances of
one shape here:

- The other session's grep across `tests/` **excluded `tests/jobs.test.ts` — the file it was
  annotating** — on the assumption that the block it had read was all that file had to say. The
  wiring test does not name `unrunnableStepPlan` in its title, so nothing surfaced it, and a clean
  grep was read as evidence of absence.
- The attribution to `cbb903d0` was reached for because its subject line sounded right, rather than
  derived with `git log -S`. `cbb903d0` touched that file, but with 26 lines and no new `describe`.

**And this batch's own share of it:** the evidence was written into this doc as fact and repeated to
Greg without being checked, when the three commands that falsify it take a few seconds. Verifying the
parts that were easy to verify — the block count, whether the fix had landed — is not the same as
verifying the claim the decision rested on.

The lesson worth keeping: *don't guess on the author's behalf* was sound, but a red left standing is
only a forcing function if somebody is coming who will be forced. Meanwhile it hides the next
regression from everyone, which is what it was doing.

**And the general form, which the other session named better than this batch did.** Caution about
touching someone else's work is not one rule, it is two, and the test is what the timid option
destroys:

- Raising the allowance from 9 to 10 would have **destroyed information** — the guard stops being
  able to ask the question again. Caution was right there, and would still be right.
- Correcting a sentence that misleads its next reader **destroys nothing**. There, caution was only
  delay dressed up as respect — and working out whose the sentence was cost more than fixing it.

The stale-inventory fix in that entry turned out to be the smaller instance of the same shape that
then produced a false attribution and a false gap on the very same red — three times in one
afternoon, all of them *a fact reached for rather than re-derived*. That is the thing to take away
from this section, more than the red itself.

Resolved on `dev` at `0e89d69f`: the two halves landed in different files and did not collide, and
`tests/store-migration-registry.test.ts` is green again — 13 tests, verified here rather than taken
on report.

Every agent in this batch was told it is inherited, so nobody wastes time deciding whether it is
theirs. It is listed here so it is not lost; it is not on
[awaiting-approval.md](../user-feedback/awaiting-approval.md), which is for feedback reports.

One thing in that registry entry *was* this batch's to fix, and is fixed: it read "eight of its ten
blocks are pure functions", where ten was the total on 2026-09-04 and not a pure count. Stage E's
block made the sentence parse as a current inventory that had already counted it. It is now dated,
per [CLAUDE.md](../../CLAUDE.md) on inventories — record the scope and the run date, and treat the
output as a dated example.

Separately: `tests/admin-store` goes red under contention and passes alone. Three worktrees on one
box is the documented limit for a reason.

## Two findings routed into this batch's territory

From the sweep behind
[260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md](../postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md),
**reported rather than fixed** so they did not land in a worktree mid-flight. Both verified here by
reading the code, not taken on report — which is the whole lesson of the section above.

1. **`evals/dictation/bench-models.ts` announces a clean bill over an arm that never answered.**
   `clean` starts `true`; an arm whose every call was lost has an empty `seen` map, so `odd` is empty,
   nothing sets it false, and the run prints *"every call named the model it was sent to"*. The detail
   worth the trip: the comment immediately above the check describes the **previous** version of this
   same bug — "a clean bill of health from a test that had not run", GPT Sol's review, item 4. The fix
   and its recurrence are adjacent in the file.
2. **`evals/dictation/bench-vocabulary-sources.ts` writes a planned count as if it were an outcome.**
   `calls: CONDITIONS.length * utterances.length * RUNS` is what was *intended*; `lost` sits two lines
   below, so a careful reader can subtract, but the field named `calls` says what happened and does
   not know.

Neither is urgent and nothing in this batch depends on them. They matter because dictation shipped
today (`e4533a71`) and a follow-up benchmark is the obvious next move — these are exactly the two
harnesses that would be re-run, and both would report a clean run over a broken one.

**The pattern to copy is one directory away**, which is why this is a small job rather than a design
question: `evals/quiz.ts` counts `marked` against `CASES.length` attempted, says *"Nothing was
measured … not the same thing as clean"* in as many words, and sets `exitCode = 1` on total failure —
its header records that this bug shipped there first. `evals/cost/run.ts` returns early from
`summarise` on zero draws.

Queued behind 1P and 1V: the feedback reports are the job Greg set, and these are not reports, so
they got no Sentry write and no note in `docs/user-feedback/`.

**Both fixed** — `457c764c` and `dfe170d2`, with the plan in
[260905e-dictation-benchmarks-cannot-report-clean-over-nothing.md](260905e-dictation-benchmarks-cannot-report-clean-over-nothing.md).
Three things are worth carrying out of it:

- **Three reds were watched first**, which is the whole point on a class where the defect *is* a
  check that passes. The sharpest is a verbatim copy of the old three lines kept in the test file as
  `reportsCleanTheOldWay`, still asserting `true` — the bug preserved as a fixture, so the fix cannot
  quietly become the bug again.
- **The limit is stated rather than glossed:** neither benchmark was run end to end, because both
  make paid calls at import. So nobody watched `bench-models.ts` itself print the false clean bill.
  That gap is *why* the judgement moved into an importable module instead of staying as two local
  patches.
- **`clean` is now computed forwards** — every arm answered all of what it was sent, in whole
  positive numbers — rather than as an absence of complaints, so a state nobody enumerated lands on
  the unclean side. That is the general repair for this class, and it is the one thing here worth
  copying elsewhere.

**Discoverability was the part that needed most care**, because the file being fixed already carried
its own previous fix in a comment directly above the relapse. A comment is exactly what failed. So
`tests/dictation-bench-coverage.test.ts` enumerates `evals/dictation/bench-*.ts` and fails if one
does not import `coverage.js` and take its exit code from it — asserting *which files it found*
first, because a collector that matches nothing passes every assertion about its contents.

**No further instances in `evals/dictation/`** — all six remaining files opened. One thing reported
and deliberately not fixed: `gate-models.ts` sets no exit code.
