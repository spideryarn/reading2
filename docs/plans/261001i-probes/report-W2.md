# Report W2: architecture.md, comments.md, web-client.md, public-readable-sharing.md, module headers

## What changed, file by file

- `docs/project/architecture.md`
  - § Intent: "each writing JSON to disk" and "two stages of seven cache on a content hash" replaced
    by the store and a citation of `src/pipeline.ts` § `STEPS` (`stamp()`).
  - New § The docs: the 14 children from the `↳` list, one line each on when you would open it.
  - § Pipeline diagram kept, made true: arrows now name artefact kinds (`raw`, `extractedHtml` +
    `meta`, `blocks` + `stampedHtml`, `tree`, `labels`) instead of `data/<slug>/…` paths; box 5 marked
    as part of the hierarchy call rather than a step; a line for assets and the modes' steps. A
    paragraph under it cites `src/step-order.ts` § `STEP_ORDER`, `src/pipeline.ts` § `STEPS`
    (`produces`) and `src/store/artifacts.ts` § `ArtifactKind`.
  - § Stage ownership: a note that the Artefact column keeps pre-2026-09-05 file names, with the
    `ArtifactKind` citation. The "`src/extract.ts` does fetch + Readability … writing to `output/`"
    paragraph replaced (fetch.ts is stage 1, extract.ts writes neither artefact, commands are
    `scripts/stage.ts`).
  - § Server and client: "six job endpoints" uncounted; "p-queue, concurrency 1" replaced by the claim
    and `src/jobs.ts` § `DEFAULT_JOB_CONCURRENCY`; "two deliberate exceptions" for request-handler LLM
    calls corrected to "the first two of which were…", pointing at the callers of
    `openRouterStream`/`openRouterJson` for the current set.
  - New § Shared code (server) (`#shared-code-server`): 14 bullets cut from trawl A, each
    `file § symbol` + when to reach for it, naming the known second copies (labels `allOrStop`,
    pdf-read/embeddings sleeps, fetch.ts `retryAfterMs`, pdf-read `escapeHtml`).
  - § Conventions: "eleven of the fifteen in `STEP_ORDER`" and its list replaced by the
    `STEPS`/`stamp()` citation ("every step except the four in the next bullet"); "seven pipeline
    stages" uncounted; the `output/<slug>.blocks.json` claim about where ids live corrected (the
    `blocks` artefact in the database).
- `docs/project/comments.md` § streaming: names `src/stream-run.ts` § `runStream` (server) and
  `src/web/lib/sse.ts` § `readAnswerStream` (client) as where a new streamed answer starts; says the
  loops in `search.ts`, the referee runners and the hand `readEvents` hooks are older copies, with the
  real difference (structured items, search's strict JSON) acknowledged.
- `docs/project/web-client.md`
  - New § Shared code (client) (`#shared-code-client`): api, sse, the mode hooks, relative-time +
    useNow, Tooltip, IconButton/ui/Toast, ThresholdSlider + `applyThreshold`, DataTable, key-chord /
    keynav / useEscapeToClose, useSlow + `cmt-spinner`. Verified `CopyButton`: it is private to
    `src/web/Tweets.tsx` and seven other files write the clipboard themselves, so the list says there
    is no shared copy button rather than naming it.
  - Trawl B §4 item 11: "fourteen of them, `MODES_UI`" → "one button per row of `MODES_UI`"; "37
    files" uncounted; the "one `dangerouslySetInnerHTML`" claim corrected (four uses, all the
    article's sanitised html or a `/design` specimen; grep rather than count); the `Tweets.tsx`
    `reloadError` sentence put in the past tense, pointing at `useTweets.ts`.
  - Tailwind two-utilities trap added under § Tailwind and shadcn, sourced to 260908d § The bug this
    change nearly shipped (there is no postmortem for it; the plan is the write-up).
  - New § Three more ways client state goes wrong without saying so (`#client-state-traps`):
    issue-order freshness (260905e), `[]`-deps effect reading a ref (260831a), externally set flags
    with no clear (260915b), stated as facts.
  - Greg's origin-line quote restored in full as a blockquote below the "Where the code is" table
    (`#the-origin-line`), linked from the Masthead row.
- `docs/project/public-readable-sharing.md`: the same quote, after the "Briefed / actually true" table.
- Header comments (comment only): `src/stream-run.ts`, `src/web/lib/sse.ts`,
  `src/web/relative-time.ts`, `src/web/ThresholdSlider.tsx`, `src/concurrency.ts`,
  `src/web/Tooltip.tsx`, `src/messages-stream.ts`, `src/ai-call.ts` — one to three lines each with a
  bare `doc.md#anchor`. `src/html.ts` left alone: its header already says "in one place" and links
  security-map.md.

## Proposals (rule wording, not made)

1. `docs/project/architecture.md` § Stage ownership, first paragraph.
   - **Before:** "Stay in your stage; communicate through the JSON artefacts on disk, not by reaching
     into another stage's code."
   - **After:** "Stay in your stage; communicate through the artefacts it writes to the store, not by
     reaching into another stage's code."
   - **Reason:** the rule is unchanged, but "on disk" has been false since 2026-09-05; it is a rule
     sentence, so not edited.
2. `docs/project/architecture.md` § Conventions, "Anything expensive should be cached on a content
   hash, and not everything is." — left as is; only the count after it was replaced. No change
   proposed, noted so a reviewer can confirm the boundary.

## Found, left for someone else

- `src/ai-call.ts` header says "the three referee runs" (four now) and its "What the callers keep"
  section argues that folding the streamed callers together is "duplication that is not
  duplication" — that is in tension with `runStream` and the new comments.md wording. Worth a line
  from whoever owns ai-gateway.md, or a code-comment edit outside this sweep.
- `architecture.md` § Storage, the `source-hash.ts` fingerprint table (which stages use which head
  function) was not re-verified and probably omits `faq`, `simple`, `trajectory`, `debate`,
  `citations`, `crossrefs`. Better replaced by a citation of `src/source-hash.ts` than updated.
- `architecture.md` § Stage ownership row 6 links `granularity-zoom.md § The tabular view`, a view
  removed on 2026-09-29.
- `architecture.md` § Conventions still names `output/noema-mythology-of-conscious-ai.html` as the
  test article; probably stale since the filesystem store went.
- `web-client.md` line "15,951 lines over 38 files on 2026-09-06" is a dated measurement; left.
- AGENTS.md "twelve of the fifteen" (trawl B §5) is W1's.

## Checks

- `npx vitest run tests/doc-links.test.ts`: 16/16 passed.
- `npm run typecheck`: exit 0.
