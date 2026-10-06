The diagnosis is right. For the measured response, curl expects GET-style body bytes despite sending `HEAD`. The proposed flags preserve the status, hash and length comparisons; I exercised mismatches for each, and all failed correctly. The existing self-test passed all 122 cases.

**F1 — P0: transfer decoding can hide forbidden HEAD bytes.** The [plan’s claim that curl captures every byte through connection close](/var/tmp/spideryarn-worktrees/check-public-shell-head-timeout/docs/plans/261006f-check-public-shell-head-request-waits-for-a-body.md:38) is too strong. `--ignore-content-length` leaves transfer decoding enabled. Consider HEAD returning:

```http
HTTP/1.1 200 OK
x-spideryarn-shell-sha256: <matching GET>
Content-Length: <GET body length>
Transfer-Encoding: chunked
Connection: close

0\r\n\r\n
```

Those chunk-framing bytes are forbidden after HEAD headers, but decoding produces an empty payload. With matching status, hash and length, the judge can consequently pass. The conflicting framing headers are themselves invalid, yet the judge does not reject them.

Add **HEAD-only `--raw`**, and a fixture sending the terminal chunk that must reach `bodyBuffer` and trigger the no-body failure. Alternatively, explicitly reject `Transfer-Encoding` on HEAD, since this checker requires `Content-Length`. This finding follows curl’s documented decoding behavior; I could not reproduce the specific response without network access.

**F2 — P2: two assertions lack negative regression cases.** The [existing HEAD self-tests](/var/tmp/spideryarn-worktrees/check-public-shell-head-timeout/scripts/check-public-shell.ts:1254) cover incorrect length and unexpected body, but no mismatched status or shell hash. Add one isolated case for each, asserting its specific diagnostic.

The proposed child-process fixture is otherwise sound: `/honest` should fail on the original timeout, and `/lying` should fail under the `--head -o /dev/null` mutation for the intended missing-body-evidence reason. Requiring matching status/hash/length on `/lying` makes that failure specific.

The plan correctly dismisses `--head` for this requirement. A second transport appears unnecessary if the curl approach preserves transfer bytes and tests that property. Missing `Content-Length` remains a loud failure through the existing judge.

VERDICT: change the plan first