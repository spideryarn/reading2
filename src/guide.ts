/**
 * **The guide's two pieces of context that no other conversation gets**: our
 * words for the modes, and how much the reader has used Spideryarn before.
 *
 * The guide is the conversation about how to read this piece with Spideryarn
 * (`GUIDE_SYSTEM` in src/converse.ts,
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md). Both
 * pieces are pure and live here rather than in converse.ts so that a test can
 * pin them without a prompt around them.
 *
 * They go on opposite sides of the cache breakpoint, and that is the point of
 * keeping them apart:
 *
 * - **The mode words are the same for every reader and every article**, so
 *   they sit in the system prompt, above the breakpoint, as stable bytes
 *   (docs/project/prompt-caching.md).
 * - **The experience line changes per reader and over time**, so it rides in
 *   the final user message beside the profile, below the breakpoint, and never
 *   in the system prompt (GPT Sol's F7 on the plan above).
 */
import catalogue from "./command-pick-catalogue.generated.json" with { type: "json" };

/* ------------------------------------------------------- the mode words -- */

interface CatalogueRow {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly kind: string;
  readonly contexts: readonly string[];
}

/** The context every mode a reader can open on their own article is listed under. */
const OWNER_ARTICLE = "owner-article";
/** The same, with the experimental switch off: a mode missing here is experimental. */
const EXPERIMENTAL_OFF = "owner-article-experimental-off";

/**
 * **What the guide is told about each mode, in our words** — the label and
 * description the command bar shows, from the generated catalogue
 * (src/command-pick-catalogue.generated.json), for its `mode` and `submode`
 * rows on the reader's own article.
 *
 * In the catalogue's order, which is the bottom bar's, so the bytes depend on
 * nothing but that file: a regenerated catalogue is the only thing that moves
 * them. A sub-mode follows its mode. A mode that only shows with experimental
 * features on says so, because the reader may not see it in their bar.
 *
 * **Each ordinary one carries its button**, since stage 2 of the plan: the
 * `mode` proposal's token with the row's own catalogue key already encoded
 * (`modeToken`), so the model copies a token rather than spelling one. An
 * experimental one carries none, and the section says to name it in words:
 * whether the reader can open it is the switch's to say, and a token the
 * reader's page refuses is drawn as its raw brackets
 * (src/web/chat-commands.ts § `chipFor`). The page resolves every key against
 * what it can open now in any case; this only keeps the stray brackets down.
 */
export function modeWordsSection(rows: readonly CatalogueRow[] = catalogue): string {
  const ours = rows.filter(
    (row) => (row.kind === "mode" || row.kind === "submode") && row.contexts.includes(OWNER_ARTICLE),
  );
  const modes = ours.filter((row) => row.kind === "mode");
  const lines: string[] = [];
  for (const mode of modes) {
    const name = mode.id.slice("mode:".length);
    lines.push(`- ${mode.label}${experimental(mode)}: ${mode.description}.${button(mode)}`);
    for (const sub of ours) {
      if (sub.kind !== "submode" || !sub.id.startsWith(`submode:${name}:`)) continue;
      lines.push(`  - ${mode.label} › ${sub.label}${experimental(sub)}: ${sub.description}.${button(sub)}`);
    }
  }
  return `WHAT SPIDERYARN CAN SHOW THEM

These are the modes, in our own words. The reader opens one from the bottom bar
under the article, or by typing its name into the command bar (⌘K on a Mac,
Ctrl K elsewhere). A mode shows beside the article; it never replaces it. Use
these names exactly, so the reader can find what you mean. "(experimental)"
means the reader sees it only once they have turned on experimental features on
their profile page.

When you suggest a mode, you may put its button on a line of its own, after the
sentence saying what it would do for them: suggesting where to go is answering
here, so this is one of the times a button needs no asking. Copy the token
shown beside the mode exactly. A mode marked "(experimental)" has no button:
name it in words. The same holds for a quick search when you suggest one.

${lines.join("\n")}`;
}

/**
 * **The `mode` proposal's token for one catalogue row** — `[cmd:mode:<key>]`
 * with the key percent-encoded the way src/web/command-proposal.ts §
 * `formatProposalToken` encodes it. A key is lower-case letters, `-` and `:`
 * (command-match.ts § `commandId`), so `:` is the one character to encode.
 * tests/chat-command-chips-prompt.test.ts runs every token through the real
 * parser, so a key that ever needed more would fail there.
 */
export function modeToken(key: string): string {
  return `[cmd:mode:${key.replaceAll(":", "%3A")}]`;
}

/** ` Button: [cmd:mode:…]` for an ordinary row, nothing for an experimental one. */
function button(row: CatalogueRow): string {
  return experimental(row) === "" ? ` Button: ${modeToken(row.id)}` : "";
}

function experimental(row: CatalogueRow): string {
  return row.contexts.includes(EXPERIMENTAL_OFF) ? "" : " (experimental)";
}

/* --------------------------------------------------- the experience line -- */

/**
 * **How much the reader has used Spideryarn**, as a bucket and never a count.
 *
 * Measured as the other articles on their shelf they have opened at least once
 * (`ShelfStore.articlesOpenedBefore`): opening is closer to Greg's *"how many
 * articles they've already read"* than having added one. Bucketed because the
 * prompt needs the shape of it, not the number, and a coarse value is less of
 * the reader sent to a provider.
 */
export type GuideExperience = "none" | "a-few" | "many";

/** The most other articles opened that still count as "a few". */
export const A_FEW_ARTICLES = 5;

/**
 * The bucket for a count. **Throws on anything that is not a whole number at
 * least zero**, because a count arrives from the database and a driver that
 * hands back `"3"` instead of `3` is a bug to hear about, not a value to guess
 * at (src/store/pg-admin.ts § `.mapWith` has the trap).
 */
export function experienceOf(opened: number): GuideExperience {
  if (typeof opened !== "number" || !Number.isInteger(opened) || opened < 0) {
    throw new TypeError(`experienceOf: expected a whole number of articles, got ${typeof opened}`);
  }
  if (opened === 0) return "none";
  return opened <= A_FEW_ARTICLES ? "a-few" : "many";
}

/**
 * The line beside the question. `""` for no bucket, so a caller can join it
 * unconditionally — `profileSection`'s contract.
 */
export function experienceLine(experience: GuideExperience | null | undefined): string {
  switch (experience) {
    case null:
    case undefined:
      return "";
    case "none":
      return "HOW MUCH THEY HAVE USED SPIDERYARN: they have opened no other article still on their shelf.";
    case "a-few":
      return `HOW MUCH THEY HAVE USED SPIDERYARN: they have opened a few other articles still on their shelf (between one and ${A_FEW_ARTICLES}).`;
    case "many":
      return `HOW MUCH THEY HAVE USED SPIDERYARN: they have opened many other articles still on their shelf (more than ${A_FEW_ARTICLES}).`;
    default: {
      const unknown: never = experience;
      throw new Error(`unknown experience: ${String(unknown)}`);
    }
  }
}
