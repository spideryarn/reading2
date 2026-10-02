# Plan review: 261002c commands do more, and an interface-model vision

You are reviewing a PLAN, read-only, before anything is built. Repo: this worktree (TypeScript, React client in src/web).

**Candidate:** commit 23c084574, file `docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md`. Read it first. It quotes the request (from the product owner, Greg — trusted) at the top.

Start with these, which the plan builds on; they do not limit scope:
- src/web/CommandBar.tsx, src/web/command-match.ts, src/web/sub-modes.ts, src/web/activation.ts, src/web/Dock.tsx (DockCommandBar, useActivateMode)
- src/web/Metadata.tsx (RerunSection, RerunRow, ExportSection, TopActions, Section), src/web/PageContents.tsx (reveal), src/rerun-steps.ts
- src/web/useStepJob.ts, src/web/useJobs.ts, src/web/jobEngine.ts, and the server side of POST /api/jobs (find it in src/routes.ts or nearby) — especially what it does with a forced job when one for the same slug/step is queued or running
- src/web/useArchive.ts, src/web/article/ArticlePage.tsx (OwnedArticle)
- docs/project/reading-view-overview.md § The command bar, docs/project/url-state.md, docs/project/chat-tools.md § Security, docs/project/high-powered-ai.md, docs/plans/260906h-mode-catalog-and-a-command-bar.md (the four product calls), docs/plans/261001d-command-bar-lists-sub-modes.md

## What I want from you

An independent attack on the plan: is each stage right, the simplest that delivers the ask, and buildable as written against the code that is actually there? In particular check every factual claim the plan makes about the code (the "What exists" section) — a false premise there is the most expensive kind of finding. Also: is anything missing that would cause a silent failure (a press that does nothing visible, a run that never shows), a double spend, or a security problem (anything that lets untrusted text — an article, a URL — cause an action)? Is the stage order right by value/effort? Is anything here a product decision that should go to Greg rather than be built?

Severity scale — grade by consequence:
- P0 data loss, exploitable security, incorrect charging, service broadly unusable
- P1 user-visible wrong behaviour, or an authoritative contract violated
- P2 design or maintainability risk with no wrong behaviour today
- P3 prose/comment defect

Give every finding an ID (F1, F2, …), a severity, whether it is established (direct evidence: exact source path) or reasoned, the evidence with file:line, and the fix you'd make to the plan. End with a verdict: proceed / proceed with changes / rethink.

## My own suspicions (worth less — spend most of the run elsewhere)

1. Opening a mode right after a forced POST: could activation's generate-on-open start a second, unforced job when no artefact exists yet, and does the server dedupe it?
2. `typedOnly` rows: does the ranking in command-match.ts make "Glossary › Run again" rank above the Glossary mode row when someone types "glossary"? It should not.
3. `?section=` consumed and removed on the Metadata page — any conflict with nuqs/url-state conventions?
4. Archive label that changes with state vs the bar's stated rule that labels do not move.
