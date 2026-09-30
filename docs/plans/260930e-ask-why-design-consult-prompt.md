# Design consult: "ask why you are reading on first open; a trajectory for that intent"

You are advising, read-only. **Do not change any file.** Repo: the current directory (Spideryarn, an
AI-assisted reading app that augments rather than replaces reading; docs/project/vision.md).

## Greg's words (product owner, verbatim, 2026-09-30)

"So the feedback I keep getting is that people want to come with an intent and perhaps a background,
but a specific focused intent for what they want to get from the paper. So we definitely do want to
ask people that, you know, why are you reading this in a prompt when they first open it. And then, so
the follow-up idea to that is maybe, so they can already use the semantic search, but maybe they
could also, maybe there'd be a way to create custom trajectories. So there'd be a search box in the
trajectory mode to add a new custom trajectory, because that would keep them grounded in the paper,
but also, you know, I don't know, think about whether there's a best of both worlds that somehow
marries the trajectory and search without, or maybe there's a single extra trajectory that's added
that's specific to their reading intent if they provided one."

House rule: simplest v1 first, name the deferred rest.

## What exists today (verified in code)

- `articles.purpose` — "Why you're reading this one", per article, max 600 chars. Edited ONLY on the
  Metadata page (`src/web/Metadata.tsx`, PATCH /api/library/<slug> {purpose}). Joined with the global
  "About you" profile into one rendered profile string (src/profile.ts) that reaches glossary, quotes,
  ideas, tweets, summaries, chat, explain prompts. Semantic search deliberately does NOT get the
  profile (docs/project/reader-profile.md).
- Changing the purpose marks profiled artefacts "profileChanged" (a banner; nothing regenerates by
  itself). Trajectory is stricter: none→some marks the route stale and its banner offers "Plan it
  again".
- Import: the add page (`src/web/AddPage.tsx`, /add/<url>, /add/upload/<id>) shows progress for ~45 s
  median (the hierarchy step), with a default-on tick box "Generate the main modes as soon as it
  opens" (src/web/auto-modes.ts, plan docs/plans/260930c-auto-generate-the-main-modes-after-import.md).
  On completion it navigates to the article and client-side queues jobs: tweets, glossary, quotes,
  ideas, then trajectory (["quotes","ideas","trajectory"]). Jobs resolve the profile+purpose ONCE at
  POST /api/jobs time. So a purpose saved BEFORE those POSTs makes every auto-generated mode written
  for it from the start; saved after, they are all written without it and Trajectory goes stale.
- Trajectory (docs/project/trajectory.md, src/trajectory.ts, src/web/modes/trajectory/TrajectoryMode.tsx,
  src/web/TrajectoryPanel.tsx, src/web/trajectory-route.ts): one model call orders the stored QUOTES
  (only) into a route with depths Gist·More·Most (1|2|3), each stop {quoteId, depth, cue}. Already
  receives the profile+purpose, so a purpose already reshapes the one route. Walking UI: ‹ ›, ← →, a
  "Next stop ›" door in the prose, a flash on arrival, a sparkline, a stop card of other modes'
  material. Stops are keyed on quoteId throughout; prose marks come from the Quotes marks.
- Meaning search (docs/project/search.md, src/search.ts, src/web/useSearch.ts, SearchPanel.tsx): a model
  call over the WHOLE article, ~15–40 s, a few cents, streamed; stored as a SearchRun {query, hits:
  [{blockId, quote, confidence 0–100, reasoning}]} beside the article, capped in count, marked in the
  prose while Search mode is open.

## The options I see

Part 1 — asking:

- **1a.** Ask on the ADD page while the import runs: an optional box "Why are you reading this?". On
  completion: save it to articles.purpose, THEN queue the auto modes, then open. If the reader is
  mid-typing when the import finishes, don't yank them away: wait for them to press Open. Pro: uses
  dead waiting time; every auto-generated mode is written for the intent from the start, no stale
  banners, no second spend. Con: doesn't cover articles already on the shelf, or a reader who skips.
- **1b.** Ask in the READING VIEW on first open by the owner: a small dismissible card when purpose is
  empty and not yet asked. Needs "was asked" state (localStorage per slug, or a column). After
  answering, already-generated modes go stale/profileChanged → rebuild spend.
- **1c.** Both.

Part 2 — a trajectory for the intent:

- **2a.** Nothing new: the purpose already shapes the one route (and Quotes, which are profiled). With
  1a the default route already is the intent route. Con: the route can only stop at Quotes; a
  specific intent ("how did they handle missing data?") may have no quote on it; and the general route
  is replaced, not added to.
- **2b.** A "Your question" pass in Trajectory, built from a MEANING SEARCH over the whole article with
  the purpose as the query: a fourth tab beside Gist·More·Most (or a switch), whose stops are the hits
  (paper order, or confidence order), each stop's cue = the hit's one-line reasoning. A search box in
  that tab lets the reader ask a different question = a custom trajectory; each question is a stored
  SearchRun, so it also shows in Search mode. This marries search (finds anywhere) and trajectory
  (walks it with door/keys/card). Cost: engineering — stops are keyed on quoteId + quote marks today;
  it needs a generalised stop (block + words + cue) and marks for hits.
- **2c.** A second model-planned route over Quotes, planned for the purpose only (a separate
  trajectory artefact). Limited to Quotes.
- **2d.** Put the walk in Search instead: "Walk these ›" in Search mode steps through hits with the
  door and ← →; Trajectory gets a link "Walk your question" that opens Search with the purpose query.
  Less engineering in Trajectory's tight module, but Greg says (2026-09-29) he thinks of Trajectory as
  a main mode he'd mostly stay within.

My leaning: v1 = 1a (+ an in-reading-view ask only inside Trajectory's intent tab when there is no
purpose, so no nagging modal), and 2b, deferring multiple saved custom trajectories.

## What I want from you

1. Is there a better best-of-both-worlds I'm missing? Be concrete.
2. Pick the simplest v1 that genuinely answers Greg, and what to defer. Especially: is 2b worth it in
   v1 vs 2a (+1a) alone? Is a 4th "pass" in the depth control the right UI, or something else?
3. Traps: ordering of the hits, stale searches when the article changes, purpose edited later,
   visitors (public articles — purpose is owner-only), cost, the vision's "augment not replace".
4. For 1a: the interaction when the import finishes mid-typing; and whether 1b is needed in v1.

Read whatever code you need to check my claims. Answer in under 900 words, recommendations first.
