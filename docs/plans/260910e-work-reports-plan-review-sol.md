### Findings

**WR-P1 — P1 — [plan § Decisions reconciliation](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md:129)**

Gate 1 is preserved for the `reviewed` boolean, but not yet for attribution. The existing fold only changes review state for a `reviewed`/`reversed` event whose self-declared `by` is Greg ([decisions.ts](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tools/overseer/decisions.ts:427)), and the browser independently requires a Greg touch. A session decision routed as a `decided` event therefore remains pending review.

However:

- The inbox actor is self-declared, and the plan does not require the bridge to reject Greg/Overseer actors.
- `by` has no daemon value. Writing `by: "overseer"` would say the reasoning Overseer recorded a line that an unexamining daemon actually copied.
- `gregAsked: "asked-and-answered"` is another self-declared field which can visually resemble Greg’s approval.
- Folding every V1 line as `author: overseer` is false for at least assumptions made under Greg’s standing decision; the existing source explicitly warns that calling those Overseer decisions would be false ([decisions.ts](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tools/overseer/decisions.ts:42)).

Restrict the report bridge to session-authored decisions; keep Greg/Overseer decisions on the existing decision CLI. Add `daemon` as the recorder, represent V1 authors as `legacy-unknown` or separate “origin” from “decider,” and render `gregAsked` explicitly as the author’s claim. Only a Greg-authored event should establish that Greg answered or reviewed.

**WR-P2 — P1 — [plan § “An older reader cannot misread a new line”](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md:147)**

This is true of the old raw JSONL parser but not necessarily of an old browser. The old parser rejects `schema: 2` and creates an `unreadable-line` problem. But the HTTP API is independently schema 1 ([routes-decisions.ts](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tools/fleet/routes-decisions.ts:145)), and the old browser tolerates extra record fields. If the API schema remains 1, it will ignore `author` and display the daemon-created row as merely “recorded by overseer” ([DecisionsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tools/fleet/web/src/DecisionsPanel.tsx:151)).

Bump the decisions API/wire schema as well as the JSONL event schema. Test a frozen copy of both old boundaries: the old event reader must report an unreadable line, and the old browser parser must refuse the new route payload.

**WR-P3 — P1 — [plan § Crash replay and Stage 3](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md:43)**

The cross-log operation is not replay-safe as specified. A decision report contains only `decisionId`; it contains none of the question, options, choice, rationale, advisers, consequence, or other material needed to construct the decision. Also, the daemon computes `receivedAt`, execution and artefact checks during draining. If it crashes after appending the decision, those values may change before retry. `appendEvents` treats a command ID as idempotent only when its full command payload is unchanged ([decisions.ts](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tools/overseer/decisions.ts:893)); the command ID alone does not make a regenerated event safe.

Define separate `ReportSubmission` and `PreparedReportEvent` shapes. A decision submission must carry its decision draft. The daemon should validate and enrich it once, mint/freeze `decisionId`, `decidedAt`, execution, checks and `receivedAt`, then atomically persist that prepared envelope in a processing file before either log append. Every retry must replay those exact bytes. Test changing the register and artefact existence between every crash boundary. Also test that the decision appender honors `OVERSEER_DECISIONS_DIR`, which is separate from `OVERSEER_STORE_DIR`.

**WR-P4 — P1 — [plan § Stale execution](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md:104)**

`submittedAt < verifiedExecution.since` is neither sound nor sufficient. `since` is when the daemon first recorded the run, explicitly a floor rather than its start time ([store.ts](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/tools/overseer/store.ts:399)). A report from the same run submitted before its first verification becomes falsely stale. Conversely, during `verified(A) → unknown → B`, the sticky register can still contain A; a report from B—or a late report from A—can be attached to the wrong run without satisfying the timestamp test.

Have the submitter carry the execution token it observed, where available, and let the daemon compare tokens. The outcomes should be `same verified run`, `different verified run`, and `unverifiable`; absence of a token or a sticky last-verified reading must not become “current.” Timestamp ordering can be supporting evidence, not the identity test.

**WR-P5 — P1 — [plan § File-drop inbox](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md:39)**

The file drop is the simplest durable owner-submission design, especially when the daemon is down for hours, but `≤50` bounds only completed items per tick. It does not bound directory enumeration, per-file bytes, total queued bytes, up to 1,000 artefact probes per drain, disk consumption, or overlapping interval callbacks. The plan also does not say how symlinks, devices, hard links, filename/event-ID disagreement, `.tmp` debris, or lock contention are handled. A refusal stored as an original file plus `.why` has its own crash window.

Keep the spool, but require exact UUID filenames, regular files opened without following symlinks, filename/event-ID equality, a small per-file byte ceiling, per-pass byte/probe/time ceilings, one drain at a time, and shutdown awaiting the active drain. Invalid input may be refused; transient locks or checker failures must remain pending. Store each refusal as one atomically written record. Rely on the daemon’s main `overseer.lock` to exclude a second daemon; `reports.lock` only serializes appends. No filesystem scheme can defend against an intentionally hostile process running as the same Unix user, so state that limit explicitly.

**WR-P6 — P1 — [plan § Untrusted artefacts and record shape](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md:70)**

Only `summary` has a stated text/control-character bound. `needs`, revision strings, job fields, artefact-check reasons, and all new decision prose remain available for oversized records and terminal escape injection. React text interpolation is HTML-safe, and fixed-format IDs are safe, but a path interpolated into `blob/dev/<path>` needs segment encoding. `existsSync` proves only that something exists in the working tree—possibly a symlink outside it—not that the proposed GitHub URL exists. Likewise, `git cat-file -e` proves local object existence, not that the commit is on `origin/dev`.

Apply byte and control-character limits to every text/list field. Use `execFile`/argv, never a shell, and verify commits as commits. Distinguish `found locally` from `published on dev`; only construct a GitHub link for the latter. Check paths against the relevant Git tree or realpath containment and percent-encode every URL segment.

**WR-P7 — P1 — [plan § Reporting convention reaches agents through proposals](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md:171)**

Roadmap checkbox 4 is only half met. Unreported sessions are implemented in the plan, but controlled-job launch prompts are explicitly left as proposals. That is legitimate while Greg’s prompt/re-pin approval is pending, but the stage cannot then claim the checkbox or full acceptance.

Make approved prompt wording and re-pinning a completion gate, or explicitly divide the delivery into “reporting machinery complete” and “convention not activated.” No mandatory AGENTS rule is required for the first delivery.

**WR-P8 — P2 — [plan § Ranking](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md:144)**

Unknown consequence should receive conservative priority, but should not be converted into the factual values `high` and `one-way`. That causes legacy uncertainty to outrank known high-but-costly decisions and obscures why it ranked there.

Keep `not-recorded` as an explicit value and assign it an explicit sort bucket—for example, after known high/one-way and before medium—while displaying it as unknown. This preserves conservative triage without manufacturing facts.

**WR-P9 — P2 — [plan § Corrections and test list](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md:116)**

A later `progress` report does not necessarily contradict `completed`, especially when the completion ending was `important-work-left`; work may also have resumed. Inferring semantic disagreement from event kinds creates another unearned claim.

Reserve “corrected” or “disagrees” for explicit `corrects`. Otherwise say only that a later claim exists. Validate that `corrects` names an earlier event and is not self-referential. Expand the test list with daemon-down backlog, queue overflow, non-regular inbox entries, transient decision-lock contention, frozen old-browser compatibility, changed enrichment across replay, URL encoding, terminal escapes, and shutdown during a drain.

### Verdict

**REVISE; no P0, but several P1s must be resolved before building.** Checkbox 2 is met; checkbox 1 is specified only on paper because the decision submission and replay protocol are incomplete; checkbox 3 has the requested fields but not safe attribution or full backward compatibility; checkbox 4 supplies unreported rows but not the controlled-job prompt convention; checkbox 5 names the requested cases but tests an unsound stale rule and omits the important spool/cross-log failures. The file-drop ownership choice itself is sound and probably the simplest durable design. Most importantly, routing through the daemon preserves the existing pending-review fold, but as written it does not yet guarantee that a session decision cannot look like the Overseer’s or Greg’s—particularly to an old browser—and `gregAsked: asked-and-answered` must never be allowed to resemble review.