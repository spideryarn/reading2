## Verdict

Ready after fixes. The stated client contract is accurate:

- Normal generate requests omit `useProfile`, so the server uses the profile.
- Glossary/Quotes “Find more” preserves the list’s recorded `profiled` value. When true, the serializer omits the field; when false, it sends `useProfile: false`.
- Candidates chat explicitly sends `false`.
- No other production client path can currently send `false`. Direct comment/live requests omit it.
- Removing `automatic` from the affected auto-run hooks did not remove other behaviour.

## Findings

- **F5 · P1 · Fixed** — [the-ideas-extraction-changed-no-requests.test.tsx:728](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/tests/the-ideas-extraction-changed-no-requests.test.tsx:728) still expected six reader-profile requests made by the deleted checkbox machinery. Updated both Ideas and Chat network traces.  
  Red: 2/3 failed. Green: 3/3 passed.

- **F6 · P3 · Fixed** — Several comments/docs still described the checkbox as present or gave obsolete request counts, principally [ProfilePanel.tsx:120](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/web/ProfilePanel.tsx:120), [useAutoRun.ts:103](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/web/useAutoRun.ts:103), and [reader-profile.md:423](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/docs/project/reader-profile.md:423). Corrected the affected client, test, billing, and project-documentation wording. No behavioural red-first test applied; the relevant 152-test batch remained green.

- **F7 · P2 · Fixed** — [Tweets.tsx:530](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/web/Tweets.tsx:530) retained a redundant fragment after its profile wrapper was removed. Removed it. Relevant regression tests: 13/13 passed.

- **F8 · P3 · Reported** — Forbidden server files retain obsolete checkbox explanations at [routes.ts:2495](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/routes.ts:2495), [jobs.ts:2917](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/jobs.ts:2917), and [jobs.ts:3506](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/jobs.ts:3506). Runtime semantics remain valid; only the rationale is stale. Not fixed per scope.

The CSS audit found no orphaned layout dependency: `.chat-composer` wrapping and the dictation row’s full-width basis remain explicitly owned, and the Remember ordering still works without `.prof-row`.

Verification: 174 scoped tests passed, touched-file lint had no errors, and `git diff --check` passed. The Postgres-dependent `jobs.test.ts` was not run; an attempted mixed invocation stopped during database setup without running tests. No commit was made.