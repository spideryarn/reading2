# Which bot-check walls clear stage 2's text floor, fetched by our own fetcher?

Run 2026-10-06 for
[plan 261006f](../plans/261006f-other-bot-check-walls-that-clear-the-floor.md), queue item
`qi-e49jcjzb`. Up: [investigations.md](../project/investigations.md). The stage is
[content-extraction.md § The three ways this stage refuses](../project/content-extraction.md#the-three-ways-this-stage-refuses).

**In one paragraph.** 109 addresses known or suspected to sit behind a bot check went through the
real `fetchDocument` and the real `readArticle`. **One bot-check page cleared the floor
unrecognised: `bugs.winehq.org`, which is Anubis again**, an older version (v1.15) whose page has
no `<script id="anubis_challenge">` element for [`src/challenge-page.ts`](../../src/challenge-page.ts)
to find. It read as an article of 1,106 characters titled *"Making sure you're not a bot!"*.
**No Cloudflare, reCAPTCHA, hCaptcha, Turnstile, PerimeterX, AWS WAF, Radware or
"enable JavaScript" page cleared the floor.** The largest was 306 characters. So the plan adds no
new provider; it widens the Anubis entry to the older page, with that page as its fixture.

## What was asked

`src/challenge-page.ts` recognises one provider, Anubis. Every other wall is refused today only
because its page happens to be short (the floor is 500 characters of article text,
`MIN_ARTICLE_CHARS`). Is any of them long enough to be published as an article?

## What was run

[`scripts/probes/261006f-bot-wall-probe.ts`](../../scripts/probes/261006f-bot-wall-probe.ts), from
the Hetzner box, in two batches (addresses 1 to 69, then 70 to 109). The list is
in the script. Each address got one `fetchDocument` call with the shipped User-Agent and no retry,
then `readArticle` on any web page that came back. The script also greps the bytes for hints of a
challenge (a `g-recaptcha` class, a `captcha-delivery.com` URL and so on). Those hints only say
which pages to open and read; a real article with a reCAPTCHA on its comment form carries one.
Every page that cleared the floor was then read by eye. No AI call, nothing written to a database.
The rows are [`evals/results/bot-walls-261006/results.json`](../../evals/results/bot-walls-261006/results.json);
which of the floor-clearing pages is an article and which a check is the by-eye reading, recorded
in the table below. The pages' bytes were not kept, bar the one fixture.

## What came back

**61 of 109 never reach stage 2.** Stage 1 refuses them on the status line: 47 × 403, 4 × 429,
2 × 401, and eight assorted (404, 400, 406, 500, 502, a timeout, a DNS failure, a refused
connection). This is where Cloudflare's managed challenge lands (science.org, wiley, acm, ssrn,
medrxiv, europepmc, oup, sagepub, pnas, and the rest), and DataDome's and Akamai's with it. Those
pages are never read, however long they are.

**48 answered with a web page.** By what stage 2 made of each:

| what stage 2 said | n | which |
|---|---|---|
| `ChallengePage` (Anubis, recognised) | 8 | hal.science, lore.kernel.org, git.kernel.org, gitlab.freedesktop.org, sourceware.org, trac.ffmpeg.org, forum.freecad.org, gitlab.winehq.org (1,034 characters each: Anubis v1.26.2, v1.27.0 and `devel`) |
| `TooLittleTextToRead` | 14 | see the next table |
| `ReadabilityRefused` | 13 | the AWS WAF pages (imdb, ieeexplore, semanticscholar, degruyter: status 202, an empty body and a script), the app shells (instagram, tiktok, threads, bsky, pinterest, google search, duckduckgo, researchsquare), and psycnet (Imperva) |
| an article, and it is one | 12 | openai.com, scholar.google.com (a results page), seekingalpha.com, bing and baidu (results pages), git.gammaspectra.live (the go-away project's own README), wiki.archlinux.org, scummvm.org, nature, frontiersin, cambridge, aps |
| **an article, and it is a bot check** | **1** | **bugs.winehq.org** |

The walls the floor refused, and how close each came to 500:

| site | whose check | characters |
|---|---|---|
| iopscience.iop.org | Radware Bot Manager, with an hCaptcha | 306 |
| yandex.com | Yandex's own | 274 |
| x.com | not a check: an app shell | 248 |
| link.springer.com, www.jstor.org | Radware (*"Client Challenge"*) | 209 |
| muse.jhu.edu | Project MUSE's own | 182 |
| kiwifarms.st | a proof-of-work check (status 203) | 165 |
| openreview.net | Cloudflare Turnstile, on OpenReview's own page | 146 |
| pmc.ncbi.nlm.nih.gov, www.ncbi.nlm.nih.gov/pmc | reCAPTCHA | 130 |
| www.amazon.com | Amazon's own | 124 |
| www.walmart.com | PerimeterX (*"Robot or human?"*) | 69 |
| pubmed.ncbi.nlm.nih.gov | (status 203) | 28 |

(chatgpt.com, 473 characters, is the nearest thing to the floor and is an app shell, not a check.)

Three pages carried a challenge hint and are real articles: openai.com, cambridge.org and aps.org
all load Cloudflare's `cdn-cgi/challenge-platform` script on the article itself, and bing.com
carries a Turnstile. That is the case for the registry's rule that an entry reads the element a
challenge page writes for its own script, and never a URL or a class that a served article may
carry too.

## The one that got through

`bugs.winehq.org` runs **Anubis v1.15.0**. Newer versions write the challenge into the page as
`<script id="anubis_challenge" type="application/json">`, which is the element the registry's entry
reads. v1.15 does not: its script fetches the challenge from the server afterwards. What the v1.15
page does carry, for its own script:

- `<script id="anubis_version" type="application/json">"v1.15.0-37-g878b371"</script>`
- `<script async type="module" src="/.within.website/x/cmd/anubis/static/js/main.mjs?cacheBuster=…">`,
  the script that solves the challenge.

All eight recognised pages carry both of those too, as well as `anubis_challenge`. On sourceware.org
the script's path has a prefix in front (`/git/.within.website/…`). The v1.15 page has more visible
text than the newer ones (1,106 characters against 1,034), so it is further over the floor.

## What was decided

- **No entry for Cloudflare, reCAPTCHA, hCaptcha, Turnstile, PerimeterX, AWS WAF, Radware, Imperva
  or the "enable JavaScript" shells.** None was seen clearing the floor, and the registry's own
  rule is that an entry is written from a captured page that does.
- **The Anubis entry is widened to the older page**, with `bugs.winehq.org`'s bytes as the fixture.
  The plan has the markup rule.

## What this does not show

- **One machine, one User-Agent.** A wall that answers a data-centre address with a
  403 may answer a reader's upload of the saved page with 200 bytes or 2,000. An uploaded copy of a
  Cloudflare challenge was not measured, because we could not get one: stage 1 never receives it.
- **A wall can change its page.** The margins above are today's.
- **Anubis versions between v1.15 and v1.26 were not seen.** The widened entry rests on two
  captured shapes, not on a reading of Anubis's history.

## Noticed, not acted on

- Stage 1 treats **202 and 203 as a page** (AWS WAF answers 202 with `x-amzn-waf-action:
  challenge`). All four seen are refused later as unreadable, so nothing is published, but the
  reader is told *"no article"* rather than *"bot check"*.
- The same goes for every wall under the floor: correct refusal, less specific sentence.
