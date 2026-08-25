/**
 * A fingerprint of the article a generated artefact was written from.
 *
 * **Why this is its own module.** It began life inside src/tweets.ts, where it
 * answered the one question the original version of that feature could never
 * answer: does this thread still describe the article on disk? The glossary
 * needs exactly the same answer, and two stages computing "the same" hash two
 * ways is the second-copy-of-one-fact problem this repo keeps meeting — the two
 * can only ever disagree, and the day they do, one artefact quietly reports
 * itself current against a different definition of current.
 *
 * So it lives here, on its own, and both stages import it. src/tweets.ts
 * re-exports it so nothing that already imported it from there had to change.
 *
 * See docs/project/architecture.md#storage.
 */
import { createHash } from "node:crypto";
import type { Block } from "./types.js";

/**
 * The ids **and** the text, not the raw bytes of blocks.json.
 *
 * Bytes would change when a field we don't read is recomputed, and would not
 * change if two blocks swapped ids — this changes exactly when what a reader
 * would read changes, which is the only question it is asked.
 *
 * Sixteen hex characters. It is compared for equality, never for closeness, and
 * a full sha256 in every artefact buys nothing but width.
 */
export function hashBlocks(blocks: Block[]): string {
  const canonical = blocks.map((b) => `${b.id}\t${b.text}`).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}
