# Code review: Situate stage 3, the Marginalia `literature` kind (261024o)

You are reviewing **uncommitted code** in this worktree for Spideryarn. House rule: **you fix what
you find** inside this stage, in the working tree, and report anything wider. Do not commit, push,
deploy, touch production, `.env.local`, `infra/` or systemd, or make paid model calls. Never run git
commands that discard work.

**The plan**: `docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md`
(§ Marginalia: a `literature` kind). Read `docs/project/marginalia.md` for the column's rules (one
shut line per kind per block for other modes' items; read halves; owner only). Stage 1 is committed
(`8cf25115e`); stage 2 (the dossier, reviewed by you in `docs/plans/261024o-stage2-code-review-sol.md`)
is uncommitted in the tree and lands with this stage.

**In scope**: `git diff HEAD --` on `src/web/marginalia/notes.ts`,
`src/web/marginalia/MarginaliaColumn.tsx`, `src/web/marginalia/tips.ts`, `src/web/BlockLinkCard.tsx`,
`src/web/styles/marginalia.css`, `src/web/item-focus.ts`, `src/web/reader/Reader.tsx`,
`docs/project/marginalia.md`, `src/web/help/pages/modes/marginalia.md`; the stage-3 additions to
`src/web/SituateDossier.tsx`, `src/web/InvestigatePanel.tsx`, `src/web/modes/sources/SourcesMode.tsx`
(focus landing on a finding); tests `tests/marginalia-literature.test.tsx` (new),
`tests/situate-dossier.test.tsx`, `tests/sources-focus.test.ts`,
`tests/a-broken-mode-leaves-the-article-readable.test.tsx`.

Builder's choices: the shut line's stamp stays inside the one toggle button, so the jump to Sources
is an **Open in Sources** button per finding in the opened half; landing uses `ItemFocus` /
`useLandOnItem` keyed on the finding's stable id, no URL parameter; a stale dossier is not handed to
the margin at all.

## Look hardest at

1. **Visitors and the switch**: no `/api/situate` request for a visitor, a shared/public reader, or
   with the experimental switch off; nothing runs when the column opens.
2. **Placement**: the stored quote re-checked against the block's current text; a finding whose
   block is gone or changed is not drawn; one shut line per block for this kind.
3. **Untrusted text and links**: model notes and source titles as text; `href` only for http(s)
   (stage 2 added `isWebUrl` at the dossier's sink — is the margin's sink equally guarded?).
4. **Focus**: the finding focus is cleared/handed back on every path (switch off, unknown id, mode
   change), cannot loop, and does not fight Investigate's "reopen the newest chat" on arrival.
5. **Contracts** marginalia.md states (grouped order, read halves, `useStepFinished` refresh, the card
   text table) and whether `BlockLinkCard`'s `data-marg-when` change is safe for the other kinds.

Grade P0–P3 with IDs (`M1`…), evidence file:line, what you changed or why not. Run `npm run typecheck`
(or `node --import tsx scripts/typecheck.ts` if the sandbox blocks tsx's pipe) and
`npx vitest run tests/marginalia-literature.test.tsx tests/situate-dossier.test.tsx
tests/sources-focus.test.ts tests/a-broken-mode-leaves-the-article-readable.test.tsx tests/doc-links.test.ts
tests/help-corpus.test.ts` plus any `tests/marginalia*` file; say what is green. One-paragraph verdict.
