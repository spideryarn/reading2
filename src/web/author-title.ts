/**
 * **Whether an article's own hover text is worth a line in our card.**
 *
 * The policy moves every `title` an article ships onto `data-author-title`
 * (src/sanitize-policy.ts § `AUTHOR_TITLE_ATTR`), so the browser draws no grey
 * box; the prose card (ProseHoverCard.tsx) shows what is left, labelled as the
 * author's. Most of it says nothing the reader cannot already see, and this
 * sets aside the four kinds that dominate a measured store — 145k of 170k on
 * 2026-10-18 (plan 261018n):
 *
 *  - the element's own words again (`<a title="Leo">Leo</a>`);
 *  - the address again — every Wikipedia link, `/wiki/Ancient_Corinth` titled
 *    *Ancient Corinth*, which the link half of the card names already;
 *  - COinS metadata (`span.Z3988`), a query string for citation managers;
 *  - blank.
 *
 * It errs towards showing: a redundant line costs little in a card that is
 * opening anyway, and a citation hidden by an over-clever rule costs the words.
 *
 * Returns the words to draw, whitespace collapsed and clipped, or `null`.
 */
export function authorTitleWorthShowing(
  title: string,
  text: string,
  href: string | null,
): string | null {
  const words = title.replace(/\s+/g, " ").trim();
  if (!words || words.startsWith("ctx_ver=")) return null;
  if (sameWords(words) === sameWords(text)) return null;
  const key = addressWords(words);
  const path = href ? addressWords(pathOf(href)) : "";
  if (key && (path === key || path.endsWith(` ${key}`))) return null;
  const characters = Array.from(words);
  return characters.length > MAX ? `${characters.slice(0, MAX).join("").trimEnd()}…` : words;
}

const MAX = 300;

/**
 * **For "is it the element's own words?", only what cannot change the meaning
 * goes**: case, spacing, and quotation marks round the outside — so
 * `“Scaling Laws”` is `scaling laws`, and `C++` is still not `C` (GPT Sol, plan
 * review of 261018n).
 */
function sameWords(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/gu, "")
    .trim();
}

/**
 * **For "is it the address again?", everything but the letters and digits**: a
 * path spells *Bibcode (identifier)* as `Bibcode_(identifier)`.
 */
function addressWords(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s_\p{P}\p{S}]+/gu, " ").trim();
}

/** The href's path, decoded; `""` when it will not parse. */
function pathOf(href: string): string {
  try {
    return decodeURIComponent(new URL(href, "https://x.invalid/").pathname);
  } catch {
    return "";
  }
}
