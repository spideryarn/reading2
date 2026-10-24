# Chat links the earlier conversation it mentions

Report `spya-t7cq2s` (#700), a suggestion from Greg (an admin: `feedback-reporter.ts` exit 0, no
addenda), filed 2026-10-24 17:13 UTC from the floating chat on `arxiv-2308-08708-spya-xax6v4`,
thread `spya-ypk02m`:

> This chat references a previous conversation. It would be great if that could include a hyperlink
> that would take me to the previous chat conversation in context.
>
> — Greg, 2026-10-24

## What happened

Since 2026-10-08 every typed Chat question comes with the reader's other conversations about the
article, each with its id, and the model is told to read one that covered the same ground with
`reader_notes` and *"mention the earlier conversation when that helps them"*
([chat-tools.md § The other conversations come with every question](../project/chat-tools.md#the-other-conversations-come-with-every-question)).
On thread `spya-ypk02m` it did, read from production (read-only): the answer opened one earlier
conversation and said *"Your earlier conversation on access consciousness went through the Sperling
evidence and the arguments against it, so I won't repeat that here."* No id, so nothing to press.

The URL Greg filed from has `?thread=` and no `mode=chat`: he was in the floating chat (the margin
card), not Chat's band. Both draw answers through the same `Conversation` → `Answer` →
`CitedMarkdown` path, so both have to get this.

## The design

**The model names the conversation the way it names a passage: its id in square brackets.** A
thread id has a block id's shape (`spya-xxxxxx`, minted by the same `src/ids.ts`), and the
renderer already finds bracketed ids by shape and checks each against a known set
(`splitCitations` in [`citations.ts`](../../src/web/citations.ts)). So:

1. **Prompt** (`SYSTEM` in `src/converse.ts`, the BUILD ON THEIR EARLIER CONVERSATIONS bullet, typed
   Chat only): when you mention an earlier conversation, put its id from the list in square brackets
   straight after the mention, e.g. *"your earlier conversation on access consciousness
   [spya-ab12cd]"*, so the reader can open it. Never invent one; a conversation id is not a block
   id and never stands in for one.
2. **Renderer**: `splitCitations` takes a third known set, the reader's own conversations, and
   yields a new segment `{ kind: "thread", ids }`. `Cited.tsx` draws each as a `ThreadRef` chip: a
   real `<Link>` (so ⌘-click, copy link and the status bar work) labelled with the conversation's
   short title and a speech-bubble icon, `data-tip` *Open your conversation “…”*.
3. **Where a press goes** is an address, not a callback — the same one Back/Forward already handle:
   - a `chat` thread: the current address with `thread=<id>`, mode unchanged. In Chat's band it
     opens there; in the floating chat the dialog switches to it (it is keyed by thread id);
   - the `guide`: `mode=chat&thread=<id>` (Chat's band opens the guide; the dialog only draws chats);
   - a Recall or Explore conversation: `mode=learn&learn=<view>&thread=<id>`, which is what a press
     on a Learn row in Chat's list already does (`threadSource(t).learn`).
   Pushed, not replaced: following a link is a navigation the reader chose, and Back returns them
   to the conversation the link was in — the "in context" half of the request. `?chatfrom=` and
   `?guide=` are dropped from the target; everything else (`at`, `margin`, …) is carried.
4. **Server's counters** (`unknownCitedIds` in `converse.ts`): a linked conversation id is not an
   invented block id. `chatOthers` in `src/routes.ts` returns the eligible thread ids beside the
   section; they are added to what is not "unknown", and the log line gains `citedConversations`, a
   count, so we can see whether the prompt is followed.

### Only the reader's own conversations (security-map.md: a model's output is untrusted)

The model's bracket only **selects** an id. A chip is drawn only for an id in the set built on the
client from the conversations the server listed for this article — `useChat`'s threads, which the
store returns for the signed-in owner only — minus Candidates (never in the model's index either)
and minus the conversation on screen. The href is built from that row's id and kind, never from
anything the model wrote; the label is the stored title, drawn as a React string. An id that is not
in the set stays the characters the model wrote, as an unknown block id does today. An id that is
both a block (or a mentioned article's block) and a conversation is ambiguous and stays text, the
`CrossArticles` rule. Nothing here reaches another reader: a guessed id of someone else's thread is
simply not in the set.

## Scope, and what is passed over

- **Typed Chat only** (band and floating chat), because only Chat's prompt carries the index.
  Explore also sees the reader's conversations (its notes digest) but its panel is handed only its
  own conversation, so it has no set to check against; that would mean passing the list down to
  Learn and a prompt change there. Deferred, with a queue entry.
- **Passed over: a Markdown link** `[earlier conversation](?thread=…)`. That is the model writing an
  address, which is exactly what the untrusted-output rule says not to trust, and it would need a
  second allowlist (`ownLink`) for a shape the citation path already handles.
- **Passed over: a server-side rewrite** of the answer to insert links. The stored answer stays the
  model's words; the renderer decides what is pressable, as for every other citation.
- **Passed over: opening a chat link through the band's `onThread` callback** rather than the
  address. The band already reconciles `?thread=` changes it did not make (Back/Forward:
  `drafts.setDestination` runs from an effect on `thread`), so the address is the one path that
  works in both the band and the floating chat without threading callbacks through `Cited.tsx`.

## Checks

- Unit: `splitCitations` with a thread set — bracketed and bare, mixed with block ids, unknown id,
  ambiguous id, the current thread. The href builder per kind. Watch each go red first.
- Render test: an answer with a thread id in `Conversation` draws a link with the right href.
- `unknownCitedIds` does not count a thread id.
- Eval: `evals/chat-other-threads.ts` re-run; record whether the answer that builds on the earlier
  conversation now brackets its id.
- Browser (Sonnet subagent): fixture article with two chats; ask in the second about the first's
  topic; press the chip in the band and in the floating chat; Back returns.

## Measured

`evals/chat-other-threads.ts --repeats=3`, 2026-10-24, with the new prompt line (fixture thread A's
id changed from `spya-thra11` to `spya-thra33`, since a real id has no `1`). $2.71.

| question | arm | right | opened a wrong one | linked it |
|---|---|---|---|---|
| weak | gist | 3/3 | 0 | 3/3 |
| weak | preview | 3/3 | 0 | 3/3 |
| fn | gist | 3/3 | 0 | 3/3 |
| fn | preview | 3/3 | 0 | 3/3 |
| other (should open nothing) | all three | 3/3 | 0 | – |

Every answer that opened the earlier conversation named it by its bracketed id, e.g. *"Your earlier
conversation [spya-thra33] already gave three weak spots."* The opening behaviour is unchanged from
261008e's figures (3/3, 3/3, 0/3 opened for the unrelated question).

## Progress

- [ ] plan reviewed by GPT Sol
- [ ] built, gates green
- [ ] code reviewed by GPT Sol
- [ ] browser check
- [ ] docs: chat-tools.md, url-state.md; note in docs/user-feedback/
