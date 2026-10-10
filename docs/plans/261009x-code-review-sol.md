1. **P3 — malformed keys matched the behind-switch allowlist.** The lookup previously treated `chat:referee` and `mode:referee:claims` as valid catalogue keys. Evidence: [mode-catalog.ts:717](/var/tmp/spideryarn-worktrees/fbh5aypq-peer-review-research/src/mode-catalog.ts:717). **Fixed:** require exact `mode:<name>` or `submode:<name>:<view>` shapes while retaining the prototype guard; added regression cases at [guide-offers-behind-the-switch.test.ts:33](/var/tmp/spideryarn-worktrees/fbh5aypq-peer-review-research/tests/guide-offers-behind-the-switch.test.ts:33). The test failed before the fix.

No further findings. The guide-only door covers inline chips and next-step buttons inside `Conversation`; ordinary Chat, visitors, Dock, command bar, Metadata, and spoken Guide remain outside it. Memo identities are stable, Referee remains press-only, and the made/free machinery is unaffected.

Checks:

- Requested Vitest subset: 4 files, 56 tests passed.
- Typecheck: the npm command was blocked by sandbox IPC permissions; the same script via `node --import tsx scripts/typecheck.ts` passed all projects and source coverage.
- Scoped Biome lint: passed.
- Paid eval: not run.

**Verdict: approve; one P3 fixed, with no remaining blocking findings.**