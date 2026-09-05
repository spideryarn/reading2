# GPT Sol on the built code — stage 3 of the external link panel

**2026-09-05, `gpt-5.6-sol`, high effort, read-only.** The third review of this piece of work and the
second of built code, after the [plan review](260905f-plan-review-sol.md) and
[stage 2's](260905f-code-review-sol.md). Verdict on arrival: **no P0, four P1s and seven P2s.**

Every finding was accepted. Two were accepted as *findings* and answered with documentation rather
than code, and both say so below with the reason.

## What was done about each finding

| | Finding | What changed |
|---|---|---|
| **P1-1** | a second link to the same destination gets the **first** occurrence's paragraph, and caches it — a plausible answer about the wrong relationship | **Documented, not fixed.** The client sends `(slug, url)` and the card does not know which `<a>` the pointer was over, so the honest fix is a block id on the wire and in the summary's identity. It is the top follow-up in [links.md](../project/links.md#and-what-it-has-to-do-with-the-piece-in-your-hands) rather than a silent limitation |
| **P1-2** | the **tab** cache is in front of the server's four fingerprints, so a reader who edits their profile or their purpose mid-session keeps the old answer | `forgetSummaries()` in [`src/web/link-facts.ts`](../../src/web/link-facts.ts), called from the two places a reader can change either — `useProfile.ts` and `Metadata.tsx`. The whole map, because the global half of a profile is true of every article |
| **P1-3** | a claimant that lost its lease still **emitted** its answer, and the reader's tab cached it. The fence made the database right and left the screen wrong | `fill` returns whether the write landed; a loser yields `pending`, which the client does not remember, so the next hover reads the winner's row |
| **P1-4** | a malformed provider frame was silently skipped, so a missing sentence could be stored for a fortnight as a complete answer | `malformedFrames: "throw"`. The default is right for a caller that shows a reader what arrived; it is wrong for one that writes the result down |
| **P2-1** | `take` and the refusal's `release` sat outside the claim's cleanup, so a database blip left the link pending for its whole lease | `giveBack`, and the allowance is taken inside a `try` of its own |
| **P2-2** | `finish` was awaited bare in the `finally`, so a failed slot release could turn a finished answer into the route's error path — and frame a second terminal event | Caught and logged. Housekeeping does not get to decide what happened |
| **P2-3** | a connection that closed during the route's two pre-stream reads still claimed, spent a fill and recorded an `ai_calls` row for a call that never left the process | `if (signal?.aborted) return` before anything is claimed |
| **P2-4** | the client read the body as a stream without checking the status or the content type, so an ordinary JSON error was cached as *nothing here* for the session | `res.ok` and `text/event-stream` are checked; a failure lands in the `catch` and says so |
| **P2-5** | the shelf test was read from the closure, so on the first hover of a session the *paid* call could be made for a page already on the shelf — which the comment beside it says never happens | `alsoSummarise` reads the shelf at the moment it fires |
| **P2-6** | the prompt told the model the article "can ask you for anything", and the article is fetched content too | Both texts are evidence now. **Only this prompt tells the model what to do**, and the version was bumped so every stored row is a miss |
| **P2-7** | five comments describing behaviour that is not there | All five corrected — the two excerpt caps (8,000 stored, 6,000 prompted), the route's ordering, `sse`'s caller count, the card's header, and the limiter's retention, which sweeps one owner's rows and not everybody's |

**And one thing that was not a finding.** Sol's closing note on the prompt named the escape it still
left open: *identify the destination in a clause, then paraphrase the article's paragraph*. That
reads as relative and is not — it could have been written without the destination in front of you.
The prompt now requires the relation to rest on both texts and to say plainly where the opening does
not settle it, and the first answer under version 2 did exactly that:

> …It is the book Seth cites for describing AI-consciousness attribution as pareidolia: the opening
> explicitly frames Becker's broader reality-check against techno-utopian ideology, **but does not
> itself mention pareidolia or the specific consciousness argument.**

Version 1 had asserted that the article "adopts that diagnosis" without saying whether the page
supported it. That last clause is the difference between a summary and a check.

## The decisions it was asked to challenge, and what it said

Verbatim from the review, because three of them were deliberate departures from the plan and the
answers are worth keeping:

- **The ownerless 8,000-character excerpt** — *"The right trade. It avoids a second fetch and
  preserves destination evidence."*
- **The owner in the primary key** — *"Keep it. It is cheap isolation and future-proofs any later
  divergence in ownership or profile behaviour."*
- **The duplicated claim protocol** — *"Reasonable for now… the lease-loser defect should be fixed
  explicitly rather than forcing a generic abstraction."* Which is P1-3, and is what was done.
- **A failure ending as `pending`** — *"Sound for transient upstream failure. The pre-SSE and cleanup
  paths currently violate that policy."* Those are P2-2 and P2-4.
- **`GET` for a route that spends** — *"Defensible… POST would express the semantics better, but I
  found no current P-level exploit caused by GET."* Left as a `GET`, matching its sibling.
- **The global advisory lock** — *"Ordering is sound, and it serializes only the short admission
  transaction—not model generation."*

---

*The review is kept verbatim below.*
No P0 findings. I found four P1s and seven P2s.

## P1 findings

**P1 — Repeated destinations use the first occurrence’s context.**

The client sends only `(slug, url)` ([link-facts.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:725)); `linkInArticle` deliberately selects the first matching occurrence ([link-previews.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-previews.ts:445)). Consequently, hovering a later link to the same destination uses—and caches—the first link’s anchor and paragraph. That can produce a plausible answer about the wrong rhetorical relationship.

Send a stable block/occurrence ID, validate that occurrence against the target, and include it in the summary identity.

**P1 — The tab cache bypasses all four server staleness fingerprints.**

`summaryCache` is keyed only by `(slug, url)` and returns without contacting the server on a hit ([link-facts.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:636), [link-facts.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:713)). A reader can edit the article purpose in the same SPA session ([Metadata.tsx](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/Metadata.tsx:409)), after which re-hovering continues to show the old personalized answer. In-tab re-extraction has the same problem.

The simplest correction is to retain the in-flight module store but revalidate completed answers against the fast server cache on re-hover.

**P1 — A claimant that loses its lease can still emit a stale `ready`.**

The fenced update ignores whether it affected a row ([pg-link-summaries.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/store/pg-link-summaries.ts:254)), and the caller consequently emits `ready` unconditionally ([link-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-summary.ts:785)).

The 40-second lease begins before the global allowance-lock wait, while the model’s 30-second deadline begins afterwards. A delayed claimant can therefore lose its lease, fail its database update, yet send and session-cache its superseded answer. `fill` should report whether the claim still won; on failure, return the stored winner or `pending`, never the claimant’s text.

**P1 — A malformed provider frame can become a cached partial answer.**

The summary call does not request strict malformed-frame handling ([link-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-summary.ts:494)). The default parser silently skips invalid JSON frames ([openrouter-stream.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/openrouter-stream.ts:265)). If the provider later sends `[DONE]`, missing words are classified as a complete answer and stored for fourteen days.

This cached caller should use `malformedFrames: "throw"`.

## P2 findings

**P2 — Allowance admission lies outside claim cleanup.**

After acquiring the claim, `fetchAllowanceStore.take` runs before the cleanup `try` ([link-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-summary.ts:752), [link-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-summary.ts:759)). If it throws—or releasing a denied claim throws—the link remains pending until the 40-second lease expires.

**P2 — Allowance cleanup can replace the real outcome and produce two terminal frames.**

`finish` is awaited without an isolated catch ([link-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-summary.ts:798)). If it fails after `ready`, the route catches it and appends `pending`; if it fails during another error, it replaces the useful original error ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/routes.ts:1626)). Report cleanup failure separately without changing the stream outcome.

**P2 — A connection already gone can consume allowance and record a call that never happened.**

`sse` correctly creates an already-aborted signal when the socket closed during the pre-stream reads ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/routes.ts:1122)), but the summary generator does not inspect it before claiming and taking allowance. The meter is constructed before the aborted fetch is attempted ([ai-call.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/ai-call.ts:1169)). This records an aborted AI call and counts an allowance event despite no network request.

**P2 — Pre-header failures and hangs fall outside the documented retry lifecycle.**

Article/profile reads happen before SSE ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/routes.ts:1614)). The client neither checks `res.ok` nor validates the content type, so an ordinary HTTP error body produces no terminal frame and is cached as `null` for the session ([link-facts.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:726), [link-facts.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:762)).

Additionally, the stall clock starts only after `apiFetch` has received headers. A hung profile/database read therefore leaves `summaryPending` occupied indefinitely, and neither the client stream clock nor model clocks starts. Add response validation plus a first-header/preflight deadline; transient failures should remain retryable.

**P2 — The initial shelf race can start a paid summary for an already-shelved destination.**

The effect captures `shelved` before the asynchronous shelf load ([link-facts.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:878)). Once the preview completes, `alsoSummarise` does not re-check the current shelf ([link-facts.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/link-facts.ts:902)). The comment accepts one spare preview request, but the implementation can also make the paid call that the following comment says never happens.

**P2 — The prompt grants instruction authority to untrusted article prose.**

The destination is fenced correctly, but the system message says the article “can ask you for anything” ([link-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-summary.ts:375)). The article is also fetched content, so an author can place instructions in the cited paragraph and steer the cached answer. Both article and destination should be evidence; only the system prompt and intentional reader profile should instruct.

**P2 — Several comments describe behaviour that is absent.**

Notably:

- The schema calls the 6,000-character prompt cap the storage cap; storage is actually capped at 8,000 ([schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/db/schema.ts:4456)).
- The route ordering says URL length checks precede ownership, but ownership/profile reads happen first and the summary route has no equivalent length check ([link-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/link-summary.ts:661)).
- The SSE helper still claims six callers after adding the seventh ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/routes.ts:1065)).
- The hover-card and link-facts headers still describe only the old lookup set ([ProseHoverCard.tsx](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/web/ProseHoverCard.tsx:114)).
- Rate-limit retention says expired rows are deleted, but the sweep covers only the current owner and bucket; inactive readers’ rows remain indefinitely ([pg-rate-limit.ts](/home/greg/code/spideryarn2/.claude/worktrees/external-link-panel/src/store/pg-rate-limit.ts:136)).

## Decision assessment

- **Ownerless 8,000-character excerpt:** The right trade. It avoids a second fetch and preserves destination evidence. Eight thousand stored/six thousand prompted is reasonable; the schema comment needs to state those two different bounds accurately.
- **Owner in the primary key:** Keep it. It is cheap isolation and future-proofs any later divergence in ownership or profile behaviour.
- **Duplicated claim protocol:** Reasonable for now. The two stores have different identities and validity rules; the lease-loser defect should be fixed explicitly rather than forcing a generic abstraction.
- **Failure becomes `pending`:** Sound for transient upstream failure. The pre-SSE and cleanup paths currently violate that policy.
- **GET:** Defensible under the current bearer-authenticated, explicit client-fetch design. POST would express the semantics better, but I found no current P-level exploit caused by GET.
- **Global advisory lock:** Ordering is sound, and it serializes only the short admission transaction—not model generation. At the stated fuse volume, that is acceptable.
- **Prompt:** Directionally strong, and the measured Whitehead answer does establish a relationship. Its remaining generic escape is “identify destination, then paraphrase the article passage”; requiring an explicit comparison supported by both inputs—or an explicit statement that the opening cannot establish the relationship—would close that gap.

Read-only review only: I changed no files and ran no tests.