K4-REVIEW-c41d7e

One established P1 remains outside the permitted files: K4 exposes a shared sentence that falsely says nothing was sent or received after text has already arrived. I fixed the confirmed issues inside the cluster and left everything uncommitted.

**1. Does anything change what the reader sees beyond the plan’s claims?**

Yes: Skim’s recovered-save path leaves old-purpose summaries and suggestions visible (F2); malformed confirmation replies enter a supposedly confirmed state (F5); and Search’s hint describes unchecked rows using only checked rows’ policies (F8). I found no additional unplanned layout or control change. Mirror’s missing button is explicitly documented.

**2. Can any newly displayed sentence be false or less true?**

Yes: F1, F3, F4 and F8 below.

Skim’s three uncertainty sentences—“Couldn’t tell whether…”, “Your words are still in the box”, and “Reload…”—are appropriate. The separate “That was not saved” claim was unjustified and is fixed.

Search’s all-retryable variant could falsely describe unchecked permanent failures; its no-retry variant could falsely describe unchecked retryable failures; and its no-retry and mixed variants overstated likely refusal as certainty. All three now name the switched-on searches, without guaranteeing failure.

- **K4-F1 — P1, established; unresolved, wider.** [COULD_NOT_REACH](/var/tmp/spideryarn-worktrees/agent-a1808d25fe65f8be3/src/messages.ts:2872) says “nothing was sent or received.” Exact path: receive an SSE delta → body rejects with `TypeError` → transport mark → `describeFetchFailure` → that sentence. K4 newly routes these catches, including blob failures, through it. The existing stream tests exercise this path. `src/messages.ts` is outside the allowed paths, so I reported it without editing it.

- **K4-F2 — P1, established; fixed.** [Skim’s recovery](/var/tmp/spideryarn-worktrees/agent-a1808d25fe65f8be3/src/web/SkimPurpose.tsx:120) bypassed `profileSaved()`, leaving cached summaries and command suggestions based on the old purpose. The new regression observed an unchanged profile generation after successful recovery; it failed, then passed after adding the notification.

- **K4-F3 — P1, established; fixed.** A mismatched reread cannot prove the PATCH never saved: another tab can overwrite a landed save before that read. A regression reproduced this and caught “That was not saved.” The sentence now states what was observed: “The saved purpose didn’t match these words…”

- **K4-F4 — P1, established; fixed.** [Search’s hints](/var/tmp/spideryarn-worktrees/agent-a1808d25fe65f8be3/src/web/SearchPanel.tsx:1795) changed the real refusal sentence’s “most likely” into “would fail the same way.” Two red-first cases using `providerHttpFailure(403)` established this. The guarantee is removed.

- **K4-F5 — P2, established at the client seam; fixed.** [storedPurpose](/var/tmp/spideryarn-worktrees/agent-a1808d25fe65f8be3/src/web/purpose.ts:75) treated missing or malformed fields as confirmation of absence. Three malformed-response probes failed before validation was added. The current server route does not emit those shapes; this is defensive hardening of the new confirmation seam.

- **K4-F6 — P3, established; corrected.** The [stream comment](/var/tmp/spideryarn-worktrees/agent-a1808d25fe65f8be3/src/web/lib/sse.ts:290) and plan claimed every `done` followed storage. Glossary’s ask can finish with `existing` or `no-glossary` without storing its answer. `MalformedReply`/`PAGE_FAULT` still correctly identifies the protocol fault; the explanation now limits recovery claims to stored answers.

- **K4-F7 — P2, reasoned; reported.** Mirror’s blocked failure persists after comments change, hiding its sole control until the sub-mode is re-entered. That documented escape works, but makes the narrower-request remedy harder to discover. Changing the hook’s response to comment edits requires `useMirror.ts`, outside this cluster.

- **K4-F8 — P1, established; fixed.** Search counts switched-on failures while displaying unchecked searches too. Two red-first cases showed “each row above” describing the opposite policy on an unchecked row. All three variants now explicitly describe switched-on searches.

A matching stored purpose need not have been stored by this particular press: it still satisfies the requested planning action. I found no duplicate `ensure()` path. The textarea line-ending probe also matched server normalisation.

Nine added regression cases were seen red, then green. **260 tests passed across 14 individually invoked files.** Typechecking passed through `node --import tsx scripts/typecheck.ts`; the npm wrapper encountered a sandbox IPC restriction. Lint reported only complexity advice. Browser measurements were not independently repeated.

Changes cover Skim, purpose confirmation, Search’s hints, the stream comment, two test files, and the candidate docs. Findings and root causes are recorded in the [candidate plan](/var/tmp/spideryarn-worktrees/agent-a1808d25fe65f8be3/docs/plans/261007a-ui-sweep-k4-failure-sentences-and-panel-states.md:242).

**not ready**