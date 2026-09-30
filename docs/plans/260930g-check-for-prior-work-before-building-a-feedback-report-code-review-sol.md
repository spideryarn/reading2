1. **P1 — fixed:** the sweep could not reliably edit, regenerate, commit, and push another session’s headerless note. The rule now hands the second report ID to the owning session via `SendMessage`; that session records both IDs with the real ending. Failed delivery leaves the repeat unresolved for the next sweep. Updated [overseer.md](/home/greg/code/spideryarn2/.claude/worktrees/fb-6f-check-prior-work/docs/project/overseer.md:314), the plan, and the feedback note.

2. **P2 — fixed:** the passage was overly long and `show` was underspecified. It is now shorter and makes clear that queue matches are inspected with `show <id>`. Verified that `list`, `show`, and `export` all exist; `list` truncates entries while `show` displays the full item.

3. **No finding:** the note’s `reports: spya-vv68py` and `ending: shipped` header is valid. Headerless notes are indeed omitted and therefore read as not shipped. The generated map correctly contains `"spya-vv68py": "shipped"`.

4. **No new contradiction:** the revised rule agrees with the existing shared-note/header machinery and the sweep’s Sentry ownership. The two pre-existing stale statements in pinned `feedback-reports.md` remain documented under the plan’s § For Greg and were not edited.

Verification: all three requested files passed, **52 tests total**. `git diff --check` also passed. The normal `tsx` generator launcher hit sandbox IPC restrictions; the equivalent Node/tsx-loader run reported **157 reports, unchanged**.