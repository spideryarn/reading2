# Plan review: 261007l, an Opus check over Referee's hidden-text findings

You are reviewing a plan, read-only. Do not change any file.

Plan: `docs/plans/261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md`
(untracked file in this worktree). Background plan it extends:
`docs/plans/261007h-referee-hidden-instructions-become-a-sub-mode-in-plain-words.md` (§ Deferred, § Questions for Greg).

Code to check the plan against: `src/injection-scan.ts`, `src/injection-scan-types.ts`, `src/source-scan.ts`,
`src/web/SourceScanNotice.tsx`, `src/web/modes/referee/RefereeMode.tsx`, `src/referee-mirror.ts` (the precedent:
`newFence`/`fenced`, `mirrorStream`, validation), `src/web/useMirror.ts`, `src/models.ts` (`ALWAYS_HIGH_POWER`, task tables),
`src/ai-call.ts` (`AI_JOB_ROUTE`, `openRouterStream`), `src/cost-categories.ts`, `src/routes.ts` (the scan route around
`/api/referee/scan/` and Mirror's POST route), `docs/project/referee-mode.md`, `docs/project/security.md`.

Questions:
1. Does the security property hold as designed — can a hostile fragment, via Opus's answer, delete, reorder, hide or
   visually disguise a row, change the headline counts or the chip mark? Name any path.
2. Is the scanner change (`context?` on findings) truly behaviour-neutral for what it finds/labels/caps/drops? Any
   cost (performance on a 1.3 MB page, `MAX_FINDINGS` × block textContent) or leakage concern (context is sent to the
   client by the existing GET scan route)?
3. Is moving `grouped` to a shared leaf and keying judgments by group key sound? Any mismatch between server and client order?
4. Anything simpler that gets Greg's ask at lower cost? Anything the plan misses among the registries a new streaming
   job must join?
5. Is "not stored" the right call here given CLAUDE.md's "Store when it happened" rule?

Severity scale: P0 (security or data loss), P1 (wrong behaviour shipped), P2 (worth fixing), P3 (nit).
Give every finding an ID (F1, F2…), a severity, the evidence (file:line), and a suggested fix. End with a verdict:
ready / ready after fixes / not ready.
