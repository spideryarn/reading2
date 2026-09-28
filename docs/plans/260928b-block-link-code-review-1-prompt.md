# Code review, stage 1 — 260928b block links

Candidate: commit 62e1a7f2 in this worktree (`git show --stat 62e1a7f2`; diff `git show 62e1a7f2`). Its parent 4fd2c1ef is a merge of origin/dev; review only 62e1a7f2's paths. Start with src/web/flash.ts, src/web/BlockLinkCard.tsx, src/web/BlockRef.tsx, src/web/scroll.ts, src/web/keynav.ts § beginJump, src/web/reader/Reader.tsx (the provider and the flush effect), src/web/Cited.tsx; the four new test files. Plan: docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md — the final "Plan review … what changed" section is the contract.

You may FIX what you find inside this stage — narrowly, red test first where behavioural — directly in the working tree (do not commit). Report, do not fix, anything wider. Run test files yourself with `npx vitest run <file>` (they need no network) and `npm run typecheck` (read the exit code).

Attack independently:

- Settlement: does every glide exit report exactly one outcome, exactly once? Can a stale callback from a cancelled glide fire later, or a newer scroll's cancel report the older jump as settled? Reduced motion and zero-distance paths.
- Flash: restart correctness, timer leaks, pending flash when covered (does the flush fire when the band closes / steps aside / on width change to wide; is a stale pending flash dropped appropriately — e.g. the reader switches article, or a different jump happens while covered?), the `td.text` absent case, CSS correctness (inset box-shadow over an opaque wash — is the text still readable, does it clash with existing box-shadows on td.text e.g. aimed column, pin-right?).
- Card: delegated listeners — leaks, the Floating UI reference when the anchor re-renders or detaches, aria-describedby cleanup, touch (pointerType), keyboard focus-visible, Escape, portalled ChatDialog, two cards at once. Does it follow tooltips.md's conventions (no title, pointer-events none)? Does the memoised index actually stay stable across position renders (check Reader's deps)? Section naming correct for blocks before the first section / in apparatus?
- BlockRef: accessible names; missing-state only with provider; BlockRange; TableView memo (linkBase) not broken by context.
- Anything the tests assert that the code does not really do (a check that shares an assumption with the code).

Severity: P0 data loss/security/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability; P3 prose. ID each finding (F1…), with file:line, what you fixed (with red→green evidence) or what you recommend. End with a verdict.
