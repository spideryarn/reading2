# Help: a microphone on the Ask box, and a TL;DR at the top of every mode's page

Two admin reports from Greg, 2026-10-08, both about `/help`
([help-page.md](../project/help-page.md)).

> Add a voice dictate button to the help chat.
>
> — Greg, 2026-10-08 23:11 UTC (`spya-y5gfpf`)

> In the help pages from mode, start with just like a bit more of a TLDR about why the reader should
> care and just broadly what the intent is. Like, so for example, in the quotes mode, start with
> saying, you know, that basically this highlights pieces of text in the article that are probably
> going to be of most interest to the reader, something like that. In the case of the skim mode, you
> might say something like, this allows you, this picks a handful of the most, you know, of pieces
> in the article that if you just read them would give you a good sense of what it's about. And you
> can consider this as an alternative to a summary that keeps you rooted in the article itself. And
> along the way, it'll explain stuff that you might not understand, like terms that are unfamiliar,
> and that you can try in doing this, you know, quickly with just a few stops along the way, and
> then again with a bit more detail, and then again with even more detail, or something like that.
> So in other words, you know, motivate each mode. Why does it exist and what's it for, and roughly
> how does it work? Start with that. And then maybe ideally a screenshot or an animated GIF showing
> it in use would be good as well. If there's a way in which we can annotate those, that would be
> even better, but maybe that's overkill.
>
> — Greg, 2026-10-08 23:15 UTC (`spya-xcmg2d`)

Prior work: [261007k](261007k-help-chatbot.md) built the Ask box; [261007l](261007l-help-screenshots-and-gifs.md)
and [261007o](261007o-help-pictures-for-the-eight-modes-without-one.md) gave every mode's page a
picture. Nothing in `docs/user-feedback/`, `gjd-remote ls` or `git log origin/dev` covers either
report.

## 1. The microphone on the Ask box

[`HelpAsk.tsx`](../../src/web/help/HelpAsk.tsx) § `AskBox` gets the standard three lines from
[dictation.md § Adding it to a box](../project/dictation.md#adding-it-to-a-box), copied from the
Feedback dialog, the nearest twin (a box with no article that sends):

- `useDictationField({ value, onChange: setValue, box, context: { kind: "profile" }, transcribe,
  keep: keepDictation("help-ask"), onDone: ask })`.
- **Context `profile`**, not a new `Where` kind. With no article in scope the server primes with the
  app's own words (`SITE_TERMS`: `Spideryarn`, `learn mode`, `glossary` and a few more) and the reader's profile
  prose, which is what a person asking how Spideryarn works is about to say. Feedback made the same
  call for the same reason (`FeedbackDialog.tsx` § the microphone).
- **The double press on Stop sends** (`onDone`, with `again`/`sendingAfter` on the button and the
  strip), as in every box that sends.
- **Guarded on `dictate.busy`** in all three ways a question is sent (the Ask button, Enter, and the
  double press's `onDone`, which runs after the transcript lands so it is not busy then), and the
  Ask button **disabled** while busy — a guard behind a lit button is a press that does nothing.
- **The microphone is disabled while an answer is arriving**, as chat disables it while busy.
- `readOnly={dictate.readOnly}` on the textarea, `<DictationStrip>` under the row.
- Placement: left of Ask/Stop in the existing right-aligned row, `DictationButton` unchanged — the
  same control as every other box ([controls.md § Controls that do the same job look the
  same](../project/controls.md#controls-that-do-the-same-job-look-the-same)).
- Hidden for a stranger, because the box is (the sign-in line is drawn instead), and hidden where
  the browser cannot open a microphone (`dictation.supported`), as everywhere.

The box remounts when the reader moves between `/help` and a page (the state lives in `useHelpAsk`,
the box does not); unmounting stops the microphone as any box's does, and `keep` offers the
recording back in the next box. Accepted: navigating mid-sentence is rare and nothing is lost.

**Passed over:** a `help` vocabulary place whose words are the mode labels. It would help a reader
saying "Marginalia" or "Skim", but it is a new `Where` kind, a recipe and a source for a box that
sends short questions, and the transcriber already gets most mode names right as ordinary English
words. Worth doing if a reader reports a mangled mode name.

`dictation.md`'s list of boxes gets an eleventh; `help-page.md` § Ask gets one line.

## 2. A TL;DR at the top of every mode's page

**Where it lives:** a third section in each mode's Markdown file, `## In short`, first. The parser
(`help-markdown.tsx` § `renderHelpModeHalves`) accepts it, in order before the other two, and
**requires** it, so a new mode cannot ship a Help page without one (the file is already required by
`Record<Mode, …>`; this makes the opening required too). `tests/help-page.test.tsx` draws every mode
page, so a missing one is a red test.

**What the page draws, in order:**

1. The `In short` section, with no heading — it is the page's opening.
2. The mode's main picture, which moves up into `In short` from `Reading it` (one picture per mode:
   the first, or for Skim the GIF of stepping through stops, since it shows the mode in use).
3. `How it works` (a new sub-heading) over the catalog's two sentences, unchanged — still the band's
   (i) card word for word.
4. `When to use it`, `Reading it`, as now.

**The words.** Each one says, in two to four sentences of Help's plain second-person voice: why a
reader would care, what the mode is for, and roughly how it works — checked against the mode's doc
and the existing page, never adding a fact the rest of Help does not already support. Greg's Quotes
and Skim sentences are the model.

**Annotation of the pictures: skipped.** Greg called it maybe overkill; the captions already say
what to look at. **No new pictures**: every mode's page already has one (261007o).

**The corpus.** `src/help-corpus.generated.json` puts a mode's catalog sentences before its file. It
must follow the page's order instead (In short, then the catalog, then the rest), so the model reads
what the reader reads. The builder is `tests/help-corpus.test.ts` § the mode prefix; regenerate with
`WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts`.

**Passed over:** a `tldr:` front-matter field. Shorter to parse, but it cannot hold a picture, and
Greg asked for the picture right after the TL;DR. Also passed over: replacing the catalog's
`description` with the TL;DR on the Help page. The catalog line is shared with the (i) card and the
contents page; keeping it under *How it works* costs one short repeated idea and keeps one source.

## Checks

- `npx vitest run tests/help-page.test.tsx tests/help-images.test.ts tests/help-corpus.test.ts
  tests/help-chat.test.ts`, a new test that a mode file without `## In short` throws, and a test
  that the Ask box's microphone refuses to send while armed (as `the-enter-key-really-sends.test.tsx`
  does for chat).
- `npm test`, `npm run typecheck`, `npm run lint` on touched files.
- Browser (Sonnet subagent, Playwright): a mode page shows the TL;DR then the picture; the Ask box
  shows the microphone beside Ask, at desktop and phone width.
- GPT Sol: this plan read-only, then the code.

## After GPT Sol's plan review

[The review](261009a-help-dictation-and-mode-tldrs-plan-review-sol.md): GO WITH CHANGES. All four
taken:

1. **The microphone lives in `useHelpAsk`, not in the box.** The box is drawn in two places and is
   remounted when the reader follows a link from `/help` to a page; a hook in the box would stop the
   recording mid-sentence, and the kept copy can be missing its last second. `useHelpAsk` is held by
   `HelpPageForReader`, which is keyed to the reader, so a dictation survives moving between Help
   pages and a reader switch still ends it. The box only attaches the shared textarea ref.
2. **Over the limit is refused, visibly, in the one `ask` every path uses.** `maxLength` stops
   typing, not a transcript; the server refuses past 1,000 characters. Never truncated — the reader
   sees the count and trims it. Tests cover both halves of `busy` (armed and transcribing).
3. **One section parser** (`helpModeSections`) used by the page and the corpus, so the headings and
   their order have one definition. Tests on the order of the drawn page and of the corpus.
4. The two-halves wording in `help-page.md`, the code comments and `help-words.ts` is updated with
   it; `renderHelpModeHalves` becomes `renderHelpModeSections`.

## After GPT Sol's code review

[The review](261009a-help-dictation-and-mode-tldrs-code-review-sol.md): SHIP AFTER MY FIXES. It
found no functional problem in the dictation wiring or the parser. It corrected eleven TL;DRs that
claimed more than the mode does: Structure is the model's map of the piece, not the article's own
contents; Skim's stop card shows only what Glossary and Ideas have already made; a quote proves the
words are in the article, not who wrote them; and several AI judgements were stated as facts. I put
three of its rewrites (Quotes, Plain, Skim) back into plainer words, keeping its corrections. Its new
test, that the Quotes opening must state the authorship caveat, became a test that the opening does
not mention the author at all, since the catalog's line just below states the caveat. Its one wider
item, a stale comment in `src/types.ts` saying every quote is "a sentence the author wrote", is
fixed too.

Browser check (Sonnet, Playwright, a dev server from this worktree): the mode pages draw in the
planned order. The microphone sits left of Ask at desktop and phone width in Chrome, and a fake
microphone records. Signed out, there is no microphone. WebKit on the box has no `MediaRecorder`, so
the button is hidden there, as everywhere on that engine.
