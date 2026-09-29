## Findings

- **S1-1 — P2, established:** Jev’s `/api/alpha/decisions` calls were recorded as `wire: "chat"`, contradicting the ledger’s protocol semantics. Added a distinct `decisions` wire, retained `job: "eval"` and metering, and added a row-level regression covering tokens and settled cost. [spend-declarations.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/spend-declarations.ts:368) [declared-spend.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/tests/declared-spend.test.ts:63)

- **S1-2 — P2, established:** The plan double-counted each Jev/Luna side-swapped duplicate as another vote. The independent result is **Jev 4–3 Luna, two ties**, not 8–6 with four ties. All nine mirrored pairs reproduced their original verdict, so the shuffle did not change the outcome. Corrected the plan and control descriptions. [plan](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/docs/plans/260929c-shelf-topics-chosen-by-a-model.md:125)

- **S1-3 — P2, established; not repaired historically:** R6 required every member title, but judge pairs showed only five and `+N more`. This weakens the membership-coherence evidence. Correctly documented in the plan and harness; repairing it requires regenerated pairs and re-judging, prohibited by the no-paid-calls instruction. [make-pairs.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/evals/shelf-topics/make-pairs.ts:7)

- **S1-4 — P3, established:** Invalid external scores were not validated when the shelf had fewer than eight works. No wrong topic escaped, but the stated “invalid values throw” contract was false. Added validation before early returns and a red-first regression. [choose.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/shelf-terms/choose.ts:653) [test](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/tests/shelf-terms-choose.test.ts:625)

- **S1-5 — P3, established:** `summary.md` claimed three-run means and “every recorded call,” although failed runs are excluded from means and the table reads response files rather than the authoritative ledger. Corrected the generator and regenerated the summary. Also fixed the spike’s broken `260929b` plan reference. [summarise.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/evals/shelf-topics/summarise.ts:38)

The remaining seam checks passed review: unset/null behavior is preserved; external quality cannot change membership; tie ordering remains total; NaN/Infinity/negative values are rejected; all nine saved candidate lists match their current cases. Chat arms use `openRouterJson("eval")` inside `withLedger("eval")`; Jev uses the declared, metered bypass. The spend scanner covers `jev.ts`, and a wrong declaration path would leave that tracked file offending.

The plan’s other numbers reproduce from the key and verdicts. Luna-score and Jev-floor each beat baseline 9–0; Luna-order beat Luna-score 6–3; identical controls tied 9/9. The greedy-quality conclusion is supported by both the lists and the Greg-like judgement, though the raw cross-arm means are descriptive rather than a four-way comparison.

## Test tail

```text
Red-first:
2 failed, 74 passed
- Jev wire: expected decisions, received chat
- undersized shelf: expected invalid quality to throw

Focused verification:
Test Files  2 passed
Tests       76 passed

Spend scanner with sandbox-safe file enumeration:
Test Files  1 passed
Tests       36 passed

Typecheck:
✓ src/web/tsconfig.json (370 files)
```

The exact requested command could not complete honestly in this managed sandbox: one run hit `spawnSync git EPERM` inside the spend scanner; later retries were refused by the repository’s memory-admission gate. The chooser portion passed, and the spend suite passed when only its blocked `git ls-files` enumeration was replaced. No paid calls or commits were made.

**Verdict: conditional pass — the implementation and accounting seam are sound after fixes, and the main conclusion holds, but Stage 1 does not fully satisfy R6 until the all-member-title pairs are re-judged.**