Reviewed and fixed. Eight findings are recorded in [261006k-code-review-findings.md](/var/tmp/spideryarn-worktrees/qi-d4c5w4fe-fonts-skim-review/docs/plans/261006k-code-review-findings.md); seven were fixed. F5 remains the required post-review push to make the note’s “on dev” claim true.

Verification:

- Built CSS contains the `100%` rule on bare `html` inside `@layer base`.
- All requested mutations failed correctly, including the stale-decline case.
- Focused Vitest run: 23/23 passed.
- Typecheck passed via `node --import tsx scripts/typecheck.ts`.
- Client, static-page, and API builds passed.
- The exact npm build/typecheck wrappers hit the sandbox’s `tsx` socket restriction; their equivalent entry points passed.
- No full `npm test` was started.
- No commit or push performed.

Files changed:

- [261006k-code-review-findings.md](/var/tmp/spideryarn-worktrees/qi-d4c5w4fe-fonts-skim-review/docs/plans/261006k-code-review-findings.md)
- [261006k-text-size-adjust-for-a-landscape-phone-and-a-quick-review-of-fonts-and-sizes.md](/var/tmp/spideryarn-worktrees/qi-d4c5w4fe-fonts-skim-review/docs/plans/261006k-text-size-adjust-for-a-landscape-phone-and-a-quick-review-of-fonts-and-sizes.md)
- [controls.md](/var/tmp/spideryarn-worktrees/qi-d4c5w4fe-fonts-skim-review/docs/project/controls.md)
- [phone-and-touch.md](/var/tmp/spideryarn-worktrees/qi-d4c5w4fe-fonts-skim-review/docs/project/phone-and-touch.md)
- [261006_1416-fonts-differ-skim-too-big-and-a-quick-font-review.md](/var/tmp/spideryarn-worktrees/qi-d4c5w4fe-fonts-skim-review/docs/user-feedback/261006_1416-fonts-differ-skim-too-big-and-a-quick-font-review.md)
- [tailwind.css](/var/tmp/spideryarn-worktrees/qi-d4c5w4fe-fonts-skim-review/src/web/tailwind.css)
- [preflight-substitute.test.ts](/var/tmp/spideryarn-worktrees/qi-d4c5w4fe-fonts-skim-review/tests/preflight-substitute.test.ts)

VERDICT: approve