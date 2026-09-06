# Review: a plan for an eval of Debate mode, and the two fixes it is expected to land

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode`, branch `worktree-critiques-mode`.
TypeScript + ESM, run with `tsx`, vitest for tests, Postgres store. This is a **plan review**, before
any code is written.

## The candidate

Live pre-commit; base `538e5191`.

Untracked (the candidate itself):

- `docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md` — **the plan under review**
- `docs/plans/260906b-plan-review-prompt.md` — this file

Nothing else has changed. (Not durable — I will record the resulting commit SHA here once it lands.)

**Start with the plan.** Then, for the ground it stands on:

- `docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md` — the parent plan for the
  feature, including § 3 and § 4 (valence and the two fields), § Attribution, § What is counted, and
  the three review ledgers (F1–F33) whose findings this plan cites
- `docs/plans/260905f-debate-mode-stage-0-spike-results.md` § "Stage 3½ — the first live runs" — the
  measurements
- `src/debate.ts` — the stage. `DIRECT_SYSTEM`, `CLAIMS_SYSTEM`, `READING`, `runPass`, `parsePass`,
  `readDirectGroup`, `readClaimGroup`, `generateDebate`
- `src/types.ts` — `DebateLosses`, `DebateCounts`, `DirectDebateRow`, `ClaimDebateRow`
- `src/web/DebatePanel.tsx` § `VALENCE_APPEARANCE` — how a valence is drawn
- `evals/README.md` — the house eval doctrine, which this plan is meant to obey rather than reinvent
- `evals/summaries/` — the closest precedent (arms as data, sha256-pinned corpus, blinded
  `codexJudge`, the anchor gate in `anchors.ts`)
- `docs/reusable/silent-success.md` — the house rule the coercion proposal has to survive

This is where to begin, not the limit of scope.

## What it is meant to do

Debate mode goes out to the open web for one article and returns two groups of rows: pages
responding to *this article* (group one) and pages engaging with *a claim it makes* (group two).
Every row carries a model reading — `relation` (disputes/qualifies/extends/corroborates/unclear),
`valence` (positive/negative/neutral/unknown, drawn as a red/green chip) and `applies`.

Two live runs cost $0.6252 and found three things: valence points at the source's own subject rather
than at the row's target on 3 of 7 rows; group one empties at `unverifiedSource` because the model's
quotations are outside the search engine's page extract; and nothing replayable was stored, because
only *kept* rows are persisted.

The plan proposes: capture raw pass output; a two-curl experiment to decide whether full-page
fetching would rescue anything; a three-layer eval that separates the *reading* (cheap, frozen,
where arms are compared) from the *search* (expensive, live, measured only on counts); a free
deterministic check for impossible relation/valence pairs; a prompt reframed from valence to
agreement; and a stopping rule declared in advance.

**Deliberately out of scope:** Stage 4 of the parent plan (public sharing), scoring the wording of
`applies`, an admin page, and pairwise arm comparison on live runs.

**The invariant that matters most:** an eval must not be able to report a number it did not measure.
Most of this repo's worst bugs are something reporting success while doing nothing, with the obvious
check agreeing because it shares an assumption with the code.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/debate.test.ts`) and a script (`node --import tsx <script>`), and build a
throwaway harness under `/tmp`. You have **no network, not even loopback**, so anything needing
Postgres, OpenRouter or a local service will not run. The live-run evidence is in the spike-results
doc named above; the stored artefact it describes is in a database you cannot reach, and its contents
are quoted in that doc.

## Attack it

Independently, before you read my questions below.

**The invariant to break: find a place where this eval could print a figure that does not mean what
it says.** A metric computed over rows that were filtered before it ran; a comparison between arms
that read different evidence; a gate that passes over nothing; a "measured zero" that is really "not
measured"; an exclusion that hides the very defect that justified it.

Second, attack the **claim that `disputes`+`positive` and `corroborates`+`negative` are
contradictions**. The plan builds a free metric, a production coercion and a stopping rule on it. If
there is an honest row of either shape under the target the parent plan states, most of this falls
over.

For each finding give:

- an ID (**F34, F35, …** — F1–F33 are taken by the parent plan's three ledgers; number above them),
  a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
- (b) the smallest change that closes it — exact replacement wording

A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by the file: a defect in this plan that will cause a P1 to ship is not a P3
because it is made of prose.

Refuse only on an **established** P0 or P1 — direct evidence with no unresolved material inference —
and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself. Spend
most of the run elsewhere.

1. **The coercion.** § "The check: an impossible pair never reaches a reader" proposes silently
   rewriting a model's `valence` to `unknown` when it contradicts `relation`, counted and disclosed.
   I think a counted coercion is defensible and an uncounted one is not — but the alternative (fail
   the row) throws away a usually-correct `relation` and `applies`, and a third option (show the
   contradiction) is plainly worse. The plan asks this question out loud. Which is right?
2. **Layer 2's path caveat.** Re-asking the reading over frozen extracts, with no `web_search` tool,
   is not production's path — production searches inside the generation. The plan says a Layer 2 win
   must be confirmed by one live run before landing. Is that enough, or is Layer 2 measuring
   something different enough that arm rankings from it should not be trusted at all?
3. **The anchor gate's denominator.** Seven hand-labelled Cargo Cult rows, with a pass mark of six.
   That is a small n and I picked the number by eye. Sol's own precedent (`MAX_ANCHOR_INVERSIONS = 0`
   in the summaries eval) is stricter. Is six of seven a gate or a decoration?
4. **The `qualifies`/`extends` exclusion.** I exclude them from the interpretation score as
   legitimately ambiguous, and print the count. The label eval's lesson is that an exclusion asserts
   a fact — and if the model's *targeting* failure also occurs inside `qualifies` rows, I have
   excluded the region where the bug is hardest to see.
5. **Stage F's injection argument.** The parent plan refused full-page fetching partly as "a second
   injection surface". I argue that objection does not apply to a fetch only a string matcher reads.
   Is that right, or is there a path by which fetched bytes reach a model anyway?

Do not change any file.
