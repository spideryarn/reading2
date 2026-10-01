# 261001q — Chat knows the blocks on screen, and is told not to lean on it

Report **spya-ybnas5** (suggestion, Greg, 2026-10-01):

> I think we might have added something to the chat functionality that it knows which block or
> blocks are visible on the screen. Is that the case? If we haven't, that might be a nice thing to
> add.
>
> But let's not overemphasize it. So maybe the prompt would include the information along with a
> bit of a caveat, e.g. "by the way, here's what's visible on the page, but it may or may not
> relate to the user's messages...".
>
> — Greg, 2026-10-01

## What is already there

Half of it. Chat sends **one** block: `?at=`, read from the address at render time
(`currentAt()` in `src/web/params.ts`, `ConversationModes.tsx`). The server turns it into
`readerPositionLine` (`src/article-prompt.ts`): *"The reader is currently at block spya-…"* — in
the final user message, below the cache breakpoint. So the model knows roughly where the reader
is, but not what they can see, and the line is stated as plain fact with no caveat.

The visible-row machinery already exists for two other features: `src/web/on-screen.ts`
(`rowsOnScreen`, `onScreenIds`, shared by reading time and the band's lit block links).

## What changes

1. **Client: one read at send time.** `blocksOnScreenNow()` in `on-screen.ts` — the same
   `stickyOffset()` / `innerHeight - dockOffset()` window and the same 24px rule
   `OnScreenLinksStyle` uses, done once rather than on every scroll. Read when the reader presses
   Send (and Save on an edit), not at render, so it is what they were looking at.
2. **Only where the prose is actually on screen.** Reader passes `ConversationBand` a getter that
   returns `[]` when `fit.modeW === 0` — the band lies over the prose on a phone, so the rows under
   it are not "visible". Same condition `OnScreenLinksStyle`'s `enabled` uses.
3. **Chat mode only.** Remember's prompt says *"Do not guess at how much they have read from
   anything else"*; a screenful is exactly that kind of hint, so Remember sends nothing new. The
   passage Chat dialog already has its anchor, Candidates sends no position at all, and neither
   changes. The client is the only gate; the server treats the field as context for any kind (see
   *What the server checks*).
4. **Wire: `visible?: string[]`** on the ask and edit bodies of `POST /api/chat/:slug`, beside
   `at`. Through `SendOptions.visible` for a send and an optional last argument for `edit`.
5. **Server: checked, then ordered.** Refused (400) if it is not a list of strings, if it is
   longer than 100, or if sent with a retry (a retry re-asks a stored question, like `kind`).
   Ids the article does not have are **dropped rather than refused** — a tab open across a
   re-extraction should not lose chat over a stale id. What survives is put in article order.
6. **Prompt: one hedged line, replacing the position line when present.**

   ```
   For context only: when they sent this, the reader's screen showed blocks spya-a, spya-b, spya-c.
   Their message may or may not be about these. Use this only to resolve words like "this",
   "here" or "this paragraph"; otherwise ignore it.
   ```

   `visibleBlocksLine` next to `readerPositionLine` in `article-prompt.ts`. When `visible` is
   non-empty it is sent **instead of** the `at` line (the `at` block is almost always one of them,
   and two lines about position, one hedged and one not, would undo the hedge). With no visible
   blocks — a phone, an old tab — the `at` line is sent as today.

   Below the cache breakpoint, so the cached article prefix is untouched.

## What the server checks, and why not more

A client could send `visible` on a Remember thread. It is not refused: it is context, worth nothing
to an attacker (ids of the reader's own article), and refusing it needs the stored kind earlier
than the route has it for this purpose. Written here so it is a decision rather than a gap.

No logging of the ids or anything else from the body — the request path already logs nothing of
the question, and this adds nothing to it.

## The simpler option passed over

**Do nothing new on the client; just hedge the existing `at` line.** Cheaper by most of the diff,
and it answers "don't overemphasise". Passed over because Greg asked for what is *visible*, and a
single top-of-screen block is wrong precisely in the case that matters — "what does the second
paragraph here mean?" when the reader is looking at three of them.

## Checking it

- Unit: `visibleBlocksLine` (empty → `""`; ids appear; caveat present); `buildConverseMessages`
  uses it instead of the `at` line when both are given, and the `at` line alone otherwise; the
  first two messages are byte-identical with and without (cache prefix).
- Route: `visible` reaches `converse` filtered and in article order; a non-list, >100, and
  visible-with-retry are 400s. Each test watched red first.
- Client: `blocksOnScreenNow` against stubbed rects; the band sends `visible` in chat and not in
  Remember (the existing `chat-kind-reaches-the-server` test is the pattern).
- **A small paid check** of the "don't overemphasise" half, through production's `converse`: on
  one article, three questions about the visible passage ("what does this paragraph mean?") and
  three unrelated to it, each with the line. Read whether the unrelated answers get dragged toward
  the visible blocks and whether the deictic ones land on them. A few calls, well under a dollar or
  two; the outputs go in this doc. Not a blind A/B: the question is whether the hedge holds, not
  which wording is better.

## Stages

One stage: build, tests, the paid check, GPT Sol code review, commit, push to `dev`, the feedback
note.

## What the plan review changed (GPT Sol, 2026-10-01, `--sandbox review`)

Verdict "revise before build". Taken:

- **The server enforces chat-only** (finding 4). The claim above that the route lacks the stored
  kind was wrong: `storedKind` is loaded early for the length cap. `visible` on a thread whose kind
  (stored, else requested) is not `chat` is a 400. The *What the server checks* section is
  superseded.
- **Malformed ids are refused, stale ones dropped** (finding 7): `isSpideryarnId` on each.
- **The cap is shared and the client trims to it** (finding 7): `MAX_VISIBLE_BLOCKS` in
  `src/types.ts`, so a dense article on a tall display cannot get Send refused.
- **The visibility test is `proseOnScreen`**, Reader's own (finding 5), not `fit.modeW === 0`:
  a band that has stepped aside leaves the prose visible.
- **Shorter caveat** (finding 6), no longer limited to three example words:
  *"If their message refers to what is on screen, these may help; otherwise ignore them."*
- **A paired check** (finding 6): the same questions with and without the line, repeated.
- **Tests** for article order, stale and malformed ids, chat-only by stored kind, read-at-press
  rather than at render, and the tools-plus-prefix bytes across different screens.
- Reading time shares `rowCache`/`rowsOnScreen` but not `onScreenIds` (finding 8) — noted.

Not taken, and why:

- **A three-state wire (absent / empty / some)** (finding 1). With the band over the prose the
  client sends nothing, and the old `at` line goes exactly as it did before this change. Sol's
  point — that line is unhedged and the prose is hidden — is true of today too; making "nothing
  visible" its own state is more wire for a case Greg did not raise. Lighter is what was asked.
- **Persisting the screen for a retry** (finding 2). A schema change for a limit `at` has always
  had. Written down in chat-tools.md as a known limit.
- **The passage dialog and Live** (finding 3). Scope: Greg's report was from Chat mode; both are
  named in chat-tools.md as deliberately excluded, with what including them would take.

## The paid check: not run

`evals/chat-visible/run.ts` is written (production's `converse`, one article, a fixed six-block
"screen"; four questions about elsewhere in the piece under both arms, twice; three pointing at
the screen under both arms, once; measures the share of cited ids that are on screen). Its first
run on 2026-10-01 got **402 from OpenRouter: the box's dev key is out of credit**, so there is no
measurement yet. Nothing was spent. Run it once credit is back:

    npx tsx evals/chat-visible/run.ts what-if-we-had-bigger-brains-imagining-minds-beyond-ours
