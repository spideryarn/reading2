No files changed. The page cube is a good UI seam, but it is not sufficient for the promised agent analysis or audit. Several proposed outputs would be authoritative-looking but semantically false.

## Findings

**F1 — P1 — established: the cube cannot produce several promised “leads.”**

The cube discards `run_id`, `job_id`, individual costs, timestamps, and generation IDs, yet the analysis promises reruns, failed-call spend, and per-call outliers ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md:49), [plan](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md:157)).

- A sum and call count reveal a group average, not individual outliers.
- Failed-call counts do not reveal failed-call spend unless outcome is a dimension or failed money is separately aggregated.
- Multiple calls are not reruns: labels, chat tool rounds, retries, and batched modes legitimately make several calls.
- The ledger explicitly cannot distinguish initial ingest from a rerun ([cost-categories.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/cost-categories.ts:18)).

Use the cube for the page. Let the analysis script read detail rows—or purpose-built aggregates retaining `run_id`/`job_id`—for selected suspects. Do not call repeated rows “reruns” unless a durable initiating-job fact is added.

**F2 — P1 — established: the proposed token and duration totals are invalid.**

The plan sums input/cache tokens and `duration_ms`, then exposes “tokens in” ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md:49), [plan](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md:107)).

The schema explicitly says Messages excludes cache tokens from input while chat includes them, so a cross-wire input sum “counts nothing in particular” ([schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/db/schema.ts:3211)). There are now seven wires, including images, transcription, decisions, and realtime—not merely the two textual wires ([models.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/models.ts:1269)).

Likewise, summed duration is cumulative call-time, not step wall-time; concurrent calls inflate it, while grouped eval runs conflate articles ([ai-gateway.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/ai-gateway.md:658)).

Remove token and duration columns from the v1 page. Analyze usage only within one wire, using wire-specific denominators. If latency is later added, show per-call latency distributions—not summed “duration”—from detail rows.

**F3 — P1 — established: “model” and “mode” are not the facts the page claims.**

The page groups “model” by `requested_model`, even though the schema says the answering model is not always the requested one ([schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/db/schema.ts:3222)). For cost explanation, `answered_model` and upstream are core v1 dimensions, not deferred extras.

Likewise, `ArticleCost.lineName` is headed **Work**, not Mode ([ArticleCost.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/ArticleCost.tsx:39), [ArticleCost.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/ArticleCost.tsx:166)). A pipeline step often corresponds to a mode; `chat`, `dig-deeper-search`, `citation-investigate`, and `command-pick` do not. The ledger often lacks the product surface that initiated a request.

Name the dimension **work/task**. Add a separately derived product-surface or mode family only where the mapping is provable; otherwise say “not attributable to a mode.”

**F4 — P1 — established: the article fallback merges articles that the ledger cannot distinguish.**

The proposed key is `article_id`, else slug, else “no article” ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md:79)). But deleting an article nulls `article_id`, while the slug remains historical ([schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/db/schema.ts:3195)). A slug can later be reused by the same owner; the existing article query needs creation time precisely to avoid merging a predecessor ([ai-calls-spend-pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/store/ai-calls-spend-pg.ts:500)).

Keep `article_id` and recorded `article_slug` separate. Current articles can be joined and identified safely. Null-id historical rows may be grouped as “recorded slug X,” but must not be claimed as one unique article.

**F5 — P1 — established: Q-1 identifies the right decision, but chooses the wrong default and hides the widening inside an existing exemption.**

Greg’s request fairly authorizes a cross-owner numerical breakdown by article. It does not explicitly authorize title-derived slugs. The standing admin contract says:

- never expose a title, URL, filename, or sentence ([admin.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/admin.md:181));
- spend currently names no article, model, or job ([admin.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/admin.md:229));
- which articles someone reads does not leave their session ([admin.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/admin.md:240)).

The existing exemption for `ai-calls-spend-pg.ts` is justified specifically because it returns money and owner IDs and “nothing else—no title, no URL, no slug” ([owner-isolation.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/tests/owner-isolation.test.ts:368)). Adding slugs to that file would widen the query while evading the guard intended to make widening conspicuous.

Default to opaque article IDs until Greg answers Q-1. Put the new cross-owner query in an explicitly named admin-cost store module and add it to the exemption list deliberately. Do not link through to article contents.

The namespace gate itself is sound and would refuse non-admins before dispatch ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/routes.ts:10984)). The new response must also say `Cache-Control: private, no-store`, as existing cross-owner admin responses do ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/routes.ts:8065)). URL state should contain opaque owner/article IDs, not emails or slugs.

**F6 — P1 — established: the page’s money arithmetic needs stronger labels and denominators.**

The three pockets must remain separate: OpenRouter credits, BYOK upstream, and computed estimates ([ai-calls-spend-pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/store/ai-calls-spend-pg.ts:95)). OpenRouter credits are not cash; cash is approximately 5.5% higher for that pocket only ([ai-gateway.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/ai-gateway.md:418)). Also, settled and unpriced overlap for a settled BYOK zero lacking an upstream figure ([ai-calls-spend-pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/store/ai-calls-spend-pg.ts:111)).

Required labels:

- **Recorded ledger amount** = credits + BYOK upstream + computed.
- **Estimated cash** may be shown separately, with the fee applied only to credits.
- **Known amount per priced call** must divide by `calls - unpricedCalls`, not all calls.
- “Settled,” “computed,” and “unpriced” must not be drawn as a partition.
- Failed/stopped money is included; non-realtime failures can still be lower bounds.
- Every total remains a floor when unpriced calls, silent live sessions, failed writes, or unattributed calls exist.

**F7 — P1 — established: the audit cannot establish the completeness it promises.**

The proposed production-row comparison against `generation?id=` is a useful independent accuracy check for those OpenRouter rows. The monthly key reconciliation is not a completeness proof: the existing implementation explicitly has no stored baseline and says to watch whether the gap moves, not whether it is zero ([ai-cost.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/ai-cost.ts:410)).

Other gaps:

- The paid probe covers Messages, chat, and embeddings, but not transcription, images, decisions, or realtime ([cost-tracking.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/cost-tracking.md:170)).
- The source scan calls itself a tripwire, not a boundary, and names dynamic hosts, unknown providers, subprocesses, and `curl` as evasions ([no-undeclared-spend.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/tests/no-undeclared-spend.test.ts:51)).
- Failed writes and unscoped calls exist only in process counters and are absent from ledger queries ([cost-tracking.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/cost-tracking.md:112)).
- The route table compels an `article` answer, but the mode checklist admits the compiler cannot ensure the answer is correct ([mode.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/mode.md:485)).

Add:

1. A controlled before/after provider-balance delta using a dedicated or otherwise quiet credential, reconciled to rows with that fingerprint.
2. Paid probes for every product wire, with realtime checked separately against session usage.
3. Direct validation of computed price formulas and `price_version`, not only provider-settled calls.
4. Production log/monitoring checks for write failures, late calls, and unscoped calls; state plainly that historical completeness cannot otherwise be proven.
5. An inventory of provider-capable subprocesses, shell scripts, browser-direct connections, and environment-defined endpoints, independent of the gateway register.
6. Adversarial fixtures for BYOK, settled-plus-unpriced, zero-cost calls, unknown scopes, answered-model mismatch, and deleted/reused slugs.
7. Exact reconciliation from raw rows to cube totals for calls and each money pocket.
8. For the “two owners” surprise, compare against accounts with an expected paid event after the ledger cutoff—not merely all accounts owning articles. Also check article-owner mismatches, null attribution by job, and expected jobs/runs lacking rows.

**F8 — P2 — reasoned: v1 scope is inverted in a few places.**

Do not defer `answered_model`, upstream, article size/type/high-power, or silent voice coverage: these are necessary to answer the three questions Greg named.

Cut from v1:

- the generic pivot;
- generic “inefficiency” heuristics not backed by invocation/run evidence;
- global token and duration columns;
- `--commentary` ingestion;
- a broad preset system beyond the three named questions.

A sortable ranking table plus one over-time chart already supplies the requested two forms. Keep the static HTML analysis report, but make its conclusions evidence-backed rather than generated from the page cube alone.

**F9 — P2 — reasoned: hand-written presentation is right, but the library research is stale.**

For two simple bar presentations and a script-free static report, a small custom renderer is appropriate. Ranking bars can be semantic HTML/CSS; reserve SVG for the stacked time chart, with the same figures also available in a table.

The stated pivot-library rationale is outdated: `react-pivottable` now has a v0.11.1 release explicitly updating compatibility for React 19, and its table renderer does not require Plotly ([releases](https://github.com/plotly/react-pivottable/releases), [project README](https://github.com/plotly/react-pivottable)). It is still a poor fit here because it supplies a much larger drag-and-drop product than this fixed two-dimensional pivot needs.

The current Recharts objection is stronger: Recharts 3 has an open server-rendering regression where `renderToStaticMarkup` produces an empty wrapper rather than SVG ([upstream issue](https://github.com/recharts/recharts/issues/5997)). So do not add Recharts for this v1. Correct the plan’s factual rationale and record dated sources, as required by [third-party-library-selection.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/reusable/third-party-library-selection.md:21).

**F10 — P2 — reasoned: the production HTML artifact needs an explicit privacy contract.**

`logs/` being gitignored prevents accidental commits, but does not make a file private. Write production reports atomically with mode `0600`, escape all database and commentary text, print the absolute destination, and never serve or upload them automatically. The file option is defensible once those properties are part of the design.

## Recommended data seams

The page cube should carry these exact fields:

| Kind | Fields |
|---|---|
| Dimensions | UTC day, `owner_id`, nullable `article_id`, recorded `article_slug` separately, `scope_kind`, `purpose`, `step_name`, `wire`, `requested_model`, `answered_model`, `upstream`, `provider_account`, `cost_source`, nullable `is_byok`, `outcome`, `event_kind`, `price_version` |
| Additive measures | calls, `credits_used_nanos`, `byok_upstream_nanos`, `computed_cost_nanos`, unpriced calls, computed calls, settled calls |
| Derived only | category, work/task label, recorded ledger amount, priced calls, known amount per priced call |
| Separate lookup | owner email; current-article word/block count, source kind, and high-power flag |

It should not carry or claim:

- a collapsed `article_id ?? slug` identity;
- “mode” for arbitrary request jobs;
- one generic input-token number;
- summed duration as elapsed time;
- cash as though stored per row;
- rerun counts;
- per-call outliers;
- emails or title-derived slugs in URL state.

The analysis path should retain detail fields such as row ID, `run_id`, `job_id`, `generation_id`, timestamps, all raw wire-specific usage fields, and credential fingerprint. That is the evidence needed to explain expensive articles and tasks without overloading the browser endpoint.

VERDICT: revise