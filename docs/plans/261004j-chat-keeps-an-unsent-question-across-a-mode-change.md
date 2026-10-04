# Chat keeps an unsent question across a mode change

Queue item `qi-ja6rdqm8`. Up: [plans.md](../project/plans.md).

## What it is for

A reader types a question into Chat, does not send it, and switches mode — from the command bar,
with Cmd-K from inside the chat box, or with a bar button. When they come back to Chat the box is
empty. The words are gone and nothing said so.

> yes
>
> — Greg, 2026-10-04, answering `[Q-chat-draft-on-mode-change]`: should a question typed but not
> sent survive a mode change and be there when the reader comes back.

## Why it is lost today

Two things die when the mode band unmounts, and the draft depends on both:

1. **The words.** `ChatPanel` holds them in two refs — `drafts` (a `Map` keyed by conversation id)
   and `listDraft` (the box under the conversation list). A ref lives as long as its component, and
   `ConversationBand` and `ChatPanel` unmount on a mode change. `src/web/ChatPanel.tsx` § `drafts`
   says so in its own comment ("so a draft does not survive switching to another mode and back").
2. **The conversation the words were in, when it was new.** A conversation with no message yet
   exists only in this tab: `useChat` builds a new `ChatController` on every mount, so an empty
   conversation goes with the band. `?thread=` keeps its id (it survives a mode switch on purpose),
   and on return it names nothing. So even with the words kept under that id, no composer would
   ever ask for them — the reader lands on the list, or in a freshly minted conversation.

3. **Where Chat was.** `?thread=` is kept across most mode changes, but Recall, Tutorial and
   Explore replace it with their own conversation's id and Quiz clears it. So after a visit to
   Remember, Chat comes back on its list even for a stored conversation, and that conversation's
   composer — the only thing that would read its draft — is not mounted. (F3, F11.)

## What we will build

**Revised after GPT Sol's plan review** (round 1, REFUSE, F1–F6:
[the review](261004j-chat-keeps-an-unsent-question-plan-review-sol.md)). The first version recovered
"any draft whose conversation is missing". Every finding was a case where *missing* did not mean
*never sent*, or where the conversation was not missing but the reader was not put back in it. The
version below is the simpler one Sol proposed, and what was dropped is at the end.

**One small module, `src/web/chat-draft.ts`, the same shape as
[`search-draft.ts`](../../src/web/search-draft.ts)**: a module-level `Map<slug, ChatDrafts>` that
lives as long as the page. That file is the house pattern for exactly this, so it is a second user
of the pattern and not a second mechanism. Sign-out does `location.replace("/")`, which empties
module memory, so one reader cannot meet another's draft.

It holds four things for an article:

| | keyed by | what |
|---|---|---|
| a Chat conversation's unsent words | conversation id | the text, and `fresh`: was the conversation still unsent (no message) when this was written |
| the box under Chat's list | — | one string |
| Remember's unsent words | kind (`recall`, `tutorial`, `explore`) | one string each |
| where Chat was | — | the conversation id that was open, or `null` for the list |

`ChatPanel` reads and writes this instead of its two refs. The composer is still seeded once on
mount and still owns its value, so typing does not repaint the transcript.

**Remember: by kind, not by id (F4).** Each Remember kind has one conversation per article, and the
band already decides which conversation that is — beginning one when there is none, and preferring
a stored one over an empty one. So its draft is keyed by kind and handed to whichever conversation
the band selects. No recovery rule is needed and none exists. Start over clears that kind's draft.

**Chat: put the reader back where they were, then let the composer read its draft.** In
`ConversationBand`, for `kind === "chat"`, once per visit, only when the list has loaded **and did
not fail** (F1), and after the handoff effect (a handed-over question wins):

```
id = where Chat was;  nothing to do if it is the list, or its draft is blank
if `?thread=` already names a listed chat conversation → nothing: the reader chose that one
else if id is among the loaded conversations            → open it (replace `?thread=`)      (F3)
else if its draft is `fresh`                            → startNew(), move the draft, spend the latch
else                                                    → nothing; the words stay in the store (F1, F6)
```

Only the conversation the reader was in is ever recovered, so an older never-sent conversation
cannot take over a valid selection or the list (F2). The list's own box needs no rule: arriving
with a `?thread=` that names nothing draws the list, and its box reads its string.

The third line is what F3 found: visiting Recall or Quiz overwrites or clears `?thread=`, so a
stored conversation's draft was kept but its composer never mounted. Opening it only when a draft
is waiting keeps this change to the size of what Greg asked for.

**`ChatDialog` (F5).** The plan first said a mode change does not unmount it; that was false. Its
conversation arm (not its passage arm) reads and writes the same per-conversation entry, so the
words follow the reader between the mode and the floating dialog, and its delete removes the entry.

### Round 2 (REFUSE, F7–F11), and how each is settled

[The review](261004j-chat-keeps-an-unsent-question-plan-review-2-sol.md). Two rounds is the limit
([engineering-manager.md](../reusable/engineering-manager.md)); none is overruled — all five are
taken, and they are specified here for the build. The code review checks them.

- **F7 — one arrival decision, not two.** The Chat rule above and the existing "no conversations →
  start one" effect become one ordered effect. A non-blank list draft, with the list as where Chat
  was, suppresses the automatic conversation: the reader lands on the list with their words in its
  box. The existing rule's behaviour on a failed load is otherwise left as it is today; only the
  recovery steps are guarded by `!loadFailed`.
- **F8 — Start over does not clear Remember's draft.** Simpler than clearing on success only, and
  it cannot lose words when the delete is refused. Unsent words stay in the box until the reader
  sends or clears them. (This replaces "Start over clears that kind's draft" above.)
- **F9 — `fresh` is "never submitted", and irreversible.** Not a snapshot taken when the text was
  written. The band marks a conversation fresh when it begins it, and revokes that on the first
  typed *or spoken* submission to it, whether or not the draft text changes.
- **F10 — a handed-over question is written into the store once, in the band's handoff effect**,
  not looked up during render. The `seed` prop then has nothing left to do and goes.
- **F11** — § Why it is lost today now says what Recall and Quiz do to `?thread=`.
- **F5's rider** — the dialog's `cancelAndDiscard` path deletes the entry, as `remove` does.
- **Sign-out** — an ordinary sign-out reloads; an auth event from another tab does not. Sol did not
  establish a leak (slugs are unique and Chat is owner-only), and nothing is added for it.

## Deliberately not built

- **Surviving a reload or a closed tab.** In memory only, like the search draft.
- **Keeping the `ChatController` alive across a mode change.** Fewer lines here, but it changes
  when turns in flight, the arrival latch and the list fetch live and die. Passed over for blast
  radius.
- **A never-sent conversation the reader was not in.** Start one, type, close it, open another,
  switch mode: the closed one and its words go, as they do today.
- **A draft whose conversation is missing but was not `fresh`** — the list failed to load, the
  first question's write has not landed yet, another tab deleted it. Nothing is recreated; the
  words stay in the store and reappear if that conversation does.
- **`ChatDialog`'s passage drafts.** Scoped to the dialog, as now.

## Things to check while building

- Sending clears the draft (`onDraft("")` on send — already so in `ChatPanel.tsx` § Composer).
- `leave` (the × on a conversation) still discards an empty conversation with an empty box, deletes
  its entry, and records the list as where Chat was.
- Every delete path — the panel's, the list's, the dialog's — deletes the entry.
- StrictMode's double effect must not start two conversations (the handoff's `taken` guard is the
  model).

## Stages

One stage, one commit.

1. Red tests first, each seen red:
   - `tests/chat-draft.test.ts` — the store.
   - type in a stored conversation's box, unmount the band, mount it again → the words are in the
     box. Same for the list box.
   - **Chat → Recall → Chat and Chat → Quiz → Chat**, with the real `?thread=` rewriting, not only
     an unmount with the URL kept (F3).
   - type in a new, never-sent conversation, unmount, mount → one conversation, the words in its
     box, nothing sent.
   - Recall: type, leave, return → the words are in Recall's box, including when a stored Recall
     conversation has appeared meanwhile (F4).
   - the list fetch fails on return → no new conversation is made (F1).
   - a closed never-sent conversation does not displace the one the reader was in, or the list (F2).
   - a conversation deleted from the dialog does not come back (F5).
   - no stored conversations, the list's box has words, leave, return → the list and the words,
     not a new empty conversation (F7).
   - a spoken exchange revokes `fresh` without the draft changing (F9).
   - an untouched handed-over question survives the round trip, and once cleared stays cleared (F10).
   - Start over refused → the draft is still in the box (F8).
2. The module, `ChatPanel`, `ConversationBand`, `ChatDialog`.
3. Docs: the stale sentences in `ChatPanel.tsx` (§ `drafts`, § `leave`) and in
   `ConversationModes.tsx` (§ the arrival latch) that say a draft does not survive; a line in the
   chat doc that owns the composer; `/help` if it says anything about this.
4. Gates: `npm test`, `npm run typecheck`, lint on touched files; mutate the fix and watch the
   tests go red.
5. GPT Sol code review (fixing), then a browser check at desktop, iPad and phone widths.

Done means: at each width, type without sending in Chat, switch mode by the bar button and by the
command bar, come back, and the words are in the box — for a conversation with history, for a new
one, and for the box under the list.

## What landed

Built as the Round 2 section says, in one stage (commit `0e3633def`), then GPT Sol's fixing code
review ([the review](261004j-chat-keeps-an-unsent-question-code-review-sol.md), APPROVE). It checked
F1–F11 against the code and fixed two more, each red first:

- **F12** — after a failed list fetch, a conversation begun in this tab was on screen but was not
  recorded as where Chat was, so its words were hidden on return.
- **F13** — "never submitted" was revoked only when the send went out, which is after the wait for
  Live to hang up; a follow-up typed in that wait could be recovered into a new conversation
  without its first question. It is revoked the moment the reader submits.

Its write-up of the two is
[the postmortem](../postmortems/261004m-draft-recovery-eligibility-must-follow-accepted-submissions-and-known-local-state.md).

**Left as it was (F14, reasoned, older than this work):** when the server overrules an optimistic
conversation id, the draft stays under the old id. `ChatPanel.tsx` § drafts has always said so.

**Two things that differ from the first sketch:** on a failed list load the old arrival rule still
opens one empty conversation, and a never-submitted conversation's words wait under their old id
for that visit rather than being moved; and the store has no subscription, because nothing renders
from it.

`npm run typecheck` was red throughout on six errors in `src/backfill-registry-facts.ts`, a file
this work does not touch and which is red on the trunk.
