# A red-first test defends the change, not the code

**2026-09-06**, over one day's work on
[A7](../plans/260905i-measure-annotation-computation-before-optimising-it.md). Three test suites were
written carefully — one deliberately checked it could go red, four tests in another watched fail
before the code existed — and a cross-family reviewer then broke the shipped code on purpose. **Every
round that looked at test code found a mutation the suite did not notice.** Three for three.

**Nothing reached a reader.** Every instance was caught by review before it landed, and the cost was
reviewer rounds and one extra commit, not an incident. This is written up because the same hands
write the tests everywhere else, where nobody is mutating anything — and because
[**roughly a third of the 80 postmortems in this directory are the same shape**](#and-it-is-the-most-common-shape-in-this-directory).
If you are skimming for a pattern worth fixing, that is the one.

## The class: **a test scoped to the change rather than to the code**

> Writing the test first fixes its scope to the diff. You cannot write a red-first test for behaviour
> that is **already** correct — so the ritual covers what you are changing and is structurally blind
> to the invariants the change has to preserve.

That is the sharper half of "failure modes you did not imagine". Imagination is not really the scarce
resource here. In all three cases the missed property was one nobody had any *occasion* to write an
assertion for: `start` was already in the key, three-way overlap already worked, the clock was
already being read. Red-first asks *"does this assertion fire when my new behaviour is absent?"*
Mutation asks *"what could break this without my suite noticing?"* — a question about the finished
code, including everything that was already true. Only the second one found these.

There is a second mechanism, and it is the one that makes the confidence dangerous rather than merely
incomplete: **the evidence is earned per assertion and spent per suite.** Of the nine tests in
`tests/annotation-reuse.test.tsx`, four were watched red and five never were — they are the
changed-input controls, correctly green throughout. The plan doc says so honestly. What travels
afterwards is the shorthand, *"nine tests, written before the code and watched fail"*, and F20 and
F21 both lived in exactly the space that shorthand papers over.

### What this adds to `silent-success.md`

[silent-success.md](../reusable/silent-success.md) already contains the lesson — *"Test the test.
Break the thing on purpose and confirm you get a red"* — and this is not a case of nobody having read
it. The plan doc cites it **by name** while designing the bench, in a paragraph headed *"What stops a
zero meaning nothing"*, and the defence it builds from it (every zero paired with a changed-input
control) is exactly the five green tests that F20 and F21 then walked through. The doc was read,
applied, and still missed three times in one day. So the gap is not the idea; it is two things the
doc does not say:

- **It frames mutation as a way of validating a *control*** — the scripted edit inside a red-first
  step — rather than as a **sweep over the finished code**, done once, at the end, asking a different
  question. Its four-ways-a-control-lies section is entirely about the red-first edit.
- **It says what to do and not who does it or when.** It reads as advice. Nothing in the stage
  cadence makes it a step, so it competes with finishing, and finishing wins.

## The four

| # | What was mutated | What the suite said | What it would have cost a reader |
|---|---|---|---|
| F17 | Both memo start times → the `NO_CLOCK` sentinel; a real clock read added to `"counts"` mode; `maxMs` → the accumulated total | **all green**, three separate mutations | An instrument reporting a plausible wrong number, which is what the whole job's verdict rested on |
| F20 | `start` deleted from `anchorKey` in `TableView.tsx` | **9/9 green** | A comment moved between two identical quotes keeps underlining the stale one — a wrong underline on a reader's own words |
| F21 | Hits applied through a *second* `annotateHtml` pass | **9/9 green** | Nested `<mark>`s where the contract requires one shared element, on comment + term + hit |
| — | *(not a mutation)* `scripts/measure-annotation.ts` dispatched at a node a repaint had detached | The gesture ran, cost nothing, recorded `0` | Nothing — but it nearly decided the A/B |

**F17 is the sharpest**, because that test was written deliberately, by someone who checked it could
go red, about an instrument whose entire job is to read a clock at the right moments — and it
asserted on the *recorded values* in the snapshot rather than on the clock being read. A recorded
zero is what a working `"counts"` mode and a leaf that reads the clock and throws the reading away
both produce. The fix in [`tests/annotation-cost.test.ts`](../../tests/annotation-cost.test.ts) spies
on `performance.now` and asserts **exactly** zero reads in `"counts"` and exactly two per call in
`"full"` — an absence has to be watched for directly.

**F20 and F21 are fixture gaps, not assertion gaps**, and that distinction matters for the
prevention below. No test in the file had a repeated quote anywhere, and none had all three mark
kinds on one block. The assertions were fine; the inputs could not distinguish.

### The odd one out, and why it argues for something different

The harness bug was not found by a test or by a mutation. It was found by a subagent **reading the
raw per-repetition vector** — `[25.6, 0, 22.4, 0, 35.3, 0]`, on *both* builds of an A/B, which is how
it nearly passed for a property of the code being measured. The vectors were only there to be read
because an earlier review finding (F19) had insisted the harness print raw samples rather than
medians. No mutation of the code under test would have found it: the defect was in the measuring
apparatus. Keep it in the same family — a thing reporting success while doing nothing — but note that
its remedy is *raw output*, not *mutation*, and neither substitutes for the other.

## Where it came from

Not one commit. Three instances, all landed the same day:

- **`6a33c2d8`** — the instrument and `tests/annotation-cost.test.ts` → F17.
- **`14253086`** — Stage 2 and `tests/annotation-reuse.test.tsx` → F20, F21.
- **`c7835411`** — the F17 fix, which also shipped `scripts/measure-annotation.ts` and its
  detached-node bug.

**The class predates this job**, and the repo already had two records of it:

- [testing.md § Why the docs have a test](../project/testing.md#why-the-docs-have-a-test) — the first
  version of `doc-links.test.ts` "went green on every bug it was written in response to", and that
  was found *by mutation-testing it rather than by trusting it green*. Same class, same remedy, and
  it is written down.
- [silent-success.md](../reusable/silent-success.md) § "the control can be right while the test is
  too narrow to see it" — four instances in one afternoon, 2026-08-28, all of them a test reaching a
  narrower slice of the system than its own name claimed.

### And it is the most common shape in this directory

A sweep of all 80 postmortems here found **roughly 28 of them** — about a third — describing a test
or control that stayed green while the thing it was written to defend was broken. That is a broad
count, and it includes plain coverage gaps where no test could have existed. On the narrower reading
this file uses — *a test that existed, was written on purpose, and did not go red when its own
subject was broken* — the clearest siblings are:

| Postmortem | The suite said | The shape |
|---|---|---|
| [260901g](260901g-a-unit-test-that-bought-inference.md) | An agent mutated the guard the test claimed to depend on; **both went green** | The same move, two months earlier |
| [260903c](260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md) | Reverting the buggy call site left **all 154** focused tests green | A cache tested only on the writer's side — mark 2 |
| [260904a](260904a-a-retry-minted-a-fresh-name-so-the-checkpoints-could-never-be-found.md) | Green over a **dead feature for two days**, and would have stayed so indefinitely | A default argument supplied for the identity value under test — mark 4 |
| [260830b](260830b-the-spy-wrote-a-section-over-the-paragraph.md) | "The spy had tests. The step ladder had tests. Both were right" | Two green halves and an untested handshake — mark 5 |
| [260826c](260826c-half-swapped-message-ids.md) | "The tests tested the two halves and not the join" | The same, on client/server ids — mark 5 |
| [260828b](260828b-cancel-before-begin.md) | Every chat suite green through both commits, **and green today with the bug still in** | Dead code cannot turn a test red |

The five marks below were derived from this job's four instances and then checked against that list;
that four of the six above land on one of them is the reason to believe the marks generalise rather
than describe one day.

So this is a recurrence with a known name, not a discovery. What is new is the ranked step, and the
observation that **the detection rate held at three for three when somebody was actually looking** —
three samples, not proof of a 100% rate, but strong enough that the sweep is worth its minutes.

## Which tests are worth mutating

Not all of them. Five marks, and a test carrying one deserves the sweep:

1. **The passing value is zero, "unchanged", or "the same object".** Absence is what a broken
   detector and a healthy system both produce. All three misses are here.
2. **A cache or a reuse path.** A cache that never hits is correct and slow; one that hits *wrongly*
   is fast and wrong. The natural assertions measure the fast direction, and there is no natural
   check at all for the wrong one — you have to construct the input that distinguishes.
3. **An instrument.** If it breaks, its output is still a number, and nothing downstream can tell.
4. **A compound key.** `anchorKey(kind, id, blockId, start, quote)` needs one input per field that
   varies *only* that field. This one is mechanical — enumerate the fields — and it is exactly F20.
5. **A composition seam.** Where N producers are concatenated before one call, the pairwise cases do
   not cover the N-way case. Exactly F21, with N = 3.

Marks 4 and 5 are the useful ones precisely because they need no imagination: you read the signature
and count.

## What would have caught the class, ranked

Ranked by value; ease noted on each, because the two orders differ. **By ease alone, 2 and 3 come
first** — they are one-line changes, and they are what to do if the sweep in 1 is going to lose to
finishing.

1. **Mutate the finished code yourself, before the stage review — not as a thing reviewers do to
   us.** *Value: high — 3 of 4 here. Ease: high, minutes per suite.* Pick 4–8 mutations from the
   marks above, apply one at a time, run the focused file, put it back. The repo-specific mechanic is
   worth writing down, because the obvious recipe is forbidden here: `git stash` and `git checkout`
   are banned, so do what the reviewer did and work in a throwaway copy — `git archive <sha> | tar -x
   -C <scratchdir>` — or edit and edit back by hand, never through the working tree's git.
2. **Print raw samples from any harness, never only a median.** *Value: high for instruments. Ease:
   trivial.* This is what caught the fourth. And make each gesture declare an observable effect, so a
   no-op cannot be reported as a fast one — already done in `measure-annotation.ts`.
3. **One line in [engineering-manager.md § Along the way](../reusable/engineering-manager.md).**
   *Value: high leverage, near-zero on its own. Ease: trivial.* That bullet currently stops at *"a
   test that was never red proves nothing"* — the ritual that produced the false confidence here. It
   needs a second sentence about mutating the finished code before the review. That doc is what every
   orchestrated job reads; items 1 and 2 are unread without it.
4. **A paragraph in [silent-success.md](../reusable/silent-success.md)** separating the end-of-stage
   sweep from validating a red-first control, with the five marks. *Value: medium. Ease: trivial.*
   Prefer this to a **new** file in `docs/reusable/` — the doc exists, it is the one people already
   reach for, and a second doc saying nearly the same thing is a moving part bought for nobody. And
   scope it by the marks, not by "anything whose job is to measure": only F17 was an instrument.

**Considered and recommended against: an automated mutation-testing gate.** Stryker has a Vitest
runner and would technically fit — this repo is on Vitest, and nothing else here would need to
change. It is still the wrong trade:

- Run time is roughly *mutants × suite*, and this suite already has Postgres lanes that are contended
  enough on a shared box that [a red batch is usually the box](../project/testing.md#test-database-contended). A gate nobody can afford to run is a gate
  people learn to skip.
- It is a new dependency in a repo that [prefers boring](../project/vision.md#principles), for a job
  a human does in minutes.
- A mutation *score* is a number to satisfy, and the mutations that mattered here — a deleted field
  in a key, a second annotation pass — are semantic, not the arithmetic-operator swaps a generic
  tool is good at. It would likely have missed all three.

A **scoped, ad-hoc** Stryker run against a single important file is a reasonable spike if a suite
ever earns it. As a gate, no.

**And the honest baseline: do nothing but write this down.** *Value: demonstrably insufficient.*
`silent-success.md` said it, `testing.md` said it, the plan doc cited the first of them while
designing the very bench that missed twice — and it happened three times in one day anyway. Writing
it down again is not the fix; making it a step is. That is why items 1 and 3 are ranked where they
are.

## The fix that is right for the long term

For the four instances, it has landed: the instrument's test spies on the clock and asserts an exact
read count; a repeated-quote regression pins `anchorKey.start`; three-way overlap is guarded at the
`TableView` composition seam, including a hit arriving last onto a block already through the reuse
path; and the harness re-queries at dispatch and requires every gesture to declare an observable
effect. Each mutation was re-applied and seen red.

For the class, the long-term fix is items 1 and 3 together — **a mutation sweep as a named step at
the end of a stage, on the tests that carry one of the five marks, before the review rather than
during it.** It costs minutes; it has a hit rate of three for three on the only three suites anyone
has ever pointed it at here.
