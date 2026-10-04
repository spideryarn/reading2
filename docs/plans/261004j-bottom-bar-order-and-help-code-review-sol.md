No P0–P2 findings. The Help/Commands gates are complementary for every real mount site.

Findings fixed:

- **P3 — Metadata visitor gate lacked coverage.** A signed-in or signed-out visitor on public Metadata could have gained Commands without failing the tests. Added Commands-absent assertions; also pinned Commands for the owner-with-drawer state.
- **P3 — Help-page wording was misleading.** `/help#the-reading-view` initially described Commands as universal before later qualifying visitors, and called the control “a panel’s (i)” rather than “a mode’s (i).” Rewrote it explicitly for owners and visitors.
- **P3 — Stale mode-neighbour comment.** Ideas follows FAQ now, not Glossary directly. Corrected the comment.
- **P3 — Stale present-tense test comment.** It still described the command-bar row and Dock Help link as simultaneous routes for an owner. Corrected it.

The tests are non-vacuous: affirmative helpers require exactly one matching control. The behavior-changing owner assertion and literal-order test would fail before this commit; complementary visitor/Commands assertions pin behavior that intentionally already existed. Inverting, dropping, or keying either gate on sign-in state is now caught on both reading and Metadata pages. The rendered Commands button has `aria-label="Commands"` on both owner page shapes.

Checks:

- Focused Vitest: **6 files, 166 tests passed**
- Command-bar rerun: **79 tests passed**
- `npm run typecheck` could not start because this sandbox blocks `tsx`’s IPC socket. The equivalent `node --import tsx scripts/typecheck.ts` ran successfully and reported only the six known errors in untouched `src/backfill-registry-facts.ts`; nothing else.
- Lint: only pre-existing `Dock.tsx` complexity/type-import advisories.
- No commit or push performed.

Files edited:

- [src/web/Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/src/web/Dock.tsx:892)
- [src/web/help/help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/src/web/help/help-topics.tsx:144)
- [tests/dock-help-link.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/tests/dock-help-link.test.tsx:121)
- [tests/command-bar.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbtnqt2t-bottom-bar-order-and-help/tests/command-bar.test.tsx:1540)

**Verdict: ready after my fixes.**