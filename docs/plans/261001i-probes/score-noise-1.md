# Blind score, noise check 1 (blind2/, P01–P08)

Scored against `scoring.md` (current version): barred plans (260929…, 260930…, 2610…) are left out of the
Docs denominator; a doc counts only if the probe lists it as opened or quotes its decisive section;
a helper counts only if named by file and symbol (or unambiguously by name). No probe stated a
tool-call count, except P01-B's "two tool calls" to the answer, so that column is left out.

| Probe | Docs /4 | Reuse /4 | Rules /3 | Disposition /2 | Traps /2 | Precision | Total /15 | Confidence | Biggest miss |
|---|---|---|---|---|---|---|---|---|---|
| P01-A | 4.0 (1/1; 260930i barred) | 2.0 (2/4) | 0.8 (1/4) | 2 | 0.0 | 0 | **8.8** | 8/10 | Never names `ADDED_NOTE` / `rowCardFacts` / `ControlTip`, and none of the traps (260928a's removed Added-cell card, the 30-day cut-over, `en` pinning). |
| P01-B | 4.0 (1/1) | 4.0 (4/4) | 0.8 (1/4) | 2 | 0.0 | 0 | **10.8** | 8/10 (6/10 no residual) | Floats putting a `title` on the date text, which is the trap it should have flagged; no no-new-dependency, `ControlTip`-over-`title` or browser-subagent rule. |
| P02-A | 3.0 (3/4) | 2.7 (3.3/5) | 2.4 (4/5) | 2 | 0.4 (1/5) | 0 | **10.5** | 7/10 | Models on `src/arc.ts` and misses `src/simple-summary.ts`, so it never sees that Simple's second paragraph already says "why it matters"; skips `vision.md` anti-goals. |
| P02-B | 2.0 (2/4) | 2.7 (3.3/5) | 2.4 (4/5) | 2 | 0.4 (1/5) | 0 | **9.5** | 7/10 | `prompting-guide.md` cited but not opened, and `vision.md` not read; misses the overlap with Simple and the "a route cannot write a revision column" trap. |
| P03-A | 2.7 (2/3; 260930i, 261001b barred) | 3.2 (4/5) | 2.5 | 2 | 1.0 (1.5/3) | 0 | **11.4** | 6/10 | `privacy.md` only listed as a file to edit, never opened; no exactly-once guard against a retried job mailing twice. |
| P03-B | 4.0 (3/3) | 3.2 (4/5) | 2.8 | 2 | 1.2 (1.75/3) | 0 | **13.2** | 6/10 | No exactly-once rule: deciding on the settled `done` transition so a re-run job does not mail twice; `notifyUpgrade` template not found (uses `arrivals.ts`). |
| P04-A | 2.0 (1/2; 261001e barred) | 4.0 (3/3) | 3.0 (3/3) | 2 | 0.8 (1.5/4) | 0 | **11.8** | 6/10 (4/10 culprit) | `browser-testing.md` / `browser-control.md` not opened (iframe phone-width method); misses the `nowrap`-with-no-wrap-point class and the `overflow-x: clip` non-fix. |
| P04-B | 2.0 (1/2) | 4.0 (3/3) | 2.8 | 2 | 0.9 (1.75/4) | 0 | **11.7** | 5/10 culprit, 8/10 process | Same: browser docs unopened; no word on `nowrap` per item or that `.band-head` cannot gain a line. |
| P05-A | 3.2 (4/5) | 1.6 (2/5) | 2.1 (5/7) | 2 | 1.0 (2.5/5) | 0 | **9.9** | 6/10 | `icons.md` not opened; reaches for `key-chord.ts` rather than `keynav.ts` § `useArrowNav`, and misses the other copy implementations (`AnnotateDialog` § `CopyQuote`, `BlockGutter` § `onCopy`). |
| P05-B | 2.8 (3.5/5) | 1.6 (2/5) | 2.1 (5/7) | 2 | 1.2 (3/5) | 0 | **9.7** | 7/10 | `keyboard.md` grepped only, so the key guards (dialog, `defaultPrevented`) are absent; `icons.md` unopened; no `useArrowNav`. |
| P06-A | 3.6 (4.5/5) | 2.0 (3.5/7) | 1.8 (3/5) | 1 | 0.8 (2/5) | 0 | **9.2** | 7/10 | Spots the FAQ/Quiz/Chat-alias collision but picks its own meaning and builds, instead of asking Greg first. |
| P06-B | 3.2 (4/5) | 3.0 (5.25/7) | 3.0 (5/5) | 2 | 0.8 (2/5) | 0 | **12.0** | 7/10 | `faq.md` / `quiz.md` not opened; no `src/web/sub-modes.ts`; misses the `question` alias tying with Chat. |
| P07-A | 3.3 (2.5/3; 260930c barred) | 1.0 (1.5/6) | 2.0 | 2 | 0.2 (0.5/5) | 0 | **8.5** | 7/10 | Misses `modeStep`, `STEP_SHARING`, `useFaq`/`useAutoRun` and every 260930c trap except "FAQ reads nothing"; never names route (a), taking FAQ out from behind the switch. |
| P07-B | 2.7 (2/3) | 2.7 (4/6) | 2.3 | 2 | 1.2 (3/5) | 0 | **10.8** | 8/10 | `experimental-features.md` / `mode.md` § Moving a mode not opened; does not price the per-import cost (≈ $0.31 for five, plus FAQ's median). |
| P08-A | 2.0 (3/6) | 3.3 (5/6) | 2.1 | 1 | 0.3 (1/6) | 0 | **8.7** | 7/10 | Never asks which "depth" (outline `?deep=` vs Simple's level); `summaries.md`, `url-state.md` and `sql.md` not opened, so the door rule and URL-wins precedence are missing. |
| P08-B | 2.0 (3/6) | 3.0 (4.5/6) | 2.6 | 2 | 0.0 (0/6) | 0 | **9.6** | 6/10 | No trap anticipated (server-controlled control, missing field is an error, stored Fuller must not start a paid job, explicit URL wins); `summaries.md` / `url-state.md` unopened. |

Means: A files 9.85, B files 10.91 (all 16: 10.38).
