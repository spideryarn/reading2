---
reports: spya-rwys0e, spya-a52jsr, spya-j6b69x
ending: shipped
---
# A nicer AI typeface, and every voice in its face

Three suggestions from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), batched as
Overseer queue item `qi-ehnxt7ez`. The time in the file name is the first report's (7N), in London
time.

[SPIDERYARN-READING2-7N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7N), from
Remember mode on `what-if-we-had-bigger-brains-imagining-minds-beyond-ours`, build `7aaead6d`:

> We switched to using a monospace font for the AI-generated text. Great!
>
> But Courier is really ugly. Do some web research on a more attractive font that would still
> indicate that it's somehow machine/AI-generated - Courier is good in that respect because it looks
> typewriter-y, but it's just a bit too unattractive.
>
> Use Playwright screenshots if it will help you.

[SPIDERYARN-READING2-81](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-81), from
Marginalia on `9689-full-spya-m43th2`, build `7aaead6d`:

> I like the different fonts for AI-generated vs author-generated vs user-generated.
>
> Let's do another trawl and make sure we're following this carefully throughout, and add/update
> fonts.md (with appropriate signposting from design docs and AGENTS.md and new-mode.md etc) so that
> we stick to this going forwards.

[SPIDERYARN-READING2-8G](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8G), relayed by the
Overseer:

> Make sure we're using the AI monospaced font for all AI-generated text (including e.g. Tweet
> threads, etc etc)

**Ending: Shipped** to `dev`, all three, still behind the Experimental switch. It needs a deploy;
there is no migration.

- **7N:** the AI face is now **IBM Plex Mono**. It is still a true monospace, so it still looks
  machine-made, but it is not hairline-thin the way Courier is. Seven candidates were set side by
  side in screenshots. The runner-up is iA Writer Quattro, which reads more smoothly but barely looks
  monospaced. The research and specimens are in
  [docs/research/261002a](../research/261002a-a-nicer-typeface-for-ai-written-text.md).
- **8G and 81:** the trawl found about 15 kinds of AI text still in the wrong face. **Tweets' posts**
  were in the reading face. Marginalia, Sketch's card and titles, Illustrated, Skim, Quotes' "why",
  hover cards, glossary names and code in answers were affected too. It also found gaps in the
  author's and the reader's faces, and a few fixed labels of ours wrongly set as AI. All are fixed.
  Structure and the spine now tell a heading's label (the author's) from a paragraph's (the
  model's).
- **"Going forwards":** [fonts.md](../project/fonts.md) holds the rule and the how-to. It is
  signposted from AGENTS.md, design-css-overview.md, typography.md and mode.md. There is no
  `new-mode.md`; `mode.md` is the adding-a-mode checklist. A test makes a new mode fail to compile
  until its AI text is assigned a face.

GPT Sol reviewed the plan and the code. The plan, with screenshots and what was left out on purpose:
[261002b](../plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md).

**For Greg:**
- **Should the faces come out from behind the Experimental switch?** You've said twice that you like
  them. For the reading view it's a small change. Metadata and the shelf need their own pass first.
- Sketch's labels inside the drawing are still Geist, because their layout is measured for Geist's
  width. Illustrated's captions are painted into the image, so a font can't reach them.
