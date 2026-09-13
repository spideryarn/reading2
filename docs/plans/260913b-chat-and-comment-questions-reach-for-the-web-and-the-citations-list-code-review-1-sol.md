stop: F12

## Findings

### F12 — P1, established: prompt text still cannot enforce claim provenance

The latest reminder eval proves the promised invariant is still false. In run 1’s scaling-hypothesis “since” answer, the model links one paper, then presents named 2023/2024 papers, quotations from Pichai and Marcus, and an industry pivot as facts without links or “unverified.” Another answer combines a web-derived gloss and an article block ID in the same sentence. See [the raw eval](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/evals/results/chat-web-reach-after-reminder-2026-09-13T04-18-44.json>).

`provenanceLine` is correctly placed below the cache breakpoint, and its wording helps, but another prompt instruction cannot make “cannot present” true. The model already had both the full rule and the reminder when these failures occurred.

The smallest enforceable mechanism is:

1. Build an evidence ledger during the turn: valid article block IDs, URLs returned by web tools, and titles returned by library tools.
2. Buffer the draft before displaying it and validate every factual sentence for an evidence reference or an explicit background/inference/unverified mark.
3. Reject mixed-provenance sentences.
4. To catch an outside fact falsely paired with a valid block ID, run a bounded semantic verification/repair pass against the cited blocks and tool evidence, then fail closed if it still fails.

A deterministic marker check alone catches missing marks but cannot establish that a cited block actually supports the sentence. Pre-display validation also means buffering the answer—or gating it sentence by sentence—so this needs an explicit decision against the current streaming requirement. I did not implement that wider mechanism.

### F13 — P1, established and fixed: unrelated 404s became “no citations list”

Mutation: make `loadCitations` throw a status-404 article error. The tool confidently said no list had been made.

I added a typed `CitationsListNotFound`; only that error receives the ordinary absence response. Other 404s are read failures. See [citations-list-not-found.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/store/citations-list-not-found.ts:8>) and [chat-tools.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/chat-tools.ts:1700>).

### F14 — P1, established and fixed: the first citation row defeated the character cap

Mutation: give the first work a `why` longer than twice `CITATIONS_CHARS`. It emitted 12,205 characters despite the 6,000-character cap.

Stored text fields and block IDs are now individually bounded, preserving the first row and its location without exceeding the overall budget. See [chat-tools.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/chat-tools.ts:1492>).

### F15 — P2, established and fixed: inconsistent locations were described falsely

Mutation: `citedInBody: true`, `citedAt: []`. The output said the work appeared only in the references.

It now says the work was cited in the text but its stored locations are missing, while retaining `firstCited`. See [chat-tools.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/chat-tools.ts:1466>).

### F16 — P2, established and fixed: empty capped lists lost their cap semantics

Mutation: an empty stored list with `capped: true`. The early return said the step “made and found none,” omitting that works were reportedly left out.

The response now says zero rows are stored, reports the cap, and forbids inferring that the article cites nothing.

### F17 — P2, established and fixed: outdated status disappeared on early returns

Mutation: an outdated empty list, or an outdated list with no query matches. Neither response announced that it came from an older step version.

Outdated and capped notices are now computed before every non-stale return and included consistently.

### F18 — P2, established and fixed: a whitespace source title rendered a blank link

Mutation: `{ title: "   ", url: "https://evidence.example/paper" }`. “From the web” appeared above an apparently empty source.

`WebSources` now trims titles and falls back to the host. See [ChatPanel.tsx](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/web/ChatPanel.tsx:1589>).

### F19 — P2, reasoned and fixed: the final reminder collapsed five origins into three

The candidate reminder named the article, web, and “anything elsewhere.” That erased the system prompt’s separate instructions for the reader’s library and model inference at the precise high-recency point meant to improve compliance.

The reminder now names all five origins without changing `helpSection` or the cached prefix. See [converse.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/converse.ts:1254>).

### F20 — P3, established, not edited: the 404 documentation is now too broad

[chat-tools.md](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/docs/project/chat-tools.md:213>) and the [plan](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md:138>) still say a status-404 means no list.

The accurate rule is: “Only the store’s `CitationsListNotFound` 404 means no list; another 404 means the list could not be read.” I did not edit these rule-bearing/concurrently modified docs without approval.

## Other review results

- The `helpSection` remains byte-for-byte unchanged.
- Help and ordinary turns retain an identical cached prefix.
- The existing search encouragement and plain-meaning counter-pressure remain intact.
- The repaired `chat-web-links-prompt` test anchors on the actual heading and still proves the entire shared `WEB_LINKS` section is identical.
- “From the web” remains conditional on at least one usable web source.
- Stale lists emit no rows; bibliography-only works retain their reference block.
- `article_citations` remains available in Chat, Remember, Candidates, and Live.
- `isSlug`, `read_web_page`, URL caps, and `fetchDocument` were untouched.

Verification:

- 141 focused Vitest assertions passed across eight relevant files.
- Full TypeScript coverage passed through `node --import tsx scripts/typecheck.ts`; the npm wrapper itself could not open its `/tmp/tsx-1000/14.pipe` socket in this sandbox.
- Biome reported no errors; only pre-existing complexity/optional-chain advisories.
- `git diff --check` passed.
- No commit was made.

Files I changed:

- [src/chat-tools.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/chat-tools.ts>)
- [src/converse.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/converse.ts>)
- [src/store/citations-list-not-found.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/store/citations-list-not-found.ts>)
- [src/store/pg.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/store/pg.ts>)
- [src/web/ChatPanel.tsx](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/src/web/ChatPanel.tsx>)
- [tests/chat-citations-tool.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/tests/chat-citations-tool.test.ts>)
- [tests/chat-provenance-line.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/tests/chat-provenance-line.test.ts>)
- [tests/chat-sources-from-the-web.test.tsx](</home/greg/code/spideryarn2/.claude/worktrees/fb3d-3f-chat-tools-web-and-citations/tests/chat-sources-from-the-web.test.tsx>)