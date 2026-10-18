# Plan review: the guide may open web pages, as Chat does (261017e § Stage 2, now 2B)

You are reviewing a plan, read-only. Repo: this worktree (Spideryarn, an AI-assisted reading app).

## What this is

`docs/plans/261017e-bring-a-web-page-into-chat.md` § "Stage 2 — 2B: the guide may open a page, as
Chat does". Stage 1 is built and not under review. Stage 2 was first planned as 2A (an allowlist of
handed addresses); the product owner, Greg, chose option B on question
`docs/user-feedback/questions/q-g492eq.md` (his reply was "B"): the guide opens any address, as
Chat does, with every check Chat has. The plan section was rewritten for B. Read
`git diff HEAD -- docs/plans/261017e-bring-a-web-page-into-chat.md` to see what A said.

The accepted risk (a hostile article having the guide put About you into a URL it fetches) is
Greg's decision and **not up for review**. What is up for review: does the plan implement B
correctly and completely, and does it miss anything?

## Read

- `src/chat-tools.ts`: `CHAT_TOOLS`' `read_web_page`, `GUIDE_TOOLS`, `GUIDE_TYPED_TOOLS`,
  `toolsFor`, `toolsOf`, `runTool` (the `search_web` per-turn budget and `searchesThisTurn`),
  `readWebPage`, the header comment's rules.
- `src/converse.ts`: `GUIDE_SYSTEM` (YOUR TOOLS, LINKS INTO THE PIECE, QUESTIONS ABOUT WHAT THE
  PIECE SAYS), and how a turn's `ToolContext` is built (`toolContext`), and whether the final
  tool-less round, `ENDS_THE_TURN`, or anything else in the loop assumes the guide has no
  `read_web_page`.
- `src/web-search-subagent.ts` (`canReadPages`).
- `src/live.ts` and anything else using `GUIDE_TOOLS` or `toolsFor("guide")` — must Live stay
  without it?
- Client code that renders a guide's tool runs (labels like "read example.com"): does anything in
  `src/web/` assume a guide turn never has a `read_web_page` run (e.g. source chips, *From the web*,
  the Bring-into-chat button from stage 1 which must stay Chat-only)?
- Tests: `tests/guide-tool-gate.test.ts`, `tests/web-reach-every-kind.test.ts`, and any test
  asserting the guide's tool list or prompt text.
- `evals/chat-web-reach.ts` (the guide cases) and `evals/guide/run.ts`.
- `docs/project/chat-tools.md` (§ The guide, § Security, § Still open, § The eleven),
  `docs/project/security-map.md` (the `src/chat-tools.ts` row), `docs/project/security-risks.md`.

## Questions

1. Is anything that must change missing from the plan (code paths, client, docs, tests)?
2. Is one read a turn implemented right by copying `searchesThisTurn`'s per-`ToolContext` count?
   Does any path build more than one `ToolContext` per turn, or reuse one across turns?
3. Is it right that Chat stays uncapped and Live stays without the tool?
4. Is the eval plan sound for measuring drift, latency and cost? Anything it cannot see?
5. Anything in the "What it risks" section factually wrong about the current code (caps, what the
   guide holds every turn, outbound action counts)?

## Output

Findings numbered F1…, each with severity (P0 blocks, P1 should fix before building, P2 nice to
have), the file and line evidence, and the change you recommend. End with a one-line verdict:
`VERDICT: build as planned` / `VERDICT: build with the P1 fixes` / `VERDICT: replan`.
