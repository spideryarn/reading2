# Review: a plan for a size cap on docs/ and a chat-tools test that stops asking DNS

Repo: this worktree, TypeScript + ESM, vitest.
READ-ONLY: do not change any file. This is a plan review; nothing is built yet.

## The candidate

Live pre-commit: base c4933aa86; untracked:
- docs/plans/261005m-a-docs-size-cap-and-a-chat-tools-test-that-stops-doing-dns.md (the plan)

Start with the plan, then: tests/chat-tools.test.ts (the read_web_page tests near lines 340-355 and
730-780), src/chat-tools.ts (read_web_page, near line 1067), src/fetch.ts (defaultResolve near line
870, FetchOptions near 771, and where resolve is called before the fetch), tests/doc-links.test.ts
(how an existing test lists docs with git ls-files), and the commit the first item is about:
`git show --stat f36b4507d` and `git show f36b4507d~1:docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md`.
That is where to begin, not the limit.

## What it is meant to do

Two queue items, verbatim:

> Bug: commit f36b4507d inflated plan 261003m to 22 MB by inserting a question block between every
> character. [...] Whatever wrote it may do it again. Root-cause it, write the postmortem with the
> class named, and add the cheapest guard (e.g. a test or pre-commit check that no docs/ file
> exceeds a size cap).

> tests/chat-tools.test.ts:765 does a real DNS lookup before its fetch stub. A test that touches the
> network is flaky offline and slow on a loaded box; stub the lookup too.

## What I want from you

An independent attack on the plan first. Is the root cause it states actually what happened (you
can re-run the two Python lines on the f36b4507d~1 version)? Would each guard fail on the original
shape? Is there a cheaper or better-aimed guard? Does mocking node:dns/promises in that test file
really keep every test in it off the network, or is there another path to a socket? Will the mock
break any other test in the file?

You may run one test file: `npx vitest run tests/chat-tools.test.ts`. You have no network, which is
itself evidence for the second item: say what the tests near lines 353, 760 and 771 do in your
sandbox today.

Grade every finding P0 to P3 by consequence (P0 data loss or security; P1 wrong behaviour or a
contract violated; P2 design or maintainability risk; P3 prose), give each an ID (F1, F2, ...), and
end with one verdict: ready to build, ready after fixes, or not ready.

## My own suspicions, worth less than yours

- Whether 1 MB and 4 MB are the right caps, and whether listing text extensions is worse than
  sniffing for a NUL byte.
- Whether a module mock of node:dns/promises reaches the import inside src/fetch.ts under vitest.
