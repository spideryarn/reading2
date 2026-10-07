I read the plan, the requested policies, W3/W4, and a sample of the source memories. The directory is readable: **85 files plus the index; three files are unindexed.** No files changed.

1. **PR-1 — P1: A file-level status can conceal an unported lesson.**  
   Rules 1–2 and Stage 1 allow one “already in” destination for a memory containing several distinct lessons. W3 explicitly marks `tmux-outlives-closed-tabs` and `browser-agents-measure-a-moving-tree` as **partly moved — keep**. The latter also contains a later lesson about stale written surveys. Finding its browser warning in docs does not establish full coverage. Sol’s sample cannot certify every file for deletion.  
   **Smallest fix:** Keep one row per file, but list separate dispositions for its distinct lessons. Allow “partly covered; retain.” Check every deletion-eligible row against the complete memory and its destinations.

2. **PR-2 — P1: “Proposed” is not “ported,” but pruning has no explicit gate.**  
   Rule 7 leaves deletion to the Overseer “after reading the mapping.” Neither the table nor the completion condition distinguishes a pending proposal from an approved, landed rule. The mapping could therefore prompt removal while the owning doc still lacks the lesson.  
   **Smallest fix:** Add an explicit `retain / eligible for deletion` field. Pending proposals and partial ports stay `retain` until approved changes land and their coverage is verified.

3. **PR-3 — P1: Rule 3 protects selected documents, rather than every rule.**  
   Its list omits rule wording in `version-control.md`, `worktrees.md`, `testing.md`, `database.md`, and other destinations. The exception for Overseer traps is demonstrably wrong: that section already says “Never auto-retry keystrokes” and “Address a session … never by name.” The Overseer’s own [editing restriction](../project/overseer.md#on-editing-docs-whose-wording-is-a-rule) is narrower still. A subagent cannot safely use the section heading as permission.  
   **Smallest fix:** Apply the boundary everywhere: any addition or change to an obligation, prohibition, permission, or required workflow becomes a proposal. Remove the trap-section exemption; uncertain cases become proposals.

4. **PR-4 — P0: Quotation marks in model-written memory do not establish Greg’s words.**  
   Rule 4 permits an invented or altered quotation to acquire authoritative attribution. It also turns unverified paraphrases and dates into direct “Greg, date” assertions. Stage 3 checks against the same secondary source, so it cannot catch this.  
   **Smallest fix:** Require an original user message or another verified primary record for every new Greg quote and attribution. Without it, record “The memory reports …; attribution unverified,” and retain the unresolved source. Apply this check to reviewer edits too.

5. **PR-5 — P1: Rule 6 can discard a lasting lesson with an obsolete incident.**  
   `codex-cli-404s-on-this-box.md` combines a resolved outage and an obsolete Fable fallback with enduring lessons about checking review exit status and answer files. `public-read-audit-plan-not-built.md` combines dated delivery status with transferable testing and reference-sweep lessons. A finished job does not make everything remembered about it disposable.  
   **Smallest fix:** Drop obsolete **claims**, not whole files, until their remaining lessons are individually covered. Give dropped claims their verification evidence.

6. **PR-6 — P1: The credential rule can erase permission limits.**  
   Rule 5 reduces credential memories to “it exists, and where the doc for it is.” But `supabase-access-token-needs-greg-each-time.md` chiefly records the requirement for fresh permission on every use. The production-access memory also preserves transaction-pooler safety constraints. Neither is a secret value.  
   **Smallest fix:** Redact values while preserving approval scope, restrictions, and safe handling. Route rule additions through proposals. Apply redaction to reports and before/after proposals as well as destination docs.

7. **PR-7 — P1: The parallel editing split has explicit shared destinations.**  
   B and C both edit `testing.md`; A and B both target `overseer.md`. Concurrent writes can lose an insertion while both agents report it as moved, or create duplicate homes after both search before either writes. “Overlap as little as possible” is not ownership.  
   **Smallest fix:** Run the four analyses in parallel, returning suggested edits and mapping rows; let one orchestrator apply edits sequentially. This is cheaper than separate worktrees and reconciliation.

8. **PR-8 — P1: Filename completeness does not identify the source version checked.**  
   The source directory is live. A memory can gain a lesson under the same filename after being reviewed; the bidirectional filename check still passes, and later pruning removes the unchecked addition.  
   **Smallest fix:** Record each reviewed file’s content hash. Before pruning, require that hash still to match. Also have the completeness check reject duplicate rows explicitly, and inspect `MEMORY.md` for any index-only information.

The filename checker is proportionate; it needs no elaborate framework. The avoidable process is four concurrent editors and a fixing reviewer mutating the evidence after assembly. Parallel analysis, one writer, and a final read-only review would simplify this job.

**Verdict: not ready to build; PR-1 through PR-8 block.**