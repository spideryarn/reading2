# Get ready to deploy

The sweep you run over a shared working tree that has drifted, to turn it into something that is
committed, merged, green, and safe to ship. Seven steps, in this order, each one owned by a doc that
already exists — this file is the running order and the reasons for it, not a second copy of any of
them.

Reusable in shape; the command names in steps 4 and 7 are this repo's.

**The order is the point.** Commit before you pull, because a pull into a dirty tree either refuses
or drags somebody's half-typed edit into a merge, and there is no second copy of that edit. Check
after you merge, because the merge is what breaks things. Fix before you commit again, because a
red commit on `main` is a deploy that fails on somebody else's machine.

## 1. Commit what's uncommitted

[git-commit-changes.md](git-commit-changes.md) — batch it, oldest first, and commit only what you
can vouch for. In a tree several agents share, most of what `git status` shows is not yours: poll
mtimes, leave anything still moving, and **say at the end what you skipped and why**. That list is
the useful half of the report.

## 2. Pull, merging

```bash
git pull --no-rebase
```

`--no-rebase` is not decoration. Always merge, never rebase — six reasons, two of them specific to
this repo, in
[version-control.md § Always merge, never rebase](../project/version-control.md#always-merge-never-rebase).
A pull that rebases rewrites commits other agents already have.

## 3. Resolve conflicts, if there are any

[git-resolve-merge-conflicts.md](git-resolve-merge-conflicts.md). Read the history behind **both**
sides first, keep the best of both, **make a proposal before you edit**, and never reach for
`git checkout --ours/--theirs` or `git merge --abort` — those are in the throw-work-away family this
tree forbids. Before committing the merge, grep for leftover markers: a stray `<<<<<<<` is a syntax
error in code and invisible prose in markdown.

## 4. Run the checks

```bash
npm run check          # the eight gates and advisories, ~20s; -- --fast skips the build
npm run db:check       # only if a database is in play; point it at the app's credential
```

[code-quality-overview.md](../project/code-quality-overview.md) says which of those are gates and
which are advice — lint's baseline is not clean, so read its findings on the files you touched and
don't chase it to zero.

Then **drive a real browser**, in a Sonnet subagent, because tests going green is not evidence that
a reader can see anything. [browser-control.md](../project/browser-control.md) first — the machine
decides the mechanism, and the laptop's extension cannot follow you to the remote box — then
[browser-testing.md](../project/browser-testing.md) or
[browser-testing-playwright.md](../project/browser-testing-playwright.md). Ask the subagent for the
conclusion, not the page dumps.

**A failure you did not cause is still information.** A red that vanishes on a second run was a
mid-edit snapshot of somebody else's file; a red that survives is real, whoever wrote it, and it is
now between you and a deploy.

## 5. Fix everything the checks found

[engineering-manager.md](engineering-manager.md) — cut it into stages that each end committable,
hand the implementation to subagents, keep the diffs and the decisions for yourself. The two habits
that matter most here: **write the failing test before the fix**, because a test that was never red
proves nothing, and get **GPT Sol** on the diff at the end of each stage
([codex-cli-as-subagent.md](codex-cli-as-subagent.md)), checking that a verdict actually arrived —
exit code *and* answer file.

If a failure belongs to work another agent has not finished, that is a reason to stop and ask, not a
reason to finish their change for them.

## 6. Commit the fixes

The same recipe as step 1, naming your own files. Update any doc your fix made wrong, in the same
commit.

## 7. Push — which is the deploy

```bash
npm run deploy                      # gates a sha, pushes it by name, proves it arrived
npm run deploy -- --dry-run         # every local gate, nothing external
```

**A push to `main` is a deploy**, so `npm run deploy` is the only thing that should write it. A bare
`git push origin main` would gate one commit and ship whatever `main` has become since — several
agents commit into this tree, and HEAD's green/red status has a half-life of minutes.
[deployment.md](../project/deployment.md), [`scripts/deploy.ts`](../../scripts/deploy.ts).

This is the one step that reaches real readers. Run it when you were asked to. Stop and ask instead
if the run turned up something you could not explain, or if the fixes in step 5 changed
user-visible behaviour nobody asked for.

## Finish by saying what you left

Green at the end of a run means the sha you gated was green — not that the tree is clean, and not
that it still is. Report three things: what you committed, what you skipped and why, and what is
still red. An unexplained gap reads as "it's all done" when it isn't, which is
[silent-success.md](silent-success.md) in its reporting form.
