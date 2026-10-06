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
 * with its fixture. Cloudflare's, reCAPTCHA's and the *"enable JavaScript"*
 * shells are all refused by the floor today, and an entry written without a
 * captured page is a guess about somebody else's markup.
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
 * **Anubis** (a proof-of-work check a browser's script has to solve).
 *
 * The page carries the challenge it is setting as
 * `<script id="anubis_challenge" type="application/json">`, a JSON object with
 * a `rules` object and a `challenge` object, which its own script reads. All
 * of that is required: the element, the type that makes it data rather than
 * code, and the two fields — a script of that id holding `{}` is not a
 * challenge. Captured from hal.science on 2026-10-06:
 * evals/extraction/fixtures/hal_anubis.html.
 */
function isAnubis(doc: Document): boolean {
  const el = doc.getElementById("anubis_challenge");
  if (el?.tagName !== "SCRIPT") return false;
  if ((el.getAttribute("type") ?? "").trim().toLowerCase() !== "application/json") return false;
  let payload: unknown;
  try {
    payload = JSON.parse(el.textContent ?? "");
  } catch {
    return false;
  }
  return isObject(payload) && isObject(payload["rules"]) && isObject(payload["challenge"]);
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
