/**
 * **Is this document a site's bot check, rather than the page behind it?** — a
 * registry of pages that say so themselves, in machine-readable markup.
 *
 * This is **C1** of
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md, built by
 * docs/plans/261006c-a-bot-check-page-is-refused-by-its-own-markup.md. Stage 2
 * already had a floor on *how much* text a page has (src/extract.ts §
 * `capabilityFloor`), and for a month that floor stood in for this: both walls
 * in the corpus happened to be short. hal.science's is not. Its check explains
 * itself in 1,034 characters of well-formed prose, so it was published as an
 * article titled *"Making sure you're not a bot!"*, and a published article
 * spends a reader's slot. No number separates that page from a short real one;
 * what separates them is *what the page is*, and that is this file's question.
 * docs/postmortems/261006c-a-size-floor-stood-in-for-a-recogniser-of-kind.md.
 *
 * **An entry reads markup, never wording.** Every entry is an element the
 * challenge's own software writes for its own script to read. Visible text is
 * not evidence: `acx.html` says *"just a moment"* twice, and an article about
 * these checks quotes all of their sentences. So nothing here looks at a title,
 * a phrase or a length, and nothing here is a regex over the bytes — a page
 * that shows the markup in a code sample has it as *text*, and the parsed DOM
 * is what knows the difference. tests/extract-challenge-page.test.ts holds one
 * negative control per way of getting this wrong.
 *
 * **What a match claims, said narrowly**: *this page is one the provider
 * generated, or one built to look like it.* Not that no other page could ever
 * carry the element (GPT Sol, 2026-10-06).
 *
 * **Adding an entry**: when a challenge page is seen that clears the floor, and
 * with its fixture. An entry written without a captured page is a guess about
 * somebody else's markup. Cloudflare's, reCAPTCHA's, hCaptcha's and the
 * *"enable JavaScript"* shells have no entry because none was seen clearing
 * the floor: of 109 walled addresses fetched on 2026-10-06, 61 never passed
 * stage 1 (mostly a 403), and every bot check among the rest was unreadable,
 * under the floor (the largest at 306 characters), or Anubis. One machine, one
 * User-Agent —
 * docs/investigations/261006c-which-bot-check-walls-clear-the-floor-through-our-fetcher.md.
 *
 * **An entry is fitted to the pages it was written from, and a provider's
 * software has versions.** The one page that run found over the floor and
 * unrecognised was Anubis again, an older version whose page lacks the element
 * the entry read. So an entry may hold more than one shape, each with its own
 * captured page.
 * docs/postmortems/261006j-a-recogniser-fitted-to-one-sample-of-a-versioned-page.md.
 */

/** Whose check it is. For the log and the eval; the reader's sentence does not name it. */
export type ChallengeProvider = "anubis";

/**
 * **The document is a bot check** — stage 2's third typed refusal, beside
 * `ReadabilityRefused` and `TooLittleTextToRead` (src/extract.ts).
 *
 * A type and not a sentence, for the reason `ReadabilityRefused`'s docstring
 * records: src/pipeline.ts classifies on `instanceof`. The message is the
 * log's. What the reader is shown is `documentIsABotCheck` in src/messages.ts.
 */
export class ChallengePage extends Error {
  readonly provider: ChallengeProvider;
  constructor(provider: ChallengeProvider) {
    super(`The document is a bot check (${provider}), not the page it stands in front of.`);
    this.name = "ChallengePage";
    this.provider = provider;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * **Is there a `<script id=… type="application/json">` whose parsed text passes?**
 *
 * *Is there one*, not *is the first one*: ids are not unique in pages as they
 * are found, and `getElementById` answers with the first element of that id,
 * so an unrelated element in front would hide the real one —
 * docs/postmortems/261006k-a-first-id-match-hid-a-later-valid-script.md.
 */
function hasJsonScript(doc: Document, id: string, passes: (payload: unknown) => boolean): boolean {
  for (const el of doc.querySelectorAll(`script[id="${id}"]`)) {
    if ((el.getAttribute("type") ?? "").trim().toLowerCase() !== "application/json") continue;
    let payload: unknown;
    try {
      payload = JSON.parse(el.textContent ?? "");
    } catch {
      continue;
    }
    if (passes(payload)) return true;
  }
  return false;
}

/**
 * **Anubis, the challenge in the page** (v1.26, v1.27 and `devel`, as seen).
 *
 * The page carries the challenge it is setting as
 * `<script id="anubis_challenge" type="application/json">`, a JSON object with
 * a `rules` object and a `challenge` object, which its own script reads. All
 * of that is required: the element, the type that makes it data rather than
 * code, and the two fields — a script of that id holding `{}` is not a
 * challenge. Captured from hal.science on 2026-10-06:
 * evals/extraction/fixtures/hal_anubis.html.
 */
function isAnubisWithItsChallenge(doc: Document): boolean {
  return hasJsonScript(
    doc,
    "anubis_challenge",
    (payload) => isObject(payload) && isObject(payload["rules"]) && isObject(payload["challenge"]),
  );
}

/** Where every Anubis install serves the script that solves its check, after whatever prefix the install sits under. */
const ANUBIS_SOLVER_PATH = "/.within.website/x/cmd/anubis/static/js/main.mjs";

/**
 * **Anubis, the challenge fetched afterwards** (v1.15, as seen).
 *
 * The older page has no `anubis_challenge` element: its script asks the server
 * for the challenge once it is running. What the page does carry, and both are
 * required:
 *
 * - `<script id="anubis_version" type="application/json">` holding a non-empty
 *   JSON string. It says *Anubis wrote this page*.
 * - a `<script type="module">` whose `src` has a path ending
 *   `ANUBIS_SOLVER_PATH`. It is the script that solves the check, so it says
 *   *and this page is a challenge*, not some other page Anubis writes.
 *
 * **The path is matched by its ending**, because an install may sit under a
 * prefix (sourceware.org serves it from `/git/.within.website/…`), and the
 * query string (`?cacheBuster=…`) is not part of it.
 *
 * **The `src` is read as the attribute and never resolved against the
 * document.** An uploaded copy has no address, so its base is `about:blank`,
 * and a root-relative path does not resolve against that; the copy a reader is
 * told to save and upload would be the one missed (GPT Sol, 2026-10-06). The
 * made-up base below is there only so `URL` will split the path from the query
 * string, and an attribute it cannot parse is a non-match.
 *
 * Captured from bugs.winehq.org on 2026-10-06:
 * evals/extraction/fixtures/winehq_anubis.html. Versions between v1.15 and
 * v1.26 were not seen.
 */
function isAnubisFetchingItsChallenge(doc: Document): boolean {
  if (!hasJsonScript(doc, "anubis_version", (version) => typeof version === "string" && version !== "")) return false;
  for (const el of doc.querySelectorAll("script[src]")) {
    if ((el.getAttribute("type") ?? "").trim().toLowerCase() !== "module") continue;
    let pathname: string;
    try {
      ({ pathname } = new URL(el.getAttribute("src") ?? "", "https://anubis.invalid/"));
    } catch {
      continue;
    }
    if (pathname.endsWith(ANUBIS_SOLVER_PATH)) return true;
  }
  return false;
}

/**
 * **Anubis** (a proof-of-work check a browser's script has to solve): either
 * of the two shapes its page has been seen in. Every newer page captured
 * carries both; the older one carries only the second.
 */
function isAnubis(doc: Document): boolean {
  return isAnubisWithItsChallenge(doc) || isAnubisFetchingItsChallenge(doc);
}

/** The registry. A `Record` over the union, so a new provider cannot be named and left out. */
const RECOGNISERS: Record<ChallengeProvider, (doc: Document) => boolean> = {
  anubis: isAnubis,
};

/**
 * The refusal for this document, or `null` when it is not a challenge page any
 * entry knows.
 *
 * **Hand it the source as it arrived**, before `prepareDocument` and before
 * Readability: both rewrite the document, and Readability removes every
 * `<script>`. src/extract.ts § `readingArm` and `provenanceArm` both do.
 */
export function challengeIn(doc: Document): ChallengePage | null {
  for (const provider of Object.keys(RECOGNISERS) as ChallengeProvider[]) {
    if (RECOGNISERS[provider](doc)) return new ChallengePage(provider);
  }
  return null;
}
