Verdict: revise before building. No P0 findings; four P1s and two P2s.

### Findings

**F1 — P1: Stage 3’s production filesystem path is underspecified and copying the certificate approach would fail**

Evidence: [plan lines 83–98](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md:83), [vercel.json:16](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/vercel.json:16), [src/vercel.ts:21](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/vercel.ts:21), [src/db/ssl.ts:30](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/db/ssl.ts:30).

`src/vercel.ts` explicitly warns that `import.meta.dirname` changes when the API is bundled; the certificate survives because production supplies `PGSSLROOTCERT`. A mockups reader copied from `ssl.ts` would look in the wrong directory.

Vercel supports this design, but recommends resolving repository files from `process.cwd()`. Also, `includeFiles` is one string, not an array. Use something like:

```json
"includeFiles": "{certs,docs/mockups}/**"
```

Then resolve `path.join(process.cwd(), "docs", "mockups")`. Read only when a mockup route is called—not during module import—or a missing directory could take down the single function serving every API route. Treat an absent directory as an empty list. Add a total image-size cap as well as a per-file cap, because included files count toward the function bundle limit. [Vercel file-reading guide](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions), [configuration schema](https://vercel.com/docs/project-configuration/vercel-json), [function limits](https://vercel.com/docs/functions/limitations).

Add both a static config test preserving `certs` and `docs/mockups`, and an authenticated post-deploy smoke test; a local filesystem test does not prove Vercel packaged the files.

**F2 — P1: The admin gate is sound, but a normal `<img src>` will not authenticate**

Evidence: [plan lines 88–90](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md:88), [src/routes.ts:15224](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/routes.ts:15224), [AdminFeedbackList.tsx:127](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/web/AdminFeedbackList.tsx:127), [binary-response.ts:12](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/binary-response.ts:12).

Anything under `/api/admin/` is gated before dispatch, so that is the right boundary. The client, however, authenticates with a bearer header; `<img src="/api/admin/mockups/…">` sends no such header and gets 401.

Concrete fix:

- Fetch image bytes with `apiFetch`, check `res.ok`, create and later revoke a blob URL, following the existing feedback-screenshot component.
- Serve with `sendBinary`, `Cache-Control: private, no-store`, an allowlisted content type, and `nosniff`.
- Let the URL contain only a validated mockup ID. Resolve the image filename from the validated manifest; never join a caller-supplied filename onto the directory.
- Test list, detail, and image as both admin and non-admin.

Putting images in `public/` would be simpler but would make them public. Keeping them inside the function bundle is the smallest secure version; files inside a function bundle are not directly exposed as static assets. [Vercel function bundle model](https://vercel.com/docs/build-output-api/primitives).

**F3 — P1: `Details` and fenced blocks need one parser, not two sequential transformations**

Evidence: [plan lines 72–79](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md:72), [feedback-question-values.ts:39](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/feedback-question-values.ts:39), [feedback-endings.ts:392](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/scripts/feedback-endings.ts:392), [FeedbackEarlier.tsx:1749](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/web/FeedbackEarlier.tsx:1749).

Today `splitQuestionBody` treats the first exact `Details` line as structural. The compiler separately counts every such line. Therefore this valid-looking mockup breaks:

```text
```
+----------------+
| Details        |
+----------------+
```
```

The exact-line triple-backtick rule is otherwise the simplest robust choice. Implement one small line-state parser shared by compiler, published-row validation, and rendering:

- Normalize CRLF to LF once, or explicitly reject CRLF and test that rule.
- Toggle code state only on a line exactly ` ``` `.
- Recognize `Details` only while outside code.
- Reject new source files with an unmatched fence.
- For an already-published unmatched fence, render the whole body as plain text rather than crashing the entire questions response; alternatively preflight production rows before making the read validator stricter.

There are currently no fenced question files in the repository, which makes the migration easy, but production rows should still be preflighted.

**F4 — P1: Stage 5 promises links and examples that cannot work under this plan’s deployment rules**

Evidence: [plan lines 95–98](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md:95), [lines 115–129](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md:115).

The mockups page becomes visible only after deployment, but Stage 5 publishes a question pointing Greg to real examples there while the plan explicitly says “no deploy.” It also promises an image-model example while saying no image-model calls are possible before 1 November.

Concrete fix: land Stages 1–3, have the Overseer deploy them, verify the authenticated routes, and only then publish the mockup-comparison question. Either postpone the image-model comparison until it can exist or ask the question without claiming that example is present.

**F5 — P2: Name the operational `kind` consumers explicitly; some fail silently rather than at compile time**

Evidence: [plan lines 60–68](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md:60), [feedback-draft.ts:76](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/web/feedback-draft.ts:76), [prompt-feedback-sweep.md:5](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/scripts/overseer-tools/prompt-feedback-sweep.md:5), [feedback-reports.md:314](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/docs/project/feedback-reports.md:314), [feedback-shipped-emails.ts:140](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/scripts/feedback-shipped-emails.ts:140).

The trace is:

- Earlier labels and dialog records are compiler-enforced.
- Saved-draft decoding is a runtime closed list; missing `discussion` discards an admin’s draft on reload.
- The unattended sweep prompt and `feedback-reports.md` currently classify only bug/suggestion and define only four priority bands. That can silently process a discussion as an ordinary authorized suggestion—the opposite of “do not build on the first pass.”
- Sentry tagging, admin mail, `/admin/feedback`, and `feedback-unswept.ts` pass through or print the validated value; they do not have closed vocabularies.
- Shipped mail skips admin-owned reports before composing a letter, so your specific suspicion is not a shipping bug. Still keep an explicit `discussion` branch/test so the fallback cannot hide a future authorization regression.

Add tests for discussion draft round-tripping, the admin skip in shipped mail, and the sweep rule that a discussion always produces an *Awaiting Greg* question before building.

The route is the correct place for the admin restriction: the browser flag is cosmetic and the database CHECK cannot express “this value only for configured admin IDs.” Perform the check immediately after validating `kind`, before decoding diagnostics or screenshots. A fixed 400 matching invalid-kind responses is defensible.

**F6 — P2: Stage 4 is an investigation plus an undecided future design, not an implementation stage**

Evidence: [plan lines 103–124](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md:103).

“A deterministic check,” “a notice,” and rule changes are materially different solutions. “Whatever the evidence says” leaves the implementation unreviewed.

Concrete fix: make Stage 4 produce an investigation document only—missed cases, causes, and recommendation. Any tooling or rule change gets its own reviewed follow-up plan. That also keeps the mockup work independent from an Overseer audit.

### Smaller staging

The smallest valuable release is:

1. Stage 1: admin-only Discussion, including the sweep/no-build contract.
2. Stage 2: exact-line fenced monospace blocks with the unified parser.
3. Ship and verify those.
4. Build and deploy Stage 3 separately, then publish its comparison question.
5. Run the Overseer investigation as separate work.

That gets the immediately useful conversation loop without making it wait for filesystem packaging, nested admin routing, binary delivery, and an open-ended Overseer redesign.

I made no file changes. The shared worktree changed during review as Stage 1 implementation began; the findings above are against the plan and the underlying contracts.