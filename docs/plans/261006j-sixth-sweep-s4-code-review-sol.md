**do not ship**

- **C1 — P2 — `tests/sanitize-client.test.ts:292` — reproduced, reported.** Switching to `runtimeImportsOf` weakens the existing guard. Valid code such as `/* parser */ import { JSDOM } from "jsdom";` disappears from the reader’s results; the same happens to a server-sanitizer import. The old checks caught both. In a temporary fixture tree, the actual sanitizer test **passed with both forbidden imports**; removing the leading comments made it fail. The reader also misses `import ("../sanitize.js")`. The underlying helper, `tests/helpers/import-graph.ts:41–52`, is outside this cluster’s edit scope. Fix its parsing and add regression coverage before shipping the conversion.

- **C2 — P3 — `tests/helpers/pg-ready.ts:192` — reproduced, fixed.** A broader alias can change `options.keepPool` during the asynchronous probe. A call typed with `keepPool: true` then returned `{}`, contradicting the new overload. Fixed by capturing the flag before the first await. Added a mocked-pool regression in `tests/pg-ready.test.ts`; it failed before the fix and passed afterward without opening a connection.

The remaining pool audit found no read-before-assignment case: every affected binding is a constant initialized by top-level `await pgReady({ keepPool: true })`. Error paths throw. The fleet `kill` default preserves the previous behavior, all former `process.kill` calls use it, and the delayed SIGKILL sweep reaches it through `signal`. The existing object parameter prevents positional-call breakage.

The heading wait is bounded and followed by assertions requiring the expected heading. The lint changes retain assertions that fail on missing values. Removing erased type imports from the recovery-route expectation is appropriate.

Build preparation covers normal `check`, deploy, and newly created readiness worktrees. **Bare `npm test` and the Mac fresh-clone setup do not build first.** Missing builds therefore fail there; the API bundle tests already required a build before this change. The setup/testing docs should state that prerequisite. The migration suite checks locality before its probe or connection; its module-scope refusal produces a clear collection failure.

Validation: typecheck passed; the four unit files passed **133 tests**; **8 connection-free `pg-ready` cases passed**, with seven excluded by the filter. Lint and `git diff --check` passed. Database preflight failures were excluded from findings.

Only the two C2 files changed. Nothing committed.