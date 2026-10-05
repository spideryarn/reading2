No P0 or P1 findings. I fixed three issues; two remain reported.

1. **P2 — Blocked URLs can still be listed as bare addresses. Reported.**  
   `/login`, `/profile`, `/admin/*`, `/api/*` and the generated HTML files are robots-blocked. Crawlers therefore cannot read their exclusion headers. Discovered URLs can still appear in results, so the strict “only nine pages” outcome is not guaranteed. I traced `vercel.json`, robots rules and built heads, and verified this behavior against [Google’s documentation](https://developers.google.com/search/docs/crawling-indexing/block-indexing). Recorded the limitation in `docs/project/deployment.md`; changing crawling policy remains your decision.

2. **P2 — Malformed image hashes could break previews. Fixed.**  
   A JSON array containing a valid hash passed through regex coercion; `{toString:null}` threw during composition. An invalid first hash also hid a valid later picture. I reproduced both coercion cases and watched new regression tests fail. Fixed `src/asset-delivery.ts`, `src/public/page-head.ts` and `tests/lead-image.test.ts`: selection and URL construction now validate the hash’s runtime type and format.

3. **P2 — The manual deployment checker could give misleading results. Fixed.**  
   It accepted missing article robots metadata, rejected valid articles without a gist, and could succeed without checking any shared article. Added failing self-test cases, then fixed `scripts/check-public-shell.ts`. It now requires `--public-slug`, checks robots metadata, accepts absent descriptions correctly, and probes admin/API paths and every generated HTML file. All **121 self-tests pass**.

4. **P2 — Deployment’s robots check accepts comments as restrictions. Reported.**  
   `scripts/deploy.ts` uses `/disallow/i` against the entire response. Removing both real `Disallow:` directives still passes because comments contain that word. I ran that control; a separate agent confirmed the pre-existing introduction. Deployment also does not invoke the fuller shell checker. Left deployment orchestration unchanged and narrowed the author-facing claim.

5. **P3 — The author page overstated several guarantees. Fixed.**  
   Corrected `src/web/PublicReadableSharingPage.tsx` and its tests: pictures must satisfy the actual filters; descriptions and original links may be absent; preview robots receive `noindex` on shared articles; the deploy sentence promises only the verified response checks. The final author-page run passed **25 tests**.

The requested route audit produced:

| Address | Search crawler may fetch | Exclusion delivered |
|---|---|---|
| Nine own pages | Yes | No `noindex`; own head and canonical |
| Shared article | Yes | Header and robots meta |
| Private article | Yes | 404, default head and exclusion header |
| `/read/public` | Yes | Header and default robots meta |
| `/profile`, `/login`, `/admin/*` | Blocked | Header and default robots meta |
| `/api/*` | Blocked | Exclusion header |
| `/index.html`, `/shell.html`, `/_pages/*.html` | Blocked | Header on all; robots meta in shell |

I inspected all nine existing built heads and confirmed that the API bundle contains **`shell.html`’s digest**, rather than the homepage’s. The build order, duplicate-run refusal and dual-file shell fixture are sound. The consumer sweep found no remaining production reader treating built `index.html` as the default shell. `check-two-builds.ts` builds its separate Vite-only shell.

For pictures, I read `loadHead`, `loadAsset`, `publicSlug`, manifest membership checks and the private/unsharing fixtures. Published addresses use our origin and current slug; asset delivery rechecks visibility and membership. Publisher URLs and another article’s unlisted hash cannot supply the picture. Database asset tests were reviewed, not rerun.

All requested mutations failed for the intended reasons:

| Mutation | Result |
|---|---|
| Remove `/contact` from `SITE_PAGES` | 4 test failures |
| Widen header lookahead to exclude `/read/` | 5 failures |
| Drop `$` from pricing `Allow` rules | 11 failures |
| Return first image regardless of status | 6 failures |
| Emit robots meta in site-page heads | 10 failures |

All mutations were restored. **346 tests passed across nine targeted files**, typechecking passed, and lint reported one existing complexity advisory. No build, commit, push or server change was performed.

VERDICT: reject