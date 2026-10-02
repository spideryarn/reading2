# Every feedback report, re-checked (2026-10-02)

Not one report's note. It has no `reports:` header on purpose, so it marks nothing covered and
`scripts/feedback-unswept.ts` still lists what it lists.

Greg, 2026-10-02:

> can you schedule a larger Feedback-reports careful re-check at some point, because I think there
> are lots more Feedback-reports I've submitted that haven't been acted on and might have been lost.

**Why some could have been lost.** Until 2026-10-02 the sweep read only Sentry, and Sentry's copy
was often never sent. Only 44 of the rows ever got `mirrored_at`
([261002b postmortem](../postmortems/261002b-a-pipeline-whose-only-consumer-reads-the-lossy-copy.md)).
`mirrored_at` turned out to undercount: many rows without it did reach Sentry.

**How it was checked.** Every row in production `spideryarn.feedback`, read-only, for all time:
**336 rows**, 2026-09-04 to 2026-10-02 11:27 UTC. All of them are Greg's. Four more arrived during
the re-check (`spya-dvdt7y`, `spya-rp8cr4`, `spya-ba8kqp`, `spya-qcgyb0`, 13:00 UTC). They are
left to the regular sweep.

Each row was matched to the three places that record work on it:

- the `reports:` header of a note in this directory (274 rows have one);
- the Overseer queue's `source`;
- the gjd-remote session briefs in `~/gjd-remote/prompts/`, which name report ids even when the
  queue item names only a Sentry short id.

Six Sonnet subagents then compared each row's words with its note, `git log origin/dev` and the
code. For a row a note covers, they looked for a half the note had deferred. For a row nothing
covers, they searched by meaning. Every PARTLY and NEVER verdict was then checked by hand against
the session briefs and the queue. **Seven NEVER verdicts and two PARTLY ones were wrong: all nine were IN FLIGHT.**
A sweep at 12:16 UTC the same day had already queued and dispatched sessions for most of them.

## Counts

| Verdict | Reports |
|---|---|
| DONE | 263 |
| IN FLIGHT | 49 |
| PARTLY DONE | 16 |
| DECLINED/ANSWERED | 8 |
| NEVER ACTED ON | **0** |

**No report was lost outright.** Every one of the 62 rows with no note is now in a dispatched or
working session, or already shipped. Most of those sessions were started on 2026-10-01 and
2026-10-02, and many are still waiting to start. Until each one writes its note, its reports
still show as Not shipped on the Earlier tab.

**What was lost was the second half of reports marked shipped.** In 16 reports one part shipped,
and the note named the rest as deferred or "a follow-up". Then nothing picked the rest up, because
the note's `ending: shipped` took the whole report out of every sweep.

## Partly done, in plain words

Queued (authorised under [feedback-reports.md § Into the Overseer's queue](../project/feedback-reports.md)):

| Queue item | Priority | Reports | What is missing |
|---|---|---|---|
| `qi-8k6vjbzz` | 0.7 | `kzdmhb` (bug) | Live conversation still hangs in a noisy street. The stalls now explain themselves, but background sound still cuts it off. After `fbf4eq7p`. |
| `qi-43aa3nac` | 0.45 | `j5bsp7` | Glossary: "add it to the glossary" for a term you looked up. Needs stored per-reader entries. After `fbyqfzkm`. |
| `qi-srbwnnzz` | 0.45 | `f28vqj` | Shelf topic detail: a rich card when you hover an article under a topic. |
| `qi-djn8h9bn` | 0.4 | `a868zs`, `vskqfn` | Structure's cards and the reading-time line's tooltip open on hover only, never on a tap (iPad). |
| `qi-cbnydm7c` | 0.4 | `ayajv6`, `u3dgk7` | Marginalia: BUT/SO relation words and Timeline events in the margin. |
| `qi-qjtbt9je` | 0.4 | `s2rsxy` | High-powered AI chosen at import, not only on /metadata. |
| `qi-26wg8tdv` | 0.35 | `wxd4nq` | Illustrated: a text box with a microphone to steer the picture. |
| `qi-qczrxnye` | 0.35 | `k930hy` | Leave the paperwork out of Sketch, FAQ, Quiz and the other whole-piece modes, not only Summary. |
| `qi-jcgdpz6d` | 0.3 | `d896sz` | A where-am-I card when hovering the spine. After `fbm3pteb`. |

Not queued:

- `m0mcqb`: is the iPad battery still draining? One cause was fixed on 2026-09-12. The other
  measured cost, scroll painting, was named and not built. Greg, 2026-10-02:

  > It's a bit hard to be sure because my iPad's getting quite old. It definitely feels like it
  > drains a bit faster than I'd like, but it's not as big a problem. So I think if there's a fix
  > that you can make that looks promising, but won't add too much complexity, then definitely go
  > for it.

  Queued as session `fbm0mcqb-ipad-scroll-paint`.
- `ka23h9`: the images that did not import. The code fix is on dev, but re-running the affected
  articles is a production write. Greg, 2026-10-02: *"No, don't bother. I mostly care about
  [articles] going forward."* Declined; the fix on dev covers new imports.
- `a5gzb9`: already on [awaiting-approval.md](awaiting-approval.md).
- `jk5qxu` and `pexkj4`: small leftovers Greg offered as optional ("better still"), or a collapsed
  box inside a dialog that otherwise shipped.

**Superseded:** `f602m6` ("why no scroll bar on iPad?") by Greg's own `af6hy8` a minute later ("there
IS one, it's just hard to see"), which is in `fb9e-9f-9g`'s brief. `qxufp9` (defer the Hierarchy
summaries) was declined, and Summary has since dropped Parts & Sections.

**Sessions now redundant:** `fbnkjpte-metadata-search-aliases` is still waiting to start, but its
report shipped in `22ea449bd` (261002c). `fb8x-91-8z-rail-box-and-ai-type` and
`fb9a-marginalia-typeface-by-voice` overlap the typeface trawl (`dab30ed19`). The Overseer may want
to call off the first one, and to check the other two before they start.

## Every report

"Evidence" is a commit, a note in this directory, a session or a queue item. A session counts as
IN FLIGHT even while it is waiting to start (`gjd-remote ls` shows "waits").

| # | Report | Filed | Kind | Asked | Verdict | Evidence |
|---|---|---|---|---|---|---|
| 1 | `spya-us5kzc` | 2026-09-02 | — | test submission | DECLINED/ANSWERED | note 260902_2100 declined |
| 2 | `spya-z6daky` | 2026-09-03 | problem | I was in Remember / Quiz mode (https://www.spidery | DONE | note 260903_0253-quiz-gave-up-after-switching-modes.md |
| 3 | `spya-n3a4ty` | 2026-09-03 | problem | Building the hierarchy   Building the hierarchy di | DONE | note 260903_1322-hierarchy-failed-on-mn10.md |
| 4 | `spya-bqwm97` | 2026-09-03 | problem | couldn't upload PDF | DONE | note 260903_1557-couldnt-upload-pdf.md |
| 5 | `spya-pgkz22` | 2026-09-04 | problem | I tried to use the glossary check the web option,  | DONE | note 260904_1230-glossary-check-the-web-said-it-doesnt-exist.md |
| 6 | `spya-j5bsp7` | 2026-09-04 | suggestion | glossary box to look up a term and add it | PARTLY DONE | note 260904_1301; plan; queued qi-43aa3nac |
| 7 | `spya-bpvrwn` | 2026-09-04 | suggestion | The Hierarchy mode should perhaps default to showi | DONE | note 260904_1233-hierarchy-should-default-to-spine-l1-l2.md |
| 8 | `spya-uzggbn` | 2026-09-04 | suggestion | Clicking on web links seems broken somehow on iPad | DONE | note 260904_1240-links-should-open-in-a-new-tab.md |
| 9 | `spya-zhkutu` | 2026-09-04 | problem | I am using the microphone button on the feedback d | DONE | note 260904_1241-dictation-misspells-spideryarn.md |
| 10 | `spya-wxd4nq` | 2026-09-04 | suggestion | illustrated: prompt box with mic; text in images | PARTLY DONE | note 260904_1244; 260904a research; queued qi-26wg8tdv |
| 11 | `spya-xf6yh8` | 2026-09-04 | suggestion | We have this idea of experimental features. The on | DONE | note 260904_1248-only-the-sketch-is-good-enough-for-everyone.md |
| 12 | `spya-safz04` | 2026-09-04 | suggestion | footnotes numbered, way back | DONE | note 260904_1258 shipped |
| 13 | `spya-kbzzk8` | 2026-09-04 | suggestion | better speech-to-text than Whisper | DECLINED/ANSWERED | note 260904_1259 declined |
| 14 | `spya-g0sg5g` | 2026-09-04 | suggestion | In the feedback dialogue box, we have a little lin | DONE | note 260904_1300-bug-report-guidance-by-kind.md |
| 15 | `spya-zfcp5x` | 2026-09-04 | suggestion | Always centre the Text view within its column when | DONE | note 260904_1720-centre-the-text-view-in-its-column.md |
| 16 | `spya-p3gz7v` | 2026-09-04 | — | archive article, optional permanent delete | DONE | note 260904_1722; plan 260906h (DeleteArticle in src) |
| 17 | `spya-z8cqke` | 2026-09-04 | — | The keyboard on mobile devices should have a Done/ | DONE | note 260904_1723-mobile-keyboard-done-send-button.md |
| 18 | `spya-trkk64` | 2026-09-05 | — | Add a /contact page and link to it appropriately.  | DONE | note 260905_0731-add-a-contact-page.md |
| 19 | `spya-jtqf22` | 2026-09-05 | problem | The microphone input (eg for Feedback dialog box)  | DONE | note 260905_0734-dictation-includes-ums-and-ahs.md |
| 20 | `spya-a4rfbk` | 2026-09-05 | suggestion | mic-offline: disable/retry/fallback | DONE | note 260905_0737; plan 260905c |
| 21 | `spya-y60g38` | 2026-09-05 | problem | sluggish mode switching, long article | DONE | note 260905_0741; plan 260905d; later A8 geometry work |
| 22 | `spya-cr2st2` | 2026-09-05 | suggestion | After submitting a bit of feedback in the feedback | DONE | note 260905_0743-a-more-appreciative-thank-you.md |
| 23 | `spya-nhddz6` | 2026-09-05 | problem | send button icon, more prominent | DONE | note 260912_0828; plan 260912c; Playwright WebKit check |
| 24 | `spya-puyb6d` | 2026-09-05 | suggestion | glossary check-web labels, citations | DONE | note 261001_1200; af0bf0a30 Dig deeper |
| 25 | `spya-dfghb4` | 2026-09-05 | suggestion | If I click on the Sketch or Illustrated images in  | DONE | note 260905_0758-click-a-diagram-to-enlarge-it.md |
| 26 | `spya-ssfnsd` | 2026-09-05 | — | For the Illustrated diagram, if I have clicked Enl | DONE | note 260905_0800-enlarged-diagram-prompt-in-a-column.md |
| 27 | `spya-y8w885` | 2026-09-05 | problem | I tried to click on a blue Comment box in the vert | DONE | note 260905_0807-comment-chip-opened-a-new-comment.md |
| 28 | `spya-rfyhjy` | 2026-09-05 | suggestion | mark ? press as help request | DONE | note 260905_0810; plan 260905c |
| 29 | `spya-nv5bzx` | 2026-09-05 | suggestion | Light/Dark/System switch on Profile | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbnv5bzx-light-dark-system starts Sat 03 Oct 19:37 BST; no commit, no code (design-css-overview.md 'dark only, no toggle, no prefers-color-scheme', Greg 2026-08-24) |
| 30 | `spya-m92n7z` | 2026-09-05 | suggestion | When I click the question-mark-comment in vertical | DONE | note 260905_0833-the-explanation-should-teach.md |
| 31 | `spya-mxsans` | 2026-09-05 | — | Alongside permalink, comment, question mark button | DONE | note 260912_0816-gutter-bookmark-button-and-the-second-ellipsis.md |
| 32 | `spya-gnvstb` | 2026-09-05 | problem | It's only showing the Summary column, not the Text | DONE | note 260905_0933-ipad-landscape-shows-only-the-summary-column.md |
| 33 | `spya-tm8pjw` | 2026-09-05 | — | Move the Design link on the logged-in Homepage int | DONE | note 260905_0936-move-the-design-link-into-admin.md |
| 34 | `spya-xgn06m` | 2026-09-05 | — | The Feedback and Logo get in the way at the top of | DONE | note 260930_2233-bottom-bar-spacing-feedback-circle-and-small-feedback-fixes.md |
| 35 | `spya-zbcchv` | 2026-09-05 | — | Tweak the prompt that generates the Summary mode t | DONE | note 260905_0954-socratic-questions-in-summary-mode.md |
| 36 | `spya-n2hzwm` | 2026-09-05 | suggestion | If I close and then reopen an article, it should i | DONE | note 260905_0957-reopen-an-article-where-you-left-it.md |
| 37 | `spya-c3kuwf` | 2026-09-05 | problem | comment asking evidence did not search | DONE | note 260905_1001 (prompt fix) |
| 38 | `spya-gpxr4y` | 2026-09-05 | suggestion | highlights of best passages | DONE | note 260905_1754 (whole quote list marked) |
| 39 | `spya-ps33a7` | 2026-09-05 | suggestion | quiz easier, prioritised | DONE | note 260905_1800 shipped |
| 40 | `spya-ws4765` | 2026-09-05 | — | In the feedback box, it has the following: "It is  | DONE | note 260905_1802-personal-email-out-of-the-ui.md |
| 41 | `spya-vgwt4z` | 2026-09-05 | suggestion | spinner on feedback Send | DECLINED/ANSWERED | note 260905_1802 declined (flicker deliberate) |
| 42 | `spya-ed94jx` | 2026-09-05 | suggestion | I quite like some of these new Socratic questions  | DONE | note 260905_1803-only-the-socratic-question.md |
| 43 | `spya-k7x6vz` | 2026-09-05 | — | For the Remember mode button, use a brain icon | DONE | note 260905_2050-brain-icon-for-remember-mode.md |
| 44 | `spya-sfj0e9` | 2026-09-05 | — | Add a button in Quotes mode to find more | DONE | note 260905_2052-a-button-to-find-more-quotes.md |
| 45 | `spya-sgf8g6` | 2026-09-05 | — | I'm still not seeing a Flag/Bookmark icon in the v | DONE | note 260912_0816-gutter-bookmark-button-and-the-second-ellipsis.md |
| 46 | `spya-a689m4` | 2026-09-05 | problem | Debate mode didn't work.  Asking the web did not f | DONE | note 260905_2105-debate-and-glossary-did-not-finish.md |
| 47 | `spya-sze5ug` | 2026-09-05 | problem | These were written before entries said where each  | DONE | note 260905_2105-debate-and-glossary-did-not-finish.md |
| 48 | `spya-vr6m34` | 2026-09-06 | suggestion | upload HTML file; PDF URL works | DONE | note 260906_1709; PDF URL already worked, HTML upload built; relative-figure case deliberately deferred |
| 49 | `spya-rznv3m` | 2026-09-06 | suggestion | better dictation transcriber w/ vocabulary | DONE | note 260906_1710-dictation-onto-a-better-transcriber.md |
| 50 | `spya-bsmmam` | 2026-09-07 | problem | monkeys illustration not loading | DONE | note 260907_0735-the-monkeys-illustration-does-not-load.md |
| 51 | `spya-j0xw7s` | 2026-09-07 | — | Feedback button on logged-in homepage | DONE | note 260907_1732-feedback-button-on-the-logged-in-homepage.md |
| 52 | `spya-gud39s` | 2026-09-07 | — | more command-bar commands, move left of Dock | DONE | note 260907_1737-more-commands-in-the-command-bar.md |
| 53 | `spya-jj939h` | 2026-09-07 | suggestion | remove black empty bar at top | DONE | note 260907_1739-black-empty-bar-at-the-top-in-structure-mode.md |
| 54 | `spya-a353as` | 2026-09-07 | problem | dock always visible in iPhone landscape | DONE | note 260907_1741-dock-always-visible-in-landscape.md |
| 55 | `spya-cs905a` | 2026-09-07 | — | gutter icons only on selected block on touch | DONE | note 260907_1742-gutter-icons-on-touch.md |
| 56 | `spya-e3jcck` | 2026-09-07 | — | iPhone feedback dialog zoom | DONE | note 260907_1744-iphone-feedback-dialog-zoom.md |
| 57 | `spya-bwgdrh` | 2026-09-07 | problem | glossary order button untappable on touch | DONE | note 260907_1746; never reproduced, hardened (40px, 16px fields); fix unproven |
| 58 | `spya-fjajs7` | 2026-09-07 | suggestion | exact time + duration tooltips on Metadata steps | DONE | note 260907_1917-exact-time-and-duration-on-the-step-rows.md |
| 59 | `spya-xa64uq` | 2026-09-08 | suggestion | always show quote borders in every mode | DONE | note 260908_1742-quotes-marked-in-every-mode.md |
| 60 | `spya-gazstp` | 2026-09-08 | suggestion | outline rows show more text | DONE | note 260908_1744-outline-rows-wrap-instead-of-truncating.md |
| 61 | `spya-y8va9d` | 2026-09-08 | problem | mic permission asked twice on iPhone | DONE | note 260908_1745-microphone-permission-asked-twice-on-iphone.md |
| 62 | `spya-ava6u7` | 2026-09-08 | — | Structure subsumes Outline | DONE | note 260908_1916-structure-mode-subsumes-outline.md |
| 63 | `spya-cuxy49` | 2026-09-10 | suggestion | quotes: fade by priority, more quotes, Find more | DONE | note 260910_2043-quotes-find-more-and-a-fade-that-carries-priority.md |
| 64 | `spya-yd2c47` | 2026-09-10 | suggestion | Show Quotes marks in the spine, in the outline colour | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbyd2c47-quotes-spine-tooltip-nav starts Sat 03 Oct 09:36 BST; quotes.md says quotes reach the prose in every mode but 'the spine rail ... in none' (reports spya-cuxy49 sibling note 260910_2043 did not touch it) |
| 65 | `spya-gcdwps` | 2026-09-10 | problem | compact Quotes/Glossary on landscape phone; check other modes | DONE | note 260910_2051-quotes-and-other-bands-on-a-landscape-phone.md |
| 66 | `spya-q4mud4` | 2026-09-11 | — | quotes prompt diversity | DONE | note 260911_1309-quotes-prompt-emphasises-diversity.md |
| 67 | `spya-mghbv7` | 2026-09-11 | — | click diagram to enlarge | DONE | note 260905_0758-click-a-diagram-to-enlarge-it.md |
| 68 | `spya-mtyquy` | 2026-09-11 | suggestion | Quote tooltip with scores, prev/next buttons, Quotes-mode big prev/next + left/right keys | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbyd2c47-quotes-spine-tooltip-nav (name suggests it covers this); no prev/next or ArrowLeft/Right in QuotesPanel.tsx, no tooltip on prose quote marks |
| 69 | `spya-xz7ajs` | 2026-09-11 | suggestion | Citations mode | DONE | note 260911_2112; plan 260911g; Find more deferred, marks in prose shipped via spya-tvhk2j |
| 70 | `spya-cjjvp4` | 2026-09-12 | suggestion | render LaTeX equations | DONE | note 260912_0804-equations-render-as-raw-latex.md |
| 71 | `spya-dmkuby` | 2026-09-12 | problem | Figure 2 image not displayed | DONE | note 260912_0805-figure-2-image-did-not-display.md |
| 72 | `spya-zv8dc6` | 2026-09-12 | suggestion | extra diagnostics attach source file | DONE | note 260912_0806-diagnostics-carry-the-source-file.md |
| 73 | `spya-ebdfrt` | 2026-09-12 | suggestion | two Structure columns on landscape iPad | DONE | note 260912_0808-structure-columns-after-an-ipad-rotation.md |
| 74 | `spya-ftvnk3` | 2026-09-12 | problem | orientation switch messes rendering (confirms 73) | DONE | note 260912_0808 (shared with spya-ebdfrt) |
| 75 | `spya-ycs3qh` | 2026-09-12 | suggestion | Hierarchy experimental, Structure for all | DONE | note 260912_0812-hierarchy-experimental-structure-for-everyone.md |
| 76 | `spya-m0mcqb` | 2026-09-12 | problem | iPad battery drains fast | PARTLY DONE | 892754f04 fixed the 8-second poll; scroll paint cost named, not built; question for Greg |
| 77 | `spya-xcguqc` | 2026-09-12 | suggestion | gutter bookmark button | DONE | note 260912_0816-gutter-bookmark-button-and-the-second-ellipsis.md |
| 78 | `spya-u24r88` | 2026-09-12 | problem | remove second ... in gutter menu | DONE | note 260912_0816-gutter-bookmark-button-and-the-second-ellipsis.md |
| 79 | `spya-fsryfr` | 2026-09-12 | problem | dictation faster on weak wifi | DONE | note 260912_0818-dictation-slow-on-weak-wifi.md |
| 80 | `spya-nyvnwu` | 2026-09-12 | suggestion | FAQ mode (experimental) | DONE | note 260912_0819-faq-mode.md |
| 81 | `spya-u0vpys` | 2026-09-12 | — | drop 'use your profile' checkbox | DONE | note 260912_0821-drop-the-use-your-profile-checkbox.md |
| 82 | `spya-g3ztpc` | 2026-09-12 | suggestion | longer self-sufficient quotes | DONE | note 260912_0823-quotes-long-enough-to-stand-on-their-own.md |
| 83 | `spya-kcdabx` | 2026-09-12 | suggestion | comment questions can use web search | DONE | note 260912_0827-comment-questions-reach-for-the-web-and-the-citations-list.md |
| 84 | `spya-gnq9fb` | 2026-09-12 | problem | send button icon, bigger, outlined | DONE | note 260912_0828; icon/primary style shipped, device check left to Greg |
| 85 | `spya-z39d04` | 2026-09-12 | suggestion | citations list tool for chat/comments | DONE | note 260912_0827-comment-questions-reach-for-the-web-and-the-citations-list.md |
| 86 | `spya-qcaffs` | 2026-09-12 | suggestion | live button says Resume wrongly | DONE | note 260912_0833-live-button-says-resume-before-any-live-conversation.md |
| 87 | `spya-uvxq8e` | 2026-09-12 | suggestion | Citations mode also surfaces authors/affiliations with links to top results | IN FLIGHT | authors shipped 3f172e525; the Citations half is session fbuvxq8e (qi-kd4rqz9p) |
| 88 | `spya-pukg0x` | 2026-09-12 | suggestion | Tweets auto-generates on open | DONE | note 260912_1021-tweets-page-starts-writing-when-opened.md |
| 89 | `spya-jk5qxu` | 2026-09-12 | suggestion | flash block (or citing part) on mode link | PARTLY DONE | note 260912_1023; 62e1a7f2, 260930_1545; not queued: the exact-part highlight exists only for Citations, and Greg asked for it as "better still" |
| 90 | `spya-csakjh` | 2026-09-12 | suggestion | Citations 'Find it' explain | DONE | note 260912_1024-find-it-button-say-what-it-does.md |
| 91 | `spya-tvhk2j` | 2026-09-12 | suggestion | mark citations in main text | DONE | note 260912_1026-always-indicate-citations-in-the-main-text.md |
| 92 | `spya-a868zs` | 2026-09-12 | suggestion | rich tooltips in Structure mode | PARTLY DONE | note 260912_1027; plan 260916b; queued qi-djn8h9bn |
| 93 | `spya-g2nd07` | 2026-09-12 | suggestion | logo animations not showing | DONE | note 260912_1032-logo-animations-not-showing.md |
| 94 | `spya-xaaygb` | 2026-09-12 | suggestion | mode name/explanation when mode opens | DONE | note 260912_1043-mode-name-when-a-mode-opens.md |
| 95 | `spya-gxzbuj` | 2026-09-12 | suggestion | Earlier-feedback tab in dialog | DONE | note 260912_1045; plan 260916c; Earlier tab shows Shipped via notes (49a36fd73, fb5a38634) |
| 96 | `spya-fyaaxq` | 2026-09-12 | suggestion | prioritised default for Search | DONE | note 260912_1215-prioritised-by-default-and-lower-thresholds.md |
| 97 | `spya-dc6ab9` | 2026-09-12 | suggestion | Search card opens from score only | DONE | 4b512dae2 |
| 98 | `spya-hbbrfp` | 2026-09-12 | suggestion | Public-shelf link in all footers | DONE | note 260912_1104; plan 260916a |
| 99 | `spya-m8urv9` | 2026-09-12 | — | '?' prompt -> Help me understand | DONE | note 260912_1119; plan 260915d |
| 100 | `spya-ref23e` | 2026-09-12 | problem | React error #185 in ? answer | DONE | note 260912_1120; plan 260915a |
| 101 | `spya-r9w4mx` | 2026-09-12 | problem | iPad link tap opens page not card | DONE | note 260912_1209; plan 260915a |
| 102 | `spya-yxcdxn` | 2026-09-12 | suggestion | Lower prioritised thresholds | DONE | note 260912_1215; plan 260915d |
| 103 | `spya-sg53hn` | 2026-09-12 | suggestion | Shelf actions on touch | DONE | 6fe0ecb1b |
| 104 | `spya-d3a7bf` | 2026-09-12 | suggestion | Reading-time indicator + robust back-to | DONE | f803b076b; note 260912_1227 x2 |
| 105 | `spya-kzdmhb` | 2026-09-12 | problem | Live voice conversation hangs on phone | PARTLY DONE | note 260912_1639; plan 260915b; queued qi-8k6vjbzz |
| 106 | `spya-ygj9xz` | 2026-09-26 | suggestion | Plainer summaries and glossary | DONE | note 260926_0238; plan 260926a |
| 107 | `spya-bhdst4` | 2026-09-28 | — | Trajectory rows show quote text | DONE | note 260928_2057; plan 260928e |
| 108 | `spya-m7xpxx` | 2026-09-29 | — | Bigger gutter icons | DONE | 8188cc54d |
| 109 | `spya-sdxwwa` | 2026-09-29 | — | Remove Hierarchy mode | DONE | note 260929_0100 |
| 110 | `spya-m0cp58` | 2026-09-29 | suggestion | Run mode AI generation in parallel | DONE | note 260929_0509; ba98a380 |
| 111 | `spya-qx08ep` | 2026-09-29 | suggestion | Compact Trajectory position mark | DONE | fb21841fb |
| 112 | `spya-vyxtrt` | 2026-09-29 | — | Reorder mode bar, add separators | DONE | 8188cc54d |
| 113 | `spya-cbfwx2` | 2026-09-29 | — | Experimental toggle looks like switch | DONE | 8188cc54d |
| 114 | `spya-dmuaqw` | 2026-09-29 | suggestion | Glossary header less space | DONE | note 260929_0043 |
| 115 | `spya-mcsgxu` | 2026-09-29 | suggestion | Glossary kind labels to icons | DONE | note 260929_0045 |
| 116 | `spya-ewtasn` | 2026-09-29 | — | Authors/affiliations at import, shown, linked | DONE | note 260929_1005; plan 260929d |
| 117 | `spya-jjsta2` | 2026-09-29 | suggestion | Trajectory opens on first stop + Back to | DONE | fb21841fb |
| 118 | `spya-vafkvw` | 2026-09-29 | suggestion | Block-link jumps land centred | DONE | fb21841fb |
| 119 | `spya-sc9s8p` | 2026-09-29 | suggestion | Trajectory: Go round again / More detail buttons | DONE | fb21841fb |
| 120 | `spya-mgedkp` | 2026-09-29 | suggestion | Trajectory deeper levels use different snippets | DONE | plan 260929e |
| 121 | `spya-ydhg7h` | 2026-09-29 | suggestion | Strip leading numbers from headings | DONE | note 260929_0100-strip-heading-numbers |
| 122 | `spya-cyzsy4` | 2026-09-29 | suggestion | Diagram behind Experimental switch | DONE | 8188cc54d |
| 123 | `spya-qdjdsb` | 2026-09-29 | suggestion | Explain grey line beside blocks | DONE | 8188cc54d; abe1d662c |
| 124 | `spya-g3wzc5` | 2026-09-29 | suggestion | Shelf topic pills: overlap, vague words | DONE | plan 260929a-shelf-topics; note 260929_0117 |
| 125 | `spya-f28vqj` | 2026-09-29 | suggestion | Topic bar tooltip, drop N of M, narrower bars, rich paper tooltips | PARTLY DONE | 7ce6b35bc; queued qi-srbwnnzz |
| 126 | `spya-tw6zxw` | 2026-09-29 | suggestion | Topics tooltip, remove Sort label | DONE | 7ce6b35bc |
| 127 | `spya-ch8u3a` | 2026-09-29 | suggestion | Shelf archived toggle at top | DONE | note 260929_0127 |
| 128 | `spya-qd4r8j` | 2026-09-29 | suggestion | Remove shelf tagline | DONE | note 260929_0240 |
| 129 | `spya-batuwx` | 2026-09-29 | suggestion | Logo beside wordmark; Beta right | DONE | note 260929_0240 |
| 130 | `spya-sm0hyk` | 2026-09-29 | suggestion | Hide zero-match topic pills | DONE | note 260929_0134 |
| 131 | `spya-dkm0ue` | 2026-09-29 | suggestion | Merge re-run/reset sections in Metadata | DONE | note 260929_0355; 7ce6b35bc |
| 132 | `spya-gubw6p` | 2026-09-29 | suggestion | Back links become icons | DONE | aaa972f83 |
| 133 | `spya-z9wwam` | 2026-09-29 | suggestion | Trajectory deeper passes add detail, no go-round | DONE | note 260929_0148 |
| 134 | `spya-sgfxuv` | 2026-09-29 | suggestion | Trajectory promise text into tooltip | DONE | note 260929_0149 |
| 135 | `spya-utrvyj` | 2026-09-29 | suggestion | Remove redo buttons from modes | DONE | note 260929_0355 |
| 136 | `spya-a6xsr2` | 2026-09-29 | suggestion | Trajectory list scrolls with stop | DONE | note 260929_0151 |
| 137 | `spya-n3t8v5` | 2026-09-29 | suggestion | Drop older-prompt notice | DONE | note 260929_0421 |
| 138 | `spya-ptm8bm` | 2026-09-29 | problem | Visitors see stored modes on public article | DONE | note 260929_0525; plan 260929c |
| 139 | `spya-g8a0s8` | 2026-09-29 | suggestion | Reorder Glossary/Ideas/Timeline/Search in bar | DONE | note 260929_1435 |
| 140 | `spya-srek7a` | 2026-09-29 | suggestion | Feedback thank-you as toast | DONE | note 260929_1540 |
| 141 | `spya-kd5dk5` | 2026-09-29 | suggestion | Move gutter icons to the block's right side, bigger vertical gaps | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbkd5dk5-gutter-icons-right starts Sat 03 Oct 04:35 BST; icons still in left gutter (a9373e1ca 'bare bookmarks stay in the gutter') |
| 142 | `spya-buj2gb` | 2026-09-29 | suggestion | Trajectory snippets expand in place (FAQ, ideas) | DONE | note 260929_1435; plan 260929f |
| 143 | `spya-v6rjvy` | 2026-09-29 | suggestion | Tweets become normal mode + block links | DONE | note 260929_1540; plan 260929f |
| 144 | `spya-a0ep9m` | 2026-09-29 | problem | Dictation cut off at ~2.5 min | DONE | note; plan 260929f; parts every 2 min |
| 145 | `spya-d896sz` | 2026-09-29 | suggestion | Trajectory icons, question first, sparkline, where-am-i | PARTLY DONE | note; plan 260929f; WhereCard.tsx; queued qi-jcgdpz6d |
| 146 | `spya-p6s5a4` | 2026-09-29 | suggestion | Separate sign-in page | DONE | note; plan |
| 147 | `spya-bumjmy` | 2026-09-29 | suggestion | Space between bottom-bar icons | DONE | note 260930_2233 |
| 148 | `spya-m3pteb` | 2026-09-29 | suggestion | Thin breadcrumb of headings at top of reading view, experimental-only, with web research | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbm3pteb-headings-breadcrumb starts Sat 03 Oct 09:36 BST; no breadcrumb component in src/web |
| 149 | `spya-j5f7yv` | 2026-09-29 | suggestion | Public articles vs personalisation design | DECLINED/ANSWERED | note ending declined, design written (someday maybe) |
| 150 | `spya-pexkj4` | 2026-09-29 | suggestion | Ask background/purpose on first open, plus profile box and mic | PARTLY DONE | note; 32a4e5076 (PurposePrompt on first open, autosaving; mic via ProfileBox); not queued: only the collapsed profile box inside the first-open dialog is missing |
| 151 | `spya-k3q9mc` | 2026-09-29 | problem | iPhone mic warning; LLM tidy-up question | DONE | note 260929_1517; bc4ac3f2 |
| 152 | `spya-yyf38a` | 2026-09-29 | suggestion | FAQ big questions first, difficulty/centrality threshold | DONE | note; plan 260929g |
| 153 | `spya-vz9r0h` | 2026-09-29 | suggestion | Shelf search box focus | DONE | note; plan 260929g |
| 154 | `spya-kh58z7` | 2026-09-29 | suggestion | Cmd-Enter opens Metadata + tooltip | DONE | note; research 260929a |
| 155 | `spya-emvua7` | 2026-09-29 | suggestion | Citations say whether paper read, quote it | DONE | note; c2d63f06, 229d363b follow-up reads paper |
| 156 | `spya-wsz0q4` | 2026-09-29 | suggestion | Guessed web link for uploaded paper | DONE | note 260929_1800 |
| 157 | `spya-ddpn5x` | 2026-09-29 | suggestion | Use ChatGPT subscription; research plan only | DECLINED/ANSWERED | note declined; plan written; Greg: out of scope |
| 158 | `spya-pjede5` | 2026-09-29 | suggestion | Admin vs other-user feedback trust tiers | DONE | note 260929_2025; feedback-reports.md |
| 159 | `spya-bukkzu` | 2026-09-29 | suggestion | Dictation survives closed tab | DONE | note 260929h; plan reviewed |
| 160 | `spya-f4eq7p` | 2026-09-29 | suggestion | Clean up live voice chat: latest OpenAI model, instant mode, terse prompt, level meter, one transcript place, hide advanced | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbf4eq7p-live-voice-chat-cleanup starts Fri 02 Oct 23:34 BST; code still on gpt-realtime-2.1 (src price table), no GPT Live; earlier repair 7eb8f2a00 predates this report |
| 161 | `spya-wh2xys` | 2026-09-29 | suggestion | Command bar: many more commands, parameters, shared with chat tools, jump-to-first-place tool | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbwh2xys-commands-with-arguments starts Sun 04 Oct 00:38 BST; related live session fb8d-commands-and-interface-llm (qi-gwp9epnd, 8D) covers the Metadata-actions part only |
| 162 | `spya-ayajv6` | 2026-09-29 | suggestion | Annotations/marginalia mode drawing on other modes | PARTLY DONE | note; 261001d, 261001i, b1af6f07b (FAQ/Debate/Citations/comments in margin), 88400b63e; queued qi-cbnydm7c |
| 163 | `spya-j78fff` | 2026-09-29 | suggestion | Snappier loads: prefetch top 5 shelf articles, safe caching | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbj78fff-snappier-article-loads starts Sat 03 Oct 14:36 BST; no prefetch of shelf articles in code |
| 164 | `spya-t0exj8` | 2026-09-29 | suggestion | Shelf topic colours by relatedness | DONE | note 260930_0425 |
| 165 | `spya-w7t24d` | 2026-09-29 | suggestion | Debate mode source clarity, orders, threshold | DONE | note; plan 260929h; 6c1b2cd2 visitors; authors/year via Crossref |
| 166 | `spya-ng89zf` | 2026-09-29 | suggestion | Bottom-bar spacing | DONE | note 260930_2233 |
| 167 | `spya-peszam` | 2026-09-29 | suggestion | Remember single thread | DONE | note; plan 261001m |
| 168 | `spya-xunuum` | 2026-09-29 | suggestion | Remember Reply dropdown tooltip | DONE | note 261001_1200; 7ce6b35b |
| 169 | `spya-vp4mdn` | 2026-09-29 | — | Gift vouchers /admin/vouchers + free allowance box | DONE | note; f83f9a453, b68513105 (codes deliberately not built) |
| 170 | `spya-wtm6qx` | 2026-09-29 | suggestion | Citations Investigate button | DONE | note; plan 260930a; follow-up reads paper |
| 171 | `spya-mxntdt` | 2026-09-29 | suggestion | Link cited work already in Spideryarn | DONE | note; 5ea78053, 7be9de08 |
| 172 | `spya-xxt0z5` | 2026-09-29 | suggestion | Several searches in parallel | DONE | note 260930_1047 |
| 173 | `spya-jc2ub9` | 2026-09-29 | suggestion | Quiz: easier building questions | DONE | note 260929_2135 |
| 174 | `spya-c7807j` | 2026-09-29 | suggestion | Illustrated diagram uses paper figures | DONE | note 260929_2138 |
| 175 | `spya-sufetx` | 2026-09-29 | suggestion | Auto-generate main modes after import tick box | DONE | note; plan 260930c (opening before structure deferred, optional ideal) |
| 176 | `spya-uwbttu` | 2026-09-29 | suggestion | Cross-reference links in prose with hover | DONE | note; 4b4790e5, 6c1b2cd2 |
| 177 | `spya-esua8w` | 2026-09-29 | suggestion | Ask why reading + custom route for intent | DONE | note; plan 260930e; 32a4e5076; Skim 'Reading for' (SkimPurpose.tsx) |
| 178 | `spya-rze8qh` | 2026-09-29 | suggestion | Span-level highlights with colour and comment (research/plan or v1) | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbrze8qh-span-highlights starts Sat 03 Oct 19:37 BST; only block-level bookmarks/comments exist |
| 179 | `spya-ger3a3` | 2026-09-29 | suggestion | Banner on public-readable articles: source URL, takedown email, no-training statement, privacy link | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbger3a3-public-readable-banner starts Fri 02 Oct 18:34 BST; no such banner in reading view (only the /features/public-readable-sharing page exists) |
| 180 | `spya-hhdj7f` | 2026-09-30 | suggestion | Track read blocks; quiz only on read | DONE | note; tracking built 260912; 7a7785c6 |
| 181 | `spya-br6j7e` | 2026-09-30 | suggestion | FAQ promise text behind (i) | DONE | note 260930_0601 |
| 182 | `spya-bfcvxg` | 2026-09-30 | suggestion | Earlier tab filter by shipped | DONE | note 260930_0043 |
| 183 | `spya-jejbpz` | 2026-09-30 | suggestion | Metadata Run it without confirm | DONE | note; plan 260930e; d4c29a3f |
| 184 | `spya-tes039` | 2026-09-30 | suggestion | Start again folded into rerun section | DONE | note 260930_0745 |
| 185 | `spya-qgh5ta` | 2026-09-30 | suggestion | Merge What we did into Re-run AI processing | DONE | note 261001_1200; 7ce6b35b |
| 186 | `spya-xw9bd4` | 2026-09-30 | problem | Cmd-K on Metadata page | DONE | note 260930_0140 |
| 187 | `spya-m0ss7z` | 2026-09-30 | suggestion | FAQ sort by central/hardest | DONE | note 260930_0602 |
| 188 | `spya-szx49j` | 2026-09-30 | suggestion | Admin cost estimates on Metadata | DONE | note 260930_0209 |
| 189 | `spya-h3ac82` | 2026-09-30 | suggestion | PDF transcription glitches fixes | DONE | note; ebee390c, bbccf08c, f662af42, 7ea278ca (re-render of shelf articles left to Greg's Start again) |
| 190 | `spya-ka23h9` | 2026-09-30 | suggestion | Articles whose images did not import | PARTLY DONE | Readability fix on dev; the production re-runs were never run; question for Greg |
| 191 | `spya-tedd58` | 2026-09-30 | suggestion | Shelf rebuild for uploaded articles | DONE | note 260930_0700 |
| 192 | `spya-s2rsxy` | 2026-09-30 | suggestion | High-powered AI per article | PARTLY DONE | note; 8784aeee, 3b515253; docs high-powered-ai.md; queued qi-qjtbt9je |
| 193 | `spya-mrn6w0` | 2026-09-30 | problem | Shelf wordmark animations | DONE | note 260930_0140 |
| 194 | `spya-ka7ysy` | 2026-09-30 | suggestion | Simple (ELI15) summary sub-mode | DONE | note; plan 260930i (ELI12 deferred by choice) |
| 195 | `spya-vv68py` | 2026-09-30 | suggestion | Check prior work before building | DONE | note; feedback-reports.md step 'check it isn't already done or in flight' |
| 196 | `spya-yvwpek` | 2026-09-30 | suggestion | remove "rough note" text | DONE | 260930_2233-bottom-bar-spacing-feedback-circle-and-small-feedback-fixes.md |
| 197 | `spya-tmn904` | 2026-09-30 | suggestion | tweet column width on iPad | DONE | 260930_1420-tweets-band-fits-an-ipad-and-copy-buttons-become-icons.md |
| 198 | `spya-tdzq5b` | 2026-09-30 | suggestion | tweet copy buttons as icons | DONE | 260930_1420-tweets-band-fits-an-ipad-and-copy-buttons-become-icons.md |
| 199 | `spya-nca765` | 2026-09-30 | suggestion | Citations: less vertical space | DONE | 260930_0156-citations-count-and-notes-take-less-room.md |
| 200 | `spya-bjzvj9` | 2026-09-30 | suggestion | Citations: highlight citing words | DONE | 260930_1545-citations-name-the-citing-words-and-read-the-pdf-reference-list.md |
| 201 | `spya-tfa4wq` | 2026-09-30 | suggestion | Citations: authors/date/tooltip | DONE | 260930_1545-citations-name-the-citing-words-and-read-the-pdf-reference-list.md |
| 202 | `spya-r5gks8` | 2026-09-30 | suggestion | Debate: key themes and sources | DONE | 260930_0245-debate-themes-and-key-sources.md |
| 203 | `spya-pu7536` | 2026-09-30 | suggestion | changelog relative dates | DONE | 260930_0259-changelog-release-dates-as-relative-time.md |
| 204 | `spya-d9xdhs` | 2026-09-30 | suggestion | Earlier tab timestamps + ago doc rule | DONE | 260930_2233-bottom-bar-spacing-feedback-circle-and-small-feedback-fixes.md |
| 205 | `spya-ha9wa3` | 2026-09-30 | suggestion | quiz shaped by reading goal | DONE | 260930_2200-quiz-shaped-by-your-reading-goal.md |
| 206 | `spya-k3bt8c` | 2026-09-30 | suggestion | quiz per-section scoring v1 | DONE | 260930_1620-quiz-says-where-to-look-again-by-section.md |
| 207 | `spya-muymup` | 2026-09-30 | suggestion | branded auth emails | DONE | 260930_1310-auth-emails-in-spideryarn-s-voice.md |
| 208 | `spya-ewbgcx` | 2026-09-30 | suggestion | email admin on signup/upgrade | DONE | 260930_1515-email-the-admin-on-sign-up-and-plan-upgrade.md |
| 209 | `spya-mgupt0` | 2026-09-30 | suggestion | quiz questions in prose/Trajectory | DONE | 260930_1610-quiz-questions-in-the-prose-and-trajectory.md |
| 210 | `spya-q59jex` | 2026-09-30 | suggestion | gutter question in Comments drawer | DONE | 260930_1020-questions-asked-from-the-gutter-in-the-comments-drawer.md |
| 211 | `spya-abs6bj` | 2026-09-30 | suggestion | Summary prompt skips/minimises title, abstract, references, acknowledgments | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbabs6bj-summary-skips-front-matter starts Sat 03 Oct 04:35 BST; no prompt change in git |
| 212 | `spya-fmj0az` | 2026-09-30 | suggestion | briefer chat answers | DONE | 260930_1221-chat-and-question-answers-a-little-briefer.md |
| 213 | `spya-t8az6f` | 2026-09-30 | suggestion | Metadata collapse, Archive/Share | DONE | 260930_1415-metadata-shuts-more-sections-archive-and-share-at-the-top.md |
| 214 | `spya-rntdzr` | 2026-09-30 | suggestion | Remember live convo persists | DONE | 260930_0700-live-remember-conversation-vanished.md |
| 215 | `spya-qdgnks` | 2026-09-30 | suggestion | quiz icons + arrow keys | DONE | 260930_1249-quiz-controls-as-icons-and-arrow-keys.md |
| 216 | `spya-qdene8` | 2026-09-30 | problem | shelf search archived article | DONE | 260930_0608-shelf-search-cannot-find-an-archived-article.md |
| 217 | `spya-f65rcm` | 2026-09-30 | suggestion | Trajectory (i) onto controls row | DONE | 260930_1320-trajectory-info-on-the-controls-row-and-keys-in-tooltips.md |
| 218 | `spya-s3spgj` | 2026-09-30 | suggestion | Trajectory tooltips with keys + doc note | DONE | 260930_1320-trajectory-info-on-the-controls-row-and-keys-in-tooltips.md |
| 219 | `spya-mbgnwh` | 2026-09-30 | suggestion | Citations one button | DONE | 260930_0519-citations-one-button.md |
| 220 | `spya-a4xsg3` | 2026-09-30 | suggestion | shelf topics spinner | DONE | 260930_1840-spinner-while-the-shelf-topics-load.md |
| 221 | `spya-ntyes8` | 2026-09-30 | suggestion | Better shelf topics: research topic-model/clustering options, eval, plan, stop before implementing | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbntyes8-topic-pills-research starts Sun 04 Oct 05:38 BST; earlier topic work (7ce6b35bc, topic hues) did not address the clustering question |
| 222 | `spya-chhzxv` | 2026-09-30 | suggestion | bulk cheap import | DONE | 260930_0721-bulk-import-of-many-papers-cheaply.md |
| 223 | `spya-r7d6dz` | 2026-09-30 | suggestion | command bar sub-modes | DONE | 260930_2332-command-bar-lists-sub-modes.md |
| 224 | `spya-xgqv50` | 2026-09-30 | suggestion | Feedback icon far right in circle | DONE | 260930_2233-bottom-bar-spacing-feedback-circle-and-small-feedback-fixes.md |
| 225 | `spya-rsgpfm` | 2026-09-30 | suggestion | Summary pills one row | DONE | 260930_2315-summary-in-one-row-with-a-plain-words-slider.md |
| 226 | `spya-czbj9r` | 2026-09-30 | suggestion | About you autosave + reusable | DONE | 260929_1517-autosave-about-you-and-mic-fallback.md |
| 227 | `spya-yfw7b3` | 2026-09-30 | problem | no signup email for Cody | DECLINED/ANSWERED | 260930_2342-no-sign-up-email-for-cody-dong.md ; 261001b retry fix |
| 228 | `spya-pppdan` | 2026-09-30 | suggestion | Summary grouped buttons, profile-aware | DONE | 260930_2315-summary-in-one-row-with-a-plain-words-slider.md |
| 229 | `spya-a5yxnt` | 2026-09-30 | — | remove Summary description + doc note | DONE | 260930_2315-summary-in-one-row-with-a-plain-words-slider.md |
| 230 | `spya-rryap3` | 2026-09-30 | suggestion | typeface per voice | DONE | 260930_2349-a-typeface-for-each-voice.md |
| 231 | `spya-mzxq7c` | 2026-09-30 | suggestion | Earlier All shows shipped state | DONE | 260930_2301-earlier-tab-says-not-shipped-too.md |
| 232 | `spya-u3dgk7` | 2026-09-30 | suggestion | Annotations mode ideas (relation words, underlines...) | PARTLY DONE | 260930_2311-annotations-mode-marginalia-in-a-right-hand-column.md; queued qi-cbnydm7c |
| 233 | `spya-hkf2bs` | 2026-09-30 | suggestion | Summary lengths tweak | DONE | 260930_2315-summary-in-one-row-with-a-plain-words-slider.md |
| 234 | `spya-j389gg` | 2026-09-30 | suggestion | Metadata cost collapsed | DONE | 261001_0215-metadata-cost-shut-and-export-further-down.md |
| 235 | `spya-qfzb4g` | 2026-09-30 | suggestion | Metadata Export lower | DONE | 261001_0215-metadata-cost-shut-and-export-further-down.md |
| 236 | `spya-nr6gqu` | 2026-09-30 | suggestion | Summary 3-level slider | DONE | 260930_2315-summary-in-one-row-with-a-plain-words-slider.md |
| 237 | `spya-w2kgha` | 2026-09-30 | suggestion | Annotations in right column | DONE | 260930_2311-annotations-mode-marginalia-in-a-right-hand-column.md |
| 238 | `spya-hut48h` | 2026-10-01 | problem | Annotations/Marginalia mode cut off by right margin; verify with Playwright | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbhut48h-marginalia-cutoff-path-origin starts Fri 02 Oct 18:34 BST; sibling 7M path-wrap fix ceba340ff (261001k) did not clearly cover a right-edge cut-off |
| 239 | `spya-dn3mjt` | 2026-10-01 | suggestion | Annotations path truncated | DONE | 261001_0915-annotations-path-wraps-and-the-notes-swap-in.md |
| 240 | `spya-g4yrew` | 2026-10-01 | — | Make Annotations/Marginalia 'where you are' rail wording shorter and simpler | IN FLIGHT | session fbhut48h (qi-2cxmnb4d) |
| 241 | `spya-x0pvsh` | 2026-10-01 | suggestion | Summary auto-generates on open | DONE | 261001_0933-opening-summary-writes-it.md |
| 242 | `spya-rwys0e` | 2026-10-01 | suggestion | nicer AI typeface | DONE | 261001_1034-a-nicer-ai-typeface-and-every-voice-in-its-face.md |
| 243 | `spya-mafmm6` | 2026-10-01 | — | Quiz: replace 'about X% read so far' with pie/sparkline + rich tooltip; add design note preferring charts to text | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbmafmm6-quiz-read-pie starts Sun 04 Oct 00:37 BST; QuizPanel.tsx:1176 still prints text |
| 244 | `spya-dp63rf` | 2026-10-01 | suggestion | Annotations independent of left mode | DONE | 261001_0915-annotations-path-wraps-and-the-notes-swap-in.md |
| 245 | `spya-fc0h87` | 2026-10-01 | suggestion | Summary column wider | DONE | 261001_0938-summary-loses-parts-and-sections-a-touch-wider.md |
| 246 | `spya-wequmw` | 2026-10-01 | suggestion | Summary Parts/Sections vs simple submodes | DONE | 261001_0938-summary-loses-parts-and-sections-a-touch-wider.md |
| 247 | `spya-nq6hnu` | 2026-10-01 | suggestion | Reusable 'written for your profile' panel, inline edit, Regenerate | DONE | 805b40654, 95283dad1 (note 261001_0942, ending shipped); live session fb7s-written-for-your-profile-panel also still working |
| 248 | `spya-qxufp9` | 2026-10-01 | suggestion | defer Parts&Sections generation | DECLINED/ANSWERED | note 261001_0943; plan 261002a 7V |
| 249 | `spya-ac5msa` | 2026-10-01 | suggestion | citations: hide duplicate line | DONE | note 261001_1440 |
| 250 | `spya-e2yzkf` | 2026-10-01 | suggestion | stronger citation flash | DONE | note 261001_1440 (2.4s, stronger) |
| 251 | `spya-jgwmaf` | 2026-10-01 | suggestion | metadata TOC click expands+flashes | DONE | note 261001_0948; plan 261001s |
| 252 | `spya-wu265m` | 2026-10-01 | suggestion | dictation silence warning; stale message | DONE | note 261001_0949 |
| 253 | `spya-sz8qzx` | 2026-10-01 | suggestion | de-emphasise Experimental toggle | DONE | note 261001_0951 |
| 254 | `spya-xpxmjn` | 2026-10-01 | suggestion | Citations mode: sort by publication date | IN FLIGHT | scheduled tmux session (gjd-remote --wait, nothing run yet) fbxpxmjn-citations-sort-by-date starts Fri 02 Oct 23:35 BST; no date sort in code |
| 255 | `spya-atv4nx` | 2026-10-01 | suggestion | Every annotation gets a rich tooltip explaining origin; AI ones in AI font | IN FLIGHT | session fbhut48h (qi-2cxmnb4d) |
| 256 | `spya-a52jsr` | 2026-10-01 | suggestion | trawl AI/author/user fonts, fonts.md | DONE | note 261001_1034; fonts.md |
| 257 | `spya-h6rrhv` | 2026-10-01 | suggestion | other modes items in Marginalia, default-collapsed | DONE | note 261002_0300; d9134a30f, 88400b63e |
| 258 | `spya-vn72ww` | 2026-10-01 | suggestion | metadata search box w/ synonyms | DONE | note 261001_0948 |
| 259 | `spya-vskqfn` | 2026-10-01 | — | tooltips on vertical lines | PARTLY DONE | hover tooltip shipped (note 261001_0951); a tap does not open it; queued qi-djn8h9bn |
| 260 | `spya-p2hamn` | 2026-10-01 | suggestion | Help/FAQ page with contents, search, anchors, footer link, docs, deploy step | DONE | 4aeb29585, fd2796578, 8fbd37621 (note 261001_1031, shipped); fb85-help-page session still working |
| 261 | `spya-mbyuf6` | 2026-10-01 | suggestion | Update signed-out homepage and Features pages | DONE | 814a1fd17, bd6617f0e (note 261001_1031-update-the-home-page-features-and-design, shipped); fb86-89 session still working |
| 262 | `spya-b23bqq` | 2026-10-01 | suggestion | admin feedback readers-only filter | DONE | note 261001_0951 |
| 263 | `spya-zadvdv` | 2026-10-01 | suggestion | Update /design | DONE | cf65436f9 (261002b stage 3: /design draws what the app draws now, 89); note docs/user-feedback/261001_1031 reports: spya-mbyuf6, spya-zadvdv ending shipped |
| 264 | `spya-a5gzb9` | 2026-10-01 | suggestion | more metadata on past imports | PARTLY DONE | 44877f4ce; the rest is on awaiting-approval.md for Greg |
| 265 | `spya-ptyszp` | 2026-10-01 | — | check decorated.html in browser | DONE | note 261001_1035-decorated-playground |
| 266 | `spya-hbqezu` | 2026-10-01 | suggestion | why-reading saved indicator + first-open prompt | DONE | note 261001_1035-past-imports; 44877f4ce |
| 267 | `spya-qmev0s` | 2026-10-01 | suggestion | Reader-added tags on shelf articles (combo dropdown), as facet pills in the shelf topics filter, and near top of Metadata | IN FLIGHT | session fbqmev0s (qi-aq9x8k9h) |
| 268 | `spya-rkn8mn` | 2026-10-01 | suggestion | More Metadata actions in Commands (re-run a mode with stronger AI), a Commands vision doc, interface-LLM | IN FLIGHT | Sentry -8D, queue qi-gwp9epnd dispatched to session fb8d-commands-and-interface-llm (working, worktree exists, nothing on dev yet) |
| 269 | `spya-yaxvgt` | 2026-10-01 | suggestion | write interface-vision.md; rename Annotations->Marginalia | DONE | note 261001_1132; interface-vision.md |
| 270 | `spya-w3z96b` | 2026-10-01 | suggestion | shorter Brief prompt | DONE | note 261001_1134; 261001p b22814d8e |
| 271 | `spya-j6b69x` | 2026-10-01 | suggestion | AI mono font for all AI text | DONE | note 261001_1034 |
| 272 | `spya-ucu35y` | 2026-10-01 | suggestion | (i) icon per mode; rename new-mode->mode.md | DONE | note 261001_1239 |
| 273 | `spya-jq5db6` | 2026-10-01 | suggestion | Trajectory question above quote | DONE | note 261001_1241 |
| 274 | `spya-rqch7a` | 2026-10-01 | suggestion | highlight on-screen block-links | DONE | note 261001_1241 |
| 275 | `spya-k930hy` | 2026-10-01 | suggestion | drop paperwork from summaries/tweets/structure; stress takeaway | PARTLY DONE | note 261001_1134; 261001p b22814d8e; src/paperwork.ts; queued qi-qczrxnye |
| 276 | `spya-zw479b` | 2026-10-01 | suggestion | Summary opens on Brief first time | DONE | ac466a12e 261002c: Summary opens on Brief (8N); note 261001_1234 ending shipped |
| 277 | `spya-pawfwx` | 2026-10-01 | problem | why tables/figures failed to import | DONE | note 261001_1558-pdf-tables; sessions fb8p, fbpawfwx |
| 278 | `spya-g8byyd` | 2026-10-01 | problem | dictation ignores system mic | DONE | note 261001_1558-dictation |
| 279 | `spya-b2wzjf` | 2026-10-01 | suggestion | Structure up/down = next block; left/right = lowest sections | DONE | note 261001_1601; plan 261001q |
| 280 | `spya-mn3ruw` | 2026-10-01 | suggestion | reading-time line rich tooltip and brightness | DONE | note 261001_1604; abe1d662c, 8a5eb45d6 |
| 281 | `spya-b3ggv4` | 2026-10-01 | suggestion | remove Parts&Sections from Summary | DONE | note 261001_0938; fb7q-7r |
| 282 | `spya-ra5fuz` | 2026-10-01 | suggestion | Light summary sentences when the passage they summarise is on screen, hover tooltip with the passage | IN FLIGHT | session fbra5fuz-summary-follows-the-text (scheduled, not yet started, starts Fri 14:52); also queue qi-bjbmf236 for sibling 8V dispatched to fb8v-summary-sentences-lit-by-passage (no live session of that name) |
| 283 | `spya-sxvq2j` | 2026-10-01 | suggestion | cross-refs distinct from, quieter than, glossary | DONE | note 261001_1604 |
| 284 | `spya-rczgjb` | 2026-10-01 | suggestion | distinct rail at top of Marginalia | DONE | note 261002_0300; fb8x-91-8z |
| 285 | `spya-skxhcz` | 2026-10-01 | suggestion | rename Trajectory->Skim, keep keyword | DONE | note 261001_1625; plan 261001r |
| 286 | `spya-eym66s` | 2026-10-01 | suggestion | multi-upload with minimal AI until opened | DONE | note 260930_0721; plan 261001m; 2a9956b0e |
| 287 | `spya-ybnas5` | 2026-10-01 | suggestion | chat knows visible blocks, soft caveat | DONE | note 261001_1710-chat-knows |
| 288 | `spya-ns2v83` | 2026-10-01 | suggestion | animated logo loading spinner | DONE | note 261001_1725; loading-spinner.md |
| 289 | `spya-bjbcxp` | 2026-10-01 | suggestion | Skim: drop FAQ snippets, AI fonts | DONE | note 261001_1730 |
| 290 | `spya-gxyhcc` | 2026-10-01 | suggestion | Structure Fisheye/Expanded toggle | DONE | note 261001_1601 |
| 291 | `spya-ukr9dp` | 2026-10-01 | suggestion | remove Parts&Sections sentence in Structure tooltip | DONE | note 261001_1601 |
| 292 | `spya-f5fa66` | 2026-10-01 | suggestion | Summary mode (and other modes) use the AI typeface | DONE | dab30ed19 + 0bbb4ca46 + f3d3e27de (261002b voices trawl: summaries/gists listed in src/web/styles/voices.css, note 261001_1034). Sentry -91 duplicates it; queue qi-pv8xfnqp / session fb8x-91-8z-rail-box-and-ai-type is scheduled but not started and is mostly redundant. Faces still sit behind the Experimental switch (note asks Greg whether to lift that). |
| 293 | `spya-wdfb4h` | 2026-10-01 | — | Rename Hierarchy data/step/vars/db to Structure, and fix other mode/UI name mismatches | IN FLIGHT | session fbwdfb4h-rename-hierarchy-to-structure working; dd64dd680 plan and b96fb333e stage 1 (code and docs) on dev; stage 2 (stored step name + migration, 2ce0ad45c/d988cc77f) is on the worktree branch only. Sentry -92, queue qi-tbrjsyf4. |
| 294 | `spya-c77zuq` | 2026-10-01 | suggestion | Quick concept search with Jev via OpenRouter: spikes then a v1 (new mode or quick search bar or toggle) | IN FLIGHT | session fb-fast-concept-search (scheduled, not started, starts Fri 14:49). No commits or queue item. |
| 295 | `spya-sutes9` | 2026-10-01 | problem | why Order of Time hierarchy failed; root-cause fix | DONE | note 261001_1829; plan 261001s; postmortem 261002a |
| 296 | `spya-yj2vdr` | 2026-10-01 | suggestion | Feedback Earlier/Not shipped: is 'Showing your 50 most recent' true? count badges on tab pills | IN FLIGHT | queue qi-r6hhx6ma (Sentry -95) dispatched to fb95-earlier-tab-counts (scheduled, not started, starts Sat 03:24). Code still shows the line (FeedbackEarlier.tsx:296), no counts on dev. |
| 297 | `spya-e47u5f` | 2026-10-01 | suggestion | Plain closes both side columns; clicking the active mode deactivates it | IN FLIGHT | queue qi-xea44ds6 (Sentry -96) dispatched to fb96-mode-click-toggles-off (scheduled, not started, starts Fri 20:23) |
| 298 | `spya-xebdgz` | 2026-10-01 | suggestion | wider left band on wide windows | DONE | note 261001_1937; plan 261002a |
| 299 | `spya-cjquu6` | 2026-10-01 | suggestion | Recall/Remember: much more Socratic, much briefer replies (a paragraph or two), nudge in a couple of directions, fill in gaps if I say I do not remember, point to the article or offer a new chat instead of long explanations | IN FLIGHT | named in session fb97-98's brief |
| 300 | `spya-f3b6ab` | 2026-10-01 | problem | Bug: editing a previous message in Recall mode does not trigger a new response | IN FLIGHT | named in session fb97-98's brief |
| 301 | `spya-kqynj5` | 2026-10-01 | suggestion | Recall always includes block-links; maybe drop Respond, tweak Balanced to cite more | IN FLIGHT | Sentry -97, queue qi-p2ymf8dt dispatched to fb97-98-remember-recall-and-tutorial (scheduled, not started, starts Sat 06:54). 'Do 97 first'. |
| 302 | `spya-c8x66d` | 2026-10-01 | suggestion | Remember: get rid of Signposts, one adaptive brief Recall mode with hints/questions using block links; web research on good Socratic questions in education | IN FLIGHT | named in session fb97-98's brief |
| 303 | `spya-j0scgz` | 2026-10-01 | suggestion | New Remember sub-mode 'Tutorial' (alternating brief teach and say-it-back, profile-aware, block links), research in docs/research, docs/project/remembering-vision.md | IN FLIGHT | Sentry -98, queue qi-p2ymf8dt to fb97-98-remember-recall-and-tutorial (scheduled, not started). No remembering-vision.md on dev. |
| 304 | `spya-hc5q0e` | 2026-10-01 | suggestion | voucher note-to-recipient + email sketch | DONE | note 261001_1858 |
| 305 | `spya-y4upzw` | 2026-10-01 | suggestion | Feedback dialog should record the page URL as metadata | DONE | Already true: src/feedback.ts stores `url` (migration 20260902161529/20260902182328_feedback_url_replaces_route_kind, Greg's call 2026-09-02) and FeedbackDialog.tsx sends where.url; every row in this batch carries a url, this one included (/admin/vouchers). No new work needed. |
| 306 | `spya-f02640` | 2026-10-01 | problem | voucher email for existing user | DONE | note 261001_2003; plan 261002a fb99 |
| 307 | `spya-yy5x66` | 2026-10-01 | suggestion | Shelf: Include public button, and help for an empty shelf | DONE | f298ef76b (spya-yy5x66, spya-fcbnhq); note 261001_1904 ending shipped; follow-ups 5bae817c5 / 19b513144 (counts) |
| 308 | `spya-x9taw3` | 2026-10-01 | suggestion | gift visible on profile + plan tooltips | DONE | note 261001_1906 |
| 309 | `spya-xjuxde` | 2026-10-01 | problem | Marginalia fonts reflect AI vs reader vs author | DONE | dab30ed19 / f3d3e27de (261002b trawl: .marg-* classes, dbt/faq/crit/mir notes, voices.css; note 261001_1034, 7N/81/8G). Sentry -9A and queue qi-bm8fpvy4 -> fb9a-marginalia-typeface-by-voice (scheduled, not started) are redundant duplicates; the queue item itself says it overlaps. Behind the Experimental switch. |
| 310 | `spya-zper0p` | 2026-10-01 | suggestion | Bookmark icon in the gutter more visible; comment on a block without wanting an AI reply, with a UI hint | IN FLIGHT | queue qi-ynaan2cf (Sentry -9C, 9H) dispatched to fb9c-9h-comments-without-ai-reply (scheduled, not started, starts Fri 23:54). Only adjacent shipped bit: a9373e1ca 'bare bookmarks stay in the gutter'. |
| 311 | `spya-zuk4f7` | 2026-10-01 | suggestion | Debate should lead with who has cited this article, for and against | IN FLIGHT | queue qi-sfmntrz3 (Sentry -9D) dispatched to fb9d-debate-who-cited-this (scheduled, not started, starts Sat 06:55). 7ed46a39f is an unrelated Debate-in-margin doc change. |
| 312 | `spya-d7ftwk` | 2026-10-01 | suggestion | Make the shelf item's triple-dot menu more visible on iPad portrait | IN FLIGHT | queue qi-ppaw8fvj (Sentry -9E, 9F, 9G) dispatched to fb9e-9f-9g-ipad-touch-targets (scheduled, not started, starts Fri 23:53) |
| 313 | `spya-n3zujy` | 2026-10-01 | suggestion | shelf card icons on one row (iPad) | IN FLIGHT | session fb9e-9f-9g-ipad-touch-targets, qi-ppaw8fvj (9F) |
| 314 | `spya-gvcmx2` | 2026-10-01 | suggestion | bigger close cross on comments/modals | IN FLIGHT | session fb9e-9f-9g-ipad-touch-targets, qi-ppaw8fvj (9G) |
| 315 | `spya-m55h94` | 2026-10-01 | suggestion | comments in marginalia, collapsed, with kind marker | IN FLIGHT | session fb9c-9h-comments-without-ai-reply, qi-ynaan2cf (9H) |
| 316 | `spya-cm0qa7` | 2026-10-01 | suggestion | admin spend whole dollars | DONE | note 261001_1938 |
| 317 | `spya-p6scuf` | 2026-10-01 | suggestion | metadata TOC on iPad landscape | DONE | note 261001_1947; plan 261002a |
| 318 | `spya-br27ef` | 2026-10-01 | suggestion | archive button on masthead | DONE | note 261001_2048 |
| 319 | `spya-d940uu` | 2026-10-01 | suggestion | reading marks brighten slower, time in rich tooltip | IN FLIGHT | session fb9n-reading-marks-brighten-slower, qi-v8rqbtcm (9N) |
| 320 | `spya-y3747g` | 2026-10-01 | problem | Mac horizontal scrollbar | DONE | note 261001_2051 |
| 321 | `spya-r2auqd` | 2026-10-01 | — | all summary levels auto-write; Briefer default | IN FLIGHT | sessions fb9p-summary-writes-every-level (qi-52z3tb69) and fb8n-summary-opens-on-brief; ac466a12e shipped Brief default only |
| 322 | `spya-fcbnhq` | 2026-10-01 | suggestion | one-time phone banner on logged-in home | DONE | f298ef76b 261002b (names spya-fcbnhq) |
| 323 | `spya-rpqqxb` | 2026-10-02 | suggestion | Briefer summary simpler language, less jargon; web research on good summaries | IN FLIGHT | named in session fb9p's brief |
| 324 | `spya-yqfzkm` | 2026-10-02 | suggestion | hide a glossary entry (Glossary mode, tooltip, unhide list) | IN FLIGHT | session fbyqfzkm-glossary-hide-dig-deeper-links |
| 325 | `spya-mmhrnw` | 2026-10-02 | suggestion | email non-admin reporters when their feedback ships | IN FLIGHT | session fbmmhrnw-feedback-shipped-email |
| 326 | `spya-hf4svm` | 2026-10-02 | — | fix (i)/profile icon placement on modes; standardise for new modes | IN FLIGHT | session fbhf4svm-mode-header-and-gutter-icons |
| 327 | `spya-p09u4s` | 2026-10-02 | suggestion | Dig deeper in the in-text glossary tooltip | IN FLIGHT | session fbyqfzkm-glossary-hide-dig-deeper-links (name covers dig-deeper) |
| 328 | `spya-n04d5p` | 2026-10-02 | problem | why a glossary term shows one block link; improve | IN FLIGHT | session fbyqfzkm-glossary-hide-dig-deeper-links (name says links) |
| 329 | `spya-jc0vm6` | 2026-10-02 | problem | gutter icons: bookmark glow, tooltips, more vertical gap | IN FLIGHT | session fbhf4svm-mode-header-and-gutter-icons (gutter icons); a9373e1ca touched bookmarks in gutter earlier, unrelated |
| 330 | `spya-p52ccp` | 2026-10-02 | suggestion | standardise logo (white text), reusable, animations | IN FLIGHT | session fbp52ccp-logo-white-and-standardised |
| 331 | `spya-skqwg8` | 2026-10-02 | suggestion | collapsible headings plus expand/collapse all (discuss if complex) | IN FLIGHT | session fbskqwg8-collapsible-headings |
| 332 | `spya-d886ah` | 2026-10-02 | suggestion | fix confusing share tooltip; UI-text best practice | IN FLIGHT | session fbd886ah-share-tooltip-and-ui-text |
| 333 | `spya-f602m6` | 2026-10-02 | problem | why no scrollbar in summary mode on iPad | DECLINED/ANSWERED | answered by Greg's own next report (af6hy8: the scroll bar is there, hard to see) |
| 334 | `spya-af6hy8` | 2026-10-02 | — | note: iPad summary scrollbar exists but is hard to see | IN FLIGHT | named in session fb9e-9f-9g's brief |
| 335 | `spya-s9fhmw` | 2026-10-02 | suggestion | Include archived/public buttons and counts beside empty search | DONE | 5bae817c5, 19b513144 (261002b Part D, names spya-s9fhmw) |
| 336 | `spya-nkjpte` | 2026-10-02 | suggestion | more keyword aliases for Metadata search; keep docs current | DONE | 22ea449bd, 84569621c (261002c, names spya-nkjpte), on origin/dev; session fbnkjpte still idle-waiting |
