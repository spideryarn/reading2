# Review: Stage 1 — passage questions reach for the web, and every claim says where it came from

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations, branch
worktree-fb3d-3f-chat-tools-web-and-citations. TypeScript + ESM, React client, Node server, OpenRouter
for model calls. A reading app: the article is split into blocks with stable ids (`spya-xxxxxx`), and
chat answers cite them.

## The candidate

Committed: commit STAGE1_SHA (one commit).
`git show --stat STAGE1_SHA` prints the complete list of changed paths; `git show STAGE1_SHA` the diff.

**Uncommitted work from a parallel Stage 2 is also in this tree** — `src/chat-tools.ts`,
`tests/chat-citations-tool.test.ts`, `tests/live.test.ts`, `docs/project/citations.md`. It is NOT
part of this review and will get its own; do not review it and do not edit it.

Start with: `src/converse.ts` (`SYSTEM`, `WEB_LINKS`, `helpSection`), `src/web/ChatPanel.tsx` (the
`.chat-sources` list), and the tests in the commit. This is where to begin, not the limit — the
commit's path list is.

## What it is meant to do

The plan is `docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md`
(Stage 1), and your own plan review is beside it (`…-review-sol.md`) — its findings F1–F4, F8 and F10
are the ones this stage was meant to carry out.

In short: a question about a passage — the gutter "?" or a typed follow-up — should reach for the web
when the reader wants a broader sense of how the passage sits in the world, and every claim in the
answer should be marked with where it came from (article → block id; web → link; reader's library →
named article; the model's own inference → said so; no unlinked factual memory). A "From the web"
label sits over the sources list, only when there is at least one web source.

Invariants: `helpSection` byte-for-byte unchanged; the cached prefix byte-identical between help and
ordinary turns; the existing search encouragement and the "what a paragraph plainly says"
counter-pressure unchanged; nothing moves below or above the cache breakpoint that should not.

**Measured result** (the eval is `evals/chat-web-reach.ts`; results under `evals/results/`): see the
plan's § Progress for the baseline and the after-run, with the acceptance thresholds that were fixed
before the after-run. AFTER_RUN_SUMMARY

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage under review — each finding red-first, with
the test that reproduces it — and leave everything wider as a finding for me to decide. Do not commit.
Do not touch the Stage 2 files listed above. List every file you changed at the end.

/tmp and the node_modules caches are writable. You can run one test file at a time
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). You have no
network, not even loopback: the eval makes live model calls and cannot run in your sandbox — its raw
results are the JSON files named in the plan.

## Attack it

Independently, before you read my questions below. The claim to break: **the prompt now makes a
broader-context question about a passage search the web without making ordinary passage questions
search, and an answer cannot present a web or remembered fact as if it came from the article.** Read
the prompt as the model will. Look for contradictions between the new section and the rest of
`SYSTEM`, `WEB_LINKS`, `NO_UNRUN_TOOL_CLAIMS`, `PROFILE_RULES` and `REMEMBER_SYSTEM` (which shares
`WEB_LINKS`); for anything that pushes the model to drop block ids; for a rendering path where the
heading can lie; and for whether the measurement actually supports the claim.

For each finding give:
  - an ID — **numbered from F12 upwards**, since F1–F11 were used by the plan review
  - a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the input or mutation I can run that shows it fails its own claim
  - (b) the smallest change that closes it — a code block or exact replacement wording
A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it. End with a one-line verdict:
"land", "land after my fixes F…", or "stop: F…".

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Whether "no unlinked factual memory" is enforceable by a prompt at all, or whether it will just
  make the model hedge everything it knows.
- Whether the new trigger and the "?" addendum's *"could not follow it"* still pull against each
  other on a help turn.
- Whether the `WEB_LINKS` rewording changes Remember answers in a way nobody measured.
