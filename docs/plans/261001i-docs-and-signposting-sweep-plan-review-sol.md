## Findings

No P0. Three P1 findings should be resolved before implementation.

### R1 — P1: The after-round can measure teaching to the test

**Evidence:** [plan § Stage 0 and Stage 5](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/plans/261001i-docs-and-signposting-sweep.md:49) reuses the same twelve tasks, while § “simpler option” says their failures will guide the trawl. Stage 3 can therefore add the exact signposts those visible baseline reports request.

An improved score could mean “these twelve answers were documented,” not that unfamiliar work became easier.

**Change:** Treat these twelve as an explicitly in-sample diagnostic. Add a small, newly chosen holdout set whose tasks, keys, and baseline reports remain hidden from the implementer until after the edits. Freeze the keys, rubric, model version, prompt, exact tool-call cap, and commits before editing. Report in-sample and holdout results separately; only the holdout supports a general discoverability claim.

### R2 — P1: Historical plans are not sufficient answer keys

**Evidence:** [tasks](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/plans/261001i-probes/tasks.md:8) describes every task as adjacent work, but the baseline found materially different states:

- [P01](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/plans/261001i-probes/before-P01.md) says most behavior already exists and the remaining hover was deliberately excluded.
- [P05](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/plans/261001i-probes/before-P05.md) finds no Quotes copy button and an unresolved product decision.
- [P11](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/plans/261001i-probes/before-P11.md) finds the requested feature already built.
- [P06](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/plans/261001i-probes/before-P06.md) and P12 are too underspecified for one concrete implementation plan.

Recall against a landed plan may penalize the correct response—“already done,” “stop and ask,” or “need the actual report”—and reward obsolete implementation details.

**Change:** Have Opus use plans only to draft each key, then verify it against current code and owning docs. Each key should specify:

- expected disposition: implement, no-op, diagnose, or ask;
- must-find versus acceptable-alternative docs/helpers;
- task-specific rules and denominator;
- incorrect or duplicative actions.

Score precision as well as recall, including irrelevant files/dead ends. Replace underspecified tasks if the intention is strictly to measure implementation discovery. Use a scorer blind to before/after round.

### R3 — P1: The plan crosses the approval boundary

**Evidence:** Stage 2 commits changes to `documentation-policy.md`; Stages 3–4 directly insert rules whenever the destination is labelled a “non-rule doc.” But [documentation-policy.md § Keeping it true](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/reusable/documentation-policy.md:81) and [edit-important-docs.md § What counts](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/reusable/edit-important-docs.md:13) require before/after approval for:

- everything in `docs/reusable/`;
- all seven entry points;
- rule wording in any project doc.

The classification applies to the proposed wording, not the filename. Greg’s request authorizes the work, but the current process still requires approval of each actual rule change.

**Change:** Add an approval checkpoint after the trawls and before any rule edit. Present at most three small related before/after sets at a time. Treat every newly inserted rule as approval-required regardless of its destination. Only minimal, semantics-preserving pointers and ownership lines should land without approval.

### R4 — P2: The backticked-path check is not yet cheap or sure

**Evidence:** [plan § Stage 2](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/plans/261001i-docs-and-signposting-sweep.md:75) treats every backticked repo-shaped path as a live claim. The existing test explicitly limits itself to claims it can interpret and already needs path aliases and external exceptions; see [doc-links test § resolver](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/tests/doc-links.test.ts:465).

A narrow scan excluding `original-version/` still finds 63 missing-path occurrences, including intentionally historical examples such as “`src/store/import.ts` was deleted.” Syntax alone cannot distinguish those from stale live pointers.

**Change:** Do not land this as a general gate unless current citations acquire an unambiguous syntax, such as a Markdown link or `file § symbol`. If retained, first define its exact corpus, historical/external exclusions, alias resolution, and positive controls, then clear every violation without a broad allowlist.

The equally cheap and surer check is the already-proposed reverse ownership check: for every child parsed from AGENTS.md, require a link back to its owning entry point. It reuses `ownershipFromAgentsMd`; the current tree has 42 missing backlinks, all mechanically decidable and fixable as signposts.

### R5 — P2: A global building-blocks catalogue risks becoming a second home

**Evidence:** Stage 3 proposes listing every helper, while [documentation-policy.md § One home per fact](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/reusable/documentation-policy.md:40) says code facts have one home and docs should cite stable symbols. `web-client.md` already contains a substantial “Where the code is” catalogue.

**Change:** Prefer:

- a short header in each genuinely canonical module saying what it is canonical for and linking to its owning doc;
- a short “shared code” section in the existing domain owner, containing only `file § symbol` plus when to reach for it;
- inclusion only for helpers reused across multiple areas or repeatedly reimplemented.

Do not create an exhaustive repo-wide inventory. If a genuinely cross-domain `shared-code.md` remains useful, `architecture.md` should own it; it should link to domain inventories rather than duplicate them. UI-only building blocks belong in `web-client.md` or their feature/design docs. Header comments plus these short lists are the better default.

### R6 — P2: Reorder and narrow the implementation stages

**Evidence:** Rule proposals currently come in Stage 4, after Stage 3 may already have inserted buried rules. Stage 4 also attempts to process all 103 memories, while Stage 1 ranges across 111 project docs, 139 postmortems, thousands of plans, and code duplication. Meanwhile [plan § Constraints](/home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/plans/261001i-docs-and-signposting-sweep.md:108) asks for frequent merges, which can put unrelated doc changes into the after-round.

**Change:** Use this order:

1. Freeze rubric, keys, tasks, model, and baseline commit; complete all baseline runs before using their findings.
2. Run the read-only trawls.
3. Rank findings by ease × value and select a bounded first batch; record the remainder rather than moving every memory.
4. Present and obtain approval for rule/policy changes.
5. Implement approved policy wording, targeted drift removal, signposts, building-block pointers, and memory moves in small sets.
6. Add each mechanical check red-first, then clear its complete, unambiguous backlog.
7. Run the after-round before merging unrelated `dev` changes, or run both snapshots in isolated worktrees. Record exact commits.
8. Merge current `dev`, resolve concurrent edits by rereading both sides, and rerun gates; do not attribute post-baseline third-party changes to this sweep.

Stage 0 may remain parallel with read-only trawls, but no edits or selection informed by probe output should begin until the baseline and frozen scoring artefacts are complete.