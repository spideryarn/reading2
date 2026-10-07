**Verdict: land with my fixes.** No P0–P2 findings.

- **P3 — stale availability comments.** [acts-alone.ts](/var/tmp/spideryarn-worktrees/guide-opens-stored-modes/src/acts-alone.ts:35) referenced removed `madeNow`; `guide.ts` claimed a separate page-side read. Corrected both to describe the server snapshot and unarmed opening.
- **P3 — stale activation comments.** Corrected `guide-acts.ts`, `CommandChip.tsx`, and `Reader.tsx` to distinguish automatic unarmed openings from reader presses.
- **P3 — inaccurate prompt documentation.** [chat-tools.md](/var/tmp/spideryarn-worktrees/guide-opens-stored-modes/docs/project/chat-tools.md:975) excluded already-made buttons from “I’ve opened…” wording. Corrected it.

The behavioral paths look sound: automatic mode acts never fall back to `runners.mode`; Brief/Fuller avoid mounting Thread; names and keys agree; `opensFree` stays outside stored and client messages. Route read failures omit eligibility without failing the turn or logging error text. Added explicit retry/edit and recovery assertions.

Validation after edits: **168 tests passed across 10 unit files**; the typecheck script passed via `node --import tsx scripts/typecheck.ts`. Lint reported existing Reader warnings only.

The exact requested commands were attempted but hit sandbox restrictions: `tsx` IPC was denied, and local Postgres/Docker access was denied. `guide-route` and `guide-experience-pg` still need rerunning outside this sandbox.

No commits, deployment, or remote database actions.