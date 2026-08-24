/**
 * Spideryarn block ids — the spine everything else hangs off.
 *
 * See AGENTS.md § The one contract that matters, and
 * docs/project/block-ids.md for why these are random rather than sequential.
 */

/**
 * 32 characters: a–z minus `l`, `o`, `i` — and digits minus `1`.
 *
 * `l`/`i`/`1` and `o`/`0` are the pairs people misread when copying an id out of
 * a URL by hand. Dropping `o` is what makes keeping `0` safe.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";
const LETTERS = ALPHABET.slice(0, 23);

export const ID_PREFIX = "spya-";
const ID_BODY_LENGTH = 6;

/** Matches ids we assigned, and only those. */
export const ID_PATTERN = new RegExp(
  `^${ID_PREFIX}[${LETTERS}][${ALPHABET}]{${ID_BODY_LENGTH - 1}}$`,
);

/**
 * A random id such as `spya-k3m9qt`.
 *
 * The first character is always a letter so the id is a valid CSS selector
 * without escaping — `#spya-3m9qtk` is not, even though HTML5 permits the id.
 *
 * 23 × 32^5 ≈ 771M. For an article of a few hundred blocks the odds of an
 * internal collision are vanishing, but `assignIds` checks anyway: it costs a
 * set lookup, and a silent duplicate would corrupt every downstream artefact.
 */
export function mintId(random: () => number = Math.random): string {
  let out = LETTERS[Math.floor(random() * LETTERS.length)];
  for (let i = 1; i < ID_BODY_LENGTH; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return ID_PREFIX + out;
}

export function isSpideryarnId(value: string | null | undefined): boolean {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Mint an id that isn't in `taken`, and reserve it. */
export function mintUniqueId(taken: Set<string>, random?: () => number): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = mintId(random);
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  throw new Error("Could not mint a unique block id in 1000 attempts");
}
