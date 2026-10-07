/**
 * **Which bot-check pages clear stage 2's text floor?** — the measurement for
 * docs/plans/261006f-other-bot-check-walls-that-clear-the-floor.md. A probe,
 * not the build: nothing in `src/` imports this.
 *
 *   npx tsx scripts/probes/261006f-bot-wall-probe.ts <out-dir> [--from=<n>] [url ...]
 *
 * Each address goes through the real `fetchDocument` (one attempt) and, when a
 * web page comes back, the real `readArticle`. One row each: what stage 1
 * said, what stage 2 said, how much text Readability made of it, its title,
 * and which **byte-level hints** of a challenge the page carries. The hints
 * are a regex over the bytes, which is exactly what src/challenge-page.ts must
 * not be: they are here to say which pages a person should open and read, and
 * they are evidence of nothing on their own (a real article with a reCAPTCHA
 * on its comment form has one).
 *
 * The bytes are written to `<out-dir>/<n>-<host>.html` so a page that clears
 * the floor can be looked at, and `<out-dir>/results.json` holds the rows. No
 * AI call is made and nothing is written to the database.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MIN_ARTICLE_CHARS, readArticle } from "../../src/extract.js";
import { FetchFailure, fetchDocument } from "../../src/fetch.js";

const DEFAULT_URLS: readonly string[] = [
  /* Cloudflare-fronted publishers and sites. */
  "https://www.science.org/doi/10.1126/science.1127647",
  "https://onlinelibrary.wiley.com/doi/10.1111/2041-210X.12628",
  "https://dl.acm.org/doi/10.1145/3292500.3330701",
  "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3340189",
  "https://www.medrxiv.org/content/10.1101/2020.04.15.20066407v1",
  "https://europepmc.org/article/MED/33495476",
  "https://www.researchgate.net/publication/220320123",
  "https://openai.com/index/gpt-4/",
  "https://www.tandfonline.com/doi/full/10.1080/00031305.2016.1154108",
  "https://academic.oup.com/bioinformatics/article/25/14/1754/225615",
  "https://www.jstor.org/stable/2118501",
  "https://pubs.acs.org/doi/10.1021/acs.jcim.9b00237",
  "https://journals.sagepub.com/doi/10.1177/0956797611417632",
  "https://www.pnas.org/doi/10.1073/pnas.1611835114",
  "https://www.annualreviews.org/doi/10.1146/annurev-psych-010418-102803",
  "https://www.cell.com/cell/fulltext/S0092-8674(18)30154-5",
  "https://www.g2.com/products/slack/reviews",
  "https://www.crunchbase.com/organization/anthropic",
  "https://www.indeed.com/",
  "https://www.quora.com/What-is-the-meaning-of-life",
  "https://nowsecure.nl/",
  "https://www.economist.com/",
  "https://chatgpt.com/",
  "https://www.researchsquare.com/article/rs-1",
  "https://www.biorxiv.org/content/10.1101/2020.01.01.000001v1",
  /* reCAPTCHA and the search engines' own. */
  "https://pmc.ncbi.nlm.nih.gov/articles/PMC8371605/",
  "https://pubmed.ncbi.nlm.nih.gov/33495476/",
  "https://scholar.google.com/scholar?q=attention+is+all+you+need",
  "https://www.google.com/search?q=tide+gauge+newlyn",
  "https://archive.ph/newest/https://example.com/",
  /* DataDome, PerimeterX, Akamai, Imperva, AWS WAF. */
  "https://www.reuters.com/world/",
  "https://www.wsj.com/",
  "https://www.bloomberg.com/",
  "https://www.zillow.com/",
  "https://www.nytimes.com/",
  "https://www.ft.com/",
  "https://www.amazon.com/dp/B08N5WRWNW",
  "https://www.linkedin.com/pulse/",
  "https://www.tripadvisor.com/",
  "https://www.imdb.com/title/tt0111161/",
  "https://www.walmart.com/ip/1",
  "https://www.wayfair.com/",
  "https://www.yelp.com/biz/the-french-laundry-yountville",
  "https://www.etsy.com/",
  "https://www.glassdoor.com/",
  "https://www.ticketmaster.com/",
  "https://seekingalpha.com/",
  "https://www.bestbuy.com/",
  "https://www.sciencedirect.com/science/article/pii/S0004370218305988",
  "https://ieeexplore.ieee.org/document/7780459",
  "https://link.springer.com/article/10.1007/s11263-015-0816-y",
  "https://www.semanticscholar.org/paper/204e3073870fae3d05bcbc2f6a8e263d9b72e776",
  "https://openreview.net/forum?id=rJl-b3RcF7",
  /* Shells that need a script to show anything. */
  "https://x.com/jack/status/20",
  "https://www.instagram.com/",
  "https://www.facebook.com/",
  "https://www.tiktok.com/",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.reddit.com/r/programming/",
  "https://old.reddit.com/r/programming/",
  "https://bsky.app/profile/bsky.app",
  "https://www.threads.net/",
  "https://www.pinterest.com/",
  /* Other self-hosted checks. */
  "https://gitlab.gnome.org/GNOME/gtk",
  "https://lore.kernel.org/lkml/",
  "https://git.sr.ht/~sircmpwn/hare",
  "https://codeberg.org/forgejo/forgejo",
  "https://www.gnu.org/software/emacs/",
  "https://ddos-guard.net/",
  /* The second batch, 2026-10-06: the wordier self-hosted checks, the search
     engines, and more publishers. */
  "https://hal.science/hal-05779468",
  "https://gitlab.freedesktop.org/mesa/mesa",
  "https://git.gammaspectra.live/git/go-away",
  "https://sourceware.org/git/glibc.git",
  "https://trac.ffmpeg.org/",
  "https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/",
  "https://wiki.archlinux.org/title/Installation_guide",
  "https://forum.freecad.org/",
  "https://bugs.winehq.org/",
  "https://gitlab.winehq.org/wine/wine",
  "https://www.scummvm.org/",
  "https://html.duckduckgo.com/html/?q=newlyn+tide+gauge",
  "https://www.bing.com/search?q=newlyn+tide+gauge",
  "https://search.yahoo.com/search?p=newlyn+tide+gauge",
  "https://yandex.com/search/?text=newlyn+tide+gauge",
  "https://www.baidu.com/s?wd=tide+gauge",
  "https://kiwifarms.st/",
  "https://annas-archive.org/",
  "https://stackoverflow.com/questions/11227809",
  "https://www.npmjs.com/package/react",
  "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8371605/",
  "https://www.nature.com/articles/s41586-021-03819-2",
  "https://www.frontiersin.org/articles/10.3389/fpsyg.2015.00001/full",
  "https://www.mdpi.com/2073-4425/11/1/1",
  "https://iopscience.iop.org/article/10.1088/1748-9326/aa6f9e",
  "https://www.cambridge.org/core/journals/behavioral-and-brain-sciences/article/abs/weirdest-people-in-the-world/BF84F7517D56AFF7B7EB58411A554C17",
  "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.116.061102",
  "https://psycnet.apa.org/record/2011-25130-001",
  "https://muse.jhu.edu/article/1",
  "https://www.degruyter.com/document/doi/10.1515/9783110000000/html",
  "https://www.emerald.com/insight/content/doi/10.1108/1/full/html",
  "https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(20)30183-5/fulltext",
  "https://jamanetwork.com/journals/jama/fullarticle/2762130",
  "https://www.nejm.org/doi/full/10.1056/NEJMoa2001017",
  "https://www.bmj.com/content/368/bmj.m1091",
  "https://www.ahajournals.org/doi/10.1161/CIRCULATIONAHA.120.046941",
  "https://royalsocietypublishing.org/doi/10.1098/rsos.160384",
  "https://www.worldscientific.com/doi/10.1142/S0218202520500001",
  "https://arc.aiaa.org/doi/10.2514/1.J059203",
  "https://ascelibrary.org/doi/10.1061/1",
];

/** Byte-level hints, for a person deciding which page to open. Not a recogniser. */
const HINTS: readonly [string, RegExp][] = [
  ["cloudflare-challenge", /_cf_chl_opt|cdn-cgi\/challenge-platform|cf-chl-|challenge-error-text/],
  ["cloudflare-turnstile", /challenges\.cloudflare\.com\/turnstile|cf-turnstile/],
  ["recaptcha", /google\.com\/recaptcha|g-recaptcha|grecaptcha/],
  ["hcaptcha", /hcaptcha\.com|h-captcha/],
  ["datadome", /captcha-delivery\.com|datadome/i],
  ["perimeterx", /px-captcha|_pxAppId|perimeterx|px-cdn|humansecurity/i],
  ["aws-waf", /awswaf|gokuProps|AwsWafIntegration|captcha\.awswaf/],
  ["imperva", /_Incapsula_Resource|incapsula/i],
  ["akamai", /bm-verify|_abck|akamai.*bot|sec-if-cpt/i],
  ["anubis", /anubis_challenge|id="anubis_/],
  ["vercel-checkpoint", /vercel security checkpoint/i],
  ["ddos-guard", /ddos-guard/i],
  ["sucuri", /sucuri/i],
  ["go-away", /go-away|\.well-known\/\.git\.gammaspectra/],
  ["noscript", /<noscript/i],
  ["says-enable-javascript", /enable javascript|javascript is (required|disabled)|requires javascript|turn on javascript/i],
  ["says-robot", /not a robot|are you a (robot|human)|verify(ing)? (that )?you are (a )?human|unusual traffic|just a moment/i],
];

interface Row {
  n: number;
  requested: string;
  stage1: string;
  status: number | null;
  finalUrl: string | null;
  bytes: number | null;
  stage2: string | null;
  chars: number | null;
  clearsFloor: boolean | null;
  title: string | null;
  hints: string[];
  file: string | null;
}

/** Readability's own measure of an article — src/extract.ts § `visibleLength`. */
const measured = (text: string | null | undefined): number => (text ?? "").trim().replace(/\s{2,}/g, " ").length;

async function probe(n: number, url: string, outDir: string): Promise<Row> {
  const row: Row = {
    n,
    requested: url,
    stage1: "ok",
    status: null,
    finalUrl: null,
    bytes: null,
    stage2: null,
    chars: null,
    clearsFloor: null,
    title: null,
    hints: [],
    file: null,
  };
  let doc: Awaited<ReturnType<typeof fetchDocument>>;
  try {
    doc = await fetchDocument(url, { attempts: 1, timeoutMs: 25_000 });
  } catch (e) {
    if (e instanceof FetchFailure) {
      row.stage1 = e.code;
      row.status = e.status;
    } else {
      row.stage1 = `threw ${e instanceof Error ? e.name : "unknown"}`;
    }
    return row;
  }
  row.status = doc.status;
  row.finalUrl = doc.url;
  row.bytes = doc.bytes.byteLength;
  if (doc.kind !== "html") {
    row.stage1 = `ok (${doc.kind})`;
    return row;
  }
  const file = `${String(n).padStart(2, "0")}-${new URL(doc.url).hostname}.html`;
  writeFileSync(path.join(outDir, file), doc.text);
  row.file = file;
  row.hints = HINTS.filter(([, re]) => re.test(doc.text)).map(([name]) => name);
  try {
    const { article, refusal } = readArticle(doc.text, doc.url);
    row.chars = article ? measured(article.textContent) : null;
    row.title = article?.title ?? null;
    row.stage2 = refusal ? refusal.name : article ? "article" : "ReadabilityRefused";
    row.clearsFloor = row.chars !== null && row.chars >= MIN_ARTICLE_CHARS;
  } catch (e) {
    row.stage2 = `threw ${e instanceof Error ? e.name : "unknown"}`;
  }
  return row;
}

async function main(): Promise<void> {
  const [outDir, ...rest] = process.argv.slice(2);
  if (!outDir) throw new Error("usage: 261006f-bot-wall-probe.ts <out-dir> [--from=<n>] [url ...]");
  mkdirSync(outDir, { recursive: true });
  /* `--from=<n>` starts the built-in list at its nth address, numbered from 1. */
  const from = Number(rest.find((a) => a.startsWith("--from="))?.slice("--from=".length) ?? 1);
  const given = rest.filter((a) => !a.startsWith("--"));
  const urls = given.length > 0 ? given : DEFAULT_URLS.slice(from - 1);
  const rows: Row[] = new Array<Row>(urls.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const url = urls[i];
      if (url === undefined) return;
      rows[i] = await probe(from + i, url, outDir);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(rows, null, 2)}\n`);
  for (const r of rows) {
    console.log(
      [
        String(r.n).padStart(2),
        new URL(r.requested).hostname.padEnd(28),
        `${r.stage1}${r.status ? ` ${r.status}` : ""}`.padEnd(22),
        (r.stage2 ?? "").padEnd(20),
        String(r.chars ?? "").padStart(6),
        (r.title ?? "").slice(0, 40).padEnd(40),
        r.hints.join(","),
      ].join(" | "),
    );
  }
}

await main();
