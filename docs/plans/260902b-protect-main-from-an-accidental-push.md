# Only `npm run deploy` writes `main`, and nothing enforces that

## Goal

`main` is production. A push to it builds on Vercel's machine and goes live to real readers, and
`vercel.json` is wired so that **only** `main` builds. The invariant the whole deploy gate rests on
is therefore:

> **Only `npm run deploy` writes `main`.**

That sentence is currently written down in three places and enforced in none. This plan makes it
mechanical.

**Not being built yet.** Greg, 2026-09-02: *"Just write a plan, and make minimal changes to AGENTS.md
if needed (perhaps signposting to a doc that describes things in more detail) for now."* So the only
things landed alongside this file are the AGENTS.md signpost and the
[version-control.md](../project/version-control.md) section it points at.

### Why now

The trunk flipped to `dev` on 2026-09-02
([260828r-worktrees.md](260828r-worktrees.md), [worktrees.md](../project/worktrees.md)), and that
changed the risk in two directions at once:

- **Pushing became routine.** It used to be that agents never pushed at all — the only push in the
  repo was a deploy. AGENTS.md now says *"Commit when the work is done… **and push it.**"* So every
  agent runs `git push` many times a day, and the muscle memory that used to be absent now exists.
- **`main` stopped being the branch anyone stands on.** That is a genuine improvement — a push now
  has to *name* `main` to reach it. But it also means the one remaining path to production is a path
  nobody exercises, so nobody would notice it eroding.

Add worktrees at 20–30 and the number of shells that can reach `origin` goes up by an order of
magnitude.

## What is actually exposed, measured on 2026-09-02

Measured on this box, not reasoned about. Two of the four came out **better** than expected, and
saying so is the point — the protections below are for the two that did not.

| Checked | Result |
|---|---|
| `git config push.default` | **Unset**, so git 2.43's built-in `simple`. A bare `git push` from `dev` pushes `dev` and nothing else — confirmed with `git push --dry-run`, which named only `dev -> dev`. **No exposure here.** |
| `.git/hooks`, `core.hooksPath` | **No hooks at all.** Only `.sample` files, and `core.hooksPath` unset. Nothing mechanical protects `main` from anything. |
| `git push --all` | Would have created `worktree-e2e` and `worktree-spike` on the remote (dry run named both). Harmless today because `"**": false` means they do not build — but `--all` ignores which branch you are on, so if local `main` were ever ahead it would ship it. |
| Do worktrees inherit the primary's hooks? | **Yes.** `git rev-parse --git-path hooks` returns `/home/greg/code/spideryarn2/.git/hooks` from *both* the primary and a linked worktree. So one hook file covers every worktree, now and every future one, with no per-worktree step. |

That last row is what makes this cheap, and it was worth checking rather than assuming: hooks resolve
through the **common** git dir, the same asymmetry `inLinkedWorktree` relies on in
[`scripts/worktree-port.ts`](../../scripts/worktree-port.ts).

## References

- [version-control.md](../project/version-control.md) — the owner of this topic. Its
  *"A push to `main` IS a deploy"* section, and the new
  [What protects `main`, and what does not](../project/version-control.md#what-protects-main-and-what-does-not)
  section this plan added. Note the block quote recording that this paragraph *said the opposite*
  until 2026-09-01 — the staleness that matters most here has happened before.
- [`scripts/deploy.ts`](../../scripts/deploy.ts) — the legitimate writer. Line 1383 is the actual
  push: `git push origin <sha>:refs/heads/main`. The header comment explains why it is a refspec and
  not `git push origin main`: *"A plain `git push origin main` would gate one commit and ship
  another."* `run()` at line 196 already merges an `opts.env`, so authorising the hook is a one-line
  change.
- [`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts) — `DEPLOY_SOURCE_BRANCHES`, now
  `["dev"]`; `deployBranchProblem`; `trunkGap`. These gate *where you may stand*, which is a
  different question from *what may be written*, and that difference is the gap this plan fills.
- [`.claude/hooks/protect-shared-tree.sh`](../../.claude/hooks/protect-shared-tree.sh) — the
  precedent, and the thing this must not duplicate. Read its header before designing anything here;
  its self-test and its fail-closed reasoning are both worth copying, and its layer is wrong for this
  job (see below).
- [silent-success.md](../reusable/silent-success.md) — required reading, because the characteristic
  failure of this plan is a hook that is not installed and a repo that looks protected.
- [worktrees.md](../project/worktrees.md) — why the number of shells reaching `origin` is about to
  grow.
- [`vercel.json`](../../vercel.json) — `git.deploymentEnabled` is `{"**": false, "main": true}`, which
  is why `main` and only `main` is dangerous.

## Principles and key decisions

1. **Refuse, never warn.** Agreed with Greg. An agent does not read stderr it did not ask for, and a
   warning on a push that succeeded is a warning nobody will ever see. The one exception is the
   *installation* check, which has to be loud somewhere a human looks — hence the `preflight` gate in
   the second stage.
2. **A `pre-push` hook, not an extension of `protect-shared-tree.sh`.** This is the load-bearing
   decision, and the reason is the layer:
   - `protect-shared-tree.sh` is a Claude Code `PreToolUse` hook, so it only ever sees **Bash
     commands issued by an agent**. It cannot see Greg's own terminal, a script, or a push that
     `deploy.ts` makes internally with `spawnSync`.
   - It also matches **command text**, which for this job is the wrong thing to match. `main` can be
     reached as `main`, `dev:main`, `HEAD:main`, `<sha>:refs/heads/main`, `--all`, or `--mirror`, and
     a text matcher has to enumerate spellings. A `pre-push` hook is handed, on stdin, one line per
     ref of the form `<local ref> <local sha> <remote ref> <remote sha>` — the **resolved
     destination**. Checking `<remote ref> == refs/heads/main` covers every spelling at once,
     including ones nobody has thought of.

   Keeping `protect-shared-tree.sh` as a second layer is possible later, but it would be belt on top
   of braces and it is not in this plan.
3. **Deploy authorises itself with an environment variable.** `run()` in `deploy.ts` already merges
   `opts.env`, so this is `{ env: { SPIDERYARN_DEPLOY_PUSH: "1" } }` on the one push at line 1383.
   An agent *could* set that variable deliberately. That is accepted: the target is the accident, not
   a determined agent, and an agent that sets a variable named `SPIDERYARN_DEPLOY_PUSH` to reach
   production has been told exactly what it is doing.
4. **The fail-closed question is genuinely different here, and must not be copied blindly.**
   `protect-shared-tree.sh` deliberately over-refuses and refuses even when its own matcher errors,
   because the cost of a false refusal is one reworded command. **A `pre-push` hook that fails closed
   blocks the push that AGENTS.md now requires at the end of every piece of work, for every agent, in
   every worktree.** So the hook must:
   - refuse only on a **positive** match of `refs/heads/main`;
   - be small enough that there is no third outcome — a handful of lines of shell reading stdin, with
     no interpreter it can fail to find and no parsing that can throw;
   - and, if it somehow cannot decide, refuse **and print the one-line override**, so a blocked agent
     is not stuck without a way forward.

   This tension is the most likely thing to be got wrong by someone copying the existing hook, which
   is why it is written down here rather than left to judgement.

### The simpler options passed over

- **Do nothing; the prose is enough.** Genuinely defensible right now — `main` is no longer anyone's
  current branch, so an accident needs an agent to *name* `main`. Rejected because the cost of the
  accident is unreviewed code live to real readers, the repo has already broken `main` three times
  by other means, and the mitigation is roughly fifteen lines. This is the option to fall back to if
  the hook proves to have any false-refusal rate at all.
- **GitHub branch protection requiring reviews or a PR on `main`.** Rejected outright: `deploy.ts`
  pushes straight to `main` by design, so this would break deploying rather than protect it. The
  *narrow* version — block force-push and deletion only — is pure upside and is in Stage 3.
- **Making `main` not exist locally.** Deleting the local `main` branch removes one accident shape
  (`git push origin main` resolving a local ref) and costs nothing, since nothing reads it — checked:
  `deploy.ts` only ever reads `origin/main`. But it protects only this one clone and does nothing
  about `dev:main`, so it is a tidy-up in Stage 3, not a protection.
- **A server-side pre-receive hook**, which would be the only unbypassable answer. Not available:
  GitHub does not offer them outside Enterprise.

## Stages and actions

### Stage 1 — the hook, refusing on this box

Deliberately first and deliberately narrow: this alone protects the twelve agents working here today,
which is where all the current risk is.

- [ ] Write the test first, and watch it fail. `tests/protect-main-push.test.ts`, driving the hook
      script as a subprocess with fabricated stdin, one case per spelling:
  - [ ] `refs/heads/main` as the remote ref ⇒ **refuses**, exit non-zero
  - [ ] `refs/heads/dev` ⇒ **allows**, exit 0
  - [ ] a `worktree-*` ref ⇒ allows
  - [ ] **several refs at once**, as `--all` and `--mirror` produce, with `main` among them ⇒
        refuses. This is the case a text matcher would most likely miss.
  - [ ] a branch *deletion* of `main` (all-zeroes local sha) ⇒ refuses
  - [ ] `refs/heads/maintenance` ⇒ **allows**. The near-miss; a substring test would refuse it.
  - [ ] `SPIDERYARN_DEPLOY_PUSH=1` with `refs/heads/main` ⇒ allows
  - [ ] a self-test, in the manner of `protect-shared-tree.sh`: prove the matcher both finds a ref it
        must find and misses one it must not, so a matcher that has silently started matching
        everything or nothing cannot pass.
- [ ] Write `.githooks/pre-push` (tracked, so it is reviewable and survives — see Stage 2).
- [ ] `git config core.hooksPath .githooks` on this box, and confirm
      `git rev-parse --git-path hooks` now reports it from **both** the primary and a worktree.
- [ ] **Break it on purpose** ([silent-success.md](../reusable/silent-success.md)) — a check never
      seen to fail is not evidence:
  - [ ] attempt a real `git push origin dev:main` and watch it refused
  - [ ] attempt `git push origin HEAD:refs/heads/main` and watch it refused
  - [ ] push something real to `dev` and watch it succeed, so the hook is not simply blocking
        everything
  - [ ] temporarily reverse the hook's condition and confirm the test suite goes red
- [ ] Authorise deploy: `{ env: { SPIDERYARN_DEPLOY_PUSH: "1" } }` on the push at
      [`scripts/deploy.ts:1383`](../../scripts/deploy.ts).
- [ ] Verify deploy's path end to end with `npm run deploy -- --dry-run`, which runs every local gate
      without pushing. **Note the limit of that evidence honestly**: `--dry-run` does not reach the
      push, so it does not prove the authorised push works. Either add a test that invokes the hook
      with the env var set (cheap, and in the list above), or accept that the first real deploy is the
      test — and say which was chosen.
- [ ] `npm test` and `npm run typecheck`.

### Stage 2 — make it survive a fresh clone, and notice when it has not

The hook is worthless if it is not installed, and **an uninstalled hook looks exactly like a
protected repo**. This stage is the whole reason the plan is not just Stage 1.

- [ ] `.githooks/` is tracked, so cloning gets the *file*. What a clone does **not** get is
      `core.hooksPath`, which is local config. So it needs setting once per clone — the Mac included.
- [ ] **Note for whoever builds this:** `worktree:setup` does **not** need to set it. Config lives in
      the shared `.git/config` and worktrees read the primary's, which is the same reason one hook
      file covers them all. Do not add a per-worktree step that does nothing.
- [ ] Add a `preflight` gate in `deploy.ts`: `core.hooksPath` is set **and** the hook is executable
      **and** it actually refuses a fabricated `refs/heads/main` line. Testing the behaviour rather
      than the file's presence is the difference between a check and a decoration.
- [ ] Document it in [version-control.md](../project/version-control.md) — extend the section this
      plan already added, replacing "what does not" with what now does.
- [ ] Add the one-line `core.hooksPath` step to
      [setup-dev.md](../project/setup-dev.md), so a new machine gets it.
- [ ] Run it on the Mac. Track here: **[ ] Mac has `core.hooksPath` set.**

### Stage 3 — the parts that are Greg's, and the tidy-up

Independent of the hook; each stands on its own.

- [ ] **Greg: on GitHub, block force-push and deletion on `main`.** Pure upside — `deploy.ts` does
      ordinary fast-forward pushes, so it is unaffected — and it blocks the one mistake that cannot
      be undone. **Do not** enable required reviews or required PRs, which would break deploying.
      **Blocked, and not by permissions:** both the protection and ruleset APIs answer `403 Upgrade
      to GitHub Pro or make this repository public to enable this feature` — measured 2026-09-02 with
      an authenticated `gh`. Branch protection is not available on a private repo on this plan at
      all, so this item needs a decision (pay, or go public) rather than a click. Everything else in
      this plan is the local half, and it now carries the whole weight.
- [x] **Greg: change GitHub's default branch to `dev`** — done 2026-09-02 from the Mac,
      `gh api -X PATCH repos/spideryarn/reading2 -f default_branch=dev`. Checked first that Vercel's
      `link.productionBranch` is an explicit project setting and still reads `main`, so `dev` pushes
      cannot promote themselves. Carried over from
      [worktrees.md § Runbook A](../project/worktrees.md#runbook-a-flip-the-trunk-to-dev-done-2026-09-02).
      **The flip does not reach existing clones**: every checkout still needs
      `git fetch origin dev && git remote set-head origin -a`, which is now the *right* spelling
      precisely because the two settings finally agree. Done on the Mac; still owed on the box.
- [ ] Delete the leftover local branches `worktree-e2e` and `worktree-spike`, so `--all` has nothing
      to leak. The permission classifier refuses `git branch -D` from an agent, so this is Greg's or
      needs asking.
- [ ] Consider deleting the local `main` branch. Nothing reads it — checked, `deploy.ts` only reads
      `origin/main` — so after the next deploy it is a ref that sits permanently behind and confuses
      anyone reading `git branch -vv`. Cosmetic, not a protection.

### Before building any of it

- [ ] **GPT Sol review**, which is required rather than optional
      ([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)) and has not happened for this
      plan. Hand it this file plus `protect-shared-tree.sh`, the `deploy.ts` push site, and the
      measured table above. Ask it specifically about the fail-closed tension in decision 4 and about
      spellings of "reach `main`" that the stdin check would miss.
- [ ] Pull first, since several agents share this tree.

## Risks

- **The hook blocks every agent's push.** The realistic failure, now that push-at-end-of-work is a
  rule. Mitigated by decision 4, by the `refs/heads/maintenance` near-miss test, and by Stage 1
  landing before Stage 2 so the blast radius starts at one box.
- **A protection that is silently absent.** Stage 2's `preflight` gate exists for this, and it must
  test the hook's *behaviour*, not its existence.
- **False confidence from the wrong evidence.** `npm run deploy -- --dry-run` never reaches the push,
  so it cannot prove the authorised path works. Named in Stage 1 rather than discovered later.
- **Nothing here protects the remote.** A pre-push hook is client-side and per-clone by nature.
  Anyone with a clone that has not run Stage 2 is unprotected, and GitHub offers no server-side hook
  outside Enterprise. Stage 3's force-push protection is the only server-side layer available.
