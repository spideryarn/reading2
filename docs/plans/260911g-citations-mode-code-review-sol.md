### F11 — P0 · established — The paid POST has no admission control

[`POST /api/citations/.../find`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/routes.ts:7557) records expenditure but never limits it. An owner can repeat a no-match or failed request indefinitely; concurrent requests all pass the initial `search` check before any successful save changes the row. The repository already has an atomic, cross-instance limiter with per-owner concurrency/window limits and a global daily fuse, despite the route comment saying none exists: [`FetchAllowanceStore`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/store/contracts.ts:2117) and its [Postgres implementation](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/store/pg-rate-limit.ts:96).

(a) Reproduce: invoke `makeFindCitation` twelve times concurrently for the same valid `search` row with a provider response containing no annotations. My harness observed `{calls:12,saves:0}`; repeating serially remains unlimited because no-match stores nothing.

(b) Smallest fix: add a `citation-find` rate bucket and matching database CHECK value, define a policy with `concurrency`, hourly fills, per-owner daily fills, and `globalFills`, then `take()` after the owner/row checks but before `callOnce`; return 429/503 on refusal and always `finish()` the lease in `finally`.

### F12 — P1 · established — A review page passes as the work’s own page

[`pageNamesTitle`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/citations.ts:620) accepts any result whose title approximately names the work or whose excerpt contains its title. Those are normal properties of reviews, summaries, reading lists, and citation pages. [`readFind`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/citation-find.ts:227) therefore proves that the URL was returned by search, but not that it is the work’s own page.

(a) Reproduce with an annotation for `https://blog.example/review`, title `Scaling Laws for Neural Language Models — a review`, and excerpt `Our review of Scaling Laws for Neural Language Models explains the paper.` If the model selects that exact annotation URL, `readFind` returns `kind:"kept"`; I confirmed this in the harness.

(b) Smallest safe v1 fix: remove excerpt matching and only accept a normalized exact-title match on a mechanically recognizable work address—initially `doi.org/*` and `arxiv.org/{abs,pdf,html}/*`. Publisher and author-copy support needs additional verifiable metadata; title occurrence alone cannot establish it.

### F13 — P1 · established — The 80-row cap runs before deduplication

[`toDrafts`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/citations.ts:309) chooses the top 80 raw model rows before the two dedupe passes at [`buildCitations`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/citations.ts:979). Duplicate rows can consume the entire allowance and exclude distinct works. The resulting artifact is still marked capped, while [`CAPPED_NOTE`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/web/CitationsPanel.tsx:228) claims the displayed list contains 80 works.

(a) Reproduce with 80 high-relevance copies of `Repeated Work` followed by one lower-relevance `Distinct Work`, all validly anchored. My harness produced one row—`Repeated Work`—with `capped:true`; the distinct work was discarded and the UI would say these are “the 80”.

(b) Smallest fix: verify and perform both work/identifier dedupe passes before ranking and slicing to `MAX_CITATIONS`; count `overCap` from distinct works. Replace the copy with: “The model left some cited works out; this list keeps the ones it judged the piece leans on most.”

### F14 — P1 · established — A find is not fenced to the citation snapshot it searched

The POST reads a search row, performs the remote call, then [`save`s unconditionally](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/citation-find.ts:301). The store rechecks ownership but not that the current artifact still contains the same key as a `search` row ([`save`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/store/pg-citation-finds.ts:25)). Meanwhile, the client applies a late result to any current row with the same inherited id, regardless of its current `linkFrom` ([`useCitations`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/web/useCitations.ts:189)).

(a) Reproduce: start Find on a `search` row; while the provider is pending, regenerate Citations so the same work inherits its id but now has an article-derived DOI. When Find returns, it writes a now-inapplicable `citation_finds` row and the client overwrites the DOI with the web result until reload.

(b) Smallest correct fix: make `save` a conditional transaction accepting the expected citation `sourceHash`, work key, and id; insert only if the current revision still contains that exact row with `linkFrom:"search"`, otherwise return 409. Also change the client mapper condition to `w.id === id && w.linkFrom === "search"`.

### F15 — P2 · established — Link-producing HTML is absent from the freshness fingerprint

[`inputFingerprint`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/citations.ts:128) hashes block text but not HTML, although DOI/arXiv and article links are derived from HTML attributes. An href-only revision therefore leaves an obsolete link marked fresh; the source comment explicitly records this gap.

(a) Reproduce with identical block id/text/tree/metadata but change `<a href="https://old.example/paper">` to `https://new.example/paper`. My harness produced identical citation fingerprints, so `isStale` remains false and the old stored URL is served without a warning.

(b) Smallest fix: add a citation-specific hash component over each block’s normalized external URL attributes and include it in `sourceHash`; project block HTML for the corresponding Postgres freshness calculation.

### F16 — P2 · reasoned — `citation_finds.owner_id` is not tied to the article owner

The table independently references an article and an auth user, but has no constraint that they are the same owner ([schema](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/db/schema.ts:3428)). Both normal reads ([`loadCitations`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/store/pg.ts:3291)) and exports ([`readArticleRows`](/home/greg/code/spideryarn2/.claude/worktrees/citations-owed-review/src/store/article-rows.ts:704)) filter finds only by article id. Ownership transfer is not currently an application feature, so this is a latent rather than reachable v1 leak.

(a) Reproduce by creating a find while article A belongs to owner X, then updating `articles.owner_id` to owner Y. The independent foreign keys remain valid; Y’s GET attaches X’s find, and Y’s export includes the old row and owner id.

(b) Smallest invariant-level fix: add `UNIQUE (id, owner_id)` on `articles` and a composite FK from `citation_finds(article_id, owner_id)` to it. Any future ownership-transfer operation must then explicitly delete or transfer the finds in the same transaction.

Verdict: do not ship.