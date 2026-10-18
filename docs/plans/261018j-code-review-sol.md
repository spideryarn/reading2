# GPT Sol code review of 261018j, 2026-10-18

Up: [261018j](261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md). On `d5aafcd19`, gpt-5.6-sol, effort high, `--sandbox workspace-write`; the reviewer fixed what it found.

- C1 — P2 — [src/fetch.ts:2717](/var/tmp/spideryarn-worktrees/qi-pfnjyj6d-europe-pmc-and-saved-address/src/fetch.ts:2717): Prefix-only path validation allowed encoded-separator and double-encoded traversal shapes to reach DNS. **FIXED** with an exact allowlist for the two required REST resources. [The regression test](/var/tmp/spideryarn-worktrees/qi-pfnjyj6d-europe-pmc-and-saved-address/tests/europe-pmc.test.ts:44) failed red with `connection` instead of `blocked-address`, then passed and verifies neither DNS nor fetch runs.

- C2 — P2 — [src/fetch.ts:2723](/var/tmp/spideryarn-worktrees/qi-pfnjyj6d-europe-pmc-and-saved-address/src/fetch.ts:2723): WHATWG URL parsing erases an explicitly supplied default `:443`, so the “no port” check accepted it. **FIXED** by validating the supplied authority before normalization. [The regression test](/var/tmp/spideryarn-worktrees/qi-pfnjyj6d-europe-pmc-and-saved-address/tests/europe-pmc.test.ts:50) failed red by reaching the connection path, then passed before DNS.

- C3 — P2 — [src/fetch.ts:2755](/var/tmp/spideryarn-worktrees/qi-pfnjyj6d-europe-pmc-and-saved-address/src/fetch.ts:2755): XML declared as UTF-16 was accepted when its bytes happened to decode as UTF-8. **FIXED** by rejecting declared non-UTF-8 charsets and retaining fatal byte decoding. [Tests](/var/tmp/spideryarn-worktrees/qi-pfnjyj6d-europe-pmc-and-saved-address/tests/europe-pmc.test.ts:107) cover both a UTF-16 declaration and UTF-16 BOM bytes; the declaration case failed red before the fix.

- C4 — P2 — [src/jats.ts:46](/var/tmp/spideryarn-worktrees/qi-pfnjyj6d-europe-pmc-and-saved-address/src/jats.ts:46): JATS bounded element count and output size but not nesting depth, while conversion is recursive. **FIXED** with an iterative pre-conversion depth/element walk and a 512-level limit. [The 2,000-level regression test](/var/tmp/spideryarn-worktrees/qi-pfnjyj6d-europe-pmc-and-saved-address/tests/jats.test.ts:227) failed red by converting successfully, then passed with `too-large`.

Commands run:

- `npx vitest run tests/europe-pmc.test.ts` — 23 passed.
- JATS tests excluding the sandbox-forbidden local-server group — 50 passed, 6 skipped.
- Nine fallback, saved-address, public DTO/UI, source-guess, extraction-base, paper-source, bookmarklet, and asked-address suites — 562 passed.
- Full local-server JATS group could not bind `127.0.0.1` (`EPERM`); its non-socket declaration cases passed.
- PostgreSQL lifecycle suites could not connect to `127.0.0.1:54362` (`EPERM`); no database result inferred.
- `npm run typecheck` could not create the `tsx` IPC socket (`EPERM`). Direct `tsc --noEmit` for all four project configs passed.
- Biome — no errors; two informational complexity advisories in `jats.ts`.
- `git diff --check` — passed.

SHIP AFTER FIXES (MADE)