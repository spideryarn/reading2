## Findings

- No high- or medium-severity findings.

- Low, fixed — edited comments overstated the 1152px centring threshold when `--safe-left` is nonzero and retained stale claims about fixed positioning and button-font inheritance. Corrected in [Metadata.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/src/web/Metadata.tsx:752) and [PageContents.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/src/web/PageContents.tsx:368). Runtime code was unchanged by these fixes.

- Low, wider documentation issue — the plan still says centring always returns at 1152px. With the implemented safe-area floor, the exact containing-block threshold is `1152px + 2 × --safe-left`; its 4rem offset claim likewise assumes a zero inset. [Plan](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/docs/plans/261002a-metadata-contents-on-an-ipad-in-landscape.md:29). Left unchanged because it is outside the supplied `src/web` diff.

Verified:

- Both nav and main add `var(--safe-left)`.
- Tailwind 4.3.3 emits both arbitrary-value declarations correctly.
- Generated CSS places `tw:lg:ml-[…]` after `tw:mx-auto` in the utilities layer. It therefore overrides the left margin while leaving the right margin auto.
- `npm run build:client`: passed.
- Typecheck: passed using `node --import tsx scripts/typecheck.ts`; the normal launcher was blocked by sandbox IPC permissions.
- Focused tests: 17/17 passed.
- Both touched files lint clean; `git diff --check` clean.
- Full `npm test` could not start because this sandbox cannot reach local Postgres/Docker.

## Verdict

**Approve after the in-tree comment fixes.** The runtime implementation matches the plan’s intended geometry and safe-area requirement. No runtime defect found. Nothing committed.