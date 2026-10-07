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

**Revised after GPT Sol's plan review** (F1–F9, [261003f-plan-review-sol.md](261003f-plan-review-sol.md)),
every finding checked against the code and accepted; the ledger is below. The first draft is
commit 2952175f5. The biggest change (F8): Stage 1 now starts with **a stable, serialisable command
descriptor and one executor**, so the bar's free-text parse and chat's stored tokens both produce the
same typed proposal, and chat never re-parses natural language.

### Stage 1, part 0 — the proposal descriptor and its executor (F8)

`src/web/command-proposal.ts`, pure, no React:

```ts
type CommandProposal =
  | { id: "jump-first"; words: string }        // navigate
  | { id: "find"; words: string }              // navigate
  | { id: "glossary-open"; termId: BlockId }   // navigate
  | { id: "glossary-ask"; term: string }       // spends: one model call
  | { id: "tag-add"; tag: string }             // writes, reversibly
  | { id: "tag-remove"; tag: string }          // writes, reversibly
  | { id: "bookmark"; blockId: BlockId };      // writes, reversibly
const RISK: Record<CommandProposal["id"], "navigate" | "writes" | "spends">;
```

A `parseProposalToken` / `formatProposalToken` pair for the stored chat form — an exact id and an
encoded argument, never a sentence — and validation per id (tag through `normaliseTag`, block ids
through the block-id parser). An **executor** interface, `CommandExecutor`, implemented once by the
owner's Reader from the controllers that already own the state (F3, F4, F6): `jumpTo`, the
Search navigation, `openTermInGlossary`, a glossary-ask hand-off, a tags controller, the memoised
bookmarker. Each method returns an `ActionOutcome`. Anything the executor lacks where the reader is
standing (Metadata has no glossary read and no prose — F1) is absent there, not a dead row.

### Stage 1 — the bar takes more arguments, toggles Experimental, and listens

All deterministic parses beside `parseFindQuery` (src/web/command-match.ts), each a pure function
with its own tests. One generalised parse, `parseArgumentQuery(query)`, returns every argument
command the query could be (a verb table: verb phrases → command kind), and `parseFindQuery` becomes
one entry of it. Rows from it are appended after the ranked rows, as the find row is today.

1. **Jump to the first place it says X.** Verbs, explicit only (F7): `jump to first`,
   `first occurrence of`, `first mention of`, `where does it first say`, `where does it first mention`.
   Not `take me to` or bare `jump to`, which are how readers name a mode or a page. Row: *Jump to
   the first “X”*. Uses `findLiteral(blocks, words)[0]` (search-hits.ts, the same matcher as
   Search's words mode) and runs Reader's `jumpTo(blockId)` — the deliberate jump, which pushes
   history and feeds the return chip (F3); a test presses Back. No match → the row stays and Enter keeps the bar open
   with *“X” isn't in this article.* (an `ActionOutcome` `stay`), so the reader learns it at once.
   Free, instant. **Best place** (meaning search, limit one) is deferred: it is a model call, so a
   proposed row, and Search › meaning already does it with one more press.
2. **Look up X in the glossary.** Verbs: `look up`, `define`, `glossary`, `what does … mean`.
   Matched only against Reader's **visible** `terms` (F2), exact name first, then aliases; an alias
   two visible entries share gives one row each. A match is *Glossary: “term”* and runs
   `openTermInGlossary(id)`. No match, **and the glossary read has settled to ready** (F1 — loading
   or an error is not evidence of absence, and an empty Glossary would generate on open), gives
   *Look up “X” in this article*, `generates: true`: Enter moves to Glossary **without arming
   generate-on-open**, through a slug-scoped, nonce-bearing, one-shot hand-off the band consumes
   and then calls its existing `ask(X)` — one `POST /api/glossary/:slug/ask`, zero job POSTs, both
   pinned by a test. **Never a URL** (a link that spends is a link anyone can make a reader click).
   No glossary at all: the ask row is absent and *Glossary* (the mode) is how you make one.
   On Metadata neither row exists (no glossary read there).
3. **Tags.** `tag X`, `add tag X`, `add a tag of X (to this paper)`, `tag this X`, `tag as X`;
   `untag X`, `remove tag X`. Row *Add the tag “x”* / *Remove the tag “x”*, showing the tag as
   `normaliseTag` (src/tags.ts) will store it; an invalid tag gives a row whose Enter stays open with
   the reason. Enter runs a **tags controller on `ShelfRow`** (F4), analogous to `archive`:
   Metadata supplies its existing wrapped save (so its `TagEditor` updates), Reader supplies one
   over `editArticleTags`. Awaited, failure kept in the bar. Only with `shelfRow` (owner, not a
   fixture), like Archive. Writes the
   reader's own data reversibly: the bar row *is* the proposal the accepted line asks for.
4. **Experimental features on/off.** One row whose label follows the state — *Turn experimental
   features on* / *off* — through `useExperimental().set` (already on the Dock). Absent until
   `loaded`, while signed out, and **while `saving`** (F5) — the store flips optimistically and
   drops a second `set` while one is in flight, so an inverse row then would do nothing. `set`
   becomes awaitable so a refused save keeps the bar open with the reason. Greg's "disabled if it's already on" is met by the label moving
   with the state (the rule Archive already follows) rather than a greyed twin row: one row instead
   of two, and nothing to press that does nothing. Typed-only, aliases `experimental`, `labs`.
5. **Dictation in the bar's box**, by dictation.md § Adding it to a box: `useDictationField`, the
   button and the strip; Enter and row activation disabled while `readOnly` or `armed`; stop on
   close (the bar stays mounted). Context `{ kind: "article", slug }` when there is one.

### Stage 2 — the same actions in chat, as command chips

Chat can already **read** the glossary (`article_glossary`) and **find words**
(`search_article_words`), and its answers already turn `[spya-…]` into chips that jump to the
passage. What it cannot do is propose an action. So:

- **A command chip** in chat's prose: the stored token of Stage 1's `CommandProposal` — an exact
  id and an encoded argument (F8), never re-parsed as language. Recognised **only in ordinary
  Markdown text nodes**, not in code or link labels; an allowlist of ids; and rechecked **at
  click time** against ownership, availability and block membership. Rendered as the bar's own
  row, drawn the same way — label, `generates` marker — as a button. **Pressing it runs it**
  through the same `CommandExecutor`; the model never runs anything. A token that does not parse,
  names a block the article lacks, or holds an invalid tag renders as plain text, as an unknown
  block id does now. Spend chips (`glossary-ask`) are allowed: the accepted line permits a truthful
  proposed button, and the boundary is the code, not the prompt.
- **Bookmark a passage** is the one new action (Greg's example; the bar has no block argument a
  reader would type). It runs Reader's **memoised** bookmarker, available only after the opening
  comments read succeeded (F6), never a factory made in the renderer.
- The chat prompt gets a short section saying the tokens exist and when to offer one
  (prompting-guide.md), and **a small recorded eval** (F9): normal requests, requests that want no
  proposal, malformed arguments, a glossary term present and absent, and an article carrying
  instructions to propose things. Measured: valid-proposal rate, unsolicited-proposal rate, and
  whether the prose stays useful. Written up under docs/investigations/.

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

## Review ledger

| ID | Sev | Finding | Taken |
|---|---|---|---|
| F1 | P0 | An unknown glossary lookup could start two paid runs (generate-on-open plus ask); Metadata has no glossary read | Unarmed hand-off; ask row only once the read is ready; absent on Metadata; one ask POST, zero job POSTs pinned |
| F2 | P1 | Raw glossary includes hidden entries; aliases can be shared | Visible `terms` only; exact name first; one row per sharing entry |
| F3 | P1 | `?at=` is the debounced replace, not the deliberate jump | Reader's `jumpTo` through the executor; Back tested |
| F4 | P1 | Raw `editArticleTags` leaves Metadata's editor stale | A tags controller on `ShelfRow` |
| F5 | P1 | Experimental row could do nothing during a save | Absent while saving; awaitable `set` |
| F6 | P1 | A bookmarker made in the renderer loses its retry id | Reader's memoised controller, gated on the comments read |
| F7 | P1 | `take me to glossary` would become a literal search | Explicit "first" verbs only; a collision matrix test |
| F8 | P1 | Chat tokens re-parsed as language; no descriptor, dispatcher, gate | `CommandProposal` + executor first; exact-id tokens; text nodes only; click-time recheck |
| F9 | P2 | "Read two answers" is not evidence for a prompt change | A small recorded eval |

## Done looks like

- Stage 1: red-first tests for the verb table (each verb, the quotes, the bare-verb nulls, no
  clash between `find` and `jump` and `glossary`), the glossary match, the tag normalisation, the
  experimental label; a test that a jump with no match keeps the bar open; dictation guards.
  `npm test`, `npm run typecheck` green.
- Stage 2: tests for the chip parse (valid/invalid tokens, unknown block → text) and one dispatch
  per press.
- Stage 3: browser check passes; docs and Help updated; Sol code review on each stage.

## Progress

- 2026-10-03: plan written; Sol's plan review (F1–F9) folded in.
- 2026-10-03: **Stage 1 landed** (part 0 and items 1–5). `command-proposal.ts` (the descriptor,
  `RISK`, the token pair, `resolveArgument`, `runProposal`), `command-runners.ts` (one runner per id,
  and `readingExecutor`, which Reader builds once), `glossary-ask-handoff.ts`, the verb table in
  `command-match.ts`, the rows and the microphone in `CommandBar.tsx`, an awaitable
  `useExperimental().set`. Divergences from the plan as written, each forced by the code:
  - **The executor is `{ runners, sources }`**, one optional runner per id, not an interface of
    methods: absence is then the "not offered here" the plan asks for. The two **tag** runners come
    with `ShelfRow.tags` on either page rather than from the executor (F4).
  - **A bare `glossary X` is not a verb**, and **`define again` is excepted**: the collision matrix
    refused both (*glossary again* and *define again* are *Run again* phrasings). `look up`,
    `define`, *what does … mean* and *what is meant by* remain. Added beside the listed tag verbs:
    `add the tag`, `tag this as`, `remove the tag`.
  - **The jump is offered to a visitor too** (it writes nothing, like the find row they already
    have); the glossary rows are the owner's, since the read that gates the ask is owner-only. A
    phrase shorter than Search looks for says so rather than claiming it is absent.
  - **F1's test presses the runner and mounts the real band** (under StrictMode), not the whole
    Reader, which no test here mounts; Reader's half — `jumpTo`, and the plain `setMode` — is held
    by a source-level wiring check in `tests/command-jump-pushes-history.test.tsx`, labelled as one.
  - **The dictation strip is drawn after the bar's status line**, not straight under the box: it
    carries a live region of its own, and before the bar's it took the place every existing test
    (and a screen reader) looks for the bar's sentence in. With no article the context is
    `{ kind: "profile" }`.
- 2026-10-03: **Stage 2 landed** — command chips in chat. `src/command-token.ts` (the token's
  shape, shared with the server's citation counters), `src/web/chat-commands.ts` (`chipFor`: which
  tokens are a button), `src/web/CommandChip.tsx` (the button and its press), `chatExecutor` in
  `command-runners.ts`, a `commands` prop on `Cited.tsx`, the `OFFERING AN ACTION` section of chat's
  prompt, and the eval ([261003b](../investigations/261003b-chat-proposes-commands-as-chips.md):
  15 of 17 wanted buttons right, none unsolicited on an ordinary question, $1.86). Divergences:
  - **Chat may propose six ids, not seven.** `glossary-open` takes an entry id the model is never
    shown; chat writes `glossary-ask` with the term and `chipFor` turns it into *open the entry*
    when the visible glossary has it (the bar's own match).
  - **A token is a button only on a line of its own**, added after the eval: every token written
    for the reader was, and the one that was not was a hostile article's, quoted by a model
    refusing it.
  - **A token-shaped run is never citation text**, valid or not, on both sides (`citableText`
    blanks it), so the id in `[cmd:bookmark:spya-…]` is not counted as a citation.
  - **No executor, plain text; an executor without that runner, a disabled chip.** Remember,
    Tutorial and Candidates get no executor (and their prompts no section). The bookmark before the
    comments read lands is drawn disabled rather than as raw brackets.
  - **The executor reaches the answer through a context** (`ChatCommands`, provided by Reader round
    chat and the chat dialog), not five layers of props — `BlockLinkCard`'s reason.
  - **Chat's executor adds what the bar gets elsewhere**: the tags runners (the bar's come from its
    shelf row) and a `find` runner (the bar's is an address; `findHref` is now shared). Its jump is
    the band's, which steps a covering band aside on a phone.
  - **A half-arrived token at the end of a streaming answer is held back** until it closes; block
    chips do not do this (they have no syntax to be half of), bare links do.
  - `GENERATES_MARKER` and `NOT_HERE` moved from `CommandBar.tsx` to `command-proposal.ts`, so the
    chip does not import the bar.
  - Not done here, for Stage 3: *Copy answer* copies the raw token; `evals/README.md` has no entry
    for `evals/chat-commands/` yet.
- **Stage 2 review** (GPT Sol, [261003f-stage-2-code-review-sol.md](261003f-stage-2-code-review-sol.md)):
  F15 a complete token on the still-open last line of a streaming answer was briefly pressable
  (fixed: held until the line settles); F16 a token inside a blockquote became a button (fixed:
  text); F17 the investigation's spend did not match its results files (fixed); F18 *Copy answer*
  copied the raw token (fixed here: `withoutCommandLines`, src/citable.ts).
- **Stage 3**: docs and Help updated (chat-tools.md § Command buttons is the owner of the chat
  half; reading-view-overview.md § The command bar of the bar's). **Browser check** (Playwright,
  system Chrome, 1280 and 390 px, `useful-spya-zu5r34`; shots `261003f-shot-1…8`): all eight items
  passed — the jump and Back, the not-found sentence, *define* opening a term, the look-up making
  exactly one `POST …/ask` and no job, tags from the bar on both pages, the Experimental row
  flipping, the microphone at 390 px, the regressions, and chat's bookmark and tag buttons, with
  *Copy answer* free of tokens. No defects found.
- **Deferred, queued**: the best place for X, qi-cehs9yfh. The interface model is the sibling
  session's (qi-3wb7cgda, `fb-command-bar-nl`), which had not started when this landed.
