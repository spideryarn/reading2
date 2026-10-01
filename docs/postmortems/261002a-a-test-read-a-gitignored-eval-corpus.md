# A test read a gitignored eval corpus, and passed only where the eval had run

**Found 2026-10-02 ~00:20 by the deploy's own test gate, which refused the deploy. Nothing reached a
reader. A sibling of
[261001c](261001c-a-test-on-live-repo-state-passes-only-while-it-is-at-its-default.md), found the
same night by the same gate; read that one for the class. This note says only what is different.**

## What happened

`tests/thinking-effort-eval.test.ts > the lineup > renders Hierarchy's sampled deep gists
reproducibly` failed in every checkout but one:

```
Error: ENOENT: no such file or directory, open
'evals/results/thinking-effort-smoke/corpus/cargocult-spya-rz663q/blocks.json'
```

## The root cause

The test read its blocks from the eval's corpus copy, and `.gitignore` has
`evals/results/thinking-effort-*/corpus/` — added by the same plan, in `61f78bb1d`, because the
corpus is a copy of an article and should not be committed. The test arrived in the next commit,
`3410c8158` (261001p stage 1, GPT Sol's harness fixes, which seeded the gist sample and added this
test to pin it). The session ran the focused suites in the worktree where the smoke run had just
written the corpus, so the file was there and the test was green. Every other checkout lacks it.
The tree it also read *was* committed in `61f78bb1d`, which is why only one of the two reads failed.

## The class, and how it differs from 261001c

Same class: **a test depends on repo state it does not own.** 261001c was a committed file that took
another legitimate value. This one is the other half of the class: a file that is **not in git at
all**, so it exists only on the machine that made it. It is easier to catch, because it fails on
every fresh checkout, but that only helps if a fresh checkout runs the suite before the deploy
gate does.

## The fix

The test now builds its own blocks and tree inline: twelve paragraphs, two parts, six deep gisted
nodes. With six in the pool, a sample of three is a real draw. It also asserts that exactly three
deep gists are rendered, so it checks more than "f(x) equals f(x)". That assertion was watched red
by changing the sample size in `evals/hierarchy-structure/blind.ts` to four. The eval itself is
unchanged.

A skip-if-missing guard was rejected: on every checkout but one it would be a test that cannot fail.

## The sweep

Every path-like string literal and every filesystem read, directory walk and glob in `tests/` was
checked against `git ls-files` and `git check-ignore`, including paths assembled with `path.join`
and `new URL`. The remaining gitignored dependencies have an owner: `data/<slug>` and fixture-backed
`output/` names resolve from the committed `tests/fixtures/data-root/`; other top-level `output/`,
`logs/` and activity-log reads consume files the test itself just made; optional `.env.local` reads
tolerate the file being absent; and `node_modules/` is installed. `dist/` and `api-dist/` are build
output, missing until `npm run build` runs. That is a known and documented gap, not this fault:
[worktrees.md](../project/worktrees.md). The rest are temp-dir-relative names or strings under test.
Every `evals/results/` file a test reads — including files found by listing a results directory — is
tracked. No sibling had this fault.

## What would have caught it

1. **Before committing a test that reads a file, check that `git ls-files <path>` prints it.** Free.
   It is the same habit as 261001c's item 2, with "is it tracked" added to "is it a flag".
2. **Run a new eval's tests from a fresh worktree** before landing it. The eval's own tree is the
   one place they cannot fail.
