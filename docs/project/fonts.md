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

**Still behind the [Experimental switch](experimental-features.md).** Everything below applies only
while it is on. With it off, every voice is Geist and [typography.md](typography.md) is the whole
truth.

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
- **A fixed sentence we wrote is UI**, even when it reports what a model decided: "Key sources",
  `disputes` / `qualifies` / `unclear`, "said to be at", "You: leans …". Inside such a sentence, wrap
  only the model's or the author's words.
- **What the reader typed is the reader's**: their messages, notes, criteria, search queries, thread
  titles, purpose and profile, and the dictation's live guess. A placeholder in their box is ours,
  so it is UI.
- **Undecided, so left UI**: section titles (the model copies most of them from the author, and only
  `sourceHeading` can tell which), third-party text (Debate's web quotes, Wikipedia extracts), and
  hidden text a scan found in the source.

## How to put an element in its voice

The three voice lists and the placeholder reset are in one file,
[`src/web/styles/voices.css`](../../src/web/styles/voices.css), every rule under
`:root[data-voices]`. Two narrow UI resets that undo an inherited voice live beside the rules they
correct: `.chat-stance-tag` in `mode-band.css`, and `.passage-whole` in `annotations.css` and
`dock.css`. They carry the same guard. The attribute is set by
[`useVoiceFaces`](../../src/web/useVoiceFaces.ts) while a reading view is open and the switch is on.

1. **Give the element a class that names only that voice's words**, and add the class to the right
   list. A class shared with a fixed string (Skim's door cue is both the next stop's cue and "End of
   pass") needs a modifier on the AI case. A paragraph that mixes voices needs a `<span>` or `<q>`
   around the words that are not ours.
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

[`tests/voices-css.test.ts`](../../tests/voices-css.test.ts) catches the silent failures: a rule
without the switch's guard, a class renamed in a component (so the rule matches nothing), and a
compound selector whose parts never meet. **`VOICES_BY_MODE` makes a new mode a type error** until
somebody lists the AI classes it renders, or says why it has none. It cannot see a new element added
to an existing mode, so **when you add text a model wrote, add its class here at the same time.**

## Not yet in a voice

- **Pages outside the reading view**: Metadata (it replaces `Reader` rather than sitting inside it),
  the shelf, the public shelf, /profile and /add. Most of their text is `tw:font-prose`, which beats
  `voices.css`, and the shelf's gist silently falls back to the author's excerpt, so it needs a
  provenance flag first. This is part of promoting the faces out of the switch, a separate piece of
  work.
- **Block ids** are `--font-id`, a Courier, which now looks a little like AI text.

The audit that found what was missing, with file:line and where each string comes from:
[261002b-voices-trawl.md](../plans/261002b-voices-trawl.md).

---

Up: [design-css-overview.md](design-css-overview.md)
