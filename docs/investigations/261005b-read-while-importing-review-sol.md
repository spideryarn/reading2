The spike supports **a promising, small fallback**, but I would keep this version off `dev` even if the three owed checks pass. The new latch can retain one account’s prose after switching accounts, and the claim that drafts cannot contact publishers is false for several supported HTML shapes. The hand-over failure is established; its proposed cause and fix are not. The recorded spend rounds correctly to $1.28, but several timing and pricing claims need qualification. I changed nothing and ran no runtime checks.

1. **P0 — The latch can display account A’s draft to account B.** [AddPage.tsx:712](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/web/AddPage.tsx:712), [App.tsx:464](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/web/App.tsx:464).

   This is an established source path: after A loads a draft, a direct A→B authentication change keeps the same `AddPage` instance and source. The job engine clears A’s jobs, and Experimental becomes off while B’s settings load, but neither event clears `draftOf`. `draftJobId` checks only the source, so `DraftProse` retains A’s downloaded blocks indefinitely. **Fix this first:** key both URL and upload `AddPage` instances by `user.id`, so an account change synchronously discards their state and cancels their requests. Add an account-switch regression check; the Postgres ownership test cannot catch this.

   The server boundary itself looks sound: [pg-job-draft.ts:42](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/store/pg-job-draft.ts:42) filters by the authenticated owner, job ID, dismissal state and draft revision status. I found no route that lets B request A’s draft. The defect is in retaining an answer fetched for A.

2. **P1 — `waiting` does not establish “no publisher requests.”** [DraftProse.tsx:40](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/web/DraftProse.tsx:40), [rehost.ts:519](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/web/rehost.ts:519), [write-up:178](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md:178).

   `swapImages` selects **`img[src]`**, then skips any image whose `src` is not an absolute HTTP(S) URL. Consequently, `<img srcset="https://publisher.example/track.png 1x">` survives. So does an image with a relative or inline `src` and an external `srcset`. Picture `<source>` elements are removed only when an associated image reaches the rewrite branch.

   The other requested cases are:

   | Resource | Draft handling |
   |---|---|
   | Absolute HTTP(S) `<img src>` and its responsive candidates | Blanked |
   | Srcset-only images | Missed |
   | `<video src>`, video/audio `<source>`, `<video poster>` | Retained |
   | `<svg><image href>` / `xlink:href` | Retained |
   | CSS `background` in `style` or `<style>` | Removed by the shared sanitiser |
   | HTML `background` attribute; external SVG functional IRIs | Not generally removed |
   | Allowlisted iframe | Retained deliberately |

   These broader resource gaps also exist in the reading-view path; the draft does not introduce a weaker XSS sanitiser. However, they contradict its stronger privacy promise. Add a draft-specific resource suppression pass, with adversarial cases covering these shapes, or explicitly narrow the policy. The observed Wikipedia runs establish that those runs made no external requests; they do not establish universal suppression.

   `draftBlockHtml` uses the same browser policy and new-tab link handling as `sanitizeArticle`. It skips maths conversion, recovered figures, annotations and zoom controls. I found no additional security filtering in those presentation steps that the draft needs to copy.

3. **P1 — The hand-over is still unresolved; the latch is not an established fix.** [AddPage.tsx:199](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/web/AddPage.tsx:199), [DraftProse.tsx:49](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/web/DraftProse.tsx:49), [write-up:114](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md:114).

   Your explanation is possible **if a successful poll actually omits the job**, but the inspected code does not establish that event. Failed polls retain the previous job list ([jobEngine.ts:710](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/web/jobEngine.ts:710)); polling does not blank it while awaiting a response; and `draftIsReadable` already included `done` in the browser-tested commit. Ordinary completion therefore did not inherently unmount the draft.

   `draftReadingPlace()` can also return null because no blocks have loaded, the first block’s top is still at or below zero, or every block’s bottom is above the viewport. The first-block condition can return null while the reader is already seeing prose farther down the window. A silently failed draft request is another route to no drawn blocks.

   **There is a later path that removes `?at=`.** `navigate` preserves the supplied query and then scrolls to zero ([router.ts:1418](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/web/router.ts:1418)). The reading-position effect subsequently attempts the block jump. If that leaves the view at the top—for example, because its target row is missing—the position tracker writes `at: null` ([position.ts:254](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/src/web/position.ts:254)). First-open defaults do not unconditionally strip an explicit `at`.

   Thus the final address cannot distinguish **no position handed over** from **a position removed after unsuccessful restoration**. On the next permitted run, record the sampled ID and rectangles, the outgoing href, and subsequent URL writes. Add a regression check through actual navigation and arrival. The current tests exercise neither `draftReadingPlace` nor the latch.

4. **P3 — Availability is presented as measured browser reading time.** [write-up:26](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md:26), [write-up:49](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md:49).

   “About a second after `blocks`” conflicts with the supplied browser observation of **1–10 seconds**. Polling also waits a second *after each response*, rather than guaranteeing discovery within one second of the commit. The server table measures `structure` call start, a proxy for blocks already being available, and excludes fetching and rendering the draft. Rename the columns to make that distinction explicit. “About 5 seconds / 25 seconds earlier on a quiet box” is a reasonable estimate from the earlier investigation, but it was not measured end to end with this draft UI. Likewise, “every loaded number is inflated” is stronger than the evidence: load affected the observations, but there were no paired quiet runs.

5. **P3 — Two timing entries need correction.** [write-up:56](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md:56), [write-up:74](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md:74).

   The exact differences from your UTC rows are:

   | Article | Created → structure start | Created → finished | Structure start → finished |
   |---|---:|---:|---:|
   | Analytical engine | 7.2 s | 37.8 s | 30.6 s |
   | Difference engine | 8.2 s | 64.6 s | **56.4 s** |
   | Punched card | 9.1 s | 73.8 s | 64.7 s |
   | Herman Hollerith | 11.8 s | 30.5 s | 18.7 s |
   | Charles Babbage | 18.1 s | 59.1 s | 41.0 s |
   | Ada Lovelace | 23.3 s | 82.8 s | 59.5 s |

   Difference engine’s saving rounds to **56 seconds**, not 57; compute intervals before rounding the displayed endpoints.

   For the PDF, the last extraction call ended **130.3 seconds (2:10.3)** after creation, not about 2:20. Structure started at **141.4 seconds**, ended at **175.1 seconds**, and the job finished at **360.7 seconds**. The approximately 3:40 remaining from structure start is correct. The rows alone do not establish that all 185.6 seconds after structure ended were figure recovery.

6. **P3 — Recorded spend is correct; cash and the unpriced call are overstated.** [write-up:195](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md:195).

   The 19 amounts sum to **$1.2753**, correctly rounded to **$1.28**. Applying 5.5% to everything gives approximately **$1.3454**, hence $1.35. But the project’s accounting rule uplifts only the **credits** subtotal, excluding BYOK and computed spend ([cost-tracking.md:123](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/project/cost-tracking.md:123)). Your combined amounts cannot establish the cash total without that breakdown. Also replace “cost nothing” with “has no recorded price”: an unpriced refusal does not prove zero cost. The supplied timing evidence names six web imports and one PDF; identify the seventh web attempt claimed in the spend paragraph.

7. **P3 — The size estimate and competing-plan explanation need a durable, clearer account.** [write-up:134](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md:134), [write-up:204](/home/greg/code/spideryarn2/.claude/worktrees/read-while-importing-spike/docs/investigations/261005b-read-while-importing-draft-prose-on-the-add-page-spiked.md:204).

   The requested range contains **two commits**, with **426 added and five removed lines** across `src` and `tests`. Production code alone is about 243 net lines; “230 with comments and tests” understates the reviewed change.

   I also read 261005j in its sibling worktree. It keeps `assets` before publication, so the claimed remaining PDF figure-recovery window is consistent with that plan. Its early-open path applies to qualifying **new imports**, not every web import. Link the actual plan durably and explain those two conditions; “opens after blocks” hides why a PDF still waits. Define “draft” as unpublished stored prose, “publication” as making the completed article available, and “arc jobs” in reader terms.

The next changes should be the account boundary, complete draft resource suppression, and an evidenced hand-over fix. After those, the proposed prose placement, explicit Open button and suppressed purpose prompt make a sensible Experimental version. The three owed checks remain necessary, but they are insufficient for the current candidate.