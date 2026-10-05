# Review: one fix, narrowly. The length band joins Summary's fingerprint

Repo: this worktree, branch `worktree-fbgttwhn-summary-length-follows-text`. TypeScript, ESM.

## The candidate

Committed: the commit at `HEAD` (run `git log -1`); its parent is `de2eb5bb9`.

    git diff de2eb5bb9..HEAD -- src tests

Start with `src/simple-summary.ts` § `evidenceBand`, `inputFingerprint`, `isStale`;
`src/pipeline.ts` § `simple` § `stamp`; `src/store/pg.ts` (the two places that call the Summary
fingerprint: the Metadata "current" check near `case "simple"` and `loadSimpleSummary`);
`tests/simple-two-levels.test.ts` and `tests/simple-summary.test.ts` for its tests.

## What it is meant to do

A previous reviewer found (F6) that two articles could render to identical request bytes, share a
fingerprint, and still be asked for different lengths, because the length band is counted from
blocks. It fixed that itself: for prompt version `simple-prompt/9` and later the band is part of
the fingerprint (`spya-simple-input/2`), and a summary stored by `simple-prompt/1` to `/8` (or a
row whose generic stamp says `simple/2`) keeps the old algorithm (`spya-simple-input/1`).

**That fix is unreviewed code written by someone else. This review is of that fix only.** General
discovery is closed.

The one statement to test:

> After this change, no summary stored in production before it (any prompt version `/1` to `/8`,
> or no `promptVersion` field at all) is reported stale, is rewritten by an unforced job, or is
> refused by a read, that would not have been before it. And a summary written after it is
> current on the next read and the next unforced job, on every path that compares fingerprints.

## What you can and cannot run, and what you may change

The tree is read-only. You have no network, not even loopback. You can run
`npx vitest run tests/simple-two-levels.test.ts`, `tests/simple-summary.test.ts`,
`tests/simple-length-bands.test.ts` and `tests/stage-stamp-agreement.test.ts`, and a script with
`node --import tsx`. I ran those four files and `npm run typecheck`: all passed.

## Attack it

For each finding: an ID from F11, a severity (P0 data loss, security, wrong charging, service
unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2 design risk;
P3 prose), established or reasoned, (a) the input or path that shows it, (b) the smallest change.
Refuse only on an established P0 or P1. End with one line: APPROVE or REFUSE.

Do not change any file.
