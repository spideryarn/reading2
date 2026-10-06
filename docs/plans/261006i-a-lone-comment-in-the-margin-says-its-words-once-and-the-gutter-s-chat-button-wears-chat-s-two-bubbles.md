# A lone comment in the margin says its words once, and the gutter's chat button wears Chat's two bubbles

Up: [plans.md](../project/plans.md)

Two reports from Greg (an admin; `feedback-reporter.ts` exit 0 on each production row), batched as
Overseer queue entry `qi-zgk3bfxt` because both are about comments and chats beside the prose.
Session `fbe0-dz-bookmark-twice-gutter-chat-icon`. Both were filed on
`2608-13566v1-spya-yurten`, `?mode=citations&margin=1&diagram=illustrated&at=spya-es0zf6`.

**`spya-a0wpv4`**, 2026-10-06 14:38 UTC, Sentry SPIDERYARN-READING2-E0, with a screenshot:

> No need to repeat this bookmark-comment - see screenshot

**`spya-vj7wv0`**, 2026-10-06 14:37 UTC, Sentry SPIDERYARN-READING2-DZ:

> In the vertical gutter next to blocks, change the comment icon to a chat icon (because that's
> really what it is)

Prior work checked (plans, user-feedback notes, `git log origin/dev`, `gjd-remote ls`): nothing has
touched either. The only session carrying these ids is this one. The nearest relative is
[`spya-f6dpj5`](../user-feedback/261004_1700-a-question-in-the-margin-says-its-title-twice.md),
which is the same bug one case over, and is why this one has a name below.

## 1. The comment said twice

### What the screenshot shows

Read from the `screenshot` column of the production row (read-only). It is the Marginalia column
beside a block with the filled bookmark in its gutter. One opened line:

```
▾ COMMENT  Could this be catastrophic forgetting, or just
           poorly-executed fine-tuning?
  Could this be catastrophic forgetting, or just
  poorly-executed fine-tuning?
```

The first copy is the line itself; the second is its open half.

### The cause, and its class

`CommentNote` in `src/web/marginalia/MarginaliaColumn.tsx`. A block's comments are one shut line.
With one comment, the line is the comment's own words, cut to one line. Pressing it sets
`data-open`, and `marginalia.css` then lets the line wrap, so the line already shows the whole
comment. The open half prints `e.comment.body` under it regardless.

The class: **a shut line that un-truncates when opened, and an open half that repeats it.** It
arrived with the un-truncating rule (`spya-qcgyb0`, plan 261003b: *"the FAQ question is still
truncated"*), whose CSS comment says *"the open half does not say it again"*. That was true of FAQ,
Citations and Debate, which guard their heads with `!only`. A question got its guard on 2026-10-04
(261004k § 7). A comment's body never did, because the body was not a "head": it was the content.

### The change

In the open half of a **lone** comment, leave the body out: the line above is it. Everything else
stays:

| the block has | shut line | open half, before | open half, after |
|---|---|---|---|
| one comment, words only | *Comment* + the words | the words again | nothing |
| one comment, words and a stored AI answer | *Comment + AI* + the words | the words, the answer | the answer |
| one comment, no words, an answer | *Comment + AI* + "AI answer" | the answer | the answer (unchanged) |
| several | *Yours* + "2 comments" | each: its stamp, its words, its answer | unchanged |

The guard is on the body's own presence in the line (`only && e.comment.body`), which is exactly
when `entryLine` returned the body, so the two cannot drift apart: the body is in the line or in
the open half, never both and never neither.

### The decision this forces: a line whose open half is empty

After the change a lone comment with only words opens to nothing below it. The press still does
something for a comment longer than one line: it un-truncates it. Three ways to treat that, and the
one taken:

- **Taken: it stays a button, and the empty panel takes no room.** The press wraps and unwraps the
  line. The panel is in the DOM (it is what `aria-controls` names) and is empty, so
  `.marg-open:empty { display: none }` removes its padding. For a comment that fits on one line the
  press turns the chevron and changes nothing else. That is a small wart and is accepted: knowing
  whether the line is cut needs a measurement after layout, in a column whose width changes, for a
  chevron.
- Not taken: draw a lone words-only comment as plain text with no button (`ShutNote`'s
  `children === null` arm). Then a long comment is cut at one line with no way to read the rest, or
  is always shown whole and the margin stops being "default-collapsed" (Greg, report 82).
- Not taken: give the open half something new to hold, such as *Open the comment* to edit it. That
  is a new feature nobody asked for; a press on the gutter's bookmark already opens the comment.

### Test, red first

`tests/marginalia-shut-notes.test.tsx`:

- a lone comment, opened, contains its words **once** (red today: twice), and its button is
  `aria-expanded="true"`;
- a lone comment with words and an answer, opened, has the words once and the answer in
  `.marg-open-answer`;
- two comments on one block, opened, still show each one's words in the open half (a guard, green
  before and after: the fix must not take the body from a row that needs it);
- the stylesheet hides an empty `.marg-open`.

The existing *"opens a reader's comment to the whole of it"* asserts the body is inside
`.marg-open`. That is the behaviour being removed, so it is rewritten as the first test above.

## 2. The gutter's chat button

### What it is

`BlockGutter.tsx` § `.block-chat`. Its tooltip and accessible name already say what it does:
*"Chat with the AI about this paragraph"*, or *"Open a conversation with the AI about this
paragraph (3 total)"*. A press opens a chat (`chat_threads`), never a comment. Only the glyph says
otherwise: lucide's `MessageSquare`, one square speech bubble, which reads as "comment" everywhere
else on the web. Chat mode's own icon is `MessagesSquare`, two bubbles (`src/web/mode-icons.ts`).

So the label and the tooltip stay, and the glyph changes to `MessagesSquare`.

### How far it goes

The one bubble is not only in the gutter. The code has been keeping an unwritten rule: two bubbles
for Chat's band, one bubble for a conversation opened beside the prose. `OriginChat.tsx` says its
mark *"wears the floating chat's icon … (docs/project/icons.md)"*, and icons.md has no such
sentence. No plan records Greg choosing the split (searched 261004k, 261005i, 261006d).

If only the gutter changes, the button with two bubbles opens a card headed with one. So the
change is made to **every place the one bubble means "a chat"**, and the rule becomes one sentence:
*a chat is two bubbles, wherever it is.*

| where | what it is | before | after |
|---|---|---|---|
| `BlockGutter.tsx` `.block-chat` | the gutter button (the report) | `MessageSquare` | `MessagesSquare` |
| `ChatDialog.tsx`, the header label and the shut card's head | the card that button opens | `MessageSquare` | `MessagesSquare` |
| `OriginChat.tsx` `OriginChatMark` | the way back to a chat started from a Glossary entry, a cited work or a Debate claim | `MessageSquare` | `MessagesSquare` |
| `DebatePanel.tsx` `.dbt-angle` | the way back to a chat about an angle | `MessageSquare` | `MessagesSquare` |
| `SimplePanel.tsx` `.simple-ask` | *Ask about this paragraph in chat* | `MessageSquare` | `MessagesSquare` |

Left alone, because they are not chats: `MessageSquareText` on the bar's Comments button,
`MessageCircle` for a comment count on the shelf and the Metadata page, `MessageSquarePlus` (new
conversation, and the comment box), `MessageSquareWarning` (Feedback), `MessageCircleQuestionMark`
(Quiz, FAQ).

**The simpler option passed over:** change the gutter's one line and nothing else. It is what the
report's words name. It was passed over because it leaves the button and the thing it opens
wearing different glyphs, and leaves the unwritten two-glyph rule in place with one more exception
to it. The wider change is five one-token edits and has no behaviour in it. If Greg wanted the
split kept elsewhere, each of the other four rows is one token to put back.

One thing it gives up: in Glossary and Citations, *Ask in chat* (starts a chat) and the mark beside
it (reopens one) now share a glyph. They are still told apart by what is next to the glyph: the
words *Ask in chat* on one, a count and the answer's first words on the other.

### Docs and tests

- `docs/project/icons.md` gets the rule, since `OriginChat.tsx` already cites it there.
- `docs/project/comments.md` calls the button *"the gutter's speech bubble"*; it becomes *"the
  gutter's chat button"*.
- Comments in the five files that say "the floating chat's icon" or "speech bubble" are corrected.
- A test in `tests/block-gutter.test.tsx` that the chat button draws Chat mode's own icon
  (`MODE_ICON.chat`), red first. And one source-level test that no file under `src/web/` imports
  the bare `MessageSquare`, so the next chat control cannot bring the one bubble back unnoticed.

## Not done, and why nothing is queued for it

Nothing is deferred. The Comments drawer was checked for the same repeat and does not have it (a
row there is one preview line and a press opens the comment's own box: `Dock.tsx`).

## Questions and assumptions

- **"bookmark-comment"** is read as: a comment made from the gutter's bookmark, which is what the
  screenshot shows (the filled bookmark beside the block, a *Comment* line in the margin). The fix
  covers every lone comment, however it was made, since they are drawn by the same code.
- **The wider icon change** is an assumption about what Greg would want, argued above. It is the
  part most worth his eye.

## What the plan review changed

GPT Sol, *build with changes*
([findings](261006i-margin-comment-once-gutter-chat-icon-plan-review-sol.md)). Each was checked
against the code.

1. **F1, taken: no empty panel.** The plan's `.marg-open:empty` could not have matched, because
   the open half always wraps each item in a `.marg-open-item`. Sol also found that
   `.marg-open { display: grid }` outranks the browser's `[hidden]` rule, so a shut panel has
   been keeping its padding all along. So § 1's "taken" option is built differently from how it
   is written above: `ShutNote` has a `lineOnly` shape, a button with `aria-expanded` and
   **no panel and no `aria-controls`**, and `.marg-open[hidden] { display: none }` is added for
   the real panels. A lone comment now has three shapes, decided by what is left once its words
   are in the line:

   | a lone comment with | drawn as |
   |---|---|
   | an answer (with or without words) | a line that opens a panel holding the answer |
   | words only | a line that a press wraps and unwraps; no panel |
   | neither (a wordless *Ask AI*) | plain text, nothing to press. It used to be a button that opened to an empty box |

   Its tests were added: a visitor's `PublicComment`, the wordless case, the absent panel.
2. **F2, not taken: the icon stays wide.** Sol would change only the gutter and `SimplePanel`,
   keeping one bubble for "one conversation reopened beside the mode". Opus was asked to
   arbitrate and picked the wide change, on a point neither of us had made: **the one bubble is
   already this app's comment family** (`MessageSquareText` on the bar's Comments button,
   `MessageSquarePlus` on the comment box), so Greg's "comment icon" applies to every bare
   one-bubble site, not to the gutter alone. Also: the split was not being kept (`SimplePanel`
   enters Chat mode and wore one bubble), and the narrow version leaves the gutter's button and
   the card it opens in different glyphs. Sol confirmed that no site was missed, none is a
   non-chat, and no two identical glyphs end up side by side.
3. **F3, taken: no ban on the import.** The test names the five files and asks each to draw two
   bubbles and not one, and the gutter's is asked of the DOM as well.
4. **F4, taken: a wrong sentence above.** Debate does not guard its headline with `!only`; it
   repeats it on purpose, as the link. Citations repeats a bare title so the note never opens to
   nothing. Only FAQ and a question leave the line's words out. The diagnosis of the comment is
   unaffected.

Opus also noted two places that still cross the two families, left alone and written into
icons.md: Chat's *New conversation* wears `MessageSquarePlus`, and the Metadata page's Debate row
wears `MessagesSquare` while Debate's mode icon is `Globe`. Neither is in either report.

## What the code review changed

GPT Sol, *ship with the fixes made*
([findings](261006i-margin-comment-once-gutter-chat-icon-code-review-sol.md)). It fixed four
things in place, and each was read and kept:

1. The line-only button no longer carries `aria-expanded`. It has no panel, and a screen reader
   already gets the whole comment from the line: the cut is visual. So the wrap is a visual state
   (`data-open`) and nothing is announced that is not there.
2. The icon test now cuts each of the six drawn sites out of its file and asks for two bubbles
   inside that control. Asked of a whole file, `OriginChat.tsx` and `DebatePanel.tsx` would have
   passed on a different two-bubble button.
3. Two tests added: a lone comment that is only an answer opens a non-empty panel, and
   `.marg-open[hidden]` is checked as a computed `display`, with the stylesheet loaded, not as text.
4. Two stale sentences: `/help` told readers to look for *"the small speech bubble"*, and a comment
   in `BlockGutter.tsx` argued from the old split.

It reported nothing wider.

## Browser check

A Sonnet subagent, Playwright against this worktree's dev server, local article
`foundermode-spya-kchue4`, 1440 wide.

| | long comment | short comment |
|---|---|---|
| times its words occur in the line's element, shut and open | 1 and 1 | 1 and 1 |
| a `.marg-open` panel | none | none |
| the label's `white-space`, shut then open | `nowrap` then `normal` | same |
| height, shut then open | 24px then 75px | 24px then 24px |

Pressed again, both return to one cut line. The gutter's button and the card's head both draw
`lucide-messages-square`. No console errors. Shots:
[1](261006i-shot-1-long-comment-shut.png), [2](261006i-shot-2-long-comment-open.png),
[3](261006i-shot-3-gutter-chat-icon.png), [4](261006i-shot-4-chat-card-head.png).

Not checked in the browser: a real panel being `display: none` while shut (that article had no
FAQ, citation or Debate line; the jsdom test above covers it), and a phone, where the margin column
is not drawn.

One thing seen and not followed up: Escape did not close the block's chat card in that run. It was
seen once and not retried, so it may be the script's focus and not a bug. This change is a glyph
and cannot have caused it.

## Reviews

- Plan review, GPT Sol: `261006i-margin-comment-once-gutter-chat-icon-plan-review-sol.md`
- Code review, GPT Sol: `261006i-margin-comment-once-gutter-chat-icon-code-review-sol.md`
