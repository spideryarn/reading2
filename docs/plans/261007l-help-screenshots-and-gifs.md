# 261007l — Pictures in Help: cropped, captioned screenshots, and a few GIFs

Report `spya-mq05ww` (Sentry SPIDERYARN-READING2-EK), queue item `qi-88zjjkat`. Up:
[help-page.md](../project/help-page.md).

> Include lots of screenshots throughout Help, ideally cropped to highlight what's being described,
> with nice caption. Even better if some of those could be animated gifs, if that will help make it
> clearer to the reader.
>
> And minimal update to docs re Help to update/add going forwards.
>
> — Greg, 2026-10-07 (`spya-mq05ww`, filed from `/help#what-it-is-for`)

## Where it stands

Help became Markdown pages today ([261007e](261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md)).
The renderer, `src/web/help/help-markdown.tsx`, **throws on an image**, on purpose: these files are
ours, so anything it cannot draw is a red test, not a silently dropped construct. So pictures need
one new construct in the renderer, somewhere to keep the files, and the pictures themselves.

Two sessions are working near Help: `fbucftjt-help-chatbot-signed-out` (the *Ask about Spideryarn*
box: `HelpPage.tsx`, a new `HelpAsk.tsx`, and `tests/help-corpus.test.ts`, which writes every
page's Markdown into `src/help-corpus.generated.json`) and `fbtddvg2-guide-agent-on-open` (chat and
the command bar). This plan keeps off `HelpPage.tsx` and everything they add. The one overlap is
unavoidable and small: once both land, the corpus test will see image lines in the bodies and ask
to be regenerated — `WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts`, by whoever
merges second. A model reads `![alt](images/x.png "caption")` without trouble, so nothing there
needs to change.

## The design

### In the Markdown: one image, alone in its paragraph, with a title

```markdown
![The spine beside an article, with the orange box around what is on screen](images/spine-marks.png "The spine: one tinted block per part, and the orange box is your screen.")
```

- **The alt** says what is in the picture, for somebody who cannot see it.
- **The title is the caption**, drawn under the picture. Markdown has no caption syntax; the title
  is the one slot a plain CommonMark parser keeps, it shows as a tooltip on GitHub, and a model
  handed the raw file reads it as the caption.
- **The path is relative to the file**, `images/…` from a topic, `../images/…` from `modes/`,
  `guides/` or `questions/`, so the file shows its pictures on GitHub as well. The renderer takes
  the name after `images/`; a test checks that each path resolves from where its file is.

Drawn as `<figure><img width height alt loading="lazy" decoding="async"><figcaption>`, with a thin
rule and a small radius so a dark screenshot has an edge on a light page. **Refused, as everything
else is**: an image inline in a sentence, an image with no alt or no caption, one whose file is not
in the manifest, and an image inside a link. In the plain-text walk (search, `helpSectionText`) a
figure is its caption, so a caption is searchable.

### The files: `src/web/help/pages/images/`, and a manifest beside them

Under `src/web/` and not `docs/`, for `help-pages.ts`'s reason: `.vercelignore` prunes `docs/`.
**Imported one by one** in the manifest, as `shots.ts` and `help-pages.ts` do, so Vite hashes each
one, a redeploy cannot serve a stale picture, and a missing file fails the build. (The first draft
used `import.meta.glob`; changed while building, for consistency with the two files beside it and
because a missing file then fails the build rather than a test.)

`src/web/help/help-images.ts` is the manifest, `shots.ts`'s pattern: one entry per file with its
`w` and `h` (the `<img>`'s reserved box, so nothing jumps as it loads), what it shows, which
article, the window it was shot in, and the day. **That entry is the retake recipe** — `shots.ts`
learned on 2026-10-02 that a picture whose recipe was session scratch costs an afternoon to redo.

`tests/help-images.test.ts`:

- every file in the folder has an entry, and every entry a file;
- each entry's `w`/`h` match the file's header (PNG and GIF), the check
  `tests/landing-assets.test.ts` makes for the site's shots, and for the same reason;
- every image line in every page names an entry, resolves relative to its file, and has alt and
  caption; and every entry is used by at least one page — an orphan is a picture nobody updates;
- a size ceiling per file (PNG 350KB, GIF 1.5MB), because Help is read on phones.

### The pictures

**Only public or demo articles.** Every article in a picture is on the local `/read/public` shelf;
nothing from anybody's own library. Shot by a Sonnet subagent on this box, Playwright against
system Chrome ([browser-control.md](../project/browser-control.md)), by
[marketing-pages.md § Shooting a screenshot of the product](../project/marketing-pages.md#shooting-a-screenshot-of-the-product):
one idea per shot, no figures in the frame, nothing half-cut, no debug text or email address.
Cropped to the thing the passage describes. That means a 300px strip of spine with a card, not the
whole window. Captured at 2× and kept at 2× the size it is drawn, so it stays sharp. Then
`pngquant --quality 65-92 --speed 1`.

About twenty stills, one per page where a picture says what the words cannot easily say: the
reading view, the spine and its card, the gutter, the command bar, a passage's link, adding an
article, the bottom bar, and a mode's band for most modes (Structure, Summary, Glossary, Quotes,
Search, Citations, Skim, Learn, Chat, Debate, Sketch, Timeline, Ideas, FAQ, Referee). A mode whose
output is not already made for a public article is shot only if one run is cheap; otherwise it waits.

### GIFs, second, and only where motion is the point

Three candidates, where the thing being explained *is* a movement: pointing down the spine and
clicking a mark to jump there; typing a search and watching its marks land on the spine; the
bottom bar's More button opening. Each is 2 to 5 seconds, looping, small crop.

**The new dependency: `gifenc`, a devDependency** (1.0.3, MIT, pure JavaScript, no dependencies of
its own, works the same on the box and on the Mac). Frames are Playwright screenshots (PNG);
`@napi-rs/canvas`, already a dependency for PDFs, decodes them, and `gifenc` quantises and writes
the GIF. (The first draft added `pngjs` to decode; `@napi-rs/canvas` made it unnecessary.)
A committed `scripts/frames-to-gif.ts` (a folder of PNGs in, one GIF out) is the reusable part.
**Passed over:** `ffmpeg` (excellent GIFs, and it could turn Playwright's own video into one, but
it is a system package to install on the box, on the Mac, and in the box's build file); animated
WebP or a looping `<video>` (smaller and sharper, but a second rendering path, and GitHub shows
neither inline in Markdown, and iOS support for WebM is recent). If the GIFs turn out heavy, a
`<video>` is the upgrade.

### Keeping them current — the minimal docs update

[help-page.md](../project/help-page.md) gets a short **§ Pictures** (the syntax, where files go, the
manifest, the shooting rules by link to marketing-pages.md), and one more question in
**§ Bringing it up to date**, step 2: *does a picture now show something that is no longer true?
Retake it from its manifest entry, or delete it.* That section is already the deploy's step 4
brief ([overseer.md § Deploying](../project/overseer.md#deploying)), so the Overseer asks it at
every deploy without a change to overseer.md. Its § Keeping it current point 2 ("whoever changes what a reader
sees updates Help in the same commit") already covers a picture; no new rule.

**Passed over: a committed script that re-shoots every picture.** It would make a retake one
command, but it depends on which articles a given machine's local library holds and on mode output
already being cached, so it would be red more often than useful. The manifest entry is the recipe
instead. Worth revisiting if retakes turn out frequent.

## Stages

1. **The construct.** Renderer case (both walks), `help-images.ts`, the glob, `tests/help-images.test.ts`,
   CSS for the figure, red-first: a test page with an image line that throws today. One placeholder
   picture is enough to drive it; real ones follow. Docs (help-page.md § Pictures). Commit.
2. **The stills.** Subagent shoots; I choose, crop if needed, and write alt and caption into each
   page. Browser check of three pages, wide and phone width. Commit.
3. **The GIFs.** `gifenc` + `pngjs`, `scripts/frames-to-gif.ts`, the three GIFs. Commit.
4. GPT Sol code review (workspace-write), gates, push to `dev`, the note for `spya-mq05ww`.

GPT Sol reviews this plan before stage 1.

## GPT Sol's plan review, and what came of it

[261007l-help-screenshots-plan-review-sol.md](261007l-help-screenshots-plan-review-sol.md), verdict
*changes needed*:

- **P1** (the glob would have handed the manifest module objects, not URLs): moot — the manifest
  imports each file by name, as `shots.ts` does, which was also Sol's preferred shape.
- **P2** (the test could pass with nothing in it, or a placeholder): it asserts at least one picture
  and one use, a floor in bytes (2KB) and in pixels (240×80), and that a GIF has more than one frame;
  `frames-to-gif.ts` refuses a clip whose frames are all one picture.
- **P3** (2× underspecified): `w`/`h` are the file's pixels, the `<img>` gets half; said in
  `help-images.ts` and tested.
- **P4** (a looping GIF ignores reduced motion): taken. Every GIF has a **still**, a PNG the same
  size, drawn through `<picture><source media="(prefers-reduced-motion: reduce)">` instead; the test
  requires it. Passed over: stopping each GIF after five seconds, which a reader who scrolls to it
  later would find already stopped, and a `<video>` with controls (above).
- **P5** (`pngjs` has no types): moot, `pngjs` is gone; `gifenc`'s CommonJS build gets a small
  `scripts/gifenc.d.ts`.
- **P6** (the doc's recipe should run the new test): done in help-page.md § Bringing it up to date.
- **P7** (AST-based checks; an escaped quote in a caption): the renderer and test walk the tree;
  tests for two images in one paragraph (a soft break), in a list, inside a link, and a caption
  with `\"`.
