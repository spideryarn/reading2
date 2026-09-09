# Get ready to deploy

The sweep you run over a shared working tree that has drifted, to turn it into something that is
committed, merged, green, and pushed to `dev`. Seven steps, in this order, each one owned by a doc
that already exists — this file is the running order and the reasons for it, not a second copy of
any of them. It ends at `dev`; the deploy to `main` is a separate job, run when somebody asks for it
([deployment.md](../project/deployment.md)).

Reusable in shape; the command names in steps 4 and 7 are this repo's.

**The order is the point.** Commit before you pull, because a pull into a dirty tree either refuses
or drags somebody's half-typed edit into a merge, and there is no second copy of that edit. Look at
the merge before you make it, because a merge that stalls on a conflict stalls every other agent in
the tree. Check after you merge, because the merge is what breaks things. Fix before you commit
again, because a red push to `dev` is a red tree for everybody who pulls it.

**Unattended runs.** This doc is also what a recurring job runs, on a timer, with nobody watching —
see [§ Running it on a timer](#running-it-on-a-timer). Wherever a step below says *ask*, an
unattended run cannot. The rule is the same everywhere: **skip, and say so.** Leave the batch, leave
the merge unmade, leave the failure red, and put it in the report. A skipped step costs one run; a
guess made on somebody else's behalf costs their work.

## 1. Commit what's uncommitted

[git-commit-changes.md](git-commit-changes.md) — batch it, oldest first, and commit only what you
can vouch for. In a tree several agents share, most of what `git status` shows is not yours: poll
mtimes, leave anything still moving, and **say at the end what you skipped and why**. That list is
the useful half of the report.

## 2. Look at the merge before you make it

```bash
git fetch origin
git merge-tree --write-tree dev origin/dev      # exit 1 and CONFLICT lines = it will conflict
comm -12 <(git diff --name-only dev origin/dev | sort) <(git status --porcelain | awk '{print $2}' | sort)
```

The first command merges in memory and touches nothing; the second lists uncommitted files that
also changed upstream, which is exactly the set `git pull` will refuse over. Both answers arrive
before anything in the tree has moved, which is the point: a merge that is *started* and then found
to be hard leaves `MERGE_HEAD` behind, and while it is there no other agent can make a partial
commit — the whole tree is stuck on your decision.

- **Clean, and no overlap** — pull, step 3.
- **Overlap** — those files belong to batches step 1 skipped, so somebody is still on them. Do
  not pull this run. Report the files; the next run will find them committed or still moving.
- **Conflicts** — read them here, in the merge-tree output, with the history behind both sides
  ([git-resolve-merge-conflicts.md](git-resolve-merge-conflicts.md)). If every hunk is one you
  could resolve with confidence and GPT Sol agrees, pull and resolve, step 3. If any hunk is not,
  do not pull: an attended run makes a proposal and asks; an unattended run reports the hunks and
  moves on to step 4 against the tree as it is.

## 3. Pull, merging

```bash
git pull --no-rebase
```

`--no-rebase` is not decoration. Always merge, never rebase — six reasons, two of them specific to
this repo, in
[version-control.md § Always merge, never rebase](../project/version-control.md#always-merge-never-rebase).
A pull that rebases rewrites commits other agents already have.

If it conflicts, you already know the hunks from step 2: resolve them by editing, keep the best of
both, and never reach for `git checkout --ours/--theirs` or `git merge --abort` — those are in the
throw-work-away family this tree forbids. Before committing the merge, grep for leftover markers:
a stray `<<<<<<<` is a syntax error in code and invisible prose in markdown.

If the pull brought migrations, apply them to the **local** database — `npm run db:migrate`, and
read its `Target:` line — or every test that touches the schema goes red for a reason that is not a
bug ([database.md](../project/database.md)).

## 4. Run the checks

```bash
npx tsx scripts/tmux-job.ts npx tsx scripts/readiness-run.ts check   # the eight gates and advisories
npm run db:check                                                     # only if a database is in play; point it at the app's credential
```

[code-quality-overview.md](../project/code-quality-overview.md) says which of those are gates and
which are advice — lint's baseline is not clean, so read its findings on the files you touched and
don't chase it to zero. `check` runs `typecheck`, `build`, `test` and `lint` among others, so this
one command is the whole of what this step needs.

**Through the wrapper, not a bare `npm run check`.** The bare form leaves nothing behind, so the
Readiness tab — the one place that answers *is the commit dev is on known to pass its checks?* — can
never go green on it, however green the run was ([readiness.md](../project/readiness.md) § The one
command). `readiness-run.ts` runs the same script and writes down what happened; `tmux-job.ts` keeps
the output and survives a disconnect.

**`tmux-job.ts` returns when the job has *started*.** Its exit status tells you tmux launched, and
nothing whatever about the checks — so this step is not finished until the log's last line says
`EXIT=<n>`. Wait for it, and read it:

```bash
until grep -q '^EXIT=' <log>; do sleep 30; done; tail -1 <log>
```

A non-zero `EXIT=` is the checks failing **or** the wrapper refusing to record them, which are
different problems; the lines above it say which. Treating the launch as the gate is how a sweep gets
to step 7 and pushes something nothing has verified.

Then **drive a real browser**, in a Sonnet subagent, when the run has touched anything a reader
sees — the merge brought in client code, or a fix in step 5 did — because tests going green is not
evidence that a reader can see anything. Use your judgment about how much: a smoke pass over the
pages the diff touched, not the whole suite every time.
[browser-control.md](../project/browser-control.md) first — the machine decides the mechanism, and
the laptop's extension cannot follow you to the remote box — then
[browser-testing.md](../project/browser-testing.md) or
[browser-testing-playwright.md](../project/browser-testing-playwright.md). Ask the subagent for the
conclusion, not the page dumps.

**A failure you did not cause is still information.** A red that vanishes on a second run was a
mid-edit snapshot of somebody else's file; a red that survives is real, whoever wrote it, and it is
now between you and a push.

## 5. Fix everything the checks found — that is yours to fix

[engineering-manager.md](engineering-manager.md) — cut it into stages that each end committable,
hand the implementation to subagents, keep the diffs and the decisions for yourself. The two habits
that matter most here: **write the failing test before the fix**, because a test that was never red
proves nothing, and get **GPT Sol** on the diff at the end of each stage
([codex-cli-as-subagent.md](codex-cli-as-subagent.md)), checking that a verdict actually arrived —
exit code *and* answer file.

What is yours to fix: a failure in **committed** code — the merge broke it, or it was red when it
landed. What is not: a failure in a file step 1 skipped because somebody is still on it. That is
their unfinished change, not a bug; an attended run stops and asks, an unattended run leaves it
red and names it in the report.

## 6. Commit the fixes

The same recipe as step 1, naming your own files. Update any doc your fix made wrong, in the same
commit.

## 7. Push to `dev`

```bash
git push origin dev                 # from the shared checkout
git push origin HEAD:dev            # from a worktree
```

A push to `dev` builds nothing and reaches no reader; it is how the other machine and every other
agent get what you committed, and unpushed work is invisible to both. Push what is green. If step 5
left something red that is not yours, push anyway and say so — a red `dev` that everybody can see
beats a green one nobody has.

**Not `main`.** A push to `main` is a deploy, `npm run deploy` is the only thing that should write
it, and it is not part of this sweep —
[version-control.md § What protects `main`](../project/version-control.md#what-protects-main-and-what-does-not).

## Finish by saying what you left

Green at the end of a run means the sha you pushed was green — not that the tree is clean, and not
that it still is. Report three things: what you committed, what you skipped and why, and what is
still red. An unexplained gap reads as "it's all done" when it isn't, which is
[silent-success.md](silent-success.md) in its reporting form.

## Running it on a timer

The recurring form is a `/loop` in a Claude session on the box, every three hours or so, with this
prompt and nothing more, so that the behaviour lives here and not in the job:

```
Run docs/reusable/get-ready-to-deploy.md in unattended mode, all steps.
```

- **The report goes to a file as well as the chat.** Append it to
  `logs/loops/get-ready-to-deploy/<yyMMdd>.md` — one dated heading per run, the three lists above,
  and nothing else. The directory is gitignored; the file is how Greg reads what eight runs did
  without scrolling a transcript.
- **Never block on a question.** A cron-fired turn that asks waits until somebody looks, and the
  next run cannot start behind it. Every *ask* in this doc has a skip-and-report fallback; use it.
- **A `/loop` lives in its session** and expires after seven days, so it wants re-creating when the
  session or the week ends. A job that must outlive both is a system `cron` running `claude -p`
  with the same prompt — [long-waits.md](long-waits.md) — and that is a change to the box, so
  it goes through
  [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file).
