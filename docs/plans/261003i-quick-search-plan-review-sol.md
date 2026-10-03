The plan needs changes before B2 is built. Stage A can compare alternatives, but its current design cannot establish all the causes it claims to distinguish. No files changed.

References below use the candidate [plan](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/docs/plans/261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md).

1. **F1 — P1 — The trim can delete the fallback before thorough finishes.**  
   Plan lines 86–96 promise that the quick row survives until success. However, [pg-searches.ts:324](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/store/pg-searches.ts:324) trims completed rows when inserting a new run. With thirty saved searches and the source quick row oldest, starting thorough deletes that source immediately—even if thorough subsequently fails. Another search started during thorough can also trim it.

   **Change:** protect a validated replacement source from trimming while its meaning replacement is pending. Test both the initial insertion and another concurrent `begin`.

2. **F2 — P1 — The replacement checks permit deleting a quick attempt another tab is awaiting.**  
   Plan lines 95–96 check owner, article, kind and criterion, but omit status. Quick revisions can reset a row in any status and start a new attempt ([searches.ts:166](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/searches.ts:166)). Another tab can revise the source away and back to the original criterion; thorough’s finish can then delete that pending quick row. Its stream ends without `done` and the client reports a failed connection.

   **Change:** revalidate the source at deletion time and require it still be completed. Put completion and deletion inside a store transaction using the article lock. Delete only after the meaning run’s fenced update actually succeeds: [pg-searches.ts:428](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/store/pg-searches.ts:428) can legitimately update zero rows. Return the ID actually deleted, rather than echoing the requested ID. Test changed criteria, a pending source and a superseded meaning attempt.

3. **F3 — P1 — Replacement is forgotten on retry.**  
   Plan line 91 puts `replaces` on the POST, but specifies no durable association. [useSearch.ts:779](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/web/useSearch.ts:779) retries using only the failed row’s ID, criterion and kind. After thorough fails, retrying successfully therefore leaves the quick row behind. Reloading loses any association held only in client memory.

   **Change:** specify how the replacement relationship survives failure, reload and retry. A durable, nullable source ID on the meaning run is a straightforward option; account for that additional scope explicitly. Test failure → reload → retry → successful replacement.

4. **F4 — P2 — Three identical runs cannot diagnose a chunk-boundary cause.**  
   Plan lines 52–55 claim that score and rank distinguish a boundary problem. They distinguish floor and cap failures, but cannot establish why Jev scored a passage poorly. Production exposes only each chunk’s passages to its questions ([quick-search.ts:270](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/quick-search.ts:270)). Repeating the same boundary supplies no counterfactual.

   **Change:** first inspect the report URL and saved runs, including the client confidence filter ([SearchMode.tsx:562](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/web/modes/search/SearchMode.tsx:562)). Record eligibility, chunk membership, uncapped score/rank and capped inclusion. For the failing query, add a shifted-boundary or restored-neighbour-context control, plus paired queries such as “Buddhism”, “Buddhist” and “no self”. These distinguish vocabulary sensitivity from missing context without expanding the whole eval.

5. **F5 — P2 — “Recall against meaning search” needs a fixed, qualified yardstick.**  
   Plan lines 56–66 leave “meaning search’s hits plus a hand reading” undefined. The previous spike explicitly found that many apparent non-reference hits were valid, including Jev’s top eight answers on one query ([261002o:167](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/docs/investigations/261002o-quick-search-spike.md:167)). Sonnet overlap can consequently reward imitation rather than relevance.

   **Change:** predeclare target block IDs for the new passing-mention queries. Judge pooled results from every arm consistently, preferably without arm labels, and report precision separately from reference overlap. Restrict the reference denominator to quick-eligible blocks, as the existing [floor runner:77](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/evals/results/quick-search-spike-2026-10-02/floor.ts.txt:77) does. Call incomplete-reference measurements “reference recall”, not overall recall.

6. **F6 — P2 — The proposed set cannot test a relative floor’s most dangerous failure.**  
   Plan lines 57–63 select queries with known passing mentions. A floor defined only relative to the highest score admits at least the highest-scoring passage even when the article contains nothing relevant. The eval could improve positive-query recall while making absent-topic searches consistently wrong.

   **Change:** include a few absent-topic and hard-negative queries. Measure false positives, target retrieval and precision **after the production cap of twenty**. Reserve some new queries for confirmation after choosing wording/floor; otherwise the reported improvement is measured on the examples used to tune it. Sweep floors offline from saved scores.

7. **F7 — P2 — The LLM comparison needs an equal output contract and usable-hit timing.**  
   Plan lines 64–66 do not specify whether LLM candidates receive the same eligible blocks, return at most twenty unique valid IDs, or are repeated like Jev. “First id” can also mean an incomplete streamed JSON fragment rather than a result the application can use. Jev yields hits only after all chunks finish ([quick-search.ts:31](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/quick-search.ts:31)).

   **Change:** fix eligibility, cap, ID validation and repeats across arms. Measure first **validated usable hit**, complete-answer latency, failures and total cost; report ordinary and long articles separately. Keep this small: reproduce first, then test one or two wording changes before spending on several LLM candidates.

8. **F8 — P2 — B4 needs explicit provenance and an independent open-ring treatment.**  
   Plan lines 112–120 describe the desired behaviour correctly, but quick’s identity currently stops at preview selection ([search-hits.ts:1064](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/web/search-hits.ts:1064)). `Found.whole` denotes failed quote placement, not quick search. Also, the current ring requires `data-wash` ([annotations.css:766](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/web/styles/annotations.css:766)); removing the wash removes that ring.

   **Change:** carry an explicit rendering flag from quick runs through `Found` and `Mark`. Exclude quick contributions from wash strength and stripes, while retaining their `data-hit` identity: scrolling and flashing find those wrappers ([rows.ts:111](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/web/rows.ts:111)). Give an opened quick hit an outline without restoring its wash. Test overlaps with meaning hits, Quotes, comments and terms, plus a meaning quote-placement fallback.

Two suspicions do **not** look like blockers. The initiating tab already calls `typing.rowGone` ([SearchMode.tsx:167](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/web/modes/search/SearchMode.tsx:167)); an absent-ID `revises` deliberately mints a fresh ID rather than resurrecting the deleted one ([searches.ts:253](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/searches.ts:253)). Colour inheritance can use the browser’s resolved slot and the existing `colour` field—copying only the source’s optional stored colour would miss automatic colours. B3’s decorative swatch is reasonable; place it inside the words’ button and preserve the checkbox’s separate hit area.

**Verdict: not ready to build; F1–F3 block B2, and Stage A needs explicit causal controls and measurement rules before its results justify shipping a new wording or floor.**