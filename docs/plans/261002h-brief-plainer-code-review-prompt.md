# Code review: Brief summary plainer for a reader in a hurry (261002h)

You are reviewing the code built from docs/plans/261002h-brief-summary-plainer-for-a-reader-in-a-hurry.md
(read it first, including how your own plan review, 261002h-brief-plainer-plan-review-sol.md, was taken).
The scoped diff is docs/plans/261002h-brief-plainer-code-review.diff; the working tree is the truth.

House rule: you **fix what you find** inside this change (edit the files), and report anything wider
for me to decide. Do not commit. Do not run paid evals (no `probe.ts run`). Do not touch any
database. After any fix, run `npx vitest run tests/simple-summary.test.ts tests/pressing-a-chip-arms-it.test.tsx`
and `npm run typecheck`, and report the result.

What changed:
1. `src/web/modes/summary/SummaryMode.tsx`: a pointer drag arms the `simple` press on its first
   value change, so a drag ending in `pointercancel` (touch scroll takeover) still arms. Test in
   tests/pressing-a-chip-arms-it.test.tsx. Check: double-arming within one drag (first move and
   pointer-up) cannot cause two runs or a lost press (src/web/useAutoRun.ts, src/web/activation.ts);
   the "arms once when a pointer move emits both input and click" test still means something; a
   visitor (slug null) still arms nothing.
2. `src/simple-summary.ts`: Brief's NOTCH_UP rewritten; THE READER's known-words bullet now per level
   (KNOWN_WORDS); a Brief-only section after PROFILE_RULES (AFTER_PROFILE); the shape opens on "goal
   or question"; SYSTEM_TAIL became `systemTail(level)`; SIMPLE_PROMPT_VERSION → simple-prompt/5.
   Check: the rendered prompts for all three levels (print SIMPLE_SYSTEMS) read coherently and do not
   contradict themselves; Simple and Fuller are byte-identical to before apart from the "goal or
   question" line (verify this against `git show HEAD:src/simple-summary.ts`); the prompt-version
   bump reaches everything that compares it (pipeline stamp, outdated flag, artefact copies) and
   needs nothing else; nothing else imported SYSTEM_TAIL; the system prompt per level is still
   constant (caching).
3. `evals/simple/probe.ts` records the guard's `check`; `evals/simple/brief-plain.ts` screens and
   builds blind pairs with exactly balanced sides. Check the balance logic and that the key cannot
   leak into pairs.md.
4. Docs: docs/project/summaries.md's line on profiles; the plan; docs/research/261002c-what-makes-a-good-summary.md.
   Check that the docs say what the code does.

Report findings labelled P0/P1/P2 with file:line, what you fixed, and the gate results. One-line verdict.
