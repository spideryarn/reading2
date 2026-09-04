# Sol's review of the plan — refused, with three P1s

> gpt-5.6-sol, high, `review` profile, 2026-09-04. The prompt is
> [260904e-plan-review-prompt.md](260904e-plan-review-prompt.md); it was the first to use the
> contract the plan proposes (independent pass first, suspicions last, severity scale).
>
> **What was done about each finding is in the plan's § What Sol's review changed.**
> Finding 1's experiment was run — see there; it did not overturn the decision, but it
> corrected the wording, which is the point of the round.

I reviewed the final stable plan snapshot `d9b28c74…`; it changed once during my review, so I re-read it after it stabilized. No repository files were changed.

## Findings

1. **P1 — The central “HTTP-only, therefore no safe middle” measurement is incomplete and partly false.**

   [The plan says](</home/greg/code/spideryarn2/docs/plans/260904e-give-the-cross-family-reviewer-the-right-freedoms.md:47>) the proxy is HTTP-only. But Codex 0.152.1 documents and contains:

   - a SOCKS5 listener exported through `ALL_PROXY`;
   - exact `localhost`/`127.0.0.1` allowlisting;
   - explicit Unix-socket allowlisting;
   - `network.mode = "limited" | "full"`.

   The installed binary says: “non-HTTPS SOCKS5 TCP [is] blocked in limited mode,” which explains the observed Postgres failure and identifies the untested alternative. The configuration with `mode = "full"` parsed successfully. [Official Codex permissions](https://learn.chatgpt.com/docs/permissions#network-permissions), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

   I could not complete the traffic test because this review itself runs inside a managed sandbox; the nested proxy failed while reserving its loopback listeners. Therefore I have **not** established that raw Postgres works end to end. I have established that “HTTP-only” is false and that the experiment did not test the documented full SOCKS5 mode.

   Smallest fix: replace Stage 1’s decision with one final host-shell measurement:

   - `mode = "full"`;
   - only `127.0.0.1`/`localhost` allowed;
   - an installed `socat` SOCKS5 bridge from a sandbox-local port to `54362`;
   - one real Postgres test;
   - an external denial control.

   If that fails, keep the existing profile—but record the actual failing boundary, not “HTTP-only.”

2. **P1 — A revision-range-only contract can make a code review inspect an empty change.**

   The plan requires `git diff <merge-base>...HEAD`, but [AGENTS.md requires review before commit](</home/greg/code/spideryarn2/AGENTS.md:290>) and [engineering-manager commits only after the stage review](</home/greg/code/spideryarn2/docs/reusable/engineering-manager.md:37>).

   The plan itself demonstrates the failure:

   ```text
   git diff HEAD -- docs/plans/260904e-...md | wc -c  → 0
   git status --short docs/plans/260904e-...md       → ?? ...
   ```

   The entire candidate exists, yet both proposed revision diffs omit it.

   Smallest fix: give the template two target forms:

   - committed candidate: base/head revisions;
   - pre-commit candidate: base SHA, scoped working-tree paths, complete untracked-file manifest, and a preserved binary patch or snapshot hash.

   Alternatively, change the house workflow to review a candidate commit before landing—but that is a larger rule change.

3. **P1 — “Refuse only on a reproduced P0/P1” is too narrow and contradicts this review’s own evidence standard.**

   [The proposed contract](</home/greg/code/spideryarn2/docs/plans/260904e-give-the-cross-family-reviewer-the-right-freedoms.md:136>) excludes a P0/P1 established by source, schema, trace, or official documentation when runtime reproduction is unavailable. That is especially damaging because the plan simultaneously accepts that Sol cannot reproduce Postgres findings.

   Smallest fix: use the wording from this prompt: refuse only on an **established** P0/P1. A command reproduction is strongest, but a file or authoritative contract that directly contradicts the plan also qualifies. Label merely reasoned concerns separately.

4. **P1 — The two-round cap leaves a newly found round-two P0/P1 fix without cross-family verification.**

   Sequence: round two discovers a new P1; Greg/Fable agrees; it is fixed; the cap forbids the review of that new code. That conflicts with the pre-commit review rule.

   Smallest fix: cap P2/P3 churn at two rounds. A newly established P0/P1 gets one narrowly scoped fresh verification after its fix. It does not reopen general discovery.

5. **P2 — The temporary-path census still overstates what was measured.**

   The good measurements survive:

   - 236-prompt corpus;
   - 7 prompts over 100 KB;
   - 46 matching the stated suspicion-led regex;
   - 45 activity logs, 35.6 MB decimal, largest 1,893,217 bytes.

   The path census produces 63 distinct absolute `/tmp` paths and 42 absent on this box. But only 32 of those 42 are Mac Claude scratchpad paths; the other 10 include wrapper output destinations, browser fixtures, application paths, and literal examples such as `/tmp/spideryarn/`. Thus [“Every one of the 42 dead paths”](</home/greg/code/spideryarn2/docs/plans/260904e-give-the-cross-family-reviewer-the-right-freedoms.md:78>) is false, and absence on Hetzner does not prove a Mac path is unrecoverable.

   The `~150 refusals / 14 approvals` ratio also lacks a corpus and classifier. Verdicts such as “ship with changes; I would not ship the current commit” make simple text classification overlap.

   Smallest fix: retain the verified 236/7/46 counts; count only lines that actually designate review evidence; remove the refusal ratio unless its classifier and exclusions are recorded. The qualitative non-convergence evidence can stand without it.

6. **P2 — The Luna relay check adds a stochastic checker to a deterministic transfer problem.**

   [The existing rule already says relay findings verbatim](</home/greg/code/spideryarn2/docs/reusable/codex-cli-as-subagent.md:484>). Having Luna decide whether another model copied prose faithfully can itself omit or mis-segment a finding.

   Smallest fix: require stable finding IDs in the review template and give the implementer the review artefact directly. If a tailored brief is necessary, use a deterministic check that every ID appears exactly once. Drop the Luna call.

7. **P2 — Stage 3, not Stage 2, is overloaded.**

   Stage 2 is one coherent contract-plus-termination change once findings 2–4 are fixed. Stage 3 mixes relay integrity, Fable confinement, model-family taxonomy, and Sol spike routing. It also declares Fable read-only without naming or testing the mechanism; the repo has no custom `.claude/agents` definition, though installed Claude offers restricted agent execution.

   Smallest fix: drop Luna, then split Fable confinement from spike routing. Record one positive read and one denied write before documenting Fable as read-only.

8. **P3 — The plan omits the mandatory important-doc approval checkpoints.**

   Stages 1–3 change `AGENTS.md` and reusable instruction docs. [The governing process](</home/greg/code/spideryarn2/docs/reusable/edit-important-docs.md:41>) requires exact before/after wording and approval for each small set. “Proceed autonomously” does not supply those exact wording approvals.

   Smallest fix: put an explicit before/after approval checkpoint before each rule-changing doc set. Signpost-only edits remain automatic.

## Your suspicions

- **Drop Stage 4 now.** Yes. Enforcing “same tree” and “only one rebuttal” requires durable session metadata containing the repository path, complete working-tree fingerprint—including untracked content—and a used-turn counter. A raw `--resume-session <id>` cannot enforce either invariant. The occasional benefit does not justify this state machine yet.
- **Two-round cap:** keep it only with the new-P0/P1 exception above.
- **Separate template doc:** keep it. Linking it directly from both live instruction docs and the reusable index is enough discoverability, provided it is a literal copyable template and the normative explanation has one owner.
- **Approved scope:** two additions are prerequisites, not widening: stable finding IDs/direct artefact transfer, and the missing full-SOCKS measurement.

## Verdict

**Refuse as written.**

Established P1 facts:

1. Codex 0.152.1’s proxy is not HTTP-only; the plan did not test its documented full SOCKS5 mode.
2. The prescribed revision-range command can return an empty diff for the exact uncommitted candidate the workflow requires reviewing.
3. The refusal and two-round rules can force an established or newly fixed P1 through without the required cross-family verification.

The independent-first prompt shape worked on me: the network-mode omission, empty-diff contract, and evidence-threshold problem emerged before I returned to your four suspicions. The ordering is still advisory because the suspicions are visible in the same message; putting them in a second file or follow-up turn would enforce independence more strongly.