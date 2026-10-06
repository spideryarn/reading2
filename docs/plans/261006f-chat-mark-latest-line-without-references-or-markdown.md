# 261006f — A chat's mark shows its latest answer in plain words, without `[spya-…]` or markdown

Up: [plans.md](../project/plans.md) · queue item `qi-ezpyknnv` · the known gap in
[261005i](261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md) and in
[261006d](261006d-glossary-and-citations-ask-in-chat-with-origin.md) § Log

**Status as of 2026-10-06: built, reviewed by GPT Sol (plan and code), checked in a browser at three
widths, and on `dev`; not deployed.**

## The defect

The mark under a Debate claim, a Glossary entry and a Citations row (`OriginChatMark`,
`src/web/OriginChat.tsx`) shows how the chat's latest answer begins. The line is the answer's raw
source text, so the reader sees the model's block references and its markdown:

```
 💬 2 · **Qualia** are the felt qualities of experience [spya-k3m9qt].      ← now
 💬 2 · Qualia are the felt qualities of experience.                       ← wanted
```

Glossary and Citations answers cite a block in their first sentence, so it shows on nearly every
mark.

## Where the line comes from (read on `2c811b99`)

- **One producer.** `summarise` in `src/routes.ts` cuts `lastLine` as the first line of the newest
  finished answer's raw text. Nothing in the browser writes `lastLine`; the mark updates when
  `Reader` refetches the summaries.
- **Three readers of `lastLine`**: `OriginChatMark`, and through `useChatAnchors.ts` the gutter
  chat chip's hover and `AskedQuestion` (which the Comments drawer deliberately does not draw).
  All three want plain words.
- **A second producer of the same cut**: `cardLine` in `src/web/ChatDialog.tsx`, the collapsed
  floating chat's second line. Its comment says it is "the cut `summarise` makes", and it reads
  the live transcript in the browser. It has the same defect.
- `withoutBlockIds` in `src/live.ts` already takes block references out of prose, protects URLs,
  and tidies the holes. It is pure but lives in a server module.
- Chat answers are parsed with `mdast-util-from-markdown` (`src/web/Cited.tsx`). A hand-rolled
  inline markdown parser was removed on 2026-08-31 (`src/web/citations.ts` header).

## The change

One pure function, used by both producers:

```ts
// src/answer-opening.ts
/** How an answer begins, in plain words: no markdown, no block references. */
export function answerOpening(text: string): string | undefined
```

1. Parse `text` with `fromMarkdown` (the parser the reader's own view of the answer uses).
2. Walk the top-level nodes in order. Flatten each to its words: `text` and `inlineCode` values;
   a link's label; an image's alt; a list's first item; a `break` as a newline; `html`,
   `thematicBreak` and `definition` as nothing.
3. Take the first line of that, run `withoutBlockIds` over it, and return the first one that still
   has words. `undefined` when no node has any.

So a first line that is only a heading marker, a rule, or a lone citation no longer produces an
empty or noise line: the next node with words is used. The existing rule holds: the field is
omitted, not blanked.

- `withoutBlockIds` moves into `src/answer-opening.ts`; `src/live.ts` imports it from there and
  re-exports it, so `live-gpt.ts`, `routes.ts` and `tests/live-seed.test.ts` do not change.
- `summarise` and `cardLine` both call `answerOpening`. `cardLine` keeps its own loop (it reads
  unfinished answers too, on purpose).

No schema change, no API shape change, no CSS change. The clip to one line stays in CSS.

## Passed over

- **Strip in `OriginChatMark` at draw time.** One component fewer to touch on the server, but it
  sees only the first raw line, so a first line of `## Answer` or `[spya-k3m9qt]` strips to
  nothing and the mark would say *No answer yet* over a finished answer. It also leaves the gutter
  chip and the collapsed card with the defect.
- **Regexes for the markdown.** The repo removed its hand-rolled markdown parser for being wrong at
  the edges; a second one for this would disagree with what the reader sees in the chat.
- **Leaving `cardLine` alone.** It is the same cut with the same defect, and sharing the function
  costs one import.

## Stage (one)

- [ ] `tests/answer-opening.test.ts`, red first: bold/italic/code/link/heading/list/blockquote
      markers gone; `[spya-…]` and bare ids gone with tidy punctuation; an id inside a URL kept; a
      first node with no words skipped; nothing but references gives `undefined`; plain prose
      unchanged; first line only.
- [ ] A test through the chats route that `lastLine` is the plain opening (red first), and one
      that the collapsed card's line is (red first).
- [ ] `npm test` on the touched files, `npm run typecheck`, lint on the touched files.
- [ ] GPT Sol code review. Browser check at 1440, 820 and 390: the mark under a Glossary entry and
      a Citations row, the collapsed floating chat.
- [ ] `docs/project/chat-tools.md` or the doc that owns `lastLine`, if one states the cut.

## Log

- 2026-10-06 — **GPT Sol's plan review: approve with changes**
  ([261006f-chat-mark-plan-review-sol.md](261006f-chat-mark-plan-review-sol.md)). All five taken:
  - F1 (P1): a line with no words is skipped *inside* a paragraph too, not only between blocks.
    `[spya-k3m9qt]\nThe answer is yes.` is one paragraph, and would have said *No answer yet*.
  - F2: a code block gives its own characters.
  - F3: `summarise` cuts the answer **as the reader saw it** (`answerAsSeen`), so a Learn answer's
    unopened hint is never the preview. And raw HTML gives its own characters instead of nothing,
    which is what the chat draws for it (`Cited.tsx` § `sourceOf`); the plan's "html as nothing" in
    § The change, step 2, is superseded. `cardLine` does not need the hint rule: the floating chat
    never draws a Learn thread.
  - F4: the walk stops reading structure at depth 12, the cap `Cited.tsx` has for the same reason.
  - F5: the reader inventory above overstates it. The gutter chip's hover shows a count, and
    `AskedQuestion` carries `lastLine` unused. `OriginChatMark` is the one reader that draws it.
- 2026-10-06 — **built**, tests red first (8 red against the old cut, then the hint test red
  without `answerAsSeen`). `src/answer-opening.ts` is new and holds `answerOpening` and
  `withoutBlockIds` (moved from `src/live.ts`, which re-exports it). `summarise` is exported from
  `src/routes.ts` so its test needs no database. Two test files keep their own copy of the old cut
  in a stubbed server (`tests/debate-check-claim-in-chat.test.tsx`,
  `tests/glossary-and-citations-ask-in-chat.test.tsx`); left alone, since neither asserts on
  markdown.
- 2026-10-06 — **GPT Sol's code review: approve with changes**
  ([261006f-chat-mark-code-review-sol.md](261006f-chat-mark-code-review-sol.md)). It fixed F6, F7 and F9 itself, red
  first; I read the diff and kept it. Its postmortem for the two classes is
  [261006j](../postmortems/261006j-flattening-destroys-the-context-a-later-filter-needs.md).
  - F6 (P1): block references were stripped *after* the tree was flattened to a string, so a link's
    label, code and image alt lost id-shaped words, and joining two leaves could make an id that
    was in neither. Now stripped per ordinary text leaf, before joining.
  - F7 (P1): past the depth cap the walk gave back source markdown. The walk is now iterative and
    has no cap, so § Log F4 above is superseded.
  - F8 (P2, reported only): the parser reads the whole answer, 18 ms for 4 KB on the box, once per
    thread on every summaries fetch. **Fixed by me after the review, so Sol has not seen it**:
    `answerOpening` parses only the head, the answer up to the first blank line past 1,000
    characters, and reads the whole answer only when the head has no words. The probe is flat
    at about 3 ms from 4 KB to 512 KB afterwards
    ([261006f-chat-mark-preview-cost-probe.mjs](261006f-chat-mark-preview-cost-probe.mjs)). **The price, pinned by a
    test**: a reference link in the opening whose definition is past the cut shows as
    `[Label][ref]`. Passed over: caching or storing the line, which needs a column and an
    invalidation rule for one line of text.
  - F9 (P3): the doc lines and comments said "first line" and "no markdown" more strongly than is
    true.
- 2026-10-06 — **browser check** (a Sonnet subagent, Playwright, threads seeded in the local
  database and deleted afterwards, no paid call), at 1440, 820 and 390, on the review's fixes
  being written, before the head cut:
  - The mark under a Glossary entry, a Citations row and a Debate claim read
    *Qualia are the felt qualities of experience. They are what Dennett denies.* from an answer
    with bold, italics, a `[spya-…]` and a link; a `## Short answer` answer read *Short answer*.
    One line, clipped, no overflow, at all three widths.
  - Pressing a mark opens the chat with the answer drawn in full, as before.
  - The collapsed card's line read the same, at 1440 only. **Not checked at 820 and 390**: the
    Collapse control exists only for a chat opened beside a Marginalia note, which a mark never
    opens, and the 820 attempt found no control.
  - Screenshots: `261006f-chat-mark-shot-*.png`.
- 2026-10-06 — **the full suite** (71 minutes on a busy box): 38,301 passed, 6 tests and 7 files
  failed. **Two were this work's**, fixed: `src/answer-opening.ts` had to be named on the two
  lists that guard what the browser may import (`tests/client-imports.test.ts`) and where a `$1`
  may appear in the browser's closure (`tests/no-ai-cost-for-readers.test.ts`: it is a regex
  replacement group that moved in with `withoutBlockIds`). The other five ask for
  `npm run build` or `npm run build:fleet`, which this worktree has not run. The suite was not
  re-run in full after the two list entries; the four touched files pass.
