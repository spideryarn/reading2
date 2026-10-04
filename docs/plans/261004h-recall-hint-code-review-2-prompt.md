# Code review, round 2 (and fix): Recall's Hint button

You may edit files in this worktree. Fix what you find inside this stage, narrowly, with a test
that was red first; report anything wider. Do not commit. No git commands that discard work. Do not
touch `CLAUDE.md`, `AGENTS.md` or `docs/reusable/`.

**This is the last round, and discovery is closed** except for what changed since your round 1
(`docs/plans/261004h-recall-hint-code-review-sol.md`, on commit `35ca72d7f`). Keep the F ids; new
ones from F18.

## The candidate

Commit `a657d60a7`. What changed since the tree you reviewed:

- `483de1665` — your own four fixes (F12 to F15), committed as you left them.
- `18f83c655` — a merge of `origin/dev`; other people's work, not under review, except
  `drizzle/meta/_journal.json`, where the trunk's file was taken whole.
- `a657d60a7` — see it with `git show --stat a657d60a7`. In it:
  1. **Your F12 fix was taken back out** and F17 goes with it: `src/web/ChatPanel.tsx` shows no
     Hint button while the answer is pending (`hintOffered`), so no press is ever held.
     `tests/recall-hint-panel.test.tsx` has the two tests that replace your mid-stream one. The
     reasoning is in the plan, § As built → The code review. **Say whether F17 is closed, and
     whether withholding the button until the answer settles produces any wrong behaviour** (not
     merely a difference from the plan's wording, which § As built now records).
  2. **F16 overruled**, and `docs/project/remember-mode.md` § "A Recall question links its passage,
     and has a Hint button" rewritten to say what the hint-text fence does and does not promise.
     Check every sentence of that section against the code.
  3. **The migration was regenerated** after the merge:
     `drizzle/20261004152851_chat_message_hint_opened_at.sql` and its snapshot, on top of the
     peer's `20261004135541_reader_auto_modes_off_at`. I ran `npm run db:migrate` (Target
     127.0.0.1, applied 1), `npm run db:check` (no schema drift) and `npm run db:chain`
     (Everything's fine). Check the snapshot chain and the journal by reading them.
  4. **Three sentences added to `REMEMBER_SYSTEM`** in `src/converse.ts` (search "is not the
     question's", "it says too much", "does not give the reply more room"). Check them against the
     rest of the prompt and `docs/project/prompting-guide.md`.
  5. `docs/investigations/261004c-recall-hint-and-question-link-eval.md` — the eval write-up. **Check
     its conclusion and every number against the three transcripts it names**
     (`evals/results/remember-recall.261004h-run-1.md`, `…-run-2.md`, and
     `git show 8548c0d4a:evals/results/remember-recall.md` for "before"). In particular my reading
     that three run-1 hints stated the answer and no run-2 hint does, and that length did not
     improve. If I have explained away something inconvenient, say so.
  6. `src/web/help/help-modes.tsx` — one sentence.

Run `npx vitest run tests/recall-hint.test.ts tests/recall-hint-panel.test.tsx
tests/recall-hint-reduce.test.ts tests/remember-prompt.test.ts tests/remember-recall-checks.test.ts
tests/migration-journal.test.ts tests/migration-snapshots.test.ts tests/doc-links.test.ts`. You have
no Postgres; I am running the full suite separately.

## Output

Per finding: id, severity (P0 data loss, exploitable security, incorrect charging, service
unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2 design or
maintainability risk; P3 prose), *established* or *reasoned*, file and line, "fixed" with its
red-first test or "reported". Then the files you changed, then exactly one line:
`VERDICT: approve`, `VERDICT: approve after my fixes`, or `VERDICT: rework`.
