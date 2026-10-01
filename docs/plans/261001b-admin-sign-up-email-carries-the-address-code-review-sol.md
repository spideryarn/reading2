No open code findings remain after fixes.

### Findings

- P0: None.
- P1 — Fixed: [src/store/admin-accounts.ts:461](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/src/store/admin-accounts.ts:461) rejected Supabase’s valid `{ user: … }` response envelope, causing upgrade notices to omit an available address. Both raw and enveloped users are now accepted, with the owner-ID check preserved.
- P2 — Fixed: [tests/admin-notice-address.test.ts:77](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/tests/admin-notice-address.test.ts:77) simulated a timeout by throwing immediately. It now verifies a stalled fetch receives a five-second abort signal and still reaches `notifyAdmin`; response-body secrecy is also pinned.
- P2 — Fixed: [tests/reader-arrivals.test.ts:226](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/tests/reader-arrivals.test.ts:226) claimed to test route wiring but called `noteArrival` directly. It now observes the real `routes.ts` call and checks the verified JWT address.
- P2 — Fixed: [tests/privacy-page.test.ts:116](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/tests/privacy-page.test.ts:116) now pins sign-up timing, upgrades, plan names, address/account ID, Resend, and Namecheap forwarding.

The prior plan-review findings are otherwise addressed: no import cycle, lookup failures remain bounded and non-throwing, mismatched IDs cannot disclose another account’s address, bodies/addresses do not reach errors or logs, and the privacy/docs wording matches the implementation.

Checks:

- 52 unit tests passed across `admin-notice-address`, `privacy-page`, and `admin-accounts`.
- Cycle check, lint, and `git diff --check` passed.
- The requested five-file command could not start its Postgres lane because this sandbox forbids connecting to `127.0.0.1:54362`.
- `npm run typecheck` exited 1 because the sandbox forbids `tsx`’s local IPC socket. The equivalent `node --import tsx scripts/typecheck.ts` exited 0 across all 2,474 files.

Verdict: **ship after my fixes**, after rerunning the two Postgres-backed focused tests outside this restricted sandbox.