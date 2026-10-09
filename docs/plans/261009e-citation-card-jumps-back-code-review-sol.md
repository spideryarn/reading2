Fixed five issues; no high-severity findings remain.

- Medium — focus entering the card did not cancel an already scheduled pointer-close. It now clears both pending timers in [useHoverCard.ts](/var/tmp/spideryarn-worktrees/fbtsd470-citations-jump-back/src/web/useHoverCard.ts:972).
- Medium — tabbing from the card’s last control into browser chrome left it stuck open. Added `focusout` handling. `ProseHoverCard` is the only production `useHoverCard` consumer, so term, citation, quote, link, and note cards all receive the corrected behavior.
- Medium — numbered jumps inherited `BlockRef`’s ID font and 50% opacity, making links quieter than the current unlinked number. Styling now uses UI typography, clear link treatment, and a quieter current location.
- Medium — touch targets were roughly 27×25px. They now grow to 40×40px under `any-pointer: coarse` in [prose-hover-card.css](/var/tmp/spideryarn-worktrees/fbtsd470-citations-jump-back/src/web/styles/prose-hover-card.css:473).
- Low — moving `MAX_MENTIONS` removed its previous `src/citations.ts` export. No repository importer was broken, but I restored the export for compatibility.
- Low — accessible names now say “Citing paragraph N of total”; the current item additionally says “this paragraph” and retains `aria-current="location"`.
- Low — comments and documentation incorrectly implied that a fourth paragraph necessarily exists and that all `citedAt` data is complete. They now distinguish complete note-marker expansion from capped direct mentions.

`mentions.length >= MAX_MENTIONS` is a safe conservative signal. Mentions are occurrences, not distinct blocks; three may occur in one paragraph and do not prove truncation. Nevertheless, reaching the cap means completeness cannot be established, so “at least N known paragraphs” is honest. Note-only citations have no direct mentions and remain exact; bibliography-only works show no jump row.

Mouse and touch both close the card and call `jumpTo` exactly once. The tests now cover the complete touch sequence: first tap opens the citation card, second tap on a number performs one aimed jump and closes it.

Checks:

- Requested focused suites: 82 tests passed.
- Typecheck passed all four TypeScript projects and all 3,565-source coverage checks. `npm run typecheck` itself hit the sandbox’s `tsx` IPC `EPERM`, so I ran the identical script with `node --import tsx`.
- `git diff --check` passed.
- The additional full `npm test` could not start because the local Postgres/Docker service is unavailable.
- Repository lint remains red on its existing baseline; no new touched-line finding appeared.

Wider work not changed: direct citations beyond the three-mention pipeline cap still cannot be recovered. A precise completeness signal would require pipeline/schema work, such as a stored per-work truncation flag.

Verdict: GO — corrected and ready for the primary agent’s final review and commit.