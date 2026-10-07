### RP1 — `docs/project/linting.md` § The trap if anyone turns it on

Added after GPT Sol's review (RR-2). Written by the orchestrator from the memory file.

**Before:**

```
There is no undo: the recovery is `git show HEAD:<file> >` the file and re-apply your own change by
hand, which is only possible because the other 197 lines were committed. Wrap by hand instead.
```

**After:**

```
There is no undo: the recovery is `git show HEAD:<file> >` the file and re-apply your own change by
hand, which is only possible because the other 197 lines were committed. Look at
`git diff --word-diff` first and confirm the only content changes in the file are yours: a peer's
uncommitted edit in it would be overwritten too. Wrap by hand instead.
```

Why here: it is the recovery recipe, and it overwrites a file in a shared tree. Carries
`biome-formatter-is-off-on-purpose` L2's precondition.

### RP2 — `docs/project/hetzner-remote-server-box.md` § Traps, the `gh` bullet

Added after review (RR-3).

**Before:**

```
  `origin` work, so the gap is only the GitHub API: the default branch, pull requests, repository
  settings, Actions.
```

**After:**

```
  `origin` work, so the gap is only the GitHub API: the default branch, pull requests, repository
  settings, Actions. Run `gh auth status` before promising a step that needs the API, not after
  doing everything around it. Then do every part that does not need it, and tell Greg which one
  piece is his; he can run `gh auth login` in the session if he would rather it were done there.
```

Why here: beside the fact it acts on. Carries `no-github-cli-credential-on-this-box` L1's
"how to apply".

### RP3 — `docs/project/hetzner-remote-server-box.md` § Traps, the `npm run` bullet

Added after review (RR-4).

**Before:**

```
    has the story, and it is why that script has no default mode.
```

**After:**

```
    has the story, and it is why that script has no default mode. Never find out how a script
    handles its arguments by passing a word that does something: use `--help`, a nonsense word, or
    read the script.
```

Why here: beside the incident. Carries `npm-run-forwards-a-bare-argument`'s "how to apply".

### RP4 — `docs/project/vercel-hosting-deployment.md` § Searching the logs

Added after review (RR-5).

**Before:** new, at the end of the bullet that ends

```
    answer and not a lost login. The Supabase MCP was refused the same way on 2026-09-19.
```

**After:**

```
    So do not plan an unattended job around reading production logs without first making the call
    from such a session. What would change it is not code or a credential but an allow-list entry
    for those two read-only tools, which is Greg's to add.
```

Why here: beside the measurement. Carries `no-vercel-credential-on-this-machine` L6's instruction
and remedy. The memory ties the remedy to queue item `qi-hpyc3az9`, which is still open.

### RP5 — `docs/project/feedback-reports.md` § Where the queue lives

Added after review (RR-6). **No exact text is proposed**, because the memory's recipe was for a
Sentry search and the sweep now reads `scripts/feedback-unswept.ts`. The lesson to carry: an empty
result has two checks, not one. The first is a control that would come back non-empty if the query
works (already in `silent-success.md` § The habit). The second is the window: a report that aged out
of it unresolved is also absent, and the script's default is 30 days, so an empty sweep should be
re-run once with a wider `--since` before it is reported as "nothing waiting". Whoever takes this
should read the script's options and write the sentence against them.

### RP6 — `docs/reusable/engineering-manager.md` § Stages

Added after review (RR-7).

**Before:** new, after the paragraph that ends

```
[git-commit-changes.md](git-commit-changes.md).
```

**After:**

```

**Before starting a slice a plan doc has queued for anyone, say so.** A queue that several sessions
read is an invitation to all of them at once: on 2026-09-07 two sessions built the same slice from
the same plan eleven minutes apart, and the merge kept both. Send one message to the live peers
asking whether anyone is on it, and write *"Claimed, <date>, by <session>"* into the plan. When a
peer asks you first, answer on timing, not ownership: a slice you reserved and are not working on
is worth less than the same work done tonight by someone who is awake.
```

Why here: the Overseer's dispatch rules cover sessions it starts; this is for an agent picking up
work itself. The Overseer's notes record that Greg, asked on 2026-09-07 whether to build tooling
for this, said to just tell him and build nothing; that is a paraphrase, not a quote. Carries
`announce-before-taking-a-queued-slice` L1 and L3.
