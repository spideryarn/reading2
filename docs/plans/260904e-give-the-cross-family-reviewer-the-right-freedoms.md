# Give the cross-family reviewer the right freedoms

Greg asked whether GPT Sol has enough room to be useful — whether it can run tests, spikes and web
research, and whether letting it *edit* during a review would be more efficient — and the same of
Fable. Then:

> Proceed autonomously using @docs/reusable/engineering-manager.md , prioritising by a combination
> of ease, value, and confidence
>
> — Greg, 2026-09-04

The answer turned out to be: **the reviewer's problem is not its freedoms, it is its brief.** Two
independent second opinions and a set of direct measurements all landed there, so this plan spends
most of its effort on the prompt contract and the termination rule, and changes the sandbox not at
all.

Owner: this doc. Everything that survived review is doc work — the one code stage was dropped, on
the reviewer's own advice about its own feature.

**Status, 2026-09-04: done enough to stop here.** All three surviving stages are on `dev`, reviewed
and revised; the gates are green. What remains is in [§ Raised, not done](#raised-not-done), and
none of it blocks anything. The one item with a half-life is #3, the postmortem line asking whether
a review caught the class — it is the only proposal here that would ever settle the cadence question
with evidence rather than opinion, and every week it is not in the template is a week of
postmortems that cannot answer it.

## Where this came from

- **GPT Sol on itself**, dispatched read-only: [260904e-review-sol-freedoms.md](260904e-review-sol-freedoms.md)
- **Fable on the same questions**, quoted in this doc where it is the source
- **Direct measurement** of the codex sandbox on this box, below — the part neither of them could do

The conversation's proposal list is what Greg approved by saying "proceed"; this plan implements
that list and nothing else. Anything the work turns up beyond it goes in
[§ Raised, not done](#raised-not-done) rather than into a file.

## What was measured, 2026-09-04, codex-cli 0.152.1, Hetzner box

All of it with `codex sandbox`, which runs a shell command under a permissions profile with **no
model and no cost** — the cheapest way to settle a sandbox question, and the reason this plan has
numbers rather than opinions.

| Profile | `curl` external | `curl` loopback | `npm run typecheck` | a real Postgres test |
|---|---|---|---|---|
| `review` (checked in today) | ✗ exit 7 | ✗ exit 7 | ✗ `EPERM` | ✗ |
| `[permissions.X.network] enabled = true`, proxy **off** | 200 | 200 | **passes, 1266 files** | **16/16 passed** |
| `+ features.network_proxy`, loopback allowlist, default mode | ✗ blocked | 200 | ✗ `EPERM` | ✗ 5 of 16 failed |
| the same with `network.mode = "full"` | ✗ blocked | 200 | ✗ `EPERM` | ✗ 5 of 16 failed |

Three findings follow, and the third is the one that decides the plan.

1. **The `review` profile has no network at all** — not even loopback. Stronger than the doc says.
2. **The doc's claim that the tsx unix socket is denied "in every mode" and cannot be fixed is
   wrong.** It is gated by the *network* policy: turn network on and `npm run typecheck` runs.
3. **The narrow grant does not deliver the capability.** The documented way to allow some hosts and
   not others — `features.network_proxy = true` plus a `[permissions.X.network.domains]` table —
   works *as an allowlist*: external is blocked, loopback HTTP returns 200. But turning the proxy on
   is what re-denies the unix socket (`listen EPERM /tmp/tsx-1000/20.pipe`, so `npm run typecheck`
   dies), and a client that does not speak SOCKS never reaches the service — the Postgres driver
   gets `connect ECONNREFUSED 127.0.0.1:1`, the proxy answering on a dead port rather than the real
   one. So there is no "loopback-only, safe" middle: it is the status quo, or blanket outbound
   internet.

   **The fourth row is Sol's finding 1, run.** It objected that "HTTP-only" was false and named
   `network.mode = "full"` as the untested alternative, correctly: codex does export
   `ALL_PROXY=socks5h://127.0.0.1:<port>`, and `mode = "full"` parses. Measured afterwards, it
   changes neither result. Sol was right about the mechanism and right that the experiment was
   incomplete; it was careful to say it had *not* established that Postgres would work, and it
   doesn't. Its proposed `socat` SOCKS5 bridge would be new machinery in the test harness for the
   reviewer's sole benefit, and would not touch the unix socket at all.

Two supporting measurements, both of which close off the obvious repair:

- Filesystem **deny rules work** — `"/path" = "none"`, and globs (`".env*"`) match. But denying
  `.env*` breaks the suite, which reads `DATABASE_URL` from there, and denying `~/.codex` breaks
  codex itself, whose binary lives under it (`execvp … Permission denied`).
- The doc's shell-profile leak was measured on the Mac. **This box's login shell exports no
  secrets** (`env -i … bash -lc 'env | grep …'` → nothing).

## The decisions

**Keep the review sandbox exactly as it is.** Read-only tree, writable `/tmp` and test caches, no
network. Sol and Fable each recommended this without seeing the other's answer, and the
measurements remove the compromise both of them were hoping for. Blanket network would hand a model
that has just read untrusted article prose an outbound socket and a readable production
`DATABASE_URL`. The cost we accept: Sol cannot reproduce a Postgres finding, so the orchestrator
runs that suite and hands over the raw output.

**Do not let the reviewer edit the tree.** Both agreed, and both improved on the reason already in
the doc. Fable: *a patch in hand kills the apply-(a)-first discipline* — nobody handed a fix writes
the red test before applying it. Sol: *editing changes the subject while it is being examined* —
the thing reviewed stops being the thing committed. The own-worktree reviewer is right, but as a
**spike dispatched after a review**, never as an ambient reviewer freedom.

**Spend the effort on the brief instead.** The evidence for this is the plan's centre of gravity:

- Of a **236-prompt** corpus, **7 exceed 100 KB** (largest ~217 KB), pasting a diff the reviewer
  could have read itself — and a 279,000-token run that compacted and then died is already written
  up in the codex doc.
- **46 prompts lead with the orchestrator's own suspicions.** Sol: *"That is validation, not
  independent discovery."* This is the doc's own "if you can write the question, write the fix"
  trap, still happening.
- **Review prompts cite evidence under temporary paths that are now gone.** 63 distinct `/tmp`
  paths across the corpus, **42 absent from this box**, of which **32 are Mac scratchpad paths** —
  so the commonest killer is **moving machine**, not `/tmp` being cleared. That makes it certain to
  recur and makes the fix a revision range, not a longer-lived scratch directory.

Three numbers that were in an earlier draft are **not** in this list, because they did not survive
checking — this is the "check each finding yourself" rule applied to my own plan:

- Fable's "54 prompts cite a dead scratchpad diff" was wrong; a counted sweep gives the figures
  above. My own restatement of that sweep — *"every one of the 42 dead paths is a Mac path"* — was
  also wrong, and Sol caught it: ten of the 42 are wrapper outputs, browser fixtures and literal
  examples like `/tmp/spideryarn/`. Absence on this box also does not prove a Mac path was
  unrecoverable at the time.
- Fable's **~150 refusals against 14 approvals** is dropped. It has no recorded classifier, and
  verdicts like *"ship with changes; I would not ship the current commit"* fall on both sides of any
  simple text match. The qualitative claim it was offered for — that review chains run to round 7
  and round 12 without converging — stands on the chains themselves.

**Keep the per-stage cadence.** Sol argued for risk-tiering it; Fable argued to leave it and fix
termination instead. Fable wins: "it felt small" is exactly the judgment that fails, and Sol's own
evidence is that the small stage reviews still found real bugs. The waste is round 4, not round 1.

## Stages

Ordered by ease × value × confidence. All three surviving stages are doc-only, so they stay in the
primary checkout, which AGENTS.md allows a doc edit to. Stage 4 was the only one that would have
touched code and needed a worktree; it is dropped, with the reason below.

### Stage 1 — correct what is measurably wrong, and record the network decision

Highest confidence: every claim here was measured today.

- [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md) § The review profile — fix the
  unix-socket row and the paragraph asserting it cannot be fixed; add the measured table above.
- Same doc — a short section on what network would buy and why we are not taking it, with the
  `network_proxy` result, so nobody re-derives it. Note `codex sandbox` as the free way to test.
- [engineering-manager.md](../reusable/engineering-manager.md) § GPT Sol — "tell it to run one test
  file itself" is only true for pure unit files; say the Postgres half is the orchestrator's to run
  and hand over.

- [`.codex/config.toml`](../../.codex/config.toml) and [`scripts/run-codex.ts`](../../scripts/run-codex.ts)
  both repeat the unix-socket claim in a header comment. A sweep on 2026-09-04 found those two plus
  four passages in the codex doc; nothing else living says it.

**Historical review prompts are left alone.** The same sweep found eleven prompts under
`docs/plans/` telling a past reviewer that `npm run typecheck` is blocked. They were true when
sent, and a plan's review prompt is a *record of what was asked*, not a live instruction — editing
them would falsify the record to make a grep clean. The living docs are what a future agent reads.

Done when: the docs say what the measurements say, and `npm test` is green (doc-links).

### Stage 2 — the review prompt contract

The stage that carries the value. A new short doc, `docs/reusable/review-prompt-template.md`,
because a template is a thing you copy and the codex doc is already 40 KB of prose:

- **Name the candidate durably, in one of two forms** — this is Sol's finding 2, and it is the one
  that stopped the first draft being wrong. A revision range alone *cannot* work here: the house
  rule is review **before** commit, so `git diff <merge-base>...HEAD` on the thing under review
  returns nothing. This very plan proved it — Sol reviewed an untracked file whose diff was 0
  bytes. So the template offers:
  - **committed candidate** → a base/head revision pair;
  - **pre-commit candidate** → base SHA, the scoped working-tree paths, *and an explicit untracked
    file list*, since a pathspec cannot name a file git has never seen.

  Either way the point stands: a `/tmp` path is not a candidate. It is unreproducible the next day
  and gone for good on the next machine.
- **Do not paste the diff** when the tree is readable.
- **Independent pass first, suspicions last**, and say so in the prompt: *the questions above are
  already my suspicions; spend most of the run elsewhere.* Sol was asked whether this worked on it
  and said yes — the three P1s all surfaced before it reached my suspicions — while noting the
  ordering is only advisory while both are in one message.
- **A fixed severity scale** — P0 wrong behaviour a reader can reach, data loss, security, money;
  P1 wrong behaviour a test can reach; P2 design; P3 docs — and **refusal only on an *established*
  P0/P1**. Established, not *reproduced*: Sol's finding 3, and it is right. "Reproduced" would rule
  out a P0 shown by a file, a schema or an authoritative contract — and this plan simultaneously
  accepts that Sol cannot reproduce anything touching Postgres, so the narrow wording would have
  disarmed the reviewer exactly where it is already weakest. Concerns merely reasoned to are ranked
  and labelled as such.
- **Stable finding IDs**, and the review artefact handed to the implementer directly. This replaces
  the Luna relay check that was going to be stage 3 — see there.
- **A prior-finding ledger**, verbatim, each with `fixed / disagreed / not attempted` and the
  mutation result. Both reviewers asked for this independently.

Plus the termination rule in [engineering-manager.md](../reusable/engineering-manager.md) § GPT Sol:
**two rounds per stage**, then the orchestrator decides and records *"Sol still objects to X;
overruled because Y"* in the plan doc. A P0/P1 overrule goes to Fable or Greg first.

**The cap counts P2/P3 churn only** — Sol's finding 4. A P0 or P1 *newly established on round two*
gets one narrowly scoped verification after it is fixed, because otherwise the cap ships code that
was never reviewed, which is the thing the house rule exists to prevent. That verification checks
the fix; it does not reopen discovery.

Done when: the template exists, is linked from both docs and the reusable README, and the
termination rule is in engineering-manager.md.

### Stage 3 — the delegation roster

**The Luna relay check is dropped**, on Sol's finding 6, which beats the proposal it replaces:
losing a finding in relay is a *deterministic* transfer problem, and answering it with a second
stochastic model that might itself mis-segment a finding is the wrong shape. Stage 2's **stable
finding IDs** plus handing the implementer the review artefact itself solve it outright — the check
becomes "every ID appears exactly once", which anyone can run and nobody can fudge. That is why the
IDs moved into stage 2.

What is left, and it is two separable things:

- **Fable as reviewer runs read-only — and that turned out to be a convention, not a boundary.**
  Sol's finding 7 said to measure the mechanism before writing it down. Measured 2026-09-04 by
  dispatching a Fable `Explore` agent at its own sandbox: it has **no `Edit` and no `Write`**, and
  its system prompt forbids creating files anywhere including `/tmp` — but `Bash` is unrestricted,
  runs as `uid=1000(greg)` with `sudo` and `docker` group membership, `Seccomp: 0`, the repo
  directory writable, and MCP tools in reach that include `mcp__supabase__apply_migration` and
  `mcp__vercel__deploy_to_vercel`.

  So the only thing between a "read-only" subagent and `git commit` is a sentence it chooses to
  obey — and **on the same day another one did not**: the Explore agent that ran the stale-claims
  sweep wrote `/tmp/claude-1000-scratch-paths.txt` with a shell redirect, against that same
  prohibition, and flagged it in its own report. One obeyed, one didn't, which is exactly what
  "convention" means.

  The doc therefore says the accurate thing: write *"do not change any file"* into every reviewing
  brief and don't lean on the agent type. **This is why Sol is the one to prefer for review** — its
  sandbox refuses the write whatever the model intends. Had I documented the version I drafted
  before measuring, the repo would have gained a guarantee it does not have, which is
  [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) exactly.
- **Fable is a different model, not a different family** — its priors overlap Opus's far more than
  Sol's do, so it is not a substitute for the cross-family check. Fable's own words.
- **The Sol spike mode**: own worktree, `--sandbox workspace-write`, deliverable is a diff *plus a
  red→green transcript*, dispatched after a review when a fix wants proving. Already supported by
  the wrapper and, in 373 runs, never used.

Done when: engineering-manager.md § Delegate and AGENTS.md § Delegating say these, briefly, and the
Fable read-only claim has a measurement behind it.

### Stage 4 — one rebuttal turn — **dropped, 2026-09-04**

`codex exec resume` exists and the wrapper does not use it, and the case was real: disputing a
finding today means either overruling it silently or paying for a fresh review that re-reads
everything.

Dropped on Sol's own advice about its own feature, which is the argument I could not have made.
The two invariants that make a rebuttal turn safe — *same tree* and *one turn only* — cannot be
enforced by `--resume-session <id>`. Enforcing them needs durable session metadata: the repository
path, a full working-tree fingerprint **including untracked content**, and a used-turn counter. That
is a state machine, and its failure mode is the worst kind — a resumed session that looks like a
fresh review but is answering about a tree that has moved under it. Not worth it for an occasional
convenience.

If the need recurs, the cheap version is a fresh review whose prompt quotes the disputed finding and
the new evidence. It costs tokens and buys correctness by construction.

## Raised, not done

Numbered so they can be answered individually, per
[edit-important-docs.md](../reusable/edit-important-docs.md).

1. **45 codex activity logs, 35 MB in total, are committed under `docs/plans/`** — largest 1.9 MB
   (counted 2026-09-04). Fable raised it; the numbers are from a sweep. Trivial to stop; deleting
   the existing ones rewrites nothing but is still a call for Greg, since they are the only record
   of what a given review actually ran.
2. **Delegated implementation to Sol is documented and has never been used** — all 373 runs are
   reviews. Fable calls it the cheapest unused headroom in the setup.
3. **No feedback loop on whether reviews catch the bugs that ship.** Fable's proposal: one line in
   every postmortem — *was this class reviewed by Sol, and did it catch it?* — as the only thing
   that will ever settle the cadence question with evidence. Not done because it changes the
   postmortem template, which is Greg's call.
4. ~~**`tests/owner-isolation.test.ts:660` has a live typecheck error** on `dev`~~ — somebody
   else's work in flight, noticed while measuring. **Gone by 23:25 the same evening**; whoever owned
   it fixed it. `npm run typecheck` is clean across all 1274 files.

## The stage 1–2 code review, and what it caught

[260904e-stage12-review-sol.md](260904e-stage12-review-sol.md), written to the new template so the
template got exercised on itself. **Refused, two P1s**, and both were real.

**F1 — my own commit failed the doc-links gate, and the live tree hid it.** Sol archived revision
`4da72a17`, attached `node_modules`, and ran `tests/doc-links.test.ts` *there*: 1 failed, 13 passed.
In the working tree it passes 14/14. The difference is another agent's untracked
`diagnose-box-resources.md`, whose README row rode along in my pathspec commit while the file itself
— being untracked — did not. So that commit linked to a file that did not exist in it.

Self-healed ten minutes later by their own commit `8e87cfa5`, and HEAD is green. But the process
failure was mine and is worth naming: **AGENTS.md says to say in the message whose work rode along,
and I didn't.** Nothing was lost, and saying so would have made this findable without a reviewer
rebuilding the commit.

It is also the sharpest possible argument for the review discipline the plan is about. A reviewer
that reasons over the working tree cannot see this. One that reconstructs the revision can — and
this is precisely the class the `review` profile was widened for on 2026-09-02.

**F2 — the termination rule had a hole**, and it was one I had just written. The exception covered a
P1 *newly established* on round two, but not: round-one P1 → inadequate fix → round two says still
open → a second fix after round two that nothing checks. The overrule clause never fires, because
you believe you fixed it rather than overrode it. Reworded to "whose final fix was not in the
round-two snapshot", which is Sol's wording.

Eight more findings, all P2/P3 and all taken: the "one switch" network claim was broader than its
own evidence (rows 3–4 have network enabled and still fail); the committed-candidate form didn't
constrain anything — the range in *this very prompt* covered 28 commits and 131 files to describe
two commits and eleven paths, and the file breaking the gate was in the 131; the pre-commit form is
not durable, so it is now called *live* and closes by recording the resulting SHA; IDs collided
across rounds; the template only fitted code review, which I noticed by having to rewrite it for a
doc-only candidate; the severity levels overlapped; "established" was loose enough to admit any
static read; and `codex sandbox` cannot run from inside a sandboxed review, so that advice is now
qualified.

Sol's own verdict on the template: *"The template is not too long… Its problem is precision at the
candidate and evidence seams, not size."* That answers the suspicion I had ranked first.

### The rule obeying itself, same day

F2 was an established P1 whose final fix landed after the round-two snapshot, which is precisely
the case the new rule says gets a narrowly scoped check. So it got one —
[260904e-f2-check-sol.md](260904e-f2-check-sol.md) — walking Sol's own six-step sequence through the
committed wording. **Fix verified**, including the thing I was most worried about: that the
paragraph explaining the rule might quietly explain it into a smaller rule. It doesn't.

Worth noting what this cost: one 25-minute run, scoped to a single passage in a single file, with
discovery explicitly closed. That is what the termination rule is *for* — not fewer reviews, but
narrower ones once the question is settled.

## An anomaly, written down because it hides

Sol's answer file was **written twice**: a complete 18,458-byte answer at 22:11, replaced by a
different complete 17,509-byte answer at 22:12, with the wrapper's status printing the second.
`EXIT=0`, no fallback banner. Both answer the prompt and agree on every conclusion, so nothing here
rests on it — but the wrapper's non-empty-answer check cannot see this, and it belongs with the
["stale-looking answers" gotcha](../reusable/codex-cli-as-subagent.md#gotchas).

## What Sol's plan review changed

It **refused the plan**, with three P1s, and the refusal was worth its 40 minutes: it moved one
decision, corrected two pieces of wording that would have become rules, deleted a stage and deleted
a proposal. Its full answer is [260904e-plan-review-sol.md](260904e-plan-review-sol.md).

| # | Finding | What happened |
|---|---|---|
| 1 | P1 — "HTTP-only" is false; `network.mode = "full"` and a SOCKS5 listener are untested | **Right about the mechanism, and I ran its experiment.** `mode = "full"` changes neither result. Wording fixed, decision stands |
| 2 | P1 — a revision range returns an empty diff for a pre-commit candidate | **Accepted, and it saved the stage.** The template gets two candidate forms, including an untracked-file list |
| 3 | P1 — "refuse only on a *reproduced* P0/P1" is too narrow | **Accepted.** *Established*, not reproduced — the narrow wording would have disarmed the reviewer exactly where the sandbox already leaves it weakest |
| 4 | P1 — the two-round cap can ship an unreviewed round-two fix | **Accepted.** The cap counts P2/P3 churn; a newly established P0/P1 gets one scoped verification after its fix |
| 5 | P2 — the path census and the refusal ratio overstate what was measured | **Accepted.** Numbers corrected, the refusal ratio dropped for having no classifier |
| 6 | P2 — the Luna relay check adds a stochastic checker to a deterministic problem | **Accepted, and it is a better answer than the one it replaced.** Dropped in favour of stable finding IDs |
| 7 | P2 — stage 3 is the overloaded one, and "Fable read-only" names no tested mechanism | **Accepted.** Luna gone, and the read-only claim must be measured before it is written down |
| 8 | P3 — "proceed autonomously" does not supply the per-set wording approvals that `edit-important-docs.md` requires | **Noted, and proceeding.** Greg's instruction is the more recent and more specific one. The process's purpose — no rule lands unseen — is served by showing before/after in chat for every rule-changing edit, and by refusing to widen scope beyond the approved list |

Two of its findings I did **not** simply take on trust: finding 1's experiment I ran myself, and it
did not hold up. That is the doc's own rule working in both directions.

## Progress

- [x] Plan written, reviewed by Sol, refused, and revised — 2026-09-04
- [x] Stage 1 — corrections and the network decision — 2026-09-04
- [x] Stage 2 — the review prompt contract — 2026-09-04
- [x] Stage 3 — the delegation roster — 2026-09-04
- [x] Stage 1–2 code review, refused, all ten findings taken — 2026-09-04
- [x] F2's fix verified under the new rule; gates green; merged and pushed to `dev` — 2026-09-04
- [x] Stage 4 — **dropped** with a reason, above
