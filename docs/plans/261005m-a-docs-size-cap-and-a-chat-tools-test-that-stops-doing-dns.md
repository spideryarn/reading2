# A size cap on docs/, and a chat-tools test that stops asking DNS

Up: [plans.md](../project/plans.md) · the postmortem this builds the guard for:
[261005r](../postmortems/261005r-a-slice-between-two-markers-can-be-empty-and-replace-with-an-empty-needle-succeeds-everywhere.md)

Two small tooling bugs from the Overseer's queue, qi-em9nyt53 and qi-pbj4dhy2. Neither is seen by a
reader, so there is no browser check.

## 1. qi-em9nyt53: a plan grew to 22 MB

Commit f36b4507d took
`docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md` from
17,524 bytes to 22,384,830: one 1,278-byte question block sat between every two characters of the
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
Re-running those two lines on the last good version gives 22,382,524 bytes, which is the bad
commit's file up to the 2,306 bytes the same script then appended (GPT Sol's count). Nothing raised. The
commit used `git commit -q -- docs src evals`, so its stat line was not printed either.

**What gets built**

- `tests/docs-size-cap.test.ts`. Every file under `docs/` that git tracks or would track
  (as built: every file on disk under `docs/`, the way `doc-links.test.ts` reads it, so it is red
  before the commit) is at most **4 MB if its extension is on a short list of image and media
  types, and 1 MB otherwise**, so an extension nobody listed gets the stricter cap. Today's largest are 805 KB (a pasted test log) and 1.06 MB (a
  screenshot), so nothing existing fails. A second test rebuilds the incident from its own two lines
  and checks the same predicate refuses the result, so the guard stays proved against the shape it
  was written for. Seen red first by putting the 22 MB file from f36b4507d back in `docs/`.
- The postmortem, with the class named.

**Passed over, and why**

- *A check at commit time* (extending `check:staged-revert`, or a git hook). The repo has no hooks,
  and the author ran the full suite two minutes after the commit, where this test would have been
  red before anything was pushed. A hook is a second mechanism for the same catch.
- *A detector for repeated text.* It is aimed at the instance. The size cap also catches a pasted
  log, a base64 image, or a model's runaway output.
- *A rule in a doc that scripted edits must check `s.count(old) == 1`.* It is the fix for the class
  and costs nothing, but a rule doc is edited one approved set at a time
  ([edit-important-docs.md](../reusable/edit-important-docs.md)), so it goes to Greg as a proposal in
  the debrief instead of being slipped in here.

## 2. qi-pbj4dhy2: a test does a real DNS lookup

`tests/chat-tools.test.ts`, *still fetches a different page on the same host*, stubs
`globalThis.fetch` but `read_web_page` calls `fetchDocument`, whose address guard resolves the
hostname first (`defaultResolve` in `src/fetch.ts`, `node:dns/promises`). So the test asks real DNS
for `example.com`, and offline it fails before the stub is reached.

Reading the file turned up the wider version of the same thing: three other tests call
`read_web_page` on an address that is not refused (*still allows an ordinary URL with real query
parameters*, and the `www` and `http` spellings) with **no fetch stub at all**. Each asserts only
`not.toBe("refused")` or `not.toBe("already open")`, which a failure also satisfies, so each does a
real lookup and then a real request to example.com and passes either way.

**What gets built.** `vi.mock("node:dns/promises")` at the top of that test file, whose `lookup`
**rejects by default** with *a test reached DNS*. So no test in the file can reach the network: the
address guard fails first. The one test that needs a fetch to happen gives the mock a public address
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
| F4 (P3) | the block is 1,278 bytes, and the two lines give 22,382,524 bytes before a later append | corrected above and in the postmortem |

## Done means

Both tests red then green; `npm test` and `npm run typecheck`; GPT Sol on this plan and on the code;
one commit per item; pushed to `dev`.
