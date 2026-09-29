# ⌘-Enter opens the Metadata page from the article

SPIDERYARN-READING2-5F (`spya-kh58z7`), from Greg (admin). The time in the file name is when this
session picked the report up. The report text came in the brief, because this session had no Sentry
access.

> In the Reading view, if I hit Command Enter, that should open up the Metadata mode. And then maybe
> whatever the analogous keyboard shortcut should be for Windows, maybe Alt Enter. I don't know if
> that's already used for something in the browser.
>
> And add that as a tooltip to the Metadata mode.
>
> Probably use Sonnet web research and docs/reusable/third-party-library-selection.md to look for a
> nice library for keyboard shortcuts and/or reuse/amalgamate what we already have, e.g. for Cmd-k
> for Commands)

**Ending: Shipped.** It is on `dev` and not deployed. Resolve 5F; the next feedback sweep does the
Sentry status write.

What we did:

- In the reading view, **⌘-Enter on a Mac and Ctrl-Enter on Windows and Linux** go to the article's
  Metadata page, exactly as the Metadata button does.
- **Ctrl-Enter rather than Alt-Enter**, because it pairs with ⌘-K / Ctrl-K, which the app already
  uses. Alt-Enter on a link downloads it in some browsers, and Alt is the menu key on Windows.
- It does nothing while you are typing in a box, because ⌘-Enter already means "send" in five of
  them (Feedback, a comment, an annotation, the quiz, your profile). It also does nothing on a
  focused link, where it means "open in a new tab".
- The Metadata button's tooltip now says *"⌘Enter / Ctrl-Enter opens it from the article"*.
- **No new library.** The research is in
  [260929a](../research/260929a-keyboard-shortcut-libraries.md). None of the candidates handled the
  checks every shortcut here makes, and the closest one, tinykeys, is where to look if we ever want
  key sequences or shortcuts the reader can remap. Instead, the check shared by all our shortcuts
  now lives in one small file (`src/web/key-chord.ts`), which replaced three copies.

**Greg's follow-up, relayed by the Overseer the same day:**

> re 5F. Hmmm, I hadn't thought about Cmd+Enter interfering with Chat. Maybe Enter sends a message,
> and Shift+Enter adds a newline? (Add a tooltip to the send-message button with keyboard shortcuts)

- Chat already worked this way: Enter sends and Shift+Enter adds a new line, in the question box, in
  the box for editing a question, and in the Candidates "Ask" box. ⌘-Enter never opens Metadata from
  inside any of them, because the shortcut is off in every text box.
- **Fixed:** pressing Enter to pick a word in a Japanese or Chinese input method used to send the
  half-written question. It no longer does, in all three boxes.
- Chat's Send button now has a proper tooltip: *Enter to send · Shift+Enter for a new line*.
- Enter still cannot send while the microphone is listening or writing down what you said.
- The boxes for writing paragraphs (Feedback, comments, annotations, the quiz, your profile) keep
  ⌘-Enter / Ctrl-Enter to send, so Enter stays a new line there. That is an assumption: chat is for
  one message at a time, and those boxes are for writing at length.

Assumptions, each the simpler reading: "Metadata mode" is the Metadata page, since Metadata is a
page and not a mode; the shortcut works from the article only, so there is no ⌘-Enter back.

Plan: [260929g](../plans/260929g-shelf-search-focus-and-metadata-chord.md) § Part B.
