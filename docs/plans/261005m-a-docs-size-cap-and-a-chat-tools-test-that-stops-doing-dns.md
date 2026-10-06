# A size cap on docs/, and a chat-tools test that stops asking DNS

Up: [plans.md](../project/plans.md) · the postmortem this builds the guard for:
[261005r](../postmortems/261005r-a-slice-between-two-markers-can-be-empty-and-replace-with-an-empty-needle-succeeds-everywhere.md)

Two small tooling bugs from the Overseer's queue, qi-em9nyt53 and qi-pbj4dhy2. Neither is seen by a
reader, so there is no browser check.

## 1. qi-em9nyt53: a plan grew to 22 MB

Commit f36b4507d took
`docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md` from
17,524 bytes to 22,384,830 bytes: one 1,278-byte question block sat between every two characters of the
old file. It was restored in d6673bebc.

**The cause, found in the authoring session's transcript** (session 0ddfccba, 2026-10-03 20:32:46Z).
The plan was edited by a Python heredoc, not by the Edit tool:

```python
old = s[s.index("**[Q-crossref-count]** Should a row with a DOI"):s.index("**[Q-bar-on-relevance]**")]
s = s.replace(old, new)
```

The second marker also appears earlier in the file, in the sentence that says the question is
*below*. `index` finds that first one, at 4,319, before the first marker at 12,555. A slice whose end
is before its start is the empty string, and `s.replace("", new)` puts `new` at every position.
Re-running those two lines with the heredoc's actual replacement (1,284 bytes) on the last good
version gives 22,487,524 bytes. The script appended 2,306 bytes, bringing it to 22,489,830 bytes;
the next command shortened each of the 17,500 inserted blocks by 6 bytes, leaving the committed
22,384,830 bytes. GPT Sol's plan review reproduced the replacement using the final 1,278-byte
block instead, obtaining 22,382,524 bytes. Nothing raised. The
commit used `git commit -q -- docs src evals`, so its stat line was not printed either.

**What gets built**

- `tests/docs-size-cap.test.ts`. Every regular file on disk under `docs/`, including hidden files
  and directories, is measured before the commit. Symlinks are refused so their targets cannot
  disappear from the check. Each file is at most **4 MB if its extension is on the binary list
  in the test, and 1 MB otherwise**, so an extension nobody listed gets the stricter cap. Today's
  largest are 805 KB (a pasted test log) and 1.06 MB (a screenshot), so nothing existing fails.
  A second test rebuilds the incident from its own two lines
  and checks the same predicate refuses the result, so the guard stays proved against the shape it
  was written for. Seen red first by putting the 22 MB file from f36b4507d back in `docs/`.
- The postmortem, with the class named.

**Passed over, and why**

- *A check at commit time* (extending `check:staged-revert`, or a git hook). The repo has no hooks,
  and the author started the full suite seconds after the commit, where this test would have been
  red before anything was pushed. A hook is a second mechanism for the same catch.
- *A detector for repeated text.* It is aimed at the instance. The size cap also catches a pasted
  log, a base64 image, or a model's runaway output.
- *A rule in a doc that scripted edits must check `assert old and s.count(old) == 1`.* It is the fix for the class
  and costs nothing, but a rule doc is edited one approved set at a time
  ([edit-important-docs.md](../reusable/edit-important-docs.md)), so it goes to Greg as a proposal in
  the debrief instead of being slipped in here.

## 2. qi-pbj4dhy2: a test does a real DNS lookup

`tests/chat-tools.test.ts`, *still fetches a different page on the same host*, stubs
`globalThis.fetch` but `read_web_page` calls `fetchDocument`, whose address guard resolves the
hostname first (`defaultResolve` in `src/fetch.ts`, `node:dns/promises`). So the test asks real DNS
for `example.com`, and offline it fails before the stub is reached.

Reading the file turned up the wider version of the same thing: three other calls reach
`read_web_page` on an address that is not refused (*still allows an ordinary URL with real query
parameters*, and the `www` and `http` spellings) with **no fetch stub at all**. Each asserts only
`not.toBe("refused")` or `not.toBe("already open")`, which a failure also satisfies, so each can do a
real lookup and then a real request to example.com and pass either way.

**What gets built.** `vi.mock("node:dns/promises")` at the top of that test file, whose `lookup`
**rejects by default** with *a test reached DNS*. A counting, rejecting default `fetch` also guards
literal IPs and direct provider requests. It is assigned directly so `vi.unstubAllGlobals()`
restores it after a response stub, and the file-level `afterEach` fails unexpected calls even when
the tool swallows the rejection. The one test that needs a fetch gives the mock a public address
for that test and asserts the lookup was asked for `example.com`. No production seam is added.

Red first: with only the rejecting mock in place, *still fetches a different page* fails, because
the stubbed fetch is never called. That is the proof the test was doing a lookup.

**Passed over:** a `resolve` seam on `ToolContext`, passed through to `fetchDocument`. It widens a
production type that a model's tool call reaches, to serve one test.

## GPT Sol's plan review

[The review](261005m-a-docs-size-cap-plan-review-sol.md): *ready after fixes*. It re-ran the two
Python lines and found the session's command in the transcript itself, and it confirmed that with
no network the three tests it was pointed at return `dns` today and one of them fails.

| | finding | |
|---|---|---|
| F1 (P1) | the DNS mock alone does not keep the file off the network: a literal IP skips the lookup, and `converse` calls `fetch` itself | built: `fetch` refuses by default too and counts what reached it, and an `afterEach` fails the test, because `read_web_page` swallows the throw. Seen red with a temporary test that read a literal IP |
| F2 (P2) | the three admission tests could pass on any earlier failure | built: each now asserts the lookup was asked for its hostname |
| F3 (P2) | a list of *text* extensions gives an unlisted text format the loose cap | built the other way round, as it suggested: a short binary list, 1 MB for everything else |
| F4 (P3) | the committed block is 1,278 bytes, and substituting that block gives 22,382,524 bytes before the append | the code review found an intervening edit; the actual script's reproduction is corrected above and in the postmortem |

## Code review corrections

The discovery regressions went red on a 22,384,830-byte hidden file, a file in a hidden directory,
and file, directory and broken symlinks. The scanner now uses directory entries, includes hidden
paths and refuses symlinks. On Node 26.8.1 the old glob's `parentPath` was correct; exclusion was
the defect.

The network regression substitutes a harmless canary for the transport, then removes globals
both in the test and in a nested teardown. With the original guard the canary was reached and
the counter stayed empty; assigning the default fetch directly keeps it installed through
cleanup. The existing admission assertions still reach lookup, and the different-page assertion
still reaches fetch.

The factual audit reconstructed the committed blob from the transcript's two commands, then
checked the postmortem against it and git. Its corrected measurements are above. The full suite
was red, not green; the original links disappeared rather than multiplied; and only 5312d3a42
later changed this damaged plan. The postmortem now records those facts and qualifies the Edit
tool's empty-file and multiple-match behavior. The original plan-review artifact is retained.

Validation after these corrections: the permitted three-file Vitest run passed 121 tests; the
read-only transcript/git audit passed after first rejecting the candidate prose; lint passed on
the two edited test files. The review made no commits. The wider hidden-path omission in
`doc-links.test.ts` is reported without changing that checker.

## After the code review: the cap test failed on the reviewer's own log

[The code review](261005m-a-docs-size-cap-code-review-sol.md): *land after fixes*, F5 to F9 fixed by
Sol and each read and re-run by me; F10 reported (the doc-link checker also skips hidden paths) and
left, as wider work. Its factual corrections to the postmortem were checked against the transcript
and git and hold, including that the authoring session's full suite was red, not green.

My own full suite, running at the same time, was red on the new test:

```
docs/plans/261005m-a-docs-size-cap-code-review-sol.md.activity.log: 2171099 bytes, cap 1048576
```

`run-codex` writes an activity log beside its answer, in `docs/plans/`, and a long review's is over
1 MB. `.gitignore` names `*.activity.log`, so it can never be committed, but a test that reads the
working tree sees it. So the cap now skips what `git check-ignore` says is ignored, and throws if
that command itself fails. Green with the 2 MB log present, and red again on the 22 MB incident
file put back beside it.

**Gates.** Typecheck passes. The full suite (1,691 files): six tests red. One was the above. Four
ask for `npm run build`, which a fresh worktree has not run. One,
`tests/search-auto-thorough.test.tsx` › *leave Search mode mid-search, come back after it
finished: one row*, fails alone three times out of three; this work touches two test files and
docs, neither of which it can see, so it is reported to the Overseer and not chased here.

## Done means

Both tests red then green; `npm test` and `npm run typecheck`; GPT Sol on this plan and on the code;
one commit per item; pushed to `dev`.
