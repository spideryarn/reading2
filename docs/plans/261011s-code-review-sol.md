Implemented the security fixes. I found no remaining article-controlled path that can auto-save text beyond the deliberately allowed case, whitespace, and terminal-punctuation differences.

Key fixes:

- Hardened [save-closeness.ts](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/save-closeness.ts:34):
  - rejects NFKC and Unicode case-folding substitutions such as `K` for `K`;
  - recognizes astral letters, combining marks, and invisible format controls at word boundaries;
  - catches negations anywhere earlier in the sentence;
  - requires whitespace between About-you’s basis and appended text, preventing `evil.` + `com`;
  - keeps the existing case, whitespace-folding, and trailing-punctuation allowances.
- Scoped `typed:true` to new Guide questions at both the [route](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/routes.ts:3308) and [conversation sender](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/modes/conversation/ConversationModes.tsx:1325). Chat, Learn, ChatDialog, suggestions, edits, retries, and Live speech cannot carry it. Composer—including dictation and a typed send after Live stops—and the reader-authored command-bar handoff can.
- Made guide handoff types prevent app/model text from waiting in a composer and later being laundered as reader-typed text.
- Restricted completion marking in [controller.ts](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/chat/controller.ts:765) to begun, non-superseded, typed Guide operations. Failed, disconnected, recovered, unbegun, and unrelated turns do not qualify.
- Preserved an in-flight autonomous write across unmounts, so a remounted [GuideSaveOffer](/var/tmp/spideryarn-worktrees/fbyk3r03-guide-saves-profile/src/web/GuideSaveOffer.tsx:202) waits, rereads, and shows Saved with Undo. StrictMode still starts only one write.
- Corrected stale provenance and “press-only” comments.

Verification:

- Focused suite: 5 files, 99 tests passed.
- Additional Unicode matcher regression suite: 14 tests passed.
- Typecheck passed for all 3,700 covered source files. The `npm run typecheck` wrapper itself could not create its `tsx` IPC socket in the sandbox (`EPERM`), so I ran its exact underlying command, `node --import tsx scripts/typecheck.ts`.
- `tests/guide-route.test.ts` could not collect because sandbox Postgres at `127.0.0.1:54362` was unavailable.
- Targeted Biome lint had no errors; only existing complexity notices. `git diff --check` passed.

Findings:

- **P1 — fixed by me:** Unicode normalization/case-folding and word-boundary tricks could save characters the reader did not type.
- **P1 — fixed by me:** About-you’s basis could concatenate with the quoted suffix without a separator, manufacturing a token or URL.
- **P2 — fixed by me:** completion provenance included unbegun, superseded, and non-Guide/non-typed turns.
- **P2 — fixed by me:** unmounting during the autonomous PATCH could leave a landed write without visible Undo.
- **P2 — fixed by me:** `typed` provenance was accepted outside Guide and could be propagated through ordinary Chat/Learn sends.
- **P2 — left for you:** the existing GET/check/unconditional-PATCH sequence is not server-side compare-and-set. Another reader-controlled tab can overwrite the field during the millisecond-scale gap. This is documented in the plan and is not reachable by the planted-article attacker alone.
- **P3 — fixed by me:** missing adversarial tests and stale comments around provenance and autonomous saves.

**Verdict: land with fixes.**