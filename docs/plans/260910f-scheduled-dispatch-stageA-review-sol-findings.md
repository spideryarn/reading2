# Stage A review findings — GPT Sol

This file is the durable record required by the Stage A review brief and was created before any
review fix. Findings below were recorded before their fixes.

## Findings

### S1 — P1: `succeeded` does not require the answer projected beside it or a valid zero denial count

Evidence: `tools/overseer/occurrence-result.ts:279-298`. The last return is reached when
`permissionDenials` is `-1` (or another invalid negative count), because only `> 0` and `null` are
handled. More importantly for the real seam, `exitLadder` considers only `answerUsable` from the
exit record and never the `ObservedLaunch.answer` which the projection puts beside the result. A
completed exit with `answerUsable: true`, an ok verdict, no limit, zero denials, and
`answer: { kind: "absent" }` therefore reads `succeeded` and is projected with “no answer file”.

Consequence: the page can make the authoritative green success claim without the usable answer it
claims exists; a malformed denial count can make the same claim without positively zero denials.

Change: fixed in `occurrence-result.ts` and `overseer-occurrence-result.test.ts`. The four new cases
failed red (`succeeded` in all four), then passed after the success ladder began reading the
projected answer and requiring `permissionDenials === 0`.

### S2 — P1: revision siblings can put the older occurrence in the page's “last” slot

Evidence: `tools/overseer/occurrences-projection.ts:104-115`. Ordering used `scheduledAt` and then
launch id. The accepted F1 disposition says revision siblings share the nominal due instant and
that “newest” is decided by `plannedAt` before fold insertion order. Launch ids are hashes, not
chronology. While this review was running, commit `e92172a7` made the final index-order tiebreak
explicit across every “newest” selector; the first review fix still used launch id for an exact
`plannedAt` tie.

Consequence: after revision B supersedes revision A at the same due instant, the dashboard can show
A as the latest occurrence and hide B behind the “earlier” disclosure.

Change: fixed in `occurrences-projection.ts` and its test. The sibling test failed red with A before
B, then passed after descending `plannedAt` became the second key. The concurrently clarified exact
tie also failed red, then passed after the projection made the input's fold order explicit and used
reverse fold insertion order as the final tiebreak.

### S3 — P1: the parser accepts classifier-impossible success rows

Evidence: `tools/fleet/occurrences-parse.ts:218-266`. The copied state/result-kind table is complete,
but `parseResult` accepts `at: null` for every result and `parseOccurrence` does not relate a
`succeeded` result to its answer or attempt count. A `completed`/`succeeded` row with `at: null` and
`answer: { kind: "absent" }` parses as readable; the page then prints a green `SUCCEEDED`, “no ending
yet”, and “no answer file”. It also accepts a usable zero-byte answer, which
`answerIsUsable` can never produce, and an answer from an attempt beyond the occurrence's count.

Consequence: damaged or drifting producer data can bypass the classifier's success contract at the
fleet boundary and be drawn as a coherent success.

Change: fixed in `occurrences-parse.ts` and its test. Both new tests failed red. The parser now
requires null result instants only for `pending`, `admission-waiting`, and `running`, requires an
instant for every other result, refuses an answer beyond the occurrence's attempt count, refuses a
usable zero-byte answer, and requires success to carry a present usable non-empty answer.

### S4 — P1: an unreadable or oversized authority file is reported as “not found” by the answer route

Evidence: `tools/fleet/routes-occurrences.ts:207-225`. `listedAnswer` maps an oversized read, an I/O
failure, malformed JSON, an unsupported schema, and a top-level parser refusal to its `absent` arm;
`serveAnswer` turns that into HTTP 404 at lines 405-407. This contradicts the dashboard rule that
“we looked and found nothing” is distinct from “we could not look”, and the module's own
`AnswerRead.unreadable` 503 arm.

Consequence: operators are told an answer does not exist when the dashboard could not establish
whether the occurrence was authorised or what answer it names.

Change: fixed in `routes-occurrences.ts` and its test. Malformed, unsupported-schema, and oversized
authority files all failed red as 404, then passed as 503. A genuinely absent file and an unlisted
id remain 404.

### S5 — P1: a duplicate launch id hidden inside an unreadable job escapes the ambiguity refusal

Evidence: `tools/fleet/routes-occurrences.ts:224-234`. Duplicate detection flattens only parsed job
rows. If one job is unreadable for an unrelated field such as an unknown `next` kind, every one of
its occurrence ids disappears from this check. The same launch id in a second readable job is then
treated as unique and its answer is served.

Consequence: the route can serve bytes where the bounded authority file names the id twice and
cannot unambiguously bind the id-only URL to one projected result.

Change: fixed in `routes-occurrences.ts` and its test. The hidden duplicate served 200 red; the route
now counts ids at the raw job/occurrence seam before selecting the readable row and refuses the
ambiguous file with 404.

### S6 — P3: “(empty)” is narrower than the predicate that produced it

Evidence: `tools/fleet/web/src/ScheduledOccurrences.tsx:89-113` and
`scripts/subagent-cli.ts:476-512`. `answerIsUsable` is false for zero bytes, ASCII-whitespace-only
bytes, and any file it cannot inspect. The page labels every present `usable: false` answer
“(empty)”.

Consequence: a whitespace-only or otherwise unusable answer is described as a specifically empty
one.

Change: fixed in `ScheduledOccurrences.tsx` and its test. The new wording assertion failed red on
“(empty)”, then passed with “(empty or unusable)”.

## Checked without a finding so far

- The copied state/result-kind table itself accepts every kind the classifier emits for each state
  and refuses the other state/kind pairs. S3 is in the adjacent timestamp/answer invariants, not a
  missing table entry.
- The fleet additions do not import an Overseer module, and the browser path reaches only the
  node-free parser leaves plus browser modules.
- Request ids are matched as raw, anchored `lo-<20 lower-case hex>` segments. Encoded separators and
  traversal strings cannot reach path construction. The list and answer reads are bounded and use
  the same descriptor for `fstat` and read; final symlinks and FIFOs are refused. An ancestor
  directory can theoretically be exchanged after `lstat`, but the answer's size and SHA-256 are
  verified on the final descriptor, so that race cannot disclose different bytes. The configured
  store root is intentionally trusted.
- Every instant reaching render is canonical and inside `Date`'s range; duration formatting handles
  non-finite values. The route catches the only `toISOString` call if an injected clock is invalid.
- Throwing on an occurrence filed under the wrong job is the correct projection contract: it
  prevents misattribution and the daemon owns translating producer bugs into a stated write failure.

## Files changed by this review

- `docs/plans/260910f-scheduled-dispatch-stageA-review-sol-findings.md`
- `tools/overseer/occurrence-result.ts`
- `tools/overseer/occurrences-projection.ts`
- `tools/fleet/occurrences-parse.ts`
- `tools/fleet/routes-occurrences.ts`
- `tools/fleet/web/src/ScheduledOccurrences.tsx`
- `tests/overseer-occurrence-result.test.ts`
- `tests/overseer-occurrences-projection.test.ts`
- `tests/fleet-occurrences-parse.test.ts`
- `tests/fleet-occurrences-route.test.ts`
- `tests/fleet-scheduled-occurrences-section.test.tsx`

## Gates

- Requested nine-file Vitest command: **exit 1** — 215 passed; the sole failure was test setup for
  the pre-existing FIFO case, where this workspace sandbox refused the test's
  `execFileSync("mkfifo", ...)` with `EPERM` before route code ran.
- The identical nine-file command excluding only that FIFO case: **exit 0** — 215 passed, 1 skipped.
  The answer route's positive control, traversal/encoding, every symlink level, answer hash/size,
  oversized authority, hidden duplicate, and response tests all ran green.
- `npm run typecheck`: **exit 1** before the checker ran — this workspace sandbox refused the `tsx`
  CLI's Unix IPC listener at `/tmp/tsx-1000/14.pipe` with `listen EPERM`.
- The same checked script without the `tsx` CLI IPC wrapper,
  `node --import tsx scripts/typecheck.ts`: **exit 0** — all four TypeScript projects passed and all
  2,022 source files were covered.
- `npx biome lint --diagnostic-level=error` on the ten changed implementation/test files:
  **exit 0**.
- `git diff --check`: **exit 0**.

## Verdict

**Ready with fixes, conditional only on rerunning the two exact commands outside the reviewer
sandbox.** S1–S5 (P1) and S6 (P3) are fixed red-first. No code failure remains in the runnable gates,
and no wider finding is open. Do not commit until a normal shell has supplied the FIFO test and the
exact `npm run typecheck` evidence the sandbox prevented here.
