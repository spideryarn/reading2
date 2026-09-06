# Review 2: a plan for an eval of Debate mode, revised after your refusal

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode`, branch `worktree-critiques-mode`.
TypeScript + ESM, `tsx`, vitest, Postgres store. Still a **plan review**, before any code is written.

## The candidate

Live pre-commit; base `538e5191`.

Untracked, the candidate:

- `docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md` — **the plan, rewritten**
- `docs/plans/260906b-plan-review-prompt.md` — round one's prompt
- `docs/plans/260906b-plan-review-sol.md` — **your round-one review**, for the ledger
- `docs/plans/260906b-plan-review-prompt-2.md` — this file

Also present but **outside the candidate**: `.tmp-debate-fixture.mts`, an existing untracked browser
fixture — do not review or commit it. (Not durable — I will record the resulting commit SHA here once
it lands.)

**Start with the plan**, then § "The overlap between `relation` and `valence`", § "Layer 2", § "Stage
D" and § "Stopping rule", which is where your findings landed hardest. Same background as round one:
`docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md`,
`docs/plans/260905f-debate-mode-stage-0-spike-results.md`, `src/debate.ts`, `src/types.ts`,
`src/web/DebatePanel.tsx` § `VALENCE_APPEARANCE`, `evals/README.md`, `evals/summaries/`.

## What it is meant to do

Unchanged from round one: an eval for Debate mode — a reading-view mode that searches the open web
for pages responding to an article (group one) or engaging with a claim it makes (group two), and
labels each row `relation`, `valence` and `applies`. Two live runs found valence pointing at the
source's own subject on 3 of 7 rows, group one emptying because the model's quotes fall outside the
search engine's page extract, and nothing replayable stored.

**Deliberately out of scope:** Stage 4 of the parent plan (public sharing), scoring `applies`'s
wording, an admin page, pairwise arm comparison on live runs, and renaming `valence`.

**The invariant that matters most, unchanged:** an eval must not be able to report a number it did
not measure.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. One test file
(`npx vitest run tests/debate.test.ts`) and a script (`node --import tsx <script>`) will run. **No
network, not even loopback**, so nothing needing Postgres, OpenRouter or a local service will run.

## Previous findings

| ID | Finding, verbatim | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F34 | coercion can manufacture the stopping-rule result | fixed (moot) | Coercion removed entirely by F35. Your rule — score raw output, never a repaired projection — is kept as a standing rule in § "What the eval measures" and Stage C. |
| F35 | the "impossible" pairs are not impossible under the product contract | fixed | § "The overlap between `relation` and `valence`, and what it is not" is a new section recording the reversal. The pairing is a **screen** routing rows to the judge, never a gate; it is out of the stopping rule; coercion is cut. Your group-specific wording is adopted verbatim as the prompt arm. Fable's competing "agreement" rewording is recorded and refused, for the reason you gave. |
| F36 | Layer 2 can compare different rows and reward omission | fixed | Layer 2 rewritten around a frozen row-packet manifest, your specification adopted: fixed id/pass/identity/URL/title/quote/target/haystack/hashes, every arm answers every packet, foreign or missing ids invalidate the run, coverage printed before any quality figure. |
| F37 | the plan lands the winner before running the metric that can identify it | fixed | The `qualifies` exclusion is gone — only the mechanical screen is stratified by relation, and the judged metrics cover every packet with per-relation denominators. Stage C now generates and scores and **lands nothing**; Stage D judges, applies the stopping rule, and only then lands a prompt. |
| F38 | ordering questions within one judge request does not prevent priming | fixed | The judge never receives `relation`, `valence` or `applies`. It returns engagement, stance, and the subject it appears to describe instead; deterministic code compares afterwards. |
| F39 | six of seven cannot calibrate a 1-in-20 claim | fixed | Every anchor must be classified correctly; the report prints the confusion matrix including wrong-target recall; described as a sanity gate, not statistical evidence. |
| F40 | the proposed "raw" capture is downstream of failures it claims to preserve | fixed | Capture moved to the provider-response boundary, before `runPass` validation and before pass B. A table names every field, raw annotations included; failed and aborted paid passes are captured; `admissible` is derived at replay. |
| F41 | the corpus pin omits a production input | fixed | Entries pin `inputFingerprint(blocks, tree, meta)`; the loader recomputes and refuses drift; every capture records the same `sourceHash`. |
| F42 | two stopping clauses can pass over nothing | fixed | Every rate prints numerator/denominator; wrong-target needs ≥20 valid judged packets; the obscure article returns `not exercised` rather than "zero no". |
| F43 | the runner has no specified source for per-run cost | fixed | Stage A specifies cost from the spend collector's `SpendRecord`s via `totalSpend`, contributing call ids and `unpriced` recorded, an assertion that a completed run holds exactly its two search calls, never dollars from `Usage`, `not measured` otherwise. |
| F44 | Stage F removes prompt injection but does not specify a safe network path | fixed | Stage F rewritten: `fetchDocument` only, every check retained, whole-run concurrency/byte/elapsed budget added, 12 per pass and 24 per run, capture records final URL, content hash, outcome and bounded haystack. |
| F45 | one "no-model" adversarial test requires semantic judgment | fixed | Layer 0 is deterministic only; the same-topic non-engaging packet moved to the judged corpus. The five remaining packets are tabulated. |
| F46 | the candidate inventory is incomplete | fixed | `.tmp-debate-fixture.mts` named above. |

Treat the fixes as unreviewed work written by someone else, and spend most of the run on what has
changed since.

## Attack it

**The invariant to break, unchanged: find a place where this eval could print a figure that does not
mean what it says.**

Two things are new since round one and deserve the most attention:

- **The screen.** It is now a diagnostic that routes rows to the judge. Is a diagnostic that is not a
  gate still capable of misleading — for example by making an arm look better because it produced
  fewer flaggable rows?
- **The second prompt defect** (§ "A second prompt defect, found while checking the first"): the
  prompt scopes `relation` to the *page* and `valence` to the *quoted passage*, and the plan proposes
  making both about the passage. Does that change break anything the parent plan relies on?

For each finding give an ID (**F47, F48, …** — F1–F46 are taken; number above them), a severity, and
whether it is **established** or **reasoned**; then (a) the concrete scenario the plan does not
handle or the authoritative contract it contradicts, and (b) the smallest change that closes it, as
exact replacement wording. A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it.

## My own suspicions — read last

Worth less than anything you find yourself.

1. **Did I over-correct on F35?** The screen caught 3 of 3 real bugs for nothing. I have demoted it
   to a router. Is there a *stronger* free signal available that I have now given up — or is the
   demotion right and I should say less about it, not more?
2. **Stage C now lands nothing**, which means the cheap layer produces no decision on its own. Is
   that the right shape, or have I made Stage C a stage that can be skipped?
3. **The anchor set is seven real rows plus synthetics, all from one article.** Every anchor must be
   right. Is a gate that strict, over a set that small and that correlated, going to fail for reasons
   that are not about the judge?
4. **The two-curl experiment decides Stage F.** It is n=2 on one article. Am I about to make a build
   decision on a sample that cannot support it?

Do not change any file.
