Verdict: **proceed with changes**. I found no P0 and no present article/URL-driven action exploit, but Stage 1 has several P1 failure paths. The most serious suspicion is confirmed: opening an empty mode after the forced POST can enqueue a second paid run.

## Findings

### F1 — P1 — Established: forced and automatic runs do not deduplicate

The plan relies on the server refusing or joining the automatic unforced run after the forced command ([plan:105](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:105)). The code explicitly promises the opposite:

- `force` is part of the work key, and forced plus unforced requests are two jobs ([useAutoRun.ts:64](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/useAutoRun.ts:64), [jobs.ts:89](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/store/jobs.ts:89)).
- A different job for the same article is queued, not refused ([jobs.ts:3483](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/jobs.ts:3483)).
- `useStepJob` names forced-plus-unforced Glossary as an ordinary two-job case ([useStepJob.ts:363](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/useStepJob.ts:363)).
- Dock activation arms generate-on-open ([Dock.tsx:1518](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Dock.tsx:1518)); Tweets and Arc also start unforced work on arrival/absence ([useTweets.ts:142](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/useTweets.ts:142), [useArc.ts:161](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/useArc.ts:161)).

This is double provider spend, though not double reader quota: bare-slug reruns are free to the reader ([routes.ts:9817](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/routes.ts:9817)). Therefore the plan’s “allowance” and “run already in flight” refusal examples are also false.

**Plan fix:** for the simplest safe v1, after acceptance always navigate to/reveal Metadata’s AI-processing section. Do not open the mode. Direct mode landing needs a deterministic “this accepted job satisfies the automatic run” seam understood by every auto-run implementation; server dedup cannot provide it. Test exactly one POST/job, not merely eventual progress.

### F2 — P1 — Established: the current action protocol cannot await or preserve failure

The plan says Enter awaits the POST and keeps the bar open on refusal ([plan:91](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:91)). Currently:

- `action.run` returns `void` ([command-match.ts:119](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/command-match.ts:119)).
- CommandBar calls it without awaiting and always clears and closes ([CommandBar.tsx:666](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/CommandBar.tsx:666)).
- `useJobs.error` may be cleared immediately by the post-action poll; callers must snapshot `lastFailure()` ([useJobs.ts:342](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/useJobs.ts:342), [useStepJob.ts:645](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/useStepJob.ts:645)).

The same omission would make Export failures invisible after the bar closes.

**Plan fix:** make async action outcomes an explicit discriminated type, for example success versus `stay-open` with a message. While awaiting, synchronously guard repeated Enter/clicks and show a pending state. Read `lastFailure()` immediately when `run()` returns `null`; close only on success.

### F3 — P1 — Established: “rerun glossary” matches no rerun command

The proposed aliases are only generic verbs such as `rerun` and `regenerate`, while the label is `Glossary › Run again` ([plan:84](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:84)). The matcher compares the entire normalized query with one label or alias; it does not tokenize or combine them ([command-match.ts:312](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/command-match.ts:312), [command-match.ts:380](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/command-match.ts:380)).

Thus the plan’s own example, “rerun glossary” ([plan:175](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:175)), produces no rerun row.

Plain `glossary` is fine: the mode and action tie on label-prefix, and modes are earlier, so the mode wins ([CommandBar.tsx:591](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/CommandBar.tsx:591)).

**Plan fix:** generate target-specific compound aliases such as `rerun glossary`, `regenerate glossary`, `glossary again`, and their label synonyms. Add tests for those phrases and for plain `glossary` continuing to select the mode.

### F4 — P1 — Reasoned from established code: Export is duplicated, shadowed, and can silently fail to reveal

The plan adds both an `Export` section command and an `Export this article` action ([plan:109](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:109), [plan:124](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:124)). Both label-prefix-match `export`; whichever is earlier wins by input order. The section row also owns the `download` alias, so the apparently direct verb leads to another button.

That section is not mounted until provenance proves a shelf row exists ([Metadata.tsx:1875](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Metadata.tsx:1875), [Metadata.tsx:1944](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Metadata.tsx:1944)). `reveal()` simply returns `null` when the element is absent ([PageContents.tsx:100](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/PageContents.tsx:100)). Consuming `?section=` immediately would turn a slow metadata read into a press that did nothing.

**Plan fix:** remove Export from the section-command list and keep one direct export action with `export`, `download`, `zip`, and optionally `json` aliases. Generally, consume a section URL only after `reveal()` succeeds; retain/retry it while the target may still mount.

### F5 — P1 — Established contract omission: `section` must enter last-view classification

The plan mentions documenting `?section=`, but not adding it to the client’s recognized article parameters ([plan:112](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:112)).

Every article parameter must be classified as remembered or never remembered ([last-view.ts:63](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/last-view.ts:63), [url-state.md:664](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/project/url-state.md:664)). Otherwise a URL containing only `?section=` is treated as bare and the browser’s remembered mode/state is appended over it.

**Plan fix:** add a validated `sectionParam` with replace history, classify `section` as `NEVER_REMEMBERED`, and test that `/metadata?section=…` suppresses last-view restoration. Removing it with `replace` after a successful reveal is otherwise consistent with URL conventions.

### F6 — P1 — Reasoned from an authoritative contract: Archive has an unknown state the plan omits

The plan specifies a state-dependent Archive/Unarchive row but does not say when the state is unknown ([plan:118](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:118)).

`useArchive` explicitly defines `undefined` as loading or failed and says no button may appear then, because either label could be false ([useArchive.ts:44](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/useArchive.ts:44)). It also has a synchronous in-flight guard ([useArchive.ts:129](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/useArchive.ts:129)).

**Plan fix:** omit the command while `archive.at === undefined` or the page is a fixture; disable it while busy; use the controller’s returned state after the request rather than assuming the requested boolean.

### F7 — P1 — Established: experimental rerun visibility is left contradictory

The plan first says a rerun row for a hidden experimental mode is not offered, then conditionally says to match Metadata ([plan:100](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:100)).

Metadata’s existing decision is unambiguous: experimental visibility does **not** filter rerun rows, because the switch hides mode-bar clutter, not the ability to regenerate existing data ([rerun-steps.ts:88](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/rerun-steps.ts:88), [Metadata.tsx:1473](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Metadata.tsx:1473)).

**Plan fix:** offer all `METADATA_RERUN_STEPS` regardless of the switch. For a currently hidden mode, land in Metadata AI processing rather than implicitly opening an experimental surface. This is already decided; it does not need Greg.

### F8 — P2 — Established: the rerun command metadata has no viable shared home

The new rows need `RERUN_LABEL` and `RERUN_COST_NOTE`, but both are private inside Metadata ([Metadata.tsx:1571](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Metadata.tsx:1571), [Metadata.tsx:1651](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Metadata.tsx:1651)). CommandBar cannot sensibly import them from Metadata: Metadata imports Dock, and Dock imports CommandBar ([Metadata.tsx:267](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Metadata.tsx:267), [Dock.tsx:216](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Dock.tsx:216)).

Copying them would create two sources of truth.

**Plan fix:** make a leaf client-safe rerun-command registry containing step, label, static description, aliases, and destination. Metadata and CommandBar both consume it; Metadata keeps only its dynamic Glossary override locally.

### F9 — P3 — Established: Export downloads a ZIP, not JSON

The plan says the action downloads JSON ([plan:124](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:124)). The existing helper fetches a blob named `<slug>.zip` ([Metadata.tsx:1869](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Metadata.tsx:1869), [Metadata.tsx:1904](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Metadata.tsx:1904)).

**Plan fix:** say “downloads the article’s ZIP export.” Preserve the existing busy guard, browser-compatible anchor flow, URL revocation, and reader-facing server error.

### F10 — P2 — Reasoned: the future model needs descriptors and a trusted dispatcher, not UI closures

The vision calls the command registry the model’s tool list ([plan:156](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md:156)). Today actions are deliberately React closures, while mode and submode commands have no `run` at all ([command-match.ts:17](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/command-match.ts:17), [command-match.ts:119](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/command-match.ts:119)). That runtime array cannot itself be sent to Jev or reused faithfully by an eval.

**Plan fix:** make the vision distinguish:

1. A serializable command descriptor: stable ID, trusted words, argument schema, risk class, and availability.
2. A trusted client dispatcher that resolves a validated ID to the current closure/navigation.
3. A code-enforced confirmation gate for writes and spending.

The model selects IDs and arguments; it never receives authority through a prompt or executes arbitrary names. Stage 4 should evaluate the serializable catalog, not a hand-copied approximation.

## Stage order and product calls

Reruns deserve to remain first because they are the central request, but Stage 1 should be split:

1. Shared command descriptors plus async action outcomes.
2. Rerun commands, initially landing in Metadata AI processing.
3. The cheap deterministic `find <words>` command.
4. Section navigation, Archive, and direct Export.
5. Vision doc, then the optional Jev measurement.

The two questions already sent to Greg are the right genuine product decisions: per-run capable-model billing, and whether a model may act after proposing a command. Dynamic Archive wording is justified; the fixed-label rule is Comments-specific. The one-shot `section` URL is also reasonable once it is classified and consumed only after successful reveal.

The code-facing claims in “What exists” are substantially accurate. The costly false premises occur later: server deduplication/refusal, Export’s format, and the unresolved experimental-mode filtering.