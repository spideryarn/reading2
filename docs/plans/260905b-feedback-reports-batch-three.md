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

Filled in per agent as each lands. Each agent works in its own worktree, runs
[engineering-manager.md](../reusable/engineering-manager.md), gets a GPT Sol review of its code, and
pushes to `dev` itself.

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
