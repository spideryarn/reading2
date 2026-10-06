**C1 — P0, fixed:** `--ignore-content-length` exposed a false pass in the judge. For a 22-byte GET, HEAD lengths `22.0`, `2.2e1`, `+22`, or separate fields of 22 and 23 passed. The judge now requires decimal digits and compares every length field. Five regression cases failed before the fix; all seven now pass.

No other findings. The fake server supports its stated behavior, and the supplied mutation failures match the test names. GET/POST callers retain their behavior. Pipe-based curl probes handled 100/103 preambles correctly and caught a second response as forbidden body bytes.

Validation: 23 scoped tests passed, 124 self-tests passed, full typecheck passed. Lint reported one existing complexity advisory. The loopback fixture remains unrun here; I relied on your supplied results. Nothing committed.

Files edited:

- [scripts/check-public-shell.ts](/var/tmp/spideryarn-worktrees/check-public-shell-head-timeout/scripts/check-public-shell.ts:581)
- [tests/check-public-shell-head-headers.test.ts](/var/tmp/spideryarn-worktrees/check-public-shell-head-timeout/tests/check-public-shell-head-headers.test.ts)
- [docs/postmortems/261006j-bypassing-transport-framing-leaves-the-judge-responsible-for-field-validation.md](/var/tmp/spideryarn-worktrees/check-public-shell-head-timeout/docs/postmortems/261006j-bypassing-transport-framing-leaves-the-judge-responsible-for-field-validation.md)

VERDICT: land it