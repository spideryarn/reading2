---
reports: spya-fzd5nq
ending: shipped
comment: On dev. Help has one box now - typing lists the matching pages, and pressing Ask (signed in) sends the same words to the model, whose answer sits above the matches.
---
# One box on Help for search and ask

Report `spya-fzd5nq` (#649, SPIDERYARN-READING2-ME), a suggestion from Greg
(`feedback-reporter.ts` exit 0, no addenda when re-read before this note), filed from
`/help/mode-structure`. Overseer queue item `qi-fgckcc4c`, session
`fbfzd5nq-help-search-and-ask`.

> Why do we have both "Search help" and "Ask about Spideryarn"? Can we combine to get the best of
> both worlds?

**Shipped.** The plan, the reasoning and both GPT Sol reviews are in
[261020x](../plans/261020x-one-box-on-help-for-search-and-ask.md). In short:

- **One box** (`HelpAsk.tsx` § `HelpBox`), at the top of `/help` and of every page's column. Typing
  lists the pages that match, free and instant, as the search box did. **Signed in**, Ask or Enter
  sends the same words to the model, and its answer appears between the box and a small *Pages that
  match* list. Shift+Enter is a new line.
- **Signed out**, it stays the one-line *Search Help* box, Enter to the best match, with a line
  under it to sign in to ask. Asking still needs an account (q-vvhb55).
- Taking a match folds the list away instead of emptying the box, so a dictated question is not
  lost; the next edit brings the matches back.
- No change to the server, the allowance, the link allowlist or who may ask. The prompt's one
  sentence naming the old box was reworded (`help-chat/3`). The eval re-run is pending: the box's
  OpenRouter key is at its monthly limit until 2026-11-01 (`npx tsx evals/help-chat/run.ts --arm
  luna6-v3`, compare with `luna6.json`).

The trade-off: a signed-in keyboard reader's Enter now asks, where it used to go to the best page.
The pages are a press away in the list.
