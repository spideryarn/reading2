# Plan review: give the cross-family reviewer the right freedoms

Repo: `/home/greg/code/spideryarn2`, branch `dev`. Read-only review of a plan, before anything is
built. This prompt deliberately follows the contract the plan itself proposes — independent pass
first, my suspicions last — so tell me at the end whether that shape worked on you.

## Read

Durable paths, not scratch files:

- `docs/plans/260904e-give-the-cross-family-reviewer-the-right-freedoms.md` — **the plan under review**
- `docs/plans/260904e-review-sol-freedoms.md` — a previous Sol answer that is one of its two sources
- `docs/plans/260904e-review-prompt-freedoms.md` — the prompt that produced it
- `docs/reusable/codex-cli-as-subagent.md` and `docs/reusable/engineering-manager.md` — the two docs
  stages 1–3 edit
- `.codex/config.toml` — the `review` profile the plan declines to change
- `AGENTS.md` — house rules; `docs/reusable/edit-important-docs.md` — the process these edits follow

Nothing is built yet. There is no diff. The plan is the artefact.

## The independent pass — do this first, before reading my questions below

Attack the plan on its own terms. In particular:

1. **The measurements.** Section "What was measured" makes three claims that decide the whole plan,
   above all #3: that `features.network_proxy = true` plus a `[permissions.X.network.domains]`
   table is HTTP-only, still denies unix sockets, and cannot carry raw Postgres TCP — so there is
   no safe middle between "no network" and "blanket internet". **You can test this yourself for
   free**: `codex sandbox --permission-profile <name> -C <dir> -- <cmd>` runs a shell command under
   a profile with no model and no cost, and `CODEX_HOME=<dir>` lets you point it at a config you
   write in `/tmp` without touching this repo. If you can find a narrow grant that *does* work, that
   is the most valuable finding available here and it changes the plan's central decision.
2. **The reasoning from evidence to decision.** The plan cites counts from two prior reviews (54
   dead scratchpad paths, 46 suspicion-led prompts, ~150 refusals vs 14 approvals, 7 prompts over
   100 KB). Are those the right numbers to hang these decisions on? Spot-check some. A count that
   does not survive checking should not be load-bearing.
3. **The stage boundaries.** Would the tree be in a sensible state if the job stopped after any one
   of them? Is stage 2 doing too much at once?
4. **What the plan does not say.** Missing risks, a cheaper route to the same value, a stage that
   should not happen at all.

## Severity, and what counts as a refusal

Rank every finding:

- **P0** — wrong behaviour a reader can reach, data loss, security, money
- **P1** — wrong behaviour a test can reach
- **P2** — design
- **P3** — docs and comments

**Refuse the plan only on a P0 or P1 you actually established** — for a plan-stage review, that
means a fact you checked (a command you ran, a file you read that contradicts the plan), not a
concern you reasoned to. Everything else is advice, ranked. Say plainly at the end: proceed,
proceed with changes, or refuse — and if you refuse, name the established fact.

For each finding give (a) the check that shows the plan is wrong — something I can run or read —
and (b) the smallest change that fixes it. A finding with no (a) goes last.

## My own suspicions — read these last, and spend most of the run above

These are already my doubts, so confirming them is worth less than anything you find on your own:

- Stage 4 (one rebuttal turn via `codex exec resume`) may not be worth its complexity. I have it
  last and droppable. Is dropping it now the better call?
- The two-round cap might suppress a real P0 found on round 3.
- `docs/reusable/review-prompt-template.md` may be a doc nobody opens — the value might only be
  real if the contract lives where the prompt is written rather than in a separate file.
- The plan implements a list Greg approved in chat and explicitly refuses to widen scope. That may
  leave out something obviously right.

Do not change any file.
