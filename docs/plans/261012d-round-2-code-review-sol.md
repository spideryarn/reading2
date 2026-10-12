Implemented five review findings; no wider issues remain.

- **R2-1 · P1 · FIXED** — [ConversationModes.tsx:1449](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/modes/conversation/ConversationModes.tsx:1449): the main Chat-list composer bypassed the refusal-preserving send path, so a refused first mentioned question disappeared. Routed it through `sendTo`. Regression test: [chat-visible-blocks-reach-the-server.test.tsx:169](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/tests/chat-visible-blocks-reach-the-server.test.tsx:169).

- **R2-2 · P1 · FIXED** — [controller.ts:383](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/chat/controller.ts:383), [effects.ts:168](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/chat/effects.ts:168): network loss and an empty stream were treated like definite refusals, making an uncertain write resendable; an empty stream could also leave the first composer latched. Definite 4xx refusals now restore the composer, while uncertain failures open the local failed thread without enabling a duplicate send. Tests: [chat-mentions-client.test.tsx:126](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/tests/chat-mentions-client.test.tsx:126).

- **R2-3 · P1 · FIXED** — [mentions.ts:206](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/web/mentions.ts:206): chip × removed the first matching `@Title`, potentially deleting identical text the reader wrote earlier. Insertions now retain and update their exact anchor; edited inserted text is preserved. Tests: [chat-mention-picker.test.tsx:365](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/tests/chat-mention-picker.test.tsx:365).

- **R2-4 · P2 · FIXED** — [q-jzx20h.md:36](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/docs/user-feedback/questions/q-jzx20h.md:36): the question still said mentions were unbuilt and described obsolete UI. Corrected it and regenerated the feedback-question corpus.

- **R2-5 · P3 · FIXED** — [chat-mention-limits.ts:11](/var/tmp/spideryarn-worktrees/fba63vmt-chat-at-mention-articles/src/chat-mention-limits.ts:11): corrected the stale 42k-token estimate to the measured 53k.

Successful sends clearing drafts/chips, existing-conversation refusals preserving them, archived-article availability, three-per-question/thread limits, deletion behavior, security ownership checks, picker ranking/normalisation, pointer handling, and the remaining documentation claims all checked out.

Verification:

- Requested suite: 54 files passed; 945 tests passed, 1 skipped.
- Typecheck passed across all four projects.
- Feedback-endings check passed: 576 reports and 47 questions.
- `git diff --check` passed.
- Lint produced only existing complexity advisories.
- Full `npm test` could not start its database lane because this sandbox denies connecting to local PostgreSQL (`EPERM 127.0.0.1:54362`).
- No commit made; the two pre-existing untracked review files were untouched.

APPROVE WITH FIXES APPLIED