---
reports: spya-mq05ww
ending: shipped
comment: Shipped: 22 cropped, captioned screenshots and 3 GIFs across 21 Help pages, and help-page.md says how to keep them true. Eight modes still have no picture; that is queued.
---
# Pictures in Help: cropped, captioned screenshots, and a few GIFs

SPIDERYARN-READING2-EK, from Greg (admin, proven by `scripts/feedback-reporter.ts` on the
production row), a suggestion, filed 2026-10-07 10:21 UTC on production from
`/help#what-it-is-for`. Overseer queue item `qi-88zjjkat`.

> Include lots of screenshots throughout Help, ideally cropped to highlight what's being described,
> with nice caption. Even better if some of those could be animated gifs, if that will help make it
> clearer to the reader.
>
> And minimal update to docs re Help to update/add going forwards.

**Ending: Shipped**, on `dev`. Plan
[261007l](../plans/261007l-help-screenshots-and-gifs.md), with GPT Sol's plan and code reviews
beside it.

- A Help page can now hold a picture: one Markdown image alone in its paragraph, its title the
  caption. A GIF carries a still for readers who ask for reduced motion.
- 22 screenshots and 3 GIFs, in 21 pages. The GIFs show pointing down the spine, stepping through
  Skim, and jumping and coming back. Every one is of an article on the public shelf.
- **The docs update:** [help-page.md § Pictures](../project/help-page.md#pictures) says how to add
  one. § Bringing it up to date, which is the deploy's Help step, now also asks whether a picture
  shows something that is no longer true. Each picture's entry in `src/web/help/help-images.ts` is
  the recipe to retake it.
- **New dependency:** `gifenc` (devDependency, MIT, no dependencies of its own), used by
  `scripts/frames-to-gif.ts`. ffmpeg and a looping `<video>` were the options passed over (plan
  § GIFs).
- **Not yet:** eight modes have no picture: FAQ, Learn, Chat, Debate, Referee, Marginalia, Plain
  and Illustrated. Their bands had nothing worth showing on a public article locally. Queued as
  `qi-hyx8fden`.
- **When the Help chatbot (`fbucftjt`) lands:** whichever of the two merges second regenerates its
  corpus, `WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts`, because the pages now
  hold image lines.
