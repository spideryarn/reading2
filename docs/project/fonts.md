# Fonts: a face for each voice

**Whose words are these?** The reading view puts three voices side by side: the article's author,
a model, and the reader. Each gets its own face, so the reader can tell at a glance which is which.
The chrome keeps the app's own sans as a fourth voice. For a product that augments reading rather
than replacing it ([vision.md](vision.md)), that matters a lot: a summary must never be mistaken for
the author's sentence.

> I like the different fonts for AI-generated vs author-generated vs user-generated.
>
> Let's do another trawl and make sure we're following this carefully throughout, and add/update
> fonts.md … so that we stick to this going forwards.
>
> — Greg, 2026-10-01

> Make sure we're using the AI monospaced font for all AI-generated text (including e.g. Tweet
> threads, etc etc)
>
> — Greg, 2026-10-02

**For every reader, on every page, always.** The faces were behind the
[Experimental switch](experimental-features.md) from 2026-10-01 until Greg was asked whether they
should come out:

> Yes they should now be used throughout and always going forwards. Try and build this in a clean,
> general, robust way, which might require some cleaning up/refactoring.
>
> — Greg, 2026-10-02

So there is no switch and no flag, and new text arrives in its voice or it is a bug: the reading
view and every page outside it (the shelf, Metadata, /profile, /add, the public pages)
([261002f](../plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md)).

## The four voices

| Token | Voice | Face | Why |
|---|---|---|---|
| `--font-author` | the article, and verbatim quotes of it | Source Serif 4, variable | a screen serif; variable, so dark mode's 450 weight still works |
| `--font-ai` | prose a model generated | IBM Plex Mono, static 400/700 | monospaced, so it reads as machine-made; not Courier, which Greg found "really ugly" |
| `--font-reader` | anything the reader typed | Arial, from the system | Greg's word, no download |
| `--font-ui` | the chrome, and every fixed sentence we wrote | Geist | the fourth voice, by being left alone |

The tokens are in [`styles/tokens.css`](../../styles/tokens.css). The three downloaded faces are
self-hosted through `@fontsource` packages imported in
[`tailwind.css`](../../src/web/tailwind.css); Arial is the system face. **A new downloaded face must
be self-hosted too**: a font CDN would be a new outside party seeing every reader's page loads
([privacy.md](privacy.md)).

How the faces were chosen: Courier Prime and the serif in
[261001d](../plans/261001d-typeface-per-voice.md); Plex Mono over Courier, with seven candidates
side by side, in [261002b](../plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md). Its
runner-up, iA Writer Quattro, is easier to read as paragraphs but barely looks monospaced; swapping
to it means changing the token and its import.

## Whose voice is it? The rule

- **Prose a model generated → `--font-ai`.** Summaries, gists, glossary entries and term names,
  idea names, quiz questions, chat replies (code blocks too), Tweets' posts, Sketch's and
  Illustrated's titles and captions, a "why this one" tooltip. If a model chose the words, it is AI.
- **Text a model only copied or transcribed keeps its writer's voice.** A heading-leaf's label is
  the author's heading, copied verbatim, so it is the author's. A citation's title is the cited
  work's. A quote the pipeline checked as verbatim is the author's.
- **A section title is the author's when it is the heading the node kept, and the model's
  otherwise** — `titleVoice` in [`src/web/tree.ts`](../../src/web/tree.ts), which compares the title
  with `sourceHeading` the way the pipeline checks that claim. Greg, 2026-10-02 (spya-rp8cr4):

  > In Structure mode - if the headlines are AI-generated, they should be in AI-generated-font.
  >
  > Ideally, it would use author-font if the headlines were preserved from the author

  The apparatus's "Notes" and the heading tree's "Before the first heading" are ours.
- **An article's title is the author's, unless the reader renamed it**, then it is the reader's
  (`articleTitleVoice`). **Where a page does not know whether there is a rename, the title stays in
  the app's face** rather than guessing: the masthead, Metadata before a rename, the unread-paper
  page, a library search hit. Guessing "author" would put the reader's own words in the author's
  face.
- **The shelf's blurb is the model's gist, or the article's own excerpt where there is none.** The
  server says which (`gistVoiceOf` in [`src/library-scalars.ts`](../../src/library-scalars.ts)).
- **A fixed sentence we wrote is UI**, even when it reports what a model decided: "Key sources",
  `disputes` / `qualifies` / `unclear`, "said to be at", "You: leans …". Inside such a sentence, wrap
  only the model's or the author's words.
- **What the reader typed is the reader's**: their messages, notes, criteria, search queries, thread
  titles, purpose and profile, and the dictation's live guess. A placeholder in their box is ours,
  so it is UI.
- **Facts about the piece are UI**: bylines, site names, dates, origin URLs, shelf terms (the
  authors' phrases, normalised and picked by a program and a model, so nobody's sentence). A URL the
  reader typed or pasted is theirs.
- **Undecided, so left UI**: third-party text (Debate's web quotes, Wikipedia extracts), and hidden
  text a scan found in the source.

## How to put an element in its voice

The three voice lists and the placeholder reset are in one file,
[`src/web/styles/voices.css`](../../src/web/styles/voices.css), every rule `:root :is(…)` — the
`:root` is specificity, not a switch. Two narrow UI resets that undo an inherited voice live beside
the rules they correct: `.chat-stance-tag` in `mode-band.css`, and `.passage-whole` in
`annotations.css` and `dock.css`.

**Two ways in, by whether the voice depends on the data:**

- **Always the same voice → name the element's class in the right list.** A class that says what the
  element *is* reads better in a stylesheet than one that only says whose it is. A class shared with
  a fixed string (Skim's door cue is both the next stop's cue and "End of pass") needs a modifier on
  the AI case.
- **Depends on the data → compute a `Voice` and use `voiceClass` / `withVoice`** from
  [`src/web/voice.ts`](../../src/web/voice.ts), which give `voice-author`, `voice-ai`,
  `voice-reader` or `voice-ui`. A Structure title, a shelf blurb and an article's title go this way,
  and so does any element on a page that has only Tailwind classes. **Never put one on an element a
  list already names**: a list's rule carries its most specific entry's specificity, so `.tip-gist`
  would beat `.voice-author` on the same element. Use a `<span>` inside.

Then:

1. **A paragraph that mixes voices** needs a `<span>` or `<q>` around the words that are not ours.
2. **Name every element that sets its own face.** A rule reaches its element and any descendants
   that do not set their own `font-family`. `.tooltip`, `.prose-card-text`, `.mode-band`,
   `.marg-note`, `.chat-pointed` and others reset to `--font-ui`, so an AI ancestor does not carry
   through them.
3. **A `tw:font-*` utility on the same element wins** (Tailwind's layer comes after ours). Wrap the
   words in a classed `<span>` rather than fighting it; that is how Tweets' posts are voiced.
4. **Model text drawn in SVG is not voiced.** Sketch wraps and measures its labels in TypeScript
   assuming Geist's width (`CHAR_W` in `src/sketch-scene.ts`), and a monospace is about 13% wider.
   Voicing it means passing a per-voice width into `paintScene`. Illustrated's captions are painted
   into the image.

[`tests/voices-css.test.ts`](../../tests/voices-css.test.ts) catches the silent failures: a class
renamed in a component (so the rule matches nothing), a compound selector whose parts never meet, a
`voice-*` class `voiceClass` no longer returns, and the old switch's attribute coming back.
**`VOICES_BY_MODE` makes a new mode a type error** until somebody lists the AI classes it renders,
or says why it has none, and **`VOICES_BY_SURFACE` does the same for a new page** (a `Record` over the
router's `Route` kinds). Neither can see a new element added to an existing mode or page, so **when
you add text that is not the app's own, put it in its voice at the same time.**

## Not yet in a voice

- **The public shelf's blurb.** Its voice would need a column on `publicLibraryQuery`, which is a
  listed defence ([security-map.md](security-map.md)), so it stays in the app's face; its titles are
  voiced.
- **Article titles where a rename is not known** (above). Voicing them means carrying
  `titleOverridden` on the owner's article, unread-paper, search-hit and Citations-match payloads —
  [261002f § 6](../plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md).
- **Sketch's SVG labels and Illustrated's painted captions** (§ How to put an element in its voice,
  point 4).
- **Block ids** are `--font-id`, a Courier, which now looks a little like AI text.

The audit that found what was missing, with file:line and where each string comes from:
[261002b-voices-trawl.md](../plans/261002b-voices-trawl.md) for the reading view, and
[261002f](../plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md) for the pages
outside it.

---

Up: [design-css-overview.md](design-css-overview.md)
