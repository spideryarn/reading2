# Verdict

I would not build the plan exactly as written. The sibling checkpoint field and no-schema-bump decisions are correct, but three design points need correction first. Several P1 attribution paths could otherwise put a real percentage under an unproved or duplicated account heading.

The worktree gained uncommitted implementation files while I was reviewing. I treated `HEAD` as the pre-build baseline; the in-progress code already moves in the right direction on Codex’s discriminated shape and registry problems, but the plan does not yet record those decisions.

## P0 — fix before building

### 1. The plan creates a second ambient Codex observation and renders both

The existing daemon usage pass already runs `collectCodexUsage()` every usage interval and writes that observation into history: [scripts/overseer.ts:117](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/scripts/overseer.ts:117). The plan adds another ambient `collectCodexUsage()` in a second optional pass: [plan:149](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md:149), [plan:189](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md:189).

That makes the stated cost wrong: today would be two ambient Codex app-server spawns per five minutes, not one. More importantly, the existing card obtains Codex from history and renders it already ([App.tsx:168](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/fleet/web/src/App.tsx:168), [App.tsx:412](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/fleet/web/src/App.tsx:412)); the plan then puts independently collected sections underneath that card ([plan:214](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md:214)). Codex readings can oscillate by a point, so the page can show two different answers for the same subscription.

What I would do instead: collect ambient Codex once under the existing usage timer and fan that exact observation to both history and `Checkpoint.accountUsage`. Keep the sibling checkpoint field, but drop the second timer/collector. Make per-account sections the owner of live headroom; retain the old card only for global Claude verdict/429 evidence or as a fallback while `accountUsage` is absent.

### 2. The proposed shared `UsageWindowCard[]` shape is not a valid model of Codex

The plan gives both families the same `reading.windows: UsageWindowCard[]` shape ([plan:120](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md:120)). Codex actually returns buckets containing positional windows, with duration providing window identity: [wire.ts:3369](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/fleet/wire.ts:3369). Multiple buckets can contain windows of the same duration, and model-specific buckets must not stand in for general subscription headroom.

As written, the plan never says how bucket identity, duplicate general buckets, or model-specific windows survive flattening. It also fails to make `family` discriminate the reading shape, so TypeScript permits a Codex section carrying Claude windows.

Use a discriminated union:

- Claude → named `UsageWindowCard[]`
- Codex → preserved/adjudicated `CodexUsageBucket[]`

Reuse the existing Codex bucket/window interpretation rather than creating another one. The uncommitted wire changes now do this; update the plan to match them.

### 3. The plan assumes a peer-plan registry decision that has not been made

The plan says `providerTenantId` “is becoming `string | null`” by Sol’s ruling and requires null-to-null equality ([plan:178](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md:178)). In committed source it is still required `string`: [accounts.ts:23](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/accounts.ts:23). More importantly, plan 260910b leaves the choice open between a family-discriminated entry and a nullable tenant: [260910b:147](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910b-several-codex-chatgpt-account-subscriptions-on-the-box-same-shape-as-the-claude-ones.md:147).

The null-to-null argument is also misplaced: registered Codex usage is pinned through `expectedAccountId`; it does not use Claude’s `LiveUsageIdentity.providerTenantId`.

What I would do: make 260910b Stage 1 an explicit prerequisite, consume its settled type, and keep the pin family-specific. Prefer a discriminated registry entry so Claude retains a required organisation pin while Codex explicitly has no equivalent. Do not weaken Claude’s `LiveUsageIdentity` through a generic `Pick`.

## P1 — false or unsupported claims

### Ambient Codex can publish unattributed numbers

The ambient path supplies no expected account id ([plan:189](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md:189)). `CodexUsageReading.value.accountId` is nullable, and an unpinned null-id reply is intentionally accepted: [wire.ts:3406](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/fleet/wire.ts:3406), [codex-usage.ts:516](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/codex-usage.ts:516).

That lets percentages reach a section labelled “ambient Codex” without proving which account-subscription they describe—the exact failure class requested for review.

Require a non-null provider account id before an ambient Codex section gets a numeric reading. Better, read the local ChatGPT account id established by 260910b Stage 1 and pass it as `expectedAccountId`. Null must become `unknown` for an account-subscription section.

### Expiry must be rechecked in the live renderer

The plan says expiry safety is inherited from collection-time parsing ([plan:266](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md:266)). That is insufficient: a window can reset after collection while the page remains open or while a held checkpoint remains published.

The project rule explicitly distinguishes these: history preserves what was true then, while a live card re-derives expiry now: [usage-history.md:101](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/project/usage-history.md:101). The existing renderer does that at [UsagePanel.tsx:357](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/fleet/web/src/UsagePanel.tsx:357).

Add a renderer test where a `value` window’s reset passes after collection; assert no percentage and no bar remain.

### Directory-based deduplication does not deduplicate subscriptions

`path.resolve` catches two spellings of the same path, but not:

- two distinct state directories containing the same login;
- symlink aliases;
- an ambient login copied into a registered home.

Because ambient is absent from the registry, registry uniqueness cannot catch this. The page would show two sections and imply two subscriptions where there is one.

After collection, detect collisions by verified provider identity within each family. If identity cannot be established, retain both unknown sections; if it can and collides, emit one section plus a loud configuration problem.

### The top-level type cannot say that the account list is incomplete

The planned `StoredAccountUsage` has only `reading(accounts[])` or `none` ([plan:134](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md:134)). If the registry is malformed but ambient reads succeed, publishing those ambient sections alone makes a short list look complete.

Choose one explicitly:

- Simplest safe v1: registry error makes the whole pass `none`.
- More informative: add top-level `problems`/coverage beside `accounts`, and render it loudly.

The in-progress implementation chose `problems`; that decision belongs in the plan and needs a UI assertion.

### The proposed history caveat is false

The chart is not necessarily `greg@rehearsable.ai` only. Each persisted sample contains one account, but a `/login` switch can produce several account UUID series across the 24-hour range. The project doc says so directly: [usage-history.md:123](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/project/usage-history.md:123). The renderer already adds UUID fragments when several accounts appear: [UsageHistory.tsx:276](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/fleet/web/src/UsageHistory.tsx:276).

Use wording such as:

> History still samples only the ambient account observed on each daemon pass. It does not yet record the registered account sections above; historical accounts are identified by UUID.

Do not name an email unless every plotted UUID has been positively matched to it.

## The five load-bearing conclusions

1. **Sibling `Checkpoint.accountUsage`: confirmed.** `chooseUsage` returns `keep-stored` whenever the fresh transcript scan is incomplete after account/age checks: [usage-carry.ts:89](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/usage-carry.ts:89), [usage-carry.ts:117](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/usage-carry.ts:117). The daemon then omits the update and retains the whole old report: [daemon.ts:840](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/daemon.ts:840). Putting fresh account readings inside that report would discard them. The central design argument holds.

2. **No checkpoint schema bump: confirmed.** The store’s stated rule is exactly “ignored field means poorer, not wrong”: [store.ts:454](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/store.ts:454). Older parsers ignore extra object keys. An old dashboard has no sections component; a new dashboard reading an old/rewritten checkpoint must project absent `accountUsage` to `no-reading`. Add mixed-version tests, but no bump is warranted.

3. **`readUsage`: mostly safe, but two claims need correcting.**
   - It never sends or spends the refresh token.
   - It does, literally, read and parse the entire credentials file containing that token before selecting `accessToken`: [accounts.ts:332](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/accounts.ts:332). Say “never selects, sends or spends,” not “never reads.”
   - The 10-second bound is per HTTP request, not per account. A rotated-token retry can make up to four sequential requests, so the account read can approach 40 seconds. Each production network request is bounded by `AbortSignal.timeout`: [accounts.ts:341](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/accounts.ts:341).
   - Normal returned fields are credential-safe: transport failures become generic messages, profile fields are checked, and window prose is redacted: [accounts.ts:409](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/accounts.ts:409). Existing tests cover echoed/thrown access tokens.

4. **`enforceExpectedAccount` hole: confirmed; proposed fix is correct.** In committed source, null bypasses the pin at [codex-usage.ts:520](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tools/overseer/codex-usage.ts:520). Null must become `unknown` only when an expected id was supplied. Unpinned ambient behavior remains unchanged.

   Complete caller list:

   - In committed `HEAD`, only the mismatch test supplies `expectedAccountId`: [codex-usage.test.ts:557](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/tests/codex-usage.test.ts:557). No production caller does; [scripts/overseer.ts:124](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/scripts/overseer.ts:124) calls it unpinned.
   - The now-uncommitted worktree additionally has the new null-id test at `tests/codex-usage.test.ts:587` and the intended conditional production caller at `tools/overseer/account-usage.ts:98`.

   Therefore the fix breaks no existing committed production caller.

5. **Ambient registration: true for Claude’s supported flow, not established generically.** Claude’s `add` command refuses the orchestrator role and default `.claude` directory: [claude-accounts.ts:1419](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/scripts/claude-accounts.ts:1419). The raw registry parser would accept a hand-written entry, but launch guards refuse routing the default Claude directory. For Codex, Stage 1 is not built and its plan explicitly says a Codex orchestrator can coexist in the registry: [260910b:74](/home/greg/code/spideryarn2/.claude/worktrees/usage-per-account/docs/plans/260910b-several-codex-chatgpt-account-subscriptions-on-the-box-same-shape-as-the-claude-ones.md:74). The blanket two-family claim is therefore unproved.

   Also, `ambient` is provenance, not a role. The ambient Claude account’s role is orchestrator. Model `origin: "ambient" | "registered"` separately from `role: "orchestrator" | "pool"`.

## Scope cut

Deferring plural 24-hour history is coherent. Live per-account sections are independently useful, and the history format genuinely requires a larger persisted-schema change.

The page as currently planned is not coherent, though: it stacks new live sections under an existing live account card, performs ambient Codex twice, and then gives the chart a false single-email label. Resolve those three presentation/data-owner issues and the history cut becomes a clean v1 rather than a contradiction.

## Simplifications

- Drop the second daemon pass; share one usage tick and fan observations to separate checkpoint fields.
- Refactor the existing `overseer usage` registered-account loop into `collectAccountUsage` and have both CLI and daemon consume it. Otherwise there are two identity-pin implementations.
- Reuse the existing Claude and Codex window renderers.
- Replace the third `role` arm with a separate ambient/registered origin.
- Treat “Stage 4 — NOT BUILT” as a follow-up section, not a stage of this build.

No files were changed and I did not run the test suite; this was a read-only plan/source review.