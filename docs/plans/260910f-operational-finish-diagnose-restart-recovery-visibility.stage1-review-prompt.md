# Review: plan 260910f stage 1 — each service records the git revision it started from

Repo: /home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose (linked worktree), branch
`worktree-ops-diagnose`. TypeScript + ESM, `tsx`, vitest. `tools/fleet/` must never import
`tools/overseer/`.

## The candidate

Committed: the stage-1 commit on this branch — `git log --oneline -3` shows it, titled
"260910f stage 1: each service records the revision it started from".
`git show --stat HEAD` (or that sha) is the complete manifest. Other agents' uncommitted work is in
the tree; it is NOT the candidate — review only the files that commit names.

Start with: `tools/fleet/revision.ts`, `tools/overseer/notes.ts`, the `runOverseer` start in
`tools/overseer/daemon.ts`, `vite.fleet.config.ts`, `tools/fleet/build-stamp.ts`, and the three new
tests. The plan is `docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.md`
(Decisions D1–D3). This is where to begin, not the limit.

## What it is meant to do

Each process records, once at start, the revision of the checkout its code sits in — or `unknown`
with a reason — so later stages can name the running revision without ever inferring it from HEAD.
**The statement to check for accuracy, not soundness:** *"a `known` stamp with `dirty: false` means
the process started from exactly that commit's tracked content; `dirty: true` means the sha does not
name the running code; `unknown` is never rendered as a match."* Say precisely where that statement
is false, and what wording or code makes it true.

## What you can and cannot run, and what you may change

Findings only: the tree is read-only. /tmp and node_modules caches are writable. You can run one
test file (`npx vitest run tests/<one>.test.ts`) and `node --import tsx <script>`. No network.

## Attack it

Independently first. For each finding: an ID (F1, …), P0/P1/P2/P3 (P0 data loss/security/service
unusable; P1 user-visible wrong behaviour or contract violated; P2 design risk; P3 prose),
established or reasoned; (a) the input or mutation I can run that shows it fails its claim; (b) the
smallest change that closes it. Refuse only on an established P0/P1.

**Write your findings FIRST to
`docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.stage1-review-answer-findings.md`**
if you can write at all; otherwise put the full findings in your final message. The `--output` file
is overwritten with your closing message at exit.

## My own suspicions — read last

- Dirty counts tracked changes only. The implementer points out a commit can import a file its
  author never added; a checkout holding it untracked then stamps clean — which is why
  `readiness-git.ts`'s `stampTree` counts untracked. In the primary, untracked files from other
  agents are always present, so counting all of them makes dirty always true. Is scoping untracked
  files to the paths a service can load (e.g. `tools/`, `scripts/`, `src/`) the honest middle, or is
  there a better one?
- `tsx` compiles lazily: a module first imported after start comes from the tree as it is then.
- The vite stamp is computed at config load; does a `vite build --watch` or a cached config break it?

Do not change any file.
