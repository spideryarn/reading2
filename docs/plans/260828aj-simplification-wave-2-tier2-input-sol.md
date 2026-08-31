## 2.2 — Build a narrowed version

Build `articleSystem(...)` in [article-prompt.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-prompt.ts:98). Do not build `stage-call.ts` or the broad `stageCall(...)`.

The duplication is real, but the plan braids three different clone sets together:

- Seven stages use `streamMessage` and repeat parts of the response tail.
- Exactly four repeat the important article invariant: arc, tweets, glossary and ideas. The article is first; the stage instructions are second; only the first block conditionally gets `cache_control`.
- Three of those use `articleText`; ideas uses `articleWithIds`. ToC puts its article in the user message, labels caches a batch prefix, and summaries embeds selected article text inside its repairable batch prompt. Those are not variants of the same request.

`ARTICLE_RENDERER` is unenforced. Outside tests and comments, it is only read by [pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:146) to predict cache sharing. Nothing connects [the table](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:815) to the actual call in [ideas.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:890). The existing test merely proves every table row exists.

A source-level test would be cheaper, but weaker: it must inspect syntax or mock four large generators. A pure helper makes the table executable. It should select the renderer, put the article first, and apply the optional breakpoint. The stage-specific request and response handling should stay local.

Test four hard-coded outcomes—ideas has ids, the other three do not—plus ordering and cache-on/cache-off. Because this is not a current output bug, do not manufacture a meaningless red by testing a missing export. Characterise the current behaviour, then prove the test goes red under three deliberate mutations: wrong renderer, reversed blocks, and dropped/always-on cache marker.

I would change this answer only if `articleSystem` itself needed stage-specific options beyond stage, article, instructions and cache flag. Then leave the copies and add the enforcement test. I would permit a broader `stageCall` only if ToC, labels and summaries first converge on one real response contract without truncation callbacks or repair-policy parameters.

Sequencing: the narrow migration still edits dirty `arc.ts`, `glossary.ts` and `ideas.ts`; wait for their owners. It avoids the dirty `summarise.ts` and `toc.ts` entirely.

## 2.3 — Build a narrowed version, in two steps

Extract citation collection independently now. After 0.4 lands, build `roundClock` plus a pure end classifier. Do not build callback-driven `endOfStream`.

0.4 is a genuine precondition, not an excuse. Unit tests for an end classifier cannot prove that:

- search’s real composite signal is wired to both clocks;
- a cancelled `ReadableStream` can end cleanly rather than throw;
- activity restarts the stall timer;
- `finish_reason` and `[DONE]` reach the classifier correctly;
- non-2xx responses retain their safe `ProviderRefused` handling.

The non-2xx tests are wholly outside end-of-stream classification. The deadline, stall and EOF tests exercise integration that a classifier test cannot.

The split is sound:

- `roundClock(signal, deadline, stallMs)` can return the composite signal, stall signal, `touch()` and cleanup. The deadline must remain caller-owned. Converse must create a fresh round clock only when a model round starts; its stall timer must not run while a tool runs.
- A pure `classifyStreamEnd(...)` can consume `stopped`, the three signals, `StreamEnd`, and `finishReason`. It should return a state such as reader-stop, clock-abort, premature-EOF or complete.
- Each caller must continue deciding what to log, throw, retain or store. That preserves the three different stop-button promises.

These two helpers are separable: the classifier needs signals, not the object that created them.

The citation block in explain and converse is exactly identical after indentation—11 lines. The detector reports the enclosing 24-line, 177-token loop as a largest-token clone, but it is tied, and other clones are longer by line count. So “largest clone” is overstated. It is nevertheless independently safe to extract because both callers currently make the same decisions: dedupe by URL, reject non-web URLs, preserve an optional title, and warn without logging the URL. Put it beside the annotation wire shape in [openrouter-stream.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/openrouter-stream.ts:332), with a narrow dropped-citation callback or result—not a logger dependency.

This remains on the safe side of the rejected `converseOrExplain()`: prompt construction, chunk consumption, tool calls, partial-result policy, empty-answer handling and storage remain in the verbs.

I would change this answer to “leave it” if the end helper starts accepting logging/effect callbacks or knowing what chat, explain or search stores. I would also stop before the clock extraction if the 0.4 mutation controls cannot detect broken deadline, stall and EOF wiring.

At this snapshot, `tests/search-stream.test.ts` already has uncommitted preparation moving its hanging-stream helpers, but no new 0.4 cases. Let that work settle first.

## 2.6 — Build a narrowed concurrency primitive after 2.1

Fix the race, but do not build the broad `useArtefactRead` yet. Extract only the mechanism already proven in `useGlossaryRead`: generations, one in-flight read, and distinct `reload()` versus `refresh()` semantics. Keep parsing, 404 handling, state shapes and error presentation inside each domain hook.

The race is reachable:

1. A reader opens Ideas, Summary or Tweets while that article’s job is already running—started earlier, in another tab, or through the CLI.
2. The component’s opening GET starts and reads the old artefact.
3. The job completes; a later `useJobs` poll calls `onFinished`.
4. The completion GET reads the new artefact and returns first.
5. The older opening GET returns last and permanently overwrites it.

Generation alone fixes concurrent replies. Dedupe alone recreates the glossary’s old bug by making `onFinished` join the pre-job request. The fix needs the two semantic verbs and a trailing read, as documented in [useGlossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:96). This is not honestly “three small guards.”

The state-consolidation argument is weaker. [useSummaries’ 404 branch](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSummaries.ts:93) really does forget `profiled` and `profileChanged`, but that can be fixed with two setters or a local discriminated union. Tweets already has a union; glossary has legitimate partial mutations. This does not justify making four response state machines generic.

The race test should extend [background-reload-keeps-the-list.test.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/background-reload-keeps-the-list.test.tsx:283):

1. Mount with the opening reply held; its body snapshots the old artefact.
2. Change the server fixture to the new artefact.
3. Fire `finishJob` before settling the opening read.
4. Settle held replies newest-first, then settle again for a trailing read.
5. Assert the new value remains visible and exactly two GETs occurred.

Against current code, the second request returns new, the first returns old last, and the final visible-value assertion goes red. The failure must name that stale value, not merely a request count. Run the same control for ideas, summaries and tweets; also retain wrong-slug and slug-switch cases.

Let 2.1 land and pass its review first, then do 2.6 immediately as a separate commit—no soak period is needed. Combining them makes the red race control and any regression harder to attribute. `Tweets.tsx` is also dirty now, so 2.6 should not start there yet.

I would broaden this into `useArtefactRead` only after the shared concurrency mechanism has landed and the domain states can be expressed without a parsing/404/error/mutation parameter bag. If that narrow mechanism itself becomes harder to read than the local code, use guarded local implementations—but the race still needs fixing.