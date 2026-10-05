**T1 — P1: `createdAt` does not establish that thorough follows the current quick answer.**

A revision preserves the quick row’s original timestamp: [searches.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/searches.ts:170), [pg-searches.ts:189](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/store/pg-searches.ts:189).

Concrete sequence: quick A → automatic thorough A starts → quick changes to B → quick changes back to A → leave Search before thorough finishes. The existing hook marks the first thorough A discarded permanently ([auto-thorough.ts:41](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/auto-thorough.ts:41)). After reload, the proposed rule accepts it: both done, same words, thorough created later. It therefore deletes an edited quick row and installs an answer the original session had explicitly discarded.

**Change:** retain evidence of actual automatic pairs and invalidate that evidence on revisions. Do not infer destructive replacements for unidentified historical pairs. Comparing defined, equal `sourceHash` values is also necessary to avoid replacing a revised quick answer with thorough results from another article version; opening-load `stale: false` provides no freshness evidence ([useSearch.ts:385](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/useSearch.ts:385)). Hash equality alone does not fix the A → B → A case.

**T2 — P1: an unticked thorough row does not establish the reader’s preference or its automatic origin.**

A reader can deliberately ask quick and meaning searches with identical words, then untick meaning because they prefer quick. Reopening Search would delete their chosen quick answer and activate the thorough answer they turned off.

The panel permits arbitrary ticking and solo selection ([SearchMode.tsx:726](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/SearchMode.tsx:726)); swap replaces the active quick ID regardless of that history ([SearchMode.tsx:182](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/SearchMode.tsx:182)). The two histories—automatic background answer and deliberately rejected manual answer—can produce identical loaded rows and `?runs=`.

**Change:** record automatic origin and subsequent reader choices, or leave ambiguous pairs untouched. An extra condition on the quick row’s *current* tick cannot distinguish these histories. This is a deterministic violation of the supplied constraint, independent of F8.

**T3 — P1: accepting F8 contradicts “never touch a row still running”; a cheap guard closes only part of it.**

Another tab’s owning typing session can revise a done quick row into pending in any status ([searches.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/searches.ts:154)). The current DELETE checks only article and ID ([pg-searches.ts:456](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/store/pg-searches.ts:456)). Consequently, a loaded `done` snapshot can delete a now-running revision. `sweepPending` protects its own sweep; it does not protect DELETE.

**Change:** extend the existing DELETE with optional atomic expectations for automatic cleanup: quick kind, done status, expected words, and a revision/completion token. The existing database `finished_at` could supply the latter; `createdAt` cannot. A refused deletion must be reported to the client, which must retain the quick row rather than calling today’s optimistic `remove` ([useSearch.ts:833](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/useSearch.ts:833)).

That needs neither a stored pairing link nor a replacement endpoint. It closes deletion of a changed/running source. **It does not fully close the “both rows lost” case:** the original tab can subsequently discard thorough. Closing that case requires coordinated cleanup of both rows, or retaining quick in storage. A second browser GET merely moves the race.

**T4 — P1: the opening list can be an offline copy, not a milliseconds-old snapshot.**

Search lists are cached ([api.ts:953](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/lib/api.ts:953)). A failed GET can return that saved body as HTTP 200 with `x-spideryarn-offline: copy` ([api.ts:710](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/lib/api.ts:710)). `openingRead` returns only the parsed body, losing that distinction.

Automatic PATCH/DELETE could therefore act on an old copy when connectivity recovers between requests. Even a live response’s window includes response delivery and DELETE delivery, not just effect execution.

**Change:** expose whether the opening read came from cache and skip destructive tidy for cached lists. Keep the atomic guard from T3 for live reads.

**T5 — P2: opening-load timing is workable, but its lifecycle contract needs to be explicit.**

The earlier placement of `useAutoThorough` is sound: `wiring.current` is filled during render, before its passive effects execute. Typing’s queued work drains later ([SearchMode.tsx:466](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/SearchMode.tsx:466)); bar handoffs consume in a microtask ([SearchMode.tsx:323](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/SearchMode.tsx:323)). A newly mounted typing session does not own an old loaded candidate, and `rowGone` only ends the matching session ([quick-session.ts:137](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/quick-session.ts:137)).

Ordinary last-view restoration runs in `ArticlePage`’s layout effect before the fetched reader mounts ([last-view.ts:569](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/last-view.ts:569)); I found no current late-restoration path requiring an arbitrary delay. Restoration *after* tidy would, however, restore deleted IDs incorrectly.

**Change:** specify one pass per successful opening snapshot, mark it consumed synchronously before side effects, and read current selection through the wiring. Preserve the ordering override outside `wiring.swap`, as the existing settlement does. Cover StrictMode, queued bar handoffs and delayed URL updates. `loaded` alone means success **or failure**; skip failures. The deadline already prevents a late GET from committing ([opening-read.ts:84](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/lib/opening-read.ts:84)).

The simplest safe browser-only alternative is to persist the existing actual pair records locally, invalidate them on edits or reader choices, and leave unrecorded pairs alone. There is no equally safe stateless destructive pairing rule over the currently exposed fields.

do not build