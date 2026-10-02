---
reports: spya-f5fa66, spya-rp8cr4
ending: shipped
---
# The three faces for everyone, and Structure's headlines in their writer's face

Two suggestions from Greg (admin; owner `001bb7a0`), relayed by the Overseer as queue item
`qi-peanctkn`, together with SPIDERYARN-READING2-8G (`spya-j6b69x`), whose note is
[261001_1034](261001_1034-a-nicer-ai-typeface-and-every-voice-in-its-face.md), and the typeface half
of `spya-bjbcxp` ([261001_1830](261001_1830-skim-in-the-author-s-and-the-model-s-faces.md)). The time
in the file name is f5fa66's, in London time.

`spya-f5fa66`, from Summary on `arxiv-2508-spya-wrzxkg`, 2026-10-01:

> Make sure Summary mode is using the AI-generated font. And check other modes too.
>
> see fonts.md

`spya-rp8cr4`, 2026-10-02:

> In Structure mode - if the headlines are AI-generated, they should be in AI-generated-font.
>
> Ideally, it would use author-font if the headlines were preserved from the author, but I don't know
> how often the author's headlines actually get preserved in practice, and that might add more
> complexity than it's worth.

And Greg's answer to 261002b's question, which became the job:

> Yes they should now be used throughout and always going forwards. Try and build this in a clean,
> general, robust way, which might require some cleaning up/refactoring.
>
> — Greg, 2026-10-02

**Ending: Shipped** to `dev` (commits `9b4b7a933` and `75dc3d59d`). It needs a deploy; there is no
migration.

- **f5fa66:** Summary's text was already in the AI face from `dab30ed19` (261002b's trawl), as were
  the other modes, but only behind the Experimental switch. **The faces are now on for every reader,
  on every page, and the switch's path is deleted** rather than left on. Experimental features
  keeps everything else it gated.
- **rp8cr4:** it turned out not to be complex. The tree already records which titles are the author's
  heading kept (`sourceHeading`), and the pipeline already compares them. So a Structure title is in
  the author's serif when it *is* the author's heading, and in the AI face when the model wrote or
  rewrote it; "Notes" and "Before the first heading" are ours. The same goes for the spine's cards
  and for section titles in Quiz, Diagram's card, Skim, Marginalia and the Where card.
- **Beyond the reading view:** the shelf (its one-line blurb is the model's gist or, where there is
  none, the article's own excerpt, and each is now in its face), Metadata, /add, /profile, the public
  pages and the title editor.
- **"Clean, general, robust":** one module, `src/web/voice.ts`, decides how a voice becomes a face,
  and a test makes a new page or mode a type error until somebody says whose words it shows.
  [fonts.md](../project/fonts.md) says "always, going forwards", with your words.

GPT Sol reviewed the plan and the code; Playwright checked phone and laptop widths with the switch
off. The plan, with screenshots and what was left out on purpose:
[261002f](../plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md).

**For Greg:**
- **The public shelf's blurb stays in the app's face.** Voicing it needs a column on the public
  listing's query, which is one of the security defences, so I left it for you to decide.
- **Titles on pages that don't know about a rename** (the masthead, Metadata before a rename, a
  library search hit) stay in the app's face rather than guessing "author" and getting your rename
  wrong. Carrying the rename flag there is a small follow-up if you want it.
