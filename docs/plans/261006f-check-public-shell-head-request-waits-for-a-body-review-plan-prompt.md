# Plan review: check-public-shell's HEAD request waits for a body

You are reviewing a short plan before anything is built. Read-only: do not edit files.

## Candidate (live, pre-commit)

- Base: the current `HEAD` of this worktree.
- Untracked file, the plan: `docs/plans/261006f-check-public-shell-head-request-waits-for-a-body.md`
- The code it is about: `scripts/check-public-shell.ts` — `curlRequest` (about line 871),
  `judgeHeadMatchesGet` (about line 570), `checkHeadMatchesGet` (about line 1626). Start there; that
  does not limit scope.

You have no network, not even loopback, so you cannot run curl against anything. Measured by me on
2026-10-06 against production, three runs, `curl 8.5.0`:

```
curl --http1.1 --path-as-is -H 'Accept-Encoding: identity' -H 'Connection: close' -sS --max-time 30 \
  -D - -o body --request HEAD --ignore-content-length https://www.spideryarn.com/read/2608-13566v1-spya-yurten
HTTP/1.1 200 OK / Content-Length: 11300 / Connection: close / size_download=0 / exit 0 / 0.14s
```

and the old flags (`--request HEAD` alone): exit 28 after the timeout, "0 out of 11300 bytes received".

## What I want

An independent attack on the plan first. Is the diagnosis right? Does the proposed fix keep every
one of the four things `judgeHeadMatchesGet` asks, and can each still fail? Is the proposed test
able to go red for the right reason? Is there a simpler or more exact fix the plan dismissed
wrongly?

Severity scale: P0 the fix would make the check pass when it should fail; P1 wrong or will not work;
P2 worth changing; P3 nit. Give every finding an id (F1, F2, …), its severity, and what you would do
instead. End with one line: `VERDICT: build it` or `VERDICT: change the plan first`.

## My own suspicions (already mine; spend most of the run elsewhere)

- Whether `--ignore-content-length` with `--request HEAD` has curl behaviour I have not seen on other
  curl versions (the Mac ships a different curl from the box's 8.5.0).
- Whether a chunked HEAD response, or one with no Content-Length, changes anything.
