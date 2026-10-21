### Findings

1. **P1 — the required voice test was red.** It still expected five voice rules after AI code added a sixth. I updated the count/token handling and added a full-cascade test covering inline and fenced code in Chat and Candidates, while confirming ordinary code remains `--font-mono`: [voices-css.test.ts](/var/tmp/spideryarn-worktrees/fbjxwfah-nicer-ai-monospace/tests/voices-css.test.ts:294).

   The cascade is correct: both AI selectors have specificity `0-4-1`; the AI-code rule comes later. It also beats `mode-band.css`’s `0-3-1` fenced-code rule and `0-1-0` inline-code rule. All are in `app`; no matching code element has a later Tailwind font utility.

2. **P2 — emphasized model code would synthesize italics.** Inline code can inherit italic and bold styling, but iA Writer Mono imported only upright 400/700. I added italic 400/700 imports and expanded the style matrix: [tailwind.css](/var/tmp/spideryarn-worktrees/fbjxwfah-nicer-ai-monospace/src/web/tailwind.css:60), [self-hosted-faces.test.ts](/var/tmp/spideryarn-worktrees/fbjxwfah-nicer-ai-monospace/tests/self-hosted-faces.test.ts:77). The expanded test went red on missing italic 400 before the fix.

3. **P3 — font documentation retained two stale claims.** `fonts.md` counted three downloaded faces instead of four and still explained Sketch using the old monospace comparison. Both are corrected: [fonts.md](/var/tmp/spideryarn-worktrees/fbjxwfah-nicer-ai-monospace/docs/project/fonts.md:36).

The self-hosted-face test is sound for Fontsource’s formatting: it ignores comments and declaration order, supports static and variable weight ranges, and fails loudly if parsing finds declarations but not the required families/styles. No remaining live Plex assertions, TS measurements, or `ch` layouts depend on AI prose being strict monospace. Historical Plex measurements remain intentionally labelled historical.

Checks:

- Requested Vitest set: 84 passed.
- `npm run typecheck` was blocked before execution by the sandbox forbidding `tsx`’s IPC socket (`EPERM`). The equivalent `node --import tsx scripts/typecheck.ts` passed all projects and all 3,903 files.
- Scoped Biome lint and `git diff --check`: passed. Repo-wide lint retains its unrelated baseline failures.
- No commit made.

**Verdict: approve after fixes — no scoped blockers remain.**