# One box on Help for search and ask

Report `spya-fzd5nq` (#649), from Greg (admin, proven by `scripts/feedback-reporter.ts` on the
production row), a suggestion, filed 2026-10-19 20:58 UTC from `/help/mode-structure`. Overseer queue
item `qi-fgckcc4c`.

> Why do we have both "Search help" and "Ask about Spideryarn"? Can we combine to get the best of
> both worlds?

Parent doc: [help-page.md](../project/help-page.md). The two boxes came from different reports a
week apart: the search from `spya-p2hamn` (plan 261002b), and the model's box from `spya-ucftjt`
(plan [261007k](261007k-help-chatbot.md)). Nobody decided there should be two.

## What each box is good at

| | **Search Help** (`HelpPage.tsx` § `SearchBox`) | **Ask about Spideryarn** (`HelpAsk.tsx`) |
|---|---|---|
| Speed | Instant, per keystroke | A second or two, streamed |
| Cost | Free, no network | ~$0.0006 a warm question, counted against an allowance (30/hour) |
| Answer | A list of pages | A paragraph, with links to the pages it used |
| Good for | A word you know (*heat*, *skim*, *price*) | A question in your own words, a "how do I…?" |
| Signed out | Works | "Sign in to ask" |
| Enter | Goes to the best match | Sends the question |

## The design

**One box.** Typing searches, as the search box does now: the matching pages are listed under it as
you type, free and instant, and replace the contents while there is anything in the box. **Pressing
Ask (or Enter) sends the same words to the model**, and its answer appears between the box and the
list of matching pages. So a reader always gets the free result first, and pays for the model only
when they ask.

```
 ┌──────────────────────────────────────┐
 │ why is part of the spine orange?     │   ← one textarea, the reader's font
 │                                 🎤 Ask│
 └──────────────────────────────────────┘
   The orange marks are … (see Spine)      ← the answer, once asked (model's font)
   PAGES THAT MATCH                        ← small heading, only when there are matches
   The spine
   Reading time
   …
```

- **The box is a textarea** (two rows, as the ask box was three), placeholder *Search Help, or ask a
  question*, label *Search Help or ask a question about Spideryarn*. The search ignores line breaks
  and punctuation already (`page-search.ts` § `words`), so a question is a search too: *where did my
  article go* finds the archived question today.
- **Enter, signed in, asks** — the ask box's rule (Shift+Enter a new line, `enterKeyHint="send"`).
  Going to a page is a press on its row, which is one press away because the rows are already on
  screen. **Signed out, Enter goes to the best match**, as today, since there is nothing to ask
  (`enterKeyHint="search"`). The two Enters differ, but each is the only thing that box can do.
- **Escape**: stops an answer that is arriving; otherwise empties the box (matches go, contents come
  back). Never an input method's Escape. The answer is not cleared by emptying the box: it is the
  last question's, as now.
- **Taking a match empties the box**, as today, so the contents come back with the new page marked.
  The answer stays (it lives in `useHelpAsk`, not in the box).
- **Signed out**, the box has no microphone and no Ask button, and one line under it says *Sign in to
  ask a question as well* (the same link and `next` as now).
- **The microphone** stays where it is, next to Ask. Dictation fills the box, so a dictated question
  also searches as it lands, which is free.
- **One state, not two.** The query moves into `useHelpAsk`'s `value`; `HelpPage` computes the
  matches from it. `useHelpAsk` already lives at the page so the answer survives a move from `/help`
  to a page; the query now does the same for the same reason, which the search box already wanted
  (header § One component for every address).
- The status line (*N pages match* / *Nothing in Help matches …*) stays, under the box. When nothing
  matches and the reader is signed in, it adds *Press Ask to ask instead.*, since a whole question
  often matches no page under the every-word rule.

### What it costs and gives up

- **A signed-in keyboard reader loses Enter-to-the-best-match.** They now get an answer that links
  the page, or they press the row. I think this is the right trade: Enter in a box that says "ask" is
  expected to ask. It does mean a reader who types *heat* and presses Enter spends one question of
  their 30 an hour (~$0.0006). That is within the allowance it was sized for.
- **No change to the server, the prompt, the allowance, or who may ask.** Signed-out asking stays
  closed (q-vvhb55, Greg 2026-10-08: "A for now"), and nothing here touches a defence.

### The simpler option passed over

**Keep two boxes and just move them together** (search above, ask below, with a line between). It
is less code, but it keeps the question Greg asked: why two? The reader still has to choose before
typing. Rejected.

**A smarter Enter** (go to the page when the text looks like a keyword, ask when it looks like a
question) was also passed over: it guesses, and a box whose Enter does different things for
different words is unpredictable.

## Stages

One stage: it is one component and its tests.

1. **The box.** `HelpAsk.tsx` becomes the one box (`HelpSearchAsk`, or keep the file and rename the
   export — decide in code), taking the matches' status from `HelpPage`. Remove `SearchBox` and the
   separate `HelpAsk` mounts from `HelpPage.tsx`; the answer goes between the box and the matches.
   Tests: `help-page.test.tsx` (the search tests now type into the textarea; Enter signed out goes,
   Enter signed in asks), `help-ask.test.tsx`, `help-ask-dictation.test.tsx`,
   `help-sends-once.test.tsx`, `help-never-spends-twice.test.tsx`,
   `what-the-enter-key-promises.test.tsx` (one box now, two promises by sign-in state). Words:
   `src/web/help/pages/feedback.md` names *Ask about Spideryarn*; regenerate the corpus.
   Docs: `help-page.md` § Ask about Spideryarn and § Where the words live, `dictation.md`'s line.
   Then a browser check (Sonnet subagent), GPT Sol code review, commit, push to `dev`.

## What landed

- `HelpAsk.tsx` § `HelpBox` is the one box: `AskBox` (signed in, textarea, Enter asks),
  `SearchOnly` (signed out, the old one-line input), `MatchStatus` (the status line, moved from
  `HelpPage.tsx`, echoing at most 40 characters and offering Ask until these words are answered),
  and `Answer`, whose live region is mounted from the start and which says *You asked: “…”* once the
  box has moved on. `Asked` carries `question`. `ask()` puts a soft keyboard away once it has sent.
- `HelpPage.tsx`: `SearchBox` gone; the words are `useHelpAsk().value`; `folded` hides the matches
  after one is taken, until the next edit (adjusted during render, so returning to the same words
  unfolds too); the search runs on `useDeferredValue` of the words cut to 1,000 characters. The
  matches have a small *Pages that match* heading.
- `page-search.ts`: each section's words cached once per section object (`WeakMap`), query words
  de-duplicated. Metadata's behaviour is unchanged; its tests pass.
- `HELP_CHAT_SYSTEM`'s identity sentence no longer names a box called *Ask about Spideryarn*;
  `HELP_CHAT_VERSION` is `help-chat/3`. **The eval could not be re-run**: the box's OpenRouter key
  was at its $500 monthly limit on 2026-10-20 (every call `403 Key limit exceeded`, resets
  2026-11-01; [ai-gateway.md § The box's key has a monthly limit](../project/ai-gateway.md#the-boxs-key-has-a-monthly-limit-and-it-runs-out)).
  The change is one sentence about which box the model is, before the pages and the rules, with
  no rule changed. To re-run once the key has room:
  `npx tsx evals/help-chat/run.ts --arm luna6-v3` and compare with `luna6.json`.
- Words: `pages/feedback.md`, the privacy page's clause (*with the Ask button in Help's box*; not a
  new flow, so `LAST_UPDATED` stays), `help-page.md`, `privacy.md`, `dictation.md`. Corpus
  regenerated.
- Tests: new `tests/help-one-box.test.tsx` (11 cases, signed in; seen red by breaking `offerAsk`);
  `help-page.test.tsx`'s Enter and press cases now expect folding, not emptying;
  `what-the-enter-key-promises` names both boxes in `HelpAsk.tsx`.

## Done looks like

- One box on `/help` and in every page's column; typing lists pages, Ask answers; signed out, the
  box searches and says to sign in to ask.
- `npm test`, `npm run typecheck` green; a browser check of `/help` and `/help/spine`, signed in and
  out, at a wide and a phone width.

## Review

GPT Sol, plan review, 2026-10-20 (`--sandbox review`): *build with these changes*. Each finding, and
what changed. **These override the design above where they differ.**

1. **Taking a match must not clear the box** (high). The box is now also the question, and a
   dictation's transcript is refused if the text it was written into changed underneath it
   (`useDictationField.ts`), so clearing it loses words. **Changed:** taking a match (Enter signed
   out, or a press on a row) *folds the matches away* until the box is next edited, and the contents
   come back with the new page marked. The words stay.
2. **Signed out, keep the one-line `type="search"` box** labelled *Search Help*, Enter to the best
   match, and a line under it to sign in to ask. A textarea that says *search* breaks touch.md's
   rule, and an ask-shaped placeholder invites a question that sign-in would lose. Signed in: the
   textarea, Enter asks. Both call `putKeyboardAway` after Enter has acted (touch.md § Once the key
   has done its thing). Same place, same value: one box on screen whichever you are.
3. **Search every keystroke is slow** (~15 ms for *heat*, ~38 ms for a 1,000-character question,
   measured). **Changed:** `page-search.ts` caches each section's words once (a `WeakMap` on the
   section object, so Help's kept list is tokenised once and Metadata's is unchanged), query words
   are de-duplicated, the query is cut to `MAX_HELP_QUESTION_CHARS` for the search only, and
   `useDeferredValue` keeps typing ahead of the list. The no-match line no longer echoes a long
   query whole.
4. **The answer can drift from its question**, and its live region was inserted with its first
   words. **Changed:** every `Asked` keeps the question; when the box no longer holds it, a quiet
   *You asked: “…”* line sits above the answer. The `aria-live` region is mounted from the first
   render.
5. **Tests**: the unified box's own cases (Enter either way, Shift+Enter, both IME spellings, two
   presses one POST, folding during dictation, remount between `/help` and a page, reader switch).
   `help-sends-once` and `help-never-spends-twice` are the article's "?", not this, and are dropped
   from the list.
6. **Docs and the prompt**: `HELP_CHAT_SYSTEM` says the model is the box that says *Ask about
   Spideryarn*; reworded, and `HELP_CHAT_VERSION` bumped. `privacy.md`, `setup-dev.md`, `touch.md`
   and the rest swept for both names; plans and the changelog left as history.
7. **Security**: none new. `/api/help-chat` stays behind `requireUser`; the link allowlist and the
   allowance are untouched. Run `help-chat-route`, `authenticated-api-route-contract`,
   `help-answer-links`, `help-chat` and `help-corpus` as well.

### Code review

GPT Sol, code review, 2026-10-20 (`--sandbox workspace-write`): *ship*. It fixed four things in
the stage, each checked:

1. **Signed-out Enter could take the best match for the previous keystroke** (medium), since the
   list trails the box through `useDeferredValue`. `onGo` now searches the box's current words and
   returns whether it went; the keyboard is put away only when it did. Regression test in
   `help-page.test.tsx`.
2. **The status line could announce the old count for new words** while the deferred search caught
   up; it is silent until it settles.
3. **Folding during a dictation** had no test; `help-one-box.test.tsx` now shows the live words
   survive and the final transcript still lands.
4. **The `WeakMap` cache assumes sections are not mutated**; the fields are `readonly` now (every
   caller already replaces rather than mutates), and repeated query words are pinned in
   `page-search.test.ts`.

After it: `npm run typecheck` green, the 14 Help suites green (792 tests), Biome clean on the
touched files; the full `npm test` before it was green (46,991 tests).
