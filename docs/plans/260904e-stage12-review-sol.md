# Sol's review of stages 1–2 — refused, two P1s

> gpt-5.6-sol, high, `review` profile, 2026-09-04. Prompt:
> [260904e-stage12-review-prompt.md](260904e-stage12-review-prompt.md), the first written to
> [review-prompt-template.md](../reusable/review-prompt-template.md) — so the template was under
> review *and* in use, and the last section says where it failed while being used.
>
> Dispositions are in the plan's § The stage 1–2 code review. All ten findings were taken.
> The candidate was commits 4c5d8919 and 4da72a17.

## Verdict

**Refuse.** Two established P1s block the exact candidate:

- F1: commit `4da72a17` fails the documentation gate.
- F2: the termination rule still permits an unreviewed P1 repair to land.

No tracked file was changed.

## Findings

### F1 — P1 — established: the committed candidate fails its gate

(a) I ran `npx vitest run tests/doc-links.test.ts` in the live tree: **14/14 passed**. I then archived exact revision `4da72a17`, attached the existing `node_modules`, and ran the same test there: **1 failed, 13 passed**.

The failure is:

```text
docs/reusable/README.md → diagnose-box-resources.md
```

[README.md](/home/greg/code/spideryarn2/docs/reusable/README.md:35) contains the link, but `diagnose-box-resources.md` is not in `4da72a17`; the live gate passes only because another agent’s untracked file currently satisfies it.

(b) Remove that unrelated README row from this candidate, or include the target file if it genuinely belongs to this stage. Given Stage 3 is out of scope, removing the row is the smaller correction.

### F2 — P1 — established: the termination exception covers only one of the failing sequences

(a) The rule handles a P1 first discovered on round two, but not this sequence:

1. Round one establishes F1/P1.
2. The first fix is inadequate.
3. Round two reports F1 still open; it is not “newly established.”
4. A second fix is made after round two.
5. [The exception](/home/greg/code/spideryarn2/docs/reusable/engineering-manager.md:54) does not require that fix to be checked.
6. The overrule clause does not apply because the orchestrator believes it fixed the finding rather than overruling it.

It also says nothing about what happens when the one scoped check itself says the P1 remains broken.

(b) Replace the exception with:

> After round two, discovery closes. Any established P0 or P1 whose final fix was not present in the round-two snapshot gets a narrowly scoped verification of that fix. If it remains open, settle or overrule it through Fable or Greg before landing. This does not reopen general discovery.

### F3 — P3 — established: the “one switch” network claim is broader than its own evidence

(a) The candidate says the Unix socket and Postgres are “gated by a single switch” and that a profile with `network.enabled = true` runs both. But [rows 3–4 of its own table](/home/greg/code/spideryarn2/docs/reusable/codex-cli-as-subagent.md:429) still have network enabled and fail both once `features.network_proxy` is enabled.

Likewise, “the choice is binary: no network, or unrestricted outbound” is contradicted literally by the preceding row: loopback HTTP returns 200 while external access is blocked. What is binary is access to the two capabilities under discussion, not networking generally.

The narrower conclusion appears sound: **with the proxy off in the measured configuration**, enabling direct network access permitted the Unix socket and Postgres. The universal wording does not.

(b) Say:

> With the network proxy off in this measurement, enabling direct networking permitted both the tsx Unix socket and the Postgres connection. No tested allowlisted configuration delivered those two capabilities: the proxy allowed loopback HTTP, but re-denied the socket and did not carry the Postgres client.

Apply the same proxy-off qualification in `.codex/config.toml`.

### F4 — P2 — established: the committed-candidate form does not constrain the candidate

(a) This prompt demonstrates the failure. Its prescribed range contains **28 commits and 131 changed files**, while the named candidate is two commits touching 11 paths. The “read in full” list omitted `docs/reusable/README.md`, where F1 lives.

The two candidate SHAs supplied outside the template let me recover the intended range. Without them, the template’s committed form would have sent the review across 7,183 insertions.

(b) Require:

```text
Candidate commits: <ordered exact SHAs>
Candidate diff: git diff <first-candidate-parent>..<last-candidate>
Changed paths: <complete manifest, or command that produces it>
Priority entry points: <files to read first; this does not limit scope>
```

Also require the author to verify that the range contains exactly the listed candidate commits.

### F5 — P2 — established: the pre-commit form is visible, but not durable

(a) `base SHA + paths + untracked list` lets a reviewer inspect the current tree using `git diff <base> -- <paths>` and by opening each untracked file. It does not identify the bytes reviewed.

If another agent changes one listed file during the review, the same candidate description now names different content. Tomorrow—or on another machine—it names no recoverable candidate at all. That fails Rule 1’s “durably” claim.

(b) Add an exact command plus snapshot closure:

- Record a fingerprint covering the binary tracked diff and every untracked file.
- Have the reviewer recheck it before issuing the verdict.
- After committing, record the commit SHA that matches that fingerprint in the review artefact.

At minimum, rename the form “live pre-commit candidate” and state explicitly that it is not durable until mapped to the resulting commit.

### F6 — P2 — established: stable IDs collide on the second pass

(a) The second-pass ledger contains `F1`, while the reviewer is independently told to number findings `F1`, `F2`, … A new first finding can therefore reuse a retired `F1`. The “every ID appears exactly once” relay check then becomes ambiguous.

(b) State:

> IDs are stable for the whole review chain. Reuse an ID only for the same finding; assign new findings numbers after the highest ID already issued. Never recycle a closed ID.

The ledger need not reproduce every finding verbatim when the original artefact is linked and handed over; copying long findings works against the compactness goal.

### F7 — P2 — established: the template only fits code review

(a) The house workflow requires plan review before code exists, but the template demands “the input under which the code fails,” “something I can run,” and a fix “as a code block.” This candidate is doc-only. The prompt had to silently rewrite those requirements to “fails its own claim” and omit the code-block requirement.

(b) Give two forms:

- Code: runnable mutation/input and smallest code change.
- Plan/docs: concrete scenario or authoritative contradiction and smallest exact wording/design change.

### F8 — P2 — established: the severity levels overlap

(a) A reader-visible UI defect is both “wrong behaviour a reader can reach” (P0) and “wrong behaviour a test can reach” (P1). Meanwhile, this review’s termination-rule defect is located in documentation, nominally P3, but can cause a P1 to ship. Different reviewers can classify the same defect three ways.

(b) Make severity consequence-based and non-overlapping:

- P0: data loss, exploitable security, incorrect charging, or broadly unusable service.
- P1: user-visible functional or authoritative-contract violation.
- P2: design/maintainability risk without current wrong behaviour.
- P3: non-behavioural prose or comment defect.

### F9 — P2 — established: “established” still collapses too easily into “reasoned”

(a) [The definition](/home/greg/code/spideryarn2/docs/reusable/review-prompt-template.md:49) allows anything “shown by something the reviewer … read.” Every static review reads code. A plausible trace through an unreachable branch can therefore be labelled established despite depending on an unresolved reachability inference.

(b) Define it as:

> Established means direct evidence with no unresolved material inference: an observed failing execution, an exact reachable source path demonstrating the violation, or an authoritative contract directly contradicted by the candidate. If any material premise remains inferred, label it reasoned.

### F10 — P2 — established: the network measurement is not independently reproducible from the durable artefacts

(a) The table does not name the Postgres test, exact command, candidate revision, complete throwaway configuration, exit statuses, skips, or raw output. Searching the candidate finds only the repeated conclusions.

I also followed the new `codex sandbox` advice. From this already-managed review environment, both profiles aborted before executing the command:

```text
failed to open synthetic bubblewrap mount registry lock ... Read-only file system
exit 101
```

That does not disprove the host-shell measurement, but it establishes that “you can test a profile” needs a host-shell qualification.

(b) Put the dated experiment in the plan or a research/evidence artefact with the exact configuration, commands, revision, output and interpretation. Keep only the stable conclusion in the reusable doc, linking to that evidence, and say `codex sandbox` must be run from a host environment capable of starting nested bubblewrap.

## Where the template failed this prompt

The most consequential failure was candidate identity: it allowed a 28-commit/131-file range to describe a two-commit change and encouraged a short full-read list that omitted the only file breaking the gate. The extra commit IDs—not required by the template—rescued the review.

It also made you adapt code-specific finding language for a documentation review, supplied no legacy-ID convention, and implied that `codex sandbox` would be runnable from this reviewing environment when it was not.

The template is not too long: the 6 KB document and roughly 50-line copyable block are workable. Its problem is precision at the candidate and evidence seams, not size.