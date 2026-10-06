The job-deadline change is sound. The Realtime projection also appears safe, but its “no clock” justification is too broad. I found no established P0/P1 introduced by the proposed edits. There is one established, pre-existing P1 in GPT-Live accounting, called out separately below.

- **F29 — P2, established: clocks do end live responses by closing sessions.** Realtime’s idle and session caps call Stop at [useLiveConversation.ts:2209](/var/tmp/spideryarn-worktrees/job-deadline-class/src/web/live/useLiveConversation.ts:2209). GPT-Live does likewise at [useGptLive.ts:1256](/var/tmp/spideryarn-worktrees/job-deadline-class/src/web/live/gpt-live/useGptLive.ts:1256); its twenty-minute cap explicitly covers a backend that never finishes. Both engines also have startup and disconnection timers.

  **Smallest correction:** replace the premise with: “No timer sends `response.cancel`. Session caps and connection timers close the conversation; unfinished responses may consequently have no ledger row.” Scope the projection to received **Realtime terminal events**. I found no source path establishing that a timer produces a received Realtime `cancelled` event that this change would misclassify.

- **F30 — P1, established, pre-existing: GPT-Live records failed backend responses as completed.** [delegations.ts:397](/var/tmp/spideryarn-worktrees/job-deadline-class/src/web/live/gpt-live/delegations.ts:397) handles failed and incomplete responses; `ended()` forwards their usage. [useGptLive.ts:631](/var/tmp/spideryarn-worktrees/job-deadline-class/src/web/live/gpt-live/useGptLive.ts:631) sends that through `backendReport`, which carries no status. [live.ts:1676](/var/tmp/spideryarn-worktrees/job-deadline-class/src/live.ts:1676) then writes `ok / completed` unconditionally. A Node probe reproduced a failed response emitting both `usage` and `failed` effects.

  **Smallest fix:** preserve the terminal status through the delegation effect, backend usage report and server projection; map it to the corresponding ledger outcome. Changing Realtime’s response projection does not repair this. It is independent of the candidate, so I would give it its own fix rather than expand this patch silently.

- **F31 — P3, established: `incomplete` needs an explicit explanation.** [REALTIME_OUTCOME](/var/tmp/spideryarn-worktrees/job-deadline-class/src/live.ts:987) already maps it to `aborted`. Classing it as `abort` fits the existing “anything else” definition, but does not mean the reader pressed Stop.

  **Smallest correction:** say on the page that Realtime output-cap/content-filter endings also fall under ordinary stops, outside the stall/deadline counts.

- **F32 — P3, established: the planned function name is stale.** There is no `ledgerRow` in this tree. The shared helper is [ledgerBase](/var/tmp/spideryarn-worktrees/job-deadline-class/src/live.ts:1515), and the response projection is in [acceptRealtimeUsage](/var/tmp/spideryarn-worktrees/job-deadline-class/src/live.ts:1467).

  **Smallest correction:** name `acceptRealtimeUsage` in the plan and tests. Override `failureClass` in its response branch; keep the shared base’s null default.

I found **no job-signal relay that would still lose the deadline reason** after the subclass change:

| Path | Evidence and result |
|---|---|
| Job → step | [jobs.ts:1134](/var/tmp/spideryarn-worktrees/job-deadline-class/src/jobs.ts:1134) passes the original controller signal. |
| Labels | [labels.ts:2593](/var/tmp/spideryarn-worktrees/job-deadline-class/src/labels.ts:2593) composes signals; [labels.ts:2108](/var/tmp/spideryarn-worktrees/job-deadline-class/src/labels.ts:2108) passes the composite to Messages. `fatal.abort()` at line 2895 is sibling cancellation. |
| PDF reading | [pdf-read.ts:3171](/var/tmp/spideryarn-worktrees/job-deadline-class/src/pdf-read.ts:3171) composes signals; line 3209 passes it to the reader, and [line 967](/var/tmp/spideryarn-worktrees/job-deadline-class/src/pdf-read.ts:967) passes it to the gateway. `fatal.abort()` at line 3492 is sibling cancellation. |
| Structure slices | [structure-slices.ts:616](/var/tmp/spideryarn-worktrees/job-deadline-class/src/structure-slices.ts:616) already forwards the reason, including an already-aborted signal; line 628 passes its controller to Messages. |
| Structure deepening | [structure-deepen.ts:1425](/var/tmp/spideryarn-worktrees/job-deadline-class/src/structure-deepen.ts:1425) composes the **waiting** signal. In-flight calls receive the original job signal through [structure.ts:3144](/var/tmp/spideryarn-worktrees/job-deadline-class/src/structure.ts:3144) and [structure-deepen.ts:853](/var/tmp/spideryarn-worktrees/job-deadline-class/src/structure-deepen.ts:853). Its fatal controller stops waiting calls. |
| Simple summaries | [simple-summary.ts:1219](/var/tmp/spideryarn-worktrees/job-deadline-class/src/simple-summary.ts:1219) composes signals and line 1265 passes that composite to Messages. |
| Gateway classification | [ai-call.ts:1568](/var/tmp/spideryarn-worktrees/job-deadline-class/src/ai-call.ts:1568) reads the supplied reason. Messages captures the external reason when its SDK controller aborts at [messages-stream.ts:698](/var/tmp/spideryarn-worktrees/job-deadline-class/src/messages-stream.ts:698), so the SDK’s bare internal abort does not erase it. |

The Node probe confirmed reason identity survives the fatal composite: the current plain job error maps to `abort`; the proposed subclass maps to `deadline`. Wait helpers that manufacture `AbortError` stop admission or backoff; they do not replace an in-flight gateway’s signal.

Subclassing changes `name` from `"Error"` to `"CallDeadlineReached"` unless explicitly restored. The message stays `INTERRUPTED.message`, and both job-specific `instanceof DeadlineReached` checks continue working. [log.ts:101](/var/tmp/spideryarn-worktrees/job-deadline-class/src/log.ts:101) exposes the changed name through `errorFields`, and stack headings change too. I found no name-based job decision or fixed-name deadline test that would break. Reader copy is selected independently at [jobs.ts:1463](/var/tmp/spideryarn-worktrees/job-deadline-class/src/jobs.ts:1463). Setting `this.name = "Error"` is the smallest way to preserve the existing diagnostic contract.

The live cancellation/accounting paths are:

| Trigger | Resulting ledger behaviour |
|---|---|
| Realtime reader speech interrupts the model | Received `response.done`: cancelled/incomplete → `aborted`; failed → `error`; completed → `ok`. |
| Realtime Stop, reconnect, microphone handoff, page exit/unmount, thread movement, append refusal, provider failure, dead microphone/channel/connection | Ordinary Stop drains conversation exchanges, then closes channel/peer at [lines 1439 and 1447](/var/tmp/spideryarn-worktrees/job-deadline-class/src/web/live/useLiveConversation.ts:1439). Terminal events received during grace can produce rows; teardown synthesizes no abort row. |
| Realtime startup, disconnection, idle and session timers | Same shutdown path. An unfinished response can disappear without a row. |
| GPT-Live Stop and corresponding lifecycle/failure triggers | Sends `session.close`, waits up to three seconds, then closes channel/peer at [useGptLive.ts:840](/var/tmp/spideryarn-worktrees/job-deadline-class/src/web/live/gpt-live/useGptLive.ts:840). Final voice seconds produce an `ok` accounting row; unfinished backends without terminal usage produce no row. |
| GPT-Live startup, disconnection, idle and session timers | Same shutdown path and accounting limitations. |
| Abandoned startup in either engine | Local attempt resources close; no response-abort row is synthesized. |
| Tool timeout in either engine | Aborts the browser tool request, not the live response directly. [routes.ts:4431](/var/tmp/spideryarn-worktrees/job-deadline-class/src/routes.ts:4431) does not forward that browser signal to `runTool`. |
| Engine switch or disabling GPT-Live | Stops the old engine through its ordinary shutdown path. |
| Server live-close endpoint | [routes.ts:4386](/var/tmp/spideryarn-worktrees/job-deadline-class/src/routes.ts:4386) updates the session journal; it does not cancel the provider or create a terminal ledger row. |
| Server accounting deadline | [live.ts:1423](/var/tmp/spideryarn-worktrees/job-deadline-class/src/live.ts:1423) rejects late reports; it does not stop responses. |

Neither stall detector sends a cancellation command. There is no `response.cancel` emission under `src/web/live/`.

**A class without a phase is safe for this proposed `abort` shape.** `AiCallRow` makes the columns independently nullable; the database constrains phase values, not paired nullability. The folds count the class independently, the causes table excludes null phases, and the analysis/two-read comparison preserves class and phase as separate dimensions. The Node probe returned zero stalls/deadlines, null part-way-death measurement and no causes for `abort / null`.

The new zero is therefore valid **for classified, recorded stops**. It cannot establish that no live response timed out: session closures can omit rows, GPT-Live has F30, and historical job deadlines remain classified as `abort`. Mixed historical null-class stops remain visible through `stopsNotClassified`; the probe confirmed that behaviour. Keep these coverage limits explicit.

The subclass and response-branch override are the simplest useful changes. Neither needs a new label or migration.

No files changed. `tests/cost-cube.test.ts` could not start because Vite could not create `node_modules/.vite-temp`; the Node probes completed successfully.

VERDICT: build it