The root cause checks out, and the DNS module mock works under Vitest. The plan needs a stronger boundary around `fetch`.

- **F1 — P1: DNS mocking does not enforce the promised network isolation.** [Plan lines 66–69](/var/tmp/spideryarn-worktrees/q-yeses-plan-inflation-dns-stub/docs/plans/261005m-a-docs-size-cap-and-a-chat-tools-test-that-stops-doing-dns.md:66) claim no test can reach the network. Public literal IPs bypass resolution in [guardAddress](/var/tmp/spideryarn-worktrees/q-yeses-plan-inflation-dns-stub/src/fetch.ts:1032). Also, `converse` reaches the AI gateway’s direct `fetch`, independently of this DNS mock. Today’s exercised paths are covered by the proposed DNS mock and existing fetch stubs, but the guarantee depends on each test remembering its stub. Add a rejecting default `globalThis.fetch` stub, with explicit overrides for tests that need responses. Record unexpected calls and assert afterward: `read_web_page` catches thrown errors, so throwing alone need not fail a test.

- **F2 — P2: The admission tests retain weak assertions.** The query-parameter and `www`/`http` tests can pass on unrelated failures before resolution. Specify assertions that each expected hostname reached the mocked lookup. This proves the URL passed the checks those tests cover. The concurrent implementation already added these assertions; carry them into the plan.

- **F3 — P2: The extension list gives unknown text formats the looser cap.** A 3 MB `.yaml`, `.ts`, or extensionless text file would pass. The cheapest guard for this incident is one **4 MB cap for every file**, using filesystem sizes without reading contents. If the tighter prose cap matters, default to **1 MB**, with **4 MB for a short raster-image allowlist**. NUL sniffing adds reads and is only a heuristic. Either proposed cap rejects the original 22 MB Markdown file. Current maxima are 804,558 bytes for listed text and 1,056,478 bytes for an image, so neither threshold rejects existing files.

- **F4 — P3: Correct the reproduction measurements.** The start and end offsets are exactly **12,555** and **4,319**, producing an empty needle. The inserted block is **1,275 Unicode characters / 1,278 bytes**; **1,276** is the character stride between repeated blocks. The two Python lines produce **22,382,524 bytes**, exactly matching the bad commit’s prefix. A subsequent **2,306-byte append** brings it to **22,384,830 bytes**. I also confirmed the offending script and timestamp in the authoring transcript.

The repository size scan would catch the original tracked file. The synthetic predicate test would also reject its expansion, provided it uses a sufficiently large input. That synthetic test does not prove file discovery; the proposed red run against the actual historical file does. A unique, nonempty replacement assertion would prevent the authoring mistake earlier, but a size test is a reasonable cheap backstop.

I made no source or documentation edits. Another process changed the test file during review, so I tested the base version through an in-memory Vitest transform:

| Base test location | Sandbox result |
|---|---|
| Near line 353: ordinary query parameters | Returns `dns`; passes |
| Near line 760: `www` and `http` spellings | Both return `dns`; passes |
| Near line 771: different page on the same host | Returns `dns`; fetch spy receives **zero calls**; fails |

The base suite finished **92 passed, 1 failed**. The permitted live command ran the concurrent DNS implementation and finished **93 passed**, confirming the mock reaches `src/fetch.ts`’s named import and does not break the other tests.

**Verdict: ready after fixes.**