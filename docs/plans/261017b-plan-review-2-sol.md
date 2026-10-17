Two established P1 defects require rework: the bookmarklet can silently delete article content, and it can corrupt non-ASCII text.

### Round-1 disposition

| Finding | Status |
|---|---|
| F1 counts | Resolved |
| F2 scope of option A | Partly resolved; see R2-3 |
| F3 effective `<base>` | Resolved |
| F4 click executes bookmarklet | Resolved mechanically |
| F5 challenge predicates/tests | Resolved |
| F6 privacy disclosure | Disclosure resolved; removal policy introduces R2-1 |
| F7 image behavior | Partly resolved; see R2-5 |
| F8 touch-device cut | Original hybrid-laptop issue resolved; iPad remains, R2-6 |
| F9 IEEE 202 evidence | Not resolved; see R2-4 |

### Findings

1. **R2-1 — P1 — established. Blanket element removal silently destroys article content before Spideryarn’s recovery and sanitization passes.**

   The plan removes every `script`, `iframe`, `input`, `textarea`, and `select` ([plan:85](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md:85), [plan:135](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md:135)). These are not all “plainly not the article”:

   - The authoritative sanitizer policy says removing all iframes already made a real YouTube video disappear from the Noema sample; Spideryarn deliberately retains allowlisted video embeds ([sanitize-policy.ts:203](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/sanitize-policy.ts:203), [sanitize-policy.ts:207](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/sanitize-policy.ts:207)).
   - Tufte sidenotes use an `<input type=checkbox>` and label as their marker. Extraction must see them before sanitization or the note becomes unmarked prose ([notes.ts:19](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/notes.ts:19), [extract.ts:822](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/extract.ts:822)).
   - MathJax v2 stores authored TeX in `<script type="math/tex">`; `canonicaliseMaths` converts those scripts before Readability removes them ([maths-import.ts:14](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/maths-import.ts:14), [maths-import.ts:64](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/maths-import.ts:64)).
   - A visible `<textarea>` can itself be a code example, and a `<select>` can contain authored labels. Calling `.remove()` discards their text rather than merely making them non-interactive.

   Fix: do not strip content-capable elements wholesale. Preserve iframes for the existing sanitization allowlist; preserve non-executable data scripts used by extraction, especially `math/tex` and structured article metadata; and narrow form-field minimization to credential-bearing values while retaining Tufte’s checkbox topology and visible textarea/select text. Tighten token-meta removal to known credential names instead of every name containing `token`. Add fixtures for the Noema embed, Tufte sidenotes, MathJax, and visible form-backed content.

2. **R2-2 — P1 — established. The saved file can silently mojibake every non-ASCII character.**

   The plan serializes the DOM directly into a string and Blob without normalizing the document’s charset ([plan:131](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md:131), [plan:136](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md:136)). Blob string bytes are UTF-8, but the clone may have no charset or may still claim Shift_JIS/ISO-8859-1.

   Uploaded HTML has no transport charset. Spideryarn therefore trusts a meta declaration and otherwise defaults to Windows-1252 ([fetch.ts:1926](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/fetch.ts:1926), [fetch.ts:1934](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/fetch.ts:1934)). A UTF-8 `naïve` file with no declaration is consequently decoded as `naÃ¯ve`; retaining an old Latin-1 declaration has the same result.

   Fix: remove all existing charset declarations, including `http-equiv=content-type`, and insert `<meta charset="utf-8">` as the first child of `<head>`, before the potentially long `<base>`. Test no charset, a conflicting legacy charset, non-Latin prose, and a multibyte title through the actual Blob bytes, `decodeHtml`, and `readArticle`.

3. **R2-3 — P2 — established. F2’s broader conclusion remains overstated.**

   The investigation now correctly labels the 6/29 result as narrow, but still says option A “cannot help” the 15 rows OpenAlex marked closed ([investigation:70](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/investigations/261017a-which-refused-paper-links-have-a-free-copy-the-server-can-read.md:70)). The plan strengthens that to “nothing automatic will reach them” ([plan:22](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md:22)) and promises “more” once repository copies are fetched ([plan:173](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md:173)).

   What is established is only that the queried OpenAlex record exposed no OA location for those 15. Other finders were not tried, and even the eight named repository candidates were not fetched.

   Fix: say “15 had no OA location known to OpenAlex in this measurement”; broader automatic coverage remains unknown. Change “more if fetched” to “potentially more, pending guarded fetch and licence/version classification.”

4. **R2-4 — P2 — established. F9 is asserted in prose but still not reproducible from the evidence.**

   `probe.ts` reduces a successful fetch to `html:<length>` and does not store the response status or final URL ([probe.ts:22](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/investigations/261017a-evidence/probe.ts:22), [probe.ts:29](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/investigations/261017a-evidence/probe.ts:29)). Its second request stores selected headers but again not status, final URL, body length, or hash ([probe.ts:34](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/investigations/261017a-evidence/probe.ts:34)). Consequently, neither “202” nor “three of three” is present in the checked evidence.

   The parallel Stage 1 implementation already contains the contradictory statement that the captured `fetchDocument` response had an empty body ([challenge-page.ts:213](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/challenge-page.ts:213)).

   Fix: record each run’s request headers, status, final URL, content type, body byte length, and SHA-256. Distinguish the `Accept` and no-`Accept` requests explicitly, then correct the Stage 1 comment.

5. **R2-5 — P2 — established. F7’s fallback test improved, but the real acceptance check was replaced with a constructed page.**

   The proposed constructed host proves only the generic failed-fetch fallback ([plan:164](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md:164)). It does not establish that a saved Cell or other real walled DOM retains and resolves its actual image markup.

   Also, “works in the owner’s signed-in browser” is too strong ([plan:77](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md:77)); the image contract already records that publishers block hotlinks by referrer ([article-images.md:119](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/project/article-images.md:119)), and cross-site image loads may not receive the owner’s authenticated cookies.

   Fix: require one actual saved walled article as the acceptance fixture, or explicitly leave target-site image retention unverified. Say the fallback may fail even for the owner.

6. **R2-6 — P2 — reasoned. `isPhone` fixes the touchscreen-laptop case but does not model whether drag installation is available.**

   `isPhone` deliberately excludes iPads ([small-screen-hint.ts:141](/var/tmp/spideryarn-worktrees/refused-site-open-copy/src/web/small-screen-hint.ts:141)), so the draggable instruction will appear there even though the repository treats iPad as a first-class reading device ([phone-and-touch.md:109](/var/tmp/spideryarn-worktrees/refused-site-open-copy/docs/project/phone-and-touch.md:109)). Apple documents adding iPad favorites through Share and editing them, not dragging a page link into browser chrome ([Apple’s iPad Safari guide](https://support.apple.com/guide/ipad/bookmark-a-website-ipadc602b75b/27/ipados/27)).

   Fix: test installation on a real iPad. If dragging is unavailable, provide the create-and-edit-bookmark route or hide the drag-only instruction with an interaction-specific condition. Keep wide desktop hybrids visible.

### Specific interaction checks

- The `Blob.size > MAX_UPLOAD_BYTES` alert-and-stop check is sound: it measures the actual UTF-8 file bytes and runs before creating a URL or starting a download. Test exactly-at-limit, one-byte-over, and multibyte text.
- Preventing the anchor’s `click` default does not itself cancel native drag: click activation and drag are separate event sequences. Chromium explicitly describes bookmarklet installation by dragging the link ([Chromium bookmarklets](https://www.chromium.org/user-experience/bookmarklets/)), consistent with the HTML drag model ([WHATWG drag-and-drop](https://html.spec.whatwg.org/multipage/dnd.html)). The DOM assertion alone still does not prove browser-chrome acceptance, so Chrome, Firefox, and Safari desktop deserve one manual installation smoke test each.
- The Stage 1 predicates and counterfactual test design now satisfy F5.

REWORK