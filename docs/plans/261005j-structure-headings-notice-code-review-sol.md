**Verdict: do not ship.** Two established findings remain unfixed.

- **F1 — P1, established; not fixed.** [StructureNotice.tsx:141](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/src/web/StructureNotice.tsx:141) treats every same-article structure completion as this button’s success. `useStepJob` deliberately announces jobs started elsewhere. Opening Structure in one tab while another tab retries therefore triggers an arc POST and displays “Finished” without a local press. If another matching job subsequently fails or is cancelled, the latched `finished` flag can also hide its failure behind “Finished. Reload.” Track the ID returned by the local action, including retries, and trigger the successor once for that job’s successful completion.

- **F2 — P1, established; not fixed.** [StructureNotice.tsx:61](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/src/web/StructureNotice.tsx:61) says every displayed entry is an author’s heading. The bounded fallback also names sections from opening paragraph words, or a stock title ([heading-tree.ts:451](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/src/heading-tree.ts:451)). This misstates provenance. Suggested wording: “This outline uses the document’s headings and opening words. The fuller version, with a line on what each section says, could not be made.”

The remaining checks:

- **Acceptance and publication:** the source path accepts the named, forced structure-only request for an owned, published article. The slug-only route reserves no import slot; successful settlement publishes its draft, and pending labels queue their successor. The added integration test bypasses HTTP acceptance by inserting the job directly.
- **Visitors:** the notice renders, but `Again` never mounts, so this feature creates no queue subscription, POST or poll.
- **Arc:** the unforced step checks its fingerprint, which excludes paragraph labels. An identical fallback with a current arc skips the call. An isolated failed or cancelled structure job produces no completion announcement. F1 breaks the ownership and success-display guarantees.
- **Other extras:** checked preservation for every listed extra and traced **Quiz, Simple Summary and Relations** through their consumers. Quiz detects a changed tree, disables stale marking and suppresses stale prose questions. Simple Summary and Relations address preserved paragraph IDs. No tree-swap crash or incorrect passage association was found.
- **Layout:** the grid shrinks beneath the notice and remeasures its available height. That supports the intended behavior, but actual overflow remains unverified: these jsdom tests provide widths, not rendered heights.
- **Quotation:** Greg’s paragraph matches exactly after Markdown line unwrapping. No other added text is presented as his quoted words.

**Validation:** typechecking passed using `node --import tsx scripts/typecheck.ts`; the npm wrapper failed on sandbox IPC. Both permitted Vitest attempts were refused before collection by memory admission, so **no tests ran**. I left fixes unapplied because their required red-first verification was unavailable.

**Files changed:** none. No commits or tree/index-changing git commands.