# check-public-shell: the HEAD request waits for a body that never comes

Queue item `qi-kdwdy2v2`, handed over by the Overseer on 2026-10-06. One stage.

## What is wrong

`scripts/check-public-shell.ts` check 5, "HEAD matches GET", fails against production with
`curl exited 28 … 0 out of 11300 bytes received`. The site is fine. The check is not.

`curlRequest` sends a HEAD with `--request HEAD`. That flag only changes the word on the request
line: curl still behaves as if it had sent a GET, so when the response says `Content-Length: 11300`
it waits for 11300 bytes. A correct HEAD response has no body, so curl waits until `--max-time 30`
and exits 28. Reproduced on 2026-10-06:

```
curl --http1.1 -sS --max-time 8 -o /dev/null --request HEAD https://www.spideryarn.com/read/2608-13566v1-spya-yurten
curl: (28) Operation timed out after 8002 milliseconds with 0 out of 11300 bytes received
```

So the check fails on exactly the response it was written to accept, and can only have passed
before if the connection was closed for it or the header was missing.

## What the check has to keep

`judgeHeadMatchesGet` asks four things of the HEAD response: same status as GET, same shell hash
header, a `Content-Length` equal to GET's real body, and **no body**. The last one is the one a fix
can quietly delete, and the queue item says so: it must still go red when a HEAD response really
carries a body.

## The fix

For HEAD only, add two things to the curl command and keep `--request HEAD`:

- `-H 'Connection: close'` — ask the server to close the connection after this response.
- `--ignore-content-length` — tell curl not to believe `Content-Length`, and to read until the
  server closes.
- `--raw` — added after the plan review (below): hand over the bytes as they came, undecoded.

Together: curl reads whatever bytes actually follow the headers, until the close. An honest server
sends none, curl exits 0 with an empty body file, and the check passes. A server that wrongly sends
a body on HEAD gets those bytes written to the body file, and `judgeHeadMatchesGet` reports
`HEAD returned a body of N bytes`. `-D` still writes the headers to their own file untouched, so
`Content-Length` is still read and compared, and repeated headers still look repeated.

Tried against production, three times: `200`, `Content-Length: 11300`, `Connection: close`, body 0
bytes, exit 0, 0.14 s.

**If a server ignores `Connection: close`** and holds the connection open, curl waits the 30 s and
exits 28, and the check fails with curl's own message. That is loud, not silent, and it is the same
failure as today, so nothing is lost.

## What was passed over

- **`--head` (`-I`) alone.** Tried before this plan and reverted: with `-o`, curl writes the headers
  into the body file, so the "no body" test reads the headers as a body.
- **`--head -o /dev/null` plus a byte count.** curl's `--head` mode stops reading at the end of the
  headers by design, so the byte count is always 0 whatever the server sent. It would pass, and it
  could never fail: the "no body" assertion would be decoration.
- **A raw `node:net` / `node:tls` request.** It would see every byte, and it is the more exact
  instrument. Passed over because every check in the script is synchronous on `spawnSync("curl")`,
  and this would add a second transport, with its own TLS and timeout handling, for one check. The
  curl flags get the same evidence with two arguments. If `Connection: close` ever stops being
  honoured by the host, this is what to build.

## The test, red first

`tests/check-public-shell-head.test.ts`, against a fake server in a **child process** (`spawnSync`
blocks the event loop, so a server in the test's own process could never answer). The fake speaks
raw `node:net`, because Node's own `http` server strips a body from a HEAD response. It closes the
connection only when asked to, like a real keep-alive server. Two routes:

1. `/honest` — headers with a `Content-Length`, no body. `curlRequest(url, "HEAD")` must return no
   `curlError` and an empty body, and `judgeHeadMatchesGet` must pass. **Red on today's code** (curl
   exits 28).
2. `/lying` — the same headers followed by a body. The body must arrive in `bodyBuffer`, and
   `judgeHeadMatchesGet` must report it. This is the half that proves the check can still fail; it
   is seen red by temporarily swapping in the `--head -o /dev/null` variant above.

`curlRequest` becomes an export, with an optional `maxTimeSeconds` so the red run does not take
thirty seconds per case.

## Done when

- Both tests seen red for the stated reason, then green.
- `--self-test`, `npm test` for the touched files, `npm run typecheck`.
- The real script against production with `--public-slug 2608-13566v1-spya-yurten`: 43 passed.
  It only reads.
- GPT Sol has reviewed this plan and then the code.

## The plan review, and what it changed

GPT Sol, 2026-10-06, read-only: [the prompt](261006f-check-public-shell-head-request-waits-for-a-body-review-plan-prompt.md),
[the answer](261006f-check-public-shell-head-request-waits-for-a-body-review-plan-sol.md).
Verdict: change the plan first. Two findings, both taken.

- **F1 (P0) — right, and reproduced.** `--ignore-content-length` leaves curl decoding a transfer
  encoding. A HEAD response with `Transfer-Encoding: chunked` followed by `0\r\n\r\n` sends five
  bytes that decode to an empty body, so the check would have passed. A third route, `/chunked`,
  was added to the test and seen red (`expected '' to be '0\r\n\r\n'`); `--raw` on the HEAD
  request turns it green.
- **F2 (P2).** `--self-test` had no case for a HEAD whose status or shell hash differs from GET's.
  One of each added, each asserting its own message and no other.

## What landed

As planned plus the two findings. Seen red, in order: `/honest` on the original code (curl 28,
"0 out of 22 bytes received" — production's message); `/lying` with `--head -o /dev/null` swapped
in (body arrived empty); `/chunked` without `--raw`. The real script against production with
`--public-slug 2608-13566v1-spya-yurten`: 43 passed, 0 failed, 3 skipped.
