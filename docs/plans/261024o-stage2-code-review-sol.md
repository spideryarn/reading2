## Findings

- **D1 — P1: stage initially failed typechecking due to missing imports.** `ItemFocus` and `useEffect` were referenced without imports. They were corrected concurrently during review and are now present at [InvestigatePanel.tsx:78](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/InvestigatePanel.tsx:78) and [SourcesMode.tsx:57](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/modes/sources/SourcesMode.tsx:57).

- **D2 — P1: stored source URLs reached an active `href` without validation.** A damaged/imported dossier could contain `javascript:` even though newly generated rows are server-filtered. Fixed by rechecking with `isWebUrl` at the rendering sink and showing unsafe addresses as plain text: [SituateDossier.tsx:285](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/SituateDossier.tsx:285). Added an injection regression test covering the URL, title, and quote: [situate-dossier.test.tsx:384](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/tests/situate-dossier.test.tsx:384).

- **D3 — P1: the privacy disclosure did not accurately describe stage 1’s transfers.** It blurred the planning and final model calls, implied Exa separately received article metadata, and described only the profile rather than both “About you” and reading purpose. Corrected the pre-press disclosure at [situate-dossier.ts:35](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/situate-dossier.ts:35), the public page at [PrivacyPage.tsx:491](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/PrivacyPage.tsx:491), its test, project docs, Sources help, and generated help corpus.

- **D4 — P2, wider and not changed: a finding’s stable ID is not part of its chat origin.** The chat origin instead contains a lens derived from the model-written quote and note at [SituateDossier.tsx:84](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/SituateDossier.tsx:84) and [situate-dossier.ts:145](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/situate-dossier.ts:145). `threadForOrigin` compares origins at [useChatAnchors.ts:323](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/useChatAnchors.ts:323), while the server explicitly allows a rerun to reword the note without changing the stable finding ID at [situate.ts:870](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/situate.ts:870). Thus the immediate 600-character round-trip works, but a rerun can lose the finding’s existing chat mark and permit a duplicate chat. A durable fix needs the chat-origin/schema path to carry the finding ID, crossing the stage-2 client boundary.

## Validation

- Requested typecheck: **green**, all 3,964 files covered.
- Requested Vitest selection: **green**, 5 files; 105 passed, 1 skipped.
- Scoped Biome check: **green**.
- Scoped `git diff --check`: **green**.
- I also attempted `npm test`; it could not start because local PostgreSQL was unavailable at `127.0.0.1:54362`, and the sandbox denied Docker inspection. No test failure was reached.

Verdict: Stage 2 now avoids automatic paid work, distinguishes ordinary and forced runs correctly, safely renders untrusted text and links, refreshes through the job machinery, and truthfully discloses the provider flow. The requested gates are green, but D4 means the plan’s durable “chat still finds the finding after regeneration” promise is not yet fully met; I would resolve that wider origin-model issue before calling the complete feature finished.