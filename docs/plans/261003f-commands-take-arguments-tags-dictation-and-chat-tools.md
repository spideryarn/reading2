# Commands take arguments, tags and dictation in the bar, and the same actions in chat

Reports: spya-wh2xys (Overseer queue qi-8dzvqm49), and queue item qi-qkjnkwce (the tag command).
From an admin (Greg), so trusted input; `feedback-reporter.ts` exited 0 on the production row.

> The commands panel that pops up where you can jump to things. I'm wondering if we should add more
> to it than that. So, for example, I might want a command to make it public, or a command to
> archive, or a command to regenerate something, or a command to turn on the experimental features
> or off, or something like that. And indeed, those lists of commands, you can imagine some of them
> being disabled. So turning on the experimental features might be disabled if it's already on. I
> don't know. And turning off would be available. […] in an ideal world, it would sort of take
> parameters. So you could say something like, do a search for X within that command bar, rather
> than having to go to search and then type in, or, you know, look up some word in the glossary that
> may or may not already be there. […] And indeed, for everything that we do along these lines, we
> want to build those tools such that the chat or whatever could also make use of them. So the chat
> could also look up words in the glossary or place a bookmark at a particular block or something.
> And actually, a tool I would really like would be jump to the first place where X, which is a kind
> of search, but it's a sort of limited, you know, it's like a sort of SQL search with limit one. So
> yeah, you might want to search for the first place or the best place. […] we want to make sure
> that anything like that, ideally almost all of them are available both in the command panel and
> also in the chat, and that the command panel can take a sort of an argument like a search term or
> whatever.
>
> — Greg, 2026-09-29 (from `/read/pnas-202123432-spya-rekvg9?mode=chat`)

Two additions from the Overseer: **dictation in the bar's box** (Greg, 2026-10-02: *"ok"*, the three
lines dictation.md says any box needs), and **"add a tag of X to this paper"** (qi-qkjnkwce; tags
landed in 261003d). And the rule for anything that acts, accepted by Greg on 2026-10-02
([chat-llm-help-commands-vision.md § Decided](../project/chat-llm-help-commands-vision.md)):
navigate freely, **propose** anything that writes or spends (the reader presses), never destroy or
publish from a sentence.

## What is already done (8D, plan 261002c, on dev)

Re-run any mode (*rerun glossary*), Archive / Put back with the label following the state, Export,
Metadata's sections by name (*Share this article* goes to Access & sharing), and one argument
command: `find <words>` / *do they talk about X?* opening Search on those words. So from Greg's
list: **archive ✓, regenerate ✓, search for X ✓, make public ✓ as far as it should go** (the row
takes you to the switch; publishing from a keystroke is the "never" row of the accepted line).

## What is left, and what we'll build

### Stage 1 — the bar takes more arguments, toggles Experimental, and listens

All deterministic parses beside `parseFindQuery` (src/web/command-match.ts), each a pure function
with its own tests. One generalised parse, `parseArgumentQuery(query)`, returns every argument
command the query could be (a verb table: verb phrases → command kind), and `parseFindQuery` becomes
one entry of it. Rows from it are appended after the ranked rows, as the find row is today.

1. **Jump to the first place it says X.** Verbs: `jump to`, `first`, `where does it first say`,
   `take me to`. Row: *Jump to the first “X”*. Uses `findLiteral(blocks, words)[0]` (search-hits.ts,
   the same matcher as Search's words mode) and goes to `?at=<blockId>` — the deliberate-jump
   address `useReadingPosition` already obeys. No match → the row stays and Enter keeps the bar open
   with *“X” isn't in this article.* (an `ActionOutcome` `stay`), so the reader learns it at once.
   Free, instant. **Best place** (meaning search, limit one) is deferred: it is a model call, so a
   proposed row, and Search › meaning already does it with one more press.
2. **Look up X in the glossary.** Verbs: `look up`, `define`, `glossary`, `what does … mean`. If X
   matches a term already in the glossary (case- and space-insensitive against the term and its
   aliases), the row is *Glossary: “term”* and opens Glossary at that term (`?mode=glossary&term=<id>`,
   the address `openTermInGlossary` sets). If not, the row is *Look up “X” in this article*,
   `generates: true`, and Enter opens Glossary and runs the band's existing `ask(X)` (one model
   call, the same as typing it into *Look up a term…*). The hand-off is in memory, one-shot, consumed
   by the Glossary band; **never a URL** (a link that spends is a link anyone can make a reader
   click — 261002c § simpler options). Needs the glossary's term list on `CommandBarArticle`,
   plumbed from Reader's `useGlossaryRead`; absent (no row of the first kind) while it is loading.
3. **Tags.** `tag X`, `add tag X`, `add a tag of X (to this paper)`, `tag this X`, `tag as X`;
   `untag X`, `remove tag X`. Row *Add the tag “x”* / *Remove the tag “x”*, showing the tag as
   `normaliseTag` (src/tags.ts) will store it; an invalid tag gives a row whose Enter stays open with
   the reason. Enter runs `editArticleTags(slug, {add:[x]})` (src/web/article-tags.ts), awaited,
   failure kept in the bar. Only with `shelfRow` (owner, not a fixture), like Archive. Writes the
   reader's own data reversibly: the bar row *is* the proposal the accepted line asks for.
4. **Experimental features on/off.** One row whose label follows the state — *Turn experimental
   features on* / *off* — through `useExperimental().set` (already on the Dock). Absent until
   `loaded`, and while signed out. Greg's "disabled if it's already on" is met by the label moving
   with the state (the rule Archive already follows) rather than a greyed twin row: one row instead
   of two, and nothing to press that does nothing. Typed-only, aliases `experimental`, `labs`.
5. **Dictation in the bar's box**, by dictation.md § Adding it to a box: `useDictationField`, the
   button and the strip; Enter and row activation disabled while `readOnly` or `armed`; stop on
   close (the bar stays mounted). Context `{ kind: "article", slug }` when there is one.

### Stage 2 — the same actions in chat, as command chips

Chat can already **read** the glossary (`article_glossary`) and **find words**
(`search_article_words`), and its answers already turn `[spya-…]` into chips that jump to the
passage. What it cannot do is propose an action. So:

- **A command chip** in chat's prose: a fenced token the model may write, e.g.
  `[[bookmark spya-k3m9qt]]`, `[[tag free energy]]`, `[[glossary free energy]]`,
  `[[find free energy]]`, `[[jump free energy]]`. The client parses it with the **same verb table
  and validation as the bar** (stage 1) and renders it as the bar's own row, drawn the same way —
  label, `generates` marker — as a button. **Pressing it runs it** through the same dispatcher the
  bar uses; the model never runs anything. A token that does not parse, names a block the article
  lacks, or holds an invalid tag renders as plain text, as an unknown block id does now.
- **Bookmark a passage** is the one new action (chat had it as Greg's example; the bar has no block
  argument a reader would type). It runs `makeBlockBookmarker(owner.comments.create)`, as Reader's
  bookmark already does.
- The chat prompt gets a short section saying the tokens exist and when to offer one (prompting-guide.md
  rules; one eval-free change, checked by reading two answers).

Why a token in the prose and not a tool call: the proposal must persist with the answer and render
as a button. A token is stored for free in the answer text and rendered by the code that already
renders block chips. A tool call would need a new streamed event, a new stored part of a turn and a
renderer for it, for the same button. The safety is the same either way: **the reader presses,
the bar's row is what they press, and the model's text is parsed, never trusted** (the accepted
line). Chat's own line (*nothing chat can call writes, deletes or spends*) still holds, because
nothing chat *calls* does; a chip is a suggestion on screen.

### Stage 3 — docs, Help, browser check, the note

reading-view-overview.md § The command bar, chat-tools.md, the vision doc's § Where we are,
dictation.md's list of boxes, the Help page, url-state.md if a param changes. A Playwright check at
1280 and 390 px. The feedback note and the queue bookkeeping.

## Deferred, named

- **Best place for X** (meaning search, limit one) — a model call; Search › meaning does it.
- **The interface model** (Jev picking a command from free words) — the vision doc's next step,
  not asked for here.
- **Toggling High-powered AI from the bar** — it charges; the switch's own copy states the price
  (261002c).
- **Greyed-out rows** — the label follows the state instead (Stage 1.4).
- **Chat proposing re-runs or Archive** — chips for the five above only; more are one verb-table
  entry each once these are used.

## The simpler options passed over

- **Prefill the glossary's ask box instead of running it**: one fewer seam into the band, but two
  presses for a request the reader already made in words, and the bar's Enter on a `generates` row
  is already how the reader consents to a run (rerun rows).
- **A chat tool per action**: the "every action is a tool" reading, but each would need a stored,
  streamed proposal part; see Stage 2.
- **A row per experimental state, one disabled**: Greg's own phrasing, but two rows for one switch.

## Done looks like

- Stage 1: red-first tests for the verb table (each verb, the quotes, the bare-verb nulls, no
  clash between `find` and `jump` and `glossary`), the glossary match, the tag normalisation, the
  experimental label; a test that a jump with no match keeps the bar open; dictation guards.
  `npm test`, `npm run typecheck` green.
- Stage 2: tests for the chip parse (valid/invalid tokens, unknown block → text) and one dispatch
  per press.
- Stage 3: browser check passes; docs and Help updated; Sol code review on each stage.

## Progress

- 2026-10-03: plan written.
