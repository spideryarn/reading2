Review this plan, read-only: docs/plans/260930g-check-for-prior-work-before-building-a-feedback-report.md

It proposes a minimal doc edit to docs/project/feedback-reports.md (read all of it, especially § The run, § A report dispatched is still `unresolved`, § Three ways a report ends, and § Into the Overseer's queue). Also look at scripts/feedback-endings.ts and src/feedback-ending-values.js-or-.ts (the note header `ending:` values, which feed the reader's Earlier tab) and docs/project/overseer.md where it touches the feedback sweep.

Greg (admin) asked for a *minimal* update: a report's session should quickly check for plans/evidence that the work is already done; the Overseer should check whether it already delegated the same idea to another agent. "We don't need to go overboard."

Questions for you:
1. Is the proposed ending for a duplicate right? Already on dev → Shipped (naming the commit); in flight in another session → Declined as a duplicate, naming that report and session. Consider what the reader-facing Earlier tab shows (it reads `ending:` from note headers) — does "declined" mislead Greg into thinking his idea was refused when it is being built? Is there a better choice among the existing three endings, or a `parts`-like mechanism already present that fits? Propose the simplest correct rule.
2. Anything in the plan that contradicts the existing doc, or duplicates text already there (one home per fact)?
3. Anything missing that would make the check fail silently (e.g. searching only by Sentry id)?

Write your findings as a numbered list, each with severity (P0/P1/P2) and a concrete suggested wording where relevant. Be brief.
