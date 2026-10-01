Build with changes — the two-call forcing design is sound, but the P1 findings below block building the plan as written.

## Findings

**F1 — P1: The plan omits an explicitly requested library search that already exists.**

The brief says to use library search if available, but the plan defers it because the current literal search performs poorly ([plan:178](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:178)). It is nevertheless a working, reader-scoped search: the chat tool calls it with the current article excluded ([chat-tools.ts:1092](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/chat-tools.ts:1092)), and the Postgres implementation enforces owner scope and returns article/block passages ([pg-shelf.ts:552](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/store/pg-shelf.ts:552)).

Concrete fix: include the existing search as a bounded, best-effort part of `searchFirst`, with `excludeSlug` and a small hit limit. Keep library hits distinct from web sources and include internal article/block references. An empty result is acceptable; semantic search can later replace the implementation behind this seam.

**F2 — P1: `power: "high"` does not guarantee Opus.**

The plan repeatedly equates `power: "high"` with “always Opus” ([plan:57](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:57)), but model resolution deliberately lets a task-specific environment override win before power selection ([models.ts:1386](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/models.ts:1386)). A standard article with `SPIDERYARN_EXPLAIN_MODEL` or the corresponding citation override can therefore produce a non-Opus Dig deeper answer while the UI says it used Opus.

This also affects Citation freshness: its stored-context hash is reconstructed using the normal task model ([pg.ts:3860](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/store/pg.ts:3860)), which could differ from the model actually used by a hard-pinned Dig deeper call.

Concrete fix: give Dig deeper an explicit, non-overridable production model constant or dedicated resolver, and use that same model/generation key when writing and reading saved results. Add tests with the existing model-override variables set.

**F3 — P1: Citation Investigate would still contain reader-visible Sonnet judgments.**

Stage 2 only promotes the final answer call and explicitly leaves “Look it up” and paper reading unchanged ([plan:149](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:149)). Today:

- Citation lookup uses the article’s current power ([citation-investigate.ts:778](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:778)).
- Paper-passage selection also uses the article’s power ([citation-investigate.ts:852](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:852)).
- Its “bears / does not bear” judgment is shown directly to the reader ([CitationInvestigation.tsx:23](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/CitationInvestigation.tsx:23)).

The Luna call is defensibly mechanical query preparation; the paper-passage judgment is not.

Concrete fix: run `citation-paper-passages` on the pinned Dig deeper model. Either promote the citation-lookup judgment too, or explicitly narrow the promise to “the synthesized answer always uses Opus” and describe lookup as retrieval preparation.

**F4 — P1: Merging every search result into “citations” overstates what the answer used.**

The plan proposes merging all search-step sources with the final answer’s annotations ([plan:106](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:106)). The existing UI describes these as what the answer “cited” ([GlossaryPanel.tsx:1866](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/GlossaryPanel.tsx:1866), [CommentDialog.tsx:657](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/CommentDialog.tsx:657)). Supplying five results to Opus does not establish that Opus relied on all five.

Concrete fix: preserve two provenance sets:

- `researchSources` or “Search results provided to the model” from the forced search.
- `citations` from the answer call’s annotations.

Only combine them if the UI and stored schema stop claiming that every source was cited.

**F5 — P1: Staging activates expensive endpoints before their reader limits exist.**

Stage 1 makes Glossary and Comment Dig deeper live ([plan:124](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:124)); Stage 3 adds their allowance ([plan:160](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:160)). Stage 1 is therefore not a safe stopping point: every press performs a forced search plus an Opus call without the requested per-reader protection.

Concrete fix: Stage 1 may land disconnected foundation and measurements, but the shared `dig-deeper` admission policy must land in the same stage that exposes the first routes. Perform admission after ownership/input validation but before mutation, opening SSE, or making either AI call. Retain Citation’s existing bucket rather than double-charging it.

The proposed shared bucket for Glossary and Comment is otherwise the right shape.

**F6 — P1: Citation prompt-version freshness is missing.**

Adding findings to `investigatePart` changes the saved prompt/context layout, but the plan does not require a version bump. The code explicitly requires `CITATION_INVESTIGATE_VERSION` to change whenever either prompt part changes ([citation-investigate-context.ts:32](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate-context.ts:32)), and that version participates in the context hash ([citation-investigate-context.ts:147](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate-context.ts:147)).

Without the bump, an old Sonnet, optionally searched investigation can be presented under new “Dug deeper” copy.

Concrete fix: bump the investigation version in Stage 2 and add a test proving a row produced with the old version no longer attaches.

**F7 — P2: The search witness needs to reject missing usage, not only a numeric zero.**

The plan’s prose says to throw when usage shows no search, but its test list only mentions zero searches ([plan:100](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:100), [plan:141](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:141)). The parser distinguishes zero from missing/unrecognised usage by returning `searches: null` ([openrouter-stream.ts:316](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/openrouter-stream.ts:316)).

Concrete fix: success must require `searches !== null && searches > 0`. Test both supported field spellings, explicit zero, missing usage, and usage without either search-count field. Log `from` on failure so an upstream schema change is diagnosable.

**F8 — P2: The extra search call needs an explicit deadline and allowance lease coverage.**

`openRouterJson` does not add its own timeout; it only accepts a caller signal ([ai-call.ts:1806](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/ai-call.ts:1806)). Citation’s current concurrency lease is calculated from its known step deadlines ([citation-investigate.ts:195](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:195)). Adding an unbounded preliminary call can leave a request hanging or allow the lease to expire while work remains active.

Concrete fix: define a measured search timeout, pass an abort signal to `openRouterJson`, and add that timeout to both the shared Dig deeper lease and Citation’s existing total lease. Ensure every admission token is released in `finally`.

**F9 — P2: Fence the complete web result, not merely its excerpt.**

The plan correctly identifies web text as untrusted ([plan:208](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:208)), but title and URL text are also controlled by the remote page. The project’s fence specifically escapes embedded delimiter attempts ([untrusted-fence.ts:15](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/untrusted-fence.ts:15)).

Concrete fix: serialize every result’s URL, title, and excerpt inside one `untrusted(...)` region, followed by trusted instructions outside it. Keep `isWebUrl` filtering, and test delimiter injection in titles as well as excerpts.

**F10 — P2: Existing Glossary answers have no route to “Dig deeper again.”**

Glossary returns the saved lookup immediately when one exists; the action is rendered only when no lookup exists ([GlossaryPanel.tsx:1737](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/GlossaryPanel.tsx:1737)). Thus readers with an old Check the web answer—possibly one explicitly marked as having performed no search—will never see the new action, despite the proposed “Dig deeper again” copy.

Concrete fix: render `Dig deeper again` beneath existing lookup results and replace/upsert the stored result on success, while preserving the old result if the rerun fails.

## Conclusions on the questioned design choices

- The survey is otherwise complete. Glossary Look up is correctly excluded: it is the initial answer, not the follow-up research action. Quote rationale, search-match context, timeline disclosures, trajectory depth, and chat are not equivalent paid per-item research actions.
- The separate forced quick-tier search is the simplest mechanism here that is both forced and auditable. The Exa plugin route cannot currently prove that a search happened and sacrifices the useful cached prefix.
- `openRouterJson` does expose the raw response needed for annotations: the repository already reads `message.annotations` and usage from it in [citation-find.ts:342](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-find.ts:342). The annotation parser supports URL, title, and content ([openrouter-stream.ts:366](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/openrouter-stream.ts:366)).
- Putting findings only in the final user part preserves Explain’s byte-identical system/article/tool prefix. Opus reasoning is added automatically for the provider-default high model ([ai-call.ts:936](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/ai-call.ts:936)); the plan is right to measure the token ceiling rather than copy the Sonnet value.
- I do not find an established P0 charging defect. The article allowance currently buys article-wide high-power processing; an isolated, separately limited Dig deeper action is a defensible new entitlement. The real contract failure is exposing it before its limiter.
- “Dig deeper” is a good common label and closely follows Greg’s language. “Dug deeper” is awkward status copy; “Researched on … · Dig deeper again” would read more naturally without weakening the action name.