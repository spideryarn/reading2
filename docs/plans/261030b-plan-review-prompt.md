You are reviewing a PLAN in this repository (read-only; do not edit files). Read CLAUDE.md first for house rules.

The plan: docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md
Its research: docs/research/261030a-sources-digest-how-others-show-a-papers-citations.md
Base: the worktree HEAD; those two files are new (untracked), plus a one-line index entry in docs/project/research.md. Nothing else changed.

It acts on an admin report (Greg, quoted in the plan) asking for a new Sources sub-mode, a prose "digest" of a piece's
outbound/inbound citations, what it missed and what it miscites, built from many web searches read by Haiku
sub-calls and written by a big model; plus a text box under the digest and under Summary that starts a chat with
its own origin, listed in Chat.

Read for context (start here; this does not limit scope):
- docs/project/sources.md (§ Where it sits, § Opening it is the request, § Where this piece sits, § What a press buys, § Visitors)
- src/situate.ts (the existing literature-search step this mirrors: searchOne/searchAll, checkFindings, isStale/isOutdated, SITUATE_RATE_POLICY), src/web/useSituate.ts, src/web/useWhereAutoRun.ts, src/web/activation.ts § activationForSources
- docs/project/summaries.md § Each sentence is a door too, src/simple-summary.ts § toParagraphs/keptSentences, src/web/SimplePanel.tsx, src/web/on-screen.ts
- docs/project/chat-from-a-mode.md (whole), src/types.ts § ThreadOrigin/ORIGIN_MODES/sameOrigin, src/thread-origin.ts, src/db/schema.ts § chat_threads_origin_*
- docs/project/mode.md § The artefact / Its cost, src/models.ts (task tables, ALWAYS_HIGH_POWER, SITUATE_TRIAGE_MODEL), docs/project/security-map.md

Severity, by consequence: P0 data loss / exploitable security / incorrect charging / service broadly unusable;
P1 user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability risk;
P3 prose. Refuse only on an established P0/P1 (direct evidence, no unresolved inference). Give every finding an
ID (F1, F2, ...), severity, evidence (file:line), and a concrete change.

Review independently first for:
1. Correctness of the design against the existing contracts it claims to follow (press-starts-it vs arrival,
   owner-only/visitor, staleness/outdated/profile, rate allowance, cost ledger, one-chat-per-item and the way back,
   the summary origin word already reserved in the CHECK).
2. Security: untrusted web text flowing into Haiku readers, their follow-up queries, and the writer; anything a
   page could steer into spending or into fetching.
3. Whether the pipeline shape (leads -> searches -> two-round Haiku readers -> Opus writer with checked quotes) is
   sound and bounded, and whether the cost estimate is fairly stated.
4. Anything simpler that gets most of the value, and whether the stage split leaves a coherent tree at each stage.
5. Whether anything the plan says about the code is false (e.g. registration sites, what a handoff can do).

My own suspicions, worth less; spend most of the run elsewhere: (a) whether the summary origin's itemId should be
tied to the summary's generatedAt (does the stored summary have one per level?); (b) whether a chip that auto-runs
a ~$1 job on press, behind the experimental switch, conflicts with any rule; (c) whether storing the readers'
reports could bloat the revision row.

End with a one-line verdict: approve / approve with changes / revise.
