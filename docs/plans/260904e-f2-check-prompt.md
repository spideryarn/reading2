# Narrowly scoped check of one fix: F2

Repo: /home/greg/code/spideryarn2, branch `dev`.

This is **not** a new review. It is the check that the rule under examination now requires of
itself: F2 was an established P1 you raised, its fix was made after the round-two snapshot, and the
rule says such a fix gets one narrowly scoped verification. **Discovery is closed.** Do not look
for anything else; if you notice something, note it in one line at the end under "not in scope".

## The candidate

Commit `270e289c` (one commit).
`git diff 270e289c^..270e289c -- docs/reusable/engineering-manager.md`

Changed paths in that commit, complete: `docs/reusable/engineering-manager.md`,
`docs/reusable/review-prompt-template.md`, `docs/reusable/codex-cli-as-subagent.md`,
`.codex/config.toml`, `docs/plans/260904e-give-the-cross-family-reviewer-the-right-freedoms.md`,
`docs/plans/260904e-stage12-review-prompt.md`, `docs/plans/260904e-stage12-review-sol.md`.

**Only the first is in scope for this check** — specifically the "Two rounds per stage" passage in
`docs/reusable/engineering-manager.md` § GPT Sol.

## The finding being checked

Your F2, verbatim from `docs/plans/260904e-stage12-review-sol.md`:

> **F2 — P1 — established: the termination exception covers only one of the failing sequences.**
> The rule handles a P1 first discovered on round two, but not this sequence: (1) Round one
> establishes F1/P1. (2) The first fix is inadequate. (3) Round two reports F1 still open; it is not
> "newly established." (4) A second fix is made after round two. (5) The exception does not require
> that fix to be checked. (6) The overrule clause does not apply because the orchestrator believes
> it fixed the finding rather than overruling it. It also says nothing about what happens when the
> one scoped check itself says the P1 remains broken.

You proposed replacement wording. I applied something close to it but not identical — I kept the
house voice and added a paragraph explaining *why* the wording is "final fix not in the snapshot"
rather than "newly found".

## The single question

**Walk your own six-step sequence through the wording as committed.** At each step, say what the
rule now requires. Then answer:

1. Does the sequence still slip through? If yes, at which step, and give the exact replacement
   wording.
2. Is the "if it comes back still open" case now handled, and is the handling adequate?
3. Did my added explanatory paragraph weaken, contradict, or narrow the rule it explains? A
   paragraph that explains a rule into a smaller rule is the failure mode I am worried about.

Verdict: **fix verified** or **fix inadequate**. If inadequate, the smallest exact wording that
closes it.

## What you can run

Tree read-only, `/tmp` and the node_modules caches writable, no network of any kind. Nothing here
needs running; `git show` and reading the file are the evidence.

Do not change any file.
