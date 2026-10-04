# Four small queued fixes: fetch-failure sentences, composer focus, a stale `remember=`, Marginalia's head at the top

Four independent items from the Overseer's queue, dispatched 2026-10-04 under Greg's standing rule
of that day (*"if you see bugs, fix them without asking me"*) and his line on the queue (*"If you're
confident, address all of the Q-queue-yeses"*). One commit per item, each defect seen red first.
Base: `fb8a529bc` on `dev`.

Up: [plans.md](../project/plans.md).

## A. `qi-vz4k2e6w` — every fetch failure gets its own reader sentence, and Retry only where it can help

**Today.** `FetchFailure` (src/fetch.ts) carries a `code` (seventeen of them) but declares no
`readerFailure`, so `readerFailureOf` (src/job-failure.ts) gives the job card the generic sentence
for the step and a Retry. `too-large` was given its own sentence on 2026-10-04
(`overTheSizeLimit` in src/pipeline.ts, `FETCH_TOO_BIG` in src/messages.ts). The other sixteen
still take the generic one, so a 404 is offered a Retry that cannot work.

**The change.** In src/messages.ts, one total map from `FetchFailureCode` to a
`ReaderFacingFailure`, each with a code of its own (`[fetch-…]`, registered in `CODE_KINDS` beside
`fetch-big`). In src/pipeline.ts, `overTheSizeLimit` becomes a function over every code, used at
the same one `.catch` in the fetch step. A `Record<FetchFailureCode, …>` with no default arm, so
an eighteenth code is a red compile. Nothing outside the pipeline's fetch step changes: link
previews, figures, and the bibliographic lookups classify a `FetchFailure` their own way and never
show it on a job card.

The kinds, which decide Retry (`canRetry`: only `retry` offers it):

| code | kind | why |
|---|---|---|
| `invalid-url`, `unsupported-scheme`, `blocked-address` | `blocked` | the address itself is the problem; the same address fails the same way |
| `unauthorized`, `forbidden`, `not-found` | `blocked` | the site has answered, and will answer the same again |
| `too-many-redirects`, `unsupported-type`, `certificate` | `blocked` | a property of the site, not of the moment |
| `too-large` | `blocked` | unchanged (`FETCH_TOO_BIG`) |
| `timeout`, `connection`, `rate-limited`, `server-error` | `retry` | a later go can come out differently |
| `dns` | `retry` | usually a mistyped address, but a resolver blip looks identical and Retry is cheap |
| `empty` | `retry` | an empty body is more often a site hiccup than a fact about the page |
| `http-error` | `retry` | the catch-all: an unclassified status or a truncated body; we do not know it is permanent |

Each sentence says what happened and the reader's next step in plain words, with the code last and
bracketed (docs/project/copy.md). Where retrying cannot help, the next step is the one that can:
check the address, or save the page as a PDF and upload the file. No sentence carries the address
or the host (a stored failure message is not a place for a reading history; docs/project/logging.md).
The diagnostic stays the `FetchFailure`'s own message and code, with no address.

**Simpler option passed over:** read `FetchFailure.retryable` instead of a table. It answers a
different question (should *this process* try again in the next second), and it gives no sentence.

**Docs:** copy.md gains the `fetch-` prefix and the list of codes; ingest-queue.md and fetching.md
have their "only too-large" sentences made true.

**Red first:** a test that runs the fetch step's failure path for `not-found` and expects kind
`blocked` and a `[fetch-…]` code, and a table test that every `FetchFailureCode` has a sentence
whose code `kindOfMessage` reads back as the same kind.

## B. `qi-7dvah74y` — switching conversation while typing keeps the composer's focus

**Today.** src/web/ChatDialog.tsx refocuses the composer only on the draft→thread swap
(`swapping`, `caretWasInside`). Thread→thread, with the caret in the composer, drops focus to
`<body>`, in the floating panel and in the Marginalia card alike. The subagent first confirms that
in a test (which switch, and why the textarea loses focus: a remount on the thread's key, most
likely).

**The change.** One rule replaces the special case: *if the caret was in the composer when the
conversation changed, it is in the composer afterwards.* Nothing takes focus that did not have it,
so opening a conversation from the article still does not steal the caret (ChatPanel.tsx §
`focusNonce`, Greg 2026-08-26).

**Red first:** a rendered test, thread A open with the caret in the box, switch to thread B, expect
`document.activeElement` to be B's textarea. And one for the opposite: caret elsewhere, switch,
composer not focused.

## C. `qi-e99pjdz2` — `remember=quiz` beside `mode=chat`: kept, on purpose, and now said so

**Finding.** It is not peculiar to Remember or to Chat. Every sub-mode parameter (`remember`,
`diagram`, `referee`, `summary`, `structure`, `debate`) stays in the address when the reader leaves
its mode, because the Dock writes `mode` alone (Reader.tsx § `onMode`, `setMode(next)`). That is
what makes pressing Remember again return to Quiz, and Diagram to the picture last chosen, within
one visit. url-state.md already states the same intent for a *remembered* view (*"Their subordinate
parameters are still remembered, so pressing Diagram or Remember later returns the reader to the
picture or the half they had chosen"*), but never says it of the live address, which is why it
read as a leak.

**Recommendation: keep it, and write the rule down.** Dropping the parameter on leaving would make
Remember reopen on Recall, which starts a conversation, where today it reopens on the Quiz the
reader chose. That is a change to what a reader gets that nobody asked for. The queue item allows
either ending (*"or say why it is kept"*).

**The change.** A paragraph in url-state.md under the parameter table: a sub-mode parameter
outlives its mode, deliberately; which mode reads it; and that it is inert under any other mode.
A test that pins it (Remember → Quiz → Chat keeps `remember=quiz`; back to Remember opens Quiz),
so the next agent who sees it finds a decision rather than an omission. No code change.

**The alternative, not built:** clear every sub-mode parameter when `mode` changes. Tidy address,
loses the return-to-where-I-was behaviour, and needs every writer of `mode` (there are about ten in
Reader.tsx) to go through one setter.

## D. `qi-2ymfq3ek` — Marginalia's head names the first part at the very top

**Today.** Reader.tsx § `marginColumn` passes `at ?? article.blocks[0]?.id` to `headPath` and
`arcAt`. Where that block sits above the first part (a title block, a byline, an abstract the tree
does not cover) both are empty, `MarginaliaHead` draws nothing, and since 261004k the breadcrumb
is hidden too. So for those rows nothing says where the reader is.

**The change.** One pure function in src/web/marginalia/notes.ts, `headBlock(tree, index,
blockId)`: the block the head speaks for. A block **above the first part** (or no block at all)
answers with the first part's first block; every other block answers with itself. The caller
passes its result to both `headPath` and `arcAt`, so the path and the arc cannot disagree. The
head then reads the same from the top of the article down through the first part, and does not
appear as the reader scrolls past the first heading.

**Not changed:** a gap in the middle or at the end of the tree still draws no head. There is no
"first part" to borrow there without claiming the reader is somewhere they are not.

**Red first:** in tests/marginalia-notes.test.ts, `headBlock` for a block before the first part,
for `null`, for a covered block and for a block in a later gap; and in the rendered test from
261004k (tests/headings-crumbs-wiring.test.tsx), `?margin=1` at the top of the fixture whose first
block lies outside its first part now draws `.marg-head` with the first part's title.

## Stages

One stage, four commits. A, B and D are built by three Opus subagents in parallel (their files do
not overlap: pipeline/messages; ChatDialog/ChatPanel; notes.ts and one call in Reader.tsx). C is
docs and a test. Then one GPT Sol code review over all four, write-capable, its fixes read and
committed separately. Then a Sonnet browser check at desktop, iPad and phone widths for B, D and
the job card of A.

## Done

`npm test`, `npm run typecheck`, lint on touched files; each new test seen red; pushed to `dev`.

## GPT Sol's plan review, and what changed

The review is [261004l-four-small-queued-fixes-plan-review-sol.md](261004l-four-small-queued-fixes-plan-review-sol.md).
Verdict: request changes, on two established P1s. All six findings are accepted; the sections above
are read with these amendments.

- **F1 (P1, A).** `http-error` is not one kind. `classifyStatus` sends 400, 405, 413, 451 and the
  rest of the unnamed 4xx there, and a truncated 206 too. So the `http-error` entry reads the
  retained status: a 4xx (other than 408 and 425, which are about the moment) is `blocked`, and
  everything else, a missing status included, is `retry`. Each of the two has its own registered
  code. Red first for a 413 beside the 404, and a retryable case kept for the partial body.
- **F2 (P1, C).** Keeping the parameter leaves one real defect: with `remember=quiz` retained and a
  Chat conversation open, pressing Remember writes `mode` alone, so Remember mounts on Quiz with
  the Chat thread still selected, and `RememberBand` clears it an effect later. params.ts §
  `rememberParam` rule 1 says Quiz and a cleared `thread` are one navigation. So: any navigation
  that opens Remember while `remember=quiz` is retained writes `mode=remember` and `thread=null`
  together, in the reading view's mode button and in the metadata page's Remember link, through
  `subModeParams`. This one is a genuine red-first test (the write, not the state after the repair
  effect).
- **F3 (P2, A).** The diagnostic is built from fixed wording, the code, and the numeric status. It
  does not copy `url`, `message` or the cause's message, several of which carry the address or the
  host. A test with a sentinel address checks neither the reader's sentence nor the diagnostic
  holds it.
- **F4 (P2, B).** Focus is kept only when the outgoing composer's **textarea itself** held it, not
  anything inside the dialog. Negative tests: an article control, Close and the footer controls,
  and the question editor. Both the floating panel and the card; in the card, restoring focus must
  not scroll the article (`preventScroll`).
- **F5 (P2).** Red-first applies to the bug assertions. A test that pins an existing decision (C's
  retention) may pass from the start. D's defect is reproduced in the rendered Reader test before
  the helper exists.
- **F6 (P3, A).** `dns`: Retry is offered for a missing name and a resolver blip alike as a
  deliberately conservative policy, though the fetcher tells them apart for its own automatic
  retries. `empty`: retry because we do not know, not because it is "more often" a hiccup.
- **D, from the closing notes.** An unknown block id, a missing tree and a later gap do not fall
  back to the first part.
