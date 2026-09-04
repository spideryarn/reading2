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
  let out = pick(LETTERS, random);
  for (let i = 1; i < ID_BODY_LENGTH; i++) {
    out += pick(ALPHABET, random);
  }
  return ID_PREFIX + out;
}

/**
 * One character from `chars`. `Math.min` because `random()` returning exactly 1
 * is off the end of the string: `Math.random` never does, but a rigged
 * generator in a test can, and the old `chars[i]` form turned that into the
 * literal text "undefined" inside an id rather than an error.
 */
function pick(chars: string, random: () => number): string {
  return chars.charAt(Math.min(Math.floor(random() * chars.length), chars.length - 1));
}

export function isSpideryarnId(value: string | null | undefined): boolean {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/**
 * **How to name a value from the model in an error message — and when not to.**
 *
 * An error thrown while reading a model's answer is a value that travels: a
 * step that throws is logged by src/jobs.ts through `errorFields`, and
 * src/log.ts's serialiser keeps the error's `message` *and* its `stack`, which
 * contains the message again. So anything interpolated into one is written into
 * the log twice, and `redact` matches paths in the object rather than text in a
 * string, so it reaches neither copy. See docs/project/logging.md § An error is
 * not a safe thing to log whole.
 *
 * The awkward case is a stage whose inputs are `JSON.parse` of the model's
 * response with a TypeScript cast in front of them, because **the cast proves
 * nothing at runtime**. Nothing stops the model writing
 * `"range": ["Feeling is metabolic, not computational", "spya-k3m9qt"]`, and
 * that is precisely the input that reaches the lookup — a sentence of the
 * article is never in `blocks.json`, so the lookup misses and we throw. The
 * message would then carry the article's own prose into the log exactly when
 * the model misbehaves.
 *
 * The one value that is safe to quote is one that has passed `isSpideryarnId`:
 * `spya-` plus six characters drawn from the fixed alphabet above, which cannot
 * spell a word of anybody's article. Everything else is described by its shape
 * and withheld — a length and a type are enough to tell a truncated id from a
 * paragraph.
 *
 * **It lives here rather than in src/hierarchy.ts**, where it was written and
 * where its only caller was, because src/hierarchy-cascade.ts throws the same
 * kind of message about the same kind of value. Importing it from the stage
 * module would make a pure arithmetic file load the whole of stage 4 at
 * runtime, and would become a real `hierarchy → cascade → hierarchy` cycle the
 * moment `generateHierarchy` wires the cascade in. This module imports nothing
 * at all, which is what makes it the safe home. ⟨GPT Sol, 2026-09-04⟩
 */
export function nameValue(value: unknown): string {
  if (typeof value === "string" && isSpideryarnId(value)) return `"${value}"`;
  if (value === null) return "not a block id (null)";
  if (typeof value !== "string") return `not a block id (a ${typeof value})`;
  return `not a block id (a ${value.length}-character string, withheld)`;
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

/**
 * **An account id's shape** — `auth.users(id)`, as Postgres and GoTrue render
 * one.
 *
 * Here rather than in a sixth copy of the regex, because this file is already
 * where "is this string an id we recognise" is answered, and it imports nothing
 * — so a route, a store and the browser can all ask the same function. The
 * other copies (src/auth.ts, src/source.ts, src/feedback-payload.ts,
 * src/web/feedback-diagnostics.ts) each guard a different seam with a different
 * argument and are deliberately left alone; this one exists so the *next*
 * caller does not make a seventh.
 *
 * A shape, not a rule about whose account it is. It says a value can be
 * compared against an `owner_id` column without the driver throwing — the
 * question of whether the row is yours is answered somewhere else, and on the
 * admin routes deliberately is not asked at all.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID.test(value);
}
