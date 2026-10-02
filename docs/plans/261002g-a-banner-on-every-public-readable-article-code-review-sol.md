Reviewed and fixed the in-scope defects. No private-data or unsafe-address exposure was found.

Security verdict:

- `publicSourceGuessQuery` rechecks both slug and public visibility, joins the guess to that same article, and only selects found guesses.
- The DTO reapplies `publicSourceUrl`, derives the hostname from the accepted URL, and projects no internal fields.
- `useSourceGuess` remains owner-only. A visitor’s guess causes no `POST /api/source-guess`.
- Visitor Masthead `OriginLine` and owner Metadata do not expose the guess. The two intended visitor surfaces are the banner and the details-page source row.
- The `access.ts` mapping is correct under `exactOptionalPropertyTypes`.

Findings:

- **P0 — None.**

- **P1 — Fixed:** A shared upload’s found source disappeared on the visitor details page because `SourceRow` only accepted the recorded URL. It now falls back to the sanitized guess, labels it as a guess, and does not reveal that the article was uploaded. [PublicPages.tsx:50](/home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/PublicPages.tsx:50), regression test at [metadata-origin.test.tsx:336](/home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/metadata-origin.test.tsx:336).

- **P2 — Fixed:** The SQL test proved visibility filtering but not that the guess belonged to the same article, allowing a broken join to pass. Added an explicit join assertion. [public-reads.test.ts:477](/home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/public-reads.test.ts:477).

- **P2 — Fixed:** There was no wire-to-render regression test proving that a public guess reaches the UI without triggering the owner-only endpoint. Added one. [public-network-trace.test.tsx:1015](/home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/public-network-trace.test.tsx:1015).

- **P2 — Fixed:** The owner-facing provenance row described every source as the original, which overclaimed for matching guesses and alternate published URLs. Its wording now accurately distinguishes a source link from a matched upload page. [messages.ts:4224](/home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/messages.ts:4224).

- **P2 — Fixed:** The public-sharing explanation implied that absence of a publishable recorded URL always meant no guess. It now separately explains uploaded files and clearly marked matching guesses. [PublicReadableSharingPage.tsx:241](/home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/PublicReadableSharingPage.tsx:241).

- **P2 — Not fixed, wider/unrelated:** The full public-network trace has one existing failure in the owner-note gutter test; 75 tests pass, including the new source-guess case. [public-network-trace.test.tsx:2372](/home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/public-network-trace.test.tsx:2372).

No narrow-window layout defect was apparent: the reused source styles wrap, permit shrinking, and the details row also wraps.

Checks passed: focused suites for metadata, banner, public reads, sharing copy, shared inventory, and the new network case; lint; and `git diff --check`. `npm run typecheck` itself was blocked by the sandbox denying tsx’s IPC socket, but its underlying command passed all four TypeScript projects. The PostgreSQL test was attempted but could not connect to local Postgres because the sandbox denied `127.0.0.1:54362`. No commit was made.