## Findings

**F1 — P0 — A request authorized before the transfer can write A’s private data into B’s article afterward.**

Evidence:

- [`articleIdForOwned` checks ownership without locking](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg.ts:374).
- Comments resolve the ID and later insert using it: [`pg-comments.ts:222`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-comments.ts:222).
- Quiz attempts and reading time have the same shape: [`pg-quiz-attempts.ts:32`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-quiz-attempts.ts:32), [`pg-reading-time.ts:40`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-reading-time.ts:40).
- Even stores calling `lockArticleRow` are unsafe if the transfer wins first: that lock is by ID only and does not recheck owner: [`pg.ts:409`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg.ts:409).
- The database does not enforce child-owner/article-owner agreement: [`admin.md:494`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/project/admin.md:494).

The failing interleaving is: A resolves the article ID; transfer deletes A’s state and commits owner B; A then inserts a comment or attempt against the still-valid article ID. B inherits it.

Change the plan: make “fence every article mutation” a prerequisite stage. Every owner-scoped write must take the article row lock and recheck `(article_id, owner_id)` in the same transaction before its child write. Add deterministic held-transaction tests that pause after the initial lookup, transfer, resume, and require the stale write to fail. There are 71 `articleIdForOwned(slug…)` call sites, so this needs an explicit write inventory. The current “no migration” conclusion is premature; an owner-coupled FK for reader-state rows would be the stronger database backstop, though an exhaustive transactional refactor could avoid it.

---

**F2 — P0 — Preserving visibility and the share token exposes B’s future notes and searches to A’s old audience.**

Evidence:

- The plan deliberately carries visibility and the private key: [`plan:66-69`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:66).
- The token is bearer authority: [`schema.ts:309-328`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:309).
- Shared reads include comments and saved searches: [`article/access.ts:103-116`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/web/article/access.ts:103), [`public-reader.ts:739-759`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/public-reader.ts:739), [`public-reader.ts:1091`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/public-reader.ts:1091).
- The sharing documentation explicitly says marks, notes and searches travel: [`public-readable-sharing.md:83-90`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/project/public-readable-sharing.md:83).

Change the plan: every transfer should atomically set `visibility = 'private'`, `public_at = null`, `share_token = null`, and `share_token_at = null`. The recipient’s initial link has already loaded; after the transfer, owner-first access succeeds even if the stale key remains in the URL. Preserving sharing should be a separate, explicit admin choice, never the default.

This also makes the “no other non-revoked voucher” guard insufficient: revoked voucher emails, independently shared links, and former public readers may still hold working access.

---

**F3 — P0 — Existing vouchers did not record an intention to transfer ownership, yet the plan retroactively transfers all of them and may delete data.**

Evidence:

- Existing schema defines a starter only as an article linked from the gift email: [`schema.ts:7004-7021`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:7004), [`billing.md:1088-1095`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/project/billing.md:1088).
- There is no transfer-intent column.
- The plan applies transfer to every starter voucher: [`plan:99-107`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:99).
- It deletes the creator’s words automatically: [`plan:73-78`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:73), contrary to the project’s “Never lose what the reader gave us” principle: [`vision.md:121-125`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/project/vision.md:121).

Change the plan: if automatic voucher transfer remains, an additive migration is clearly necessary: `billing_vouchers_transfer_starter_ownership`, adding a `starter_transfers_ownership boolean not null default false`. Existing vouchers remain false; new vouchers set it only after the new warning/choice.

For the simplest safe first version, automatic transfer should proceed only when the deletion preview is empty. Otherwise claim the voucher, preserve link reading, and show `/admin/articles` as requiring an explicit confirmed transfer. The admin path can knowingly delete after showing exact counts.

---

**F4 — P0 — The transfer leaks `asked_url`, which is A’s input and may contain a credential.**

Evidence:

- `asked_url` is explicitly the owner’s pasted string, can contain a query token, is withheld from shared reads, and is included in the owner export: [`schema.ts:383-405`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:383).
- The plan’s row-reset list omits it: [`plan:70-72`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:70).

Change the plan: clear `asked_url` during transfer. Also clear `updated_at`, which records the former owner’s settings activity.

---

**F5 — P1 — Leaving `ingest_events` linked makes billing depend on the new owner and breaks High-powered AI charging.**

Evidence:

- A’s usage selects A’s ledger rows but prices them using the linked article’s current visibility: [`pg-billing.ts:500-512`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-billing.ts:500), [`pg-billing.ts:520-528`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-billing.ts:520). B can therefore raise or lower A’s usage by changing visibility.
- High-powered state means the charge has been paid: [`models.ts:357-369`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/models.ts:357).
- The “already charged” lookup is by article ID, not owner: [`pg-billing.ts:1490-1510`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-billing.ts:1490).
- The unique charge is likewise per article forever while linked: [`schema.ts:7655-7664`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:7655).

Under the plan, B inherits High-powered AI paid from A’s allowance. Clearing only `high_power_since` would still let B switch it on without a B charge.

Change the plan: lock A’s billing account before the article, freeze every old ledger row at the pre-transfer visibility and unlink its `article_id` in one update, then clear `high_power_since`. The existing constraints and unlink trigger establish the required stamped-and-unlinked shape: [`20260907200800_ingest_events_unlink_atomically.sql:57-66`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/drizzle/20260907200800_ingest_events_unlink_atomically.sql:57). B can then pay for High-powered AI normally.

---

**F6 — P1 — The proposed reading-view trigger misses public starter articles and adds an unnecessary route.**

Evidence:

- Public starters are emailed without a key: [`voucher-starter.ts:105-119`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/voucher-starter.ts:105).
- The plan triggers only when access is through a private link: [`plan:109-114`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:109).
- The existing `GET /api/billing/usage` already performs claims: [`routes.ts:13535-13564`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/routes.ts:13535).

Change the plan: when a signed-in reader resolves as any visitor—public or private-link—call the existing billing-usage endpoint once, then re-resolve the article unconditionally. That covers public starters, another tab having claimed first, and the “already signed in” case without a new claim route.

Place the effect outside `article/access.ts`; that file is part of the sanitization defence: [`security-map.md:102-105`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/project/security-map.md:102).

---

**F7 — P1 — Voucher creation can race a transfer and bind A’s new voucher to B’s article.**

Evidence:

- Starter ownership is resolved before the transaction: [`pg-vouchers.ts:503-519`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-vouchers.ts:503).
- The resolver explicitly performs unlocked reads: [`voucher-starter.ts:68-88`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/voucher-starter.ts:68).
- The later insert uses the stale article ID: [`pg-vouchers.ts:526-540`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-vouchers.ts:526).

An FK wait does not help: after transfer commits, the article still exists, so the voucher insert succeeds.

Change the plan: establish one lock protocol for creating, restoring, changing and claiming starter vouchers. Starter-binding writes must lock the article and recheck creator ownership in their transaction; transfer must re-read the complete voucher set after acquiring the article lock. Add held-transaction tests for create-vs-transfer and restore-vs-transfer.

---

**F8 — P1 — The classification rule cannot prove that every article-owned row was classified, and the proposed split omits reader state.**

Evidence:

- Several article-scoped tables have `article_id` but no direct FK to `articles`: `revision_blocks` [`schema.ts:1607`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:1607), `revision_phrase_runs` [`schema.ts:1816-1844`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:1816), `chat_messages` [`schema.ts:4676`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:4676), and `reading_time` [`schema.ts:5553-5568`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:5553).
- Jobs/imports have logical owner-and-slug relationships rather than article FKs.
- Omitted reader state includes tags [`schema.ts:603-626`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:603), glossary lookups—including reader-added terms—[`schema.ts:5053-5109`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:5053), citation finds [`schema.ts:5137-5160`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:5137), and citation investigations [`schema.ts:5254-5279`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:5254).

Change the plan: classify every table containing `article_id` or `starter_article_id`, traverse the FK graph for indirect children, and maintain a separate explicit allowlist for logical owner/slug links. Explicitly put `article_tags`, `glossary_lookups`, `citation_finds`, `citation_investigations`, and `sources_claim_checks` in “delete reader state.” Seed every reader-state table in the transfer test and assert none of A’s content is reachable by B.

---

**F9 — P1 — `/admin/articles` cannot identify every existing article by short ID.**

Evidence:

- `short_id` is nullable and deliberately was not backfilled; every article before 2026-08-31 lacks one: [`schema.ts:190-205`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/db/schema.ts:190).
- The plan claims it is in every address: [`plan:130-136`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:130).

Change the plan: support pasting a full reading URL and resolve the slug server-side without listing it, or show a separate opaque admin identifier for legacy rows. Also acknowledge that listing one row per article changes the current admin privacy policy: hiding the title does not preserve the rule that which articles a reader has stays in their session.

---

**F10 — P1 — The plan contradicts the “no defence file may be edited” constraint.**

Evidence:

- D4 adds three API routes and D3 adds a claim route: [`plan:109-140`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:109).
- `src/routes.ts` is explicitly a defence: [`security-map.md:106`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/project/security-map.md:106).
- The plan nevertheless says no defence is edited: [`plan:150-155`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:150).

The existing billing route removes the need for the claim route, but `/admin/articles` still needs server routing. Change the plan to state that D4 is blocked by this constraint, or obtain an explicit exception for adding route-table entries without changing the gate.

---

**F11 — P2 — Auth Admin API validation must not run inside the locked transfer transaction.**

Evidence:

- The plan places target validation inside `transferArticle(tx)` under the article lock: [`plan:57-63`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:57).
- Existing voucher claim deliberately performs Auth lookup before its transaction because it is a network call: [`pg-vouchers.ts:125-130`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-vouchers.ts:125), [`pg-vouchers.ts:165-176`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-vouchers.ts:165).

Change the plan: validate the target before opening the transaction. The transactional function should accept the validated target ID and rely on database constraints plus its owner recheck.

---

**F12 — P2 — D1 is already in the current HEAD, so the plan’s status and ground are stale.**

Evidence:

- `authorGiftPath` already emits `?gift=<id>`: [`admin-author-gifts.ts:149-159`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/admin-author-gifts.ts:149).
- MCP already returns the gift URL: [`mcp/tools.ts:813-826`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/mcp/tools.ts:813), [`mcp/tools.ts:874-897`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/mcp/tools.ts:874).
- The plan still says “planned, not built” and describes the old response: [`plan:3`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:3), [`plan:42`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md:42).

Change the plan: mark D1 complete and remove it from the remaining build stages.

## What looks sound

- A recipient cannot freely choose an article: the claim is tied to a voucher addressed to their Auth-confirmed email.
- Article-row locking plus `owner_id = from` recheck is sufficient for concurrent transfer-vs-transfer.
- The `processing = 'minimal'` refusal is the correct simple guard for the supersede path, provided the article lock is held. Publication changes `processing` in its transaction: [`pg-revisions.ts:2482-2489`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-revisions.ts:2482).
- Job enqueue already locks and rechecks article ownership: [`pg-jobs.ts:588-600`](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-jobs.ts:588). The active-job refusal remains a sensible belt-and-braces rule.

VERDICT: REJECT