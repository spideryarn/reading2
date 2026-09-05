# Review: stages 1–2 of "give the cross-family reviewer the right freedoms"

Repo: /home/greg/code/spideryarn2, branch `dev`. TypeScript/ESM. This prompt is itself written to
the contract under review — tell me at the end where the template failed me while I used it.

## The candidate

Committed: `git diff 8ca6bc736eb74945c7b18e247d31cb8eec3dc061...4da72a170f9bd5b02125e42198a0643de2dd8b04`  (two commits, 4c5d8919 and 4da72a17)

Read in full:
- `docs/reusable/review-prompt-template.md` — **new, and the main artefact**
- `docs/plans/260904e-give-the-cross-family-reviewer-the-right-freedoms.md` — the plan, revised
  after your own refusal of it (`docs/plans/260904e-plan-review-sol.md`)
- the diff to `docs/reusable/codex-cli-as-subagent.md`, `docs/reusable/engineering-manager.md`,
  `.codex/config.toml`, `scripts/run-codex.ts`

## What it is meant to do

Stage 1 corrects two claims that were measured wrong: that the codex sandbox denies the tsx unix
socket "in every mode" (it is the *profile's* network policy, and a network-enabled profile runs
`npm run typecheck`), and that a reviewer "can run one test file" without saying that Postgres and
any local service are out of reach. It then records the decision not to grant network, with the
measurements.

Stage 2 adds the review prompt contract and a termination rule.

Out of scope: changing the sandbox, letting a reviewer edit, and the rebuttal-turn feature, which
your review talked me out of.

## What you can and cannot run

Tree read-only; /tmp and the node_modules caches writable. `npx vitest run tests/doc-links.test.ts`
is the gate this touches and it passes (14 tests) — run it yourself. You have no network, not even
loopback. `codex sandbox --permission-profile <name> -C <dir> -- <cmd>` is free and needs no model;
`CODEX_HOME` pointed at a throwaway config lets you test a profile without touching this repo's.

## Attack it

Independently, before my questions below.

1. **Is the corrected claim actually right?** Stage 1 asserts the unix socket and the Postgres
   connection are gated by one switch, the profile's network policy. If that is wrong the correction
   is worse than what it replaced. The table in `§ What network would buy` is the claim.
2. **Would the template survive contact?** Take a real past review prompt from `docs/plans/` and
   rewrite its header to this template. What is missing, ambiguous, or unusable? Especially the
   two candidate forms — does the pre-commit form actually let a reviewer see the change?
3. **Does the termination rule have a hole?** It is in `engineering-manager.md § GPT Sol`. You
   wrote its exception; check I implemented what you meant and not a weaker version.
4. **What did I break?** These are files every agent reads on every job. A sentence that reads two
   ways is a rule that will be followed two ways.

For each finding: an ID (F1, F2…), a severity (P0/P1/P2/P3), established or reasoned, then (a) the
input under which it fails its own claim and (b) the smallest change. Refuse only on an established
P0 or P1, and name what established it.

## Previous findings

Your plan review is `docs/plans/260904e-plan-review-sol.md`. Dispositions, by your numbering:

| ID | Disposition | What changed |
|----|-------------|--------------|
| 1 (SOCKS/mode=full) | **disagreed, after running it** | You were right that "HTTP-only" was false and that `mode = "full"` was untested. I ran it: `ALL_PROXY=socks5h://…` exists, `mode = "full"` parses, and it changes neither `npm run typecheck` nor the Postgres test. Wording fixed, decision stands. Row 4 of the table |
| 2 (empty diff) | **fixed** | Template has two candidate forms, the pre-commit one carrying an explicit untracked-file list |
| 3 (reproduced → established) | **fixed** | Template and engineering-manager.md both say established |
| 4 (round-two P0/P1) | **fixed** | The cap counts P2/P3 churn; a newly established P0/P1 gets one scoped check on its fix |
| 5 (census overstated) | **fixed** | Numbers corrected, refusal ratio dropped for having no classifier |
| 6 (drop Luna) | **fixed** | Dropped; stable finding IDs took its place, in stage 2 |
| 7 (stage 3 overloaded) | **not attempted yet** | Stage 3 is not in this candidate |
| 8 (approval checkpoints) | **disagreed** | Greg's instruction to proceed autonomously is the later and more specific one; before/after is shown in chat for every rule-changing edit |

Treat all of that as unreviewed work by someone else.

## My own suspicions — read last

Worth less than anything you find yourself:

- The template may be too long to be copied, which would make it a doc nobody opens — the failure
  you predicted.
- "Established, not reproduced" may be too loose in the other direction now.
- Stage 1's new `§ What network would buy` may belong in the plan rather than in a reusable doc
  that travels to other repos.

Do not change any file.
