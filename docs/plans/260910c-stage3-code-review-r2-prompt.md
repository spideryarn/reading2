# Review, round 2, narrow: Stage 3 of session continuity — a scoped check of four fixes, not a second discovery pass

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/session-continuity`, branch
`worktree-session-continuity`. TypeScript + ESM; **React 19** (19.2.8); vitest + jsdom.

## Why this round exists, and how narrow it is

In round 1 you found F50–F55 and fixed all six yourself, and you would accept the revised stage.
Three of those were P1s, and **a P1 fix that nobody but its author has read gets a narrowly scoped
check of that fix** before it lands — that is the house rule, not a doubt about your work. This is
that check. **It is not a second discovery pass**: please do not hunt for new classes of defect
outside these four fixes, and do not re-open anything round 1 settled.

## The candidate

Committed: commit `f5c7b048e0d3c7a946913be1a3cca83e7ad23e50` — your round-1 fixes, which I read and whose gates I ran.

    git show f5c7b048e0d3c7a946913be1a3cca83e7ad23e50

Read them as **someone else's code**. In scope, and only these:

- **F50** — per-row, per-world execution epochs in `feedEvidence` / `rememberVerified`
  (`tools/fleet/web/src/feed-client.ts`): a first verification is epoch 0; only a later different
  verified token advances it; memory does not cross tmux worlds.
- **F51** — the tmux pid carried beside the digest rather than inside it, and the "two different
  named pids" rule for the immediate world path (`FeedPanel.tsx`'s reader and `feed-client.ts`).
- **F52** — every read entry point deferring while the tab is hidden.
- **F53** — the evidence memory written from an effect rather than during render, and
  `rememberVerified` returning the same object when nothing changed.

Other files in the tree belong to other agents working now (the Stage 1 files, `drafts.ts` and its
cards, `useActions.ts`, `actions-client.ts`). **Do not edit them**; a red in one of them is not
yours.

## What you may change

You may edit the four fixes' own files (`FeedPanel.tsx`, `feed-client.ts`,
`tests/fleet-feed-freshness.test.tsx`) to correct an established defect *in one of the four fixes*,
red-first. Anything else you notice: report it, do not fix it. Do not commit.

## The questions, one per fix

1. **F50.** Every sequence of one row's readings — unknown → verified T1 → unknown → verified T1,
   → verified T2, a row that goes and returns, a world change and back — does the epoch move
   exactly on a real replacement and never otherwise?
2. **F51.** With the pid beside the digest: `42 → null → 42`, `42 → null → 43`, `null` from first
   sight, and `42 → 43` while a read is in flight.
3. **F52.** Is there an entry point that still reads while hidden, or one that now never reads when
   it becomes visible?
4. **F53.** Can the effect that commits the memory run in an order where a digest is computed
   against a memory one collection stale, and does that ever produce a read, or suppress one, that
   the test suite would not notice?

Mutate each fix and confirm its test fails. Findings continue from **F56**, with a severity and
established or reasoned, (a) the input or mutation I can run, (b) the smallest change.

  P0  data loss, exploitable security, or the tool broadly unusable
  P1  user-visible wrong behaviour, or an authoritative contract violated
  P2  design or maintainability risk with no wrong behaviour today
  P3  non-behavioural prose or comment defect

If all four hold, say so in one line each; that is a complete answer.
