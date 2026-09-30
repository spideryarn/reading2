## Recommendation

Ship **1a + 2a** first.

Ask for intent during import, save it before queuing generated modes, and let the existing purpose-aware Quotes and Trajectory produce the first intent-shaped route. Do not build 2b yet. Greg framed custom trajectories as a tentative follow-up; the product already contains an untested simpler answer to the core feedback.

Add one small bridge: in Trajectory, show “This route is shaped around: …” with an Edit action. When no purpose exists, offer an inline “What do you want from this article?” field before manually planning a route. Also offer “Find passages about something else…” as a clearly labelled shortcut into existing meaning search. That tests demand for custom walks without creating another route type.

## Why not 2b yet

2b is substantially less reusable than it appears:

- Trajectory navigation, URLs, marks, doors, cards, and tests all assume `quoteId`; Search uses `blockId + quote`, with `start` only as a matching hint.
- Saved searches are capped at 30 and currently published to visitors—including the reader-written criterion. Automatically storing the private purpose as a SearchRun would disclose it on public articles.
- The owner’s saved-search load currently does not always receive the article fingerprint, so freshness is not reliably known until another search begins.
- It adds another 15–40-second, few-cents call to an already expensive automatic import path.
- Search reasoning says why something matched; Trajectory cues deliberately tell readers what to look for. Those are close, but not identical reading roles.

First test whether intent-shaped Quotes plus the existing route actually miss narrow purposes often. If they do, that is strong evidence for a whole-article focus walk.

## Future 2b UI

Do not put “Your question” beside **Gist · More · Most**. Depth and intent are orthogonal.

Use:

```text
Route:  Whole paper | Your question
        Gist · More · Most
```

When “Your question” is selected, replace the depth control with its question and one focused pass. Start with one purpose-derived walk and one editable question; defer multiple named/saved custom trajectories.

For its ordering, use the existing Search idea of **confidence threshold, then paper order**. That preserves argumentative context. Keep confidence-order available in Search, but do not make a reading walk ricochet around merely because scores differ slightly. If paper order proves incoherent, a later route-planning call can order the filtered hits.

## Import interaction

The completion behavior should be deterministic:

- Intent untouched and empty: preserve today’s behavior—queue modes and open automatically.
- Field focused, touched, composing text, or non-empty: when import finishes, change progress to **Ready** and wait indefinitely.
- Present **Save & open** and **Open without adding an intent**. Do not interpret blur or a pause as completion.
- On Save & open: await the purpose PATCH successfully, then queue auto modes, then navigate.
- If saving fails, remain on the page with the draft intact; do not queue unprofiled modes.
- Apply this to URL imports, uploads, and “article already exists” completion paths.

Explain beside the field: “This shapes Quotes, Ideas, summaries, and your reading route.” Keep “About you” separate.

## Is 1b needed?

Not as a general first-open card in v1. It adds dismissal state and still produces the stale/rebuild problem 1a avoids.

The targeted Trajectory prompt is enough for older shelf articles and people who skipped the import question. Defer a reading-view-wide prompt until evidence shows readers commonly skip 1a or never enter Trajectory. If added later, store dismissal server-side; per-device `localStorage` will repeatedly ask the same owner on another device.

## Traps to design explicitly

- **Purpose edited later:** do not auto-spend. Mark outputs changed and ask. Importantly, “Plan it again” currently forces Trajectory but not profile-changed Quotes or Ideas, so it may plan from candidates chosen for the old purpose. A truthful “Refresh for this purpose” must regenerate Quotes, Ideas, then Trajectory; offer the cheaper route-only replan separately if retained.
- **Article changed:** never walk stale search anchors. Compare a stored article hash on load and offer one deliberate rerun.
- **Public visitors:** never ask for or reveal the owner’s purpose. A future purpose-derived SearchRun needs private visibility or a separate focus-route artefact; the existing public search DTO exposes `criterion`.
- **Augment, don’t replace:** every focus stop should land on exact prose; cues should say what to inspect, not supply the answer. Keep snippets short and the article as the destination.
- **Cost:** generate any future focus walk on demand, not automatically during every import.