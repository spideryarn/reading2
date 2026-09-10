# Settle check (Fable): is F22 closed now?

You are settling **one finding**. This is not a review. Work in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory`, and **change no file**.

**The finding.** GPT Sol's narrow check (`docs/plans/260910e-recovery-inventory-stage2-fixcheck-sol.md`)
found F22 still open. The recovery inbox drain (`tools/overseer/recovery-inbox.ts`) quarantines
junk into `recovery-inbox/junk/`, so that junk cannot starve a valid request. But for a
**correctly named** request file (`<uuid>.json`), any `open()` failure other than absence (a
transient `EMFILE` or `EACCES`) sent the real request into `junk/` too, losing an operator's
dismissal silently.

**The fix, as Sol proposed it:**

- `lstat` positively identifies request-named symlinks and non-regular entries, and only those are
  quarantined.
- A request-named **regular** file that cannot be opened is logged and left where it is, for a
  later pass. It goes to neither `junk/` nor `refused/`, and is never deleted.
- Junk names keep today's quarantine.

**The question, and the only one:** after this fix, is there any path by which a correctly named,
regular request file ends up in `junk/`, in `refused/` (other than refusal on its *content*, which
is by design), or deleted, without its dismissal having been applied? Consider these:

- a transient open failure;
- a race between `lstat` and `open` (the file is swapped for a symlink in between);
- a claim into `processing/` followed by an open failure there;
- the scan bound.

Check that the regression test really fails without the fix: its red and green output is in the
scratchpad as `ri2f-repro-F22b.txt`
(`/tmp/claude-1000/-home-greg-code-spideryarn2/1eddb8de-fb5b-4e50-aac6-fe2bbe7555b2/scratchpad/`).
You may run `npx vitest run tests/overseer-daemon-recovery.test.ts` and the other recovery test
files.

**Answer in under 400 words.** Start with one line: **closed** or **not closed**. If not closed,
give the concrete input and the smallest fix. Nothing else is in scope; if you notice something
unrelated, add one line at the end under "Outside scope".
