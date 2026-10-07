# Bypassing transport framing leaves the judge responsible for field validation

Review of `38c26ee01` found a false pass in "HEAD matches GET": a 22-byte GET could be
matched by a HEAD advertising `Content-Length: 22.0`, `2.2e1`, `+22`, or separate lengths
of 22 and 23. The review repaired the judge before recommending this stage. No production
incident was established.

## The cause

The class is **a validation ownership gap after bypassing transport framing**.
`cf3ce9adb` introduced a judge that converted the first length using `Number`, which accepts
nondecimal strings and ignores later header occurrences. `38c26ee01` correctly stopped curl
waiting for the body a HEAD must omit, but that also removed the framing failure which had
masked these cases. Transport success now needed an independent field validator.

The `0x16` variant already passed before this stage; the other cases above became clean
responses after the new flags. The repair covers the shared grammar weakness too.

## Evidence

Real curl 8.5.0 was supplied canned HTTP response bytes through a pipe-backed socket shim,
without opening a network connection. All responses closed after the headers, with no body.
This exercises curl's response parser, not TCP behavior or the committed loopback fixture.

| HEAD length fields | Original flags | HEAD's new flags |
|---|---|---|
| `22.0` | exit 18, 22 bytes missing | exit 0, body 0 bytes |
| `2.2e1` | exit 18, 2 bytes missing | exit 0, body 0 bytes |
| `+22` | exit 18, 22 bytes missing | exit 0, body 0 bytes |
| `22` followed by `23` | exit 18, 23 bytes missing | exit 0, body 0 bytes |
| `0x16` | exit 0, body 0 bytes | exit 0, body 0 bytes |

The original judge returned `[]` for every row with a matching 22-byte GET. The new
[header regression tests](../../tests/check-public-shell-head-headers.test.ts) were run
before the repair: five failed with `expected [] to deeply equal` the diagnostic, while
two valid cases passed. After the repair, all seven passed. The existing 124 self-tests
also passed.

## What would have caught it, ranked

1. **Validate every length field before comparing bytes** — implemented in
   [the judge](../../scripts/check-public-shell.ts). Require decimal digits and check every
   occurrence against GET's actual byte length. Leading zeros and repeated identical
   lengths remain accepted.
2. **Test malformed framing metadata when bypassing transport framing** — the existing
   fixtures covered correct lengths, missing payloads and forbidden payload bytes; none
   exercised metadata the transport would cease interpreting.
3. **Restore curl's length framing** — rejected: it reinstates the original failure on a
   correct HEAD. A second raw transport would add machinery without removing the need to
   validate the fields.

The narrow repair is also the long-term repair: the component comparing a claimed byte
count must validate its syntax and every occurrence, rather than depend on another layer's
failure to prevent its own false pass.
