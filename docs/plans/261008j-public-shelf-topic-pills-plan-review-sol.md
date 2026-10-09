## P0

None.

## P1

### 1. The automatic-regeneration conclusion does not meet Greg’s stated bar

Greg’s threshold was per regeneration: automatic only “if it was only half a cent and you were confident about that” ([docs/user-feedback/questions/q-deh67j.md:35](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/user-feedback/questions/q-deh67j.md:35)). The plan instead justifies larger regenerations by amortising them across earlier shares ([docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:52](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:52)).

The evidence does not support confidence at that threshold:

- The two 45-article runs cost 0.483¢ and 0.517¢, so one already exceeds the bar ([evals/shelf-topic-clusters/results/261008-public-shelf-cost.json:83](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/evals/shelf-topic-clusters/results/261008-public-shelf-cost.json:83), [evals/shelf-topic-clusters/results/261008-public-shelf-cost.json:93](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/evals/shelf-topic-clusters/results/261008-public-shelf-cost.json:93)).
- The only 96-article run cost 1.44¢ ([evals/shelf-topic-clusters/results/261008-public-shelf-cost.json:105](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/evals/shelf-topic-clusters/results/261008-public-shelf-cost.json:105)).
- The claimed 2–3¢ cost at 150 is explicitly an estimate, not a measurement ([docs/investigations/261008a-public-shelf-topic-rethink-cost.md:46](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/investigations/261008a-public-shelf-topic-rethink-cost.md:46)).
- Successful trials do not bound failure cost: finer naming and widening can each retry once ([src/shelf-terms/model-topics.ts:619](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/shelf-terms/model-topics.ts:619), [src/shelf-terms/model-topics.ts:693](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/shelf-terms/model-topics.ts:693)).
- Prompt/model/profile version changes cause a full rethink independently of membership growth ([src/shelf-topic-sets.ts:304](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/shelf-topic-sets.ts:304)), so those costs cannot honestly be amortised over the preceding shares.

The sentence being put to Greg—“well under half a cent, so I chose automatic”—is materially misleading ([docs/user-feedback/questions/q-p5h2a7.md:9](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/user-feedback/questions/q-p5h2a7.md:9)).

Concrete change: recommend automatic rethink only while the actual input is at a conservatively measured size—20 articles is supported comfortably by the present results. Keep the cheap one-article filing automatic. Above that cutoff, require an admin-only regeneration control. Additional measurements at 30/35/40, including induced retry paths, could later raise the cutoff.

### 2. Removing an article can leave its model-derived label publicly visible

The proposed read-time cut removes memberships for cards no longer listed, but the topic label itself may have been created from the removed article’s title or gist. The plan explicitly acknowledges that a hostile title can steer public labels ([docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:121](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:121)). It nevertheless says archive/delete do not trigger regeneration and only memberships are cut ([docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:105](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:105)).

That weakens the existing promise that unsharing takes effect on the next public request ([docs/project/security-map.md:257](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/project/security-map.md:257)). It could disclose text distilled from an article that is no longer public even when that article’s slug has been removed from the membership list.

Concrete change: persist or derive the exact listed-input snapshot used to build the tree. If the current listed IDs differ, suppress the entire topic tree until it has been rebuilt; do not merely intersect memberships. Unshare/archive/delete therefore become safe immediately. Also specify how rereads are detected: the existing due calculation only sees membership counts and prompt/model/profile versions, not title or gist changes ([src/shelf-topic-sets.ts:291](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/shelf-topic-sets.ts:291)).

### 3. “Reuse `shelfTopicSet`” is incomplete because that coordinator works in distinct works, not public cards

The coordinator’s minimum is eight distinct works, grouped by `textHash`, not eight cards or article IDs ([src/shelf-topic-sets.ts:84](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/shelf-topic-sets.ts:84), [src/shelf-topic-sets.ts:170](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/shelf-topic-sets.ts:170)). It also attempts to prepare missing exact-copy hashes before spending ([src/shelf-topic-sets.ts:337](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/shelf-topic-sets.ts:337)).

The proposed public input query supplies title and gist but does not say how cross-owner text hashes are read or filled ([docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:100](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:100)). The normal owner query obtains hashes through revision phrase runs ([src/store/pg-shelf-terms.ts:496](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/store/pg-shelf-terms.ts:496)). Running as the site owner cannot fill data belonging to the real article owners.

The six-card public sample is consequently not a regeneration case at all under the reused coordinator, because it is below the minimum.

Concrete change: make the unit explicit and design it fully. Either provide a narrowly reviewed cross-owner exact-copy/hash input path, or implement a public-specific coordinator whose unit really is a listed card and document that it intentionally differs from private shelves. Update every “eight articles/cards” statement and the tests accordingly.

### 4. The defence inventory omits the public import graph and under-specifies the new ownerless query

The public import graph currently permits a tightly enumerated set of database tables; `shelfTopicSets` is not among them ([tests/public-imports.test.ts:341](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/tests/public-imports.test.ts:341)). It also explicitly forbids the public graph from importing the owner-context module ([tests/public-imports.test.ts:76](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/tests/public-imports.test.ts:76)).

The ownerless-enumeration test currently knows the exact allowed public article-query sites ([tests/owner-isolation.test.ts:634](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/tests/owner-isolation.test.ts:634), [tests/owner-isolation.test.ts:764](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/tests/owner-isolation.test.ts:764)). A second query deliberately placed “outside the public import graph” risks being invisible to both controls unless explicitly added.

Concrete change:

- Add the public import graph to the defence table and allow only the narrow stored-topic read; do not let the public graph reach the model, gateway, rate limiter, or owner-context implementation.
- Put `SITE_OWNER_ID` in a pure constants module rather than making public code import `src/owner.ts`.
- Prefer one closed public snapshot query that supplies both the response and the regeneration input. That avoids duplicating the visibility/readability/archive predicates.
- If a second ownerless query remains, add its exact generated SQL and table access to the ownerless-enumeration guard.

The anonymous-region guard, one-request page rule, and `no-store` header do not inherently need editing if the public route only reads stored data, but they should be listed as preserved invariants and run in the plan. The existing public dispatcher already applies `no-store` ([src/routes.ts:8556](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/routes.ts:8556)).

### 5. The owner and spend scopes need to be explicit; “after the response” is unsafe if implemented with the existing deferred-task helper

The visibility route already runs inside spend collection and attaches the triggering article slug ([src/routes.ts:8475](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/routes.ts:8475), [src/routes.ts:12354](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/routes.ts:12354)). Spend attribution resolves the owner when calls are recorded ([src/ai-spend.ts:1268](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/ai-spend.ts:1268)).

Merely running database work under `SITE_OWNER_ID` is therefore insufficient: the AI call could retain the sharing reader’s article attribution unless both scopes are overridden. Also, deferred `afterResponse()` tasks execute only after the request callback has returned ([src/after-response.ts:45](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/after-response.ts:45)), after the enclosing spend collector has closed.

Concrete change: specify that the handler sends the visibility response and then still awaits the refresh before returning, as the existing shelf-terms route does ([src/routes.ts:9601](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/routes.ts:9601)). Wrap the refresh itself in both:

- `runAsOwner(SITE_OWNER_ID, …)` for `shelf_topic_sets` and rate-limit ownership.
- `withSpendAttribution({ ownerId: SITE_OWNER_ID, articleSlug: null }, …)` for `ai_calls`.

Add tests showing all three tables use the site owner, the triggering reader’s tree is unchanged, the AI call has no reader article slug, and concurrent requests do not leak either context.

## P2

### 1. “At most about $1/day” is not an actual abuse bound

The allowance counts jobs, not tokens or dollars: 12 per hour and 40 per day ([src/shelf-topic-sets.ts:128](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/shelf-topic-sets.ts:128)). At the plan’s own 2–3¢ estimate, 40 successful regenerations cost $0.80–$1.20 before partial failures and retries. Therefore “at most” is false ([docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:95](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:95)).

Concrete change: either introduce a site-specific dollar/call fuse or use the conservative automatic-size cutoff above and state the resulting measured bound. If retaining the current policy, describe $1 as an approximate successful-run estimate, not a cap.

### 2. The service Auth user has unaddressed operational effects

Using a real Auth user preserves the existing foreign keys and is preferable to weakening them: `shelf_topic_sets`, `ai_calls`, and `rate_limit_events` all reference Auth users ([src/db/schema.ts:1830](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/db/schema.ts:1830), [src/db/schema.ts:3462](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/db/schema.ts:3462), [src/db/schema.ts:7152](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/db/schema.ts:7152)).

However, “no password, cannot sign in” is asserted rather than designed ([docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:89](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:89)). The account will also appear in the all-Auth-user admin inventory and reader counts unless treated specially ([src/store/pg-admin.ts:660](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/store/pg-admin.ts:660)).

Concrete change: define how login is technically prevented, verify it in the provisioning step, and decide explicitly whether the service principal is excluded or labelled in admin user/count and cost views.

### 3. The cost write-up should distinguish measured facts from extrapolation

The widening pass is included in the measurements because `rethink()` invokes it ([src/shelf-terms/model-topics.ts:658](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/src/shelf-terms/model-topics.ts:658)); this is sound. The direct cost capture also found no unpriced calls ([docs/investigations/261008a-public-shelf-topic-rethink-cost.md:19](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/investigations/261008a-public-shelf-topic-rethink-cost.md:19)).

What it does not measure is repeated failure/retry cost, the final production query’s exact inputs, or the 150-article v2 case. It also does not establish a long-term “per share” average once prompt bumps and non-share content changes are included.

Concrete change: retain the raw table, but label 150 as extrapolated, state that widening is included, state that failure retries were not exercised, and remove the claim that the accepted conclusion itself was measured rather than estimated.

### 4. The simpler design was rejected for an incorrect reason

An admin-only regeneration button does not require authentication or a second request on `/read/public`. It can live on the existing admin page. The plan’s claim that manual control necessarily breaks the public page’s one-request/no-auth defence is therefore false ([docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:60](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md:60)); that defence only rules out owner-aware behaviour on the public page itself ([docs/project/security-map.md:345](/var/tmp/spideryarn-worktrees/fbmdp0em-public-shelf-pills-plan/docs/project/security-map.md:345)).

Concrete change: present the simpler hybrid honestly—automatic filing and small safe rethinks; admin regeneration above the measured cutoff, hosted on `/admin`. It meets Greg’s stated fallback while preserving the public shelf’s anonymous one-request architecture.

**VERDICT: REVISE — the storage direction is reasonable, but automatic full regeneration as proposed exceeds Greg’s explicit cost bar, and the plan must resolve stale-label privacy, distinct-work inputs, spend scoping, and the missing public-graph defences before approval.**